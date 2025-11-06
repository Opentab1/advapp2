# ✅ AWS Setup Checklist - Quick Verification

## 📋 Use this checklist to verify your AWS setup is complete

---

## 1. DynamoDB Tables

### SensorData Table
- [ ] Table name: `SensorData` (exact match, case-sensitive)
- [ ] Partition key: `venueId` (String)
- [ ] Sort key: `timestamp` (String)
- [ ] Capacity mode: On-demand (recommended)
- [ ] Status: Active

### VenueConfig Table
- [ ] Table name: `VenueConfig` (exact match)
- [ ] Partition key: `venueId` (String)
- [ ] Sort key: `locationId` (String)
- [ ] Status: Active
- [ ] Has entry for FergData:
  ```json
  {
    "venueId": "FergData",
    "locationId": "mainfloor",
    "displayName": "Main Floor",
    "mqttTopic": "pulse/FergData/mainfloor",
    "iotEndpoint": "a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com",
    "venueName": "Ferg's Sports Bar"
  }
  ```

### OccupancyMetrics Table (Optional - can skip for now)
- [ ] Table name: `OccupancyMetrics`
- [ ] Partition key: `venueId` (String)
- [ ] Status: Active (or not created yet)

---

## 2. AWS Cognito

### User Pool
- [ ] User Pool exists: `us-east-2_I6EBJm3te`
- [ ] App Client exists: `4v7vp7trh72q1priqno9k5prsq`
- [ ] Custom attributes configured:
  - [ ] `custom:venueId` (String, mutable)
  - [ ] `custom:venueName` (String, mutable)
  - [ ] `custom:role` (String, mutable)

### Test User
- [ ] User created: `test@venue.com` (or your email)
- [ ] Attributes set:
  - [ ] `custom:venueId` = "FergData"
  - [ ] `custom:venueName` = "Ferg's Sports Bar"
- [ ] Password set (permanent, not temporary)
- [ ] User status: CONFIRMED

---

## 3. AWS AppSync

### API
- [ ] API name: `PulseDashboardAPI` (or your chosen name)
- [ ] Region: `us-east-2`
- [ ] Status: Active

### Authentication
- [ ] **Settings** → **Authorization modes**
- [ ] Default authorization mode: **Amazon Cognito User Pools**
- [ ] User Pool: `us-east-2_I6EBJm3te`
- [ ] Default action: ALLOW

### GraphQL Schema
- [ ] Schema matches `APPSYNC_SCHEMA.graphql` in repo
- [ ] Key types to verify:
  - [ ] `SensorData` type
  - [ ] `Location` type
  - [ ] `Query.listSensorData`
  - [ ] `Query.listVenueLocations`
  - [ ] All queries have `@aws_cognito_user_pools` directive

### Data Sources
- [ ] **SensorDataTable**
  - Type: Amazon DynamoDB table
  - Table name: `SensorData`
  - Region: `us-east-2`
  - IAM role created with DynamoDB permissions

- [ ] **VenueConfigTable**
  - Type: Amazon DynamoDB table
  - Table name: `VenueConfig`
  - Region: `us-east-2`
  - IAM role created with DynamoDB permissions

### Resolvers (CRITICAL!)

#### Query.listSensorData
- [ ] Resolver attached
- [ ] Data source: `SensorDataTable`
- [ ] Request mapping template includes:
  ```vtl
  #set($userVenueId = $ctx.identity.claims.get("custom:venueId"))
  ```
- [ ] Uses venueId from JWT token (NOT from query args)

#### Query.listVenueLocations
- [ ] Resolver attached
- [ ] Data source: `VenueConfigTable`
- [ ] Request mapping template includes:
  ```vtl
  #set($userVenueId = $ctx.identity.claims.get("custom:venueId"))
  ```
- [ ] Uses venueId from JWT token

### GraphQL Endpoint
- [ ] Copy API URL from Settings
- [ ] Format: `https://xxxxx.appsync-api.us-east-2.amazonaws.com/graphql`
- [ ] **Saved in `.env` file as `VITE_GRAPHQL_ENDPOINT`**

---

## 4. Frontend Configuration

### .env File
- [ ] File exists in project root: `/workspace/.env`
- [ ] Contains:
  ```bash
  VITE_COGNITO_USER_POOL_ID=us-east-2_I6EBJm3te
  VITE_COGNITO_CLIENT_ID=4v7vp7trh72q1priqno9k5prsq
  VITE_AWS_REGION=us-east-2
  VITE_GRAPHQL_ENDPOINT=https://xxxxx.appsync-api.us-east-2.amazonaws.com/graphql
  ```
- [ ] **GraphQL endpoint is REAL URL (not placeholder)**

### AWS Amplify Deployment
- [ ] GitHub repo connected to AWS Amplify
- [ ] Branch: `main`
- [ ] Environment variables added in Amplify Console
- [ ] Build successful (check Amplify console)
- [ ] App URL working: `https://main.xxxxx.amplifyapp.com`

---

## 5. Testing Checklist

### Basic Login Test
- [ ] Go to app URL
- [ ] Enter test user credentials
- [ ] Successfully redirects to dashboard
- [ ] No authentication errors in console

### Dashboard Test
- [ ] Dashboard loads
- [ ] Shows "FergData" or "Ferg's Sports Bar" as venue name
- [ ] Shows "No data available" message (if no RPi connected)
- [ ] No GraphQL errors in console (F12)

### Console Logs (F12)
- [ ] See: `✅ Amplify configured successfully`
- [ ] See: `GraphQL Endpoint: https://xxxxx...`
- [ ] See: `🔍 Fetching locations from DynamoDB VenueConfig...`
- [ ] **NO** 401 Unauthorized errors
- [ ] **NO** GraphQL endpoint not configured errors

---

## 🐛 Common Issues

### "Unable to Load Data from DynamoDB"
**Check:**
- [ ] GraphQL endpoint in `.env` is correct
- [ ] User has `custom:venueId` attribute
- [ ] AppSync resolvers are attached
- [ ] Data sources are linked correctly

### "No sensor data found for venue"
**This is NORMAL if:**
- [ ] No Raspberry Pi connected yet
- [ ] No test data in DynamoDB
- [ ] This means everything is working! Just no data yet.

### "GraphQL endpoint not configured"
**Fix:**
- [ ] Add `.env` file with `VITE_GRAPHQL_ENDPOINT`
- [ ] Restart dev server: `npm run dev`
- [ ] Or redeploy to Amplify

### 401 Unauthorized Errors
**Check:**
- [ ] AppSync default auth mode is Cognito User Pools
- [ ] AppSync User Pool ID matches Cognito
- [ ] All queries have `@aws_cognito_user_pools` directive
- [ ] Resolvers use `$ctx.identity.claims`

---

## ✅ Ready to Test?

Once all checkboxes above are ✅, you're ready to:

1. **Test login** → Should work
2. **See dashboard** → Should show "No data available" (normal)
3. **Connect RPi** → Data will start flowing
4. **Watch magic happen** → Real-time updates! 🎉

---

## 📞 Need Help?

If stuck, check:
1. Browser console (F12) for errors
2. AppSync logs in CloudWatch
3. `DEPLOYMENT_GUIDE.md` for detailed setup
4. DynamoDB tables for actual data

---

**Good luck! You're almost there!** 🚀
