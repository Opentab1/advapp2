# 🏢 COMPLETE VENUE SETUP GUIDE
## Adding New Venues & Users to Your Multi-Tenant App

This guide shows you EXACTLY how to add a new venue, create a user for them, and connect their Raspberry Pi sensor. Everything is designed for **maximum data isolation** - each venue only sees their own data.

---

## 🎯 GOAL: Add New Venue in 10 Minutes

By the end, you'll have:
- ✅ New venue user account in Cognito
- ✅ Venue data in DynamoDB (VenueConfig)
- ✅ Raspberry Pi connected and sending data
- ✅ Venue can login and see ONLY their data

---

## 📋 WHAT YOU NEED BEFORE STARTING

- [ ] AWS CLI configured (`aws configure`)
- [ ] Cognito User Pool ID: `us-east-2_I6EBJm3te`
- [ ] New venue's email address
- [ ] Unique venue ID (e.g., "venue-abc-123" or "JohnsBar")
- [ ] (Optional) Raspberry Pi MAC address or device ID

---

## 🚀 STEP-BY-STEP SETUP

### STEP 1: Choose a Unique Venue ID

Pick a unique ID for this venue. This will be used everywhere:
- In Cognito as `custom:venueId`
- In DynamoDB as the partition key
- In MQTT topics
- In IoT device configuration

**Examples:**
- `FergData` (existing venue)
- `johnsbar-miami`
- `venue-brooklyn-001`
- `sports-bar-seattle`

**Rules:**
- No spaces (use hyphens or underscores)
- Alphanumeric characters only
- Should be memorable and unique

For this guide, we'll use: `johnsbar-miami`

---

### STEP 2: Create Cognito User Account

#### Option A: Using AWS Console (Easiest)

1. **Go to AWS Cognito Console**
   - Navigate to: https://console.aws.amazon.com/cognito/
   - Select User Pool: `us-east-2_I6EBJm3te`

2. **Create User**
   - Click **Users** tab → **Create user**
   - Username: `owner@johnsbar.com` (use venue email)
   - Email: `owner@johnsbar.com`
   - Temporary password: Generate one or use: `TempPass123!`
   - ✅ Check "Send email invitation"
   - Click **Create user**

3. **Add Custom Attributes** ⚠️ CRITICAL
   - Click on the newly created user
   - Click **Edit** in Attributes section
   - Find or add `custom:venueId`
   - Set value to: `johnsbar-miami`
   - (Optional) Add `custom:venueName` = `John's Bar Miami`
   - Click **Save changes**

4. **Set Permanent Password** (Optional)
   - Click **Actions** → **Set password**
   - Enter permanent password: `SecurePassword123!`
   - Select "Set permanent password"
   - Click **Set password**

#### Option B: Using AWS CLI (Faster)

```bash
#!/bin/bash
# Save this as: create-venue-user.sh

# Configuration
USER_POOL_ID="us-east-2_I6EBJm3te"
EMAIL="owner@johnsbar.com"
VENUE_ID="johnsbar-miami"
VENUE_NAME="John's Bar Miami"
TEMP_PASSWORD="TempPass123!"

# Create user with custom attributes
aws cognito-idp admin-create-user \
  --user-pool-id $USER_POOL_ID \
  --username $EMAIL \
  --user-attributes \
    Name=email,Value=$EMAIL \
    Name=email_verified,Value=true \
    Name=custom:venueId,Value=$VENUE_ID \
    Name=custom:venueName,Value="$VENUE_NAME" \
  --temporary-password $TEMP_PASSWORD \
  --message-action SUPPRESS

# Set permanent password (user won't need to change on first login)
aws cognito-idp admin-set-user-password \
  --user-pool-id $USER_POOL_ID \
  --username $EMAIL \
  --password $TEMP_PASSWORD \
  --permanent

echo "✅ User created successfully!"
echo "   Email: $EMAIL"
echo "   Venue ID: $VENUE_ID"
echo "   Password: $TEMP_PASSWORD"
echo ""
echo "⚠️ SEND TO VENUE OWNER:"
echo "   Login: https://your-app-url.com"
echo "   Email: $EMAIL"
echo "   Password: $TEMP_PASSWORD"
```

Run it:
```bash
chmod +x create-venue-user.sh
./create-venue-user.sh
```

---

### STEP 3: Verify User Was Created Correctly

```bash
# Check user attributes
aws cognito-idp admin-get-user \
  --user-pool-id us-east-2_I6EBJm3te \
  --username owner@johnsbar.com
```

**Look for:**
- ✅ `"UserStatus": "CONFIRMED"` or `"FORCE_CHANGE_PASSWORD"`
- ✅ `"Name": "custom:venueId", "Value": "johnsbar-miami"`
- ✅ `"Name": "email_verified", "Value": "true"`

**If anything is wrong:**
```bash
# Update attributes
aws cognito-idp admin-update-user-attributes \
  --user-pool-id us-east-2_I6EBJm3te \
  --username owner@johnsbar.com \
  --user-attributes Name=custom:venueId,Value=johnsbar-miami
```

---

### STEP 4: Create VenueConfig Entry in DynamoDB

This tells the app about the venue's locations and MQTT topics.

#### Option A: Using AWS Console

1. **Go to DynamoDB Console**
   - Navigate to: https://console.aws.amazon.com/dynamodb/
   - Select table: `VenueConfig`

2. **Create Item**
   - Click **Explore table items** → **Create item**
   - Add these attributes:

```json
{
  "venueId": "johnsbar-miami",
  "locationId": "main-floor",
  "displayName": "Main Floor",
  "locationName": "Main Bar Area",
  "mqttTopic": "venue/johnsbar-miami/sensors",
  "iotEndpoint": "a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com",
  "deviceId": "rpi-001",
  "address": "123 Ocean Drive, Miami, FL",
  "timezone": "America/New_York"
}
```

#### Option B: Using AWS CLI (Faster)

```bash
#!/bin/bash
# Save as: create-venue-config.sh

VENUE_ID="johnsbar-miami"
LOCATION_ID="main-floor"
MQTT_TOPIC="venue/${VENUE_ID}/sensors"

aws dynamodb put-item \
  --table-name VenueConfig \
  --item '{
    "venueId": {"S": "'$VENUE_ID'"},
    "locationId": {"S": "'$LOCATION_ID'"},
    "displayName": {"S": "Main Floor"},
    "locationName": {"S": "Main Bar Area"},
    "mqttTopic": {"S": "'$MQTT_TOPIC'"},
    "iotEndpoint": {"S": "a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com"},
    "deviceId": {"S": "rpi-001"},
    "address": {"S": "123 Ocean Drive, Miami, FL"},
    "timezone": {"S": "America/New_York"}
  }'

echo "✅ VenueConfig created for venue: $VENUE_ID"
echo "   MQTT Topic: $MQTT_TOPIC"
echo "   Location: main-floor"
```

Run it:
```bash
chmod +x create-venue-config.sh
./create-venue-config.sh
```

---

### STEP 5: Create OccupancyMetrics Entry (Optional)

Initialize occupancy tracking for the venue:

```bash
#!/bin/bash
VENUE_ID="johnsbar-miami"

aws dynamodb put-item \
  --table-name OccupancyMetrics \
  --item '{
    "venueId": {"S": "'$VENUE_ID'"},
    "current": {"N": "0"},
    "todayEntries": {"N": "0"},
    "todayExits": {"N": "0"},
    "peakOccupancy": {"N": "0"},
    "peakTime": {"S": ""},
    "sevenDayAvg": {"N": "0"},
    "fourteenDayAvg": {"N": "0"},
    "thirtyDayAvg": {"N": "0"}
  }'

echo "✅ OccupancyMetrics initialized for venue: $VENUE_ID"
```

---

### STEP 6: Add Test Sensor Data

Add a test data point so the venue sees something immediately:

```bash
#!/bin/bash
VENUE_ID="johnsbar-miami"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

aws dynamodb put-item \
  --table-name SensorData \
  --item '{
    "venueId": {"S": "'$VENUE_ID'"},
    "timestamp": {"S": "'$TIMESTAMP'"},
    "decibels": {"N": "72.5"},
    "light": {"N": "350.2"},
    "indoorTemp": {"N": "71.0"},
    "outdoorTemp": {"N": "68.5"},
    "humidity": {"N": "55.0"},
    "currentSong": {"S": "Welcome to Your Dashboard"},
    "artist": {"S": "Pulse Monitoring System"},
    "albumArt": {"S": ""}
  }'

echo "✅ Test sensor data added for venue: $VENUE_ID"
echo "   Timestamp: $TIMESTAMP"
```

---

### STEP 7: Test Login & Data Display

1. **Open the app**: https://your-app-url.com
2. **Login with:**
   - Email: `owner@johnsbar.com`
   - Password: `TempPass123!` (or your password)
3. **Expected results:**
   - ✅ Login succeeds
   - ✅ Dashboard loads
   - ✅ Shows "John's Bar Miami" as venue name
   - ✅ Shows test sensor data
   - ✅ Shows "Main Floor" location
   - ✅ No data from other venues visible

4. **Check browser console (F12):**
   - Should see: "Fetching live data from DynamoDB for venue: johnsbar-miami"
   - Should see: "Live data received from DynamoDB"
   - Should NOT see any errors

---

## 🔌 STEP 8: Connect Raspberry Pi Sensor

Now that the venue is set up, connect their Raspberry Pi to start sending real data.

### What You Need:
- Raspberry Pi with sensors (sound, light, temperature, humidity)
- Python 3 installed
- AWS IoT credentials (or MQTT credentials)

### Setup Script for Raspberry Pi:

```python
#!/usr/bin/env python3
# Save as: sensor_publisher.py on Raspberry Pi

import json
import time
import random
from datetime import datetime
import boto3
from AWSIoTPythonSDK.MQTTLib import AWSIoTMQTTClient

# Configuration - UPDATE THESE VALUES
VENUE_ID = "johnsbar-miami"
DEVICE_ID = "rpi-001"
MQTT_TOPIC = f"venue/{VENUE_ID}/sensors"
IOT_ENDPOINT = "a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com"
AWS_REGION = "us-east-2"

# DynamoDB Configuration
dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION)
sensor_table = dynamodb.Table('SensorData')

def read_sensors():
    """Read actual sensor values - REPLACE WITH REAL SENSOR CODE"""
    return {
        'sound_level': random.uniform(60, 85),      # Replace with real sound sensor
        'light_level': random.uniform(200, 600),    # Replace with real light sensor
        'indoor_temperature': random.uniform(68, 76), # Replace with real temp sensor
        'outdoor_temperature': random.uniform(65, 80),# Replace with weather API
        'humidity': random.uniform(40, 70)          # Replace with real humidity sensor
    }

def publish_to_dynamodb(data):
    """Publish sensor data to DynamoDB"""
    try:
        sensor_table.put_item(Item={
            'venueId': VENUE_ID,
            'timestamp': data['timestamp'],
            'decibels': data['sensors']['sound_level'],
            'light': data['sensors']['light_level'],
            'indoorTemp': data['sensors']['indoor_temperature'],
            'outdoorTemp': data['sensors']['outdoor_temperature'],
            'humidity': data['sensors']['humidity'],
            'currentSong': data.get('spotify', {}).get('current_song', ''),
            'artist': data.get('spotify', {}).get('artist', ''),
            'albumArt': data.get('spotify', {}).get('album_art', '')
        })
        print(f"✅ Published to DynamoDB: {data['timestamp']}")
    except Exception as e:
        print(f"❌ DynamoDB publish failed: {e}")

def main():
    print(f"🚀 Starting sensor publisher for venue: {VENUE_ID}")
    print(f"📡 Publishing to: {MQTT_TOPIC}")
    print(f"🗄️  Writing to DynamoDB: SensorData")
    
    while True:
        try:
            # Read sensor values
            sensors = read_sensors()
            
            # Create message payload
            message = {
                'deviceId': DEVICE_ID,
                'venueId': VENUE_ID,
                'timestamp': datetime.utcnow().isoformat() + 'Z',
                'sensors': sensors,
                'spotify': {
                    'current_song': 'Currently Playing Song',  # Replace with Spotify API
                    'artist': 'Artist Name',
                    'album_art': ''
                }
            }
            
            # Publish to DynamoDB (this is what the dashboard reads)
            publish_to_dynamodb(message)
            
            # Wait 5 seconds before next reading
            time.sleep(5)
            
        except KeyboardInterrupt:
            print("\n👋 Shutting down sensor publisher...")
            break
        except Exception as e:
            print(f"❌ Error: {e}")
            time.sleep(5)

if __name__ == "__main__":
    main()
```

### Install on Raspberry Pi:

```bash
# On Raspberry Pi
cd ~
curl -O https://your-repo/sensor_publisher.py

# Install dependencies
pip3 install boto3 AWSIoTPythonSDK

# Configure AWS credentials
aws configure
# Enter your AWS Access Key ID
# Enter your AWS Secret Access Key
# Region: us-east-2

# Run the publisher
python3 sensor_publisher.py
```

### Expected Output:
```
🚀 Starting sensor publisher for venue: johnsbar-miami
📡 Publishing to: venue/johnsbar-miami/sensors
🗄️  Writing to DynamoDB: SensorData
✅ Published to DynamoDB: 2025-11-04T15:30:05.000Z
✅ Published to DynamoDB: 2025-11-04T15:30:10.000Z
✅ Published to DynamoDB: 2025-11-04T15:30:15.000Z
```

---

## ✅ VERIFICATION CHECKLIST

After setup, verify everything works:

### Venue User Can Login
```bash
# Test login credentials work
aws cognito-idp admin-initiate-auth \
  --user-pool-id us-east-2_I6EBJm3te \
  --client-id 4v7vp7trh72q1priqno9k5prsq \
  --auth-flow ADMIN_NO_SRP_AUTH \
  --auth-parameters USERNAME=owner@johnsbar.com,PASSWORD=TempPass123!
```

### VenueConfig Exists
```bash
aws dynamodb get-item \
  --table-name VenueConfig \
  --key '{"venueId":{"S":"johnsbar-miami"},"locationId":{"S":"main-floor"}}'
```

### Sensor Data Is Being Written
```bash
# Check last 5 data points
aws dynamodb query \
  --table-name SensorData \
  --key-condition-expression "venueId = :v" \
  --expression-attribute-values '{":v":{"S":"johnsbar-miami"}}' \
  --scan-index-forward false \
  --limit 5
```

### User Sees Only Their Data
1. Login as `owner@johnsbar.com`
2. Check dashboard shows data
3. Login as different venue user
4. Verify they DON'T see johnsbar-miami data

---

## 🎯 DATA ISOLATION - HOW IT WORKS

This is the CRITICAL part - ensuring venues can't see each other's data:

### 1. Cognito Level
- Each user has `custom:venueId` in their JWT token
- Example: User A has `custom:venueId = "johnsbar-miami"`
- Example: User B has `custom:venueId = "FergData"`

### 2. AppSync Resolver Level (SERVER-SIDE SECURITY)
All GraphQL resolvers extract `venueId` from the JWT token:

```vtl
#set($userVenueId = $ctx.identity.claims.get("custom:venueId"))
#if(!$userVenueId)
  $util.error("User does not have custom:venueId attribute")
#end
## Use venueId from JWT token (NOT from query argument!)
#set($venueId = $userVenueId)
```

This means:
- ✅ User A queries for data → Gets only `johnsbar-miami` data
- ✅ User B queries for data → Gets only `FergData` data
- ❌ User A tries to query `FergData` → Still gets `johnsbar-miami` data (security!)

### 3. DynamoDB Level
- Data is partitioned by `venueId`
- Each query MUST include venueId
- DynamoDB efficiently returns only that venue's data

### 4. Result
- **Complete data isolation**
- **No cross-venue data leakage**
- **Automatic enforcement** (not client-side!)
- **Scales to unlimited venues**

---

## 🔄 ADDING MORE VENUES

To add more venues, just repeat STEPS 1-8 with a new:
- Unique venue ID
- New user email
- New VenueConfig entry
- New Raspberry Pi

**Each venue is completely independent!**

---

## 📞 SEND TO VENUE OWNER

After setup, send them this info:

```
🎉 Your Pulse Dashboard account is ready!

Login URL: https://your-app-url.com
Email: owner@johnsbar.com
Password: TempPass123!

What you'll see:
✅ Real-time sensor data (sound, light, temperature, humidity)
✅ Comfort level scoring
✅ Historical data & charts
✅ Data export (CSV)
✅ Mobile app support (PWA)

Need help? Contact us at support@yourcompany.com
```

---

## 🛠️ MAINTENANCE SCRIPTS

### Quick Add Venue Script

Save this as `quick-add-venue.sh`:

```bash
#!/bin/bash
# Quick venue setup script

read -p "Venue ID (e.g., johnsbar-miami): " VENUE_ID
read -p "Venue Name (e.g., John's Bar Miami): " VENUE_NAME
read -p "Owner Email: " EMAIL
read -p "Password: " PASSWORD

echo "Creating venue: $VENUE_ID..."

# Create Cognito user
aws cognito-idp admin-create-user \
  --user-pool-id us-east-2_I6EBJm3te \
  --username $EMAIL \
  --user-attributes \
    Name=email,Value=$EMAIL \
    Name=email_verified,Value=true \
    Name=custom:venueId,Value=$VENUE_ID \
    Name=custom:venueName,Value="$VENUE_NAME" \
  --temporary-password $PASSWORD \
  --message-action SUPPRESS

aws cognito-idp admin-set-user-password \
  --user-pool-id us-east-2_I6EBJm3te \
  --username $EMAIL \
  --password $PASSWORD \
  --permanent

# Create VenueConfig
aws dynamodb put-item \
  --table-name VenueConfig \
  --item '{
    "venueId": {"S": "'$VENUE_ID'"},
    "locationId": {"S": "main-floor"},
    "displayName": {"S": "Main Floor"},
    "locationName": {"S": "Main Bar Area"},
    "mqttTopic": {"S": "venue/'$VENUE_ID'/sensors"},
    "iotEndpoint": {"S": "a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com"},
    "address": {"S": "TBD"},
    "timezone": {"S": "America/New_York"}
  }'

# Add test data
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
aws dynamodb put-item \
  --table-name SensorData \
  --item '{
    "venueId": {"S": "'$VENUE_ID'"},
    "timestamp": {"S": "'$TIMESTAMP'"},
    "decibels": {"N": "70"},
    "light": {"N": "300"},
    "indoorTemp": {"N": "72"},
    "outdoorTemp": {"N": "68"},
    "humidity": {"N": "50"}
  }'

echo "✅ Venue created successfully!"
echo "   Login: $EMAIL"
echo "   Password: $PASSWORD"
echo "   Venue ID: $VENUE_ID"
```

Run it:
```bash
chmod +x quick-add-venue.sh
./quick-add-venue.sh
```

---

## 🎉 YOU'RE DONE!

You now have a fully multi-tenant venue monitoring system where:
- ✅ Each venue has their own login
- ✅ Each venue sees ONLY their data
- ✅ Data is isolated at the database level
- ✅ Raspberry Pi sensors publish data automatically
- ✅ Real-time dashboard updates
- ✅ Historical data & analytics
- ✅ Scales to unlimited venues

**Questions?** Check `COMPLETE_SETUP_GUIDE.md` for troubleshooting!
