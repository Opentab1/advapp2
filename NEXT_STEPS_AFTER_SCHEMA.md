# ✅ Next Steps After Schema Update

## Step 1: Check Resolvers Were Created

After saving the schema, AppSync should have created resolvers automatically.

1. Go to **Schema** tab
2. Click **Resolvers** (or scroll down to see resolvers)
3. You should see these resolvers:
   - `Query.getSensorData`
   - `Query.listSensorData`
   - `Query.listVenueLocations`
   - `Query.getOccupancyMetrics`
   - `Query.getVenueConfig`

## Step 2: Configure Each Resolver

For **EACH** resolver, you need to:

### A. Set Authorization Mode

1. Click on the resolver name
2. Click **Configure** tab
3. Under **Authorization**, select `AMAZON_COGNITO_USER_POOLS`
4. Click **Save**

### B. Configure Data Source (Most Important!)

Each resolver needs to point to the correct DynamoDB table:

#### 1. `getSensorData` and `listSensorData` resolvers:
- **Data source**: Create or select a data source pointing to `SensorData` DynamoDB table
- **Request mapping template**: Use AppSync resolver templates for DynamoDB queries
- **Response mapping template**: `$util.toJson($ctx.result)`

#### 2. `listVenueLocations` resolver:
- **Data source**: Create or select a data source pointing to `VenueConfig` DynamoDB table
- **Request mapping template**: Query by `venueId`
- **Response mapping template**: `$util.toJson($ctx.result)`

#### 3. `getOccupancyMetrics` resolver:
- **Data source**: Create or select a data source pointing to `OccupancyMetrics` DynamoDB table
- **Request mapping template**: Get item by `venueId`
- **Response mapping template**: `$util.toJson($ctx.result)`

#### 4. `getVenueConfig` resolver:
- **Data source**: Create or select a data source pointing to `VenueConfig` DynamoDB table
- **Request mapping template**: Get item by `venueId` and `locationId`
- **Response mapping template**: `$util.toJson($ctx.result)`

## Step 3: Create Data Sources (If Needed)

If you don't have data sources yet:

1. Go to **Data Sources** tab
2. Click **Create data source**
3. For each table, create a data source:
   - **SensorData** table
   - **VenueConfig** table
   - **OccupancyMetrics** table

## Step 4: Quick Test

After configuring resolvers:

1. **Hard refresh your app** (Ctrl+Shift+R or Cmd+Shift+R)
2. **Log out and log back in**
3. **Check browser console** - 401 errors should be gone!

## Step 5: Test in Browser Console

Run this to verify:

```javascript
(async function() {
  const { generateClient } = await import('@aws-amplify/api');
  const client = generateClient();
  
  try {
    const result = await client.graphql({
      query: `query { __typename }`,
      authMode: 'userPool'
    });
    console.log('✅ GraphQL connection works!', result);
  } catch (error) {
    console.error('❌ Still failing:', error);
    console.error('Error:', error.errors);
  }
})();
```

## Troubleshooting

If you still get errors:

1. **Check resolver authorization** - Make sure each resolver uses `AMAZON_COGNITO_USER_POOLS`
2. **Check data sources** - Make sure resolvers are connected to DynamoDB tables
3. **Check resolver mapping templates** - Make sure they're configured correctly for DynamoDB queries
4. **Check DynamoDB tables exist** - `SensorData`, `VenueConfig`, `OccupancyMetrics`

## What to Check Right Now

1. ✅ Schema saved (DONE)
2. ⏳ Resolvers created and configured
3. ⏳ Data sources connected to DynamoDB tables
4. ⏳ Test the app

**Most important**: Make sure each resolver's **Authorization** is set to `AMAZON_COGNITO_USER_POOLS`!
