# Dashboard Personalization Implementation

## Overview
This document describes the changes made to fully personalize the dashboard with user-specific venueId from Cognito, removing all hardcoded venue fallbacks.

## Date: 2025-11-04

---

## Changes Made

### 1. **Updated `/src/config/amplify.ts`**

**Before:**
```typescript
export const VENUE_CONFIG = {
  venueId: 'fergs-stpete',
  locationId: 'main-floor',
  venueName: "Ferg's Sports Bar",
  locationName: 'Main Floor',
  region: 'us-east-2',
  iotEndpoint: 'a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com'
};
```

**After:**
```typescript
export const AWS_CONFIG = {
  region: 'us-east-2',
  // Default IoT endpoint for the region (can be overridden by VenueConfig)
  defaultIotEndpoint: 'a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com'
};
```

**Impact:** Removed all hardcoded venue-specific values. Only AWS region-level configuration remains.

---

### 2. **Updated `/src/services/iot.service.ts`**

**Changes:**
- Removed hardcoded `IOT_ENDPOINT` constant
- Updated GraphQL query to fetch `iotEndpoint` from VenueConfig
- Made IoT endpoint dynamic per venue

**Before:**
```typescript
const IOT_ENDPOINT = `wss://${VENUE_CONFIG.iotEndpoint}/mqtt`;

const getVenueConfig = /* GraphQL */ `
  query GetVenueConfig($venueId: ID!, $locationId: String!) {
    getVenueConfig(venueId: $venueId, locationId: $locationId) {
      mqttTopic
      displayName
      locationName
    }
  }
`;
```

**After:**
```typescript
const getVenueConfig = /* GraphQL */ `
  query GetVenueConfig($venueId: ID!, $locationId: String!) {
    getVenueConfig(venueId: $venueId, locationId: $locationId) {
      mqttTopic
      displayName
      locationName
      iotEndpoint
    }
  }
`;

// In connect() method:
let IOT_ENDPOINT: string | null = null;
const config = response?.data?.getVenueConfig;
const endpoint = config.iotEndpoint || AWS_CONFIG.defaultIotEndpoint;
IOT_ENDPOINT = `wss://${endpoint}/mqtt`;
```

**Impact:** Each venue can now have its own IoT endpoint, or fall back to the default regional endpoint.

---

### 3. **Updated `/src/pages/Dashboard.tsx`**

**Changes:**
- Removed `VENUE_CONFIG` import
- Removed fallback to hardcoded venueId
- Enforced authentication requirement
- Use user's venueName instead of hardcoded value
- Use current location's name instead of hardcoded value

**Before:**
```typescript
const venueId = user?.venueId || VENUE_CONFIG.venueId;

<TopBar venueName={VENUE_CONFIG.venueName} ... />
<ConnectionStatus locationName={VENUE_CONFIG.locationName} />
```

**After:**
```typescript
if (!user || !user.venueId) {
  return (
    <ErrorMessage message="Authentication required..." />
  );
}

const venueId = user.venueId;
const venueName = user.venueName || 'Pulse Dashboard';

<TopBar venueName={venueName} ... />
<ConnectionStatus locationName={currentLocation.name} />
```

**Impact:** Dashboard now REQUIRES authentication and uses only user-specific data. No fallbacks to hardcoded values.

---

### 4. **Updated `/src/pages/Settings.tsx`**

**Changes:**
- Removed `VENUE_CONFIG` import
- Display user's actual venueName and location name

**Before:**
```typescript
<p className="text-xs text-gray-400 mt-1">
  Configured: {VENUE_CONFIG.venueName}
</p>
```

**After:**
```typescript
<p className="text-xs text-gray-400 mt-1">
  Venue: {user?.venueName || 'Not configured'}
</p>
```

**Impact:** Settings page now shows actual user data instead of hardcoded values.

---

## New Data Flow (Per-User Personalization)

### User Login Flow:
1. **User logs in** → Cognito validates credentials
2. **JWT token issued** → Contains `custom:venueId` and `custom:venueName`
3. **Auth service extracts** → Stores user object with venueId and venueName
4. **Dashboard loads** → Uses `user.venueId` (NO fallback)
5. **Error if no venueId** → User must have `custom:venueId` configured

### Data Fetching Flow:
1. **API calls** → Uses venueId from user: `/live/{venueId}`, `/history/{venueId}`
2. **IoT connection** → Queries VenueConfig table for venueId
3. **VenueConfig returns** → { mqttTopic, displayName, iotEndpoint }
4. **MQTT subscribes** → To user's specific topic
5. **Data displayed** → Only from user's venueId

---

## Multi-Venue Example

### Venue A: Ferg's Sports Bar
- **Cognito User Attributes:**
  - `custom:venueId = "fergs-stpete"`
  - `custom:venueName = "Ferg's Sports Bar"`
- **VenueConfig DynamoDB:**
  ```json
  {
    "venueId": "fergs-stpete",
    "locationId": "default",
    "mqttTopic": "pulse/sensors/data",
    "iotEndpoint": "a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com",
    "displayName": "Ferg's Sports Bar"
  }
  ```
- **RPi publishes to:** `pulse/sensors/data`
- **Dashboard shows:** Only Ferg's data

---

### Venue B: John's Bar NYC
- **Cognito User Attributes:**
  - `custom:venueId = "johns-bar-nyc"`
  - `custom:venueName = "John's Bar"`
- **VenueConfig DynamoDB:**
  ```json
  {
    "venueId": "johns-bar-nyc",
    "locationId": "default",
    "mqttTopic": "pulse/sensors/johns-bar",
    "iotEndpoint": "a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com",
    "displayName": "John's Bar NYC"
  }
  ```
- **RPi publishes to:** `pulse/sensors/johns-bar`
- **Dashboard shows:** Only John's Bar data

---

## Adding a New Venue

To add a new venue to the system, follow these steps:

### 1. Create Cognito User
```bash
aws cognito-idp admin-create-user \
  --user-pool-id us-east-2_I6EBJm3te \
  --username john@newvenue.com \
  --user-attributes \
      Name=email,Value=john@newvenue.com \
      Name=custom:venueId,Value=new-venue-id \
      Name=custom:venueName,Value="New Venue Name"
```

### 2. Add VenueConfig Row to DynamoDB
```json
{
  "venueId": "new-venue-id",
  "locationId": "default",
  "mqttTopic": "pulse/sensors/new-venue",
  "iotEndpoint": "a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com",
  "displayName": "New Venue Name",
  "locationName": "Main Floor"
}
```

### 3. Configure RPi to Publish
Update RPi configuration to publish to: `pulse/sensors/new-venue`

### 4. Create IoT Rule (if needed)
```sql
SELECT * FROM 'pulse/sensors/new-venue'
```
Action: Insert into DynamoDB table `RPiSensorData` with venueId attribute

### 5. Done! ✅
User logs in → Dashboard auto-connects to their venue's data!

---

## API Backend Requirements

Your backend API at `https://api.advizia.ai` must support venueId-based filtering:

### `/live/{venueId}` Endpoint
```javascript
// Returns latest sensor reading for the venue
GET /live/fergs-stpete
→ Returns: { timestamp, decibels, light, indoorTemp, ... }
```

### `/history/{venueId}` Endpoint
```javascript
// Returns historical data for the venue
GET /history/fergs-stpete?days=7
→ Returns: [{ timestamp, decibels, ... }, ...]
```

### DynamoDB Query Example
```javascript
// Query RPiSensorData table by venueId
const params = {
  TableName: 'RPiSensorData',
  KeyConditionExpression: 'venueId = :venueId AND timestamp > :startTime',
  ExpressionAttributeValues: {
    ':venueId': venueId,
    ':startTime': startTimestamp
  }
};
```

---

## VenueConfig Table Schema

### DynamoDB Table: `VenueConfig`

**Partition Key:** `venueId` (String)
**Sort Key:** `locationId` (String)

**Attributes:**
- `venueId` (String) - Unique identifier for the venue
- `locationId` (String) - Location within venue (e.g., "default", "main-floor", "patio")
- `mqttTopic` (String) - MQTT topic to subscribe to (e.g., "pulse/sensors/data")
- `iotEndpoint` (String, Optional) - Custom IoT endpoint for this venue
- `displayName` (String) - Display name for the venue
- `locationName` (String) - Display name for the location

**Example Item:**
```json
{
  "venueId": "fergs-stpete",
  "locationId": "default",
  "mqttTopic": "pulse/sensors/data",
  "iotEndpoint": "a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com",
  "displayName": "Ferg's Sports Bar",
  "locationName": "Main Floor"
}
```

---

## Testing the Implementation

### 1. Test Authentication Requirement
- **Action:** Load dashboard without logging in
- **Expected:** Shows error message requiring authentication
- **Verify:** No hardcoded venueId fallback kicks in

### 2. Test User-Specific Data
- **Action:** Log in as User A (fergs-stpete)
- **Expected:** 
  - TopBar shows "Ferg's Sports Bar"
  - Dashboard fetches from `/live/fergs-stpete`
  - MQTT subscribes to `pulse/sensors/data`
  
### 3. Test Multi-Venue Isolation
- **Action:** Log in as User B (johns-bar-nyc)
- **Expected:**
  - TopBar shows "John's Bar"
  - Dashboard fetches from `/live/johns-bar-nyc`
  - MQTT subscribes to `pulse/sensors/johns-bar`
  - Does NOT see Ferg's data

### 4. Test VenueConfig Integration
- **Action:** Check browser console logs during IoT connection
- **Expected:** Logs show:
  ```
  ✅ Loaded VenueConfig for johns-bar-nyc
     → MQTT topic: pulse/sensors/johns-bar
     → IoT endpoint: a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com
  ```

---

## Breaking Changes

### ⚠️ Users Without custom:venueId
**Impact:** Users without `custom:venueId` in Cognito will see an error and cannot access the dashboard.

**Solution:** All Cognito users MUST have:
- `custom:venueId` attribute
- Corresponding row in VenueConfig DynamoDB table

### ⚠️ VenueConfig Table Required
**Impact:** IoT connection will fail if VenueConfig table doesn't exist or doesn't have a row for the user's venueId.

**Solution:** Ensure VenueConfig table exists and is populated for all venues.

---

## Benefits of This Implementation

### ✅ True Multi-Tenancy
- Each venue sees only their own data
- No data leakage between venues
- Scalable to unlimited venues

### ✅ Zero Hardcoded Values
- All venue-specific data comes from Cognito or DynamoDB
- Easy to add new venues without code changes
- Configuration-driven approach

### ✅ Dynamic MQTT Topics
- Each venue can have a unique MQTT topic
- Supports multiple RPis per venue (different topics)
- Flexible IoT architecture

### ✅ Security
- venueId comes from authenticated JWT token
- Cannot be tampered with by client
- Backend API can validate venueId from token

### ✅ User Experience
- Dashboard shows user's actual venue name
- Clear error messages for misconfiguration
- No confusion about which venue's data is shown

---

## Troubleshooting

### Error: "Authentication required. Please log in..."
**Cause:** User object doesn't have venueId
**Solution:** 
1. Check Cognito user has `custom:venueId` attribute
2. Log out and log back in to refresh token

### Error: "No mqttTopic found in VenueConfig"
**Cause:** VenueConfig table doesn't have row for user's venueId
**Solution:**
1. Add row to VenueConfig table with user's venueId
2. Ensure locationId matches (use "default" if unsure)

### Error: "Failed to fetch live data"
**Cause:** API endpoint doesn't have data for venueId
**Solution:**
1. Check RPi is publishing to correct MQTT topic
2. Verify IoT Rule is saving data to DynamoDB with venueId
3. Check API is querying by venueId parameter

### Dashboard shows wrong venue name
**Cause:** User's `custom:venueName` attribute is wrong
**Solution:**
1. Update Cognito user attribute: `custom:venueName`
2. Log out and log back in

---

## Summary

All hardcoded venue-specific data has been removed. The dashboard now operates in a fully personalized, multi-tenant mode where:

1. ✅ venueId comes from Cognito `custom:venueId`
2. ✅ MQTT topic comes from VenueConfig DynamoDB query
3. ✅ IoT endpoint can be per-venue or use default
4. ✅ API calls include venueId for data isolation
5. ✅ No fallbacks to hardcoded values

**Adding a new venue requires:**
1. Cognito user with `custom:venueId`
2. VenueConfig row in DynamoDB
3. RPi configured to publish to venue's topic
4. That's it! Everything auto-connects. 🎉
