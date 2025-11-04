# 🔧 FIX: AppSync 401 Unauthorized Error

## Problem
Your app is getting `401 Unauthorized` from AppSync. This means AppSync is rejecting your Cognito User Pool authentication.

## Root Cause
Your AppSync API likely only has **API Key** authorization enabled, but your code is using **Cognito User Pool** authentication.

## Solution: Enable Cognito User Pool Authorization in AppSync

### Step 1: Check Current Authorization Modes

1. Go to **AWS Console** → **AppSync**
2. Select your API: `sxxbnb3jnjdgxpojrbd3n3zltm`
3. Click **Settings** tab
4. Scroll to **Authorization modes** section
5. Check what's listed:
   - ✅ If you see "Amazon Cognito User Pool" → Go to Step 2
   - ❌ If you DON'T see "Amazon Cognito User Pool" → Go to Step 3

### Step 2: Verify User Pool Configuration

If Cognito User Pool is listed, verify it's configured correctly:

1. Click on **Authorization** tab
2. Find "Amazon Cognito User Pool" in the list
3. Verify it's configured with:
   - **User Pool ID**: `us-east-2_I6EBJm3te`
   - **App Client ID**: `4v7vp7trh72q1priqno9k5prsq`

If it's not configured correctly, update it or delete and recreate it.

### Step 3: Add Cognito User Pool Authorization (If Missing)

1. Go to **AWS Console** → **AppSync** → Your API
2. Click **Authorization** tab
3. Click **Create authorization provider**
4. Select **Amazon Cognito User Pool**
5. Configure:
   - **User Pool ID**: `us-east-2_I6EBJm3te`
   - **App Client ID**: `4v7vp7trh72q1priqno9k5prsq` (optional, but recommended)
6. Click **Create**

### Step 4: Update Resolver Authorization Modes

After adding Cognito User Pool authorization, update your resolvers:

1. Go to **Schema** tab
2. For each resolver (`listSensorData`, `listVenueLocations`, `getOccupancyMetrics`):
   - Click on the resolver
   - Go to **Configure** tab
   - Under **Authorization**, select `AMAZON_COGNITO_USER_POOLS`
   - Click **Save**

### Step 5: Update Schema Directives

Check your GraphQL schema and ensure directives use `@aws_cognito_user_pools`:

```graphql
type Query {
  listSensorData(venueId: ID!, startTime: String!, endTime: String!): SensorDataConnection
    @aws_cognito_user_pools  # ✅ Correct
    # NOT @aws_api_key        # ❌ Wrong
}

type Query {
  listVenueLocations(venueId: ID!): LocationConnection
    @aws_cognito_user_pools  # ✅ Correct
}

type Query {
  getOccupancyMetrics(venueId: ID!): OccupancyMetrics
    @aws_cognito_user_pools  # ✅ Correct
}
```

**To update schema:**
1. Go to **Schema** tab
2. Click **Edit Schema**
3. Find queries with `@aws_api_key` directives
4. Replace `@aws_api_key` with `@aws_cognito_user_pools`
5. Click **Save**

### Step 6: Test the Fix

After making changes:

1. Refresh your app
2. Log in again
3. Check browser console - the 401 errors should be gone

If you still get errors, check:
- Network tab → Failed request → Response tab → Copy the error message
- Console for detailed error logs

## Alternative: Check Error Details

To see the exact error AppSync is returning:

1. Open F12 → **Network** tab
2. Filter by `graphql` or `appsync`
3. Find the failed request (401 status)
4. Click on it
5. Go to **Response** tab
6. Copy the entire response body

The error will show something like:
- `"Not Authorized to access listSensorData on type Query"`
- `"Unauthorized"`
- `"Invalid authorization token"`

This will tell you exactly what's wrong.

## Quick Test Script

Run this in browser console to test:

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
    console.error('❌ Error:', error);
    console.error('Error details:', error.errors);
    console.error('Full error:', JSON.stringify(error, null, 2));
  }
})();
```

## Most Common Issue

**90% of the time**, the issue is:
- AppSync API only has API Key authorization enabled
- Code is trying to use Cognito User Pool authentication
- **Fix**: Enable Cognito User Pool authorization in AppSync Settings

## Need Help?

If you're still stuck:
1. Check Network tab → Response tab for the exact error
2. Run the test script above
3. Verify your AppSync API Settings → Authorization modes includes Cognito User Pool
