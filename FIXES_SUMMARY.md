# Dashboard Data Authentication and Dynamic Configuration Fixes

## Issues Fixed

### 1. **Hardcoded MQTT Topic Removed** ✅
**File:** `src/services/iot.service.ts`

**Before:**
```typescript
let venueId = "fergs-stpete";
let locationId = "main-floor";
let TOPIC = "pulse/fergs-stpete/main-floor";
```

**After:**
- Removed hardcoded fallback values
- Now **requires** authenticated user with `custom:venueId` in Cognito token
- Throws error if user is not logged in or venueId is missing
- **Requires** DynamoDB VenueConfig lookup to get the correct MQTT topic
- Throws error if VenueConfig is not found in DynamoDB
- No fallback topic - must have valid configuration

**Impact:** App now correctly reads `custom:venueId = "FergData"` from Cognito and queries DynamoDB for the correct `mqttTopic = "pulse/sensors/data"`.

---

### 2. **Fake Data Loop Removed** ✅
**File:** `src/services/api.service.ts`

**Before:**
```typescript
} catch (error: any) {
  console.error('API fetch error:', error);
  // Return mock data for demo purposes
  return this.getMockData(venueId, range);
}
```

**After:**
- Removed all mock data fallback methods
- `getHistoricalData()` - throws error if API fails
- `getLiveData()` - throws error if API fails
- `getOccupancyMetrics()` - throws error if API fails

**Impact:** App no longer generates fake data that overrides real MQTT messages. API errors are now properly propagated to the UI.

---

### 3. **Logout Now Clears All LocalStorage** ✅
**File:** `src/services/auth.service.ts`

**Before:**
```typescript
localStorage.removeItem(this.tokenKey);
localStorage.removeItem(this.userKey);
```

**After:**
```typescript
localStorage.removeItem(this.tokenKey);
localStorage.removeItem(this.userKey);
localStorage.removeItem('appSettings');
localStorage.removeItem('lastSongLogged');
localStorage.removeItem('pulse_location_current');
localStorage.removeItem('pulse_locations');
localStorage.removeItem('songLog');
localStorage.removeItem('weeklyReports');
localStorage.clear(); // Clear any remaining Amplify/Cognito tokens
```

**Impact:** Users can now properly logout. All Cognito tokens and cached data are cleared from localStorage.

---

### 4. **Settings No Longer Hardcode VenueId** ✅
**File:** `src/pages/Settings.tsx`

**Before:**
```typescript
const DEFAULT_SETTINGS: AppSettings = {
  venueId: VENUE_CONFIG.venueId, // Hardcoded "fergs-stpete"
  locationId: VENUE_CONFIG.locationId,
  // ...
};
```

**After:**
```typescript
const getDefaultSettings = (): AppSettings => {
  const user = authService.getStoredUser();
  return {
    venueId: user?.venueId || '', // Dynamic from logged-in user
    locationId: 'main-floor',
    // ...
  };
};
```

**Impact:** Settings page now dynamically loads venueId from the authenticated user instead of hardcoding "fergs-stpete".

---

### 5. **Dashboard Uses Dynamic VenueId** ✅
**File:** `src/pages/Dashboard.tsx`

**Before:**
```typescript
const venueId = user?.venueId || VENUE_CONFIG.venueId; // Fallback to hardcoded
venueName={VENUE_CONFIG.venueName} // Hardcoded
locationName={VENUE_CONFIG.locationName} // Hardcoded
```

**After:**
```typescript
const venueId = user?.venueId || ''; // No fallback
venueName={user?.venueName || 'Pulse Dashboard'} // Dynamic
locationName={currentLocation.name || 'Main Floor'} // Dynamic
```

**Impact:** Dashboard now fully respects the logged-in user's venueId and venueName from Cognito.

---

## Testing Checklist

### Prerequisites
1. Ensure user has `custom:venueId = "FergData"` in Cognito user attributes
2. Ensure DynamoDB has a VenueConfig row with:
   - `venueId: "FergData"`
   - `locationId: "main-floor"` (or appropriate location)
   - `mqttTopic: "pulse/sensors/data"`

### Test Steps
1. **Login Test:**
   - Login with user that has `custom:venueId = "FergData"`
   - Verify no hardcoded values are used
   - Check browser console for: `✅ Loaded config for FergData → topic: pulse/sensors/data`

2. **MQTT Connection Test:**
   - Verify app connects to `pulse/sensors/data` topic
   - Verify app receives real sensor data from Raspberry Pi
   - Verify no fake/simulated data is shown

3. **Logout Test:**
   - Click logout
   - Verify all localStorage items are cleared
   - Verify Cognito tokens are cleared
   - Try to access dashboard - should redirect to login

4. **No-Config Error Test:**
   - Try logging in with a user that has an invalid venueId
   - Verify app shows proper error message
   - Verify app doesn't fall back to hardcoded values

5. **Settings Test:**
   - Open Settings page
   - Verify Venue ID shows the user's actual venueId (e.g., "FergData")
   - Verify no hardcoded "fergs-stpete" is shown

---

## Architecture Changes

### Data Flow (Before)
```
Login → Hardcoded venueId "fergs-stpete" 
      → Hardcoded topic "pulse/fergs-stpete/main-floor"
      → Fake data every 10 seconds
```

### Data Flow (After)
```
Login → Read custom:venueId from Cognito
      → Query DynamoDB VenueConfig for mqttTopic
      → Subscribe to correct MQTT topic
      → Receive real sensor data
      → Logout clears all localStorage
```

---

## Error Handling

The app now properly fails fast with clear error messages:

1. **No Authentication:** "Must be logged in with a valid venueId to connect to MQTT"
2. **No VenueId:** "No custom:venueId found in user token"
3. **No Config:** "Failed to load venue configuration for {venueId}. Ensure VenueConfig exists in DynamoDB."
4. **API Failures:** Proper error propagation to UI instead of fake data

---

## Files Changed

1. ✅ `src/services/iot.service.ts` - Fixed MQTT topic to use DynamoDB config
2. ✅ `src/services/api.service.ts` - Removed fake data fallbacks
3. ✅ `src/services/auth.service.ts` - Fixed logout to clear all localStorage
4. ✅ `src/pages/Settings.tsx` - Made venueId dynamic from user
5. ✅ `src/pages/Dashboard.tsx` - Removed hardcoded VENUE_CONFIG usage

---

## Next Steps

1. **Deploy Changes** to the branch `cursor/fix-dashboard-data-auth-and-state-1ebd`
2. **Verify DynamoDB** has correct VenueConfig entries for all venues
3. **Test with Real RPi** publishing to `pulse/sensors/data`
4. **Verify Cognito** user attributes have correct `custom:venueId`
5. **Monitor Logs** for any MQTT connection errors

---

## Breaking Changes

⚠️ **Important:** This is a breaking change for deployments that relied on hardcoded fallbacks.

**Required Configuration:**
1. All users MUST have `custom:venueId` in their Cognito user attributes
2. All venues MUST have a VenueConfig entry in DynamoDB with `mqttTopic` defined
3. No fallback to mock data - real infrastructure must be in place

**Migration Steps:**
1. Update all Cognito users with `custom:venueId` attribute
2. Ensure all VenueConfig entries exist in DynamoDB
3. Test MQTT connectivity before deploying to production

---

**Status:** ✅ All fixes applied successfully with no linter errors
**Branch:** `cursor/fix-dashboard-data-auth-and-state-1ebd`
**Date:** 2025-11-04
