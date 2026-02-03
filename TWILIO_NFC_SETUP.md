# NFC Lead Capture - Twilio Setup Guide

## Overview

Each venue gets their own dedicated Twilio phone number. When a customer taps the NFC tag, it opens a pre-filled SMS that they just send. The lead is captured instantly.

```
Customer taps NFC → SMS app opens → They hit Send → Lead captured → Auto-reply sent
```

---

## Step 1: Get Your Twilio Credentials

1. Go to [Twilio Console](https://console.twilio.com/)
2. Copy your **Account SID** (starts with `AC...`)
3. Copy your **Auth Token** (click to reveal)

---

## Step 2: Buy a Phone Number

1. In Twilio Console → Phone Numbers → Buy a Number
2. Search for a number (local area code looks professional)
3. Make sure it has **SMS capability**
4. Buy it (~$1.00/month)
5. Copy the phone number (e.g., `+15125551234`)

---

## Step 3: Create DynamoDB Tables

Run these AWS CLI commands:

```bash
# Create VenueLeads table (stores all captured leads)
aws dynamodb create-table \
  --table-name VenueLeads \
  --attribute-definitions \
    AttributeName=venueId,AttributeType=S \
    AttributeName=phoneNumber,AttributeType=S \
  --key-schema \
    AttributeName=venueId,KeyType=HASH \
    AttributeName=phoneNumber,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-2

# Add GSI to VenueConfig for phone number lookup
# (If VenueConfig table already exists, add the GSI)
aws dynamodb update-table \
  --table-name VenueConfig \
  --attribute-definitions \
    AttributeName=twilioPhoneNumber,AttributeType=S \
  --global-secondary-index-updates \
    "[{\"Create\":{\"IndexName\":\"TwilioPhoneIndex\",\"KeySchema\":[{\"AttributeName\":\"twilioPhoneNumber\",\"KeyType\":\"HASH\"}],\"Projection\":{\"ProjectionType\":\"ALL\"}}}]" \
  --region us-east-2
```

---

## Step 4: Add Venue Configuration

Add your venue to the VenueConfig table with the Twilio number:

```bash
aws dynamodb put-item \
  --table-name VenueConfig \
  --item '{
    "venueId": {"S": "YOUR_VENUE_ID"},
    "venueName": {"S": "Your Venue Name"},
    "twilioPhoneNumber": {"S": "+15125551234"},
    "welcomeMessage": {"S": "Welcome to Your Venue! We'\''ll text you about specials & events. Reply STOP anytime."},
    "returnMessage": {"S": "Welcome back! You'\''re already on our VIP list."}
  }' \
  --region us-east-2
```

---

## Step 5: Deploy the Lambda Function

### Create the Lambda:

```bash
# Zip the function
cd lambda-functions
zip handleIncomingSms.zip handleIncomingSms.js

# Create the Lambda function
aws lambda create-function \
  --function-name handleIncomingSms \
  --runtime nodejs18.x \
  --handler handleIncomingSms.handler \
  --role arn:aws:iam::YOUR_ACCOUNT_ID:role/YOUR_LAMBDA_ROLE \
  --zip-file fileb://handleIncomingSms.zip \
  --timeout 30 \
  --environment Variables="{
    TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx,
    TWILIO_AUTH_TOKEN=your_auth_token_here,
    LEADS_TABLE_NAME=VenueLeads,
    VENUE_CONFIG_TABLE_NAME=VenueConfig
  }" \
  --region us-east-2
```

### Create API Gateway endpoint:

```bash
# Create HTTP API
aws apigatewayv2 create-api \
  --name "TwilioSmsWebhook" \
  --protocol-type HTTP \
  --region us-east-2

# Note the API ID from output, then:
aws apigatewayv2 create-integration \
  --api-id YOUR_API_ID \
  --integration-type AWS_PROXY \
  --integration-uri arn:aws:lambda:us-east-2:YOUR_ACCOUNT_ID:function:handleIncomingSms \
  --payload-format-version 2.0 \
  --region us-east-2

# Create route
aws apigatewayv2 create-route \
  --api-id YOUR_API_ID \
  --route-key "POST /sms" \
  --target integrations/YOUR_INTEGRATION_ID \
  --region us-east-2

# Deploy
aws apigatewayv2 create-stage \
  --api-id YOUR_API_ID \
  --stage-name prod \
  --auto-deploy \
  --region us-east-2
```

Your webhook URL will be: `https://YOUR_API_ID.execute-api.us-east-2.amazonaws.com/sms`

---

## Step 6: Configure Twilio Webhook

1. Go to Twilio Console → Phone Numbers → Manage → Active Numbers
2. Click your phone number
3. Scroll to "Messaging"
4. Under "A MESSAGE COMES IN":
   - Set to **Webhook**
   - URL: `https://YOUR_API_ID.execute-api.us-east-2.amazonaws.com/sms`
   - Method: **HTTP POST**
5. Click **Save**

---

## Step 7: Program the NFC Tag

Using an NFC writing app (like NFC Tools), write this URL:

```
sms:+15125551234?body=JOIN TABLE5
```

Replace:
- `+15125551234` with your Twilio phone number
- `TABLE5` with the location (TABLE1, BAR, PATIO, etc.)

### Different tags for different locations:

| Location | NFC Tag URL |
|----------|-------------|
| Table 1 | `sms:+15125551234?body=JOIN TABLE1` |
| Table 5 | `sms:+15125551234?body=JOIN TABLE5` |
| Bar | `sms:+15125551234?body=JOIN BAR` |
| Patio | `sms:+15125551234?body=JOIN PATIO` |

---

## Step 8: Test It!

1. Tap the NFC tag with your phone
2. SMS app should open with pre-filled message
3. Hit Send
4. You should get an auto-reply within seconds
5. Check DynamoDB - lead should be stored

---

## Troubleshooting

### No auto-reply received
- Check Lambda CloudWatch logs
- Verify Twilio webhook URL is correct
- Check Twilio credentials in Lambda environment variables

### Lead not stored
- Check DynamoDB table exists
- Verify Lambda has DynamoDB permissions
- Check VenueConfig has your Twilio number

### NFC not working
- Make sure phone has NFC enabled
- Try re-writing the tag
- Test the SMS URL manually in browser

---

## Costs

| Item | Cost |
|------|------|
| Twilio Phone Number | $1.00/month |
| Incoming SMS | $0.0079/message |
| Outgoing SMS (auto-reply) | $0.0079/message |
| Lambda | Free tier (1M requests/month) |
| DynamoDB | Free tier (25GB storage) |
| API Gateway | Free tier (1M requests/month) |

**Example:** 1,000 leads/month = ~$17/month total

---

## Quick Reference

| Your Twilio Number | `+1__________` |
|-------------------|----------------|
| Venue ID | `_______________` |
| Webhook URL | `https://___.execute-api.us-east-2.amazonaws.com/sms` |
| NFC Tag URL | `sms:+1__________?body=JOIN ____` |
