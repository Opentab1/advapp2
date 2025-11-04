# Troubleshooting Fake Locations in Dropdown

## Overview

The location dropdown in the TopBar shows locations fetched from **AWS DynamoDB VenueConfig table**, not from hardcoded application code. If you're seeing fake/test locations, they're likely stored in your DynamoDB table.

## How Locations Are Loaded

1. **Primary Source**: DynamoDB VenueConfig table via GraphQL query `listVenueLocations`
2. **Cache**: Locations are cached in browser localStorage for 5 minutes
3. **Fallback**: If DynamoDB fetch fails, app uses cached locations from localStorage

## Diagnosis Steps

### Step 1: Check Browser Console

Open your browser's Developer Console (F12) and look for these log messages:

**When locations are fetched from DynamoDB:**
```
🔍 Fetching locations from DynamoDB VenueConfig...
📋 Raw items from DynamoDB: [...]
✅ Loaded X locations from DynamoDB: ["Location 1", "Location 2"]
```

**When locations come from cache:**
```
📦 Using cached locations (2 locations, cached 120s ago)
```

**When locations come from localStorage:**
```
📦 Using stored locations (2 locations from localStorage)
```

### Step 2: Check DynamoDB Table

1. Go to AWS Console → DynamoDB
2. Find your `VenueConfig` table
3. Query for items where `venueId` matches your user's `custom:venueId` attribute
4. Check the `listVenueLocations` query results - these are what appear in the dropdown

**GraphQL Query Used:**
```graphql
query ListVenueLocations($venueId: ID!) {
  listVenueLocations(venueId: $venueId) {
    items {
      locationId
      displayName
      locationName
      address
      timezone
      deviceId
      mqttTopic
    }
  }
}
```

### Step 3: Clear Browser Cache

If you suspect cached fake locations:

**Option A: Use Browser DevTools**
1. Open DevTools (F12)
2. Go to Application/Storage tab
3. Find Local Storage → your domain
4. Delete these keys:
   - `pulse_locations`
   - `pulse_locations_cache`
   - `pulse_locations_cache_time`
   - `pulse_current_location`

**Option B: Use Console Command**
In browser console, run:
```javascript
// Clear location cache
localStorage.removeItem('pulse_locations');
localStorage.removeItem('pulse_locations_cache');
localStorage.removeItem('pulse_locations_cache_time');
localStorage.removeItem('pulse_current_location');
location.reload();
```

**Option C: Use Location Service Debug Method**
In browser console, run:
```javascript
// First, import the service (if using dev build)
import locationService from './services/location.service';
locationService.debugLocations(); // See what's cached
locationService.clearCache(); // Clear all caches
location.reload();
```

## Solutions

### Solution 1: Remove Fake Locations from DynamoDB (Recommended)

1. Go to AWS DynamoDB Console
2. Find your `VenueConfig` table
3. Search for items with fake/test location names
4. Delete those items OR update them with real location data

**Example:**
- ❌ Bad: `displayName: "Test Location"` or `locationName: "Fake Location"`
- ✅ Good: `displayName: "Main Floor"` or `locationName: "Downtown Location"`

### Solution 2: Verify Cognito User Attributes

Ensure your Cognito user has the correct `custom:venueId`:

1. Go to AWS Cognito Console
2. Find your user pool
3. Find your user
4. Check `custom:venueId` attribute
5. Verify it matches the venueId in DynamoDB VenueConfig table

### Solution 3: Update VenueConfig Table

If you need to add/update locations:

**Required Fields:**
- `venueId` (partition key) - must match user's `custom:venueId`
- `locationId` - unique identifier for the location
- `displayName` or `locationName` - shown in dropdown
- `address` (optional) - shown below location name
- `timezone` (optional) - defaults to 'America/New_York'
- `deviceId` (optional) - for IoT device association
- `mqttTopic` (optional) - for MQTT data routing

## Prevention

To prevent fake locations from appearing:

1. **Use Environment-Specific DynamoDB Tables**
   - Separate dev/staging/prod VenueConfig tables
   - Use different Cognito user pools per environment

2. **Validate Location Data**
   - Add validation in your backend to prevent test data
   - Use naming conventions (e.g., prefix test locations with "[TEST]")

3. **Clear Cache on Deploy**
   - When updating locations in DynamoDB, users need to refresh
   - Cache expires after 5 minutes automatically
   - Or users can clear cache manually

## Verification

After fixing, verify:

1. **Check Console Logs:**
   ```
   ✅ Loaded X locations from DynamoDB: ["Real Location 1", "Real Location 2"]
   ```

2. **Check Dropdown:**
   - Should only show real locations
   - No test/fake location names

3. **Check DynamoDB:**
   - Only production locations exist
   - All locations have proper `displayName`/`locationName`

## Summary

**The fake locations are coming from AWS DynamoDB, not the application code.**

To fix:
1. ✅ Check DynamoDB VenueConfig table for fake locations
2. ✅ Delete or update fake location entries
3. ✅ Clear browser cache/localStorage
4. ✅ Verify Cognito `custom:venueId` matches DynamoDB `venueId`

The application code fetches whatever is in DynamoDB, so any fake locations in the dropdown are stored in your AWS infrastructure, not in the application.
