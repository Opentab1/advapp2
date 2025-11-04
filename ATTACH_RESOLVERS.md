# 🔧 How to Attach Data Sources to Resolvers

## Step 1: Create Data Sources (If They Don't Exist)

First, you need to create data sources that point to your DynamoDB tables:

1. Go to **Data Sources** tab in AppSync
2. Click **Create data source**
3. Create these 3 data sources:

### Data Source 1: SensorData
- **Name**: `SensorDataTable`
- **Data source type**: Amazon DynamoDB table
- **Region**: `us-east-2`
- **Table name**: `SensorData`
- **IAM role**: Use existing role or create new one
- Click **Create**

### Data Source 2: VenueConfig
- **Name**: `VenueConfigTable`
- **Data source type**: Amazon DynamoDB table
- **Region**: `us-east-2`
- **Table name**: `VenueConfig`
- **IAM role**: Use existing role or create new one
- Click **Create**

### Data Source 3: OccupancyMetrics
- **Name**: `OccupancyMetricsTable`
- **Data source type**: Amazon DynamoDB table
- **Region**: `us-east-2`
- **Table name**: `OccupancyMetrics`
- **IAM role**: Use existing role or create new one
- Click **Create**

## Step 2: Attach Data Sources to Resolvers

Now go back to **Schema** → **Resolvers**:

### For `getSensorData` resolver:
1. Click **Attach**
2. Select data source: `SensorDataTable`
3. Configure:
   - **Request mapping template**: 
   ```vtl
   {
     "version": "2017-02-28",
     "operation": "GetItem",
     "key": {
       "venueId": $util.dynamodb.toDynamoDBJson($ctx.arguments.venueId),
       "timestamp": $util.dynamodb.toDynamoDBJson($ctx.arguments.timestamp)
     }
   }
   ```
   - **Response mapping template**: `$util.toJson($ctx.result)`
   - **Authorization**: `AMAZON_COGNITO_USER_POOLS`
4. Click **Save**

### For `listSensorData` resolver:
1. Click **Attach**
2. Select data source: `SensorDataTable`
3. Configure:
   - **Request mapping template**:
   ```vtl
   {
     "version": "2017-02-28",
     "operation": "Query",
     "query": {
       "expression": "venueId = :venueId AND #ts BETWEEN :startTime AND :endTime",
       "expressionValues": {
         ":venueId": $util.dynamodb.toDynamoDBJson($ctx.arguments.venueId),
         ":startTime": $util.dynamodb.toDynamoDBJson($ctx.arguments.startTime),
         ":endTime": $util.dynamodb.toDynamoDBJson($ctx.arguments.endTime)
       },
       "expressionNames": {
         "#ts": "timestamp"
       }
     },
     "limit": $util.defaultIfNull($ctx.arguments.limit, 100),
     "scanIndexForward": false
   }
   ```
   - **Response mapping template**: `$util.toJson($ctx.result)`
   - **Authorization**: `AMAZON_COGNITO_USER_POOLS`
4. Click **Save**

### For `listVenueLocations` resolver:
1. Click **Attach**
2. Select data source: `VenueConfigTable`
3. Configure:
   - **Request mapping template**:
   ```vtl
   {
     "version": "2017-02-28",
     "operation": "Query",
     "query": {
       "expression": "venueId = :venueId",
       "expressionValues": {
         ":venueId": $util.dynamodb.toDynamoDBJson($ctx.arguments.venueId)
       }
     },
     "limit": $util.defaultIfNull($ctx.arguments.limit, 100)
   }
   ```
   - **Response mapping template**: `$util.toJson($ctx.result)`
   - **Authorization**: `AMAZON_COGNITO_USER_POOLS`
4. Click **Save**

### For `getOccupancyMetrics` resolver:
1. Click **Attach**
2. Select data source: `OccupancyMetricsTable`
3. Configure:
   - **Request mapping template**:
   ```vtl
   {
     "version": "2017-02-28",
     "operation": "GetItem",
     "key": {
       "venueId": $util.dynamodb.toDynamoDBJson($ctx.arguments.venueId)
     }
   }
   ```
   - **Response mapping template**: `$util.toJson($ctx.result)`
   - **Authorization**: `AMAZON_COGNITO_USER_POOLS`
4. Click **Save**

### For `getVenueConfig` resolver:
1. Click **Attach**
2. Select data source: `VenueConfigTable`
3. Configure:
   - **Request mapping template**:
   ```vtl
   {
     "version": "2017-02-28",
     "operation": "GetItem",
     "key": {
       "venueId": $util.dynamodb.toDynamoDBJson($ctx.arguments.venueId),
       "locationId": $util.dynamodb.toDynamoDBJson($ctx.arguments.locationId)
     }
   }
   ```
   - **Response mapping template**: `$util.toJson($ctx.result)`
   - **Authorization**: `AMAZON_COGNITO_USER_POOLS`
4. Click **Save**

## Step 3: Verify Authorization

After attaching, make sure each resolver shows:
- **Authorization**: `AMAZON_COGNITO_USER_POOLS` (not API_KEY)

## Step 4: Test

1. Hard refresh your app (Ctrl+Shift+R)
2. Log out and log back in
3. Check console - 401 errors should be gone!

## Quick Test Script

```javascript
(async function() {
  const { generateClient } = await import('@aws-amplify/api');
  const client = generateClient();
  
  try {
    const result = await client.graphql({
      query: `query { __typename }`,
      authMode: 'userPool'
    });
    console.log('✅ GraphQL works!', result);
  } catch (error) {
    console.error('❌ Error:', error.errors);
  }
})();
```

## Important Notes

- The request/response mapping templates above assume your DynamoDB tables use `venueId` as partition key
- If your table structure is different, adjust the mapping templates accordingly
- Make sure your DynamoDB tables exist and have the correct structure
