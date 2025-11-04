# Troubleshooting: Simulated Data Issue

## Problem
When logging into the app on AWS, simulated/mock data is displayed instead of real sensor data.

## Root Cause
The application has fallback logic that returns simulated data when real data sources fail:
1. **API calls fail** → Falls back to mock data
2. **IoT Core connection fails** → Falls back to polling API
3. **Polling API fails** → Falls back to mock data

## Diagnostic Steps

### 1. Check Browser Console
Open the browser console (F12) and look for these messages:

#### If IoT is working (GOOD):
```
✅ Connected to AWS IoT Core
📡 Subscribed to topic: venue/fergs-stpete/main-floor
```

#### If IoT fails (BAD):
```
❌ Failed to get VenueConfig from DynamoDB
⚠️ AWS IoT unavailable, using polling fallback
```

#### If API fails (BAD):
```
❌ Live data API fetch failed
⚠️ Returning mock data as fallback
```

### 2. Verify VenueConfig in DynamoDB

The IoT service requires a `VenueConfig` entry in DynamoDB with:
- Table: `VenueConfig`
- Partition Key: `venueId` (e.g., "fergs-stpete")
- Sort Key: `locationId` (e.g., "default" or "main-floor")
- Required Field: `mqttTopic` (e.g., "venue/fergs-stpete/main-floor")

**Check if the table exists:**
```bash
aws dynamodb describe-table --table-name VenueConfig --region us-east-2
```

**Check if venue data exists:**
```bash
aws dynamodb get-item \
  --table-name VenueConfig \
  --key '{"venueId":{"S":"fergs-stpete"},"locationId":{"S":"default"}}' \
  --region us-east-2
```

**Create VenueConfig if missing:**
```bash
# First create the table
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

# Then add the venue config
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

### 3. Verify Cognito User Attributes

The app requires users to have `custom:venueId` attribute set:

```bash
# Check user attributes
aws cognito-idp admin-get-user \
  --user-pool-id us-east-2_I6EBJm3te \
  --username YOUR_EMAIL \
  --region us-east-2
```

**Add venueId if missing:**
```bash
aws cognito-idp admin-update-user-attributes \
  --user-pool-id us-east-2_I6EBJm3te \
  --username YOUR_EMAIL \
  --user-attributes Name=custom:venueId,Value=fergs-stpete \
  --region us-east-2
```

### 4. Verify API Endpoint

The app expects an API at `https://api.advizia.ai` with these endpoints:
- `GET /live/:venueId` - Returns current sensor data
- `GET /history/:venueId?days=X` - Returns historical data
- `GET /occupancy/:venueId/metrics` - Returns occupancy metrics

**Test the API:**
```bash
# Test live data endpoint
curl https://api.advizia.ai/live/fergs-stpete

# Test historical data
curl https://api.advizia.ai/history/fergs-stpete?days=7

# Test occupancy metrics
curl https://api.advizia.ai/occupancy/fergs-stpete/metrics
```

If these endpoints don't exist or return 404, the app will fall back to mock data.

### 5. Verify IoT Core MQTT Topic

Test MQTT connection manually:

```bash
# Install MQTT client
npm install -g mqtt

# Subscribe to the topic
mqtt subscribe \
  -h a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com \
  -p 443 \
  -t 'venue/fergs-stpete/main-floor' \
  --protocol wss
```

## Solutions

### Quick Fix: Deploy Real API
If the API endpoints don't exist, you need to deploy a backend that provides real sensor data.

### Temporary Fix: Use IoT Only
If you have IoT Core set up but no REST API, the app will use IoT for real-time data. Just ensure:
1. VenueConfig exists in DynamoDB
2. MQTT messages are being published to the topic
3. User has `custom:venueId` attribute

### Remove Mock Data Fallback
If you want the app to fail visibly instead of showing mock data:

1. Set environment variable:
```bash
VITE_DISABLE_MOCK_DATA=true
```

2. Or modify `src/services/api.service.ts` to throw errors instead of returning mock data:
```typescript
// Remove these lines:
return this.getMockLiveData();
return this.getMockData(venueId, range);
return this.getMockOccupancyMetrics();

// Replace with:
throw error;
```

## Expected Data Flow

### Ideal Flow (Real-time IoT):
1. User logs in → Gets venueId from Cognito
2. App queries DynamoDB VenueConfig → Gets MQTT topic
3. App connects to AWS IoT Core → Subscribes to topic
4. Real sensor data flows via MQTT → Displayed in UI
5. Connection Status shows: "AWS IoT Live"

### Fallback Flow (Polling):
1. IoT connection fails → Falls back to HTTP polling
2. App polls API every 15 seconds
3. Connection Status shows: "Polling Mode"

### Current Issue (Mock Data):
1. IoT connection fails (no VenueConfig or MQTT topic)
2. Falls back to HTTP polling
3. API calls fail (404 or network error)
4. App returns simulated data
5. Connection Status shows: "Polling Mode"
6. Warning banner shows: "⚠️ Using Simulated Data"

## Next Steps

1. **Check console logs** to see which component is failing
2. **Verify DynamoDB VenueConfig** exists with correct MQTT topic
3. **Verify API endpoints** are deployed and responding
4. **Test MQTT** messages are being published to IoT Core
5. **Check Cognito** user has `custom:venueId` attribute

## Contact
If issues persist, check the AWS CloudWatch logs for the Lambda functions that handle API requests and IoT message routing.
