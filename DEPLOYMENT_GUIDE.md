# 🚀 Pulse Dashboard - Complete Deployment & Setup Guide

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [AWS Infrastructure Setup](#aws-infrastructure-setup)
3. [Frontend Deployment](#frontend-deployment)
4. [Creating Your First Venue](#creating-your-first-venue)
5. [RPi Configuration](#rpi-configuration)
6. [Testing](#testing)
7. [Troubleshooting](#troubleshooting)

---

## ✅ Prerequisites

Before starting, ensure you have:

- [x] AWS Account with admin access
- [x] AWS CLI installed and configured
- [x] Node.js 18+ installed
- [x] Git installed
- [x] This repository cloned

---

## 🏗️ AWS Infrastructure Setup

### Step 1: Create DynamoDB Tables

#### Table 1: SensorData

1. Open AWS Console → DynamoDB → Tables
2. Click **Create table**
3. Configure:
   - **Table name:** `SensorData`
   - **Partition key:** `venueId` (String)
   - **Sort key:** `timestamp` (String)
   - **Table settings:** Customize settings
   - **Table class:** DynamoDB Standard
   - **Capacity mode:** On-demand
4. Click **Create table**

**Table Schema:**
```
SensorData
├── venueId (String) - Partition Key
├── timestamp (String) - Sort Key (ISO 8601 format)
├── locationId (String) - Which room
├── deviceId (String) - RPi identifier
├── light (Number) - Lux level
├── decibels (Number) - Sound level
├── indoorTemp (Number) - Temperature (°F)
├── humidity (Number) - Humidity (%)
├── currentSong (String, optional)
├── artist (String, optional)
├── albumArt (String, optional)
├── songBPM (Number, optional)
└── occupancy (Map, optional)
    ├── current (Number)
    ├── entries (Number)
    ├── exits (Number)
    └── capacity (Number)
```

#### Table 2: VenueConfig

1. Click **Create table**
2. Configure:
   - **Table name:** `VenueConfig`
   - **Partition key:** `venueId` (String)
   - **Sort key:** `locationId` (String)
   - **Capacity mode:** On-demand
3. Click **Create table**

**Table Schema:**
```
VenueConfig
├── venueId (String) - Partition Key
├── locationId (String) - Sort Key
├── displayName (String) - Room display name
├── locationName (String) - Full location name
├── venueName (String) - Venue name
├── mqttTopic (String) - MQTT topic for this room
├── iotEndpoint (String) - AWS IoT endpoint
├── address (String, optional)
├── timezone (String) - e.g., "America/New_York"
├── deviceId (String) - RPi device ID
├── features (Map) - Enabled features
├── status (String) - "active" | "inactive"
├── createdAt (String) - ISO 8601
└── updatedAt (String) - ISO 8601
```

#### Table 3: OccupancyMetrics (Optional - for future use)

1. Click **Create table**
2. Configure:
   - **Table name:** `OccupancyMetrics`
   - **Partition key:** `venueId` (String)
   - **Capacity mode:** On-demand
3. Click **Create table**

---

### Step 2: Configure AWS Cognito

#### Create User Pool

1. Open AWS Console → Cognito → User pools
2. Click **Create user pool**
3. **Configure sign-in experience:**
   - Sign-in options: ✅ Email
   - User name requirements: Email address
   - Click **Next**

4. **Configure security requirements:**
   - Password policy: Cognito defaults (or custom)
   - Multi-factor authentication: Optional (No MFA recommended for now)
   - Click **Next**

5. **Configure sign-up experience:**
   - Self-registration: ❌ Disabled (only admins create users)
   - Attribute verification: ✅ Email
   - Required attributes: Email
   - **Custom attributes:** Click "Add custom attribute"
     - **Attribute 1:**
       - Name: `venueId`
       - Type: String
       - Min: 1, Max: 256
       - Mutable: Yes
     - **Attribute 2:**
       - Name: `venueName`
       - Type: String
       - Min: 1, Max: 256
       - Mutable: Yes
     - **Attribute 3:**
       - Name: `role`
       - Type: String
       - Min: 1, Max: 50
       - Mutable: Yes
   - Click **Next**

6. **Configure message delivery:**
   - Email provider: Send email with Cognito
   - Click **Next**

7. **Integrate your app:**
   - User pool name: `pulse-users`
   - ✅ Use Cognito Hosted UI: No
   - App client name: `pulse-web-client`
   - Client secret: Generate a client secret: ❌ No
   - Click **Next**

8. **Review and create**
   - Click **Create user pool**

9. **Save these values** (you'll need them):
   - User Pool ID: `us-east-2_XXXXXXXXX`
   - App Client ID: `xxxxxxxxxxxxxxxxxxxxxxxxxx`

---

### Step 3: Create AppSync GraphQL API

#### Create API

1. Open AWS Console → AppSync
2. Click **Create API**
3. Choose **Build from scratch**
4. API name: `PulseDashboardAPI`
5. Click **Create**

#### Configure Authentication

1. In your API, go to **Settings**
2. Scroll to **Authorization modes**
3. **Default authorization mode:**
   - Authorization type: **Amazon Cognito User Pools**
   - Cognito User Pool: Select `pulse-users` (from Step 2)
   - Region: `us-east-2`
   - Default action: **Allow**
4. Click **Save**

#### Add GraphQL Schema

1. Go to **Schema** tab
2. Paste this schema:

```graphql
type SensorData {
  venueId: ID!
  timestamp: String!
  locationId: String!
  deviceId: String
  light: Float
  decibels: Float
  indoorTemp: Float
  humidity: Float
  currentSong: String
  artist: String
  albumArt: String
  songBPM: Int
  occupancy: OccupancyData
}

type OccupancyData {
  current: Int
  entries: Int
  exits: Int
  capacity: Int
}

type SensorDataConnection {
  items: [SensorData]
  nextToken: String
}

type Location {
  locationId: ID!
  venueId: ID!
  displayName: String
  locationName: String
  venueName: String
  address: String
  timezone: String
  deviceId: String
  mqttTopic: String
  status: String
}

type LocationConnection {
  items: [Location]
  nextToken: String
}

type Query {
  getSensorData(venueId: ID!, timestamp: String!): SensorData
    @aws_cognito_user_pools
  
  listSensorData(
    venueId: ID!
    locationId: String
    startTime: String!
    endTime: String!
    limit: Int
    nextToken: String
  ): SensorDataConnection
    @aws_cognito_user_pools
  
  listVenueLocations(
    venueId: ID!
    limit: Int
    nextToken: String
  ): LocationConnection
    @aws_cognito_user_pools
}

schema {
  query: Query
}
```

3. Click **Save Schema**

#### Create Data Sources

1. Go to **Data Sources** tab
2. Click **Create data source**

**Data Source 1: SensorDataTable**
- Data source name: `SensorDataTable`
- Data source type: **Amazon DynamoDB table**
- Region: `us-east-2`
- Table name: `SensorData`
- Create or use existing role: Create new role
- Click **Create**

**Data Source 2: VenueConfigTable**
- Data source name: `VenueConfigTable`
- Data source type: **Amazon DynamoDB table**
- Region: `us-east-2`
- Table name: `VenueConfig`
- Create or use existing role: Create new role
- Click **Create**

#### Attach Resolvers

1. Go back to **Schema** tab
2. Find `Query.listSensorData` → Click **Attach**
3. Data source: `SensorDataTable`
4. Configure resolver:

**Request mapping template:**
```vtl
## Security: Extract venueId from JWT token
#set($userVenueId = $ctx.identity.claims.get("custom:venueId"))

#if(!$userVenueId)
  $util.error("User does not have custom:venueId attribute")
#end

## Use venueId from JWT token (not from query argument)
#set($venueId = $userVenueId)

{
  "version": "2017-02-28",
  "operation": "Query",
  "query": {
    "expression": "venueId = :venueId AND #timestamp BETWEEN :startTime AND :endTime",
    "expressionNames": {
      "#timestamp": "timestamp"
    },
    "expressionValues": {
      ":venueId": $util.dynamodb.toDynamoDBJson($venueId),
      ":startTime": $util.dynamodb.toDynamoDBJson($ctx.args.startTime),
      ":endTime": $util.dynamodb.toDynamoDBJson($ctx.args.endTime)
    }
  },
  "limit": $util.defaultIfNull($ctx.args.limit, 1000),
  "scanIndexForward": true
}
```

**Response mapping template:**
```vtl
{
  "items": $util.toJson($ctx.result.items),
  "nextToken": $util.toJson($ctx.result.nextToken)
}
```

5. Click **Save Resolver**

Repeat for `Query.listVenueLocations` with VenueConfigTable data source.

#### Get GraphQL Endpoint

1. Go to **Settings**
2. Copy **API URL** (e.g., `https://xxxxx.appsync-api.us-east-2.amazonaws.com/graphql`)
3. **Save this - you'll need it!**

---

### Step 4: Configure Environment Variables

1. Create `.env` file in project root:

```bash
# AWS Cognito
VITE_COGNITO_USER_POOL_ID=us-east-2_XXXXXXXXX
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_AWS_REGION=us-east-2

# GraphQL API (REQUIRED)
VITE_GRAPHQL_ENDPOINT=https://xxxxx.appsync-api.us-east-2.amazonaws.com/graphql

# DynamoDB Tables (Optional - defaults shown)
VITE_SENSOR_DATA_TABLE=SensorData
VITE_VENUE_CONFIG_TABLE=VenueConfig
VITE_OCCUPANCY_METRICS_TABLE=OccupancyMetrics

# AWS IoT Core (Optional - for real-time MQTT)
VITE_IOT_ENDPOINT=a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com
```

2. **IMPORTANT:** Replace `xxxxx` with your actual values from previous steps!

---

## 🌐 Frontend Deployment

### Option 1: Deploy to AWS Amplify (Recommended)

1. **Push code to GitHub:**
```bash
git add .
git commit -m "Initial production setup"
git push origin main
```

2. **Connect to AWS Amplify:**
   - Open AWS Console → Amplify
   - Click **New app** → **Host web app**
   - Connect your GitHub repository
   - Select branch: `main`
   - Build settings (auto-detected):
     ```yaml
     version: 1
     frontend:
       phases:
         preBuild:
           commands:
             - npm ci
         build:
           commands:
             - npm run build
       artifacts:
         baseDirectory: dist
         files:
           - '**/*'
       cache:
         paths:
           - node_modules/**/*
     ```
   - **Add environment variables** (from `.env` file above)
   - Click **Save and deploy**

3. **Wait for deployment** (~5 minutes)
4. **Access your app** at: `https://main.xxxxx.amplifyapp.com`

### Option 2: Deploy Locally for Testing

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Access at: http://localhost:5173
```

---

## 👤 Creating Your First Venue

### Step 1: Create Test User in Cognito

```bash
# Using AWS CLI
aws cognito-idp admin-create-user \
  --user-pool-id us-east-2_XXXXXXXXX \
  --username test@venue.com \
  --user-attributes \
    Name=email,Value=test@venue.com \
    Name=custom:venueId,Value=FergData \
    Name=custom:venueName,Value="Ferg's Sports Bar" \
  --temporary-password TempPass123! \
  --region us-east-2

# Set permanent password
aws cognito-idp admin-set-user-password \
  --user-pool-id us-east-2_XXXXXXXXX \
  --username test@venue.com \
  --password YourPassword123! \
  --permanent \
  --region us-east-2
```

### Step 2: Add VenueConfig Entry

1. Open AWS Console → DynamoDB → Tables → `VenueConfig`
2. Click **Explore table items** → **Create item**
3. Add attributes:

```json
{
  "venueId": "FergData",
  "locationId": "main-floor",
  "displayName": "Main Floor",
  "locationName": "Main Bar Area",
  "venueName": "Ferg's Sports Bar",
  "mqttTopic": "pulse/FergData/main-floor",
  "iotEndpoint": "a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com",
  "deviceId": "rpi-001",
  "address": "1320 Central Ave, St. Petersburg, FL",
  "timezone": "America/New_York",
  "features": {
    "songDetection": true,
    "occupancy": true,
    "temperature": true,
    "humidity": true,
    "light": true,
    "sound": true
  },
  "status": "active",
  "createdAt": "2024-01-15T10:00:00.000Z",
  "updatedAt": "2024-01-15T10:00:00.000Z"
}
```

4. Click **Create item**

### Step 3: Test Login

1. Go to your deployed app URL
2. Login with:
   - Email: `test@venue.com`
   - Password: `YourPassword123!`
3. You should see the dashboard (showing "No data available" until RPi connects)

---

## 🍓 RPi Configuration

### Hardware Setup

**Required Components:**
- Raspberry Pi 4 or 5
- Temperature/Humidity sensor (DHT22 or similar)
- Light sensor (BH1750 or similar)
- Microphone (USB or I2S)
- Optional: PIR motion sensor for occupancy

### Software Installation

1. **Install Raspbian OS** (latest version)

2. **Update system:**
```bash
sudo apt update && sudo apt upgrade -y
```

3. **Install Python dependencies:**
```bash
sudo apt install python3-pip python3-dev
pip3 install awsiotsdk Adafruit-DHT sounddevice numpy
```

4. **Create sensor script:**

Create `/home/pi/pulse/sensor.py`:

```python
import json
import time
from datetime import datetime
from awscrt import io, mqtt
from awsiot import mqtt_connection_builder

# Configuration - Get from admin portal
VENUE_ID = "FergData"
LOCATION_ID = "main-floor"
MQTT_TOPIC = "pulse/FergData/main-floor"
IOT_ENDPOINT = "a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com"
DEVICE_ID = "rpi-001"

# AWS IoT Certificates (download from AWS IoT Core)
CERT_PATH = "/home/pi/pulse/certs/certificate.pem.crt"
KEY_PATH = "/home/pi/pulse/certs/private.pem.key"
ROOT_CA_PATH = "/home/pi/pulse/certs/root-CA.crt"

# Connect to AWS IoT
mqtt_connection = mqtt_connection_builder.mtls_from_path(
    endpoint=IOT_ENDPOINT,
    cert_filepath=CERT_PATH,
    pri_key_filepath=KEY_PATH,
    ca_filepath=ROOT_CA_PATH,
    client_id=f"rpi-{VENUE_ID}-{LOCATION_ID}",
    clean_session=False
)

print(f"Connecting to AWS IoT...")
mqtt_connection.connect().result()
print(f"Connected! Publishing to: {MQTT_TOPIC}")

# Main loop - Read sensors and publish
while True:
    try:
        # TODO: Read actual sensors
        # For now, this is a placeholder structure
        sensor_data = {
            "venueId": VENUE_ID,
            "locationId": LOCATION_ID,
            "deviceId": DEVICE_ID,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "light": 0,  # TODO: Read light sensor
            "decibels": 0,  # TODO: Read microphone
            "indoorTemp": 0,  # TODO: Read temp sensor
            "humidity": 0,  # TODO: Read humidity sensor
            "occupancy": {
                "current": 0,  # TODO: Count people
                "entries": 0,
                "exits": 0,
                "capacity": 200
            }
        }
        
        # Publish to AWS IoT
        mqtt_connection.publish(
            topic=MQTT_TOPIC,
            payload=json.dumps(sensor_data),
            qos=mqtt.QoS.AT_LEAST_ONCE
        )
        print(f"Published: {sensor_data['timestamp']}")
        
        # Wait 10 seconds before next reading
        time.sleep(10)
        
    except Exception as e:
        print(f"Error: {e}")
        time.sleep(5)
```

5. **Run the script:**
```bash
python3 /home/pi/pulse/sensor.py
```

6. **Verify data is flowing:**
   - Open DynamoDB → SensorData table
   - You should see new entries appearing every 10 seconds

---

## 🧪 Testing

### Test Checklist

- [ ] **Login works**
  - Navigate to app URL
  - Enter credentials
  - Should redirect to dashboard

- [ ] **Dashboard loads**
  - Shows "No data available" if no RPi connected
  - Shows real-time data if RPi is publishing

- [ ] **Location switcher works**
  - Dropdown shows all rooms
  - Switching updates data

- [ ] **Historical data works**
  - Click time range buttons (6h, 24h, 7d)
  - Charts populate with data

- [ ] **Export works**
  - Click Export button
  - CSV downloads with correct data

- [ ] **Real-time updates**
  - Watch dashboard while RPi publishes
  - Data should update automatically

---

## 🐛 Troubleshooting

### "Unable to Load Data from DynamoDB"

**Possible causes:**
1. `VITE_GRAPHQL_ENDPOINT` not set or incorrect
2. AppSync resolvers not attached
3. User missing `custom:venueId` attribute
4. No data in DynamoDB tables

**Solution:**
1. Check browser console (F12) for detailed errors
2. Verify GraphQL endpoint in `.env`
3. Check Cognito user attributes
4. Verify AppSync resolvers are attached

### "No data available"

**Possible causes:**
1. RPi not publishing data
2. MQTT topic mismatch
3. venueId mismatch between Cognito and DynamoDB

**Solution:**
1. Check RPi is running and connected
2. Verify MQTT topic in VenueConfig matches RPi script
3. Check DynamoDB for entries with your venueId

### "Authentication failed"

**Possible causes:**
1. Incorrect credentials
2. User doesn't exist in Cognito
3. Cognito User Pool ID mismatch

**Solution:**
1. Verify credentials are correct
2. Check user exists in Cognito console
3. Verify `VITE_COGNITO_USER_POOL_ID` matches actual User Pool

---

## 📞 Support

For issues:
1. Check browser console (F12) for errors
2. Check CloudWatch logs (AppSync, Lambda)
3. Verify all environment variables are set correctly
4. Review this guide step-by-step

---

## 🎉 You're Done!

Your Pulse Dashboard is now live! 

Next steps:
1. Configure actual RPi sensors
2. Add more venues as needed
3. Monitor data flow
4. Enjoy real-time insights!
