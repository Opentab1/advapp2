# ✅ Complete AppSync Configuration - Remaining Steps

## Step 1: ✅ DONE - Add Cognito User Pool Authorization
You've added the authorization mode. Great!

## Step 2: Update Resolver Authorization Modes

Now you need to update each resolver to use Cognito User Pool auth:

1. Go to **AWS Console** → **AppSync** → Your API
2. Click **Schema** tab
3. Find these resolvers and update each one:
   - `listSensorData`
   - `listVenueLocations` 
   - `getOccupancyMetrics`

   **For each resolver:**
   - Click on the resolver name
   - Click **Configure** tab
   - Under **Authorization**, change from `API_KEY` to `AMAZON_COGNITO_USER_POOLS`
   - Click **Save**

## Step 3: Update Schema Directives

Update your GraphQL schema to use `@aws_cognito_user_pools`:

1. Go to **Schema** tab
2. Click **Edit Schema** button
3. Find queries that have `@aws_api_key` directive
4. Replace `@aws_api_key` with `@aws_cognito_user_pools`

**Example:**
```graphql
# Before (wrong):
type Query {
  listSensorData(venueId: ID!, startTime: String!, endTime: String!): SensorDataConnection
    @aws_api_key
}

# After (correct):
type Query {
  listSensorData(venueId: ID!, startTime: String!, endTime: String!): SensorDataConnection
    @aws_cognito_user_pools
}
```

Update these queries:
- `listSensorData`
- `listVenueLocations`
- `getOccupancyMetrics`
- `getSensorData` (if it exists)
- `getOccupancyMetrics` (if it exists)

4. Click **Save Schema**

## Step 4: Test the Fix

After updating resolvers and schema:

1. **Refresh your app** (hard refresh: Ctrl+Shift+R or Cmd+Shift+R)
2. **Log out and log back in** (to refresh tokens)
3. **Check the browser console** - the 401 errors should be gone!

## Quick Test

Run this in browser console after refreshing:

```javascript
(async function() {
  const { generateClient } = await import('@aws-amplify/api');
  const client = generateClient();
  
  try {
    const result = await client.graphql({
      query: `query { __typename }`,
      authMode: 'userPool'
    });
    console.log('✅ GraphQL is working!', result);
  } catch (error) {
    console.error('❌ Still failing:', error);
    console.error('Error:', error.errors);
  }
})();
```

## Troubleshooting

If you still get errors:

1. **Check resolver authorization** - Make sure each resolver is set to `AMAZON_COGNITO_USER_POOLS`
2. **Check schema directives** - Make sure all queries use `@aws_cognito_user_pools`
3. **Verify authorization mode** - Settings → Authorization modes should show Cognito User Pool
4. **Clear cache and refresh** - Hard refresh the browser

## What to Check

1. ✅ Authorization mode added (DONE)
2. ⏳ Resolvers updated to use Cognito User Pool
3. ⏳ Schema directives updated to `@aws_cognito_user_pools`
4. ⏳ Test the app

Once you complete steps 2 and 3, your 401 errors should be fixed!
