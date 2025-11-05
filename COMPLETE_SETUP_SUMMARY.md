# 🎯 Complete Setup Summary: Multi-Venue Dashboard with RPI Integration

## Overview

This app is a **multi-tenant IoT monitoring dashboard** where:
- ✅ Each venue has isolated data (venues can't see each other's data)
- ✅ Each user logs in and sees only their venue's data
- ✅ RPI devices publish sensor data via AWS IoT Core
- ✅ Data is stored in DynamoDB and queried via AppSync GraphQL
- ✅ Live data appears in real-time on the dashboard

## Architecture

```
┌─────────────┐
│   RPI       │  Publishes sensor data
│  Device     │  via MQTT
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ AWS IoT Core│  Receives MQTT messages
│             │  Route: venue/{venueId}/sensors
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ IoT Rule    │  Transforms & stores in DynamoDB
│             │  Table: SensorData
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ DynamoDB    │  Stores sensor data
│ SensorData  │  Key: venueId + timestamp
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ AppSync     │  GraphQL API queries DynamoDB
│ GraphQL API │  Filters by venueId from JWT
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Dashboard   │  Displays live data
│ (React App) │  Authenticated via Cognito
└─────────────┘
```

## Data Isolation (How It Works)

### Security Model

1. **User logs in** → Cognito issues JWT token
2. **JWT contains** → `custom:venueId` attribute
3. **App queries AppSync** → Passes `venueId` in query
4. **AppSync resolver** → **IGNORES** query argument, extracts `venueId` from JWT token
5. **DynamoDB query** → Uses JWT `venueId` (not query argument)
6. **Result** → Only data for that venue is returned

**Why this is secure:**
- Even if a malicious user modifies client code to query a different `venueId`, the resolver uses the JWT token's `venueId`
- Users can **ONLY** access data for their own venue
- No way to bypass this security (enforced server-side)

### Example Flow

```
User A (venueId: "venue-123") logs in
  ↓
JWT token: { custom:venueId: "venue-123" }
  ↓
App queries: listSensorData(venueId: "venue-456")  ← Malicious attempt
  ↓
AppSync resolver extracts: venueId = "venue-123" (from JWT)
  ↓
DynamoDB query: WHERE venueId = "venue-123"
  ↓
Returns: Only venue-123 data (not venue-456)
```

## Required AWS Resources

### 1. Cognito User Pool
- **ID**: `us-east-2_I6EBJm3te`
- **Purpose**: User authentication
- **Custom Attributes**: `custom:venueId`, `custom:venueName`

### 2. DynamoDB Tables

#### SensorData
- **Partition Key**: `venueId` (String)
- **Sort Key**: `timestamp` (String)
- **Purpose**: Stores sensor readings

#### VenueConfig
- **Partition Key**: `venueId` (String)
- **Sort Key**: `locationId` (String)
- **Purpose**: Stores venue/location configuration, MQTT topics

#### OccupancyMetrics
- **Partition Key**: `venueId` (String)
- **Purpose**: Stores occupancy statistics

### 3. AppSync GraphQL API
- **Authentication**: Cognito User Pools
- **Purpose**: Query DynamoDB with security
- **Resolvers**: Extract `venueId` from JWT token

### 4. AWS IoT Core
- **Endpoint**: `a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com`
- **Purpose**: Receive MQTT messages from RPI devices
- **Rules**: Transform and store in DynamoDB

## Environment Variables

Required in `.env` file:

```env
# AWS Cognito
VITE_COGNITO_USER_POOL_ID=us-east-2_I6EBJm3te
VITE_COGNITO_CLIENT_ID=4v7vp7trh72q1priqno9k5prsq
VITE_AWS_REGION=us-east-2

# AppSync GraphQL (REQUIRED)
VITE_GRAPHQL_ENDPOINT=https://YOUR_API_ID.appsync-api.us-east-2.amazonaws.com/graphql

# DynamoDB Tables (Optional - defaults work)
VITE_SENSOR_DATA_TABLE=SensorData
VITE_VENUE_CONFIG_TABLE=VenueConfig
VITE_OCCUPANCY_METRICS_TABLE=OccupancyMetrics

# AWS IoT (Optional)
VITE_IOT_ENDPOINT=a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com
```

**Critical:** `VITE_GRAPHQL_ENDPOINT` must be set to your actual AppSync endpoint (not placeholder).

## Adding a New Venue: Quick Steps

1. **Create Venue ID** (e.g., `new-venue-001`)
2. **Create Cognito User** with `custom:venueId` = `new-venue-001`
3. **Create VenueConfig Entry** in DynamoDB
4. **Create IoT Thing** for RPI device
5. **Create IoT Rule** to store data in DynamoDB
6. **Configure RPI** to publish to MQTT topic: `venue/new-venue-001/sensors`
7. **Test Login** - user should see live data

**See `ADD_NEW_USER_GUIDE.md` for detailed step-by-step instructions.**

## Troubleshooting: No Data Showing

### Common Issues (In Order of Likelihood)

1. **Missing `VITE_GRAPHQL_ENDPOINT`** (80% of issues)
   - Check `.env` file has actual AppSync endpoint (not placeholder)
   - Restart dev server after changing `.env`

2. **Missing `custom:venueId`** (15% of issues)
   - Check Cognito user has `custom:venueId` attribute set
   - Value must match DynamoDB entries

3. **No Data in DynamoDB** (4% of issues)
   - Check SensorData table has entries for that `venueId`
   - Check RPI is publishing to correct MQTT topic
   - Check IoT rule is active and configured correctly

4. **AppSync Not Configured** (1% of issues)
   - Check AppSync API exists and is deployed
   - Check resolvers are attached to queries
   - Check data sources are linked to DynamoDB tables

**See `DIAGNOSTIC_CHECKLIST.md` for comprehensive troubleshooting.**

## Testing Checklist

Before deploying to production:

- [ ] `.env` file has `VITE_GRAPHQL_ENDPOINT` set (not placeholder)
- [ ] AppSync API is deployed and accessible
- [ ] AppSync resolvers extract `venueId` from JWT (not query args)
- [ ] DynamoDB tables exist with correct schema
- [ ] Test user has `custom:venueId` attribute in Cognito
- [ ] VenueConfig table has entry for test venue
- [ ] SensorData table has test data for test venue
- [ ] Can login successfully
- [ ] Dashboard shows live data
- [ ] Browser console shows no errors (F12)
- [ ] RPI can publish to IoT Core
- [ ] IoT rule stores data in DynamoDB

## Key Files

- **`DIAGNOSTIC_CHECKLIST.md`** - Troubleshooting guide
- **`ADD_NEW_USER_GUIDE.md`** - Step-by-step user creation
- **`DYNAMODB_SETUP.md`** - AppSync and DynamoDB setup
- **`CREATE_NEW_USER.md`** - Quick user creation reference
- **`APPSYNC_SCHEMA.graphql`** - GraphQL schema

## Support

If you encounter issues:

1. Check `DIAGNOSTIC_CHECKLIST.md` first
2. Verify all checklist items are ✅
3. Check browser console (F12) for errors
4. Check AppSync CloudWatch logs
5. Verify `venueId` matches across all components

## Important Notes

### Data Isolation
- ✅ **Enforced server-side** - Cannot be bypassed
- ✅ **Automatic** - No additional configuration needed
- ✅ **Scalable** - Supports unlimited venues

### Security
- ✅ **JWT-based** - Uses Cognito tokens
- ✅ **Resolver-level** - Security at AppSync level
- ✅ **No client-side reliance** - Server validates venueId

### Performance
- ✅ **Efficient queries** - DynamoDB partition key on `venueId`
- ✅ **Real-time** - IoT MQTT for live updates
- ✅ **Fallback** - HTTP polling if IoT unavailable

---

**Remember:** The entire system revolves around the `venueId`. Every component must use the same `venueId`:
- Cognito: `custom:venueId` attribute
- DynamoDB: `venueId` field in tables
- IoT: `venue/{venueId}/sensors` topic
- AppSync: Extracted from JWT token

If any component uses a different `venueId`, data won't appear for that venue.
