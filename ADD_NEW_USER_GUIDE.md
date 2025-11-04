# 🚀 Complete Guide: Adding a New Venue User with RPI Connection

This guide walks you through creating a new venue account, connecting an RPI device, and ensuring live data appears in the dashboard.

## Overview

Each venue is completely isolated:
- ✅ Each venue has its own `venueId`
- ✅ Each user can only see their venue's data
- ✅ RPI devices connect via AWS IoT and publish to their venue's data
- ✅ No venue can see another venue's data

---

## Step 1: Create Venue ID (Choose a Unique Name)

First, decide on a unique venue identifier. This will be your `venueId` throughout the system.

**Examples:**
- `fergs-stpete`
- `johns-bar-nyc`
- `venue-001`
- `coffee-shop-downtown`

**Rules:**
- Use lowercase letters, numbers, and hyphens
- No spaces or special characters
- Must be unique across all venues
- Keep it short but descriptive

**Let's use `NEW_VENUE_ID` as our example in this guide.**

---

## Step 2: Create Cognito User Account

### Option A: Via AWS Console (Easiest)

1. **Go to AWS Cognito Console:**
   - AWS Console → Cognito → User Pools
   - Select: `us-east-2_I6EBJm3te`

2. **Create User:**
   - Click "Users" tab
   - Click "Create user"
   - Fill in:
     - **Username**: `newuser@venue.com` (or email)
     - **Email address**: `newuser@venue.com`
     - **Temporary password**: Generate secure password
     - ✅ Check "Send email invitation"
   - Click "Create user"

3. **Set Custom Attributes (CRITICAL!):**
   - Click on the newly created user
   - Scroll to "Attributes" section
   - Click "Edit"
   - Find `custom:venueId` attribute
   - Set value to: `NEW_VENUE_ID` (your venue ID from Step 1)
   - Optional: Add `custom:venueName` = `"New Venue Name"`
   - Click "Save changes"

4. **Set Permanent Password:**
   - Click "Actions" → "Set password"
   - Enter new password
   - Select "Set permanent password"
   - Click "Set password"

### Option B: Via AWS CLI (Faster)

```bash
# Set variables
USER_POOL_ID="us-east-2_I6EBJm3te"
EMAIL="newuser@venue.com"
VENUE_ID="NEW_VENUE_ID"
VENUE_NAME="New Venue Name"
TEMP_PASSWORD="TempPass123!"

# Create user with venueId attribute
aws cognito-idp admin-create-user \
  --user-pool-id $USER_POOL_ID \
  --username $EMAIL \
  --user-attributes \
    Name=email,Value=$EMAIL \
    Name=custom:venueId,Value=$VENUE_ID \
    Name=custom:venueName,Value=$VENUE_NAME \
  --temporary-password $TEMP_PASSWORD \
  --message-action SUPPRESS \
  --region us-east-2

# Set permanent password
aws cognito-idp admin-set-user-password \
  --user-pool-id $USER_POOL_ID \
  --username $EMAIL \
  --password $TEMP_PASSWORD \
  --permanent \
  --region us-east-2

echo "✅ User created: $EMAIL"
echo "   Venue ID: $VENUE_ID"
```

**Verify user was created:**
```bash
aws cognito-idp admin-get-user \
  --user-pool-id us-east-2_I6EBJm3te \
  --username newuser@venue.com \
  --region us-east-2
```

Look for:
- ✅ `UserStatus: CONFIRMED`
- ✅ `Name: custom:venueId, Value: NEW_VENUE_ID`

---

## Step 3: Create VenueConfig Entry in DynamoDB

The VenueConfig table stores location information and MQTT configuration for each venue.

### Option A: Via AWS Console

1. **Go to DynamoDB Console:**
   - AWS Console → DynamoDB → Tables
   - Select: `VenueConfig`

2. **Create Item:**
   - Click "Explore table items"
   - Click "Create item"
   - Add these attributes:
     - `venueId` (String): `NEW_VENUE_ID`
     - `locationId` (String): `main-floor` (or your location name)
     - `displayName` (String): `Main Floor`
     - `locationName` (String): `Main Floor`
     - `mqttTopic` (String): `venue/NEW_VENUE_ID/sensors` (RPI will publish here)
     - `deviceId` (String): `rpi-001` (your RPI device identifier)
     - `address` (String): `123 Main St, City, State` (optional)
     - `timezone` (String): `America/New_York` (optional)
     - `iotEndpoint` (String): `a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com` (optional, uses default if not set)

3. **Save Item**

### Option B: Via AWS CLI

```bash
# Set variables
VENUE_ID="NEW_VENUE_ID"
LOCATION_ID="main-floor"
DISPLAY_NAME="Main Floor"
MQTT_TOPIC="venue/NEW_VENUE_ID/sensors"
DEVICE_ID="rpi-001"
IOT_ENDPOINT="a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com"

# Create VenueConfig entry
aws dynamodb put-item \
  --table-name VenueConfig \
  --item '{
    "venueId": {"S": "'$VENUE_ID'"},
    "locationId": {"S": "'$LOCATION_ID'"},
    "displayName": {"S": "'$DISPLAY_NAME'"},
    "locationName": {"S": "'$DISPLAY_NAME'"},
    "mqttTopic": {"S": "'$MQTT_TOPIC'"},
    "deviceId": {"S": "'$DEVICE_ID'"},
    "iotEndpoint": {"S": "'$IOT_ENDPOINT'"},
    "timezone": {"S": "America/New_York"}
  }' \
  --region us-east-2

echo "✅ VenueConfig entry created"
```

**Multiple Locations?**
If your venue has multiple locations (e.g., main floor, rooftop, basement), create separate VenueConfig entries with different `locationId` values but same `venueId`.

---

## Step 4: Configure AWS IoT Core for RPI

Your RPI needs to publish sensor data to AWS IoT Core, which then stores it in DynamoDB.

### 4.1: Create IoT Thing (Device Identity)

1. **Go to AWS IoT Console:**
   - AWS Console → IoT Core → Manage → Things
   - Click "Create thing"

2. **Create Thing:**
   - Thing name: `rpi-NEW_VENUE_ID-001` (or your device name)
   - Click "Next"

3. **Create Device Certificate:**
   - Choose "One-click certificate creation" (recommended)
   - Click "Create certificate"
   - **IMPORTANT:** Download all 3 files:
     - Certificate (PEM)
     - Private key (PEM)
     - Root CA certificate
   - **SAVE THESE FILES** - you'll need them for your RPI
   - Click "Activate"

4. **Attach Policy:**
   - Click "Attach policy"
   - Either create a new policy or use existing one
   - Policy should allow:
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
           "Resource": [
             "arn:aws:iot:us-east-2:ACCOUNT_ID:client/rpi-*",
             "arn:aws:iot:us-east-2:ACCOUNT_ID:topic/venue/*"
           ]
         }
       ]
     }
     ```
   - Click "Attach"

### 4.2: Create IoT Rule to Store Data in DynamoDB

1. **Go to IoT Rules:**
   - AWS Console → IoT Core → Message routing → Rules
   - Click "Create rule"

2. **Configure Rule:**
   - Rule name: `StoreSensorData-NEW_VENUE_ID`
   - SQL version: `2023-10-31`
   - SQL statement:
     ```sql
     SELECT * FROM 'venue/NEW_VENUE_ID/sensors'
     ```
   - Click "Next"

3. **Configure Action:**
   - Action: "Insert a message into a DynamoDB table"
   - Table name: `SensorData`
   - Partition key: `venueId` (String)
   - Partition key value: `NEW_VENUE_ID`
   - Sort key: `timestamp` (String)
   - Sort key value: `${timestamp()}`
   - Payload: `SELECT *`
   - Click "Create role" (if needed) - allows IoT to write to DynamoDB
   - Click "Next"

4. **Review and Create:**
   - Review settings
   - Click "Create"

**This rule will automatically:**
- Listen to MQTT topic: `venue/NEW_VENUE_ID/sensors`
- Store messages in DynamoDB `SensorData` table
- Use `NEW_VENUE_ID` as the `venueId`

---

## Step 5: Configure RPI to Publish Data

Your RPI needs to publish sensor data to the MQTT topic. Here's a Python example:

### 5.1: Install Required Libraries

```bash
# On your RPI
pip install awsiotsdk paho-mqtt
```

### 5.2: RPI Code Example

Create `publish_sensors.py`:

```python
import json
import time
from datetime import datetime
from awscrt import io, mqtt
from awsiot import mqtt_connection_builder

# Configuration
VENUE_ID = "NEW_VENUE_ID"
ENDPOINT = "a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com"
TOPIC = f"venue/{VENUE_ID}/sensors"
CERT_PATH = "/path/to/certificate.pem.crt"
KEY_PATH = "/path/to/private.pem.key"
ROOT_CA_PATH = "/path/to/root-CA.crt"

# Create MQTT connection
event_loop_group = io.EventLoopGroup(1)
host_resolver = io.DefaultHostResolver(event_loop_group)
client_bootstrap = io.ClientBootstrap(event_loop_group, host_resolver)

mqtt_connection = mqtt_connection_builder.mtls_from_path(
    endpoint=ENDPOINT,
    cert_filepath=CERT_PATH,
    pri_key_filepath=KEY_PATH,
    ca_filepath=ROOT_CA_PATH,
    client_bootstrap=client_bootstrap,
    client_id=f"rpi-{VENUE_ID}-{int(time.time())}",
    clean_session=False,
    keep_alive_secs=30
)

# Connect
connect_future = mqtt_connection.connect()
connect_future.result()
print("Connected to AWS IoT Core")

# Publish sensor data every 15 seconds
while True:
    # Read sensor data (replace with your actual sensor reading code)
    sensor_data = {
        "deviceId": "rpi-001",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "sensors": {
            "sound_level": 75.5,  # Replace with actual sensor reading
            "light_level": 350.2,
            "indoor_temperature": 72.0,
            "outdoor_temperature": 68.5,
            "humidity": 55.0
        },
        "spotify": {
            "current_song": "Song Title",
            "artist": "Artist Name",
            "album_art": "https://..."
        },
        "occupancy": {
            "current": 45,
            "entries": 120,
            "exits": 75,
            "capacity": 200
        }
    }
    
    # Publish
    message_json = json.dumps(sensor_data)
    mqtt_connection.publish(
        topic=TOPIC,
        payload=message_json,
        qos=mqtt.QoS.AT_LEAST_ONCE
    )
    print(f"Published: {message_json}")
    
    time.sleep(15)  # Publish every 15 seconds
```

### 5.3: Run on RPI

```bash
# Make executable
chmod +x publish_sensors.py

# Run (or set up as systemd service)
python3 publish_sensors.py
```

---

## Step 6: Verify Data Flow

### 6.1: Check IoT Core is Receiving Messages

1. **Go to AWS IoT Console:**
   - IoT Core → Test → MQTT test client
   - Subscribe to topic: `venue/NEW_VENUE_ID/sensors`
   - You should see messages arriving every 15 seconds

### 6.2: Check DynamoDB Has Data

```bash
# Query SensorData table
aws dynamodb query \
  --table-name SensorData \
  --key-condition-expression "venueId = :v" \
  --expression-attribute-values '{":v":{"S":"NEW_VENUE_ID"}}' \
  --region us-east-2 \
  --limit 5
```

You should see recent sensor data entries.

### 6.3: Test Login in App

1. **Login to app** with the user you created:
   - Email: `newuser@venue.com`
   - Password: (the password you set)

2. **Check browser console (F12):**
   - Should see: `"Fetching live sensor data from DynamoDB for venue: NEW_VENUE_ID"`
   - Should see: `"Live sensor data retrieved from DynamoDB"`
   - Should see: `"Loaded 1 locations from DynamoDB"`

3. **Dashboard should show:**
   - ✅ Live sensor data (temperature, sound, light, etc.)
   - ✅ Location selector (if multiple locations)
   - ✅ Comfort gauge
   - ✅ Charts with data

---

## Step 7: (Optional) Add Occupancy Metrics

If you want occupancy metrics to show in the dashboard:

```bash
# Create OccupancyMetrics entry
aws dynamodb put-item \
  --table-name OccupancyMetrics \
  --item '{
    "venueId": {"S": "NEW_VENUE_ID"},
    "current": {"N": "0"},
    "todayEntries": {"N": "0"},
    "todayExits": {"N": "0"},
    "peakOccupancy": {"N": "0"},
    "sevenDayAvg": {"N": "0"},
    "fourteenDayAvg": {"N": "0"},
    "thirtyDayAvg": {"N": "0"}
  }' \
  --region us-east-2
```

**Note:** The IoT rule can also update this table automatically if configured.

---

## Troubleshooting

### Issue: "No data showing in dashboard"
1. ✅ Check user has `custom:venueId` = `NEW_VENUE_ID` in Cognito
2. ✅ Check VenueConfig table has entry with `venueId` = `NEW_VENUE_ID`
3. ✅ Check SensorData table has entries with `venueId` = `NEW_VENUE_ID`
4. ✅ Check RPI is publishing to correct topic: `venue/NEW_VENUE_ID/sensors`
5. ✅ Check IoT rule is listening to correct topic
6. ✅ Check `VITE_GRAPHQL_ENDPOINT` is set in `.env` file

### Issue: "RPI can't connect to IoT"
1. ✅ Check certificate files are correct
2. ✅ Check IoT endpoint URL is correct
3. ✅ Check IoT policy allows Connect, Publish, Subscribe
4. ✅ Check RPI has internet connection
5. ✅ Check firewall allows outbound MQTT (port 8883)

### Issue: "Data not appearing in DynamoDB"
1. ✅ Check IoT rule is active
2. ✅ Check IoT rule SQL matches your topic
3. ✅ Check DynamoDB table name matches (`SensorData`)
4. ✅ Check IoT has permissions to write to DynamoDB
5. ✅ Check IoT rule action is configured correctly

---

## Quick Reference: All Required Values

For venue `NEW_VENUE_ID`:

| Component | Value |
|-----------|-------|
| **Cognito** | `custom:venueId` = `NEW_VENUE_ID` |
| **VenueConfig** | `venueId` = `NEW_VENUE_ID` |
| **SensorData** | `venueId` = `NEW_VENUE_ID` |
| **IoT Topic** | `venue/NEW_VENUE_ID/sensors` |
| **MQTT Topic** | `venue/NEW_VENUE_ID/sensors` |

---

## Summary Checklist

- [ ] Created unique `venueId` (e.g., `NEW_VENUE_ID`)
- [ ] Created Cognito user with `custom:venueId` attribute
- [ ] Created VenueConfig entry in DynamoDB
- [ ] Created IoT Thing for RPI device
- [ ] Downloaded IoT certificates (cert, key, root CA)
- [ ] Created IoT policy allowing publish/subscribe
- [ ] Created IoT rule to store data in DynamoDB
- [ ] Configured RPI to publish to MQTT topic
- [ ] Verified IoT receives messages
- [ ] Verified DynamoDB has data
- [ ] Tested login in app
- [ ] Verified dashboard shows live data

---

**That's it!** Once all steps are complete, your new venue user can log in and see live data from their RPI device. Each venue is completely isolated, and they can't see each other's data.

**Remember:** The key is ensuring all components use the same `venueId`:
- Cognito user attribute: `custom:venueId`
- DynamoDB entries: `venueId`
- IoT topic: `venue/{venueId}/sensors`

If any component uses a different `venueId`, the data won't appear for that user.
