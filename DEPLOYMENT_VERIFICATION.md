# Deployment Verification Guide

## ✅ Pre-Deployment Checklist

Before deploying, verify the following:

### 1. Environment Variables (.env file)

```bash
# Required for authentication
VITE_COGNITO_USER_POOL_ID=us-east-2_I6EBJm3te
VITE_COGNITO_CLIENT_ID=4v7vp7trh72q1priqno9k5prsq
VITE_AWS_REGION=us-east-2

# REQUIRED: Your AppSync GraphQL endpoint
VITE_GRAPHQL_ENDPOINT=https://your-actual-endpoint.appsync-api.us-east-2.amazonaws.com/graphql

# Optional: DynamoDB table names (defaults provided)
VITE_SENSOR_DATA_TABLE=SensorData
VITE_VENUE_CONFIG_TABLE=VenueConfig
VITE_OCCUPANCY_METRICS_TABLE=OccupancyMetrics

# Optional: IoT endpoint
VITE_IOT_ENDPOINT=a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com
```

### 2. AWS AppSync Configuration

- ✅ AppSync API created with Cognito authentication
- ✅ GraphQL schema deployed with all queries
- ✅ Resolvers configured with security (extract venueId from JWT token)
- ✅ Data sources connected to DynamoDB tables
- ✅ IAM roles have permissions to query DynamoDB

### 3. DynamoDB Tables

- ✅ `SensorData` table exists with `venueId` as partition key
- ✅ `VenueConfig` table exists with `venueId` as partition key
- ✅ `OccupancyMetrics` table exists with `venueId` as partition key

### 4. Cognito User Pool

- ✅ User pool configured: `us-east-2_I6EBJm3te`
- ✅ Each user has `custom:venueId` attribute set
- ✅ Users can authenticate via email/password

---

## 🚀 Deployment Steps

### Step 1: Build the Application

```bash
npm install
npm run build
```

### Step 2: Deploy to Your Hosting Platform

The app will work with:
- AWS Amplify Hosting
- Vercel
- Netlify
- Any static hosting service

**Important**: Set environment variables in your hosting platform's console.

### Step 3: Set Environment Variables in Hosting Platform

Copy all variables from `.env` to your hosting platform's environment variables section.

---

## ✅ Post-Deployment Verification

### Test 1: App Loads Successfully

1. Navigate to your deployed app URL
2. Should redirect to `/login` if not authenticated
3. Login page should load without errors

### Test 2: User Authentication

1. Login with a user that has `custom:venueId` set
2. Should successfully authenticate
3. Should redirect to Dashboard

### Test 3: Data Loading (Your User)

After logging in with your username:

1. **Dashboard loads**: Should see dashboard interface
2. **VenueId extracted**: Check browser console (F12) - should see:
   ```
   🔍 Fetching live sensor data from DynamoDB for venue: YOUR_VENUE_ID
   ```
3. **Data loads**: Should see sensor data if it exists in DynamoDB
4. **No errors**: Should not see "GraphQL endpoint not configured" error

### Test 4: Multi-Tenant Isolation

1. **Login as User A** (venueId: "venue-123")
   - Should only see data for venue-123
   - Check console logs for venue-123 queries

2. **Login as User B** (venueId: "venue-456")
   - Should only see data for venue-456
   - Check console logs for venue-456 queries
   - Should NOT see any venue-123 data

### Test 5: Error Handling

1. **User without venueId**: Should show error message
2. **No data in DynamoDB**: Should show "No sensor data found" message
3. **Invalid GraphQL endpoint**: Should show configuration error

---

## 🔍 How It Works for Your Setup

### Authentication Flow

```
1. User logs in with username/password
   ↓
2. Cognito returns JWT token with custom:venueId
   ↓
3. Auth service extracts venueId from token
   ↓
4. Dashboard uses venueId for all queries
```

### Data Query Flow

```
1. User's venueId extracted from JWT: "your-venue-id"
   ↓
2. Dashboard calls: apiService.getLiveData("your-venue-id")
   ↓
3. DynamoDB service queries AppSync with venueId
   ↓
4. AppSync resolver extracts venueId from JWT (security)
   ↓
5. Resolver queries DynamoDB with venueId: "your-venue-id"
   ↓
6. Returns only data where venueId = "your-venue-id"
```

### What Happens When You Sign In

1. **Login**: Your username/password authenticates via Cognito
2. **Token received**: JWT contains your `custom:venueId` attribute
3. **App extracts venueId**: Automatically gets your venueId from the token
4. **Queries your data**: All DynamoDB queries use YOUR venueId
5. **Returns your data**: Only data matching your venueId is returned

---

## ✅ Yes, It Will Work!

**The app is fully dynamic and will work with your setup:**

1. ✅ **No hardcoded venueIds** - Everything comes from your Cognito user attributes
2. ✅ **Automatic venueId extraction** - App reads it from your JWT token
3. ✅ **Server-side security** - AppSync resolvers enforce venueId from token
4. ✅ **Dynamic data loading** - Queries your specific DynamoDB data automatically
5. ✅ **Multi-tenant ready** - Each user sees only their own data

### Your Specific Scenario

```
Your User: username@yourvenue.com
  ↓
Cognito User Attribute: custom:venueId = "your-venue-id"
  ↓
JWT Token: { custom:venueId: "your-venue-id" }
  ↓
App Extracts: venueId = "your-venue-id"
  ↓
Queries DynamoDB: WHERE venueId = "your-venue-id"
  ↓
Returns: Only your venue's data
```

---

## 🐛 Troubleshooting

### Issue: "GraphQL endpoint not configured"

**Solution**: Set `VITE_GRAPHQL_ENDPOINT` in your `.env` file and hosting platform

### Issue: "User does not have custom:venueId attribute"

**Solution**: Add `custom:venueId` to your Cognito user:
```bash
aws cognito-idp admin-update-user-attributes \
  --user-pool-id us-east-2_I6EBJm3te \
  --username your-username \
  --user-attributes Name=custom:venueId,Value=your-venue-id
```

### Issue: "No sensor data found for venue"

**Solution**: 
1. Verify your venueId matches data in DynamoDB
2. Check that data exists in SensorData table with correct venueId
3. Verify AppSync resolvers are configured correctly

### Issue: App loads but shows no data

**Checklist**:
1. ✅ GraphQL endpoint is set correctly
2. ✅ User has custom:venueId attribute
3. ✅ DynamoDB has data with matching venueId
4. ✅ AppSync resolvers are deployed
5. ✅ Browser console shows no errors

---

## 📊 Verification Commands

### Check User's venueId
```bash
aws cognito-idp admin-get-user \
  --user-pool-id us-east-2_I6EBJm3te \
  --username your-username
```

### Check DynamoDB Data
```bash
aws dynamodb query \
  --table-name SensorData \
  --key-condition-expression "venueId = :vid" \
  --expression-attribute-values '{":vid":{"S":"your-venue-id"}}'
```

### Test GraphQL Query (in AppSync Console)
```graphql
query {
  listSensorData(venueId: "your-venue-id", startTime: "2024-01-01T00:00:00Z", endTime: "2024-12-31T23:59:59Z") {
    items {
      venueId
      timestamp
      decibels
      indoorTemp
    }
  }
}
```

---

## ✅ Summary

**YES, the app will load and work correctly with your setup:**

- ✅ App loads dynamically based on environment variables
- ✅ Authentication works with any Cognito user
- ✅ Data loads automatically based on user's venueId
- ✅ Multi-tenant isolation enforced at server level
- ✅ No hardcoded values that would break different users/venues

**Just make sure:**
1. `.env` file has `VITE_GRAPHQL_ENDPOINT` set
2. Your Cognito user has `custom:venueId` attribute
3. Your DynamoDB has data with matching venueId
4. AppSync resolvers are deployed with security templates

Then when you sign in, the app will automatically:
- Extract your venueId from your JWT token
- Query your specific DynamoDB data
- Display only your venue's data
