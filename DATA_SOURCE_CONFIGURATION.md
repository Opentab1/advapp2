# Data Source Configuration Guide

## Overview

The Pulse Dashboard application requires real data sources to function. **There is no mock/simulated data** - if data sources are not properly configured, the application will display clear error messages.

## Data Flow Architecture

The application uses a two-tier data strategy:

### Primary: AWS IoT Core (Real-time MQTT)
- **Best performance**: Sub-second latency
- **Requires**: VenueConfig in DynamoDB + active MQTT publisher
- **Status**: Shows "AWS IoT Live" (green) when connected

### Fallback: REST API (HTTP Polling)
- **Fallback performance**: 15-second polling interval
- **Requires**: API endpoints at `https://api.advizia.ai`
- **Status**: Shows "Polling Mode" (yellow) when IoT fails but API works

### Failure: Error Display
- **If both fail**: Application displays comprehensive error message
- **No mock data**: Users see exactly what's wrong and how to fix it

## Required AWS Configuration

### 1. DynamoDB VenueConfig Table

The IoT service queries DynamoDB to get the MQTT topic for each venue.

**Create the table:**
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

**Add venue configuration:**
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

**Verify:**
```bash
aws dynamodb get-item \
  --table-name VenueConfig \
  --key '{"venueId":{"S":"fergs-stpete"},"locationId":{"S":"default"}}' \
  --region us-east-2
```

### 2. Cognito User Attributes

Each user must have `custom:venueId` attribute set.

**Check user attributes:**
```bash
aws cognito-idp admin-get-user \
  --user-pool-id us-east-2_I6EBJm3te \
  --username USER_EMAIL \
  --region us-east-2
```

**Add venueId attribute:**
```bash
aws cognito-idp admin-update-user-attributes \
  --user-pool-id us-east-2_I6EBJm3te \
  --username USER_EMAIL \
  --user-attributes Name=custom:venueId,Value=fergs-stpete \
  --region us-east-2
```

### 3. AppSync/Lambda IAM Permissions

Your GraphQL resolvers need DynamoDB read access:

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

### 4. IoT Core Topic Setup

Ensure MQTT messages are being published to the topic specified in VenueConfig.

**Test IoT Core:**
```bash
# Subscribe to the topic
aws iot-data subscribe \
  --topic venue/fergs-stpete/main-floor \
  --region us-east-2

# Publish test message
aws iot-data publish \
  --topic venue/fergs-stpete/main-floor \
  --payload '{
    "timestamp": "2025-11-04T12:00:00Z",
    "sensors": {
      "sound_level": 72,
      "light_level": 350,
      "indoor_temperature": 71,
      "outdoor_temperature": 68,
      "humidity": 45
    },
    "spotify": {
      "current_song": "Test Song",
      "artist": "Test Artist"
    },
    "occupancy": {
      "current": 45,
      "entries": 120,
      "exits": 75,
      "capacity": 150
    }
  }' \
  --region us-east-2
```

### 5. REST API Endpoints (Optional - for HTTP fallback)

If you want HTTP polling as a fallback, deploy these endpoints:

**Required endpoints:**
- `GET /live/:venueId` - Returns current sensor data
- `GET /history/:venueId?days=X` - Returns historical data
- `GET /occupancy/:venueId/metrics` - Returns occupancy metrics

**Test the API:**
```bash
curl https://api.advizia.ai/live/fergs-stpete
curl https://api.advizia.ai/history/fergs-stpete?days=7
curl https://api.advizia.ai/occupancy/fergs-stpete/metrics
```

## Expected Message Format

### IoT Core MQTT Message
```json
{
  "timestamp": "2025-11-04T12:00:00Z",
  "sensors": {
    "sound_level": 72.5,
    "light_level": 350,
    "indoor_temperature": 71,
    "outdoor_temperature": 68,
    "humidity": 45
  },
  "spotify": {
    "current_song": "Song Title",
    "artist": "Artist Name",
    "album_art": "https://example.com/album.jpg"
  },
  "occupancy": {
    "current": 45,
    "entries": 120,
    "exits": 75,
    "capacity": 150
  }
}
```

### API Response Format
```json
{
  "timestamp": "2025-11-04T12:00:00Z",
  "decibels": 72.5,
  "light": 350,
  "indoorTemp": 71,
  "outdoorTemp": 68,
  "humidity": 45,
  "currentSong": "Song Title",
  "artist": "Artist Name",
  "albumArt": "https://example.com/album.jpg",
  "occupancy": {
    "current": 45,
    "entries": 120,
    "exits": 75,
    "capacity": 150
  }
}
```

## Troubleshooting

### Error: "Failed to fetch live data"

**Check browser console for:**
```
🔍 Fetching live data from: https://api.advizia.ai/live/fergs-stpete
❌ Live data API fetch failed: [error details]
```

**Solutions:**
1. Verify API endpoint is deployed and responding
2. Check CORS headers if getting network errors
3. Verify venueId is correct in user attributes
4. Check API Gateway/Lambda logs in CloudWatch

### Error: "Failed to get VenueConfig from DynamoDB"

**Check browser console for:**
```
❌ Failed to get VenueConfig from DynamoDB
```

**Solutions:**
1. Verify VenueConfig table exists
2. Check table has entry for your venueId
3. Verify IAM permissions allow DynamoDB read access
4. Check venueId matches exactly (case-sensitive)

### Error: "AWS IoT unavailable, using polling fallback"

**This is a warning, not an error.** The app will use HTTP polling instead.

**To enable IoT:**
1. Ensure VenueConfig has correct `mqttTopic`
2. Verify MQTT messages are being published
3. Check IoT Core policies allow WebSocket connections

### Connection Status Indicators

| Status | Meaning | Action |
|--------|---------|--------|
| 🟢 "AWS IoT Live" | Best case - real-time MQTT working | None needed |
| 🟡 "Polling Mode" | IoT failed, using HTTP fallback | Check IoT configuration |
| 🔴 Error displayed | Both IoT and API failed | Check all configurations |

## Console Logs

### Successful IoT Connection:
```
✅ Loaded VenueConfig for fergs-stpete → topic: venue/fergs-stpete/main-floor
🔌 Connecting to AWS IoT Core via MQTT...
✅ Connected to AWS IoT Core
📡 Subscribed to topic: venue/fergs-stpete/main-floor
📨 Message received on topic: venue/fergs-stpete/main-floor
📊 Sensor data: {...}
```

### Successful API Polling:
```
⚠️ AWS IoT unavailable, using polling fallback
🔍 Fetching live data from: https://api.advizia.ai/live/fergs-stpete
✅ Live data received from API
```

### Complete Failure:
```
❌ Failed to get VenueConfig from DynamoDB
⚠️ AWS IoT unavailable, using polling fallback
🔍 Fetching live data from: https://api.advizia.ai/live/fergs-stpete
❌ Live data API fetch failed: TypeError: Failed to fetch
[Error displayed in UI]
```

## Quick Setup Checklist

- [ ] DynamoDB VenueConfig table created
- [ ] VenueConfig entry added for venue
- [ ] Cognito user has `custom:venueId` attribute
- [ ] IAM permissions grant DynamoDB access
- [ ] MQTT messages publishing to IoT Core topic
- [ ] (Optional) REST API endpoints deployed
- [ ] User can login successfully
- [ ] Dashboard shows "AWS IoT Live" or "Polling Mode"
- [ ] Sensor data updates in real-time

## Environment Variables

The following environment variables can be configured:

```bash
# API endpoint (default: https://api.advizia.ai)
VITE_API_BASE_URL=https://api.advizia.ai

# AWS Region (default: us-east-2)
VITE_AWS_REGION=us-east-2

# IoT Endpoint (configured in src/config/amplify.ts)
# iotEndpoint: 'a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com'
```

## Support

If you encounter issues:
1. Check browser console (F12) for detailed error logs
2. Verify all AWS resources are in the correct region (us-east-2)
3. Ensure Cognito user pool and IoT endpoint match configuration
4. Check CloudWatch logs for Lambda/AppSync errors
