# Multi-Tenant Setup Guide

This guide explains how to configure the application for multiple accounts/companies, with each user seeing their own company name throughout the dashboard.

## Overview

The application is designed to support multiple tenants (companies/venues). Each user account is associated with a specific company, and the UI dynamically displays:
- **Login Screen**: Shows "Advizia" branding
- **Dashboard Top Bar**: Shows the user's company name (e.g., "Ferg's Sports Bar", "Blue Sky Restaurant", etc.)
- **Zone Selections**: Shows locations configured for that specific company

## User Attributes in AWS Cognito

Each user in AWS Cognito must have the following custom attributes configured:

### Required Custom Attributes

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| `custom:venueId` | String | Unique identifier for the venue/company | `fergs-stpete` |
| `custom:venueName` | String | Display name of the company (shown in top bar) | `Ferg's Sports Bar` |

### How to Set Custom Attributes

#### Option 1: AWS Console (Manual)

1. **Navigate to AWS Cognito**:
   - Go to AWS Console → Cognito → User Pools
   - Select your user pool (e.g., `pulse-user-pool-prod`)

2. **Add Custom Attributes** (One-time setup):
   - Go to "Sign-up experience" tab
   - Under "Custom attributes", add:
     - `venueId` (String, mutable)
     - `venueName` (String, mutable)

3. **Set Attributes for Each User**:
   - Go to "Users" tab
   - Select a user
   - Click "Edit" under "User attributes"
   - Add/Update:
     - `custom:venueId` = `company-unique-id`
     - `custom:venueName` = `Company Display Name`
   - Save changes

#### Option 2: AWS CLI (Automated)

```bash
# Create a new user with custom attributes
aws cognito-idp admin-create-user \
  --user-pool-id us-east-1_XXXXXXXXX \
  --username user@example.com \
  --user-attributes \
    Name=email,Value=user@example.com \
    Name=custom:venueId,Value=company-unique-id \
    Name=custom:venueName,Value="Company Display Name" \
  --temporary-password TempPassword123!

# Update existing user's custom attributes
aws cognito-idp admin-update-user-attributes \
  --user-pool-id us-east-1_XXXXXXXXX \
  --username user@example.com \
  --user-attributes \
    Name=custom:venueId,Value=company-unique-id \
    Name=custom:venueName,Value="Company Display Name"
```

#### Option 3: Amplify Admin UI

1. Go to AWS Amplify Console
2. Select your app → Backend environments
3. Navigate to User Management
4. Select a user and edit their attributes
5. Add/update custom attributes

## Zone Selections Configuration

Zone selections (locations) are configured in the **DynamoDB VenueConfig table** and are specific to each `venueId`.

### DynamoDB Table Structure

**Table Name**: `VenueConfig-prod` (or your environment-specific name)

**Schema**:
```json
{
  "venueId": "fergs-stpete",         // Partition Key
  "locationId": "main-floor",         // Sort Key
  "displayName": "Main Floor",
  "locationName": "Main Floor",
  "address": "1320 Central Ave, St. Petersburg, FL",
  "timezone": "America/New_York",
  "deviceId": "fergs-main-floor-001",
  "mqttTopic": "pulse/fergs-stpete/main-floor"
}
```

### Adding Zones for a Company

#### Example: Add zones for "Blue Sky Restaurant"

```bash
# User setup in Cognito
aws cognito-idp admin-update-user-attributes \
  --user-pool-id us-east-1_XXXXXXXXX \
  --username manager@bluesky.com \
  --user-attributes \
    Name=custom:venueId,Value=bluesky-miami \
    Name=custom:venueName,Value="Blue Sky Restaurant"

# Add Main Dining location
aws dynamodb put-item \
  --table-name VenueConfig-prod \
  --item '{
    "venueId": {"S": "bluesky-miami"},
    "locationId": {"S": "main-dining"},
    "displayName": {"S": "Main Dining"},
    "locationName": {"S": "Main Dining Area"},
    "address": {"S": "123 Ocean Drive, Miami, FL"},
    "timezone": {"S": "America/New_York"},
    "deviceId": {"S": "bluesky-main-001"},
    "mqttTopic": {"S": "pulse/bluesky-miami/main-dining"}
  }'

# Add Rooftop Bar location
aws dynamodb put-item \
  --table-name VenueConfig-prod \
  --item '{
    "venueId": {"S": "bluesky-miami"},
    "locationId": {"S": "rooftop"},
    "displayName": {"S": "Rooftop Bar"},
    "locationName": {"S": "Rooftop Terrace"},
    "address": {"S": "123 Ocean Drive, Miami, FL"},
    "timezone": {"S": "America/New_York"},
    "deviceId": {"S": "bluesky-rooftop-001"},
    "mqttTopic": {"S": "pulse/bluesky-miami/rooftop"}
  }'
```

## How It Works

### Authentication Flow

1. **User logs in** with email/password
2. **AWS Cognito returns JWT token** containing:
   ```json
   {
     "custom:venueId": "bluesky-miami",
     "custom:venueName": "Blue Sky Restaurant",
     "email": "manager@bluesky.com"
   }
   ```
3. **Frontend extracts user data** from token:
   - `src/services/auth.service.ts` reads the custom attributes
   - Stores in `User` object with `venueId` and `venueName`

4. **Dashboard loads**:
   - Top bar displays `venueName` (e.g., "Blue Sky Restaurant")
   - Fetches zones from DynamoDB using `venueId`
   - Shows zone dropdown with configured locations

### Data Isolation

Each user can only access data for their `venueId`:
- **Live Data**: `GET /live/{venueId}`
- **Historical Data**: `GET /history/{venueId}?days=7`
- **Occupancy Metrics**: `GET /occupancy/{venueId}/metrics`
- **MQTT Topics**: `pulse/{venueId}/{locationId}`

### Zone Selection

When user changes zones:
1. Frontend updates `currentLocationId` in localStorage
2. Switches to MQTT topic: `pulse/{venueId}/{locationId}`
3. Fetches data for that specific location

## Example Multi-Tenant Setup

### Company 1: Ferg's Sports Bar

**Cognito User**:
```
Email: manager@fergssportsbar.com
custom:venueId: fergs-stpete
custom:venueName: Ferg's Sports Bar
```

**DynamoDB Locations**:
- `fergs-stpete` / `main-floor` → "Main Floor"
- `fergs-stpete` / `patio` → "Outdoor Patio"
- `fergs-stpete` / `upstairs` → "Upstairs Bar"

**User Experience**:
- Login screen shows: "Advizia" logo
- Dashboard top bar shows: "Ferg's Sports Bar"
- Zone dropdown shows: Main Floor, Outdoor Patio, Upstairs Bar

### Company 2: Blue Sky Restaurant

**Cognito User**:
```
Email: manager@bluesky.com
custom:venueId: bluesky-miami
custom:venueName: Blue Sky Restaurant
```

**DynamoDB Locations**:
- `bluesky-miami` / `main-dining` → "Main Dining"
- `bluesky-miami` / `rooftop` → "Rooftop Bar"

**User Experience**:
- Login screen shows: "Advizia" logo
- Dashboard top bar shows: "Blue Sky Restaurant"
- Zone dropdown shows: Main Dining, Rooftop Bar

## Adding a New Company

### Step-by-Step Checklist

1. ✅ **Choose unique venueId**: Use lowercase, hyphens only (e.g., `oceanview-nyc`)

2. ✅ **Create Cognito user**:
   ```bash
   aws cognito-idp admin-create-user \
     --user-pool-id us-east-1_XXXXXXXXX \
     --username manager@oceanview.com \
     --user-attributes \
       Name=email,Value=manager@oceanview.com \
       Name=custom:venueId,Value=oceanview-nyc \
       Name=custom:venueName,Value="Ocean View Restaurant" \
     --temporary-password TempPass123!
   ```

3. ✅ **Add locations to DynamoDB** (at least one):
   ```bash
   aws dynamodb put-item --table-name VenueConfig-prod --item '{...}'
   ```

4. ✅ **Configure IoT devices** to publish to MQTT topics:
   - Topic format: `pulse/{venueId}/{locationId}`
   - Example: `pulse/oceanview-nyc/main-dining`

5. ✅ **Test login**:
   - User receives temporary password via email
   - Logs in and sets new password
   - Dashboard shows "Ocean View Restaurant" in top bar
   - Zone dropdown shows configured locations

## Troubleshooting

### User sees "Authentication required" error

**Cause**: Missing `custom:venueId` attribute

**Fix**: Add the custom attribute to the user in Cognito

### Zone dropdown is empty or shows default zones

**Cause**: No locations configured in DynamoDB for this `venueId`

**Fix**: Add at least one location to the VenueConfig table

### Dashboard shows "Advizia" instead of company name

**Cause**: Missing `custom:venueName` attribute

**Fix**: Add the custom attribute to the user in Cognito. If not set, it defaults to "Pulse Dashboard"

### No data showing in dashboard

**Cause**: No IoT device publishing to the MQTT topic, or wrong topic format

**Fix**: 
- Verify MQTT topic format: `pulse/{venueId}/{locationId}`
- Check IoT device is publishing data
- Verify VenueConfig has correct `mqttTopic` field

## Code References

### Where attributes are read
- `src/services/auth.service.ts` (lines 122-123)
- `src/types/index.ts` (lines 1-7)

### Where venueName is displayed
- `src/components/TopBar.tsx` (lines 17, 49, 218)
- `src/pages/Dashboard.tsx` (line 207)

### Where zones are loaded
- `src/services/location.service.ts` (lines 28-76)

### Where zones are displayed
- `src/components/TopBar.tsx` (lines 51, 55-174)

## Security Notes

- Each user can only access data for their assigned `venueId`
- API enforces venueId isolation at the backend
- MQTT topics are scoped per venueId
- Users cannot change their own venueId or venueName (admin-only)
