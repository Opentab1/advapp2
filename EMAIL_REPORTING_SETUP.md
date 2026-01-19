# Email Reporting Setup Guide

This guide walks you through setting up automated weekly email reports for venue owners.

## Cost Estimate

| Component | Monthly Cost |
|-----------|--------------|
| AWS SES | ~$0.01 (68 emails for 17 venues) |
| Lambda | $0.00 (free tier) |
| EventBridge | $0.00 (free tier) |
| **Total** | **< $0.10/month** |

---

## Step 1: Verify Your Email Domain in AWS SES

### Option A: Verify a Single Email (Quick Start)

```bash
# In AWS CloudShell, run:
aws ses verify-email-identity --email-address reports@yourdomain.com
```

Check your email and click the verification link.

### Option B: Verify Entire Domain (Recommended for Production)

```bash
# Get the DKIM tokens for your domain
aws ses verify-domain-dkim --domain yourdomain.com
```

Add the returned DKIM records to your DNS. This allows you to send from any email @yourdomain.com.

---

## Step 2: Create the Lambda Function

### 2.1 Create the Lambda Execution Role

```bash
# Create the trust policy file
cat > /tmp/trust-policy.json << 'EOF'
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
EOF

# Create the role
aws iam create-role \
  --role-name WeeklyReportLambdaRole \
  --assume-role-policy-document file:///tmp/trust-policy.json

# Attach required policies
aws iam attach-role-policy \
  --role-name WeeklyReportLambdaRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

aws iam attach-role-policy \
  --role-name WeeklyReportLambdaRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonDynamoDBReadOnlyAccess

aws iam attach-role-policy \
  --role-name WeeklyReportLambdaRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonSESFullAccess
```

### 2.2 Package and Deploy the Lambda

```bash
# Create a directory for the Lambda package
mkdir -p /tmp/weekly-report-lambda
cd /tmp/weekly-report-lambda

# Copy the Lambda code (from your repo's lambda-functions/sendWeeklyReports.js)
# Upload via console or use the AWS CLI:

# Create the deployment package
zip -r function.zip .

# Get your account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Create the Lambda function
aws lambda create-function \
  --function-name sendWeeklyReports \
  --runtime nodejs18.x \
  --role arn:aws:iam::${ACCOUNT_ID}:role/WeeklyReportLambdaRole \
  --handler index.handler \
  --timeout 300 \
  --memory-size 512 \
  --environment "Variables={SENDER_EMAIL=reports@yourdomain.com,DASHBOARD_URL=https://app.yourdomain.com}" \
  --zip-file fileb://function.zip
```

### 2.3 Alternative: Deploy via AWS Console

1. Go to **Lambda** → **Create Function**
2. Name: `sendWeeklyReports`
3. Runtime: Node.js 18.x
4. Execution role: Use existing role → `WeeklyReportLambdaRole`
5. Copy the code from `lambda-functions/sendWeeklyReports.js`
6. Set environment variables:
   - `SENDER_EMAIL`: Your verified SES email
   - `DASHBOARD_URL`: Your dashboard URL

---

## Step 3: Schedule with EventBridge

### Create Weekly Schedule (Every Monday at 9am EST)

```bash
# Create the EventBridge rule
aws events put-rule \
  --name WeeklyVenueReports \
  --schedule-expression "cron(0 14 ? * MON *)" \
  --description "Send weekly venue reports every Monday at 9am EST"

# Get Lambda ARN
LAMBDA_ARN=$(aws lambda get-function --function-name sendWeeklyReports --query 'Configuration.FunctionArn' --output text)

# Add Lambda as target
aws events put-targets \
  --rule WeeklyVenueReports \
  --targets "Id"="1","Arn"="${LAMBDA_ARN}"

# Grant EventBridge permission to invoke Lambda
aws lambda add-permission \
  --function-name sendWeeklyReports \
  --statement-id eventbridge-weekly-reports \
  --action 'lambda:InvokeFunction' \
  --principal events.amazonaws.com \
  --source-arn $(aws events describe-rule --name WeeklyVenueReports --query 'Arn' --output text)
```

---

## Step 4: Update VenueConfig Table for Email Settings

The Lambda function expects venues to have an `emailConfig` attribute. Add this to your VenueConfig items:

```json
{
  "emailConfig": {
    "enabled": true,
    "frequency": "weekly",
    "recipients": ["owner@venue.com"],
    "reportType": "full",
    "lastSentAt": "2026-01-06T14:00:00Z"
  }
}
```

You can update this via the **Admin Portal → Email Reports** page.

---

## Step 5: Update AppSync Schema (Optional)

To manage email settings via GraphQL, add these to your schema:

```graphql
input EmailConfigInput {
  enabled: Boolean!
  frequency: String!
  recipients: [String!]!
  reportType: String!
}

type EmailConfig {
  enabled: Boolean
  frequency: String
  recipients: [String]
  reportType: String
  lastSentAt: String
}

type Mutation {
  updateVenueEmailConfig(venueId: String!, emailConfig: EmailConfigInput!): MutationResult
  sendTestEmail(venueId: String!): MutationResult
}
```

---

## Step 6: Test the Setup

### Manual Test via Lambda Console

1. Go to Lambda → `sendWeeklyReports`
2. Click **Test**
3. Use empty event: `{}`
4. Check CloudWatch logs for results

### Send Test Email via Admin Portal

1. Go to Admin Portal → Email Reports
2. Find a venue with email enabled
3. Click "Send Test"

---

## Troubleshooting

### "Email address is not verified"

Run:
```bash
aws ses list-identities
```

If your email isn't listed, verify it:
```bash
aws ses verify-email-identity --email-address your@email.com
```

### "Access Denied" on DynamoDB

Ensure the Lambda role has `AmazonDynamoDBReadOnlyAccess` policy attached.

### Lambda Timeout

Increase timeout to 5 minutes (300 seconds) if processing many venues.

### No Emails Received

1. Check SES is out of sandbox mode (for production)
2. Check spam folder
3. Verify recipient email is valid

---

## Moving to Production

### Exit SES Sandbox

By default, SES is in sandbox mode and can only send to verified emails.

To send to any email:
1. Go to SES Console → Account Dashboard
2. Click "Request Production Access"
3. Fill out the form (explain it's for venue analytics reports)

---

## Files Created

| File | Purpose |
|------|---------|
| `src/services/email-report.service.ts` | Generates report content |
| `lambda-functions/sendWeeklyReports.js` | AWS Lambda function |
| `src/pages/admin/EmailReporting.tsx` | Admin UI for email settings |

---

## Admin Portal Access

The Email Reports page is available at:
**Admin Portal → Email Reports**

From here you can:
- Enable/disable reports per venue
- Set frequency (daily, weekly, monthly)
- Add/remove recipients
- Send test emails
- Preview report content
