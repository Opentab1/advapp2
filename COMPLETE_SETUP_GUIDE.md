# 🚨 COMPLETE SETUP GUIDE - NO DATA SHOWING AFTER LOGIN

## 🔍 WHY YOUR DATA ISN'T SHOWING

I've analyzed your entire application. Here's what's happening:

### ✅ WHAT'S WORKING:
- Authentication system (AWS Cognito)
- Multi-venue data isolation architecture
- GraphQL queries to DynamoDB
- IoT/MQTT real-time streaming (fallback to HTTP polling)

### ❌ WHAT'S LIKELY BROKEN (Why You See No Data):

1. **Missing .env File** ⚠️ CRITICAL
   - Your app has NO `.env` file configured
   - Without `VITE_GRAPHQL_ENDPOINT`, the app cannot fetch data from DynamoDB
   - This is THE #1 reason for "no data showing"

2. **AppSync Endpoint Not Configured** ⚠️ CRITICAL
   - The app needs a GraphQL API endpoint to query DynamoDB
   - Check: Do you have an AWS AppSync API created?
   - Check: Are resolvers attached to your queries?

3. **User Missing custom:venueId** ⚠️ CRITICAL
   - Your Cognito user MUST have `custom:venueId` attribute
   - Without it, the app doesn't know which venue's data to fetch
   - Example: `custom:venueId = "FergData"`

4. **No Data in DynamoDB**
   - Check: Does your SensorData table have entries?
   - Check: Does the venueId in DynamoDB match your user's custom:venueId?
   - Check: Are timestamps in ISO 8601 format (e.g., "2025-11-04T10:30:00.000Z")?

5. **VenueConfig Not Set Up**
   - Each venue needs entries in the VenueConfig table
   - This tells the app about locations, MQTT topics, etc.

---

## 🔧 IMMEDIATE FIX - Get Data Showing Now

Follow these steps IN ORDER:

### STEP 1: Create .env File (CRITICAL!)

```bash
# Create .env file from example
cp .env.example .env
```

Then edit `.env` and replace with your ACTUAL values:

```env
# AWS Cognito (Already configured for you)
VITE_COGNITO_USER_POOL_ID=us-east-2_I6EBJm3te
VITE_COGNITO_CLIENT_ID=4v7vp7trh72q1priqno9k5prsq
VITE_AWS_REGION=us-east-2

# ⚠️ CRITICAL: Replace with your AppSync GraphQL endpoint
# Get this from AWS AppSync Console → Settings → API URL
VITE_GRAPHQL_ENDPOINT=https://xxxxx.appsync-api.us-east-2.amazonaws.com/graphql

# DynamoDB Tables (these defaults are fine)
VITE_SENSOR_DATA_TABLE=SensorData
VITE_VENUE_CONFIG_TABLE=VenueConfig
VITE_OCCUPANCY_METRICS_TABLE=OccupancyMetrics

# IoT Endpoint (already configured)
VITE_IOT_ENDPOINT=a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com
```

### STEP 2: Check Your User Has custom:venueId

```bash
# Check your user attributes
aws cognito-idp admin-get-user \
  --user-pool-id us-east-2_I6EBJm3te \
  --username YOUR_EMAIL@example.com
```

Look for:
```json
{
  "Name": "custom:venueId",
  "Value": "FergData"  // Or whatever your venue ID is
}
```

**If missing, add it:**
```bash
aws cognito-idp admin-update-user-attributes \
  --user-pool-id us-east-2_I6EBJm3te \
  --username YOUR_EMAIL@example.com \
  --user-attributes Name=custom:venueId,Value=FergData
```

### STEP 3: Verify DynamoDB Has Data

```bash
# Check if SensorData table has entries for your venueId
aws dynamodb query \
  --table-name SensorData \
  --key-condition-expression "venueId = :venueId" \
  --expression-attribute-values '{":venueId":{"S":"FergData"}}' \
  --limit 1
```

**If empty, add test data:**
```bash
aws dynamodb put-item \
  --table-name SensorData \
  --item '{
    "venueId": {"S": "FergData"},
    "timestamp": {"S": "'$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")'"},
    "decibels": {"N": "72.5"},
    "light": {"N": "350.2"},
    "indoorTemp": {"N": "71.0"},
    "outdoorTemp": {"N": "68.5"},
    "humidity": {"N": "55.0"},
    "currentSong": {"S": "Test Song"},
    "artist": {"S": "Test Artist"}
  }'
```

### STEP 4: Verify VenueConfig Exists

```bash
# Check if VenueConfig has entries for your venueId
aws dynamodb query \
  --table-name VenueConfig \
  --key-condition-expression "venueId = :venueId" \
  --expression-attribute-values '{":venueId":{"S":"FergData"}}'
```

**If empty, add a location:**
```bash
aws dynamodb put-item \
  --table-name VenueConfig \
  --item '{
    "venueId": {"S": "FergData"},
    "locationId": {"S": "location-1"},
    "displayName": {"S": "Main Floor"},
    "locationName": {"S": "Main Bar Area"},
    "mqttTopic": {"S": "venue/FergData/sensors"},
    "address": {"S": "123 Main St"},
    "timezone": {"S": "America/New_York"}
  }'
```

### STEP 5: Test the App

```bash
# Restart dev server (to load .env)
npm run dev
```

1. Open browser to `http://localhost:5173`
2. Open browser console (F12)
3. Login with your credentials
4. Look for logs like:
   - ✅ "Fetching live data from DynamoDB for venue: FergData"
   - ✅ "Live data received from DynamoDB"
   - ❌ "Failed to fetch from DynamoDB" = something still broken

---

## 📋 DEBUGGING CHECKLIST

Use this to diagnose issues:

### ✅ Check 1: .env File Configured
```bash
cat .env | grep VITE_GRAPHQL_ENDPOINT
```
Should show your AppSync URL, NOT "your-appsync-api"

### ✅ Check 2: User Has venueId
```bash
aws cognito-idp admin-get-user \
  --user-pool-id us-east-2_I6EBJm3te \
  --username YOUR_EMAIL
```
Should show `custom:venueId` attribute

### ✅ Check 3: AppSync API Exists
```bash
aws appsync list-graphql-apis --region us-east-2
```
Should list your PulseDashboardAPI

### ✅ Check 4: DynamoDB Tables Exist
```bash
aws dynamodb list-tables --region us-east-2 | grep -E "(SensorData|VenueConfig|OccupancyMetrics)"
```
Should show all 3 tables

### ✅ Check 5: SensorData Has Entries
```bash
aws dynamodb scan --table-name SensorData --limit 1
```
Should return at least 1 item

### ✅ Check 6: VenueConfig Has Entries
```bash
aws dynamodb scan --table-name VenueConfig --limit 1
```
Should return at least 1 item

---

## 🔍 COMMON ERRORS & FIXES

### Error: "GraphQL endpoint not configured"
**Fix:** Create `.env` file with `VITE_GRAPHQL_ENDPOINT`

### Error: "User does not have custom:venueId attribute"
**Fix:** Add `custom:venueId` to your Cognito user (see STEP 2)

### Error: "No sensor data found for venue"
**Fix:** Add data to DynamoDB SensorData table (see STEP 3)

### Error: "No locations configured for venue"
**Fix:** Add entries to VenueConfig table (see STEP 4)

### Error: "Failed to fetch from DynamoDB"
**Fix:** Check AppSync resolvers are configured correctly
- See `DYNAMODB_SETUP.md` for resolver templates
- Verify data sources are connected

### Error: "Not authenticated"
**Fix:** 
- Clear browser cookies/localStorage
- Login again
- Verify Cognito user is CONFIRMED status

---

## 🎯 WHAT SHOULD WORK AFTER SETUP

Once everything is configured:

1. ✅ User logs in with email/password
2. ✅ App extracts `venueId` from JWT token (custom:venueId)
3. ✅ App queries DynamoDB via AppSync GraphQL
4. ✅ AppSync resolvers automatically filter by venueId
5. ✅ User sees ONLY their venue's data
6. ✅ Real-time updates via IoT/MQTT (if configured)
7. ✅ Multiple venues can use the same app
8. ✅ Each venue's data is completely isolated

---

## 📚 Next Steps

Once you have data showing:
1. Read `VENUE_SETUP_COMPLETE_GUIDE.md` for adding new venues
2. Read `RPI_CONNECTION_GUIDE.md` for connecting Raspberry Pi sensors
3. Test with multiple users/venues to verify isolation

---

## 🆘 Still Not Working?

Check browser console (F12) for detailed error messages. The app logs:
- GraphQL request details
- Authentication session info
- DynamoDB query results
- Any errors with stack traces

**Copy those logs** and we can debug further!
