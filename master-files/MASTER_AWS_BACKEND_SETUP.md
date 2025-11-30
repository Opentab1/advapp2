# 🏗️ PULSE DASHBOARD - MASTER AWS BACKEND SETUP

**Complete AWS Infrastructure Documentation**

This document contains **EVERYTHING** about your AWS backend setup. Anyone can use this to understand, replicate, or troubleshoot your infrastructure.

---

## 📋 TABLE OF CONTENTS

1. [Overview & Architecture](#overview--architecture)
2. [AWS Account Information](#aws-account-information)
3. [AWS Cognito (Authentication)](#aws-cognito-authentication)
4. [AWS AppSync (GraphQL API)](#aws-appsync-graphql-api)
5. [AWS DynamoDB (Database)](#aws-dynamodb-database)
6. [AWS Lambda (Serverless Functions)](#aws-lambda-serverless-functions)
7. [AWS IoT Core (MQTT/Device Management)](#aws-iot-core-mqttdevice-management)
8. [AWS S3 (Certificate Storage)](#aws-s3-certificate-storage)
9. [IAM Roles & Permissions](#iam-roles--permissions)
10. [Data Flow & Integration](#data-flow--integration)
11. [Security & Multi-Tenancy](#security--multi-tenancy)
12. [Troubleshooting & Monitoring](#troubleshooting--monitoring)

---

# 1️⃣ OVERVIEW & ARCHITECTURE

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     PULSE DASHBOARD SYSTEM                       │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────┐         ┌──────────────────┐
│  Admin Portal    │         │  Client Dashboard │
│  (React App)     │         │  (React App)      │
└────────┬─────────┘         └────────┬──────────┘
         │                            │
         │         ┌──────────────────┘
         │         │
         ▼         ▼
    ┌────────────────────────┐
    │   AWS Cognito          │ ◄── Authentication & User Management
    │   User Pool            │
    └────────────────────────┘
              │
              ▼
    ┌────────────────────────┐
    │   AWS AppSync          │ ◄── GraphQL API Gateway
    │   (GraphQL API)        │
    └────────┬───────────────┘
             │
    ┌────────┴───────────────────────────────────────┐
    │                                                 │
    ▼                                                 ▼
┌──────────────┐                          ┌─────────────────┐
│ AWS Lambda   │                          │  AWS DynamoDB   │
│ Functions    │ ◄───────────────────────►│  Tables         │
└──────┬───────┘                          └─────────────────┘
       │                                   • SensorData
       │                                   • VenueConfig
       │                                   • OccupancyMetrics
       │
       ▼
┌──────────────────────────┐
│  AWS IoT Core            │ ◄── MQTT Broker for Devices
│  • Things                │
│  • Certificates          │
│  • Rules                 │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│  AWS S3                  │ ◄── Certificate Storage
│  pulse-device-           │
│  certificates            │
└──────────────────────────┘
         ▲
         │
    ┌────┴────────┐
    │ Raspberry Pi │ ◄── On-premises at each venue
    │ Publisher    │
    └──────────────┘
```

## Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Frontend** | React 18.2 + TypeScript + Vite | Admin portal & client dashboards |
| **Authentication** | AWS Cognito | User management & JWT tokens |
| **API** | AWS AppSync (GraphQL) | Unified API gateway |
| **Compute** | AWS Lambda (Node.js 20.x) | Serverless business logic |
| **Database** | AWS DynamoDB | NoSQL data storage |
| **IoT** | AWS IoT Core (MQTT) | Device communication |
| **Storage** | AWS S3 | Certificate file storage |
| **Hosting** | AWS Amplify | Frontend deployment |

---

# 2️⃣ AWS ACCOUNT INFORMATION

## Primary Details

| Setting | Value |
|---------|-------|
| **AWS Account ID** | `501149494023` |
| **Primary Region** | `us-east-2` (Ohio) |
| **Timezone** | UTC (all timestamps) |

## Regional Resources

**All resources are deployed in `us-east-2` (US East - Ohio) unless otherwise noted.**

---

# 3️⃣ AWS COGNITO (AUTHENTICATION)

## User Pool Configuration

### Basic Settings

| Setting | Value |
|---------|-------|
| **User Pool Name** | (Check AWS Console) |
| **User Pool ID** | `us-east-2_sMY1wYEF9` |
| **ARN** | `arn:aws:cognito-idp:us-east-2:501149494023:userpool/us-east-2_sMY1wYEF9` |
| **App Client ID** | `3issslmbua5d9h5v3ais6iebi2` |
| **Region** | `us-east-2` |

### Sign-in Options

- ✅ **Email address** (primary)
- ⬜ Username
- ⬜ Phone number

### Password Policy

```json
{
  "minimumLength": 8,
  "requireLowercase": true,
  "requireUppercase": true,
  "requireNumbers": true,
  "requireSymbols": true,
  "temporaryPasswordValidityDays": 7
}
```

### Custom Attributes

These attributes are **CRITICAL** for multi-tenancy:

| Attribute Name | Type | Mutable | Purpose |
|----------------|------|---------|---------|
| `custom:venueId` | String | Yes | Links user to their venue (e.g., "joesbar") |
| `custom:venueName` | String | Yes | Display name of venue (e.g., "Joe's Bar") |
| `custom:role` | String | Yes | User role: "owner", "manager", "staff", "admin" |

**⚠️ IMPORTANT:** These attributes are used for:
- Data filtering in GraphQL queries (users only see their venue's data)
- Role-based access control
- Dashboard personalization

### Standard Attributes

| Attribute | Required | Mutable |
|-----------|----------|---------|
| `email` | ✅ Yes | Yes |
| `email_verified` | Auto | Yes |
| `name` | No | Yes |

### MFA Configuration

- **Status:** OPTIONAL
- **Methods:** TOTP, SMS (if configured)

### Account Recovery

- **Method:** Email verification code
- **Email template:** AWS default

---

## User Types & Roles

### 1. Admin Users

**Attributes:**
```json
{
  "email": "admin@yourdomain.com",
  "custom:role": "admin",
  "custom:venueId": "admin",
  "custom:venueName": "Admin Portal"
}
```

**Access:**
- ✅ Admin portal (`/admin`)
- ✅ Can create venues
- ✅ Can create users for any venue
- ✅ Can view all venues (future feature)

---

### 2. Venue Owners

**Attributes:**
```json
{
  "email": "owner@venue.com",
  "custom:role": "owner",
  "custom:venueId": "joesbar",
  "custom:venueName": "Joe's Bar & Grill"
}
```

**Access:**
- ✅ Client dashboard (`/`)
- ✅ See only their venue's data
- ✅ Full access to all features for their venue
- ❌ Cannot access admin portal

**Creation:**
- Created automatically by `createVenue` Lambda
- Receives temporary password via admin
- Must change password on first login

---

### 3. Staff/Manager Users

**Attributes:**
```json
{
  "email": "staff@venue.com",
  "custom:role": "staff",
  "custom:venueId": "joesbar",
  "custom:venueName": "Joe's Bar & Grill"
}
```

**Access:**
- ✅ Client dashboard (same as owner)
- ✅ See only their venue's data
- ⚠️ May have limited permissions (future feature)

**Creation:**
- Created via admin portal or API
- Owner can request these users

---

## Cognito Triggers

**No Lambda triggers configured currently.**

Potential future triggers:
- Pre sign-up validation
- Post confirmation actions
- Custom message templates

---

# 4️⃣ AWS APPSYNC (GRAPHQL API)

## API Configuration

### Basic Settings

| Setting | Value |
|---------|-------|
| **API Name** | `PulseDashboardAPI` |
| **API ID** | `4qrj4yk2fjhhlfbmw4jjbmhzhu` |
| **Region** | `us-east-2` |
| **API ARN** | `arn:aws:appsync:us-east-2:501149494023:apis/4qrj4yk2fjhhlfbmw4jjbmhzhu` |

### Endpoints

| Type | URL |
|------|-----|
| **GraphQL** | `https://ui76r6g3a5a6rdqts6cse76gey.appsync-api.us-east-2.amazonaws.com/graphql` |
| **Realtime** | `wss://ui76r6g3a5a6rdqts6cse76gey.appsync-realtime-api.us-east-2.amazonaws.com/graphql` |

### Authentication

| Setting | Value |
|---------|-------|
| **Primary Auth Type** | Amazon Cognito User Pools |
| **User Pool ID** | `us-east-2_sMY1wYEF9` |
| **App Client Regex** | `3issslmbua5d9h5v3ais6iebi2` |
| **Default Action** | ALLOW |

**All GraphQL operations require `@aws_cognito_user_pools` authorization.**

---

## GraphQL Schema

### Complete Schema (As Deployed)

```graphql
schema {
  query: Query
  mutation: Mutation
}

# ============================================================================
# SENSOR DATA TYPES
# ============================================================================

type SensorData {
  venueId: ID!
  timestamp: String!
  decibels: Float
  light: Float
  indoorTemp: Float
  outdoorTemp: Float
  humidity: Float
  currentSong: String
  albumArt: String
  artist: String
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

# ============================================================================
# LOCATION TYPES
# ============================================================================

type Location {
  locationId: ID!
  venueId: ID!
  displayName: String
  locationName: String
  address: String
  timezone: String
  deviceId: String
  mqttTopic: String
}

type LocationConnection {
  items: [Location]
  nextToken: String
}

# ============================================================================
# OCCUPANCY METRICS
# ============================================================================

type OccupancyMetrics {
  venueId: ID!
  current: Int
  todayEntries: Int
  todayExits: Int
  peakOccupancy: Int
  peakTime: String
  sevenDayAvg: Float
  fourteenDayAvg: Float
  thirtyDayAvg: Float
}

# ============================================================================
# VENUE CONFIG
# ============================================================================

type VenueConfig {
  venueId: ID!
  locationId: ID!
  displayName: String
  locationName: String
  mqttTopic: String
  iotEndpoint: String
  devices: [Device]
}

# ============================================================================
# DEVICE TYPES
# ============================================================================

type Device {
  deviceId: ID!
  locationId: String!
  thingArn: String
  certificateArn: String
  status: String
  createdAt: String
  archivedAt: String
  thingDetails: ThingDetails
}

type ThingDetails {
  defaultClientId: String
  attributes: AWSJSON
  version: Int
}

type DeviceList {
  venueId: ID!
  deviceCount: Int!
  success: Boolean!
  devices: [Device]
}

# ============================================================================
# RESPONSE TYPES
# ============================================================================

type CreateVenueResponse {
  success: Boolean!
  message: String
  venueId: ID
  ownerEmail: String
}

type CreateUserResponse {
  success: Boolean!
  message: String
  username: String
}

type ProvisionDeviceResponse {
  success: Boolean!
  message: String
  device: AWSJSON
}

type GenerateRPiConfigResponse {
  success: Boolean!
  config: AWSJSON
  certificates: AWSJSON
  files: AWSJSON
  instructions: String
}

type ArchiveDeviceResponse {
  success: Boolean!
  message: String
  device: AWSJSON
}

type ResetPasswordResponse {
  success: Boolean!
  message: String
  username: String
}

type UpdateUserPermissionsResponse {
  success: Boolean!
  message: String
  username: String
}

# ============================================================================
# QUERIES
# ============================================================================

type Query {
  # Sensor Data Queries
  getSensorData(venueId: ID!, timestamp: String!): SensorData
    @aws_cognito_user_pools

  listSensorData(
    venueId: ID!
    startTime: String!
    endTime: String!
    limit: Int
    nextToken: String
  ): SensorDataConnection
    @aws_cognito_user_pools

  # Venue Config Queries
  getVenueConfig(venueId: ID!, locationId: String!): VenueConfig
    @aws_cognito_user_pools

  # Location Queries
  listVenueLocations(
    venueId: ID!
    limit: Int
    nextToken: String
  ): LocationConnection
    @aws_cognito_user_pools

  # Occupancy Queries
  getOccupancyMetrics(venueId: ID!): OccupancyMetrics
    @aws_cognito_user_pools

  # Device Queries
  listVenueDevices(venueId: ID!): DeviceList
    @aws_cognito_user_pools
}

# ============================================================================
# MUTATIONS
# ============================================================================

type Mutation {
  # Venue Management
  createVenue(
    venueName: String!
    venueId: String!
    locationName: String!
    locationId: String!
    ownerEmail: String!
    ownerName: String!
    tempPassword: String!
  ): CreateVenueResponse
    @aws_cognito_user_pools

  # User Management
  createUser(
    email: String!
    name: String!
    role: String!
    venueId: String!
    venueName: String!
    tempPassword: String!
  ): CreateUserResponse
    @aws_cognito_user_pools

  resetUserPassword(
    email: String!
    newPassword: String!
  ): ResetPasswordResponse
    @aws_cognito_user_pools

  updateUserPermissions(
    email: String!
    role: String!
  ): UpdateUserPermissionsResponse
    @aws_cognito_user_pools

  # Device Management
  provisionDevice(
    venueId: String!
    locationId: String!
  ): ProvisionDeviceResponse
    @aws_cognito_user_pools

  archiveDevice(
    venueId: String!
    deviceId: String!
  ): ArchiveDeviceResponse
    @aws_cognito_user_pools

  # RPi Configuration
  generateRPiConfig(
    venueId: String!
    locationId: String!
    locationName: String
    deviceId: String
    venueName: String
  ): GenerateRPiConfigResponse
    @aws_cognito_user_pools
}
```

---

## Data Sources

AppSync connects to these AWS services:

| Data Source Name | Type | Target | Purpose |
|------------------|------|--------|---------|
| `SensorDataTable` | DynamoDB | `SensorData` | Read sensor data |
| `VenueConfigTable` | DynamoDB | `VenueConfig` | Read venue configuration |
| `createVenueLambda` | Lambda | `createVenue` | Create new venues |
| `createUserLambda` | Lambda | `createUser` | Create new users |
| `provisionIoTDeviceLambda` | Lambda | `provisionIoTDevice` | Provision IoT devices |
| `generateRPiConfigLambda` | Lambda | `generateRPiConfig` | Generate RPi config |
| `listVenueDevicesLambda` | Lambda | `listVenueDevices` | List venue devices |
| `archiveDeviceLambda` | Lambda | `archiveDevice` | Archive devices |
| `resetUserPasswordLambda` | Lambda | `resetUserPassword` | Reset user passwords |
| `updateUserPermissionsLambda` | Lambda | `updateUserPermissions` | Update user roles |

---

## Resolvers

### Mutation Resolvers

#### `Mutation.createVenue`

**Data Source:** `createVenueLambda`  
**Runtime:** APPSYNC_JS 1.0.0

**Request Mapping (JavaScript):**
```javascript
import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { args } = ctx;
  
  return {
    operation: 'Invoke',
    payload: {
      body: JSON.stringify({
        venueName: args.venueName,
        venueId: args.venueId,
        locationName: args.locationName,
        locationId: args.locationId,
        ownerEmail: args.ownerEmail,
        ownerName: args.ownerName,
        tempPassword: args.tempPassword
      })
    }
  };
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  
  return JSON.parse(ctx.result.body);
}
```

**Response Mapping:**
- Parses Lambda result body as JSON
- Returns `CreateVenueResponse` object

---

#### Other Mutation Resolvers

All other mutation resolvers use **VTL (Velocity Template Language)** with standard Lambda invocation pattern:

**Request Template:**
```vtl
{
  "version" : "2017-02-28",
  "operation": "Invoke",
  "payload": $util.toJson($context.args)
}
```

**Response Template:**
```vtl
$util.toJson($context.result)
```

---

### Query Resolvers

**Direct DynamoDB queries** use DynamoDB data sources with VTL resolvers.

**Lambda-backed queries** follow the same pattern as mutations.

---

# 5️⃣ AWS DYNAMODB (DATABASE)

## Table Overview

| Table Name | Purpose | Partition Key | Sort Key | GSI |
|------------|---------|---------------|----------|-----|
| `SensorData` | Store real-time sensor readings | `venueId` | `timestamp` | No |
| `VenueConfig` | Store venue configuration | `venueId` | `locationId` | No |
| `OccupancyMetrics` | Store aggregated occupancy metrics | `venueId` | - | No |

---

## Table 1: SensorData

### Purpose
Stores **all sensor readings** from Raspberry Pi devices at venues.

### Keys

| Key Type | Attribute | Type | Description |
|----------|-----------|------|-------------|
| **HASH (Partition)** | `venueId` | String | Venue identifier (e.g., "joesbar") |
| **RANGE (Sort)** | `timestamp` | String | ISO 8601 timestamp (e.g., "2025-11-28T18:00:00.000Z") |

### Attributes Schema

```json
{
  "venueId": "joesbar",
  "timestamp": "2025-11-28T18:00:00.000Z",
  "deviceId": "joesbar-mainfloor-001",
  "sensors": {
    "sound_level": 68.5,
    "light_level": 325.8,
    "indoor_temperature": 72.3,
    "outdoor_temperature": 65.7,
    "humidity": 52.1
  },
  "occupancy": {
    "current": 45,
    "entries": 120,
    "exits": 75,
    "capacity": 200
  },
  "spotify": {
    "current_song": "Sweet Child O' Mine",
    "artist": "Guns N' Roses",
    "album_art": null
  }
}
```

### Capacity Settings

| Setting | Value |
|---------|-------|
| **Billing Mode** | On-Demand (recommended) OR Provisioned |
| **Read Capacity** | Auto-scaled if provisioned |
| **Write Capacity** | Auto-scaled if provisioned |

### Data Retention

**⚠️ No TTL configured** - Data persists indefinitely

**Future consideration:** Add TTL for data older than 90 days to reduce costs.

### Access Patterns

1. **Get latest reading:** Query by `venueId`, limit 1, descending
2. **Get readings in time range:** Query by `venueId` with timestamp between `startTime` and `endTime`
3. **Dashboard charts:** Query last 24 hours, 7 days, 30 days

---

## Table 2: VenueConfig

### Purpose
Stores **venue configuration and device information**.

### Keys

| Key Type | Attribute | Type | Description |
|----------|-----------|------|-------------|
| **HASH (Partition)** | `venueId` | String | Venue identifier |
| **RANGE (Sort)** | `locationId` | String | Location within venue (e.g., "mainfloor", "rooftop") |

### Attributes Schema

```json
{
  "venueId": "joesbar",
  "locationId": "mainfloor",
  "venueName": "Joe's Bar & Grill",
  "displayName": "Main Floor",
  "locationName": "Main Floor",
  "mqttTopic": "pulse/sensors/joesbar",
  "iotEndpoint": "a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com",
  "address": "123 Main St, Tampa, FL",
  "timezone": "America/New_York",
  "createdAt": "2025-11-28T18:00:00.000Z",
  "status": "active",
  "devices": [
    {
      "deviceId": "joesbar-mainfloor-001",
      "locationId": "mainfloor",
      "thingArn": "arn:aws:iot:us-east-2:501149494023:thing/joesbar-mainfloor-001",
      "certificateArn": "arn:aws:iot:us-east-2:501149494023:cert/xxxxx",
      "status": "active",
      "createdAt": "2025-11-28T18:00:00.000Z"
    }
  ]
}
```

### Access Patterns

1. **Get venue config:** Query by `venueId` and `locationId`
2. **List all locations for venue:** Query by `venueId`
3. **Get device info:** Query and filter devices array

---

## Table 3: OccupancyMetrics

### Purpose
Stores **aggregated occupancy metrics** (averages, peaks, trends).

### Keys

| Key Type | Attribute | Type | Description |
|----------|-----------|------|-------------|
| **HASH (Partition)** | `venueId` | String | Venue identifier |

**No sort key** - One record per venue.

### Attributes Schema

```json
{
  "venueId": "joesbar",
  "current": 45,
  "todayEntries": 350,
  "todayExits": 305,
  "peakOccupancy": 87,
  "peakTime": "2025-11-28T21:30:00.000Z",
  "sevenDayAvg": 52.3,
  "fourteenDayAvg": 48.7,
  "thirtyDayAvg": 51.2,
  "lastUpdated": "2025-11-28T22:00:00.000Z"
}
```

### Update Frequency

**Updated by:** IoT Rule or scheduled Lambda (TBD)  
**Frequency:** Every 5-15 minutes

---

# 6️⃣ AWS LAMBDA (SERVERLESS FUNCTIONS)

## Lambda Overview

All Lambda functions use:
- **Runtime:** Node.js 20.x
- **Architecture:** x86_64
- **Memory:** 128 MB (default)
- **Timeout:** 30 seconds
- **Region:** us-east-2

---

## Lambda Function 1: createVenue

### Purpose
**Creates a new venue** with owner account and IoT device provisioning.

### Configuration

| Setting | Value |
|---------|-------|
| **Function Name** | `createVenue` |
| **Runtime** | Node.js 20.x |
| **Handler** | `index.handler` |
| **Memory** | 128 MB |
| **Timeout** | 30 seconds |
| **IAM Role** | `createVenue-role-zc7a6b78` |

### Environment Variables

```bash
COGNITO_USER_POOL_ID=us-east-2_sMY1wYEF9
```

### IAM Permissions Required

- `cognito-idp:AdminCreateUser`
- `cognito-idp:AdminSetUserPassword`
- `dynamodb:PutItem` (VenueConfig table)
- `lambda:InvokeFunction` (provisionIoTDevice)

### Input Schema

```json
{
  "body": "{\"venueName\":\"Joe's Bar\",\"venueId\":\"joesbar\",\"locationName\":\"Main Floor\",\"locationId\":\"mainfloor\",\"ownerEmail\":\"joe@joesbar.com\",\"ownerName\":\"Joe Smith\",\"tempPassword\":\"Temp542abc!\"}"
}
```

### Output Schema

```json
{
  "statusCode": 200,
  "headers": {
    "Content-Type": "application/json"
  },
  "body": {
    "success": true,
    "message": "Venue, owner account, and IoT device created successfully",
    "venueId": "joesbar",
    "ownerEmail": "joe@joesbar.com",
    "tempPassword": "Temp542abc!",
    "deviceData": {
      "deviceId": "joesbar-mainfloor-001",
      "thingArn": "arn:aws:iot:...",
      "certificateArn": "arn:aws:iot:...",
      "iotEndpoint": "a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com",
      "mqttTopic": "pulse/sensors/joesbar/joesbar-mainfloor-001",
      "credentials": {
        "certificatePem": "-----BEGIN CERTIFICATE-----...",
        "privateKey": "-----BEGIN RSA PRIVATE KEY-----...",
        "publicKey": "-----BEGIN PUBLIC KEY-----...",
        "rootCA": "-----BEGIN CERTIFICATE-----..."
      }
    }
  }
}
```

### Process Flow

1. Parse input JSON from `event.body`
2. Validate required fields
3. Create `VenueConfig` record in DynamoDB
4. Create Cognito user with owner role
5. Set temporary password for user
6. Invoke `provisionIoTDevice` Lambda to create IoT Thing and certificates
7. Capture device data including certificates
8. Return success with all data

### Error Handling

- **Gracefully handles** `UsernameExistsException` (skips user creation, continues)
- **Always returns** valid GraphQL response with `success` field
- **Logs all steps** for debugging

---

## Lambda Function 2: provisionIoTDevice

### Purpose
**Provisions IoT devices** by creating Thing, generating certificates, and storing in S3.

### Configuration

| Setting | Value |
|---------|-------|
| **Function Name** | `provisionIoTDevice` |
| **Runtime** | Node.js 20.x |
| **Handler** | `index.handler` |
| **Memory** | 128 MB |
| **Timeout** | 30 seconds |
| **IAM Role** | `provisionIoTDevice-role-afie2eis` |

### Environment Variables

None (uses default AWS SDK configuration)

### IAM Permissions Required

- `iot:CreateThing`
- `iot:CreateKeysAndCertificate`
- `iot:AttachPolicy`
- `iot:AttachThingPrincipal`
- `iot:DescribeEndpoint`
- `s3:PutObject` (pulse-device-certificates bucket)
- `dynamodb:UpdateItem` (VenueConfig table)

### Input Schema

```json
{
  "venueId": "joesbar",
  "locationId": "mainfloor"
}
```

### Output Schema

```json
{
  "statusCode": 200,
  "body": {
    "success": true,
    "message": "Device provisioned successfully",
    "device": {
      "deviceId": "joesbar-mainfloor-001",
      "thingName": "joesbar-mainfloor-001",
      "thingArn": "arn:aws:iot:us-east-2:501149494023:thing/joesbar-mainfloor-001",
      "certificateArn": "arn:aws:iot:us-east-2:501149494023:cert/xxxxx",
      "certificateId": "xxxxx",
      "iotEndpoint": "a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com",
      "mqttTopic": "pulse/sensors/joesbar/joesbar-mainfloor-001",
      "s3Bucket": "pulse-device-certificates",
      "s3Prefix": "joesbar/joesbar-mainfloor-001",
      "credentials": {
        "certificatePem": "-----BEGIN CERTIFICATE-----...",
        "privateKey": "-----BEGIN RSA PRIVATE KEY-----...",
        "publicKey": "-----BEGIN PUBLIC KEY-----...",
        "rootCA": "-----BEGIN CERTIFICATE-----..."
      }
    }
  }
}
```

### Process Flow

1. Generate `deviceId` from `venueId-locationId-001`
2. Create IoT Thing with attributes (`venueId`, `locationId`, `createdAt`)
3. Generate certificate and key pair (set as active)
4. Attach `PulseDevicePolicy` to certificate
5. Attach certificate to Thing
6. Get IoT endpoint URL
7. Store 4 files in S3:
   - `device.cert.pem` (device certificate)
   - `device.private.key` (private key)
   - `device.public.key` (public key)
   - `AmazonRootCA1.pem` (Amazon root CA)
8. Update `VenueConfig` DynamoDB with device info
9. Return device data including credentials

### S3 Storage Path

```
s3://pulse-device-certificates/{venueId}/{deviceId}/
  ├── device.cert.pem
  ├── device.private.key
  ├── device.public.key
  └── AmazonRootCA1.pem
```

---

## Lambda Function 3: createUser

### Purpose
**Creates additional users** for existing venues (staff, managers).

### Configuration

| Setting | Value |
|---------|-------|
| **Function Name** | `createUser` |
| **Runtime** | Node.js 20.x |
| **Handler** | `index.handler` |

### Input Schema

```json
{
  "email": "staff@joesbar.com",
  "name": "Staff Member",
  "role": "staff",
  "venueId": "joesbar",
  "venueName": "Joe's Bar",
  "tempPassword": "TempPassword123!"
}
```

### Process

1. Create Cognito user with specified role
2. Set custom attributes (`custom:venueId`, `custom:venueName`, `custom:role`)
3. Set temporary password
4. Return success

---

## Lambda Function 4: listVenueDevices

### Purpose
**Lists all IoT devices** for a specific venue.

### Input Schema

```json
{
  "venueId": "joesbar"
}
```

### Output Schema

```json
{
  "success": true,
  "venueId": "joesbar",
  "deviceCount": 2,
  "devices": [
    {
      "deviceId": "joesbar-mainfloor-001",
      "locationId": "mainfloor",
      "status": "active",
      "thingArn": "arn:aws:iot:...",
      "certificateArn": "arn:aws:iot:...",
      "createdAt": "2025-11-28T18:00:00.000Z"
    }
  ]
}
```

---

## Lambda Function 5: archiveDevice

### Purpose
**Archives (deactivates) an IoT device** without deleting it.

### Input Schema

```json
{
  "venueId": "joesbar",
  "deviceId": "joesbar-mainfloor-001"
}
```

### Process

1. Update IoT certificate to INACTIVE
2. Update VenueConfig to mark device as archived
3. Return archived device info

---

## Lambda Function 6: generateRPiConfig

### Purpose
**Generates Raspberry Pi configuration file** with certificates.

### Input Schema

```json
{
  "venueId": "joesbar",
  "locationId": "mainfloor",
  "deviceId": "joesbar-mainfloor-001"
}
```

### Output Schema

Returns configuration JSON with:
- Device credentials from S3
- MQTT connection details
- Configuration instructions

---

## Lambda Function 7: resetUserPassword

### Purpose
**Resets user password** (admin function).

### Input Schema

```json
{
  "email": "owner@venue.com",
  "newPassword": "NewPassword123!"
}
```

---

## Lambda Function 8: updateUserPermissions

### Purpose
**Updates user role** (change between owner, manager, staff).

### Input Schema

```json
{
  "email": "user@venue.com",
  "role": "manager"
}
```

---

# 7️⃣ AWS IOT CORE (MQTT/DEVICE MANAGEMENT)

## IoT Endpoint

| Setting | Value |
|---------|-------|
| **Endpoint Type** | Data (ATS) |
| **Endpoint URL** | `a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com` |
| **Port** | 8883 (MQTT over TLS) |
| **Protocol** | MQTT 3.1.1 |

---

## IoT Things

### Thing Naming Convention

```
{venueId}-{locationId}-001
```

**Examples:**
- `joesbar-mainfloor-001`
- `jimmyneutron-mainfloor-001`
- `goldenpub-rooftop-001`

### Thing Attributes

Every Thing has these attributes:

```json
{
  "venueId": "joesbar",
  "locationId": "mainfloor",
  "createdAt": "2025-11-28T18:00:00.000Z"
}
```

### Existing Things (Examples)

| Thing Name | Venue ID | Location | Created |
|------------|----------|----------|---------|
| `jimmyneutron-mainfloor-001` | jimmyneutron | mainfloor | 2025-11-13 |
| `goldenpub-mainfloor-001` | goldenpub | mainfloor | 2025-11-11 |
| `silvergrill-mainfloor-001` | silvergrill | mainfloor | 2025-11-11 |
| `FergData` | (legacy) | - | (legacy) |
| `Pulse-RPi5-Fergs-Main` | (legacy) | - | (legacy) |

---

## IoT Certificates

### Certificate Lifecycle

1. **Generated** by `provisionIoTDevice` Lambda
2. **Stored** in S3 bucket `pulse-device-certificates`
3. **Attached** to IoT Thing
4. **Activated** automatically
5. **Policy attached:** `PulseDevicePolicy`

### Certificate Files

For each device, 4 files are generated:

| File | Purpose | File Type |
|------|---------|-----------|
| `device.cert.pem` | Device certificate | PEM certificate |
| `device.private.key` | Private key (KEEP SECURE!) | RSA private key |
| `device.public.key` | Public key | RSA public key |
| `AmazonRootCA1.pem` | Amazon root certificate | PEM certificate |

### Certificate Security

- ⚠️ **Private keys are HIGHLY SENSITIVE**
- Stored in S3 with restricted access
- Only downloaded once during setup
- Never transmitted in plain text over insecure channels

---

## IoT Policy: PulseDevicePolicy

### Purpose
Defines **what IoT devices can do** (publish, subscribe).

### Policy Name
`PulseDevicePolicy`

### Policy Document (JSON)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "iot:Connect",
      "Resource": "arn:aws:iot:us-east-2:501149494023:client/*"
    },
    {
      "Effect": "Allow",
      "Action": "iot:Publish",
      "Resource": "arn:aws:iot:us-east-2:501149494023:topic/pulse/sensors/*"
    },
    {
      "Effect": "Allow",
      "Action": "iot:Subscribe",
      "Resource": "arn:aws:iot:us-east-2:501149494023:topicfilter/pulse/sensors/*"
    },
    {
      "Effect": "Allow",
      "Action": "iot:Receive",
      "Resource": "arn:aws:iot:us-east-2:501149494023:topic/pulse/sensors/*"
    }
  ]
}
```

### What This Means

- ✅ Devices can **connect** with any client ID
- ✅ Devices can **publish** to any topic starting with `pulse/sensors/`
- ✅ Devices can **subscribe** to topics starting with `pulse/sensors/`
- ✅ Devices can **receive** messages from subscribed topics

---

## IoT Rule: PulseSensorDataRule

### Purpose
**Routes sensor data** from MQTT topics to DynamoDB.

### Rule Configuration

| Setting | Value |
|---------|-------|
| **Rule Name** | `PulseSensorDataRule` |
| **Status** | Active |
| **ARN** | `arn:aws:iot:us-east-2:501149494023:rule/PulseSensorDataRule` |
| **Created** | November 14, 2025 |

### SQL Statement

```sql
SELECT * FROM 'pulse/sensors/#'
```

**What this does:**
- Listens to **all topics** starting with `pulse/sensors/`
- `#` is a wildcard matching any subtopic
- Captures all MQTT messages published to venue sensor topics

### Action: DynamoDB

**Action Type:** DynamoDBv2 (PutItem)

| Setting | Value |
|---------|-------|
| **Table Name** | `SensorData` |
| **IAM Role** | `arn:aws:iam::501149494023:role/service-role/RPISENSORDATARULE` |

**⚠️ IMPORTANT CONFIGURATION NOTE:**

The current IoT Rule action **only specifies the table name** but does NOT explicitly map partition key (`venueId`) and sort key (`timestamp`). 

**This means:**
- The MQTT message payload **MUST include** `venueId` and `timestamp` fields
- DynamoDB will automatically use those fields as keys IF they match the schema
- If fields are missing or mismatched, writes will fail

**Recommended Fix (for future):**
Add explicit key mappings to the DynamoDB action to ensure reliable writes.

### Rule Description

```
Routes sensor data from pulse/sensors/# to DynamoDB SensorData table
```

---

## MQTT Topics

### Topic Naming Convention

```
pulse/sensors/{venueId}
```

OR (per-device granularity):

```
pulse/sensors/{venueId}/{deviceId}
```

### Examples

| Venue | Topic |
|-------|-------|
| Joe's Bar | `pulse/sensors/joesbar` |
| Jimmy Neutron | `pulse/sensors/jimmyneutron` |
| Golden Pub | `pulse/sensors/goldenpub` |

### Message Payload Format

**MQTT messages MUST be valid JSON:**

```json
{
  "deviceId": "joesbar-mainfloor-001",
  "venueId": "joesbar",
  "timestamp": "2025-11-28T18:00:00.000Z",
  "sensors": {
    "sound_level": 68.5,
    "light_level": 325.8,
    "indoor_temperature": 72.3,
    "outdoor_temperature": 65.7,
    "humidity": 52.1
  },
  "occupancy": {
    "current": 45,
    "entries": 120,
    "exits": 75,
    "capacity": 200
  },
  "spotify": {
    "current_song": "Sweet Child O' Mine",
    "artist": "Guns N' Roses",
    "album_art": null
  }
}
```

**Required fields for DynamoDB:**
- `venueId` (partition key)
- `timestamp` (sort key)

---

# 8️⃣ AWS S3 (CERTIFICATE STORAGE)

## S3 Bucket: pulse-device-certificates

### Purpose
**Stores IoT device certificates** securely.

### Bucket Configuration

| Setting | Value |
|---------|-------|
| **Bucket Name** | `pulse-device-certificates` |
| **Region** | `us-east-2` |
| **Versioning** | Disabled |
| **Encryption** | Server-side encryption (AES-256) |
| **Public Access** | BLOCKED (private bucket) |

### Folder Structure

```
pulse-device-certificates/
  ├── joesbar/
  │   └── joesbar-mainfloor-001/
  │       ├── device.cert.pem
  │       ├── device.private.key
  │       ├── device.public.key
  │       └── AmazonRootCA1.pem
  ├── jimmyneutron/
  │   └── jimmyneutron-mainfloor-001/
  │       ├── device.cert.pem
  │       ├── device.private.key
  │       ├── device.public.key
  │       └── AmazonRootCA1.pem
  └── goldenpub/
      └── goldenpub-mainfloor-001/
          ├── ...
```

### Access Control

**IAM Policies:**
- `provisionIoTDevice` Lambda has `PutObject` permission
- `generateRPiConfig` Lambda has `GetObject` permission
- Admin users can download via AWS Console

**No public access** - files are private.

---

# 9️⃣ IAM ROLES & PERMISSIONS

## IAM Roles Summary

| Role Name | Purpose | Used By |
|-----------|---------|---------|
| `createVenue-role-zc7a6b78` | Create venues, users, invoke Lambdas | createVenue Lambda |
| `provisionIoTDevice-role-afie2eis` | Provision IoT devices, certificates | provisionIoTDevice Lambda |
| `RPISENSORDATARULE` | Write sensor data to DynamoDB | IoT Rule |
| `appsync-ds-ddb-*` | AppSync DynamoDB access | AppSync data sources |
| `appsync-ds-lam-*` | AppSync Lambda invocation | AppSync data sources |

---

## Role: createVenue-role-zc7a6b78

### Trust Relationship

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

### Attached Policies

1. **AWSLambdaBasicExecutionRole** (AWS Managed)
   - CloudWatch Logs access

2. **Inline Policy: CognitoUserManagement**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cognito-idp:AdminCreateUser",
        "cognito-idp:AdminSetUserPassword"
      ],
      "Resource": "arn:aws:cognito-idp:us-east-2:501149494023:userpool/us-east-2_sMY1wYEF9"
    }
  ]
}
```

3. **Inline Policy: DynamoDBVenueConfig**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem"
      ],
      "Resource": "arn:aws:dynamodb:us-east-2:501149494023:table/VenueConfig"
    }
  ]
}
```

4. **Inline Policy: InvokeLambda**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": "arn:aws:lambda:us-east-2:501149494023:function:provisionIoTDevice"
    }
  ]
}
```

---

## Role: provisionIoTDevice-role-afie2eis

### Attached Policies

1. **AWSLambdaBasicExecutionRole** (AWS Managed)

2. **Inline Policy: IoTDeviceProvisioning**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "iot:CreateThing",
        "iot:CreateKeysAndCertificate",
        "iot:AttachPolicy",
        "iot:AttachThingPrincipal",
        "iot:DescribeEndpoint"
      ],
      "Resource": "*"
    }
  ]
}
```

3. **Inline Policy: S3CertificateStorage**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::pulse-device-certificates/*"
    }
  ]
}
```

4. **Inline Policy: DynamoDBUpdate**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "dynamodb:UpdateItem",
      "Resource": "arn:aws:dynamodb:us-east-2:501149494023:table/VenueConfig"
    }
  ]
}
```

---

## Role: RPISENSORDATARULE

### Purpose
Used by IoT Rule to write to DynamoDB.

### Trust Relationship

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "iot.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

### Attached Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "dynamodb:PutItem",
      "Resource": "arn:aws:dynamodb:us-east-2:501149494023:table/SensorData"
    }
  ]
}
```

---

# 🔟 DATA FLOW & INTEGRATION

## Flow 1: Venue Creation

```
Admin Portal (React)
    ↓
  [User fills out form]
    ↓
AppSync Mutation: createVenue
    ↓
createVenue Lambda
    ├─→ Create VenueConfig in DynamoDB
    ├─→ Create Cognito user (owner)
    ├─→ Invoke provisionIoTDevice Lambda
    │       ├─→ Create IoT Thing
    │       ├─→ Generate certificates
    │       ├─→ Store in S3
    │       └─→ Update VenueConfig with device
    └─→ Return success + credentials
    ↓
Admin receives:
  - Owner email
  - Temporary password
  - Device ID
```

---

## Flow 2: Sensor Data Ingestion

```
Raspberry Pi at Venue
    ↓
  [pulse-publisher.py reads sensors]
    ↓
Publishes MQTT message to:
  Topic: pulse/sensors/{venueId}
    ↓
AWS IoT Core receives message
    ↓
IoT Rule: PulseSensorDataRule triggers
    ↓
DynamoDB Action: PutItem
    ↓
SensorData table updated
    ↓
Dashboard queries DynamoDB
    ↓
Owner sees live data
```

---

## Flow 3: Dashboard Data Query

```
Client Dashboard (React)
    ↓
User authenticated via Cognito
  - Gets JWT token
  - Token includes custom:venueId
    ↓
AppSync Query: listSensorData
    ↓
  [AppSync validates token]
    ↓
DynamoDB Query:
  - Filter by venueId
  - Time range filter
    ↓
Returns sensor data
    ↓
Dashboard renders charts
```

---

# 1️⃣1️⃣ SECURITY & MULTI-TENANCY

## Data Isolation Strategy

### How Venue Data is Isolated

**Every user has a `custom:venueId` attribute in Cognito.**

When a user queries data:
1. Frontend gets user's `venueId` from Cognito token
2. **All GraphQL queries MUST include `venueId`**
3. DynamoDB queries filter by partition key = `venueId`
4. Users can **ONLY** see data for their own `venueId`

### Example

**User:** `owner@joesbar.com`  
**Cognito Attributes:**
```json
{
  "custom:venueId": "joesbar",
  "custom:venueName": "Joe's Bar",
  "custom:role": "owner"
}
```

**GraphQL Query:**
```graphql
query {
  listSensorData(
    venueId: "joesbar"  # ← MUST match user's venueId
    startTime: "2025-11-28T00:00:00Z"
    endTime: "2025-11-28T23:59:59Z"
  ) {
    items {
      timestamp
      sensors { temperature }
    }
  }
}
```

**DynamoDB Query:**
```
Query SensorData WHERE venueId = 'joesbar' AND timestamp BETWEEN ...
```

**Result:** User ONLY sees data for their venue.

---

## Authentication Flow

1. User enters email + password
2. Cognito validates credentials
3. Cognito returns JWT tokens:
   - `idToken` (contains user attributes)
   - `accessToken` (for API authorization)
   - `refreshToken` (for token renewal)
4. Frontend stores tokens in localStorage
5. **Every API request** includes `Authorization: Bearer {idToken}`
6. AppSync validates token with Cognito
7. AppSync extracts `custom:venueId` from token
8. Query executes with venueId filter

---

## Role-Based Access (Future Enhancement)

**Current:** All users with same venueId see same data

**Future:** Implement role-based permissions:
- **Owner:** Full access
- **Manager:** View + export
- **Staff:** View only
- **Admin:** All venues

---

# 1️⃣2️⃣ TROUBLESHOOTING & MONITORING

## CloudWatch Logs

### Lambda Function Logs

| Function | Log Group |
|----------|-----------|
| createVenue | `/aws/lambda/createVenue` |
| provisionIoTDevice | `/aws/lambda/provisionIoTDevice` |
| createUser | `/aws/lambda/createUser` |
| listVenueDevices | `/aws/lambda/listVenueDevices` |
| archiveDevice | `/aws/lambda/archiveDevice` |
| generateRPiConfig | `/aws/lambda/generateRPiConfig` |
| resetUserPassword | `/aws/lambda/resetUserPassword` |
| updateUserPermissions | `/aws/lambda/updateUserPermissions` |

**View logs:**
```bash
aws logs tail /aws/lambda/createVenue --region us-east-2 --since 5m
```

---

### AppSync Logs

**Status:** Not currently enabled

**To enable:**
1. AppSync Console → PulseDashboardAPI → Settings
2. Enable CloudWatch Logs
3. Select log level (Error, All, None)
4. Create IAM role for AppSync logging

---

### IoT Logs

**View MQTT messages in real-time:**

1. AWS Console → IoT Core
2. Test → MQTT test client
3. Subscribe to topic: `pulse/sensors/#`
4. See all published messages

---

## Common Issues

### Issue: No data in dashboard

**Check:**
1. Is Raspberry Pi publishing? (Check Pi logs)
2. Are MQTT messages arriving? (IoT Core test client)
3. Is IoT Rule active? (Check rule status)
4. Is DynamoDB receiving data? (Check table items)
5. Is user's `venueId` correct? (Check Cognito user attributes)

---

### Issue: Venue creation fails

**Check:**
1. Lambda logs: `/aws/lambda/createVenue`
2. Look for error messages
3. Verify Cognito User Pool ID is correct
4. Verify IAM permissions for Lambda

---

### Issue: Certificates not working

**Check:**
1. Are files downloaded correctly? (4 files)
2. Are file paths correct on Pi? (`/home/pi/certs/`)
3. Is certificate active in IoT Console?
4. Is policy attached to certificate?
5. Is Thing created with correct name?

---

## Monitoring Metrics (Future)

**Recommended CloudWatch metrics to set up:**
- Lambda invocation count & errors
- DynamoDB read/write capacity
- IoT message count
- AppSync request count & latency
- Cognito sign-in success/failure rate

---

# 📚 APPENDIX

## Quick Reference: AWS Resource ARNs

```
Cognito User Pool:
arn:aws:cognito-idp:us-east-2:501149494023:userpool/us-east-2_sMY1wYEF9

AppSync API:
arn:aws:appsync:us-east-2:501149494023:apis/4qrj4yk2fjhhlfbmw4jjbmhzhu

DynamoDB Tables:
arn:aws:dynamodb:us-east-2:501149494023:table/SensorData
arn:aws:dynamodb:us-east-2:501149494023:table/VenueConfig
arn:aws:dynamodb:us-east-2:501149494023:table/OccupancyMetrics

IoT Rule:
arn:aws:iot:us-east-2:501149494023:rule/PulseSensorDataRule

S3 Bucket:
arn:aws:s3:::pulse-device-certificates

Lambda Functions:
arn:aws:lambda:us-east-2:501149494023:function:createVenue
arn:aws:lambda:us-east-2:501149494023:function:provisionIoTDevice
arn:aws:lambda:us-east-2:501149494023:function:createUser
arn:aws:lambda:us-east-2:501149494023:function:listVenueDevices
arn:aws:lambda:us-east-2:501149494023:function:archiveDevice
arn:aws:lambda:us-east-2:501149494023:function:generateRPiConfig
arn:aws:lambda:us-east-2:501149494023:function:resetUserPassword
arn:aws:lambda:us-east-2:501149494023:function:updateUserPermissions
```

---

## Quick Reference: Environment Variables

**Frontend (.env):**
```bash
VITE_COGNITO_USER_POOL_ID=us-east-2_sMY1wYEF9
VITE_COGNITO_CLIENT_ID=3issslmbua5d9h5v3ais6iebi2
VITE_AWS_REGION=us-east-2
VITE_GRAPHQL_ENDPOINT=https://ui76r6g3a5a6rdqts6cse76gey.appsync-api.us-east-2.amazonaws.com/graphql
VITE_IOT_ENDPOINT=a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com
```

**Lambda (createVenue):**
```bash
COGNITO_USER_POOL_ID=us-east-2_sMY1wYEF9
```

---

## Quick Reference: Topic Patterns

| Pattern | Example | Use Case |
|---------|---------|----------|
| `pulse/sensors/{venueId}` | `pulse/sensors/joesbar` | One topic per venue |
| `pulse/sensors/{venueId}/{deviceId}` | `pulse/sensors/joesbar/joesbar-mainfloor-001` | Per-device granularity |
| `pulse/sensors/#` | (wildcard) | Subscribe to all venues |

---

## Quick Reference: DynamoDB Key Patterns

**SensorData:**
```
PK: venueId = "joesbar"
SK: timestamp = "2025-11-28T18:00:00.000Z"
```

**VenueConfig:**
```
PK: venueId = "joesbar"
SK: locationId = "mainfloor"
```

**OccupancyMetrics:**
```
PK: venueId = "joesbar"
(No sort key)
```

---

## Document Version

- **Created:** November 28, 2025
- **Last Updated:** November 28, 2025
- **Version:** 1.0
- **Maintained By:** Development Team

---

**🎉 END OF AWS BACKEND DOCUMENTATION**

This document should be updated whenever:
- New AWS resources are added
- Configuration changes are made
- New features are deployed
- IAM permissions are modified
