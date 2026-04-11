#!/usr/bin/env bash
# =============================================================================
# VenueScope AWS Infrastructure Setup
# Run this entirely in AWS CloudShell — no line-by-line pasting needed.
#
# Usage:
#   1. Open AWS CloudShell (us-east-2 region)
#   2. Upload this file: Actions → Upload file
#   3. chmod +x cloudshell_setup.sh && ./cloudshell_setup.sh
#   4. Copy the API_URL printed at the end into Amplify env vars as VITE_ADMIN_API_URL
# =============================================================================

set -euo pipefail

REGION="us-east-2"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
USER_POOL_ID="us-east-2_sMY1wYEF9"
LAMBDA_NAME="venuescope-admin-api"
LAMBDA_ROLE_NAME="venuescope-admin-lambda-role"
API_NAME="venuescope-admin-api"
WRITER_USER="venuescope-writer"

echo ""
echo "======================================================"
echo "  VenueScope AWS Setup"
echo "  Account: $ACCOUNT_ID | Region: $REGION"
echo "======================================================"
echo ""

# ──────────────────────────────────────────────────────────────────────────────
# 1. DynamoDB Tables
# ──────────────────────────────────────────────────────────────────────────────

echo "[1/6] Creating DynamoDB tables..."

# VenueScopeVenues
if aws dynamodb describe-table --table-name VenueScopeVenues --region $REGION >/dev/null 2>&1; then
  echo "  ✓ VenueScopeVenues already exists"
else
  aws dynamodb create-table \
    --table-name VenueScopeVenues \
    --attribute-definitions AttributeName=venueId,AttributeType=S \
    --key-schema AttributeName=venueId,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region $REGION
  echo "  ✓ VenueScopeVenues created"
fi

# VenueScopeCameras
if aws dynamodb describe-table --table-name VenueScopeCameras --region $REGION >/dev/null 2>&1; then
  echo "  ✓ VenueScopeCameras already exists"
else
  aws dynamodb create-table \
    --table-name VenueScopeCameras \
    --attribute-definitions AttributeName=venueId,AttributeType=S AttributeName=cameraId,AttributeType=S \
    --key-schema AttributeName=venueId,KeyType=HASH AttributeName=cameraId,KeyType=RANGE \
    --billing-mode PAY_PER_REQUEST \
    --region $REGION
  echo "  ✓ VenueScopeCameras created"
fi

# ──────────────────────────────────────────────────────────────────────────────
# 2. Update venuescope-writer IAM policy for new tables
# ──────────────────────────────────────────────────────────────────────────────

echo "[2/6] Updating venuescope-writer IAM policy..."

cat > /tmp/writer-policy.json << 'POLICY'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "VenueScopeJobsAccess",
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-2:*:table/VenueScopeJobs",
        "arn:aws:dynamodb:us-east-2:*:table/VenueScopeJobs/index/*"
      ]
    },
    {
      "Sid": "VenueScopeVenuesAccess",
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-2:*:table/VenueScopeVenues",
        "arn:aws:dynamodb:us-east-2:*:table/VenueScopeVenues/index/*"
      ]
    },
    {
      "Sid": "VenueScopeCamerasAccess",
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-2:*:table/VenueScopeCameras",
        "arn:aws:dynamodb:us-east-2:*:table/VenueScopeCameras/index/*"
      ]
    }
  ]
}
POLICY

aws iam put-user-policy \
  --user-name $WRITER_USER \
  --policy-name VenueScopeDynamoDBAccess \
  --policy-document file:///tmp/writer-policy.json
echo "  ✓ venuescope-writer policy updated"

# ──────────────────────────────────────────────────────────────────────────────
# 3. IAM Role for Lambda
# ──────────────────────────────────────────────────────────────────────────────

echo "[3/6] Creating Lambda IAM role..."

LAMBDA_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${LAMBDA_ROLE_NAME}"

if aws iam get-role --role-name $LAMBDA_ROLE_NAME >/dev/null 2>&1; then
  echo "  ✓ IAM role already exists"
else
  cat > /tmp/lambda-trust.json << 'TRUST'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "lambda.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
TRUST

  aws iam create-role \
    --role-name $LAMBDA_ROLE_NAME \
    --assume-role-policy-document file:///tmp/lambda-trust.json
  echo "  ✓ IAM role created"
fi

# Attach basic execution policy (CloudWatch Logs)
aws iam attach-role-policy \
  --role-name $LAMBDA_ROLE_NAME \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole 2>/dev/null || true

# Inline policy for DynamoDB + Cognito
cat > /tmp/lambda-policy.json << LAMBDAPOLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ],
      "Resource": [
        "arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/VenueScopeVenues",
        "arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/VenueScopeCameras"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "cognito-idp:AdminCreateUser",
        "cognito-idp:AdminUpdateUserAttributes",
        "cognito-idp:AdminSetUserPassword",
        "cognito-idp:AdminDisableUser",
        "cognito-idp:AdminEnableUser",
        "cognito-idp:ListUsers"
      ],
      "Resource": "arn:aws:cognito-idp:${REGION}:${ACCOUNT_ID}:userpool/${USER_POOL_ID}"
    }
  ]
}
LAMBDAPOLICY

aws iam put-role-policy \
  --role-name $LAMBDA_ROLE_NAME \
  --policy-name VenueScopeAdminLambdaPolicy \
  --policy-document file:///tmp/lambda-policy.json
echo "  ✓ Lambda IAM policy attached"

# Wait a moment for IAM to propagate
sleep 8

# ──────────────────────────────────────────────────────────────────────────────
# 4. Package and deploy Lambda
# ──────────────────────────────────────────────────────────────────────────────

echo "[4/6] Packaging Lambda function..."

mkdir -p /tmp/lambda-pkg

cat > /tmp/lambda-pkg/index.mjs << 'LAMBDACODE'
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminUpdateUserAttributesCommand,
  ListUsersCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  DynamoDBClient,
  PutItemCommand,
  ScanCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';

const REGION = process.env.REGION || 'us-east-2';
const USER_POOL_ID = process.env.USER_POOL_ID;
const VENUES_TABLE = 'VenueScopeVenues';

const cognito = new CognitoIdentityProviderClient({ region: REGION });
const ddb = new DynamoDBClient({ region: REGION });

const cors = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Admin-Key',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS,PATCH',
};

const ok  = (body)        => ({ statusCode: 200, headers: cors, body: JSON.stringify(body) });
const err = (status, msg) => ({ statusCode: status, headers: cors, body: JSON.stringify({ error: msg }) });

function ddbItemToVenue(item) {
  return {
    venueId:      item.venueId?.S ?? '',
    venueName:    item.venueName?.S ?? '',
    status:       item.status?.S ?? 'active',
    createdAt:    item.createdAt?.S ?? '',
    ownerEmail:   item.ownerEmail?.S ?? '',
    ownerName:    item.ownerName?.S ?? '',
    locationName: item.locationName?.S ?? 'Main',
    locationId:   item.locationId?.S ?? 'main',
    plan:         item.plan?.S ?? 'standard',
    userCount:    parseInt(item.userCount?.N ?? '1'),
    deviceCount:  parseInt(item.deviceCount?.N ?? '0'),
  };
}

async function listVenues() {
  const result = await ddb.send(new ScanCommand({ TableName: VENUES_TABLE }));
  const items = (result.Items ?? []).map(ddbItemToVenue);
  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return ok({ items });
}

async function createVenue(body) {
  const { venueName, venueId, locationName = 'Main', locationId = 'main', ownerEmail, ownerName, tempPassword } = body;
  if (!venueName || !venueId || !ownerEmail || !ownerName || !tempPassword)
    return err(400, 'Missing required fields: venueName, venueId, ownerEmail, ownerName, tempPassword');
  if (!USER_POOL_ID) return err(500, 'USER_POOL_ID environment variable not set');

  await cognito.send(new AdminCreateUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: ownerEmail,
    TemporaryPassword: tempPassword,
    UserAttributes: [
      { Name: 'email',            Value: ownerEmail },
      { Name: 'name',             Value: ownerName },
      { Name: 'custom:venueId',   Value: venueId },
      { Name: 'custom:venueName', Value: venueName },
      { Name: 'custom:role',      Value: 'owner' },
      { Name: 'email_verified',   Value: 'true' },
    ],
    DesiredDeliveryMediums: ['EMAIL'],
  }));

  await ddb.send(new PutItemCommand({
    TableName: VENUES_TABLE,
    Item: {
      venueId:      { S: venueId },
      venueName:    { S: venueName },
      locationName: { S: locationName },
      locationId:   { S: locationId },
      ownerEmail:   { S: ownerEmail },
      ownerName:    { S: ownerName },
      status:       { S: 'active' },
      createdAt:    { S: new Date().toISOString() },
      plan:         { S: 'standard' },
      userCount:    { N: '1' },
      deviceCount:  { N: '0' },
    },
    ConditionExpression: 'attribute_not_exists(venueId)',
  }));

  return ok({ success: true, venueId, ownerEmail });
}

async function listUsers() {
  if (!USER_POOL_ID) return err(500, 'USER_POOL_ID not set');
  const users = [];
  let paginationToken;
  do {
    const result = await cognito.send(new ListUsersCommand({
      UserPoolId: USER_POOL_ID, Limit: 60, PaginationToken: paginationToken,
    }));
    for (const u of result.Users ?? []) {
      const attr = (name) => u.Attributes?.find(a => a.Name === name)?.Value ?? '';
      users.push({
        userId: u.Username ?? '', email: attr('email'), name: attr('name'),
        venueId: attr('custom:venueId'), venueName: attr('custom:venueName'),
        role: attr('custom:role') || 'staff', status: u.Enabled ? 'active' : 'disabled',
        createdAt: u.UserCreateDate?.toISOString() ?? '',
        lastLoginAt: u.UserLastModifiedDate?.toISOString(),
        emailVerified: attr('email_verified') === 'true',
      });
    }
    paginationToken = result.PaginationToken;
  } while (paginationToken);
  return ok({ items: users });
}

async function createUser(body) {
  const { email, name, venueId, venueName, role = 'staff', tempPassword } = body;
  if (!email || !name || !venueId || !tempPassword)
    return err(400, 'Missing required fields: email, name, venueId, tempPassword');
  if (!USER_POOL_ID) return err(500, 'USER_POOL_ID not set');
  await cognito.send(new AdminCreateUserCommand({
    UserPoolId: USER_POOL_ID, Username: email, TemporaryPassword: tempPassword,
    UserAttributes: [
      { Name: 'email',            Value: email },
      { Name: 'name',             Value: name },
      { Name: 'custom:venueId',   Value: venueId },
      { Name: 'custom:venueName', Value: venueName ?? '' },
      { Name: 'custom:role',      Value: role },
      { Name: 'email_verified',   Value: 'true' },
    ],
    DesiredDeliveryMediums: ['EMAIL'],
  }));
  return ok({ success: true });
}

async function updateVenueStatus(venueId, status) {
  await ddb.send(new UpdateItemCommand({
    TableName: VENUES_TABLE,
    Key: { venueId: { S: venueId } },
    UpdateExpression: 'SET #s = :s',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':s': { S: status } },
  }));
  return ok({ success: true });
}

export const handler = async (event) => {
  const method  = event.requestContext?.http?.method ?? event.httpMethod ?? 'GET';
  const rawPath = event.requestContext?.http?.path   ?? event.path       ?? '/';
  if (method === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  try {
    if (method === 'GET'  && rawPath === '/admin/venues') return await listVenues();
    if (method === 'POST' && rawPath === '/admin/venues') return await createVenue(JSON.parse(event.body ?? '{}'));
    const statusMatch = rawPath.match(/^\/admin\/venues\/([^/]+)\/status$/);
    if (method === 'PATCH' && statusMatch)
      return await updateVenueStatus(statusMatch[1], JSON.parse(event.body ?? '{}').status);
    if (method === 'GET'  && rawPath === '/admin/users') return await listUsers();
    if (method === 'POST' && rawPath === '/admin/users') return await createUser(JSON.parse(event.body ?? '{}'));
    return err(404, `No route: ${method} ${rawPath}`);
  } catch (e) {
    console.error('Admin API error:', e);
    if (e.name === 'UsernameExistsException')      return err(409, 'A user with that email already exists.');
    if (e.name === 'ConditionalCheckFailedException') return err(409, 'A venue with that ID already exists.');
    return err(500, e.message ?? 'Internal error');
  }
};
LAMBDACODE

cd /tmp/lambda-pkg && zip -q lambda.zip index.mjs && cd -
echo "  ✓ Lambda package ready"

# Deploy Lambda (create or update)
if aws lambda get-function --function-name $LAMBDA_NAME --region $REGION >/dev/null 2>&1; then
  echo "  Updating existing Lambda function..."
  aws lambda update-function-code \
    --function-name $LAMBDA_NAME \
    --zip-file fileb:///tmp/lambda-pkg/lambda.zip \
    --region $REGION
  aws lambda update-function-configuration \
    --function-name $LAMBDA_NAME \
    --environment "Variables={USER_POOL_ID=${USER_POOL_ID},REGION=${REGION}}" \
    --region $REGION
  echo "  ✓ Lambda function updated"
else
  aws lambda create-function \
    --function-name $LAMBDA_NAME \
    --runtime nodejs20.x \
    --role $LAMBDA_ROLE_ARN \
    --handler index.handler \
    --zip-file fileb:///tmp/lambda-pkg/lambda.zip \
    --environment "Variables={USER_POOL_ID=${USER_POOL_ID},REGION=${REGION}}" \
    --timeout 30 \
    --memory-size 256 \
    --region $REGION
  echo "  ✓ Lambda function created"
fi

LAMBDA_ARN=$(aws lambda get-function --function-name $LAMBDA_NAME --region $REGION --query 'Configuration.FunctionArn' --output text)

# ──────────────────────────────────────────────────────────────────────────────
# 5. API Gateway HTTP API
# ──────────────────────────────────────────────────────────────────────────────

echo "[5/6] Setting up API Gateway..."

# Check if API already exists
EXISTING_API_ID=$(aws apigatewayv2 get-apis --region $REGION --query "Items[?Name=='${API_NAME}'].ApiId" --output text 2>/dev/null || echo "")

if [ -n "$EXISTING_API_ID" ] && [ "$EXISTING_API_ID" != "None" ]; then
  API_ID=$EXISTING_API_ID
  echo "  ✓ API Gateway already exists ($API_ID)"
else
  API_ID=$(aws apigatewayv2 create-api \
    --name $API_NAME \
    --protocol-type HTTP \
    --cors-configuration AllowOrigins='["*"]',AllowMethods='["GET","POST","PATCH","DELETE","OPTIONS"]',AllowHeaders='["Content-Type","Authorization","X-Admin-Key"]' \
    --region $REGION \
    --query ApiId --output text)
  echo "  ✓ API Gateway created ($API_ID)"
fi

# Create Lambda integration
INTEGRATION_ID=$(aws apigatewayv2 create-integration \
  --api-id $API_ID \
  --integration-type AWS_PROXY \
  --integration-uri $LAMBDA_ARN \
  --payload-format-version 2.0 \
  --region $REGION \
  --query IntegrationId --output text)
echo "  ✓ Lambda integration created ($INTEGRATION_ID)"

# Create catch-all route
aws apigatewayv2 create-route \
  --api-id $API_ID \
  --route-key "ANY /{proxy+}" \
  --target "integrations/$INTEGRATION_ID" \
  --region $REGION >/dev/null
echo "  ✓ Route created"

# Deploy to $default stage
aws apigatewayv2 create-stage \
  --api-id $API_ID \
  --stage-name '$default' \
  --auto-deploy \
  --region $REGION >/dev/null 2>/dev/null || true
echo "  ✓ Stage deployed"

# Allow API Gateway to invoke Lambda
aws lambda add-permission \
  --function-name $LAMBDA_NAME \
  --statement-id apigw-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT_ID}:${API_ID}/*/*/{proxy+}" \
  --region $REGION >/dev/null 2>/dev/null || true
echo "  ✓ Lambda permission granted to API Gateway"

# ──────────────────────────────────────────────────────────────────────────────
# 6. Done — print results
# ──────────────────────────────────────────────────────────────────────────────

API_URL="https://${API_ID}.execute-api.${REGION}.amazonaws.com"

echo ""
echo "======================================================"
echo "  Setup Complete!"
echo "======================================================"
echo ""
echo "  API Gateway URL:"
echo "  $API_URL"
echo ""
echo "  ➜ Add this to Amplify environment variables:"
echo "     VITE_ADMIN_API_URL = $API_URL"
echo ""
echo "  Test it:"
echo "  curl $API_URL/admin/venues"
echo ""
echo "======================================================"
