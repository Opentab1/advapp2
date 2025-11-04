# Exact Code Changes Required

## Summary

**Total Changes**: 6 code edits across 2 files  
**Risk Level**: Low (error handling already exists)  
**Impact**: Dashboard becomes fully user-specific with no hardcoded fallbacks

---

## Change 1: Dashboard.tsx - Remove venueId Fallback

**File**: `src/pages/Dashboard.tsx`  
**Line**: 54

**Before**:
```typescript
const venueId = user?.venueId || VENUE_CONFIG.venueId;
```

**After**:
```typescript
const venueId = user?.venueId;
```

**Impact**: If user doesn't have `custom:venueId`, error handling at lines 56-65 will show appropriate error message.

---

## Change 2: Dashboard.tsx - Remove locationId Fallback

**File**: `src/pages/Dashboard.tsx`  
**Line**: 70

**Before**:
```typescript
const [currentLocationId, setCurrentLocationId] = useState<string>(
  locationService.getCurrentLocationId() || VENUE_CONFIG.locationId
);
```

**After**:
```typescript
const [currentLocationId, setCurrentLocationId] = useState<string>(
  locationService.getCurrentLocationId() || locations[0]?.id || ''
);
```

**Impact**: Uses first location from user's locations array instead of hardcoded fallback.

---

## Change 3: Dashboard.tsx - Use Dynamic Venue Name

**File**: `src/pages/Dashboard.tsx`  
**Line**: 203

**Before**:
```typescript
<TopBar
  venueName={VENUE_CONFIG.venueName}
  ...
/>
```

**After**:
```typescript
<TopBar
  venueName={user?.venueName || 'Pulse Dashboard'}
  ...
/>
```

**Impact**: Displays user's venue name from Cognito instead of hardcoded name.

---

## Change 4: Dashboard.tsx - Use Dynamic Location Name

**File**: `src/pages/Dashboard.tsx`  
**Line**: 254

**Before**:
```typescript
<ConnectionStatus 
  ...
  locationName={VENUE_CONFIG.locationName}
/>
```

**After**:
```typescript
<ConnectionStatus 
  ...
  locationName={currentLocation?.name || 'Unknown Location'}
/>
```

**Impact**: Displays current location name dynamically instead of hardcoded name.

---

## Change 5: Settings.tsx - Use Dynamic Venue Name

**File**: `src/pages/Settings.tsx`  
**Line**: 128

**Before**:
```typescript
<p className="text-xs text-gray-400 mt-1">
  Configured: {VENUE_CONFIG.venueName}
</p>
```

**After**:
```typescript
<p className="text-xs text-gray-400 mt-1">
  Configured: {authService.getStoredUser()?.venueName || 'Unknown Venue'}
</p>
```

**Impact**: Shows user's venue name in settings page.

---

## Change 6: Settings.tsx - Use Dynamic Location Name

**File**: `src/pages/Settings.tsx`  
**Line**: 143

**Before**:
```typescript
<p className="text-xs text-gray-400 mt-1">
  Configured: {VENUE_CONFIG.locationName}
</p>
```

**After**:
```typescript
<p className="text-xs text-gray-400 mt-1">
  Configured: {authService.getStoredUser()?.locations?.[0]?.name || 'Unknown Location'}
</p>
```

**Impact**: Shows user's location name in settings page.

---

## What Stays the Same (Already Correct)

✅ **IoT Service** (`iot.service.ts`)
- Already queries VenueConfig for `mqttTopic` dynamically
- Already uses `venueId` from Cognito
- Already subscribes to fetched topic

✅ **API Service** (`api.service.ts`)
- Already uses `/live/{venueId}` and `/history/{venueId}` endpoints
- Already accepts `venueId` as parameter

✅ **Auth Service** (`auth.service.ts`)
- Already extracts `custom:venueId` from Cognito
- Already extracts `custom:venueName` from Cognito
- Already validates venueId exists

✅ **Real-Time Hook** (`useRealTimeData.ts`)
- Already passes `venueId` to API and IoT services

---

## Data Flow (After Changes)

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User Logs In                                             │
│    ↓                                                         │
│ 2. Cognito Token Contains:                                  │
│    - custom:venueId → "fergs-stpete"                        │
│    - custom:venueName → "Ferg's Sports Bar"                 │
│    ↓                                                         │
│ 3. Auth Service Extracts venueId & venueName                │
│    ↓                                                         │
│ 4. Dashboard Uses:                                          │
│    - venueId = user.venueId (NO FALLBACK)                   │
│    - venueName = user.venueName (NO FALLBACK)                │
│    ↓                                                         │
│ 5. API Calls:                                               │
│    GET /live/{venueId}                                      │
│    GET /history/{venueId}                                   │
│    ↓                                                         │
│ 6. IoT Service:                                             │
│    - Queries VenueConfig table for mqttTopic                │
│    - Subscribes to fetched topic (e.g., "pulse/sensors/data")│
│    ↓                                                         │
│ 7. Real-Time Data Flows:                                    │
│    RPi → MQTT Topic → Dashboard                             │
│    DynamoDB → API → Dashboard                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Testing After Changes

1. **User without `custom:venueId`**
   - ✅ Should show error: "No venue ID found. Please ensure you are logged in..."
   - ✅ Dashboard should not render

2. **User with `custom:venueId`**
   - ✅ Should fetch VenueConfig successfully
   - ✅ Should display user's venue name
   - ✅ Should display user's location name

3. **VenueConfig missing `mqttTopic`**
   - ✅ IoT service should show error
   - ✅ Dashboard should fall back to HTTP polling

4. **API Calls**
   - ✅ Should use `/live/{user.venueId}`
   - ✅ Should use `/history/{user.venueId}`
   - ✅ Should include `X-Venue-ID` header

5. **MQTT Subscription**
   - ✅ Should subscribe to topic from VenueConfig
   - ✅ Should receive real-time messages

---

## Rollback Plan

If issues occur, revert these 6 changes:
1. Restore `|| VENUE_CONFIG.venueId` fallback
2. Restore `|| VENUE_CONFIG.locationId` fallback
3. Restore `VENUE_CONFIG.venueName` in TopBar
4. Restore `VENUE_CONFIG.locationName` in ConnectionStatus
5. Restore `VENUE_CONFIG.venueName` in Settings
6. Restore `VENUE_CONFIG.locationName` in Settings

All changes are isolated and easily reversible.
