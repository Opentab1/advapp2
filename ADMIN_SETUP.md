# Admin Portal Setup Guide

This document describes the AWS backend configuration required for the Admin Portal to function fully.

## Overview

The Admin Portal requires the following GraphQL queries/mutations to be added to AppSync:

| Operation | Type | Purpose | Lambda Required |
|-----------|------|---------|-----------------|
| `listAllVenues` | Query | List all venues | Yes |
| `listAllUsers` | Query | List Cognito users | Yes |
| `listAllDevices` | Query | List IoT devices | Yes |
| `getAdminStats` | Query | Aggregate counts | Yes |
| `getAdminActivity` | Query | Audit log | Yes |
| `createVenue` | Mutation | Create venue + user + device | Exists |
| `updateVenueStatus` | Mutation | Suspend/activate venue | Yes |
| `createUser` | Mutation | Create Cognito user | Yes |
| `resetUserPassword` | Mutation | Reset user password | Yes |
| `setUserEnabled` | Mutation | Enable/disable user | Yes |

## 1. GraphQL Schema Additions

Add these types and operations to your AppSync schema:

```graphql
# ============ ADMIN TYPES ============

type AdminVenue {
  venueId: ID!
  venueName: String!
  displayName: String
  locationId: String!
  locationName: String
  status: String!
  createdAt: String!
  lastDataTimestamp: String
  userCount: Int
  deviceCount: Int
  plan: String
  mqttTopic: String
}

type AdminVenueConnection {
  items: [AdminVenue]
  nextToken: String
}

type AdminUser {
  userId: ID!
  email: String!
  name: String
  venueId: String!
  venueName: String
  role: String!
  status: String!
  createdAt: String
  lastLoginAt: String
  emailVerified: Boolean
}

type AdminUserConnection {
  items: [AdminUser]
  nextToken: String
}

type AdminDevice {
  deviceId: ID!
  venueId: String!
  venueName: String
  locationName: String
  status: String!
  lastHeartbeat: String
  firmware: String
  createdAt: String
  cpuTemp: Float
  diskUsage: Float
  uptime: String
}

type AdminDeviceConnection {
  items: [AdminDevice]
}

type AdminStats {
  totalVenues: Int!
  activeVenues: Int!
  totalUsers: Int!
  activeUsers: Int!
  totalDevices: Int!
  onlineDevices: Int!
  offlineDevices: Int!
}

type AdminActivity {
  id: ID!
  action: String!
  actor: String!
  target: String!
  timestamp: String!
  details: String
}

type AdminActivityConnection {
  items: [AdminActivity]
}

type MutationResult {
  success: Boolean!
  message: String
}

# ============ ADMIN QUERIES ============

extend type Query {
  listAllVenues(limit: Int, nextToken: String): AdminVenueConnection
    @aws_cognito_user_pools(cognito_groups: ["admins"])
  
  listAllUsers(limit: Int, nextToken: String): AdminUserConnection
    @aws_cognito_user_pools(cognito_groups: ["admins"])
  
  listAllDevices(limit: Int): AdminDeviceConnection
    @aws_cognito_user_pools(cognito_groups: ["admins"])
  
  getAdminStats: AdminStats
    @aws_cognito_user_pools(cognito_groups: ["admins"])
  
  getAdminActivity(limit: Int): AdminActivityConnection
    @aws_cognito_user_pools(cognito_groups: ["admins"])
}

# ============ ADMIN MUTATIONS ============

extend type Mutation {
  updateVenueStatus(venueId: ID!, status: String!): MutationResult
    @aws_cognito_user_pools(cognito_groups: ["admins"])
  
  createUser(
    email: String!
    name: String!
    venueId: String!
    venueName: String!
    role: String!
    tempPassword: String!
  ): MutationResult
    @aws_cognito_user_pools(cognito_groups: ["admins"])
  
  resetUserPassword(email: String!, tempPassword: String!): MutationResult
    @aws_cognito_user_pools(cognito_groups: ["admins"])
  
  setUserEnabled(email: String!, enabled: Boolean!): MutationResult
    @aws_cognito_user_pools(cognito_groups: ["admins"])
}
```

## 2. Lambda Functions

### 2.1 listAllVenues Lambda

```javascript
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

exports.handler = async (event) => {
  const { limit = 100, nextToken } = event.arguments || {};
  
  const params = {
    TableName: 'VenueConfig',
    Limit: limit,
  };
  
  if (nextToken) {
    params.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString());
  }
  
  const result = await client.send(new ScanCommand(params));
  
  const items = result.Items.map(item => ({
    venueId: item.venueId,
    venueName: item.venueName || item.displayName || item.venueId,
    displayName: item.displayName,
    locationId: item.locationId || 'main',
    locationName: item.locationName,
    status: item.status || 'active',
    createdAt: item.createdAt || new Date().toISOString(),
    lastDataTimestamp: item.lastDataTimestamp,
    userCount: item.userCount || 0,
    deviceCount: item.deviceCount || 1,
    plan: item.plan || 'Standard',
    mqttTopic: item.mqttTopic,
  }));
  
  return {
    items,
    nextToken: result.LastEvaluatedKey 
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : null
  };
};
```

### 2.2 listAllUsers Lambda

```javascript
const { CognitoIdentityProviderClient, ListUsersCommand } = require('@aws-sdk/client-cognito-identity-provider');

const client = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;

exports.handler = async (event) => {
  const { limit = 60, nextToken } = event.arguments || {};
  
  const params = {
    UserPoolId: USER_POOL_ID,
    Limit: Math.min(limit, 60),
  };
  
  if (nextToken) {
    params.PaginationToken = nextToken;
  }
  
  const result = await client.send(new ListUsersCommand(params));
  
  const items = result.Users.map(user => {
    const attrs = {};
    user.Attributes.forEach(a => { attrs[a.Name] = a.Value; });
    
    return {
      userId: user.Username,
      email: attrs.email || user.Username,
      name: attrs.name || attrs['custom:ownerName'] || '',
      venueId: attrs['custom:venueId'] || '',
      venueName: attrs['custom:venueName'] || '',
      role: attrs['custom:role'] || 'staff',
      status: user.Enabled ? 'active' : 'disabled',
      createdAt: user.UserCreateDate?.toISOString(),
      lastLoginAt: user.UserLastModifiedDate?.toISOString(),
      emailVerified: attrs.email_verified === 'true',
    };
  });
  
  return {
    items,
    nextToken: result.PaginationToken || null
  };
};
```

### 2.3 listAllDevices Lambda

```javascript
const { IoTClient, ListThingsCommand, DescribeThingCommand } = require('@aws-sdk/client-iot');
const { IoTDataPlaneClient, GetThingShadowCommand } = require('@aws-sdk/client-iot-data-plane');

const iotClient = new IoTClient({});
const iotDataClient = new IoTDataPlaneClient({});

exports.handler = async (event) => {
  const { limit = 200 } = event.arguments || {};
  
  // List all IoT Things with prefix 'rpi-'
  const listResult = await iotClient.send(new ListThingsCommand({
    maxResults: limit,
    attributeName: 'venueId',
  }));
  
  const items = await Promise.all(listResult.things.map(async (thing) => {
    let shadow = null;
    try {
      const shadowResult = await iotDataClient.send(new GetThingShadowCommand({
        thingName: thing.thingName
      }));
      shadow = JSON.parse(new TextDecoder().decode(shadowResult.payload));
    } catch (e) {
      // No shadow or error - device likely offline
    }
    
    const attrs = thing.attributes || {};
    const reported = shadow?.state?.reported || {};
    
    // Determine status based on shadow timestamp
    const lastUpdate = shadow?.metadata?.reported?.timestamp;
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
    const status = lastUpdate && lastUpdate > fiveMinutesAgo ? 'online' : 'offline';
    
    return {
      deviceId: thing.thingName,
      venueId: attrs.venueId || '',
      venueName: attrs.venueName || attrs.venueId || '',
      locationName: attrs.locationName || 'Main Floor',
      status,
      lastHeartbeat: lastUpdate ? new Date(lastUpdate * 1000).toISOString() : null,
      firmware: reported.firmware || 'Unknown',
      createdAt: thing.creationDate?.toISOString(),
      cpuTemp: reported.cpuTemp,
      diskUsage: reported.diskUsage,
      uptime: reported.uptime,
    };
  }));
  
  return { items };
};
```

### 2.4 getAdminStats Lambda

```javascript
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { CognitoIdentityProviderClient, ListUsersCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { IoTClient, ListThingsCommand } = require('@aws-sdk/client-iot');

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognitoClient = new CognitoIdentityProviderClient({});
const iotClient = new IoTClient({});

exports.handler = async () => {
  // Count venues
  const venueResult = await dynamoClient.send(new ScanCommand({
    TableName: 'VenueConfig',
    Select: 'COUNT'
  }));
  
  // Count users
  const userResult = await cognitoClient.send(new ListUsersCommand({
    UserPoolId: process.env.COGNITO_USER_POOL_ID,
    Limit: 60
  }));
  
  // Count devices
  const deviceResult = await iotClient.send(new ListThingsCommand({
    maxResults: 250
  }));
  
  return {
    totalVenues: venueResult.Count || 0,
    activeVenues: venueResult.Count || 0, // Would need status filter
    totalUsers: userResult.Users?.length || 0,
    activeUsers: userResult.Users?.filter(u => u.Enabled).length || 0,
    totalDevices: deviceResult.things?.length || 0,
    onlineDevices: 0, // Would need shadow check
    offlineDevices: 0,
  };
};
```

### 2.5 resetUserPassword Lambda

```javascript
const { CognitoIdentityProviderClient, AdminSetUserPasswordCommand } = require('@aws-sdk/client-cognito-identity-provider');

const client = new CognitoIdentityProviderClient({});

exports.handler = async (event) => {
  const { email, tempPassword } = event.arguments;
  
  try {
    await client.send(new AdminSetUserPasswordCommand({
      UserPoolId: process.env.COGNITO_USER_POOL_ID,
      Username: email,
      Password: tempPassword,
      Permanent: false
    }));
    
    return { success: true, message: 'Password reset successfully' };
  } catch (error) {
    return { success: false, message: error.message };
  }
};
```

### 2.6 setUserEnabled Lambda

```javascript
const { CognitoIdentityProviderClient, AdminEnableUserCommand, AdminDisableUserCommand } = require('@aws-sdk/client-cognito-identity-provider');

const client = new CognitoIdentityProviderClient({});

exports.handler = async (event) => {
  const { email, enabled } = event.arguments;
  
  try {
    const Command = enabled ? AdminEnableUserCommand : AdminDisableUserCommand;
    await client.send(new Command({
      UserPoolId: process.env.COGNITO_USER_POOL_ID,
      Username: email
    }));
    
    return { success: true, message: `User ${enabled ? 'enabled' : 'disabled'} successfully` };
  } catch (error) {
    return { success: false, message: error.message };
  }
};
```

## 3. IAM Permissions

Each Lambda function needs appropriate IAM permissions:

### listAllVenues
- `dynamodb:Scan` on VenueConfig table

### listAllUsers
- `cognito-idp:ListUsers` on User Pool

### listAllDevices
- `iot:ListThings`
- `iot:DescribeThing`
- `iot-data:GetThingShadow`

### getAdminStats
- All of the above

### resetUserPassword
- `cognito-idp:AdminSetUserPassword`

### setUserEnabled
- `cognito-idp:AdminEnableUser`
- `cognito-idp:AdminDisableUser`

## 4. AppSync Resolver Configuration

For each query/mutation, create a Lambda resolver in AppSync:

1. Go to AppSync → Your API → Schema
2. Find the query/mutation
3. Click "Attach" → "Lambda function"
4. Select the corresponding Lambda function
5. Grant AppSync permission to invoke the Lambda

## 5. Cognito Admin Group

Create an "admins" group in Cognito User Pool and add admin users to it:

```bash
aws cognito-idp create-group \
  --user-pool-id YOUR_USER_POOL_ID \
  --group-name admins

aws cognito-idp admin-add-user-to-group \
  --user-pool-id YOUR_USER_POOL_ID \
  --username admin@advizia.com \
  --group-name admins
```

## 6. Testing

After deploying:

1. Log in as an admin user (member of "admins" group)
2. Navigate to Admin Portal
3. Verify venue/user/device lists populate
4. Test create/edit/delete operations
5. Verify stats update correctly

## Troubleshooting

**Empty lists in Admin Portal:**
- Check CloudWatch Logs for Lambda errors
- Verify Lambda has correct IAM permissions
- Ensure AppSync resolver is attached correctly

**"Access Denied" errors:**
- Verify user is in "admins" Cognito group
- Check AppSync authorization rules

**Stats show zeros:**
- Verify getAdminStats Lambda is deployed and attached
- Check Lambda has permissions to all required services
