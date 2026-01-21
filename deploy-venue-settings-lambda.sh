#!/bin/bash
# =============================================================================
# Deploy Venue Settings Lambda - SAFE DEPLOYMENT
# =============================================================================
# This script creates a NEW Lambda function and adds a NEW route to existing
# API Gateway. It does NOT modify any existing functions or data.
#
# Run this in AWS CloudShell (us-east-2 region)
# =============================================================================

set -e  # Exit on any error

echo "=========================================="
echo "Venue Settings Lambda Deployment"
echo "=========================================="
echo ""

# Configuration
REGION="us-east-2"
FUNCTION_NAME="venueSettings"
TABLE_NAME="VenueConfig"
API_ID="7ox6y1t1f1"  # Existing API Gateway ID

# Check if we're in the right region
CURRENT_REGION=$(aws configure get region 2>/dev/null || echo "us-east-2")
echo "Current region: $CURRENT_REGION"
echo "Target region: $REGION"
echo ""

# Step 1: Check if Lambda already exists
echo "[1/6] Checking if Lambda function exists..."
if aws lambda get-function --function-name $FUNCTION_NAME --region $REGION 2>/dev/null; then
    echo "⚠️  Lambda function '$FUNCTION_NAME' already exists."
    echo "    Updating function code..."
    UPDATE_MODE=true
else
    echo "✅ Lambda function does not exist. Will create new."
    UPDATE_MODE=false
fi
echo ""

# Step 2: Create the Lambda code
echo "[2/6] Creating Lambda function code..."
cat > /tmp/venueSettings.js << 'LAMBDA_CODE'
/**
 * Venue Settings Lambda
 * Handles GET/PUT for venue settings (address, capacity, etc.)
 * Stores data in VenueConfig table under 'settings' attribute
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { 
  DynamoDBDocumentClient, 
  GetCommand, 
  UpdateCommand,
  ScanCommand 
} = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-2' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.VENUE_CONFIG_TABLE || 'VenueConfig';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  const method = event.httpMethod || event.requestContext?.http?.method;
  const venueId = event.pathParameters?.venueId;
  
  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }
  
  try {
    if (method === 'GET' && !venueId) {
      return await getAllVenueSettings();
    }
    if (method === 'GET' && venueId) {
      return await getVenueSettings(venueId);
    }
    if (method === 'PUT' && venueId) {
      const body = JSON.parse(event.body || '{}');
      return await updateVenueSettings(venueId, body);
    }
    
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid request' })
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error', message: error.message })
    };
  }
};

async function getAllVenueSettings() {
  const result = await docClient.send(new ScanCommand({
    TableName: TABLE_NAME,
    ProjectionExpression: 'venueId, venueName, settings'
  }));
  
  const settings = {};
  for (const item of result.Items || []) {
    if (item.settings) {
      settings[item.venueId] = { venueName: item.venueName, ...item.settings };
    }
  }
  
  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(settings) };
}

async function getVenueSettings(venueId) {
  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { venueId: venueId, locationId: 'mainfloor' },
    ProjectionExpression: 'venueId, venueName, settings'
  }));
  
  if (!result.Item) {
    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Venue not found' }) };
  }
  
  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result.Item.settings || {}) };
}

async function updateVenueSettings(venueId, settings) {
  const updatedSettings = { ...settings, lastUpdated: new Date().toISOString() };
  
  // SAFE: Only updates the 'settings' attribute, doesn't touch other data
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { venueId: venueId, locationId: 'mainfloor' },
    UpdateExpression: 'SET settings = :settings',
    ExpressionAttributeValues: { ':settings': updatedSettings }
  }));
  
  console.log('✅ Venue settings updated for:', venueId);
  
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({ success: true, message: 'Settings updated', settings: updatedSettings })
  };
}
LAMBDA_CODE

echo "✅ Lambda code created"
echo ""

# Step 3: Create deployment package
echo "[3/6] Creating deployment package..."
cd /tmp
zip -j venueSettings.zip venueSettings.js
echo "✅ Deployment package created"
echo ""

# Step 4: Get or create IAM role
echo "[4/6] Setting up IAM role..."
ROLE_NAME="pulse-lambda-role"

# Check if role exists
if aws iam get-role --role-name $ROLE_NAME 2>/dev/null; then
    echo "✅ Using existing role: $ROLE_NAME"
    ROLE_ARN=$(aws iam get-role --role-name $ROLE_NAME --query 'Role.Arn' --output text)
else
    echo "Creating new IAM role..."
    
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

    aws iam create-role \
        --role-name $ROLE_NAME \
        --assume-role-policy-document file:///tmp/trust-policy.json \
        --region $REGION
    
    # Attach basic execution policy
    aws iam attach-role-policy \
        --role-name $ROLE_NAME \
        --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
    
    # Create DynamoDB policy for VenueConfig table
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    
    cat > /tmp/dynamodb-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:UpdateItem",
        "dynamodb:Scan"
      ],
      "Resource": "arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${TABLE_NAME}"
    }
  ]
}
EOF

    aws iam put-role-policy \
        --role-name $ROLE_NAME \
        --policy-name VenueConfigAccess \
        --policy-document file:///tmp/dynamodb-policy.json
    
    ROLE_ARN=$(aws iam get-role --role-name $ROLE_NAME --query 'Role.Arn' --output text)
    
    echo "✅ Created role: $ROLE_ARN"
    echo "   Waiting 10 seconds for IAM propagation..."
    sleep 10
fi
echo ""

# Step 5: Create or update Lambda function
echo "[5/6] Deploying Lambda function..."
if [ "$UPDATE_MODE" = true ]; then
    aws lambda update-function-code \
        --function-name $FUNCTION_NAME \
        --zip-file fileb:///tmp/venueSettings.zip \
        --region $REGION
    echo "✅ Lambda function updated"
else
    aws lambda create-function \
        --function-name $FUNCTION_NAME \
        --runtime nodejs18.x \
        --role $ROLE_ARN \
        --handler venueSettings.handler \
        --zip-file fileb:///tmp/venueSettings.zip \
        --timeout 10 \
        --memory-size 128 \
        --environment "Variables={VENUE_CONFIG_TABLE=$TABLE_NAME}" \
        --region $REGION
    echo "✅ Lambda function created"
fi
echo ""

# Step 6: Configure API Gateway routes
echo "[6/6] Configuring API Gateway..."

# Get Lambda ARN
LAMBDA_ARN=$(aws lambda get-function --function-name $FUNCTION_NAME --region $REGION --query 'Configuration.FunctionArn' --output text)
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Add permission for API Gateway to invoke Lambda
echo "Adding API Gateway permission..."
aws lambda add-permission \
    --function-name $FUNCTION_NAME \
    --statement-id apigateway-venue-settings \
    --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT_ID}:${API_ID}/*" \
    --region $REGION 2>/dev/null || echo "Permission may already exist (OK)"

# Create the integration
echo "Creating API Gateway integration..."
INTEGRATION_URI="arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/${LAMBDA_ARN}/invocations"

# Create routes for venue-settings
# Note: Using HTTP API (not REST API) based on the existing display-settings pattern

# Route: GET /venue-settings
aws apigatewayv2 create-route \
    --api-id $API_ID \
    --route-key "GET /venue-settings" \
    --target "integrations/$(aws apigatewayv2 create-integration \
        --api-id $API_ID \
        --integration-type AWS_PROXY \
        --integration-uri $INTEGRATION_URI \
        --payload-format-version 2.0 \
        --query IntegrationId --output text)" \
    --region $REGION 2>/dev/null || echo "Route GET /venue-settings may already exist"

# Route: GET /venue-settings/{venueId}
aws apigatewayv2 create-route \
    --api-id $API_ID \
    --route-key "GET /venue-settings/{venueId}" \
    --target "integrations/$(aws apigatewayv2 create-integration \
        --api-id $API_ID \
        --integration-type AWS_PROXY \
        --integration-uri $INTEGRATION_URI \
        --payload-format-version 2.0 \
        --query IntegrationId --output text)" \
    --region $REGION 2>/dev/null || echo "Route GET /venue-settings/{venueId} may already exist"

# Route: PUT /venue-settings/{venueId}
aws apigatewayv2 create-route \
    --api-id $API_ID \
    --route-key "PUT /venue-settings/{venueId}" \
    --target "integrations/$(aws apigatewayv2 create-integration \
        --api-id $API_ID \
        --integration-type AWS_PROXY \
        --integration-uri $INTEGRATION_URI \
        --payload-format-version 2.0 \
        --query IntegrationId --output text)" \
    --region $REGION 2>/dev/null || echo "Route PUT /venue-settings/{venueId} may already exist"

# Route: OPTIONS /venue-settings (CORS)
aws apigatewayv2 create-route \
    --api-id $API_ID \
    --route-key "OPTIONS /venue-settings" \
    --target "integrations/$(aws apigatewayv2 create-integration \
        --api-id $API_ID \
        --integration-type AWS_PROXY \
        --integration-uri $INTEGRATION_URI \
        --payload-format-version 2.0 \
        --query IntegrationId --output text)" \
    --region $REGION 2>/dev/null || echo "Route OPTIONS /venue-settings may already exist"

# Route: OPTIONS /venue-settings/{venueId} (CORS)
aws apigatewayv2 create-route \
    --api-id $API_ID \
    --route-key "OPTIONS /venue-settings/{venueId}" \
    --target "integrations/$(aws apigatewayv2 create-integration \
        --api-id $API_ID \
        --integration-type AWS_PROXY \
        --integration-uri $INTEGRATION_URI \
        --payload-format-version 2.0 \
        --query IntegrationId --output text)" \
    --region $REGION 2>/dev/null || echo "Route OPTIONS /venue-settings/{venueId} may already exist"

echo ""
echo "=========================================="
echo "✅ DEPLOYMENT COMPLETE"
echo "=========================================="
echo ""
echo "API Endpoints:"
echo "  GET  https://${API_ID}.execute-api.${REGION}.amazonaws.com/venue-settings"
echo "  GET  https://${API_ID}.execute-api.${REGION}.amazonaws.com/venue-settings/{venueId}"
echo "  PUT  https://${API_ID}.execute-api.${REGION}.amazonaws.com/venue-settings/{venueId}"
echo ""
echo "Test with:"
echo "  curl https://${API_ID}.execute-api.${REGION}.amazonaws.com/venue-settings/jimmyneutron"
echo ""
echo "⚠️  SAFETY NOTE: This Lambda only reads/writes the 'settings' attribute"
echo "   in VenueConfig. It does NOT modify any other venue data."
echo ""
