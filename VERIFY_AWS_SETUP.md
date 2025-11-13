# ✅ Verify Your AWS Setup - Quick Checklist

Use this checklist to verify what's already configured in your AWS account.

## Step 1: Find Your VenueId and User

### Go to AWS Cognito Console

1. **Open:** [AWS Cognito Console](https://us-east-2.console.aws.amazon.com/cognito/v2/idp/user-pools?region=us-east-2)
2. **Click on:** User pool `us-east-2_sMY1wYEF9`
3. **Go to:** Users tab
4. **Find your user(s)** - You should see at least one user

### Check User Attributes

Click on a user and check:
- ✅ **Email:** `_____________________` (write it down)
- ✅ **custom:venueId:** `_____________________` (write it down - THIS IS CRITICAL!)
- ✅ **UserStatus:** Should be "CONFIRMED" (not "FORCE_CHANGE_PASSWORD")

**If custom:venueId is missing:**
- Click "Edit" on the user
- Add attribute: `custom:venueId` = `your-venue-id` (choose a simple name like "my-bar" or "test-venue")
- Save

**Your VenueId:** `_____________________` (fill this in!)

---

## Step 2: Check VenueConfig Table

### Go to DynamoDB Console

1. **Open:** [DynamoDB Console](https://us-east-2.console.aws.amazon.com/dynamodbv2/home?region=us-east-2#tables)
2. **Click on:** `VenueConfig` table
3. **Click:** "Explore table items"

### Check for Your Venue Entry

Look for an entry with:
- `venueId` = Your venueId (from Step 1)
- `locationId` = Usually "main-floor" or similar

**If entry exists:**
- ✅ Note the `mqttTopic` value: `_____________________`
- ✅ Should be: `venue/{yourVenueId}/sensors`

**If entry DOESN'T exist:**
- Click "Create item"
- Add these attributes:
  - `venueId` (String): Your venueId
  - `locationId` (String): `main-floor`
  - `displayName` (String): `Main Floor`
  - `locationName` (String): `Main Floor`
  - `mqttTopic` (String): `venue/{yourVenueId}/sensors` (replace with your venueId)
  - `deviceId` (String): `{yourVenueId}-rpi-001`
  - `iotEndpoint` (String): `a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com`
- Click "Create item"

---

## Step 3: Check IoT Thing

### Go to AWS IoT Console

1. **Open:** [AWS IoT Console](https://us-east-2.console.aws.amazon.com/iot/home?region=us-east-2#/thinghub)
2. **Click:** "Manage" → "Things"

### Look for Your Device

Search for: `{yourVenueId}-rpi-001` or similar name

**If IoT Thing exists:**
- ✅ Thing name: `_____________________`
- Click on it → "Certificates" tab
- Check if certificate exists and is "Active"

**If IoT Thing DOESN'T exist:**
- You'll need to create it (see RPI_SETUP_GUIDE.md Step 2)

**If certificate exists but not downloaded:**
- ❌ **PROBLEM:** You can't download the private key again
- **Solution:** Delete the thing and create a new one with new certificates

---

## Step 4: Check IoT Policy

### Go to AWS IoT Console → Policies

1. **Open:** [AWS IoT Policies](https://us-east-2.console.aws.amazon.com/iot/home?region=us-east-2#/policyhub)
2. Look for policy named `PulseDevicePolicy` or similar

**If policy exists:**
- ✅ Click on it to verify it allows:
  - `iot:Connect`
  - `iot:Publish`
  - `iot:Subscribe`
  - `iot:Receive`
- ✅ Resource should be `*` or include `arn:aws:iot:us-east-2:*:topic/venue/*`

**If policy DOESN'T exist:**
- Create it (see RPI_SETUP_GUIDE.md Step 2)

**Verify policy is attached to certificate:**
- Go back to your IoT Thing → Certificates → Click certificate
- Check "Policies" section - should show `PulseDevicePolicy`

---

## Step 5: Check IoT Rule

### Go to AWS IoT Console → Message routing

1. **Open:** [AWS IoT Rules](https://us-east-2.console.aws.amazon.com/iot/home?region=us-east-2#/rulehub)
2. Look for rule named like: `StoreSensorData-{yourVenueId}`

**If rule exists:**
- ✅ Click on it to verify:
- ✅ SQL statement: `SELECT * FROM 'venue/{yourVenueId}/sensors'`
- ✅ Action: DynamoDB → Table: `SensorData`
- ✅ Status: Enabled (green)

**If rule DOESN'T exist:**
- Create it (see RPI_SETUP_GUIDE.md Step 3)

---

## Step 6: Check SensorData Table

### Go to DynamoDB Console

1. **Open:** [DynamoDB Console](https://us-east-2.console.aws.amazon.com/dynamodbv2/home?region=us-east-2#tables)
2. **Click on:** `SensorData` table
3. **Click:** "Explore table items"

**Check:**
- ✅ Table exists
- If you see entries with your venueId - great! Data is already being stored
- If empty - that's okay, data will appear once RPi starts publishing

---

## Step 7: Check AppSync GraphQL Endpoint

### Go to AWS AppSync Console

1. **Open:** [AWS AppSync Console](https://us-east-2.console.aws.amazon.com/appsync/home?region=us-east-2#/apis)
2. Look for API named `PulseDashboardAPI` or similar

**If API exists:**
- ✅ Click on it
- ✅ Copy the "API URL" - should look like: `https://xxxxx.appsync-api.us-east-2.amazonaws.com/graphql`
- ✅ **IMPORTANT:** Update your `.env` file with this URL:
  ```
  VITE_GRAPHQL_ENDPOINT=https://xxxxx.appsync-api.us-east-2.amazonaws.com/graphql
  ```

**Check:**
- Go to "Schema" - should have queries like `listSensorData`, `getVenueConfig`
- Go to "Data sources" - should have `SensorDataTable`, `VenueConfigTable`, `OccupancyMetricsTable`
- Go to "Resolvers" - should have resolvers attached to each query

---

## Summary Checklist

Use this to verify everything is set up:

### AWS Cognito
- [ ] User exists with email: `_____________________`
- [ ] User has `custom:venueId`: `_____________________`
- [ ] User status is CONFIRMED (not FORCE_CHANGE_PASSWORD)
- [ ] You know the password for this user

### DynamoDB
- [ ] `VenueConfig` table has entry for your venueId
- [ ] `VenueConfig` entry has `mqttTopic` set correctly
- [ ] `SensorData` table exists (may be empty, that's okay)
- [ ] `OccupancyMetrics` table exists (optional)

### AWS IoT Core
- [ ] IoT Thing exists named: `_____________________`
- [ ] Certificate is attached and ACTIVE
- [ ] You have downloaded these files:
  - [ ] `certificate.pem.crt`
  - [ ] `private.pem.key`
  - [ ] `root-CA.crt` (or AmazonRootCA1.pem)
- [ ] IoT Policy exists and is attached to certificate
- [ ] IoT Rule exists to route to DynamoDB
- [ ] Rule is ENABLED

### AppSync GraphQL
- [ ] AppSync API exists
- [ ] API URL copied to `.env` file as `VITE_GRAPHQL_ENDPOINT`
- [ ] Schema has sensor data queries
- [ ] Resolvers are attached and configured
- [ ] Data sources are linked to DynamoDB tables

---

## What You Need to Connect Your RPi

Based on the checklist above, you need:

1. **Your VenueId:** `_____________________`
2. **Your User Email/Password:** `_____________________` / `_____________________`
3. **IoT Certificate Files:**
   - [ ] `certificate.pem.crt` - Downloaded and saved
   - [ ] `private.pem.key` - Downloaded and saved
   - [ ] `root-CA.crt` - Downloaded and saved

4. **MQTT Topic:** `venue/{yourVenueId}/sensors`

---

## Next Steps

Once you've verified everything above:

1. **Copy certificate files to your RPi** (USB drive, scp, etc.)
2. **Copy `rpi-sensor-publisher.py` to your RPi**
3. **Edit the script** to set your `VENUE_ID`
4. **Run the script** and verify data appears in dashboard

See **RPI_SETUP_GUIDE.md** for detailed step-by-step instructions!

---

## Quick Test - Verify Dashboard Works

Before setting up the RPi, verify your dashboard works:

1. **Start the dashboard:**
   ```bash
   npm run dev
   ```

2. **Open:** http://localhost:5173

3. **Log in** with your user email/password

4. **Check browser console (F12):**
   - Should see: "Fetching live sensor data from DynamoDB for venue: {yourVenueId}"
   - May see: "No sensor data found" - that's okay! Once RPi starts publishing, data will appear

5. **If you see errors:**
   - Check `.env` file has `VITE_GRAPHQL_ENDPOINT` set
   - Check user has `custom:venueId` attribute
   - Check VenueConfig table has entry for your venueId

---

## Need Help?

**Common Issues:**

1. **"Can't find venueId"** → User doesn't have `custom:venueId` set in Cognito
2. **"No data found"** → Either no data in DynamoDB yet (normal) OR venueId mismatch
3. **"GraphQL errors"** → Check AppSync endpoint in `.env` file
4. **"Connection failed"** → Check IoT certificates and policy

**Next Step:** Once you've verified everything in AWS, follow **RPI_SETUP_GUIDE.md** to connect your RPi!
