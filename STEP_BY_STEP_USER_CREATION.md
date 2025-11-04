# 📋 Step-by-Step Guide: Creating New Venue Users in AWS

This guide walks you through creating a new venue account, connecting it to an RPi device, and ensuring data flows correctly.

---

## 🎯 Overview

**Multi-Tenant Architecture:**
- Each venue has a unique `venueId`
- Each user login is tied to one venue via `custom:venueId` attribute
- Venues **cannot** see each other's data (data isolation)
- Data flows: **RPi → AWS IoT Core → DynamoDB → AppSync → Dashboard**

---

## 📝 Step 1: Create Cognito User Account

### Via AWS Console (Recommended)

1. **Go to AWS Cognito Console**
   - URL: https://console.aws.amazon.com/cognito/
   - Region: `us-east-2`

2. **Select User Pool**
   - User Pool ID: `us-east-2_I6EBJm3te`

3. **Create User**
   - Click **"Users"** tab
   - Click **"Create user"** button
   - Fill in:
     - **Username**: `venue-user@example.com` (email address)
     - **Email address**: `venue-user@example.com`
     - **Temporary password**: Generate or set one (e.g., `TempPass123!`)
     - ✅ **Send email invitation**: Check this
   - Click **"Create user"**

### Via AWS CLI

```bash
aws cognito-idp admin-create-user \
  --user-pool-id us-east-2_I6EBJm3te \
  --username venue-user@example.com \
  --user-attributes Name=email,Value=venue-user@example.com \
  --temporary-password TempPass123! \
  --message-action SUPPRESS \
  --region us-east-2
```

---

## 🔑 Step 2: Set Custom Venue ID Attribute (CRITICAL!)

**⚠️ THIS IS REQUIRED** - Without this, the user cannot access any data!

### Via AWS Console

1. **Click on the user** you just created
2. Scroll to **"Attributes"** section
3. Click **"Edit"**
4. Find **`custom:venueId`** attribute
5. **Set value** to unique venue ID (e.g., `fergs-stpete`, `johns-bar-nyc`)
   - ⚠️ **Must be unique** - each venue gets a different ID
   - ⚠️ **Use lowercase, hyphens** - e.g., `venue-name-city`
6. Click **"Save changes"**

### Via AWS CLI

```bash
# Replace with your actual values
VENUE_ID="fergs-stpete"  # Unique venue identifier
USER_EMAIL="venue-user@example.com"

aws cognito-idp admin-update-user-attributes \
  --user-pool-id us-east-2_I6EBJm3te \
  --username "$USER_EMAIL" \
  --user-attributes Name=custom:venueId,Value="$VENUE_ID" \
  --region us-east-2
```

**✅ Verify it was set:**
```bash
aws cognito-idp admin-get-user \
  --user-pool-id us-east-2_I6EBJm3te \
  --username "$USER_EMAIL" \
  --region us-east-2 \
  | grep -A 2 "custom:venueId"
```

---

## 🔐 Step 3: Set Permanent Password

### Via AWS Console

1. Click on the user
2. Click **"Actions"** → **"Set password"**
3. Enter the password (can be same as temp password)
4. Select **"Set permanent password"** (not temporary)
5. Click **"Set password"**

### Via AWS CLI

```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id us-east-2_I6EBJm3te \
  --username "$USER_EMAIL" \
  --password "NewPassword123!" \
  --permanent \
  --region us-east-2
```

---

## 🗄️ Step 4: Create Venue Configuration in DynamoDB

Each venue needs location entries in the `VenueConfig` table.

### Via AWS Console

1. **Go to DynamoDB Console**
   - URL: https://console.aws.amazon.com/dynamodb/
   - Region: `us-east-2`

2. **Select `VenueConfig` Table**
   - Click on **"VenueConfig"** table
   - Click **"Explore table items"**

3. **Create Item**
   - Click **"Create item"**
   - Add these attributes:

| Attribute Name | Type | Value | Example |
|---------------|------|-------|---------|
| `venueId` | String | Your venue ID | `fergs-stpete` |
| `locationId` | String | Unique location ID | `main-floor` |
| `displayName` | String | Display name | `Main Floor` |
| `locationName` | String | Location name | `Main Bar Area` |
| `mqttTopic` | String | MQTT topic | `venue/fergs-stpete/main-floor` |
| `iotEndpoint` | String | IoT endpoint | `a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com` |
| `address` | String | Physical address | `123 Main St, St. Petersburg, FL` |
| `timezone` | String | Timezone | `America/New_York` |
| `deviceId` | String | RPi device ID | `rpi-001` |

4. Click **"Create item"**

### Via AWS CLI

```bash
VENUE_ID="fergs-stpete"
LOCATION_ID="main-floor"
MQTT_TOPIC="venue/$VENUE_ID/$LOCATION_ID"
IOT_ENDPOINT="a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com"

aws dynamodb put-item \
  --table-name VenueConfig \
  --item '{
    "venueId": {"S": "'"$VENUE_ID"'"},
    "locationId": {"S": "'"$LOCATION_ID"'"},
    "displayName": {"S": "Main Floor"},
    "locationName": {"S": "Main Bar Area"},
    "mqttTopic": {"S": "'"$MQTT_TOPIC"'"},
    "iotEndpoint": {"S": "'"$IOT_ENDPOINT"'"},
    "address": {"S": "123 Main St, St. Petersburg, FL"},
    "timezone": {"S": "America/New_York"},
    "deviceId": {"S": "rpi-001"}
  }' \
  --region us-east-2
```

**✅ Verify it was created:**
```bash
aws dynamodb query \
  --table-name VenueConfig \
  --key-condition-expression "venueId = :vid" \
  --expression-attribute-values '{":vid":{"S":"'"$VENUE_ID"'"}}' \
  --region us-east-2
```

---

## 🤖 Step 5: Configure Raspberry Pi Device

### 5.1 Create IoT Thing in AWS IoT Core

1. **Go to AWS IoT Core Console**
   - URL: https://console.aws.amazon.com/iot/
   - Region: `us-east-2`

2. **Create Thing**
   - Click **"Manage"** → **"Things"**
   - Click **"Create things"**
   - Choose **"Create single thing"**
   - Name: `rpi-001-fergs-stpete` (or your device ID)
   - Click **"Next"**

3. **Create Certificates**
   - Choose **"Auto-generate a new certificate"**
   - Click **"Next"**
   - ⚠️ **Download all certificates** (certificate, private key, root CA)
   - Click **"Next"**

4. **Attach Policy**
   - Create or select a policy that allows:
     ```json
     {
       "Version": "2012-10-17",
       "Statement": [
         {
           "Effect": "Allow",
           "Action": [
             "iot:Connect",
             "iot:Publish",
             "iot:Subscribe"
           ],
           "Resource": "*"
         }
       ]
     }
     ```
   - Click **"Create thing"**

### 5.2 Configure RPi Device

**Install AWS IoT SDK on RPi:**
```bash
# SSH into your Raspberry Pi
ssh pi@your-rpi-ip

# Install Python dependencies
pip3 install aws-iot-device-sdk-python-v2 boto3

# Or use Node.js
npm install aws-iot-device-sdk-v2
```

**Example Python Script (publish-sensors.py):**
```python
import json
import time
from awsiot import mqtt_connection_builder
from awscrt import mqtt

# Configuration
VENUE_ID = "fergs-stpete"
LOCATION_ID = "main-floor"
MQTT_TOPIC = f"venue/{VENUE_ID}/{LOCATION_ID}"
IOT_ENDPOINT = "a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com"
CERT_PATH = "/path/to/certificate.pem.crt"
KEY_PATH = "/path/to/private.pem.key"
ROOT_CA_PATH = "/path/to/root-CA.crt"

# Create MQTT connection
mqtt_connection = mqtt_connection_builder.mtls_from_path(
    endpoint=IOT_ENDPOINT,
    cert_filepath=CERT_PATH,
    pri_key_filepath=KEY_PATH,
    ca_filepath=ROOT_CA_PATH,
    client_id=f"rpi-{VENUE_ID}-{LOCATION_ID}",
    clean_session=False,
    keep_alive_secs=30
)

# Connect
connect_future = mqtt_connection.connect()
connect_future.result()
print("Connected to AWS IoT Core")

# Publish sensor data
while True:
    message = {
        "deviceId": f"rpi-{VENUE_ID}-{LOCATION_ID}",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "sensors": {
            "sound_level": 75.5,  # Replace with actual sensor reading
            "light_level": 350.2,
            "indoor_temperature": 72.0,
            "outdoor_temperature": 68.5,
            "humidity": 55.0
        },
        "spotify": {
            "current_song": "Song Name",
            "album_art": "https://...",
            "artist": "Artist Name"
        },
        "occupancy": {
            "current": 45,
            "entries": 120,
            "exits": 75,
            "capacity": 200
        }
    }
    
    mqtt_connection.publish(
        topic=MQTT_TOPIC,
        payload=json.dumps(message),
        qos=mqtt.QoS.AT_LEAST_ONCE
    )
    
    print(f"Published: {message}")
    time.sleep(15)  # Publish every 15 seconds
```

### 5.3 Set Up IoT Rule to Write to DynamoDB

**Create IoT Rule:**

1. **Go to AWS IoT Core → Act → Rules**
2. **Create Rule**
   - Name: `WriteSensorDataToDynamoDB`
   - SQL Query:
     ```sql
     SELECT * FROM 'venue/+/+'
     ```
   - Add Action: **"Insert a message into a DynamoDB table"**
   - Table: `SensorData`
   - Partition key: `venueId` → `${topic(2)}`
   - Sort key: `timestamp` → `${timestamp()}`
   - Hash key value: `venueId` → `${topic(2)}`
   - Range key value: `timestamp` → `${timestamp()}`
   - Add all message attributes:
     - `decibels` → `${sensors.sound_level}`
     - `light` → `${sensors.light_level}`
     - `indoorTemp` → `${sensors.indoor_temperature}`
     - `outdoorTemp` → `${sensors.outdoor_temperature}`
     - `humidity` → `${sensors.humidity}`
     - `currentSong` → `${spotify.current_song}`
     - `albumArt` → `${spotify.album_art}`
     - `artist` → `${spotify.artist}`
     - `occupancy` → `${occupancy}`
   - Click **"Create"**

**⚠️ Grant IoT Rule Permission:**
- The rule needs IAM role with DynamoDB write permissions
- Create role: `IoTDynamoDBWriteRole`
- Attach policy: `AmazonDynamoDBFullAccess` (or custom policy)

---

## 🧪 Step 6: Test the Setup

### 6.1 Test User Login

1. **Go to your app login page**
2. **Log in with:**
   - Email: `venue-user@example.com`
   - Password: `NewPassword123!`

3. **Check browser console (F12):**
   - ✅ Should see: "✅ Amplify configured successfully"
   - ✅ Should see: "✅ Live sensor data retrieved from DynamoDB"
   - ❌ Should NOT see: "User does not have custom:venueId attribute"

### 6.2 Test Data Flow

**Check DynamoDB has data:**
```bash
VENUE_ID="fergs-stpete"

aws dynamodb query \
  --table-name SensorData \
  --key-condition-expression "venueId = :vid" \
  --expression-attribute-values '{":vid":{"S":"'"$VENUE_ID"'"}}' \
  --region us-east-2 \
  --limit 5 \
  --scan-index-forward false
```

**Check AppSync query:**
```bash
# Test GraphQL query (requires authentication)
# Use AWS AppSync console or Postman with Cognito token
```

### 6.3 Verify Data Isolation

**Test with two different venues:**
1. Create User A with `custom:venueId = "venue-a"`
2. Create User B with `custom:venueId = "venue-b"`
3. Log in as User A → Should only see Venue A data
4. Log in as User B → Should only see Venue B data

---

## 📊 Step 7: Verify Everything Works

### Checklist:

- [ ] User can log in successfully
- [ ] User has `custom:venueId` attribute set
- [ ] `VenueConfig` table has entry for this venue
- [ ] RPi device is publishing to IoT Core
- [ ] IoT Rule is writing to DynamoDB `SensorData` table
- [ ] DynamoDB has data for this `venueId`
- [ ] AppSync resolvers are configured
- [ ] `VITE_GRAPHQL_ENDPOINT` is set in `.env`
- [ ] Dashboard shows live data
- [ ] Other venues cannot see this venue's data

---

## 🔧 Troubleshooting

### Issue: User can log in but sees no data

**Check:**
1. ✅ Does user have `custom:venueId`? → `aws cognito-idp admin-get-user ...`
2. ✅ Does DynamoDB have data? → `aws dynamodb query --table-name SensorData ...`
3. ✅ Is `VITE_GRAPHQL_ENDPOINT` set? → `grep VITE_GRAPHQL_ENDPOINT .env`
4. ✅ Check browser console for errors

### Issue: RPi not publishing data

**Check:**
1. ✅ Are certificates installed correctly?
2. ✅ Is device connected to AWS IoT Core?
3. ✅ Does MQTT topic match `VenueConfig` entry?
4. ✅ Check IoT Core logs: CloudWatch → Logs → `/aws/iot/`

### Issue: Data not appearing in DynamoDB

**Check:**
1. ✅ Is IoT Rule active?
2. ✅ Does Rule have correct SQL query?
3. ✅ Does Rule have DynamoDB write permissions?
4. ✅ Check IoT Rule metrics in CloudWatch

---

## 🎉 Success!

Once everything is set up:
- ✅ User can log in
- ✅ Dashboard shows live sensor data
- ✅ Data is isolated per venue
- ✅ RPi publishes data automatically
- ✅ Historical data is available

---

## 📝 Quick Reference

**Cognito User Pool:** `us-east-2_I6EBJm3te`  
**Region:** `us-east-2`  
**DynamoDB Tables:** `SensorData`, `VenueConfig`, `OccupancyMetrics`  
**IoT Endpoint:** `a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com`  
**MQTT Topic Format:** `venue/{venueId}/{locationId}`

---

## 🚀 Next Steps

1. Create additional locations for the venue (multiple `locationId` entries)
2. Set up occupancy tracking
3. Configure alerts/notifications
4. Set up reports/analytics
