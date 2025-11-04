# 🔍 Diagnostic Checklist: Why Data Isn't Showing After Sign-In

## Critical Requirements Checklist

### ✅ **1. Cognito User Attributes (MOST COMMON ISSUE)**

**Problem:** User doesn't have `custom:venueId` attribute set.

**Check:**
```bash
aws cognito-idp admin-get-user \
  --user-pool-id us-east-2_I6EBJm3te \
  --username YOUR_EMAIL@example.com
```

**Look for:**
- ✅ `custom:venueId` attribute exists
- ✅ Value matches your DynamoDB `venueId` values
- ✅ `UserStatus: CONFIRMED`
- ✅ `email_verified: true`

**Fix if missing:**
```bash
aws cognito-idp admin-update-user-attributes \
  --user-pool-id us-east-2_I6EBJm3te \
  --username YOUR_EMAIL@example.com \
  --user-attributes Name=custom:venueId,Value=YOUR_VENUE_ID
```

---

### ✅ **2. GraphQL Endpoint Configuration**

**Problem:** `VITE_GRAPHQL_ENDPOINT` not set in `.env` file.

**Check:**
1. Does `.env` file exist in project root?
2. Does it have `VITE_GRAPHQL_ENDPOINT` set?
3. Is the endpoint URL correct?

**Fix:**
1. Create `.env` file if missing:
   ```bash
   cp .env.example .env
   ```

2. Set your AppSync endpoint:
   ```env
   VITE_GRAPHQL_ENDPOINT=https://YOUR_API_ID.appsync-api.us-east-2.amazonaws.com/graphql
   ```

3. Get your AppSync endpoint:
   ```bash
   aws appsync list-graphql-apis --region us-east-2
   aws appsync get-graphql-api --api-id YOUR_API_ID --region us-east-2
   ```

4. **Restart dev server** after changing `.env`:
   ```bash
   npm run dev
   ```

---

### ✅ **3. DynamoDB Tables Exist**

**Problem:** Tables don't exist or are empty.

**Check:**
```bash
# List tables
aws dynamodb list-tables --region us-east-2

# Check SensorData table
aws dynamodb scan --table-name SensorData --region us-east-2 --max-items 5

# Check VenueConfig table
aws dynamodb scan --table-name VenueConfig --region us-east-2 --max-items 5
```

**Required Tables:**
- ✅ `SensorData` (partition key: `venueId`, sort key: `timestamp`)
- ✅ `VenueConfig` (partition key: `venueId`, sort key: `locationId`)
- ✅ `OccupancyMetrics` (partition key: `venueId`)

**Fix:** Create tables if missing (see `DYNAMODB_SETUP.md`)

---

### ✅ **4. DynamoDB Has Data for Your Venue**

**Problem:** No data exists for your `venueId`.

**Check:**
```bash
# Query SensorData for your venue
aws dynamodb query \
  --table-name SensorData \
  --key-condition-expression "venueId = :vid" \
  --expression-attribute-values '{":vid":{"S":"YOUR_VENUE_ID"}}' \
  --region us-east-2 \
  --limit 5

# Query VenueConfig for your venue
aws dynamodb query \
  --table-name VenueConfig \
  --key-condition-expression "venueId = :vid" \
  --expression-attribute-values '{":vid":{"S":"YOUR_VENUE_ID"}}' \
  --region us-east-2
```

**Fix:** 
- If no data: Your RPi device needs to publish sensor data to DynamoDB
- If no VenueConfig: Add location entries (see Step 5 in user creation guide)

---

### ✅ **5. AppSync API Configured**

**Problem:** AppSync API not set up or resolvers not attached.

**Check:**
```bash
# List AppSync APIs
aws appsync list-graphql-apis --region us-east-2

# Check API details
aws appsync get-graphql-api --api-id YOUR_API_ID --region us-east-2

# Check if resolvers exist
aws appsync list-resolvers --api-id YOUR_API_ID --type-name Query --region us-east-2
```

**Required Queries:**
- ✅ `listSensorData`
- ✅ `listVenueLocations`
- ✅ `getOccupancyMetrics`

**Fix:** If missing, create resolvers (see `DYNAMODB_SETUP.md` Step 5)

---

### ✅ **6. AppSync Resolvers Security**

**Problem:** Resolvers not extracting `venueId` from JWT token correctly.

**Check Request Mapping Template:**
```vtl
#set($userVenueId = $ctx.identity.claims.get("custom:venueId"))

#if(!$userVenueId)
  $util.error("User does not have custom:venueId attribute.")
#end

#set($venueId = $userVenueId)  # Use from token, not args!
```

**Fix:** Ensure resolvers use `$userVenueId` from token, not from query arguments.

---

### ✅ **7. Browser Console Errors**

**Check browser console (F12) for:**
- ❌ "GraphQL endpoint not configured"
- ❌ "User does not have custom:venueId attribute"
- ❌ "No sensor data found for venue: X"
- ❌ Network errors (CORS, 401, 403)
- ❌ GraphQL errors

**Common Errors:**

**Error:** "GraphQL endpoint not configured"
- **Fix:** Set `VITE_GRAPHQL_ENDPOINT` in `.env`

**Error:** "User does not have custom:venueId attribute"
- **Fix:** Add `custom:venueId` to Cognito user

**Error:** "No sensor data found for venue: X"
- **Fix:** Check DynamoDB has data for that `venueId`

**Error:** "Unauthorized" or "401"
- **Fix:** Check Cognito token is valid, user is confirmed

---

### ✅ **8. Authentication Flow**

**Check:**
1. User can log in successfully?
2. Token is stored in localStorage?
3. Token contains `custom:venueId`?

**Test in browser console:**
```javascript
// Check stored token
localStorage.getItem('pulse_auth_token')

// Check stored user
JSON.parse(localStorage.getItem('pulse_user'))

// Check venueId
const user = JSON.parse(localStorage.getItem('pulse_user'));
console.log('VenueId:', user?.venueId);
```

---

## Quick Diagnostic Script

Run this to check everything:

```bash
# 1. Check Cognito user
aws cognito-idp admin-get-user \
  --user-pool-id us-east-2_I6EBJm3te \
  --username YOUR_EMAIL@example.com \
  | grep -A 5 "custom:venueId"

# 2. Check GraphQL endpoint
grep VITE_GRAPHQL_ENDPOINT .env

# 3. Check DynamoDB tables
aws dynamodb list-tables --region us-east-2 | grep -E "SensorData|VenueConfig|OccupancyMetrics"

# 4. Check if data exists for your venue
VENUE_ID="YOUR_VENUE_ID"
aws dynamodb query \
  --table-name SensorData \
  --key-condition-expression "venueId = :vid" \
  --expression-attribute-values "{\":vid\":{\"S\":\"$VENUE_ID\"}}" \
  --region us-east-2 \
  --limit 1
```

---

## Most Likely Issues (In Order)

1. **Missing `custom:venueId` attribute** (90% of cases)
2. **Missing/incorrect `VITE_GRAPHQL_ENDPOINT` in `.env`** (80% of cases)
3. **No data in DynamoDB for that `venueId`** (70% of cases)
4. **AppSync resolvers not configured** (50% of cases)
5. **DynamoDB tables don't exist** (30% of cases)

---

## Next Steps

1. Run through this checklist
2. Fix any issues found
3. Clear browser cache and localStorage
4. Restart dev server
5. Log in again and check browser console
