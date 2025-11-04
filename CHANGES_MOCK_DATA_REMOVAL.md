# Mock Data Removal - Changes Summary

## Overview
All simulated/mock data has been completely removed from the application. The dashboard now displays **real data only** from AWS IoT Core or the REST API. If data sources are unavailable, users see clear error messages with troubleshooting guidance.

## Changes Made

### 1. Removed Mock Data Generation (`src/services/api.service.ts`)
**Deleted methods:**
- `getMockLiveData()` - Generated fake sensor readings
- `getMockData()` - Generated fake historical data
- `getMockOccupancyMetrics()` - Generated fake occupancy data
- `getBaseOccupancyForHour()` - Helper for simulating occupancy patterns

**Removed variables:**
- `DISABLE_MOCK_FALLBACK` - No longer needed since mock data is gone

### 2. Updated Error Handling (`src/services/api.service.ts`)
**Before:**
```typescript
catch (error) {
  console.error('Live data fetch error:', error);
  return this.getMockLiveData(); // Silent fallback to mock data
}
```

**After:**
```typescript
catch (error: any) {
  console.error('❌ Live data API fetch failed:', error);
  throw new Error(`Failed to fetch live data from ${API_BASE_URL}: ${error.message}`);
}
```

**Changes applied to:**
- `getHistoricalData()` - Now throws error instead of returning mock data
- `getLiveData()` - Now throws error instead of returning mock data
- `getOccupancyMetrics()` - Now throws error instead of returning mock data

### 3. Enhanced Error Display (`src/pages/Dashboard.tsx`)

**Updated error banner** to show:
- Clear error message
- Detailed list of possible causes
- Instructions to check browser console
- Retry button

**Updated connection warning banner:**
- Only shows when using HTTP polling fallback (not an error)
- Removed "Using Simulated Data" warning (no longer applicable)

### 4. Documentation Updates

**Deleted files:**
- `TROUBLESHOOTING_SIMULATED_DATA.md` - Outdated
- `SIMULATED_DATA_FIX_CHECKLIST.md` - Outdated

**Created:**
- `DATA_SOURCE_CONFIGURATION.md` - Complete guide for setting up real data sources

## User Experience Changes

### Before (With Mock Data)
1. User logs in
2. API/IoT fails silently
3. Dashboard shows simulated data
4. User doesn't know there's a problem
5. Small warning banner (easy to miss)

### After (Real Data Only)
1. User logs in
2. If API/IoT fails → Clear error displayed
3. Error shows:
   - What went wrong
   - Why it might have happened
   - How to fix it
   - Link to console logs
4. Retry button to test again

## Error Messages

### When Both IoT and API Fail
```
Unable to Load Data

Failed to fetch live data from https://api.advizia.ai: [error details]

Possible causes:
• API endpoint not responding (check https://api.advizia.ai)
• AWS IoT Core connection failed (check MQTT topic configuration)
• Missing VenueConfig in DynamoDB table
• Invalid venueId in Cognito user attributes (custom:venueId)
• Network connectivity issues

Check browser console (F12) for detailed error logs.

[Retry Button]
```

### When Only IoT Fails (API Works)
```
⚠️ Using HTTP Polling (Fallback Mode)

AWS IoT Core connection is not available. Falling back to HTTP polling.
Check the browser console for details on why IoT connection failed.
```

## Console Logging

All API calls now log their status:

### Success:
```
🔍 Fetching live data from: https://api.advizia.ai/live/fergs-stpete
✅ Live data received from API
```

### Failure:
```
🔍 Fetching live data from: https://api.advizia.ai/live/fergs-stpete
❌ API returned 404: Not Found
❌ Live data API fetch failed: Error: API returned 404: Not Found
```

## Required AWS Configuration

For the app to work now, you **must** have one of:

### Option 1: AWS IoT Core (Recommended)
- DynamoDB VenueConfig table with MQTT topic
- Active MQTT publisher sending messages
- User has `custom:venueId` in Cognito attributes

### Option 2: REST API (Fallback)
- API endpoints deployed at `https://api.advizia.ai`
- Endpoints: `/live/:venueId`, `/history/:venueId`, `/occupancy/:venueId/metrics`

### Option 3: Both (Best)
- IoT for real-time data
- API as fallback if IoT fails

## Testing the Changes

### Test 1: Working IoT Connection
1. Login with valid credentials
2. Check console for: "✅ Connected to AWS IoT Core"
3. Status should show: "AWS IoT Live" (green)
4. Data should update in real-time

### Test 2: IoT Fails, API Works
1. Break IoT connection (remove VenueConfig)
2. Login
3. Should see: "⚠️ Using HTTP Polling (Fallback Mode)"
4. Data polls every 15 seconds from API

### Test 3: Both Fail
1. Break both IoT and API
2. Login
3. Should see large error banner with troubleshooting info
4. Dashboard shows loading spinner, then error
5. Console shows detailed error logs

## Files Modified

```
src/services/api.service.ts       - Removed mock data, throw errors
src/pages/Dashboard.tsx            - Enhanced error display
DATA_SOURCE_CONFIGURATION.md       - New comprehensive guide
CHANGES_MOCK_DATA_REMOVAL.md      - This file
```

## Files Deleted

```
TROUBLESHOOTING_SIMULATED_DATA.md
SIMULATED_DATA_FIX_CHECKLIST.md
```

## Migration Notes

If you're upgrading from a version with mock data:

1. **Expect errors initially** - This is intentional
2. **Check browser console** - Shows what's failing
3. **Configure data sources** - See `DATA_SOURCE_CONFIGURATION.md`
4. **Test thoroughly** - Verify IoT or API is working

## Benefits

✅ **Transparency** - Users know immediately when data sources fail  
✅ **Debugging** - Clear error messages help diagnose issues  
✅ **Trust** - No fake data means users trust what they see  
✅ **Production-ready** - Forces proper configuration before use  
✅ **Better logging** - Detailed console logs for troubleshooting  

## Next Steps

1. Deploy these changes to AWS Amplify
2. Test login on production
3. Verify error messages appear if data sources aren't configured
4. Configure real data sources (IoT Core or API)
5. Verify real data flows through correctly

See `DATA_SOURCE_CONFIGURATION.md` for complete setup instructions.
