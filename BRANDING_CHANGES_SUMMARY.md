# Branding and Multi-Tenant Changes Summary

## Changes Made

### 1. ✅ Login Screen Branding
**Location**: `src/components/Logo.tsx` (Line 58)

**Before**: "Ferg's Sports Bar"  
**After**: "Advizia"

The login screen now displays "Advizia" as the company branding for all users.

---

### 2. ✅ Dynamic Company Name in Dashboard
**Location**: `src/components/TopBar.tsx` (Lines 17, 49, 218)

**Before**: Hardcoded "Advizia" in the top bar  
**After**: Dynamic `{venueName}` that changes based on the logged-in user

The top bar now displays the user's company name (e.g., "Ferg's Sports Bar", "Blue Sky Restaurant") based on the `custom:venueName` attribute stored in AWS Cognito.

**Desktop View** (Line 49):
```tsx
<h1 className="text-2xl font-bold text-cyan-400">{venueName}</h1>
```

**Mobile View** (Line 218):
```tsx
<h2 className="text-lg font-bold text-cyan-400">{venueName}</h2>
```

---

### 3. ✅ AI Reports Personalization
**Location**: `src/services/ai-report.service.ts` (Lines 4, 55-60)

**Before**: Hardcoded "Ferg's Sports Bar" in weekly reports  
**After**: Dynamic venue name passed as parameter

AI-generated weekly reports now use the user's company name instead of a hardcoded value.

**Updated in**: `src/pages/Reports.tsx` (Lines 33-34, 52)
```tsx
const user = authService.getStoredUser();
const venueName = user?.venueName;
const report = await aiReportService.generateWeeklyReport(weekStart, weekEnd, metrics, venueName);
```

---

## Zone Selections Explanation

### How Zone Selections Work

**Zone selections** are the locations within a venue (e.g., "Main Floor", "Patio", "Rooftop Bar"). These are configured per company in **AWS DynamoDB**.

### Data Source
Zones come from the **VenueConfig DynamoDB table**:

```json
{
  "venueId": "company-id",      // Matches user's custom:venueId
  "locationId": "main-floor",   // Unique zone identifier
  "displayName": "Main Floor",  // Shown in dropdown
  "mqttTopic": "pulse/company-id/main-floor"
}
```

### Loading Process
1. **User logs in** → AWS Cognito returns `custom:venueId` in JWT token
2. **Frontend fetches zones** → Queries DynamoDB for all locations with matching `venueId`
3. **Displays in dropdown** → Shows locations in the zone selector

### Code Implementation
- **Fetch zones**: `src/services/location.service.ts` (Lines 28-76)
- **Display zones**: `src/components/TopBar.tsx` (Lines 78-174)
- **Fallback**: If no zones found in DynamoDB, shows default zones: "Main Floor", "Patio", "Bar Area"

---

## AWS Cognito Configuration

### Required Custom Attributes

Each user must have these custom attributes set in AWS Cognito:

| Attribute | Purpose | Example |
|-----------|---------|---------|
| `custom:venueId` | Unique company identifier | `fergs-stpete` |
| `custom:venueName` | Display name in dashboard | `Ferg's Sports Bar` |

### Setting Attributes via AWS CLI

```bash
# Create new user with custom attributes
aws cognito-idp admin-create-user \
  --user-pool-id us-east-1_XXXXXXXXX \
  --username manager@company.com \
  --user-attributes \
    Name=email,Value=manager@company.com \
    Name=custom:venueId,Value=company-unique-id \
    Name=custom:venueName,Value="Company Display Name" \
  --temporary-password TempPass123!

# Update existing user's attributes
aws cognito-idp admin-update-user-attributes \
  --user-pool-id us-east-1_XXXXXXXXX \
  --username manager@company.com \
  --user-attributes \
    Name=custom:venueId,Value=company-unique-id \
    Name=custom:venueName,Value="Company Display Name"
```

### Setting Attributes via AWS Console

1. Go to **AWS Cognito** → User Pools → Select your pool
2. Go to **Users** tab
3. Select a user → Click **Edit**
4. Add/Update:
   - `custom:venueId` = `company-unique-id`
   - `custom:venueName` = `Company Display Name`
5. Save changes

---

## User Experience Flow

### Example: Two Different Companies

#### Company A: Ferg's Sports Bar
**Cognito Attributes**:
```
custom:venueId = "fergs-stpete"
custom:venueName = "Ferg's Sports Bar"
```

**User sees**:
- ✅ Login screen: "Advizia" logo
- ✅ Dashboard top bar: "Ferg's Sports Bar"
- ✅ Zone dropdown: Main Floor, Patio, Upstairs (from DynamoDB)
- ✅ AI Reports: "This week at Ferg's Sports Bar showed..."

---

#### Company B: Blue Sky Restaurant
**Cognito Attributes**:
```
custom:venueId = "bluesky-miami"
custom:venueName = "Blue Sky Restaurant"
```

**User sees**:
- ✅ Login screen: "Advizia" logo
- ✅ Dashboard top bar: "Blue Sky Restaurant"
- ✅ Zone dropdown: Main Dining, Rooftop Bar (from DynamoDB)
- ✅ AI Reports: "This week at Blue Sky Restaurant showed..."

---

## Testing Checklist

### ✅ Login Screen
- [ ] Logo shows "Advizia"
- [ ] Welcome message displayed correctly

### ✅ Dashboard Top Bar
- [ ] Company name matches user's `custom:venueName`
- [ ] Zone dropdown shows locations from DynamoDB
- [ ] Zone selection updates MQTT topic correctly

### ✅ AI Reports
- [ ] Generated reports use correct company name
- [ ] Report summary mentions the right venue

### ✅ Multi-Tenant Isolation
- [ ] User A only sees their company name
- [ ] User B only sees their company name
- [ ] Each user sees their own zones
- [ ] Data is isolated by `venueId`

---

## Additional Documentation

For complete multi-tenant setup instructions, see:
- **MULTI_TENANT_SETUP.md** - Detailed guide for adding new companies
- **DATA_SOURCE_CONFIGURATION.md** - DynamoDB schema and zone configuration
- **PERSONALIZATION_IMPLEMENTATION.md** - Original implementation details

---

## Files Modified

1. ✅ `src/components/Logo.tsx` - Changed to "Advizia" branding
2. ✅ `src/components/TopBar.tsx` - Dynamic company name display
3. ✅ `src/services/ai-report.service.ts` - Personalized report generation
4. ✅ `src/pages/Reports.tsx` - Pass venueName to report service

## Files Created

1. 📄 `MULTI_TENANT_SETUP.md` - Complete multi-tenant setup guide
2. 📄 `BRANDING_CHANGES_SUMMARY.md` - This file

---

## Questions & Answers

### Q: Where does the zone selection data come from?
**A**: From the **VenueConfig DynamoDB table**, filtered by the user's `custom:venueId` attribute.

### Q: How do I add a new company?
**A**: Follow the steps in `MULTI_TENANT_SETUP.md`:
1. Create Cognito user with `custom:venueId` and `custom:venueName`
2. Add locations to DynamoDB VenueConfig table
3. Configure IoT devices to publish to correct MQTT topics

### Q: What happens if no zones are configured?
**A**: The app falls back to default zones: "Main Floor", "Patio", "Bar Area"

### Q: Can users change their own company name?
**A**: No. The `custom:venueName` attribute can only be set by AWS Cognito administrators.

---

## Summary

✅ **Login screen** now shows "Advizia" for all users  
✅ **Dashboard** shows each user's company name dynamically  
✅ **Zone selections** are loaded from DynamoDB per company  
✅ **AI reports** are personalized with company name  
✅ **Multi-tenant ready** - each user sees their own branding and data
