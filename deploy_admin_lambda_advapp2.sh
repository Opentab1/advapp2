#!/bin/bash
# ============================================================
# Deploy admin Lambda code to the LIVE advapp2 frontend's API.
#
# advapp2's Amplify build uses the API at:
#   https://g27uvy08g4.execute-api.us-east-2.amazonaws.com
# which is backed by a different Lambda (`venuescope-admin-api`,
# lowercase) than the one `deploy_admin_lambda.sh` targets
# (`VenueScopeAdminAPI`, uppercase).
#
# This script is non-destructive:
#   - update-function-code only replaces the Node.js code
#   - put-role-policy ADDS VenueScopeTestRuns to the existing
#     inline policy (preserves all current permissions)
#   - create-table is no-op when the table already exists
# ============================================================
set -e

REGION="us-east-2"
LIVE_API_ID="g27uvy08g4"
LIVE_API_URL="https://${LIVE_API_ID}.execute-api.${REGION}.amazonaws.com"

echo "Discovering live Lambda + role behind ${LIVE_API_URL}..."

INTEGRATION=$(aws apigatewayv2 get-integrations --api-id "$LIVE_API_ID" --region "$REGION" --query 'Items[0].IntegrationUri' --output text)
LAMBDA_NAME=$(echo "$INTEGRATION" | sed 's|.*function:||' | sed 's|/.*||')
ROLE_ARN=$(aws lambda get-function --function-name "$LAMBDA_NAME" --region "$REGION" --query 'Configuration.Role' --output text)
ROLE_NAME=$(echo "$ROLE_ARN" | awk -F/ '{print $NF}')
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

echo "  Lambda:  $LAMBDA_NAME"
echo "  Role:    $ROLE_NAME"
echo "  Account: $ACCOUNT"
echo

# ── DDB table ─────────────────────────────────────────────────
echo "Ensuring VenueScopeTestRuns table exists..."
if aws dynamodb describe-table --table-name VenueScopeTestRuns --region "$REGION" >/dev/null 2>&1; then
  echo "  → exists"
else
  aws dynamodb create-table \
    --table-name VenueScopeTestRuns \
    --attribute-definitions AttributeName=runId,AttributeType=S \
    --key-schema AttributeName=runId,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region "$REGION" >/dev/null
  echo "  ✓ created — waiting for ACTIVE..."
  aws dynamodb wait table-exists --table-name VenueScopeTestRuns --region "$REGION"
fi
echo

# ── IAM patch ─────────────────────────────────────────────────
echo "Patching IAM policy on $ROLE_NAME..."
POLICY_NAME=$(aws iam list-role-policies --role-name "$ROLE_NAME" --query 'PolicyNames[0]' --output text)
echo "  → $POLICY_NAME"

aws iam get-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$POLICY_NAME" \
  --query 'PolicyDocument' > /tmp/cur_policy.json

ACCOUNT="$ACCOUNT" python3 - <<'PY'
import json, os
with open('/tmp/cur_policy.json') as f:
    doc = json.load(f)
acct = os.environ['ACCOUNT']
new_arns = [
    f"arn:aws:dynamodb:us-east-2:{acct}:table/VenueScopeTestRuns",
    f"arn:aws:dynamodb:us-east-2:{acct}:table/VenueScopeTestRuns/*",
]
patched = False
for stmt in doc.get("Statement", []):
    actions = stmt.get("Action", [])
    if isinstance(actions, str):
        actions = [actions]
    if any(a.startswith("dynamodb:") for a in actions):
        existing = stmt.get("Resource", [])
        if isinstance(existing, str):
            existing = [existing]
        stmt["Resource"] = list(dict.fromkeys(existing + new_arns))
        patched = True
        break
if not patched:
    doc.setdefault("Statement", []).append({
        "Effect": "Allow",
        "Action": [
            "dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:Scan",
            "dynamodb:Query",   "dynamodb:UpdateItem", "dynamodb:DeleteItem"
        ],
        "Resource": new_arns,
    })
# Grant s3:GetObject on the snapshots bucket so /admin/snapshot-url can
# mint presigned URLs for serve-snapshot images. Idempotent — only adds
# the statement if it isn't already present.
s3_arns = [
    f"arn:aws:s3:::venuescope-media",
    f"arn:aws:s3:::venuescope-media/*",
]
has_s3 = any(
    any(a.startswith("s3:") for a in (s.get("Action") if isinstance(s.get("Action"), list) else [s.get("Action", "")]))
    for s in doc.get("Statement", [])
)
if not has_s3:
    doc.setdefault("Statement", []).append({
        "Effect": "Allow",
        "Action": ["s3:GetObject"],
        "Resource": s3_arns,
    })
with open('/tmp/new_policy.json', 'w') as f:
    json.dump(doc, f)
print("  ✓ policy patched (DDB test runs + S3 snapshots)")
PY

aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$POLICY_NAME" \
  --policy-document file:///tmp/new_policy.json
echo "  ✓ policy applied"
echo

# ── Lambda code update ───────────────────────────────────────
echo "Packaging + uploading Lambda code..."
cd "$(dirname "$0")/lambda/admin-api"
rm -f lambda.zip

# Wipe any stale node_modules — we ONLY want @aws-sdk/s3-request-presigner
# bundled. Bundling @aws-sdk/client-s3 pulls in @aws-sdk/xml-builder which
# requires @nodable/entities as ESM, and the Lambda runtime CJS loader
# can't import that. The runtime already includes a working client-s3, so
# we let the runtime resolution find it via fallback.
rm -rf node_modules package-lock.json
echo "  installing node deps (presigner only)..."
[ -f package.json ] || npm init -y --silent >/dev/null
npm install @aws-sdk/s3-request-presigner@3.583.0 --silent --no-audit --no-fund --no-save
# Strip any @aws-sdk/client-s3 that may have hitched in as a transitive
# dependency — runtime's version is the source of truth.
rm -rf node_modules/@aws-sdk/client-s3 node_modules/@aws-sdk/xml-builder node_modules/@nodable

zip -qr lambda.zip index.mjs node_modules/
SIZE=$(du -h lambda.zip | cut -f1)
echo "  → packaged lambda.zip ($SIZE)"

aws lambda update-function-code \
  --function-name "$LAMBDA_NAME" \
  --zip-file fileb://lambda.zip \
  --region "$REGION" \
  --query 'LastModified' --output text
echo "  ✓ code uploaded"
cd - >/dev/null
echo

# ── Settle + smoke test ──────────────────────────────────────
echo "Waiting 12s for Lambda to settle..."
sleep 12

echo "Smoke test — GET /admin/test-runs:"
RESP=$(curl -s "${LIVE_API_URL}/admin/test-runs")
echo "  $RESP"
echo

if echo "$RESP" | grep -q '"runs"'; then
  echo "╔══════════════════════════════════════════════════════╗"
  echo "║           DEPLOY COMPLETE — TEST RUNS LIVE          ║"
  echo "║                                                      ║"
  echo "║  Hard-refresh the admin portal (Cmd+Shift+R) and    ║"
  echo "║  click 'New Test Run' on the Worker Tester tab.     ║"
  echo "╚══════════════════════════════════════════════════════╝"
else
  echo "WARN: smoke test didn't return runs JSON — paste output to investigate."
fi
