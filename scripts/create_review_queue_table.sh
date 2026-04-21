#!/bin/bash
# create_review_queue_table.sh — create the DDB table that backs the low-
# confidence event review queue. Idempotent — re-runs are safe.
#
# Prereqs:
#   - AWS CLI configured with credentials that can create DDB tables
#   - Region: us-east-2 (override with AWS_REGION env var if different)
#
# After this creates the table, redeploy the admin Lambda so its IAM policy
# picks up the new table ARN:
#   ./deploy_admin_lambda.sh
#
# Then deploy the updated worker to populate the table (P1-8b worker changes)
# in the next maintenance window.

set -e
REGION="${AWS_REGION:-us-east-2}"
TABLE="VenueScopeLowConfEvents"

echo "=== Review queue DDB table setup ==="
echo "Region: $REGION"
echo "Table:  $TABLE"
echo ""

# Check whether the table already exists
if aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" >/dev/null 2>&1; then
  echo "✅ Table already exists. Nothing to do."
  exit 0
fi

echo "Creating table..."
aws dynamodb create-table \
  --table-name "$TABLE" \
  --region    "$REGION" \
  --billing-mode PAY_PER_REQUEST \
  --attribute-definitions \
    AttributeName=venueId,AttributeType=S \
    AttributeName=eventId,AttributeType=S \
    AttributeName=status,AttributeType=S \
    AttributeName=detectedAt,AttributeType=N \
  --key-schema \
    AttributeName=venueId,KeyType=HASH \
    AttributeName=eventId,KeyType=RANGE \
  --global-secondary-indexes \
    "IndexName=status-detectedAt-index,KeySchema=[{AttributeName=status,KeyType=HASH},{AttributeName=detectedAt,KeyType=RANGE}],Projection={ProjectionType=ALL}"

echo ""
echo "Waiting for table to become ACTIVE..."
aws dynamodb wait table-exists --table-name "$TABLE" --region "$REGION"

echo "✅ Table ready."
echo ""
echo "Next steps:"
echo "  1. Run ./deploy_admin_lambda.sh to pick up the new IAM policy."
echo "  2. Worker modifications (P1-8b) go in the next maintenance window."
