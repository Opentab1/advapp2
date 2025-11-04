# Branding and Company Name Configuration

## Overview
This document explains how zone selections work and how to configure company names per user in AWS Cognito.

## Zone Selections

### How Zone Selections Work
Zone selections (locations) are retrieved from **DynamoDB** via the `locationService.fetchLocationsFromDynamoDB()` method:

1. **Source**: DynamoDB `VenueConfig` table
2. **Query**: Based on the user's `custom:venueId` attribute from Cognito
3. **Flow**:
   - User logs in → Auth service extracts `custom:venueId` from Cognito token
   - Dashboard calls `locationService.fetchLocationsFromDynamoDB()`
   - Service queries DynamoDB GraphQL API for all locations matching the `venueId`
   - Locations are cached for 5 minutes in localStorage
   - User can select different zones/locations from the dropdown in TopBar

### Location Structure
Each location includes:
- `locationId`: Unique identifier (e.g., "main-floor", "patio")
- `displayName`: Display name shown in the UI
- `locationName`: Alternative name
- `address`: Location address
- `timezone`: Timezone for the location
- `deviceId`: Associated IoT device ID
- `mqttTopic`: MQTT topic for real-time data

## Company Name Configuration

### Login Screen
- **Branding**: Shows "Advizia" (hardcoded)
- **Location**: Logo component (`src/components/Logo.tsx`)
- **Purpose**: Generic branding for the login experience

### Dashboard (After Login)
- **Branding**: Shows the user's company name (from AWS Cognito)
- **Location**: TopBar component (`src/components/TopBar.tsx`)
- **Source**: `custom:companyName` attribute from Cognito user attributes

### AWS Cognito Configuration

To set a company name for a user, you need to add the `custom:companyName` custom attribute to the user in AWS Cognito.

#### Step 1: Ensure Custom Attribute Exists
First, make sure the `custom:companyName` attribute is defined in your Cognito User Pool:

1. Go to AWS Cognito Console
2. Select your User Pool
3. Go to **Sign-up experience** → **Attributes**
4. Under **Custom attributes**, ensure `companyName` exists
   - If not, click **Add custom attribute**
   - Name: `companyName`
   - Type: `String`
   - Mutable: Yes

#### Step 2: Set Company Name for a User

**Using AWS CLI:**
```bash
aws cognito-idp admin-update-user-attributes \
  --user-pool-id YOUR_USER_POOL_ID \
  --username USER_EMAIL \
  --user-attributes Name=custom:companyName,Value="Your Company Name"
```

**Using AWS Console:**
1. Go to Cognito → Your User Pool → Users
2. Select the user
3. Click **Edit**
4. Scroll to **Custom attributes**
5. Set `companyName` to the desired company name
6. Click **Save changes**

#### Step 3: Fallback Behavior
If `custom:companyName` is not set:
1. Falls back to `custom:venueName` (if available)
2. Falls back to "Advizia" (if neither is set)

### Example: Setting Company Name for Multiple Users

```bash
# User 1 - Ferg's Sports Bar
aws cognito-idp admin-update-user-attributes \
  --user-pool-id us-east-1_XXXXXXXXX \
  --username user1@example.com \
  --user-attributes Name=custom:companyName,Value="Ferg's Sports Bar"

# User 2 - Another Company
aws cognito-idp admin-update-user-attributes \
  --user-pool-id us-east-1_XXXXXXXXX \
  --username user2@example.com \
  --user-attributes Name=custom:companyName,Value="Another Company Name"
```

## Code Implementation

### User Type
```typescript
export interface User {
  id: string;
  email: string;
  venueId: string;
  venueName: string;
  companyName?: string;  // Optional - from custom:companyName
  locations?: Location[];
}
```

### Auth Service
The auth service extracts `custom:companyName` from the Cognito ID token:
```typescript
const companyName = (payload?.['custom:companyName'] as string) || venueName || 'Advizia';
```

### Display Logic
- **Login Screen**: Always shows "Advizia"
- **TopBar**: Shows `companyName || 'Advizia'`
- **Mobile View**: Same as TopBar

## Testing

1. **Login Screen**: Should show "Advizia" logo and text
2. **After Login**: Should show the company name from `custom:companyName` attribute
3. **Multiple Users**: Each user should see their own company name
4. **Fallback**: User without `custom:companyName` should see `venueName` or "Advizia"

## Summary

- ✅ Login screen now shows "Advizia" (not "Ferg's Sports Bar")
- ✅ Dashboard shows company name from `custom:companyName` Cognito attribute
- ✅ Falls back to `venueName` or "Advizia" if company name not set
- ✅ Zone selections come from DynamoDB based on `venueId`
- ✅ Each user can have their own company name configured in AWS Cognito
