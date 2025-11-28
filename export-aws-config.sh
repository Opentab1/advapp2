#!/bin/bash

# Export Complete AWS Configuration for Pulse Dashboard
# This script exports all AWS resources to help audit the setup

echo "🔍 Exporting AWS Configuration for Pulse Dashboard..."
echo "======================================================="
echo ""

REGION="us-east-2"
OUTPUT_FILE="aws-config-export.json"

echo "{" > $OUTPUT_FILE

# ============================================
# 1. IOT RULE CONFIGURATION
# ============================================
echo "📡 Exporting IoT Rule: PulseSensorDataRule..."
echo '  "iot_rule": ' >> $OUTPUT_FILE
aws iot get-topic-rule --rule-name PulseSensorDataRule --region $REGION >> $OUTPUT_FILE 2>&1
echo "," >> $OUTPUT_FILE

# ============================================
# 2. APPSYNC API CONFIGURATION
# ============================================
echo "🔗 Exporting AppSync API configuration..."

# First, list all APIs to get the API ID
echo '  "appsync_apis": ' >> $OUTPUT_FILE
aws appsync list-graphql-apis --region $REGION >> $OUTPUT_FILE 2>&1
echo "," >> $OUTPUT_FILE

# Get the first API ID (assuming you have one main API)
API_ID=$(aws appsync list-graphql-apis --region $REGION --query 'graphqlApis[0].apiId' --output text 2>/dev/null)

if [ ! -z "$API_ID" ] && [ "$API_ID" != "None" ]; then
  echo "  Found AppSync API ID: $API_ID"
  
  # Get schema
  echo '  "appsync_schema": ' >> $OUTPUT_FILE
  aws appsync get-introspection-schema --api-id $API_ID --format SDL --region $REGION 2>/dev/null | jq -Rs . >> $OUTPUT_FILE 2>&1
  echo "," >> $OUTPUT_FILE
  
  # Get data sources
  echo '  "appsync_data_sources": ' >> $OUTPUT_FILE
  aws appsync list-data-sources --api-id $API_ID --region $REGION >> $OUTPUT_FILE 2>&1
  echo "," >> $OUTPUT_FILE
  
  # Get resolvers
  echo '  "appsync_resolvers": ' >> $OUTPUT_FILE
  aws appsync list-resolvers --api-id $API_ID --type-name Mutation --region $REGION >> $OUTPUT_FILE 2>&1
  echo "," >> $OUTPUT_FILE
else
  echo "  No AppSync API found"
  echo '  "appsync_schema": null,' >> $OUTPUT_FILE
  echo '  "appsync_data_sources": null,' >> $OUTPUT_FILE
  echo '  "appsync_resolvers": null,' >> $OUTPUT_FILE
fi

# ============================================
# 3. LAMBDA FUNCTIONS
# ============================================
echo "⚡ Exporting Lambda functions..."

LAMBDA_FUNCTIONS=("createVenue" "createUser" "provisionIoTDevice" "generateRPiConfig" "resetUserPassword" "updateUserPermissions" "archiveDevice" "listVenueDevices")

echo '  "lambda_functions": {' >> $OUTPUT_FILE

for i in "${!LAMBDA_FUNCTIONS[@]}"; do
  FUNC_NAME="${LAMBDA_FUNCTIONS[$i]}"
  echo "  Exporting Lambda: $FUNC_NAME"
  
  echo "    \"$FUNC_NAME\": {" >> $OUTPUT_FILE
  
  # Get function configuration
  echo '      "configuration": ' >> $OUTPUT_FILE
  aws lambda get-function-configuration --function-name $FUNC_NAME --region $REGION >> $OUTPUT_FILE 2>&1
  echo "," >> $OUTPUT_FILE
  
  # Get function code (just metadata, not the actual code)
  echo '      "code_location": ' >> $OUTPUT_FILE
  aws lambda get-function --function-name $FUNC_NAME --region $REGION --query 'Code.Location' >> $OUTPUT_FILE 2>&1
  
  # Add comma if not last item
  if [ $i -lt $((${#LAMBDA_FUNCTIONS[@]} - 1)) ]; then
    echo "    }," >> $OUTPUT_FILE
  else
    echo "    }" >> $OUTPUT_FILE
  fi
done

echo '  },' >> $OUTPUT_FILE

# ============================================
# 4. COGNITO USER POOL
# ============================================
echo "👤 Exporting Cognito User Pool configuration..."

USER_POOL_ID="us-east-2_I6EBJm3te"

echo '  "cognito_user_pool": ' >> $OUTPUT_FILE
aws cognito-idp describe-user-pool --user-pool-id $USER_POOL_ID --region $REGION >> $OUTPUT_FILE 2>&1
echo "," >> $OUTPUT_FILE

echo '  "cognito_user_pool_clients": ' >> $OUTPUT_FILE
aws cognito-idp list-user-pool-clients --user-pool-id $USER_POOL_ID --region $REGION >> $OUTPUT_FILE 2>&1
echo "," >> $OUTPUT_FILE

# ============================================
# 5. DYNAMODB TABLES
# ============================================
echo "🗄️  Exporting DynamoDB tables..."

TABLES=("SensorData" "VenueConfig" "OccupancyMetrics")

echo '  "dynamodb_tables": {' >> $OUTPUT_FILE

for i in "${!TABLES[@]}"; do
  TABLE_NAME="${TABLES[$i]}"
  echo "  Exporting table: $TABLE_NAME"
  
  echo "    \"$TABLE_NAME\": " >> $OUTPUT_FILE
  aws dynamodb describe-table --table-name $TABLE_NAME --region $REGION >> $OUTPUT_FILE 2>&1
  
  # Add comma if not last item
  if [ $i -lt $((${#TABLES[@]} - 1)) ]; then
    echo "," >> $OUTPUT_FILE
  fi
done

echo '  },' >> $OUTPUT_FILE

# ============================================
# 6. SES CONFIGURATION (check both regions)
# ============================================
echo "📧 Exporting SES configuration..."

echo '  "ses_verified_identities_us_east_1": ' >> $OUTPUT_FILE
aws ses list-identities --region us-east-1 >> $OUTPUT_FILE 2>&1
echo "," >> $OUTPUT_FILE

echo '  "ses_verified_identities_us_east_2": ' >> $OUTPUT_FILE
aws ses list-identities --region us-east-2 >> $OUTPUT_FILE 2>&1
echo "," >> $OUTPUT_FILE

echo '  "ses_account_status_us_east_1": ' >> $OUTPUT_FILE
aws sesv2 get-account --region us-east-1 >> $OUTPUT_FILE 2>&1
echo "," >> $OUTPUT_FILE

echo '  "ses_account_status_us_east_2": ' >> $OUTPUT_FILE
aws sesv2 get-account --region us-east-2 >> $OUTPUT_FILE 2>&1

# ============================================
# 7. IOT THINGS (devices)
# ============================================
echo "," >> $OUTPUT_FILE
echo "📱 Exporting IoT Things..."

echo '  "iot_things": ' >> $OUTPUT_FILE
aws iot list-things --region $REGION >> $OUTPUT_FILE 2>&1

# Close JSON
echo "}" >> $OUTPUT_FILE

echo ""
echo "✅ Export complete!"
echo "📄 Configuration saved to: $OUTPUT_FILE"
echo ""
echo "To view nicely formatted:"
echo "  cat $OUTPUT_FILE | jq ."
echo ""
echo "To share with AI assistant:"
echo "  cat $OUTPUT_FILE"
