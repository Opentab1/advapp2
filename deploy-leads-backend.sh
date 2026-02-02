#!/bin/bash
# =============================================================================
# Deploy Leads Backend - Twilio SMS Lead Capture
# 
# Run this script in AWS CloudShell
# 
# This creates:
# 1. DynamoDB table for leads (VenueLeads)
# 2. Lambda function to handle incoming SMS
# 3. API Gateway endpoint for Twilio webhook
# 4. Necessary IAM permissions
# =============================================================================

set -e

REGION="us-east-2"
TABLE_NAME="VenueLeads"
FUNCTION_NAME="handleIncomingSms"
API_NAME="LeadsWebhookAPI"

# Twilio credentials - REPLACE THESE or set as environment variables
TWILIO_ACCOUNT_SID="${TWILIO_ACCOUNT_SID:-ACb5b282836c0331ef353861521d9ff444}"
TWILIO_AUTH_TOKEN="${TWILIO_AUTH_TOKEN:-917680212060feb8dd3988a6e7387556}"
TWILIO_PHONE_NUMBER="${TWILIO_PHONE_NUMBER:-+18558384995}"

echo "========================================"
echo "Deploying Leads Backend"
echo "========================================"
echo "Region: $REGION"
echo "Table: $TABLE_NAME"
echo "Function: $FUNCTION_NAME"
echo ""

# -----------------------------------------------------------------------------
# Step 1: Create DynamoDB Table
# -----------------------------------------------------------------------------
echo "Step 1: Creating DynamoDB table..."

# Check if table exists
if aws dynamodb describe-table --table-name $TABLE_NAME --region $REGION 2>/dev/null; then
  echo "  Table $TABLE_NAME already exists"
else
  aws dynamodb create-table \
    --table-name $TABLE_NAME \
    --attribute-definitions \
      AttributeName=venueId,AttributeType=S \
      AttributeName=phoneNumber,AttributeType=S \
    --key-schema \
      AttributeName=venueId,KeyType=HASH \
      AttributeName=phoneNumber,KeyType=RANGE \
    --billing-mode PAY_PER_REQUEST \
    --region $REGION
  
  echo "  Waiting for table to be active..."
  aws dynamodb wait table-exists --table-name $TABLE_NAME --region $REGION
  echo "  Table created successfully"
fi

# -----------------------------------------------------------------------------
# Step 2: Create IAM Role for Lambda
# -----------------------------------------------------------------------------
echo ""
echo "Step 2: Creating IAM role..."

ROLE_NAME="LeadsLambdaRole"

# Create trust policy
cat > /tmp/trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Check if role exists
if aws iam get-role --role-name $ROLE_NAME 2>/dev/null; then
  echo "  Role $ROLE_NAME already exists"
else
  aws iam create-role \
    --role-name $ROLE_NAME \
    --assume-role-policy-document file:///tmp/trust-policy.json
  echo "  Role created"
fi

# Get the role ARN
ROLE_ARN=$(aws iam get-role --role-name $ROLE_NAME --query 'Role.Arn' --output text)
echo "  Role ARN: $ROLE_ARN"

# Attach policies
echo "  Attaching policies..."
aws iam attach-role-policy \
  --role-name $ROLE_NAME \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole 2>/dev/null || true

# Create DynamoDB policy
cat > /tmp/dynamodb-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:UpdateItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ],
      "Resource": "arn:aws:dynamodb:$REGION:*:table/$TABLE_NAME"
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name $ROLE_NAME \
  --policy-name LeadsDynamoDBAccess \
  --policy-document file:///tmp/dynamodb-policy.json

echo "  Policies attached"

# Wait for role to propagate
echo "  Waiting for role to propagate (10s)..."
sleep 10

# -----------------------------------------------------------------------------
# Step 3: Create Lambda Function
# -----------------------------------------------------------------------------
echo ""
echo "Step 3: Creating Lambda function..."

# Create the Lambda code
cat > /tmp/index.js << 'LAMBDACODE'
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const LEADS_TABLE = process.env.LEADS_TABLE_NAME || 'VenueLeads';
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

async function sendSms(to, body) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  
  const params = new URLSearchParams();
  params.append('To', to);
  params.append('From', TWILIO_PHONE_NUMBER);
  params.append('Body', body);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error('Twilio error:', error);
  }
  return response.ok;
}

function parseMessage(body) {
  const text = (body || '').trim().toUpperCase();
  
  if (['STOP', 'UNSUBSCRIBE', 'CANCEL', 'QUIT', 'END'].includes(text)) {
    return { action: 'optout' };
  }
  
  if (text.startsWith('JOIN')) {
    const parts = text.split(/\s+/);
    if (parts.length >= 2) {
      return {
        action: 'join',
        venueId: parts[1].toLowerCase(),
        source: parts[2] ? parts.slice(2).join('-').toLowerCase() : 'unknown',
      };
    }
  }
  
  return { action: 'unknown' };
}

async function storeLead(venueId, phoneNumber, source) {
  const now = new Date().toISOString();
  
  const existing = await docClient.send(new GetCommand({
    TableName: LEADS_TABLE,
    Key: { venueId, phoneNumber },
  }));
  
  if (existing.Item) {
    await docClient.send(new UpdateCommand({
      TableName: LEADS_TABLE,
      Key: { venueId, phoneNumber },
      UpdateExpression: 'SET lastSeenAt = :now, #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':now': now, ':status': 'active' },
    }));
    return { isNew: false };
  }
  
  await docClient.send(new PutCommand({
    TableName: LEADS_TABLE,
    Item: {
      venueId,
      phoneNumber,
      source,
      capturedAt: now,
      lastSeenAt: now,
      status: 'active',
      consentTimestamp: now,
    },
  }));
  
  return { isNew: true };
}

exports.handler = async (event) => {
  console.log('Received:', JSON.stringify(event, null, 2));
  
  try {
    let body = event.body;
    if (event.isBase64Encoded) {
      body = Buffer.from(body, 'base64').toString('utf-8');
    }
    
    const params = new URLSearchParams(body);
    const from = params.get('From');
    const messageBody = params.get('Body');
    
    console.log(`SMS from ${from}: "${messageBody}"`);
    
    if (!from || !messageBody) {
      return { statusCode: 400, headers: { 'Content-Type': 'text/xml' }, body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>' };
    }
    
    const parsed = parseMessage(messageBody);
    let replyMessage = '';
    
    if (parsed.action === 'join') {
      const result = await storeLead(parsed.venueId, from, parsed.source);
      replyMessage = result.isNew 
        ? "You're in! We'll text you about specials & events. Reply STOP anytime."
        : "Welcome back! You're already on our list.";
      console.log(`Lead ${result.isNew ? 'captured' : 'updated'}: ${from} for ${parsed.venueId}`);
    } else if (parsed.action === 'optout') {
      replyMessage = "You've been unsubscribed. You won't receive any more messages.";
      console.log(`Opt-out: ${from}`);
    } else {
      replyMessage = "Reply JOIN [venue] to subscribe, or STOP to unsubscribe.";
    }
    
    await sendSms(from, replyMessage);
    
    return { statusCode: 200, headers: { 'Content-Type': 'text/xml' }, body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>' };
  } catch (error) {
    console.error('Error:', error);
    return { statusCode: 500, headers: { 'Content-Type': 'text/xml' }, body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>' };
  }
};
LAMBDACODE

# Create zip file
cd /tmp
zip -j function.zip index.js

# Check if function exists
if aws lambda get-function --function-name $FUNCTION_NAME --region $REGION 2>/dev/null; then
  echo "  Updating existing function..."
  aws lambda update-function-code \
    --function-name $FUNCTION_NAME \
    --zip-file fileb:///tmp/function.zip \
    --region $REGION > /dev/null
  
  # Update environment variables
  aws lambda update-function-configuration \
    --function-name $FUNCTION_NAME \
    --environment "Variables={LEADS_TABLE_NAME=$TABLE_NAME,TWILIO_ACCOUNT_SID=$TWILIO_ACCOUNT_SID,TWILIO_AUTH_TOKEN=$TWILIO_AUTH_TOKEN,TWILIO_PHONE_NUMBER=$TWILIO_PHONE_NUMBER}" \
    --region $REGION > /dev/null
else
  echo "  Creating new function..."
  aws lambda create-function \
    --function-name $FUNCTION_NAME \
    --runtime nodejs18.x \
    --role $ROLE_ARN \
    --handler index.handler \
    --zip-file fileb:///tmp/function.zip \
    --timeout 30 \
    --memory-size 256 \
    --environment "Variables={LEADS_TABLE_NAME=$TABLE_NAME,TWILIO_ACCOUNT_SID=$TWILIO_ACCOUNT_SID,TWILIO_AUTH_TOKEN=$TWILIO_AUTH_TOKEN,TWILIO_PHONE_NUMBER=$TWILIO_PHONE_NUMBER}" \
    --region $REGION > /dev/null
fi

# Wait for function to be active
echo "  Waiting for function to be ready..."
aws lambda wait function-active --function-name $FUNCTION_NAME --region $REGION 2>/dev/null || sleep 5

FUNCTION_ARN=$(aws lambda get-function --function-name $FUNCTION_NAME --region $REGION --query 'Configuration.FunctionArn' --output text)
echo "  Function ARN: $FUNCTION_ARN"

# -----------------------------------------------------------------------------
# Step 4: Create API Gateway
# -----------------------------------------------------------------------------
echo ""
echo "Step 4: Creating API Gateway..."

# Check if API exists
API_ID=$(aws apigatewayv2 get-apis --region $REGION --query "Items[?Name=='$API_NAME'].ApiId" --output text)

if [ -n "$API_ID" ] && [ "$API_ID" != "None" ]; then
  echo "  API already exists: $API_ID"
else
  # Create HTTP API
  API_ID=$(aws apigatewayv2 create-api \
    --name $API_NAME \
    --protocol-type HTTP \
    --region $REGION \
    --query 'ApiId' \
    --output text)
  echo "  Created API: $API_ID"
fi

# Create integration
echo "  Creating Lambda integration..."
INTEGRATION_ID=$(aws apigatewayv2 create-integration \
  --api-id $API_ID \
  --integration-type AWS_PROXY \
  --integration-uri $FUNCTION_ARN \
  --payload-format-version 2.0 \
  --region $REGION \
  --query 'IntegrationId' \
  --output text 2>/dev/null || echo "")

if [ -z "$INTEGRATION_ID" ]; then
  # Get existing integration
  INTEGRATION_ID=$(aws apigatewayv2 get-integrations --api-id $API_ID --region $REGION --query 'Items[0].IntegrationId' --output text)
fi

echo "  Integration ID: $INTEGRATION_ID"

# Create route
echo "  Creating route..."
aws apigatewayv2 create-route \
  --api-id $API_ID \
  --route-key "POST /sms" \
  --target "integrations/$INTEGRATION_ID" \
  --region $REGION 2>/dev/null || echo "  Route already exists"

# Create default stage with auto-deploy
echo "  Creating stage..."
aws apigatewayv2 create-stage \
  --api-id $API_ID \
  --stage-name '$default' \
  --auto-deploy \
  --region $REGION 2>/dev/null || echo "  Stage already exists"

# Get the API endpoint
API_ENDPOINT=$(aws apigatewayv2 get-api --api-id $API_ID --region $REGION --query 'ApiEndpoint' --output text)
WEBHOOK_URL="${API_ENDPOINT}/sms"

# Add Lambda permission for API Gateway
echo "  Adding Lambda permission..."
aws lambda add-permission \
  --function-name $FUNCTION_NAME \
  --statement-id apigateway-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:$REGION:*:$API_ID/*" \
  --region $REGION 2>/dev/null || echo "  Permission already exists"

# -----------------------------------------------------------------------------
# Done!
# -----------------------------------------------------------------------------
echo ""
echo "========================================"
echo "DEPLOYMENT COMPLETE!"
echo "========================================"
echo ""
echo "Webhook URL (for Twilio):"
echo "$WEBHOOK_URL"
echo ""
echo "NEXT STEP: Configure Twilio to use this webhook"
echo ""
echo "1. Go to: https://console.twilio.com/us1/develop/phone-numbers/manage/incoming"
echo "2. Click on your phone number: +1 855 838 4995"
echo "3. Scroll to 'Messaging Configuration'"
echo "4. Under 'A message comes in', set:"
echo "   - Webhook URL: $WEBHOOK_URL"
echo "   - HTTP Method: POST"
echo "5. Click Save"
echo ""
echo "Then test by texting 'JOIN jimmyneutron table1' to +1 855 838 4995"
echo ""
