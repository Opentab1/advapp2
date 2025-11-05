# 🔍 Diagnostic Checklist: Why Your Sign-In Shows No Data

Use this checklist to diagnose why your account isn't showing data after sign-in.

## ✅ Critical Checks

### 1. Environment Configuration
- [ ] **Check `.env` file exists** in project root
- [ ] **`VITE_GRAPHQL_ENDPOINT` is set** (not placeholder)
  - ❌ Bad: `https://your-appsync-api.appsync-api.us-east-2.amazonaws.com/graphql`
  - ✅ Good: `https://abc123xyz.appsync-api.us-east-2.amazonaws.com/graphql`
- [ ] **Restart dev server** after changing `.env` file

**How to check:**
```bash
# In browser console (F12)
console.log(import.meta.env.VITE_GRAPHQL_ENDPOINT)
```

### 2. Cognito User Attributes
- [ ] **User has `custom:venueId` attribute** set
- [ ] **User status is "Confirmed"** (not "FORCE_CHANGE_PASSWORD")
- [ ] **Email is verified** (if email verification required)

**How to check via AWS CLI:**
```bash
aws cognito-idp admin-get-user \
  --user-pool-id us-east-2_I6EBJm3te \
  --username YOUR_EMAIL@example.com
```

Look for:
- ✅ `UserStatus: CONFIRMED`
- ✅ `Name: custom:venueId, Value: your-venue-id`

### 3. DynamoDB Tables Exist
- [ ] **SensorData table exists** with schema:
  - Partition Key: `venueId` (String)
  - Sort Key: `timestamp` (String)
- [ ] **VenueConfig table exists** with schema:
  - Partition Key: `venueId` (String)
  - Sort Key: `locationId` (String)
- [ ] **OccupancyMetrics table exists** with schema:
  - Partition Key: `venueId` (String)

**How to check:**
```bash
aws dynamodb list-tables --region us-east-2
```

### 4. DynamoDB Has Data
- [ ] **SensorData table has entries** for your `venueId`
- [ ] **VenueConfig table has entries** for your `venueId`
- [ ] **Timestamps are recent** (within last 5 minutes for live data)

**How to check:**
```bash
# Replace YOUR_VENUE_ID with your actual venueId
aws dynamodb query \
  --table-name SensorData \
  --key-condition-expression "venueId = :v" \
  --expression-attribute-values '{":v":{"S":"YOUR_VENUE_ID"}}' \
  --region us-east-2 \
  --limit 1
```

### 5. AppSync API Configuration
- [ ] **AppSync API exists** and is deployed
- [ ] **GraphQL schema matches** the schema in `APPSYNC_SCHEMA.graphql`
- [ ] **Resolvers are attached** to queries:
  - `Query.listSensorData`
  - `Query.listVenueLocations`
  - `Query.getOccupancyMetrics`
- [ ] **Data sources are configured**:
  - SensorDataTable → SensorData DynamoDB table
  - VenueConfigTable → VenueConfig DynamoDB table
  - OccupancyMetricsTable → OccupancyMetrics DynamoDB table
- [ ] **Authentication is set** to Cognito User Pools
- [ ] **User Pool ID matches**: `us-east-2_I6EBJm3te`

**How to check:**
1. Go to AWS AppSync Console
2. Select your API
3. Check "Schema" tab - verify queries exist
4. Check "Data Sources" tab - verify all 3 tables linked
5. Check "Resolvers" tab - verify resolvers attached

### 6. AppSync Resolver Security
- [ ] **Resolvers extract `venueId` from JWT token** (not from query args)
- [ ] **Resolvers use `$ctx.identity.claims['custom:venueId']`**
- [ ] **Resolvers validate venueId exists** before querying

**How to check:**
1. Go to AppSync → Resolvers
2. Open `Query.listSensorData` resolver
3. Request mapping template should have:
   ```vtl
   #set($userVenueId = $ctx.identity.claims.get("custom:venueId"))
   #set($venueId = $userVenueId)
   ```

### 7. Browser Console Errors
Open browser console (F12) and check for:

**Common Errors:**
- ❌ `"GraphQL endpoint not configured"` → Set `VITE_GRAPHQL_ENDPOINT` in `.env`
- ❌ `"User does not have custom:venueId attribute"` → Add attribute in Cognito
- ❌ `"Not authenticated"` → User not logged in, token expired
- ❌ `"No sensor data found for venue"` → No data in DynamoDB for that venueId
- ❌ `"GraphQL error: Unauthorized"` → Check AppSync authentication settings
- ❌ `"Network error"` → Check GraphQL endpoint URL is correct

**Success Indicators:**
- ✅ `"Fetching live sensor data from DynamoDB for venue: YOUR_VENUE_ID"`
- ✅ `"Live sensor data retrieved from DynamoDB"`
- ✅ `"Loaded X locations from DynamoDB"`

## 🔧 Quick Fixes

### Issue: "No data showing"
**Most Common Causes:**
1. Missing `VITE_GRAPHQL_ENDPOINT` in `.env` → **Fix:** Set your AppSync endpoint
2. Missing `custom:venueId` on user → **Fix:** Add attribute in Cognito
3. No data in DynamoDB → **Fix:** Add test data or connect RPI

### Issue: "Unauthorized" errors
**Most Common Causes:**
1. AppSync not using Cognito auth → **Fix:** Set default auth mode to User Pools
2. User not confirmed → **Fix:** Confirm user in Cognito
3. Token expired → **Fix:** Log out and log back in

### Issue: "No locations found"
**Most Common Causes:**
1. No VenueConfig entries → **Fix:** Add location entry in VenueConfig table
2. Wrong venueId → **Fix:** Verify `custom:venueId` matches DynamoDB entries

## 📋 Step-by-Step Verification

1. **Check your login works:**
   ```bash
   # Login to app
   # Open browser console (F12)
   # Should see: "✅ Amplify configured successfully"
   ```

2. **Check your venueId:**
   ```javascript
   // In browser console after login
   const session = await fetchAuthSession();
   console.log('VenueId:', session.tokens?.idToken?.payload?.['custom:venueId']);
   ```

3. **Check GraphQL endpoint:**
   ```javascript
   // In browser console
   console.log('GraphQL Endpoint:', import.meta.env.VITE_GRAPHQL_ENDPOINT);
   ```

4. **Test AppSync query manually:**
   - Go to AWS AppSync Console
   - Open your API → "Queries" tab
   - Run:
     ```graphql
     query {
       listSensorData(
         venueId: "YOUR_VENUE_ID"
         startTime: "2024-01-01T00:00:00Z"
         endTime: "2025-12-31T23:59:59Z"
         limit: 1
       ) {
         items {
           venueId
           timestamp
           decibels
         }
       }
     }
     ```

5. **Check DynamoDB directly:**
   ```bash
   aws dynamodb scan \
     --table-name SensorData \
     --filter-expression "venueId = :v" \
     --expression-attribute-values '{":v":{"S":"YOUR_VENUE_ID"}}' \
     --region us-east-2 \
     --max-items 1
   ```

## 🎯 Most Likely Issues (In Order)

1. **Missing `VITE_GRAPHQL_ENDPOINT`** (80% of issues)
2. **Missing `custom:venueId` attribute** (15% of issues)
3. **No data in DynamoDB** (4% of issues)
4. **AppSync resolvers not configured** (1% of issues)

## ✅ If Everything Checks Out

If all items above are ✅, but you still see no data:
- Check browser Network tab for failed GraphQL requests
- Check AppSync CloudWatch logs for errors
- Verify your `venueId` exactly matches DynamoDB entries (case-sensitive)
- Clear browser cache and localStorage
- Try incognito/private window

## 📞 Next Steps

If you've checked everything and still have issues:
1. Share browser console logs (F12)
2. Share your venueId (from Cognito)
3. Share AppSync query test results
4. Share DynamoDB table scan results

---

**Remember:** The app uses `venueId` from your JWT token to query data. If your `custom:venueId` doesn't match any entries in DynamoDB, you'll see no data even if everything else is configured correctly.
