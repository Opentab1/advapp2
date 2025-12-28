# AWS Backend To-Do List

## Overview
The frontend has been updated to remove localStorage and use DynamoDB for cross-device settings sync. The following AWS resources need to be created/updated to support this.

---

## 1. DynamoDB Tables

### Create `UserSettings` Table
Stores per-user settings (synced across all devices for the same user).

| Attribute | Type | Description |
|-----------|------|-------------|
| `userId` (PK) | String | User's email address |
| `theme` | String | "light", "dark", or "auto" |
| `soundAlerts` | Boolean | Enable sound notifications |
| `refreshInterval` | Number | Data refresh interval in seconds |
| `temperatureUnit` | String | "fahrenheit" or "celsius" |
| `timezone` | String | e.g., "America/New_York" |
| `notifications` | Boolean | Enable notifications |
| `emailNotifications` | Map | Nested notification preferences |
| `termsAccepted` | Boolean | Has user accepted terms |
| `termsAcceptedDate` | String | ISO date of acceptance |

**CLI Command:**
```bash
aws dynamodb create-table \
  --table-name UserSettings \
  --attribute-definitions AttributeName=userId,AttributeType=S \
  --key-schema AttributeName=userId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

---

### Create `VenueSettings` Table
Stores per-venue settings (shared by all users of that venue).

| Attribute | Type | Description |
|-----------|------|-------------|
| `venueId` (PK) | String | Venue identifier |
| `address` | Map | Street, city, state, zipCode, country |
| `toastPOS` | Map | enabled, apiKey, restaurantGuid |
| `lastUpdated` | String | ISO timestamp |

**CLI Command:**
```bash
aws dynamodb create-table \
  --table-name VenueSettings \
  --attribute-definitions AttributeName=venueId,AttributeType=S \
  --key-schema AttributeName=venueId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

---

## 2. AppSync Schema Update

Upload the updated schema from `APPSYNC_SCHEMA.graphql` which includes:

- `UserSettings` type
- `VenueSettingsData` type  
- `getUserSettings(userId: ID!)` query
- `getVenueSettings(venueId: ID!)` query
- `saveUserSettings(input: UserSettingsInput!)` mutation
- `saveVenueSettings(input: VenueSettingsInput!)` mutation

**Steps:**
1. Go to AWS AppSync Console
2. Select your API
3. Go to Schema
4. Replace with contents of `APPSYNC_SCHEMA.graphql`
5. Click "Save Schema"

---

## 3. AppSync Resolvers

### Create Resolver: `getUserSettings`
- **Data Source:** UserSettings DynamoDB table
- **Request Mapping Template:**
```vtl
{
  "version": "2018-05-29",
  "operation": "GetItem",
  "key": {
    "userId": $util.dynamodb.toDynamoDBJson($ctx.args.userId)
  }
}
```
- **Response Mapping Template:**
```vtl
$util.toJson($ctx.result)
```

---

### Create Resolver: `saveUserSettings`
- **Data Source:** UserSettings DynamoDB table
- **Request Mapping Template:**
```vtl
{
  "version": "2018-05-29",
  "operation": "PutItem",
  "key": {
    "userId": $util.dynamodb.toDynamoDBJson($ctx.args.input.userId)
  },
  "attributeValues": $util.dynamodb.toMapValuesJson($ctx.args.input)
}
```
- **Response Mapping Template:**
```vtl
$util.toJson($ctx.result)
```

---

### Create Resolver: `getVenueSettings`
- **Data Source:** VenueSettings DynamoDB table
- **Request Mapping Template:**
```vtl
{
  "version": "2018-05-29",
  "operation": "GetItem",
  "key": {
    "venueId": $util.dynamodb.toDynamoDBJson($ctx.args.venueId)
  }
}
```
- **Response Mapping Template:**
```vtl
$util.toJson($ctx.result)
```

---

### Create Resolver: `saveVenueSettings`
- **Data Source:** VenueSettings DynamoDB table
- **Request Mapping Template:**
```vtl
{
  "version": "2018-05-29",
  "operation": "PutItem",
  "key": {
    "venueId": $util.dynamodb.toDynamoDBJson($ctx.args.input.venueId)
  },
  "attributeValues": $util.dynamodb.toMapValuesJson($ctx.args.input)
}
```
- **Response Mapping Template:**
```vtl
$util.toJson($ctx.result)
```

---

## 4. IAM Permissions

Ensure the AppSync service role has permissions to access the new tables:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-1:YOUR_ACCOUNT_ID:table/UserSettings",
        "arn:aws:dynamodb:us-east-1:YOUR_ACCOUNT_ID:table/VenueSettings"
      ]
    }
  ]
}
```

---

## 5. Data Sources in AppSync

1. Go to AppSync Console → Your API → Data Sources
2. Create data source for `UserSettings`:
   - Name: `UserSettingsTable`
   - Type: Amazon DynamoDB
   - Table: `UserSettings`
   - Region: us-east-1
3. Create data source for `VenueSettings`:
   - Name: `VenueSettingsTable`
   - Type: Amazon DynamoDB
   - Table: `VenueSettings`
   - Region: us-east-1

---

## 6. Security Considerations

### Toast POS API Keys
The `toastPOS.apiKey` field in VenueSettings contains sensitive credentials. Consider:
- Encrypting at rest (DynamoDB encryption is enabled by default)
- Using AWS Secrets Manager for API keys instead
- Adding field-level authorization in AppSync

### User Authorization
Ensure resolvers validate that:
- Users can only read/write their own UserSettings (`userId` matches authenticated user)
- Users can only read/write VenueSettings for their assigned venue

**Example authorization in resolver:**
```vtl
#if($ctx.identity.claims.get("email") != $ctx.args.userId)
  $util.unauthorized()
#end
```

---

## Checklist

- [ ] Create `UserSettings` DynamoDB table
- [ ] Create `VenueSettings` DynamoDB table
- [ ] Update AppSync schema
- [ ] Create `UserSettingsTable` data source
- [ ] Create `VenueSettingsTable` data source
- [ ] Create `getUserSettings` resolver
- [ ] Create `saveUserSettings` resolver
- [ ] Create `getVenueSettings` resolver
- [ ] Create `saveVenueSettings` resolver
- [ ] Update IAM permissions
- [ ] Test queries/mutations in AppSync console
- [ ] Verify frontend works with new backend

---

## Testing

After setup, test in AppSync Console:

**Test getUserSettings:**
```graphql
query {
  getUserSettings(userId: "test@example.com") {
    userId
    theme
    termsAccepted
  }
}
```

**Test saveUserSettings:**
```graphql
mutation {
  saveUserSettings(input: {
    userId: "test@example.com"
    theme: "dark"
    termsAccepted: true
    termsAcceptedDate: "2025-12-27T00:00:00Z"
  }) {
    userId
    theme
  }
}
```

---

## Notes

- Frontend gracefully handles missing backend (uses defaults until backend is ready)
- All caches are now in-memory only (no localStorage pollution)
- Settings sync automatically when user logs in on any device
