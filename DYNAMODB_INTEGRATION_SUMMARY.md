# DynamoDB Integration Summary

## What Changed?

The app has been updated to **fetch data directly from AWS DynamoDB** instead of using a fake API endpoint. This resolves the "Unable to Load Data" error caused by trying to reach `https://api.advizia.ai`.

---

## Key Changes

### 1. **New Service: `dynamodb.service.ts`**
- Created a new service that queries DynamoDB via AWS AppSync GraphQL API
- Fetches sensor data filtered by user's `venueId` from Cognito
- Supports live data, historical data, and occupancy metrics

### 2. **Updated: `api.service.ts`**
- Removed all references to fake API endpoint (`https://api.advizia.ai`)
- Now uses `dynamodb.service.ts` for all data fetching
- Methods updated:
  - `getLiveData()` → queries DynamoDB SensorData table
  - `getHistoricalData()` → queries DynamoDB with time ranges
  - `getOccupancyMetrics()` → queries DynamoDB OccupancyMetrics table

### 3. **Updated: `amplify.ts` Config**
- Added GraphQL API configuration
- Added DynamoDB table name configuration
- Configured authentication mode to use Cognito User Pools

### 4. **Updated: `.env` and `.env.example`**
- Removed `VITE_API_BASE_URL` (fake API)
- Added `VITE_GRAPHQL_ENDPOINT` (AppSync endpoint)
- Added DynamoDB table name variables

### 5. **Updated: Error Messages**
- Dashboard now shows helpful error messages specific to DynamoDB
- Displays user's `venueId` for troubleshooting
- Points to `DYNAMODB_SETUP.md` for setup instructions

---

## Data Flow (Before vs After)

### ❌ BEFORE (Fake API)
```
User Login → Try fetch from https://api.advizia.ai → FAIL → Error
```

### ✅ AFTER (DynamoDB)
```
User Login (Cognito)
    ↓
Get custom:venueId from user attributes
    ↓
Query AppSync GraphQL API with venueId
    ↓
AppSync queries DynamoDB SensorData table
    ↓
Returns data filtered by venueId
    ↓
Dashboard displays data ✅
```

---

## What You Need to Do

### Required Setup:

1. **Create AWS AppSync GraphQL API**
   - See `DYNAMODB_SETUP.md` for detailed instructions
   - Configure authentication with Cognito User Pool

2. **Create DynamoDB Tables:**
   - `SensorData` - stores sensor readings
   - `VenueConfig` - stores venue/location configuration
   - `OccupancyMetrics` - stores occupancy statistics

3. **Configure AppSync Resolvers:**
   - `getSensorData` - get single sensor reading
   - `listSensorData` - get historical data with time range
   - `getOccupancyMetrics` - get occupancy stats
   - `getVenueConfig` - get venue configuration

4. **Update `.env` File:**
   ```env
   VITE_GRAPHQL_ENDPOINT=https://xxxxx.appsync-api.us-east-2.amazonaws.com/graphql
   ```

5. **Ensure Users Have `custom:venueId`:**
   - All users must have `custom:venueId` attribute in Cognito
   - This isolates data per venue

---

## Files Modified

```
✅ src/services/dynamodb.service.ts (NEW)
✅ src/services/api.service.ts (UPDATED)
✅ src/config/amplify.ts (UPDATED)
✅ src/pages/Dashboard.tsx (UPDATED - error messages)
✅ .env (UPDATED)
✅ .env.example (UPDATED)
📚 DYNAMODB_SETUP.md (NEW - setup guide)
📚 DYNAMODB_INTEGRATION_SUMMARY.md (NEW - this file)
```

---

## Testing the Integration

### 1. Set up AppSync API (see DYNAMODB_SETUP.md)

### 2. Update .env file:
```bash
VITE_GRAPHQL_ENDPOINT=https://your-appsync-api.appsync-api.us-east-2.amazonaws.com/graphql
```

### 3. Add test data to DynamoDB:
```json
// Table: SensorData
{
  "venueId": "venue-123",
  "timestamp": "2025-11-04T10:30:00.000Z",
  "decibels": 75.5,
  "light": 350.2,
  "indoorTemp": 72.0,
  "outdoorTemp": 68.5,
  "humidity": 55.0,
  "currentSong": "Test Song",
  "artist": "Test Artist"
}
```

### 4. Create test user with venueId:
```bash
aws cognito-idp admin-update-user-attributes \
  --user-pool-id us-east-2_I6EBJm3te \
  --username your-user@example.com \
  --user-attributes Name=custom:venueId,Value=venue-123
```

### 5. Run the app:
```bash
npm run dev
```

### 6. Login and verify:
- ✅ Dashboard should load data from DynamoDB
- ✅ Console should show: "Fetching live data from DynamoDB for venue: venue-123"
- ✅ Console should show: "Live data received from DynamoDB"

---

## Troubleshooting

### "Failed to fetch live data from DynamoDB"

**Causes:**
1. VITE_GRAPHQL_ENDPOINT not set in `.env`
2. AppSync API not created
3. Resolvers not configured
4. No data in DynamoDB tables

**Solution:** Follow `DYNAMODB_SETUP.md` step-by-step

---

### "No sensor data found for venue"

**Causes:**
1. DynamoDB SensorData table is empty
2. User's venueId doesn't match data in table
3. Timestamp range doesn't match any data

**Solution:**
- Add test data to DynamoDB with correct venueId
- Verify user's `custom:venueId` matches data
- Check that timestamps are recent (last 5 minutes for live data)

---

### "Not authenticated"

**Causes:**
1. User not logged in
2. Cognito token expired
3. AppSync authentication misconfigured

**Solution:**
- Logout and login again
- Verify AppSync uses Cognito User Pool authentication
- Check that User Pool ID matches in AppSync and Amplify config

---

## Benefits of DynamoDB Integration

✅ **Real Data:** No more fake API, real data from your DynamoDB tables
✅ **Multi-Tenant:** Data isolated by venueId automatically
✅ **Scalable:** DynamoDB can handle millions of records
✅ **Secure:** Cognito authentication ensures users only see their data
✅ **Fast:** Direct queries with proper indexing
✅ **Cost-Effective:** Pay only for what you use

---

## Next Steps

1. ✅ Follow `DYNAMODB_SETUP.md` to create AppSync API
2. ✅ Create DynamoDB tables with proper schema
3. ✅ Configure resolvers in AppSync
4. ✅ Update `.env` with GraphQL endpoint
5. 📊 Start publishing sensor data to DynamoDB
6. 🎉 See live data on your dashboard!

---

## Support

For detailed setup instructions, see: **`DYNAMODB_SETUP.md`**

For questions or issues:
1. Check browser console (F12) for detailed error logs
2. Check AppSync logs in CloudWatch
3. Verify all steps in DYNAMODB_SETUP.md are complete
4. Test queries directly in AppSync console

---

**Happy monitoring! 🎉📊**
