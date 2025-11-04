# Analysis: Making Dashboard User-Specific with Dynamic VenueId

## Current State Analysis

### ✅ Already Working Correctly

1. **auth.service.ts** (Lines 122-127)
   - ✅ Extracts `custom:venueId` from Cognito JWT token
   - ✅ Stores it in User object
   - ✅ Throws error if venueId is missing

2. **iot.service.ts** (Lines 50-103)
   - ✅ Gets `venueId` from Cognito user attributes (not from parameter)
   - ✅ Queries VenueConfig DynamoDB table for `mqttTopic`
   - ✅ Subscribes to the fetched topic dynamically
   - ✅ No hardcoded topic

3. **api.service.ts** (Lines 29-104)
   - ✅ Methods accept `venueId` as parameter
   - ✅ Uses it in API calls: `/live/{venueId}` and `/history/{venueId}`
   - ✅ No hardcoded venueId in the service

### ⚠️ Needs Changes

1. **Dashboard.tsx** (Line 54)
   - **Current**: Falls back to `VENUE_CONFIG.venueId` if user doesn't have venueId
   - **Problem**: Allows dashboard to work with hardcoded venueId, bypassing user-specific data
   - **Change**: Remove fallback - show error if user doesn't have venueId

2. **config/amplify.ts** (Line 5)
   - **Current**: Has `venueId: 'fergs-stpete'` in VENUE_CONFIG
   - **Usage**: Used as fallback in Dashboard.tsx
   - **Change**: Keep for IoT endpoint config, but remove venueId from being used as fallback

## Required Changes

### Change 1: Dashboard.tsx - Remove Hardcoded Fallback

**File**: `src/pages/Dashboard.tsx`
**Line**: 54

**Current Code**:
```typescript
const venueId = user?.venueId || VENUE_CONFIG.venueId;
```

**Change To**:
```typescript
const venueId = user?.venueId;
```

**Impact**:
- If user doesn't have `custom:venueId` in Cognito, dashboard will show error (already handled on lines 56-65)
- Ensures all data is user-specific
- No fallback to hardcoded venue

### Change 2: Dashboard.tsx - Remove VENUE_CONFIG.venueId Reference

**File**: `src/pages/Dashboard.tsx`
**Line**: 70

**Current Code**:
```typescript
const [currentLocationId, setCurrentLocationId] = useState<string>(
  locationService.getCurrentLocationId() || VENUE_CONFIG.locationId
);
```

**Note**: This is fine as locationId is separate from venueId. The locationId fallback is acceptable if needed.

### Change 3: Verify No Other Hardcoded venueId References

**Files to Check**:
- ✅ `src/services/api.service.ts` - Already uses parameter
- ✅ `src/services/iot.service.ts` - Already gets from Cognito
- ✅ `src/hooks/useRealTimeData.ts` - Already uses parameter
- ✅ `src/pages/Dashboard.tsx` - Needs change (see above)

## Data Flow After Changes

### Login Flow:
1. User logs in → `auth.service.ts` extracts `custom:venueId` from Cognito
2. User object stored with `venueId` from Cognito
3. Dashboard reads `user.venueId` (no fallback)

### API Calls:
1. Dashboard calls `apiService.getLiveData(venueId)` where `venueId = user.venueId`
2. API service calls: `https://api.advizia.ai/live/{venueId}`
3. Backend queries DynamoDB for that specific venueId

### Historical Data:
1. Dashboard calls `apiService.getHistoricalData(venueId, range)` where `venueId = user.venueId`
2. API service calls: `https://api.advizia.ai/history/{venueId}?days={days}`
3. Backend queries DynamoDB for that specific venueId

### MQTT Real-Time:
1. Dashboard calls `useRealTimeData({ venueId })` where `venueId = user.venueId`
2. Hook calls `iotService.connect(venueId)` (parameter is informational)
3. `iot.service.ts`:
   - Gets `venueId` from Cognito (not from parameter)
   - Queries VenueConfig DynamoDB: `getVenueConfig(venueId, locationId)`
   - Gets `mqttTopic` from VenueConfig
   - Subscribes to that topic for real-time updates

## Benefits

1. **Complete User Isolation**: Each user sees only their venue's data
2. **Dynamic Configuration**: MQTT topic comes from VenueConfig table per user
3. **No Hardcoded Values**: All venueIds come from Cognito user attributes
4. **Automatic Setup**: New users just need:
   - `custom:venueId` added to Cognito user
   - Row in VenueConfig table with their venueId and mqttTopic
   - Data auto-connects

## Testing Checklist

After changes:
- [ ] Login with user that has `custom:venueId` → Dashboard loads their data
- [ ] Login with user missing `custom:venueId` → Shows error message
- [ ] API calls use correct venueId in URL
- [ ] MQTT subscribes to correct topic from VenueConfig
- [ ] Historical data is venue-specific
- [ ] Live data is venue-specific
- [ ] No fallback to hardcoded 'fergs-stpete' venueId

## Summary

**Minimal Changes Required**: Only 1 line change in Dashboard.tsx to remove the fallback to hardcoded venueId. The rest of the architecture is already correctly designed to use user-specific venueId from Cognito and fetch MQTT topic from VenueConfig.
