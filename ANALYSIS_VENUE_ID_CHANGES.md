# Analysis: Making Dashboard User-Specific with Dynamic VenueId

## Executive Summary

**Current State**: The codebase is **90% correct** for user-specific data. The IoT service and API service already dynamically use `venueId` from Cognito and fetch `mqttTopic` from VenueConfig.

**Required Changes**: Only **6 small changes** across 2 files to remove hardcoded fallbacks and use user-specific data throughout.

**Impact**: Low risk - error handling already exists, and the dynamic data flow is already implemented.

## What Would Change

### Before (Current - Has Fallbacks)
```typescript
// Dashboard.tsx
const venueId = user?.venueId || VENUE_CONFIG.venueId;  // ❌ Falls back to hardcoded
venueName={VENUE_CONFIG.venueName}  // ❌ Hardcoded name
locationName={VENUE_CONFIG.locationName}  // ❌ Hardcoded location
```

### After (Proposed - Fully Dynamic)
```typescript
// Dashboard.tsx
const venueId = user?.venueId;  // ✅ No fallback - error if missing
venueName={user?.venueName}  // ✅ User-specific name
locationName={currentLocation?.name}  // ✅ Dynamic location name
```

## Current Implementation Analysis

### ✅ What's Already Working

1. **Auth Service (`auth.service.ts`)**
   - ✅ Extracts `custom:venueId` from Cognito token (line 122)
   - ✅ Stores venueId in User object
   - ✅ Throws error if venueId is missing

2. **IoT Service (`iot.service.ts`)**
   - ✅ Dynamically queries VenueConfig table for `mqttTopic` (lines 82-103)
   - ✅ Uses authenticated user's `venueId` from Cognito
   - ✅ Subscribes to the fetched topic dynamically

3. **API Service (`api.service.ts`)**
   - ✅ Accepts `venueId` as parameter for all API calls
   - ✅ Uses `/live/{venueId}` and `/history/{venueId}` endpoints
   - ✅ Includes venueId in headers via `X-Venue-ID`

4. **Real-Time Hook (`useRealTimeData.ts`)**
   - ✅ Accepts `venueId` as parameter
   - ✅ Passes it to both API service and IoT service

### ⚠️ What Needs to Change

1. **Dashboard.tsx (Line 54)**
   ```typescript
   // CURRENT (has fallback):
   const venueId = user?.venueId || VENUE_CONFIG.venueId;
   
   // SHOULD BE (strict user-only):
   const venueId = user?.venueId;
   ```
   - **Impact**: Remove fallback to hardcoded venueId
   - **Risk**: If user doesn't have venueId, show error (already handled at lines 56-65)

2. **Dashboard.tsx (Line 70)**
   ```typescript
   // CURRENT (has fallback):
   const [currentLocationId, setCurrentLocationId] = useState<string>(
     locationService.getCurrentLocationId() || VENUE_CONFIG.locationId
   );
   
   // SHOULD BE (strict user-only):
   const [currentLocationId, setCurrentLocationId] = useState<string>(
     locationService.getCurrentLocationId() || locations[0]?.id || ''
   );
   ```
   - **Impact**: Remove fallback to hardcoded locationId
   - **Risk**: Low - locations are already fetched from user object

3. **IoT Service (`iot.service.ts` - Line 8)**
   ```typescript
   // CURRENT (hardcoded endpoint):
   const IOT_ENDPOINT = `wss://${VENUE_CONFIG.iotEndpoint}/mqtt`;
   
   // OPTION 1: Keep as-is (infrastructure config)
   // OPTION 2: Fetch from VenueConfig or environment variable
   ```
   - **Impact**: Endpoint is infrastructure-level, may be OK to keep as-is
   - **Recommendation**: Could move to environment variable or fetch from VenueConfig if different per venue

4. **VENUE_CONFIG usage**
   - Currently used as fallback in Dashboard
   - Used for `venueName` display (line 203)
   - **Recommendation**: Should use `user?.venueName` instead

## Required Changes Summary

### Change 1: Remove Hardcoded VenueId Fallback
**File**: `src/pages/Dashboard.tsx`
- Remove fallback to `VENUE_CONFIG.venueId`
- Ensure error is shown if user doesn't have venueId (already implemented)

### Change 2: Remove Hardcoded LocationId Fallback
**File**: `src/pages/Dashboard.tsx`
- Remove fallback to `VENUE_CONFIG.locationId`
- Use first location from user's locations array

### Change 3: Use Dynamic Venue Name
**File**: `src/pages/Dashboard.tsx`
- Replace `VENUE_CONFIG.venueName` with `user?.venueName`
- Line 203: Currently uses hardcoded venue name

### Change 4: Verify VenueConfig Query
**File**: `src/services/iot.service.ts`
- Already correctly queries VenueConfig
- Already uses dynamic `venueId` from Cognito
- Already subscribes to fetched `mqttTopic`
- ✅ **No changes needed**

### Change 5: Verify API Calls
**File**: `src/services/api.service.ts`
- Already uses `venueId` parameter correctly
- Already uses dynamic endpoints
- ✅ **No changes needed**

## Data Flow After Changes

```
1. User logs in
   ↓
2. Auth Service extracts custom:venueId from Cognito token
   ↓
3. Dashboard gets venueId from user object (no fallback)
   ↓
4. API calls use /live/{venueId} and /history/{venueId}
   ↓
5. IoT Service queries VenueConfig table for mqttTopic
   ↓
6. IoT Service subscribes to the fetched mqttTopic
   ↓
7. Real-time data flows from MQTT topic
   ↓
8. Historical data fetched from DynamoDB via API
```

## Testing Checklist

- [ ] User without `custom:venueId` → Should show error
- [ ] User with `custom:venueId` → Should fetch VenueConfig
- [ ] VenueConfig without `mqttTopic` → Should show error
- [ ] API calls use correct `/live/{venueId}` endpoint
- [ ] API calls use correct `/history/{venueId}` endpoint
- [ ] MQTT subscribes to correct topic from VenueConfig
- [ ] Dashboard displays user's venue name (not hardcoded)
- [ ] No fallback to hardcoded values

## Files That Need Changes

1. **`src/pages/Dashboard.tsx`** (4 changes)
   - Line 54: Remove venueId fallback → `const venueId = user?.venueId;`
   - Line 70: Remove locationId fallback → Use `locations[0]?.id || ''`
   - Line 203: Use `user?.venueName` instead of `VENUE_CONFIG.venueName`
   - Line 254: Use `currentLocation?.name` instead of `VENUE_CONFIG.locationName`

2. **`src/pages/Settings.tsx`** (2 changes)
   - Line 128: Use `user?.venueName` instead of `VENUE_CONFIG.venueName`
   - Line 143: Use `currentLocation?.name` instead of `VENUE_CONFIG.locationName`

3. **`src/config/amplify.ts`** (optional)
   - Could remove VENUE_CONFIG entirely if not needed
   - Or keep for infrastructure config (IoT endpoint only)
   - IoT endpoint might be shared across all venues, so keeping it as config is reasonable

## Risk Assessment

**Low Risk Changes:**
- Removing venueId fallback (error handling already exists)
- Using user.venueName (already available in user object)

**Medium Risk Changes:**
- Removing locationId fallback (but locations are fetched from user object)

**No Risk Changes:**
- IoT Service already works correctly
- API Service already works correctly

## Conclusion

The codebase is **already 90% correct** for user-specific data. The main changes needed are:
1. Remove hardcoded fallbacks in Dashboard
2. Use user.venueName instead of hardcoded name
3. Ensure error handling is robust (already implemented)

The IoT service and API service are already correctly implemented to use dynamic venueId and mqttTopic.
