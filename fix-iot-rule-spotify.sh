#!/bin/bash

# Fix IoT Rule to Save Spotify Data to DynamoDB
# This script updates the PulseSensorDataRule to flatten spotify fields

set -e

REGION="us-east-2"
RULE_NAME="PulseSensorDataRule"
TABLE_NAME="SensorData"

echo "🔍 Checking current IoT Rule configuration..."

# Get current rule
if ! aws iot get-topic-rule --rule-name "$RULE_NAME" --region "$REGION" > /tmp/current-rule.json 2>/dev/null; then
    echo "❌ Error: Could not retrieve IoT Rule '$RULE_NAME'"
    echo "   Make sure AWS CLI is configured and you have permissions."
    exit 1
fi

# Extract current SQL
CURRENT_SQL=$(jq -r '.rule.sql' /tmp/current-rule.json)
echo "📋 Current SQL:"
echo "   $CURRENT_SQL"
echo ""

# Check if it already has currentSong mapping
if echo "$CURRENT_SQL" | grep -q "currentSong"; then
    echo "✅ Rule already has currentSong mapping!"
    echo "   No update needed."
    exit 0
fi

echo "⚠️  Rule does NOT have Spotify field mappings."
echo ""

# Get IAM role ARN from current rule
ROLE_ARN=$(jq -r '.rule.actions[0].dynamoDBv2.roleArn' /tmp/current-rule.json)

if [ "$ROLE_ARN" = "null" ] || [ -z "$ROLE_ARN" ]; then
    echo "❌ Error: Could not find DynamoDB action role ARN in current rule"
    exit 1
fi

echo "📝 Creating updated rule configuration..."

# Create updated rule payload
cat > /tmp/updated-rule.json <<EOF
{
  "sql": "SELECT deviceId, venueId, timestamp, sensors, occupancy, spotify.current_song AS currentSong, spotify.artist AS artist, spotify.album_art AS albumArt FROM 'pulse/sensors/#'",
  "description": "Save Pulse sensor data to DynamoDB with flattened Spotify fields",
  "actions": [
    {
      "dynamoDBv2": {
        "roleArn": "$ROLE_ARN",
        "putItem": {
          "tableName": "$TABLE_NAME"
        }
      }
    }
  ],
  "ruleDisabled": false,
  "awsIotSqlVersion": "2016-03-23"
}
EOF

echo "✅ Updated configuration created"
echo ""
echo "📊 New SQL statement:"
echo "   SELECT deviceId, venueId, timestamp, sensors, occupancy,"
echo "          spotify.current_song AS currentSong,"
echo "          spotify.artist AS artist,"
echo "          spotify.album_art AS albumArt"
echo "   FROM 'pulse/sensors/#'"
echo ""

# Ask for confirmation
read -p "🚀 Update the IoT Rule now? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Update cancelled."
    echo "   Configuration saved to: /tmp/updated-rule.json"
    exit 0
fi

echo "🔄 Updating IoT Rule..."

if aws iot replace-topic-rule \
    --rule-name "$RULE_NAME" \
    --topic-rule-payload file:///tmp/updated-rule.json \
    --region "$REGION"; then
    echo "✅ IoT Rule updated successfully!"
else
    echo "❌ Error: Failed to update IoT Rule"
    echo "   Configuration saved to: /tmp/updated-rule.json"
    exit 1
fi

echo ""
echo "🎉 SUCCESS! The IoT Rule has been updated."
echo ""
echo "📋 Next Steps:"
echo "   1. Wait 5-10 seconds for new sensor data to arrive"
echo "   2. Check DynamoDB for currentSong field:"
echo "      aws dynamodb scan --table-name SensorData --limit 1 --region $REGION | jq '.Items[0]'"
echo "   3. Check your dashboard - songs should appear in 'Now Playing' widget"
echo ""
echo "⏱️  Note: Only NEW data (after this update) will have spotify fields."
echo "    Old DynamoDB items are unchanged."
