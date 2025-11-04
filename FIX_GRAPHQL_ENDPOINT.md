# Fix: Set GraphQL Endpoint in Amplify Environment Variables

## The Problem

Your app is deployed on Amplify (`main.dbrzsy5y2d67d.amplifyapp.com`), but the `VITE_GRAPHQL_ENDPOINT` environment variable is likely not set in your Amplify deployment.

## The Fix

### Step 1: Get Your AppSync GraphQL Endpoint

1. Go to AWS Console → AppSync
2. Select your API
3. Go to **Settings** tab
4. Copy the **GraphQL API URL** (it looks like: `https://xxxxx.appsync-api.us-east-2.amazonaws.com/graphql`)

### Step 2: Add Environment Variable to Amplify

1. Go to AWS Console → Amplify
2. Select your app (`main.dbrzsy5y2d67d`)
3. Click **Environment variables** in the left sidebar
4. Click **Manage variables**
5. Click **Add variable**
6. Add:
   - **Key**: `VITE_GRAPHQL_ENDPOINT`
   - **Value**: Your AppSync GraphQL URL (from Step 1)
7. Click **Save**

### Step 3: Redeploy

After adding the environment variable, Amplify should automatically redeploy. If not:
1. Go to your app in Amplify Console
2. Click **Redeploy this version** or wait for the next deployment

## Verify It's Fixed

After redeployment, check the browser console:
1. Open your app
2. Press F12 → Console
3. Run: `console.log(import.meta.env.VITE_GRAPHQL_ENDPOINT)`
4. It should show your AppSync endpoint (not `undefined`)

## Alternative: Check Current Environment Variables

To see what's currently set in Amplify:

1. Go to AWS Console → Amplify → Your App
2. Click **Environment variables**
3. Look for `VITE_GRAPHQL_ENDPOINT`
4. If it's missing or empty, that's the problem!

## Quick Test After Fix

After adding the environment variable and redeploying, test in browser console:

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
  }
})();
```

If this test passes, your "Unauthorized" errors should be fixed!
