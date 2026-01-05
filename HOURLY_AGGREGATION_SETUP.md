# Hourly Data Aggregation Setup Guide

This guide explains how to set up automatic hourly aggregation of sensor data for fast, accurate charts.

## Overview

Instead of querying millions of raw data points, we pre-compute hourly summaries:

| Query | Raw Data | Hourly Aggregated |
|-------|----------|-------------------|
| 24h   | 17,280 items | **24 items** |
| 7d    | 120,960 items | **168 items** |
| 30d   | 518,400 items | **720 items** |
| 90d   | 1,555,200 items | **2,160 items** |

**Result: < 1 second load time for any range**

---

## Step 1: Create the DynamoDB Table

### Using AWS Console:

1. Go to **DynamoDB** → **Create table**
2. Configure:
   - **Table name**: `SensorDataHourly`
   - **Partition key**: `venueId` (String)
   - **Sort key**: `timestamp` (String)
3. Under **Settings**, choose **Customize settings**
4. Set capacity:
   - **Read capacity**: 5 units (or On-demand)
   - **Write capacity**: 5 units (or On-demand)
5. Click **Create table**

### Using AWS CLI:

```bash
aws dynamodb create-table \
  --table-name SensorDataHourly \
  --attribute-definitions \
    AttributeName=venueId,AttributeType=S \
    AttributeName=timestamp,AttributeType=S \
  --key-schema \
    AttributeName=venueId,KeyType=HASH \
    AttributeName=timestamp,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

---

## Step 2: Create the Lambda Function

### Using AWS Console:

1. Go to **Lambda** → **Create function**
2. Configure:
   - **Function name**: `aggregateSensorData`
   - **Runtime**: Node.js 18.x
   - **Architecture**: x86_64
3. Click **Create function**
4. In the **Code** tab, replace the code with contents of:
   `lambda-functions/aggregateSensorData.js`
5. Click **Deploy**

### Configure Environment Variables:

In the **Configuration** tab → **Environment variables**:

| Key | Value |
|-----|-------|
| `RAW_TABLE` | `SensorData` |
| `HOURLY_TABLE` | `SensorDataHourly` |
| `VENUES` | `jimmyneutron` (comma-separated for multiple) |

### Configure Permissions:

In **Configuration** → **Permissions** → Click the role name

Add this policy (or attach `AmazonDynamoDBFullAccess` for simplicity):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:Query",
        "dynamodb:PutItem"
      ],
      "Resource": [
        "arn:aws:dynamodb:*:*:table/SensorData",
        "arn:aws:dynamodb:*:*:table/SensorDataHourly"
      ]
    }
  ]
}
```

### Configure Timeout:

In **Configuration** → **General configuration** → **Edit**:
- **Timeout**: 5 minutes (300 seconds)
- **Memory**: 256 MB

---

## Step 3: Set Up Automatic Trigger

### Using EventBridge (CloudWatch Events):

1. Go to **Amazon EventBridge** → **Rules** → **Create rule**
2. Configure:
   - **Name**: `hourly-sensor-aggregation`
   - **Schedule expression**: `cron(5 * * * ? *)`  
     *(Runs at 5 minutes past every hour)*
3. **Target**: Select your Lambda function `aggregateSensorData`
4. Click **Create**

### Alternative: Every 30 minutes

```
cron(5,35 * * * ? *)
```
*(Runs at :05 and :35 past each hour)*

---

## Step 4: Backfill Historical Data

To populate data for the past 7 days, invoke the Lambda manually:

### Using AWS Console:

1. Go to your Lambda function
2. Click **Test** tab
3. Create test event with:

```json
{
  "backfill": true,
  "days": 7,
  "venues": ["jimmyneutron"]
}
```

4. Click **Test**

### Using AWS CLI:

```bash
aws lambda invoke \
  --function-name aggregateSensorData \
  --payload '{"backfill": true, "days": 7, "venues": ["jimmyneutron"]}' \
  --cli-binary-format raw-in-base64-out \
  response.json
```

**Note**: Backfilling 7 days takes ~5-10 minutes.

---

## Step 5: Update AppSync Schema

Add this query to your AppSync schema:

```graphql
type HourlySensorData {
  venueId: ID!
  timestamp: String!
  avgDecibels: Float
  avgLight: Float
  avgIndoorTemp: Float
  avgOutdoorTemp: Float
  avgHumidity: Float
  minDecibels: Float
  maxDecibels: Float
  maxOccupancy: Int
  totalEntries: Int
  totalExits: Int
  topSong: String
  topArtist: String
  dataPointCount: Int
}

type Query {
  listHourlySensorData(
    venueId: ID!
    startTime: String!
    endTime: String!
    limit: Int
  ): HourlySensorDataConnection
}

type HourlySensorDataConnection {
  items: [HourlySensorData]
  nextToken: String
}
```

### Create Resolver:

**Data source**: `SensorDataHourly` DynamoDB table

**Request mapping**:
```velocity
{
  "version": "2017-02-28",
  "operation": "Query",
  "query": {
    "expression": "venueId = :venueId AND #ts BETWEEN :start AND :end",
    "expressionNames": {
      "#ts": "timestamp"
    },
    "expressionValues": {
      ":venueId": $util.dynamodb.toDynamoDBJson($ctx.args.venueId),
      ":start": $util.dynamodb.toDynamoDBJson($ctx.args.startTime),
      ":end": $util.dynamodb.toDynamoDBJson($ctx.args.endTime)
    }
  },
  "limit": $util.defaultIfNull($ctx.args.limit, 1000)
}
```

**Response mapping**:
```velocity
{
  "items": $util.toJson($ctx.result.items),
  "nextToken": $util.toJson($ctx.result.nextToken)
}
```

---

## Step 6: Update Frontend

Once the AppSync schema is updated, I'll modify the frontend to:

1. Query `listHourlySensorData` instead of raw data
2. Map the response to chart format
3. Fallback to raw data if hourly not available

---

## Verification

### Check Lambda Logs:

```bash
aws logs tail /aws/lambda/aggregateSensorData --follow
```

### Query Hourly Table:

```bash
aws dynamodb query \
  --table-name SensorDataHourly \
  --key-condition-expression "venueId = :v" \
  --expression-attribute-values '{":v":{"S":"jimmyneutron"}}' \
  --limit 5
```

### Expected Output:

```json
{
  "venueId": "jimmyneutron",
  "timestamp": "2026-01-02T22:00:00.000Z",
  "avgDecibels": 72.4,
  "avgLight": 245,
  "maxOccupancy": 87,
  "dataPointCount": 720
}
```

---

## Troubleshooting

### Lambda times out
- Increase timeout to 5 minutes
- Check if raw data table has correct indexes

### No data in hourly table
- Check Lambda CloudWatch logs for errors
- Verify venue ID matches exactly
- Ensure raw data exists for the time range

### Permission denied
- Add DynamoDB permissions to Lambda role
- Check table names in environment variables

---

## Cost Estimate

| Resource | Monthly Cost |
|----------|--------------|
| Lambda (24 runs/day × 30 days) | ~$0.10 |
| DynamoDB Hourly Table | ~$1-5 |
| EventBridge Rule | Free |

**Total: ~$1-5/month per venue**

---

## Next Steps

After completing this setup:

1. ✅ Let me know when the table and Lambda are created
2. ✅ Run the backfill for 7 days
3. ✅ I'll update the frontend to use the hourly data

Questions? Let me know!
