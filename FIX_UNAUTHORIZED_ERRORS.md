# Fix for "Unauthorized" Errors - Complete Guide

## Problem Identified ✅

You were getting "Unauthorized" errors when trying to access DynamoDB data because:

1. **Missing `.env` file**: The project didn't have a `.env` file configured
2. **GraphQL endpoint not set**: The `VITE_GRAPHQL_ENDPOINT` environment variable was not configured
3. **Missing auth mode**: Some GraphQL queries weren't explicitly specifying the authentication mode

## What Was Fixed ✅

### 1. Created `.env` File
- Created `/workspace/.env` from `.env.example`
- The file has all required environment variables but needs your actual AppSync endpoint

### 2. Updated Location Service Authentication
- **File**: `src/services/location.service.ts`
- **Change**: Added explicit `authMode: 'userPool'` to the GraphQL query
- This ensures the query uses your Cognito authentication token

### 3. Improved Configuration Validation
- **File**: `src/config/amplify.ts`
- **Changes**:
  - Added validation to check if `VITE_GRAPHQL_ENDPOINT` is configured
  - Added helpful console logging to show configuration status
  - Made error messages more descriptive

### 4. Created Helper Resources
- **`GET_APPSYNC_ENDPOINT.md`**: Step-by-step guide to get your AppSync endpoint
- **`get-appsync-endpoint.sh`**: Automated script to fetch your endpoint from AWS

## What You Need to Do Next 🚀

### Step 1: Get Your AppSync GraphQL Endpoint

**Option A - AWS Console (Easiest):**
1. Open [AWS Console](https://console.aws.amazon.com/)
2. Go to **AppSync** service
3. Click on your API (probably named `PulseDashboardAPI` or similar)
4. Copy the **API URL** (looks like: `https://xxxxx.appsync-api.us-east-2.amazonaws.com/graphql`)

**Option B - Use the Helper Script:**
```bash
./get-appsync-endpoint.sh
```

This script will:
- Find your AppSync API
- Display the GraphQL endpoint
- Show you the exact command to update your `.env` file

### Step 2: Update Your `.env` File

Open `.env` and replace this line:
```bash
VITE_GRAPHQL_ENDPOINT=https://your-appsync-api.appsync-api.us-east-2.amazonaws.com/graphql
```

With your actual endpoint:
```bash
VITE_GRAPHQL_ENDPOINT=https://YOUR_ACTUAL_ID.appsync-api.us-east-2.amazonaws.com/graphql
```

**Quick Command (after getting your endpoint):**
```bash
# Replace YOUR_ACTUAL_ID with your AppSync API ID
sed -i 's|VITE_GRAPHQL_ENDPOINT=.*|VITE_GRAPHQL_ENDPOINT=https://YOUR_ACTUAL_ID.appsync-api.us-east-2.amazonaws.com/graphql|' .env
```

### Step 3: Restart Your Application

**For Development:**
```bash
# Stop the dev server (Ctrl+C)
npm run dev
```

**For Production Deployment:**
```bash
npm run build
# Then redeploy to your hosting platform
```

### Step 4: Verify the Fix

After restarting, check the browser console (F12). You should see:
```
✅ Amplify configured successfully
   GraphQL Endpoint: https://xxxxx.appsync-api.us-east-2...
```

If you still see errors, check the detailed troubleshooting section below.

## Verification Checklist ✅

- [ ] `.env` file exists in project root
- [ ] `VITE_GRAPHQL_ENDPOINT` is set to your actual AppSync endpoint (not the placeholder)
- [ ] Dev server restarted after updating `.env`
- [ ] Browser console shows "Amplify configured successfully"
- [ ] No "Unauthorized" errors in console
- [ ] Locations are loading in the top bar
- [ ] Sensor data is displaying on the dashboard

## Troubleshooting

### Still Getting "Unauthorized" After Setting Endpoint?

1. **Check Cognito User Attributes**
   ```bash
   # Check if your user has custom:venueId
   aws cognito-idp admin-get-user \
     --user-pool-id us-east-2_I6EBJm3te \
     --username YOUR_EMAIL \
     --region us-east-2
   ```
   
   Look for `custom:venueId` in the output. If missing, add it:
   ```bash
   aws cognito-idp admin-update-user-attributes \
     --user-pool-id us-east-2_I6EBJm3te \
     --username YOUR_EMAIL \
     --user-attributes Name=custom:venueId,Value=FergData \
     --region us-east-2
   ```

2. **Check AppSync Authorization**
   - Go to AWS AppSync Console
   - Select your API
   - Click on "Settings"
   - Verify "Authorization mode" includes "Amazon Cognito User Pool"
   - Make sure it's pointing to user pool: `us-east-2_I6EBJm3te`

3. **Check DynamoDB VenueConfig Table**
   - Go to DynamoDB Console
   - Open `VenueConfig` table
   - Verify you have location entries with:
     - `venueId = "FergData"`
     - `locationId` (any unique ID)
     - `displayName` (location name to show in UI)
   
   **Example item:**
   ```json
   {
     "venueId": "FergData",
     "locationId": "main-location",
     "displayName": "Main Location",
     "address": "123 Main St",
     "timezone": "America/New_York",
     "deviceId": "device-001"
   }
   ```

4. **Check AppSync Resolvers**
   Your AppSync API should have these resolvers configured:
   - `Query.listVenueLocations` → Points to VenueConfig table
   - `Query.listSensorData` → Points to SensorData table
   - `Query.getSensorData` → Points to SensorData table
   - `Query.getOccupancyMetrics` → Points to OccupancyMetrics table

### Environment Variable Not Loading?

If the console still shows "NOT SET" after updating `.env`:

1. **Check file name**: Must be exactly `.env` (not `.env.txt` or `.env.local`)
2. **Check location**: Must be in project root directory
3. **Restart server**: Environment variables only load at startup
4. **Check syntax**: No spaces around the `=` sign
5. **Check encoding**: File should be UTF-8 encoded

**Verify the file:**
```bash
# Check if file exists
ls -la .env

# Check contents
cat .env | grep VITE_GRAPHQL_ENDPOINT

# Check for hidden characters
cat -A .env | grep VITE_GRAPHQL_ENDPOINT
```

### Clear Cache and Refresh

If you had cached location data from before:
1. Go to Settings page in the app
2. Click "Clear Cache"
3. Refresh the page
4. Log out and log back in

## Technical Details

### Files Modified

1. **`src/services/location.service.ts`** (Line 98-102)
   - Added `authMode: 'userPool'` to ensure authenticated GraphQL requests

2. **`src/config/amplify.ts`** (Lines 33-46)
   - Added endpoint validation with helpful error messages
   - Added configuration logging for debugging

3. **`.env`** (Created)
   - Contains all required environment variables
   - Needs your AppSync endpoint to be configured

### Authentication Flow

```
User Login → Cognito → Get JWT Token
                ↓
        Store Token in localStorage
                ↓
        Read custom:venueId from token
                ↓
        GraphQL Request with authMode: 'userPool'
                ↓
        AppSync verifies token
                ↓
        Query DynamoDB with venueId filter
                ↓
        Return data to dashboard
```

### Why This Happened

The authentication was working (you could log in), but the GraphQL requests were failing because:
1. The AppSync endpoint wasn't configured in the app
2. Some requests weren't explicitly using the user pool auth mode
3. Without proper configuration, the requests appeared "unauthorized" to AppSync

## Additional Resources

- **AppSync Setup**: See `DYNAMODB_SETUP.md` for complete AppSync configuration
- **Deployment Guide**: See `DEPLOYMENT_CHECKLIST.md` for production deployment
- **Environment Variables**: See `.env.example` for all available configuration options

## Support

If you're still experiencing issues after following this guide:

1. Check browser console (F12) for detailed error messages
2. Check CloudWatch logs in AWS Console for AppSync API logs
3. Verify all AWS resources are in the same region (us-east-2)
4. Make sure your Cognito user is confirmed and active

---

**Expected Result After Fix:**
- ✅ Login successful
- ✅ Locations loaded from DynamoDB
- ✅ Sensor data displayed on dashboard
- ✅ No "Unauthorized" errors
- ✅ Real-time data updates working
