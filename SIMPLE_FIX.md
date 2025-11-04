# 🔧 Fix: AppSync Authorization - Quick Setup

## The Problem
Your AppSync API has Cognito User Pool authorization enabled, but resolvers aren't configured yet.

## The Fix (5 minutes)

### Step 1: Attach Resolvers (In AppSync Console)

1. Go to **AWS Console → AppSync → Your API**
2. Click **Schema** tab
3. Scroll to **Resolvers** section
4. For each resolver, click **Attach**:

#### `listSensorData` resolver:
- Click **Attach**
- **Data source**: Select `SensorDataTable` (or create it pointing to `SensorData` DynamoDB table)
- **Request template**: Use default template
- **Response template**: `$util.toJson($ctx.result)`
- **Authorization**: Set to `AMAZON_COGNITO_USER_POOLS` (NOT API_KEY)
- **Save**

#### `listVenueLocations` resolver:
- Click **Attach**
- **Data source**: Select `VenueConfigTable` (or create it pointing to `VenueConfig` DynamoDB table)
- **Request template**: Use default template
- **Response template**: `$util.toJson($ctx.result)`
- **Authorization**: Set to `AMAZON_COGNITO_USER_POOLS`
- **Save**

#### `getOccupancyMetrics` resolver:
- Click **Attach**
- **Data source**: Select `OccupancyMetricsTable` (or create it pointing to `OccupancyMetrics` DynamoDB table)
- **Request template**: Use default template
- **Response template**: `$util.toJson($ctx.result)`
- **Authorization**: Set to `AMAZON_COGNITO_USER_POOLS`
- **Save**

### Step 2: Create Data Sources (If Needed)

If you don't see the data sources:

1. Go to **Data Sources** tab
2. Click **Create data source** for each:
   - `SensorDataTable` → points to `SensorData` DynamoDB table
   - `VenueConfigTable` → points to `VenueConfig` DynamoDB table
   - `OccupancyMetricsTable` → points to `OccupancyMetrics` DynamoDB table

### Step 3: Test

1. Hard refresh your app (Ctrl+Shift+R)
2. Log in
3. Your data should load!

## What's Already Done ✅

- ✅ Cognito User Pool authorization added to AppSync
- ✅ Schema updated with `@aws_cognito_user_pools` directives
- ✅ Code already uses `authMode: 'userPool'`
- ✅ Your DynamoDB tables exist

## What You Need to Do

Just **attach resolvers to data sources** and set authorization to `AMAZON_COGNITO_USER_POOLS`.

That's it! Once resolvers are attached, your app will work.
