# Fix Checklist: Simulated Data Issue on AWS

## Immediate Actions Required

### ✅ Code Changes (Completed)
- [x] Added detailed console logging to track API calls
- [x] Added warning banner in UI when simulated data is used
- [x] Added environment variable to disable mock data fallback
- [x] Created troubleshooting documentation

### 🔧 AWS Configuration (Required)

#### 1. Create DynamoDB VenueConfig Table
```bash
aws dynamodb create-table \
  --table-name VenueConfig \
  --attribute-definitions \
    AttributeName=venueId,AttributeType=S \
    AttributeName=locationId,AttributeType=S \
  --key-schema \
    AttributeName=venueId,KeyType=HASH \
    AttributeName=locationId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-2
```

#### 2. Add Venue Configuration
```bash
aws dynamodb put-item \
  --table-name VenueConfig \
  --item '{
    "venueId": {"S": "fergs-stpete"},
    "locationId": {"S": "default"},
    "mqttTopic": {"S": "venue/fergs-stpete/main-floor"},
    "displayName": {"S": "Fergs Sports Bar"},
    "locationName": {"S": "Main Floor"}
  }' \
  --region us-east-2
```

#### 3. Update Cognito User Attributes
For each user, add the `custom:venueId` attribute:
```bash
aws cognito-idp admin-update-user-attributes \
  --user-pool-id us-east-2_I6EBJm3te \
  --username USER_EMAIL \
  --user-attributes Name=custom:venueId,Value=fergs-stpete \
  --region us-east-2
```

#### 4. Grant AppSync/Lambda Access to DynamoDB
Ensure your AppSync resolvers or Lambda functions have IAM permissions:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:Query"
      ],
      "Resource": "arn:aws:dynamodb:us-east-2:*:table/VenueConfig"
    }
  ]
}
```

#### 5. Deploy Backend API (Optional, for HTTP Fallback)
If you want to support HTTP polling as a fallback, deploy API endpoints at:
- `https://api.advizia.ai/live/:venueId`
- `https://api.advizia.ai/history/:venueId?days=X`
- `https://api.advizia.ai/occupancy/:venueId/metrics`

These can be Lambda functions behind API Gateway.

#### 6. Publish Test MQTT Message
Test that IoT Core is working:
```bash
# Using AWS CLI (requires certificate auth)
aws iot-data publish \
  --topic venue/fergs-stpete/main-floor \
  --payload '{"timestamp":"2025-11-04T12:00:00Z","sensors":{"sound_level":72,"light_level":350,"indoor_temperature":71,"outdoor_temperature":68,"humidity":45},"spotify":{"current_song":"Test Song","artist":"Test Artist"},"occupancy":{"current":45,"entries":120,"exits":75,"capacity":150}}' \
  --region us-east-2

# Or use the test HTML publisher
# Open test-mqtt-publisher.html in a browser
```

### 🧪 Verification Steps

1. **Check Console Logs:**
   - Open browser DevTools (F12) → Console
   - Login to the app
   - Look for log messages showing:
     - ✅ "Connected to AWS IoT Core"
     - ✅ "Subscribed to topic: venue/fergs-stpete/main-floor"
     - ✅ "Message received on topic"
   
2. **Verify No Mock Data Warning:**
   - After login, the yellow warning banner should NOT appear
   - Connection status should show "AWS IoT Live" (green)

3. **Test Data Flow:**
   - Publish a test MQTT message
   - Verify the dashboard updates with new sensor values
   - Check that timestamps are current (not from mock data)

4. **Test API Endpoints (if deployed):**
   ```bash
   curl https://api.advizia.ai/live/fergs-stpete
   ```

### 🚀 Deployment Steps

1. **Build the updated app:**
   ```bash
   npm run build
   ```

2. **Deploy to AWS Amplify:**
   ```bash
   git add -A
   git commit -m "Add logging and diagnostics for simulated data issue"
   git push
   ```

3. **Monitor Amplify deployment:**
   - Check AWS Amplify Console
   - Verify build succeeds
   - Test the deployed app

### 🐛 If Issues Persist

1. **Check CloudWatch Logs:**
   - AppSync logs (if using GraphQL)
   - Lambda function logs (if using REST API)
   - IoT Core logs

2. **Verify Network Security:**
   - CORS headers on API
   - IoT Core policies allow connections
   - Cognito tokens are valid

3. **Enable Strict Mode (no mock data):**
   Add to Amplify environment variables:
   ```
   VITE_DISABLE_MOCK_DATA=true
   ```
   This will make errors visible instead of silently falling back to mock data.

## Quick Test

**Test the full flow right now:**
1. Login at: https://your-app.amplifyapp.com
2. Open browser console (F12)
3. Look for these key messages:
   - "Loaded VenueConfig for fergs-stpete → topic: venue/fergs-stpete/main-floor"
   - "Connected to AWS IoT Core"
   - "Subscribed to topic: venue/fergs-stpete/main-floor"
4. If you see "Failed to get VenueConfig from DynamoDB" → DynamoDB table missing or empty
5. If you see "Live data API fetch failed" → API not responding

## Expected Result

After fixing:
- ✅ No yellow warning banner
- ✅ Connection status: "AWS IoT Live" (green)
- ✅ Console shows: "Connected to AWS IoT Core"
- ✅ Real sensor data updates in real-time
- ✅ Timestamps are current (not simulated)

## Contact

Review the `TROUBLESHOOTING_SIMULATED_DATA.md` document for detailed diagnostic steps.
