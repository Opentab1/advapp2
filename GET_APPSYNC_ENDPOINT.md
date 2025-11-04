# How to Get Your AppSync GraphQL Endpoint

## Problem
You're seeing "Unauthorized" errors because the `.env` file doesn't have your AppSync GraphQL endpoint configured.

## Solution

### Step 1: Get Your AppSync Endpoint from AWS Console

1. Open your AWS Console and go to the **AppSync** service
2. Click on your API (should be named something like `PulseDashboardAPI` or similar)
3. On the API details page, look for the **API URL** or **GraphQL endpoint**
4. Copy the full URL (it should look like: `https://xxxxx.appsync-api.us-east-2.amazonaws.com/graphql`)

### Step 2: Use AWS CLI (Alternative)

If you prefer using the AWS CLI:

```bash
# List all AppSync APIs
aws appsync list-graphql-apis --region us-east-2

# Look for your API in the output and copy the "uris.GRAPHQL" value
```

### Step 3: Update Your .env File

1. Open the `.env` file in your project root (it was just created from `.env.example`)
2. Find the line that says:
   ```
   VITE_GRAPHQL_ENDPOINT=https://your-appsync-api.appsync-api.us-east-2.amazonaws.com/graphql
   ```
3. Replace the URL with your actual AppSync endpoint:
   ```
   VITE_GRAPHQL_ENDPOINT=https://YOUR_ACTUAL_ID.appsync-api.us-east-2.amazonaws.com/graphql
   ```
4. Save the file

### Step 4: Restart Your Development Server

After updating the `.env` file, you need to restart your dev server:

```bash
# Stop the current server (Ctrl+C)
# Then start it again
npm run dev
```

Or if deployed, rebuild and redeploy:

```bash
npm run build
# Then deploy using your hosting platform
```

## Verification

After restarting, you should see in the browser console:
```
✅ Amplify configured successfully
   GraphQL Endpoint: https://xxxxx.appsync-api.us-east-2...
```

If you still see "NOT SET", the `.env` file wasn't loaded correctly. Make sure:
- The file is named exactly `.env` (not `.env.txt`)
- It's in the root directory of the project
- You restarted the dev server after creating it

## Quick Check Script

Run this to verify your configuration:

```bash
# Check if .env exists
ls -la .env

# Check the GraphQL endpoint value
grep VITE_GRAPHQL_ENDPOINT .env
```

## Still Having Issues?

If you're still getting "Unauthorized" errors after setting the endpoint:

1. **Check Cognito User Attributes**: Make sure your user has `custom:venueId` attribute set
2. **Check AppSync Authorization**: Make sure your AppSync API is configured to use Cognito User Pool authentication
3. **Check VenueConfig Table**: Make sure you have location entries in DynamoDB for your `venueId`
4. **Check Browser Console**: Look for detailed error messages that might indicate the specific issue

## Example Working Configuration

Your `.env` file should look like this:

```bash
# AWS Cognito Configuration (already set)
VITE_COGNITO_USER_POOL_ID=us-east-2_I6EBJm3te
VITE_COGNITO_CLIENT_ID=4v7vp7trh72q1priqno9k5prsq
VITE_AWS_REGION=us-east-2

# GraphQL API Configuration (REQUIRED - update this!)
VITE_GRAPHQL_ENDPOINT=https://abcd1234efgh.appsync-api.us-east-2.amazonaws.com/graphql

# DynamoDB Table Names (Optional)
VITE_SENSOR_DATA_TABLE=SensorData
VITE_VENUE_CONFIG_TABLE=VenueConfig
VITE_OCCUPANCY_METRICS_TABLE=OccupancyMetrics

# AWS IoT Core (Optional)
VITE_IOT_ENDPOINT=a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com
```
