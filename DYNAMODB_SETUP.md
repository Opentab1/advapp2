# DynamoDB Direct Integration Setup

## Overview

The app now fetches data **directly from DynamoDB** instead of using the fake API endpoint (`https://api.advizia.ai`). Each user's data is isolated by their `venueId` from Cognito user attributes (`custom:venueId`).

## Prerequisites

1. **AWS AppSync GraphQL API** - Required to query DynamoDB tables
2. **DynamoDB Tables** - Must be created with proper schema
3. **Cognito User Pool** - Users must have `custom:venueId` attribute
4. **IAM Permissions** - AppSync must have permissions to query DynamoDB

---

## Step 1: Create DynamoDB Tables

### Table 1: SensorData

**Table Name:** `SensorData`

**Primary Key:**
- Partition Key: `venueId` (String)
- Sort Key: `timestamp` (String) - ISO 8601 format

**Attributes:**
```json
{
  "venueId": "venue-123",
  "timestamp": "2025-11-04T10:30:00.000Z",
  "decibels": 75.5,
  "light": 350.2,
  "indoorTemp": 72.0,
  "outdoorTemp": 68.5,
  "humidity": 55.0,
  "currentSong": "Song Title",
  "albumArt": "https://...",
  "artist": "Artist Name",
  "occupancy": {
    "current": 45,
    "entries": 120,
    "exits": 75,
    "capacity": 200
  }
}
```

**GSI (Optional):** Create a GSI on `timestamp` for time-range queries across venues

---

### Table 2: VenueConfig

**Table Name:** `VenueConfig`

**Primary Key:**
- Partition Key: `venueId` (String)
- Sort Key: `locationId` (String)

**Attributes:**
```json
{
  "venueId": "venue-123",
  "locationId": "main-floor",
  "mqttTopic": "venue/venue-123/sensors",
  "displayName": "Main Floor",
  "locationName": "Main Bar Area",
  "iotEndpoint": "a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com",
  "deviceId": "device-001",
  "address": "123 Main St",
  "timezone": "America/New_York"
}
```

---

### Table 3: OccupancyMetrics

**Table Name:** `OccupancyMetrics`

**Primary Key:**
- Partition Key: `venueId` (String)

**Attributes:**
```json
{
  "venueId": "venue-123",
  "current": 45,
  "todayEntries": 120,
  "todayExits": 75,
  "peakOccupancy": 180,
  "peakTime": "8:30 PM",
  "sevenDayAvg": 95,
  "fourteenDayAvg": 88,
  "thirtyDayAvg": 92
}
```

---

## Step 2: Create AWS AppSync GraphQL API

### Option A: Using AWS Console

1. Go to **AWS AppSync** in the AWS Console
2. Click **Create API**
3. Choose **Build from scratch**
4. Name: `PulseDashboardAPI`
5. Click **Create**

### Option B: Using AWS CLI

```bash
aws appsync create-graphql-api \
  --name PulseDashboardAPI \
  --authentication-type AMAZON_COGNITO_USER_POOLS \
  --user-pool-config userPoolId=us-east-2_I6EBJm3te,awsRegion=us-east-2,defaultAction=ALLOW \
  --region us-east-2
```

---

## Step 3: Create GraphQL Schema

In AWS AppSync, create the following schema:

```graphql
type SensorData {
  venueId: ID!
  timestamp: String!
  decibels: Float
  light: Float
  indoorTemp: Float
  outdoorTemp: Float
  humidity: Float
  currentSong: String
  albumArt: String
  artist: String
  occupancy: Occupancy
}

type Occupancy {
  current: Int
  entries: Int
  exits: Int
  capacity: Int
}

type SensorDataConnection {
  items: [SensorData]
  nextToken: String
}

type OccupancyMetrics {
  current: Int
  todayEntries: Int
  todayExits: Int
  peakOccupancy: Int
  peakTime: String
  sevenDayAvg: Int
  fourteenDayAvg: Int
  thirtyDayAvg: Int
}

type VenueConfig {
  venueId: ID!
  locationId: String!
  mqttTopic: String
  displayName: String
  locationName: String
  iotEndpoint: String
  deviceId: String
  address: String
  timezone: String
}

type VenueConfigConnection {
  items: [VenueConfig]
  nextToken: String
}

type Query {
  getSensorData(venueId: ID!, timestamp: String!): SensorData
  listSensorData(venueId: ID!, startTime: String!, endTime: String!, limit: Int): SensorDataConnection
  getOccupancyMetrics(venueId: ID!): OccupancyMetrics
  getVenueConfig(venueId: ID!, locationId: String!): VenueConfig
  listVenueLocations(venueId: ID!): VenueConfigConnection
}

schema {
  query: Query
}
```

---

## Step 4: Create Data Sources

For each DynamoDB table, create a data source in AppSync:

1. Go to **Data Sources** in AppSync console
2. Click **Create data source**
3. Data source name: `SensorDataTable`
4. Data source type: **Amazon DynamoDB table**
5. Region: `us-east-2`
6. Table name: `SensorData`
7. Create or use existing role with DynamoDB permissions
8. Repeat for `VenueConfig` and `OccupancyMetrics` tables

---

## Step 5: Create Resolvers

### Resolver 1: getSensorData

**Query:** `Query.getSensorData`
**Data source:** `SensorDataTable`

**Request Mapping Template (VTL):**
```vtl
## SECURITY: Extract venueId from authenticated user's JWT token
## This ensures users can only query their own venue's data
#set($userVenueId = $ctx.identity.claims.get("custom:venueId"))

#if(!$userVenueId)
  $util.error("User does not have custom:venueId attribute. Please contact administrator.")
#end

## Use venueId from JWT token (not from query argument) for security
## This prevents users from querying other venues' data
#set($venueId = $userVenueId)

{
  "version": "2017-02-28",
  "operation": "GetItem",
  "key": {
    "venueId": $util.dynamodb.toDynamoDBJson($venueId),
    "timestamp": $util.dynamodb.toDynamoDBJson($ctx.args.timestamp)
  }
}
```

**Response Mapping Template:**
```vtl
$util.toJson($ctx.result)
```

---

### Resolver 2: listSensorData

**Query:** `Query.listSensorData`
**Data source:** `SensorDataTable`

**Request Mapping Template (VTL):**
```vtl
## SECURITY: Extract venueId from authenticated user's JWT token
## This ensures users can only query their own venue's data
#set($userVenueId = $ctx.identity.claims.get("custom:venueId"))

#if(!$userVenueId)
  $util.error("User does not have custom:venueId attribute. Please contact administrator.")
#end

## Use venueId from JWT token (not from query argument) for security
## This prevents users from querying other venues' data
#set($venueId = $userVenueId)

{
  "version": "2017-02-28",
  "operation": "Query",
  "query": {
    "expression": "venueId = :venueId AND #timestamp BETWEEN :startTime AND :endTime",
    "expressionNames": {
      "#timestamp": "timestamp"
    },
    "expressionValues": {
      ":venueId": $util.dynamodb.toDynamoDBJson($venueId),
      ":startTime": $util.dynamodb.toDynamoDBJson($ctx.args.startTime),
      ":endTime": $util.dynamodb.toDynamoDBJson($ctx.args.endTime)
    }
  },
  "limit": $util.defaultIfNull($ctx.args.limit, 1000),
  "scanIndexForward": true
}
```

**Response Mapping Template:**
```vtl
{
  "items": $util.toJson($ctx.result.items),
  "nextToken": $util.toJson($ctx.result.nextToken)
}
```

---

### Resolver 3: getOccupancyMetrics

**Query:** `Query.getOccupancyMetrics`
**Data source:** `OccupancyMetricsTable`

**Request Mapping Template (VTL):**
```vtl
## SECURITY: Extract venueId from authenticated user's JWT token
## This ensures users can only query their own venue's data
#set($userVenueId = $ctx.identity.claims.get("custom:venueId"))

#if(!$userVenueId)
  $util.error("User does not have custom:venueId attribute. Please contact administrator.")
#end

## Use venueId from JWT token (not from query argument) for security
## This prevents users from querying other venues' data
#set($venueId = $userVenueId)

{
  "version": "2017-02-28",
  "operation": "GetItem",
  "key": {
    "venueId": $util.dynamodb.toDynamoDBJson($venueId)
  }
}
```

**Response Mapping Template:**
```vtl
$util.toJson($ctx.result)
```

---

### Resolver 4: getVenueConfig

**Query:** `Query.getVenueConfig`
**Data source:** `VenueConfigTable`

**Request Mapping Template (VTL):**
```vtl
## SECURITY: Extract venueId from authenticated user's JWT token
## This ensures users can only query their own venue's data
#set($userVenueId = $ctx.identity.claims.get("custom:venueId"))

#if(!$userVenueId)
  $util.error("User does not have custom:venueId attribute. Please contact administrator.")
#end

## Use venueId from JWT token (not from query argument) for security
## This prevents users from querying other venues' data
#set($venueId = $userVenueId)

{
  "version": "2017-02-28",
  "operation": "GetItem",
  "key": {
    "venueId": $util.dynamodb.toDynamoDBJson($venueId),
    "locationId": $util.dynamodb.toDynamoDBJson($ctx.args.locationId)
  }
}
```

**Response Mapping Template:**
```vtl
$util.toJson($ctx.result)
```

---

### Resolver 5: listVenueLocations

**Query:** `Query.listVenueLocations`
**Data source:** `VenueConfigTable`

**Request Mapping Template (VTL):**
```vtl
## SECURITY: Extract venueId from authenticated user's JWT token
## This ensures users can only query their own venue's data
#set($userVenueId = $ctx.identity.claims.get("custom:venueId"))

#if(!$userVenueId)
  $util.error("User does not have custom:venueId attribute. Please contact administrator.")
#end

## Use venueId from JWT token (not from query argument) for security
## This prevents users from querying other venues' data
#set($venueId = $userVenueId)

## Query VenueConfig table for all locations with this venueId
## Note: venueId is the partition key, so we query by venueId only
{
  "version": "2017-02-28",
  "operation": "Query",
  "query": {
    "expression": "venueId = :venueId",
    "expressionValues": {
      ":venueId": $util.dynamodb.toDynamoDBJson($venueId)
    }
  }
}
```

**Response Mapping Template:**
```vtl
{
  "items": $util.toJson($ctx.result.items),
  "nextToken": $util.toJson($ctx.result.nextToken)
}
```

---

## Step 6: Configure Authentication

1. In AppSync console, go to **Settings**
2. Under **Authorization**, ensure:
   - **Default authorization mode:** Amazon Cognito User Pools
   - **User pool:** `us-east-2_I6EBJm3te`
   - **Region:** `us-east-2`

---

## Step 7: Understanding Multi-Tenant Security

### How Data Isolation Works

**YES, the solution works with multiple venues and multiple logins!** Here's how:

1. **User Authentication**: Each user logs in via Cognito and receives a JWT token containing their `custom:venueId`

2. **Server-Side Enforcement**: All AppSync resolvers automatically extract `venueId` from the JWT token and use it for queries, **ignoring any venueId passed as a query argument**

3. **Automatic Isolation**: Even if User A tries to query data for User B's venueId, the resolver will:
   - Extract User A's venueId from their JWT token
   - Query only User A's data
   - Return empty results if User A tries to access User B's venueId

### Example Multi-Tenant Scenario:

```
User 1 (venueId: "venue-123") logs in
  → JWT token: { custom:venueId: "venue-123" }
  → Can ONLY access data where venueId = "venue-123"
  
User 2 (venueId: "venue-456") logs in  
  → JWT token: { custom:venueId: "venue-456" }
  → Can ONLY access data where venueId = "venue-456"
  
User 1 tries to query: listSensorData(venueId: "venue-456")
  → Resolver ignores argument, uses JWT token venueId: "venue-123"
  → Returns only venue-123 data (or empty if no data exists)
  → User 1 CANNOT access venue-456 data
```

### Setting Up Multiple Venues:

1. **Create DynamoDB Data** with different venueIds:
   ```json
   // Venue 1 data
   { "venueId": "venue-123", "timestamp": "...", ... }
   
   // Venue 2 data  
   { "venueId": "venue-456", "timestamp": "...", ... }
   ```

2. **Create Cognito Users** with different `custom:venueId`:
   ```bash
   # User for Venue 1
   aws cognito-idp admin-create-user \
     --user-pool-id us-east-2_I6EBJm3te \
     --username user1@venue1.com \
     --user-attributes Name=custom:venueId,Value=venue-123
   
   # User for Venue 2
   aws cognito-idp admin-create-user \
     --user-pool-id us-east-2_I6EBJm3te \
     --username user2@venue2.com \
     --user-attributes Name=custom:venueId,Value=venue-456
   ```

3. **Each User Sees Only Their Data**: The resolver automatically filters by the venueId from their JWT token

### Important Notes:

- ✅ **Client-side venueId is still passed** for code readability and logging, but **server-side ignores it**
- ✅ **Security is enforced at the resolver level** - cannot be bypassed by client manipulation
- ✅ **No additional configuration needed** - works automatically once resolvers are set up correctly
- ✅ **Scalable** - supports unlimited venues with automatic isolation

---

## Step 8: Get Your GraphQL Endpoint

1. In AppSync console, go to **Settings**
2. Copy the **API URL** (looks like: `https://xxxxx.appsync-api.us-east-2.amazonaws.com/graphql`)
3. Update your `.env` file:

```env
VITE_GRAPHQL_ENDPOINT=https://xxxxx.appsync-api.us-east-2.amazonaws.com/graphql
```

---

## Step 9: Configure Cognito User Attributes

Each user MUST have the following custom attributes:

1. Go to **AWS Cognito** → **User Pools** → `us-east-2_I6EBJm3te`
2. Go to **Users** and select a user
3. Ensure they have:
   - `custom:venueId` - e.g., `venue-123` (REQUIRED)
   - `custom:venueName` - e.g., `Fergs Sports Bar` (Optional)
   - `custom:locationId` - e.g., `main-floor` (Optional)

---

## Step 10: Test the Setup

1. Build and run the app:
```bash
npm run dev
```

2. Login with a user that has `custom:venueId` set

3. Check browser console (F12) for logs:
   - ✅ Should see: "Fetching live data from DynamoDB for venue: venue-123"
   - ✅ Should see: "Live data received from DynamoDB"

4. If you see errors:
   - Check that VITE_GRAPHQL_ENDPOINT is set correctly in `.env`
   - Check that AppSync resolvers are configured
   - Check that DynamoDB tables exist with correct schema
   - Check that user has `custom:venueId` attribute

---

## Troubleshooting

### Error: "Not authenticated"
- Ensure user is logged in
- Check that Cognito token is valid
- Verify AppSync authentication is set to Cognito User Pools

### Error: "No sensor data found for venue"
- Check that DynamoDB table has data
- Verify `venueId` matches user's `custom:venueId`
- Check that timestamps are in ISO 8601 format

### Error: "Failed to fetch from DynamoDB"
- Verify VITE_GRAPHQL_ENDPOINT is set in `.env`
- Check AppSync API is deployed
- Verify resolvers are attached to queries
- Check IAM permissions for AppSync → DynamoDB

### Error: GraphQL errors in console
- Check AppSync logs in CloudWatch
- Verify schema matches resolver templates
- Test queries directly in AppSync console

---

## Data Flow

```
User Login (Cognito)
    ↓
Get custom:venueId attribute
    ↓
App calls dynamodb.service.ts
    ↓
GraphQL query sent to AppSync
    ↓
AppSync queries DynamoDB with venueId
    ↓
Data returned filtered by venueId
    ↓
Displayed on dashboard
```

---

## Security Notes

### Multi-Tenant Data Isolation (CRITICAL)

✅ **IMPLEMENTED:** Server-side enforcement ensures complete data isolation between venues:

1. **JWT Token Validation**: All resolvers extract `venueId` from the authenticated user's JWT token (`$ctx.identity.claims['custom:venueId']`)

2. **Automatic Override**: The resolver templates use the `venueId` from the JWT token, **ignoring any venueId passed as a query argument**. This means:
   - Even if a malicious user modifies client code to query a different venueId, the resolver will use their authenticated venueId
   - Users can **ONLY** access data for their own venue

3. **Error Handling**: If a user doesn't have `custom:venueId` in their JWT token, the resolver returns an error

4. **No Client-Side Reliance**: Security is enforced at the AppSync resolver level, not just in the client code

### Example Security Flow:

```
User A (venueId: "venue-123") logs in
  ↓
JWT token contains: custom:venueId = "venue-123"
  ↓
User queries: listSensorData(venueId: "venue-456")  ← Malicious attempt
  ↓
AppSync Resolver extracts venueId from JWT: "venue-123"
  ↓
Resolver queries DynamoDB with venueId: "venue-123"  ← Security enforced!
  ↓
Returns only data for venue-123 (not venue-456)
```

### Additional Security Measures:

- AppSync uses Cognito User Pool authentication for all queries
- IAM roles with least-privilege permissions for AppSync → DynamoDB access
- DynamoDB tables use `venueId` as partition key for efficient querying and isolation

---

## Next Steps

1. ✅ Set up AppSync GraphQL API
2. ✅ Create DynamoDB tables
3. ✅ Configure resolvers
4. ✅ Update `.env` with GraphQL endpoint
5. ✅ Test with real user login
6. 📊 Start publishing sensor data to DynamoDB
7. 🎉 See live data on dashboard!
