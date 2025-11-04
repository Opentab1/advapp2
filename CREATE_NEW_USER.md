# Guide: Creating New User Accounts in Cognito

## Step 1: Create User in Cognito User Pool

### Option A: Via AWS Console (Easiest)

1. Go to **AWS Console → Cognito → User Pools**
2. Select your User Pool: `us-east-2_I6EBJm3te`
3. Click **Users** tab
4. Click **Create user**
5. Fill in:
   - **Username**: (email address or username)
   - **Email address**: User's email
   - **Temporary password**: Generate or set one
   - **Send email invitation**: ✅ Check this (sends welcome email)
6. Click **Create user**

### Option B: Via AWS CLI

```bash
aws cognito-idp admin-create-user \
  --user-pool-id us-east-2_I6EBJm3te \
  --username user@example.com \
  --user-attributes Name=email,Value=user@example.com \
  --temporary-password TempPassword123! \
  --message-action SUPPRESS
```

## Step 2: Set Custom Attributes (CRITICAL!)

Each user **MUST** have `custom:venueId` attribute set to their venue ID.

### Via AWS Console:

1. After creating user, click on the user
2. Scroll to **Attributes** section
3. Click **Edit**
4. Find `custom:venueId` attribute
5. Set value to their venue ID (e.g., `FergData`)
6. Click **Save changes**

### Via AWS CLI:

```bash
aws cognito-idp admin-update-user-attributes \
  --user-pool-id us-east-2_I6EBJm3te \
  --username user@example.com \
  --user-attributes Name=custom:venueId,Value=FergData
```

## Step 3: Set User Password (If Temporary Password)

### Via AWS Console:

1. Click on the user
2. Click **Actions** → **Set password**
3. Enter new password
4. Select **Set permanent password** (not temporary)
5. Click **Set password**

### Via AWS CLI:

```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id us-east-2_I6EBJm3te \
  --username user@example.com \
  --password NewPassword123! \
  --permanent
```

## Step 4: Verify User Can Log In

1. Go to your app login page
2. User logs in with:
   - **Email**: Their email address
   - **Password**: Their password
3. App should:
   - ✅ Authenticate successfully
   - ✅ Extract `venueId` from `custom:venueId` attribute
   - ✅ Load data for that venue

## Step 5: Add User to DynamoDB (If Needed)

If the user's venue doesn't exist in DynamoDB yet:

### Add VenueConfig Entry:

```bash
aws dynamodb put-item \
  --table-name VenueConfig \
  --item '{
    "venueId": {"S": "FergData"},
    "locationId": {"S": "location-1"},
    "displayName": {"S": "Main Location"},
    "locationName": {"S": "Main Location"},
    "address": {"S": "123 Main St"},
    "timezone": {"S": "America/New_York"}
  }'
```

Or via AWS Console:
1. Go to **DynamoDB → Tables → VenueConfig**
2. Click **Explore table items**
3. Click **Create item**
4. Add:
   - `venueId`: User's venue ID
   - `locationId`: Unique location ID
   - `displayName`: Location name
   - Other fields as needed

## Quick Script: Create User with Venue ID

```bash
#!/bin/bash

# Set variables
USER_POOL_ID="us-east-2_I6EBJm3te"
EMAIL="newuser@example.com"
VENUE_ID="FergData"
TEMP_PASSWORD="TempPass123!"

# Create user
aws cognito-idp admin-create-user \
  --user-pool-id $USER_POOL_ID \
  --username $EMAIL \
  --user-attributes Name=email,Value=$EMAIL Name=custom:venueId,Value=$VENUE_ID \
  --temporary-password $TEMP_PASSWORD \
  --message-action SUPPRESS

# Set permanent password (user will need to change on first login)
aws cognito-idp admin-set-user-password \
  --user-pool-id $USER_POOL_ID \
  --username $EMAIL \
  --password $TEMP_PASSWORD \
  --permanent

echo "User created: $EMAIL"
echo "Venue ID: $VENUE_ID"
echo "Temporary password: $TEMP_PASSWORD"
```

## Important Notes

1. **`custom:venueId` is REQUIRED** - Without it, user can't access data
2. **Venue ID must match** - The `custom:venueId` must match entries in your DynamoDB tables
3. **User must be confirmed** - User needs to be in "Confirmed" status to log in
4. **Email verification** - If email verification is required, user needs to verify their email

## Verify User Setup

Check if user has correct attributes:

```bash
aws cognito-idp admin-get-user \
  --user-pool-id us-east-2_I6EBJm3te \
  --username user@example.com
```

Look for:
- ✅ `email_verified: true`
- ✅ `custom:venueId: FergData` (or their venue ID)
- ✅ `UserStatus: CONFIRMED`

## Common Issues

### User can't log in:
- Check user status is "Confirmed"
- Verify email is correct
- Check password is set correctly

### User gets "Unauthorized" after login:
- **MOST COMMON**: Missing `custom:venueId` attribute
- Check attribute value matches DynamoDB entries
- Verify AppSync resolvers are configured correctly

### User sees no data:
- Check `custom:venueId` matches DynamoDB `venueId` values
- Verify DynamoDB tables have data for that venue
- Check AppSync resolvers are attached to correct tables

## Next Steps After Creating User

1. User logs in to app
2. App extracts `venueId` from token
3. AppSync queries DynamoDB filtered by `venueId`
4. User sees only their venue's data

That's it! Each user is isolated to their venue's data automatically.
