#!/bin/bash
# ============================================================
# VenueScope Admin API — Lambda + API Gateway deployment
# Run this in AWS CloudShell (us-east-2) or any terminal with
# admin IAM credentials.
#
# What it does:
#   1. Creates IAM role for the Lambda
#   2. Packages and deploys Lambda function
#   3. Creates HTTP API Gateway
#   4. Outputs the VITE_ADMIN_API_URL you need to set
# ============================================================

set -e

REGION="us-east-2"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
FUNCTION_NAME="VenueScopeAdminAPI"
ROLE_NAME="VenueScopeAdminAPIRole"
API_NAME="VenueScopeAdminAPI"
USER_POOL_ID="us-east-2_sMY1wYEF9"

echo "Deploying Admin API to account $ACCOUNT in $REGION..."

# ── 0. DDB tables (create if missing) ─────────────────────────

ensure_table() {
  local TABLE_NAME="$1"
  if aws dynamodb describe-table --table-name "$TABLE_NAME" --region "$REGION" >/dev/null 2>&1; then
    echo "  → Table $TABLE_NAME exists"
  else
    aws dynamodb create-table \
      --table-name "$TABLE_NAME" \
      --attribute-definitions AttributeName=runId,AttributeType=S \
      --key-schema AttributeName=runId,KeyType=HASH \
      --billing-mode PAY_PER_REQUEST \
      --region "$REGION" >/dev/null
    echo "  ✓ Created $TABLE_NAME"
  fi
}

echo "Ensuring DDB tables exist..."
ensure_table VenueScopeTestRuns

# ── 1. IAM Role ──────────────────────────────────────────────

echo "Creating/updating IAM role..."

TRUST_POLICY=$(cat <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "lambda.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}
EOF
)

if aws iam get-role --role-name $ROLE_NAME >/dev/null 2>&1; then
  echo "  → Role exists, skipping creation"
else
  aws iam create-role \
    --role-name $ROLE_NAME \
    --assume-role-policy-document "$TRUST_POLICY" \
    --description "VenueScope Admin API Lambda execution role" >/dev/null
  echo "  ✓ Role created"
fi

ROLE_ARN=$(aws iam get-role --role-name $ROLE_NAME --query 'Role.Arn' --output text)

# Attach basic execution policy
aws iam attach-role-policy \
  --role-name $ROLE_NAME \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole \
  2>/dev/null || true

# Inline policy: DynamoDB + Cognito admin
INLINE_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cognito-idp:AdminCreateUser",
        "cognito-idp:AdminUpdateUserAttributes",
        "cognito-idp:ListUsers",
        "cognito-idp:AdminSetUserPassword",
        "cognito-idp:AdminDisableUser",
        "cognito-idp:AdminEnableUser"
      ],
      "Resource": "arn:aws:cognito-idp:${REGION}:${ACCOUNT}:userpool/${USER_POOL_ID}"
    },
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:Scan",
        "dynamodb:Query",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem"
      ],
      "Resource": [
        "arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/VenueScopeVenues",
        "arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/VenueScopeVenues/*",
        "arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/VenueScopeCameras",
        "arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/VenueScopeCameras/*",
        "arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/VenueScopeJobs",
        "arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/VenueScopeJobs/*",
        "arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/VenueScopeLowConfEvents",
        "arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/VenueScopeLowConfEvents/*",
        "arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/VenueScopeTestRuns",
        "arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/VenueScopeTestRuns/*"
      ]
    }
  ]
}
EOF
)

aws iam put-role-policy \
  --role-name $ROLE_NAME \
  --policy-name VenueScopeAdminAPIPolicy \
  --policy-document "$INLINE_POLICY"
echo "  ✓ IAM role policy updated"

# ── 2. Package Lambda ────────────────────────────────────────

echo "Packaging Lambda..."
cd "$(dirname "$0")/lambda/admin-api"
zip -q lambda.zip index.mjs
echo "  ✓ Packaged lambda.zip ($(du -sh lambda.zip | cut -f1))"

# Wait for IAM propagation
echo "  Waiting 10s for IAM propagation..."
sleep 10

# ── 3. Deploy Lambda ─────────────────────────────────────────

echo "Deploying Lambda function..."

# Preserve any pre-set env vars on the Lambda so deploy doesn't blow away
# OPS_SECRET (per-venue ops proxy auth), DO_API_TOKEN (droplet provisioning),
# STRIPE_*, etc. We read the existing config, take only the keys we manage
# below, and pass everything else through unchanged.
EXISTING_ENV_JSON=$(aws lambda get-function-configuration \
  --function-name $FUNCTION_NAME --region $REGION \
  --query 'Environment.Variables' --output json 2>/dev/null || echo '{}')

# Build env-var string: start with existing, override only USER_POOL_ID/REGION
ENV_VARS=$(echo "$EXISTING_ENV_JSON" | python3 -c "
import json, sys
existing = {}
try: existing = json.load(sys.stdin) or {}
except Exception: pass
existing['USER_POOL_ID'] = '$USER_POOL_ID'
existing['REGION']       = '$REGION'
print(','.join(f'{k}={v}' for k,v in existing.items()))
")

if aws lambda get-function --function-name $FUNCTION_NAME --region $REGION >/dev/null 2>&1; then
  aws lambda update-function-code \
    --function-name $FUNCTION_NAME \
    --zip-file fileb://lambda.zip \
    --region $REGION >/dev/null

  aws lambda update-function-configuration \
    --function-name $FUNCTION_NAME \
    --environment "Variables={$ENV_VARS}" \
    --region $REGION >/dev/null

  echo "  ✓ Lambda updated (env vars preserved: $(echo $EXISTING_ENV_JSON | python3 -c 'import json,sys; print(len(json.load(sys.stdin) or {}))') existing kept)"
else
  aws lambda create-function \
    --function-name $FUNCTION_NAME \
    --runtime nodejs20.x \
    --role $ROLE_ARN \
    --handler index.handler \
    --zip-file fileb://lambda.zip \
    --environment "Variables={USER_POOL_ID=$USER_POOL_ID,REGION=$REGION}" \
    --timeout 30 \
    --memory-size 256 \
    --region $REGION >/dev/null

  echo "  ✓ Lambda created — set OPS_SECRET + DO_API_TOKEN env vars next"
fi

LAMBDA_ARN=$(aws lambda get-function --function-name $FUNCTION_NAME --region $REGION --query 'Configuration.FunctionArn' --output text)

# ── 4. API Gateway ───────────────────────────────────────────

echo "Setting up API Gateway..."

# Check if API exists
EXISTING_API=$(aws apigatewayv2 get-apis --region $REGION --query "Items[?Name=='$API_NAME'].ApiId" --output text)

if [ -n "$EXISTING_API" ] && [ "$EXISTING_API" != "None" ]; then
  API_ID=$EXISTING_API
  echo "  → API exists: $API_ID"
else
  API_ID=$(aws apigatewayv2 create-api \
    --name $API_NAME \
    --protocol-type HTTP \
    --cors-configuration AllowOrigins='["*"]',AllowMethods='["GET","POST","PUT","PATCH","DELETE","OPTIONS"]',AllowHeaders='["Content-Type","Authorization","X-Admin-Key"]' \
    --region $REGION \
    --query 'ApiId' --output text)
  echo "  ✓ API created: $API_ID"
fi

API_ENDPOINT=$(aws apigatewayv2 get-api --api-id $API_ID --region $REGION --query 'ApiEndpoint' --output text)

# Create Lambda integration
INTEGRATION_ID=$(aws apigatewayv2 get-integrations --api-id $API_ID --region $REGION \
  --query "Items[?IntegrationUri=='$LAMBDA_ARN'].IntegrationId" --output text)

if [ -z "$INTEGRATION_ID" ] || [ "$INTEGRATION_ID" = "None" ]; then
  INTEGRATION_ID=$(aws apigatewayv2 create-integration \
    --api-id $API_ID \
    --integration-type AWS_PROXY \
    --integration-uri $LAMBDA_ARN \
    --payload-format-version 2.0 \
    --region $REGION \
    --query 'IntegrationId' --output text)
  echo "  ✓ Lambda integration created"
fi

# Create catch-all route
EXISTING_ROUTE=$(aws apigatewayv2 get-routes --api-id $API_ID --region $REGION \
  --query "Items[?RouteKey=='ANY /{proxy+}'].RouteId" --output text)

if [ -z "$EXISTING_ROUTE" ] || [ "$EXISTING_ROUTE" = "None" ]; then
  aws apigatewayv2 create-route \
    --api-id $API_ID \
    --route-key "ANY /{proxy+}" \
    --target "integrations/$INTEGRATION_ID" \
    --region $REGION >/dev/null
  echo "  ✓ Route created"
fi

# Auto-deploy stage
STAGE_EXISTS=$(aws apigatewayv2 get-stages --api-id $API_ID --region $REGION \
  --query "Items[?StageName=='\$default'].StageName" --output text)

if [ -z "$STAGE_EXISTS" ] || [ "$STAGE_EXISTS" = "None" ]; then
  aws apigatewayv2 create-stage \
    --api-id $API_ID \
    --stage-name '$default' \
    --auto-deploy \
    --region $REGION >/dev/null
  echo "  ✓ Stage created"
fi

# Grant API Gateway permission to invoke Lambda
aws lambda add-permission \
  --function-name $FUNCTION_NAME \
  --statement-id "apigateway-${API_ID}" \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT}:${API_ID}/*/*/{proxy+}" \
  --region $REGION >/dev/null 2>&1 || true

cd -

# ── 5. Output ────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║           DEPLOYMENT COMPLETE                        ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║"
echo "║  VITE_ADMIN_API_URL=$API_ENDPOINT"
echo "║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║"
echo "║  Add the above line to:"
echo "║    1. /opt/venuescope/venuescope_v6/.env"
echo "║    2. AWS Amplify → App Settings → Environment Variables"
echo "║"
echo "║  Test it:"
echo "║  curl $API_ENDPOINT/admin/stats"
echo "║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# Write URL to a local file for reference
echo "VITE_ADMIN_API_URL=$API_ENDPOINT" > "$(dirname "$0")/.admin_api_url"
echo "Saved to .admin_api_url"
