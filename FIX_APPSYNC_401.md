# Fix: AppSync 401 Unauthorized Error

## Problem Identified

Your console shows:
- ✅ GraphQL endpoint is configured: `https://sxxbnb3jnjdgxpojrbd3n3zltm.appsync-api.us-east-2.amazonaws.com/graphql`
- ✅ Requests are reaching AppSync
- ❌ Getting `401 Unauthorized` with `{data: {…}, errors: Array(1)}`

This means **AppSync is rejecting your Cognito User Pool authentication**.

## Most Likely Causes

### 1. AppSync API Authorization Mode Not Configured

Your AppSync API might not have "Amazon Cognito User Pool" enabled as an authorization mode.

**Check:**
1. Go to AWS Console → AppSync
2. Select your API (`sxxbnb3jnjdgxpojrbd3n3zltm`)
3. Go to **Settings** tab
4. Check **Authorization modes**
5. Verify "Amazon Cognito User Pool" is listed and enabled

**Fix:**
- If missing, add it:
  1. Go to **Authorization** tab
  2. Click **Create authorization provider**
  3. Choose **Amazon Cognito User Pool**
  4. Select your User Pool: `us-east-2_I6EBJm3te`
  5. Save

### 2. GraphQL Resolvers Using Wrong Auth Mode

Your resolvers might be configured to use API Key auth instead of User Pool.

**Check:**
1. Go to AWS Console → AppSync → Your API
2. Go to **Schema** tab
3. Click on each resolver (e.g., `listSensorData`, `listVenueLocations`, `getOccupancyMetrics`)
4. Check the **Authorization mode** - should be `AMAZON_COGNITO_USER_POOLS`

**Fix:**
- If resolvers use API Key, change them:
  1. Click on resolver
  2. Go to **Configure** tab
  3. Under **Authorization**, select `AMAZON_COGNITO_USER_POOLS`
  4. Save

### 3. Schema-Level Authorization

Your GraphQL schema might have `@aws_api_key` directive instead of `@aws_cognito_user_pools`.

**Check:**
1. Go to AWS Console → AppSync → Your API
2. Go to **Schema** tab
3. Look at your schema - directives should be `@aws_cognito_user_pools`, not `@aws_api_key`

**Fix:**
- Update schema directives:
```graphql
type Query {
  listSensorData(venueId: ID!, startTime: String!, endTime: String!): SensorDataConnection
    @aws_cognito_user_pools  # Not @aws_api_key
}

type Query {
  listVenueLocations(venueId: ID!): LocationConnection
    @aws_cognito_user_pools  # Not @aws_api_key
}
```

### 4. Check Actual Error Response

To see the exact error, check Network tab:

1. Open F12 → Network tab
2. Find the failed request to `appsync-api.us-east-2.amazonaws.com/graphql`
3. Click on it
4. Go to **Response** tab
5. Copy the error response - it will show exactly what AppSync is complaining about

## Quick Diagnostic

Run this in browser console to see detailed error:

```javascript
(async function() {
  const { generateClient } = await import('@aws-amplify/api');
  const client = generateClient();
  
  try {
    const result = await client.graphql({
      query: `query { __typename }`,
      authMode: 'userPool'
    });
    console.log('✅ Success:', result);
  } catch (error) {
    console.error('❌ Full error:', error);
    console.error('Error response:', error.errors);
    console.error('Error data:', error.data);
  }
})();
```

## Most Common Fix

**90% of the time, the issue is:**

Your AppSync API only has **API Key** authorization enabled, but your code is using **User Pool** auth.

**Solution:**
1. AWS Console → AppSync → Your API → Settings
2. Under **Authorization modes**, ensure "Amazon Cognito User Pool" is enabled
3. If not, add it with your User Pool ID: `us-east-2_I6EBJm3te`
4. Update all resolvers to use `AMAZON_COGNITO_USER_POOLS` auth mode
5. Update schema directives to use `@aws_cognito_user_pools`

## Verify Fix

After making changes, test in browser console:

```javascript
(async function() {
  const { generateClient } = await import('@aws-amplify/api');
  const { fetchAuthSession } = await import('@aws-amplify/auth');
  
  const session = await fetchAuthSession();
  console.log('Session:', session.tokens ? '✅ Has tokens' : '❌ No tokens');
  
  const client = generateClient();
  try {
    const result = await client.graphql({
      query: `query { __typename }`,
      authMode: 'userPool'
    });
    console.log('✅ GraphQL works!', result);
  } catch (error) {
    console.error('❌ Still failing:', error);
  }
})();
```

If this test passes, your "Unauthorized" errors should be fixed!
