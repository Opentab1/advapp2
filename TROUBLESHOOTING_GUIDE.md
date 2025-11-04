# Troubleshooting Guide: "Unable to Load Data from DynamoDB"

## Problem
After login, you see this error:
```
Unable to Load Data from DynamoDB
Failed to fetch live data from DynamoDB: Failed to fetch live data from DynamoDB: undefined
```

## Root Cause
The `VITE_GRAPHQL_ENDPOINT` environment variable is not configured, causing the app to attempt GraphQL queries with an empty/invalid endpoint.

---

## Solution

### Step 1: Check if AWS AppSync is Set Up

First, verify you have an AWS AppSync GraphQL API created:

1. Go to [AWS AppSync Console](https://console.aws.amazon.com/appsync)
2. Look for an API named `PulseDashboardAPI` or similar
3. If it doesn't exist, **you need to create it first** (see below)

### Step 2: Get Your GraphQL Endpoint

If AppSync API exists:

1. Open your AppSync API in AWS Console
2. Go to **Settings**
3. Copy the **API URL** (example: `https://xxxxx.appsync-api.us-east-2.amazonaws.com/graphql`)

### Step 3: Configure Environment Variables

1. Open the `.env` file in your project root
2. Replace the placeholder with your actual AppSync API URL:

```env
VITE_GRAPHQL_ENDPOINT=https://your-actual-api-id.appsync-api.us-east-2.amazonaws.com/graphql
```

3. Save the file

### Step 4: Restart Development Server

```bash
npm run dev
```

### Step 5: Clear Browser Cache and Login Again

1. Hard refresh: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
2. Login with your credentials
3. The error should be gone!

---

## If You Haven't Set Up AWS AppSync Yet

You need to complete the AWS infrastructure setup first. Follow these steps:

### Quick Setup Checklist

- [ ] **Step 1:** Create DynamoDB tables (`SensorData`, `VenueConfig`, `OccupancyMetrics`)
- [ ] **Step 2:** Create AWS AppSync GraphQL API
- [ ] **Step 3:** Configure GraphQL schema
- [ ] **Step 4:** Create data sources for each DynamoDB table
- [ ] **Step 5:** Create resolvers for queries
- [ ] **Step 6:** Get API URL and update `.env`
- [ ] **Step 7:** Configure Cognito user with `custom:venueId` attribute

📚 **See the complete guide:** [DYNAMODB_SETUP.md](./DYNAMODB_SETUP.md)

---

## Quick Verification Checklist

Before opening the app, verify:

✅ **Environment Variables**
```bash
cat .env | grep VITE_GRAPHQL_ENDPOINT
# Should show: VITE_GRAPHQL_ENDPOINT=https://xxxxx.appsync-api.us-east-2.amazonaws.com/graphql
```

✅ **AppSync API exists**
- Go to AWS AppSync Console
- API should be visible and in "Active" state

✅ **DynamoDB Tables exist**
- Go to AWS DynamoDB Console
- Tables: `SensorData`, `VenueConfig`, `OccupancyMetrics` should exist

✅ **User has venueId attribute**
- Go to AWS Cognito → Users → Select your user
- Should have `custom:venueId` attribute (e.g., `FergData`)

✅ **DynamoDB has data**
- Go to DynamoDB → `SensorData` table
- Should have at least one item with `venueId = FergData`

---

## Alternative: Check AppSync GraphQL Endpoint in Code

You can also verify the endpoint is loaded correctly by checking browser console:

```javascript
// Open browser console (F12) and paste:
console.log('GraphQL Endpoint:', import.meta.env.VITE_GRAPHQL_ENDPOINT);
```

If this shows `undefined` or empty string, the `.env` file is not loaded correctly.

---

## Common Mistakes

### ❌ Wrong file location
The `.env` file must be in the **project root** (same folder as `package.json`), not in `src/`

### ❌ Forgot to restart dev server
Environment variables are only loaded on server start. You must restart:
```bash
# Stop server (Ctrl+C)
npm run dev
```

### ❌ Using production build
If you built the app for production, you need to rebuild:
```bash
npm run build
```

### ❌ AppSync endpoint is wrong
Double-check the URL format:
- ✅ Correct: `https://xxxxx.appsync-api.us-east-2.amazonaws.com/graphql`
- ❌ Wrong: `https://xxxxx.appsync-api.us-east-2.amazonaws.com` (missing `/graphql`)
- ❌ Wrong: `xxxxx.appsync-api.us-east-2.amazonaws.com/graphql` (missing `https://`)

---

## Still Not Working?

### Check Browser Console (F12)

Look for specific error messages:
- `NetworkError`: AppSync endpoint is wrong or unreachable
- `Unauthorized`: Cognito authentication issue
- `GraphQL error`: Resolver or schema issue

### Test AppSync Directly

1. Go to AWS AppSync Console → Queries
2. Try running this query:
```graphql
query TestQuery {
  getSensorData(venueId: "FergData", timestamp: "2025-11-04T10:00:00.000Z") {
    venueId
    timestamp
    decibels
  }
}
```
3. If this fails, the issue is in AppSync setup, not the frontend

### Check AppSync Logs

1. Go to AWS AppSync Console → Settings → Logging
2. Enable CloudWatch logs
3. Check logs for errors

---

## Need More Help?

- 📖 [Complete Setup Guide](./DYNAMODB_SETUP.md)
- 🚀 [Quick Start Guide](./QUICK_START.md)
- 💬 Contact your AWS administrator for infrastructure help

---

## Success Indicators

When everything is working, you should see:
1. ✅ No error message on dashboard
2. ✅ Live metrics displayed
3. ✅ Browser console shows: "✅ Live data received from DynamoDB"
4. ✅ Your venueId displayed in UI: `FergData`
