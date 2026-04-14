# VenueScope Billing System

## Overview
Stripe subscription billing with 14-day free trial, 7-day grace period on failed payment, and paywall on login if access lapses.

## Architecture

### AWS Resources
- **DynamoDB table:** `VenueScopeBilling` (us-east-2) — keyed by `venueId`
- **Lambda functions (BOTH must be deployed on every update):**
  - `VenueScopeAdminAPI` — used by API Gateway `4dh76rm510` (internal/CloudShell tested)
  - `venuescope-admin-api` — used by the Amplify frontend via `VITE_ADMIN_API_URL`
- **API Gateway:** `4dh76rm510` (us-east-2, HTTP API v2)
- **Stripe:** Live mode, product `prod_TXC4gD4gx7abQY`, price `price_1TGldF2fy57lmQh8KloBboE3`

### Lambda IAM Roles
Both Lambda roles need these inline policies:
- `VenueScopeBillingDynamoDB` — DynamoDB CRUD on `VenueScopeBilling` table
- `AmazonDynamoDBFullAccess` managed policy also attached to both roles

### Lambda Env Vars (both functions)
- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_ID`
- `STRIPE_WEBHOOK_SECRET`

Set via `venuescope_envvars.py` uploaded to CloudShell.

## API Routes
All routes are in `lambda/admin-api/index.mjs` and registered in API Gateway:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/billing/status?venueId=` | Get billing status, auto-provisions 14-day trial on first call |
| POST | `/billing/create-checkout` | Create Stripe Checkout session |
| POST | `/billing/portal` | Create Stripe Customer Portal session |
| POST | `/billing/webhook` | Stripe webhook (HMAC-SHA256 verified) |
| POST | `/admin/billing/extend-trial` | Admin: extend trial by N days |

## Frontend Integration
- `src/services/billing.service.ts` — getStatus, refresh, redirectToCheckout, redirectToPortal
- `src/components/billing/PaywallOverlay.tsx` — full-screen paywall + dismissable banner
- `src/pages/VenueScope.tsx` — checks billing on mount, shows paywall if no access
- `src/pages/Settings.tsx` — Billing tab with status, subscribe/manage buttons
- `src/pages/admin/VenuesManagement.tsx` — billing badge per venue + Extend Trial button

## Billing States
| Status | Access | Notes |
|--------|--------|-------|
| `trial` | Yes (if trialEndsAt > now) | 14 days from first login |
| `trial_expired` | No | Shows paywall |
| `active` | Yes | Stripe subscription active |
| `past_due` | Yes (7-day grace) | Payment failed, grace period |
| `cancelled` | No | Shows paywall |

## Deploying Lambda Updates
**Always deploy to BOTH functions.** Use `venuescope_deploy_both.py` in CloudShell:

```python
import boto3, urllib.request
url = 'https://raw.githubusercontent.com/Opentab1/advapp2/main/lambda/admin-api/function.zip'
urllib.request.urlretrieve(url, '/tmp/function.zip')
with open('/tmp/function.zip', 'rb') as f:
    code = f.read()
lam = boto3.client('lambda', region_name='us-east-2')
for func in ['VenueScopeAdminAPI', 'venuescope-admin-api']:
    lam.update_function_code(FunctionName=func, ZipFile=code)
    lam.get_waiter('function_updated').wait(FunctionName=func)
    print(f'{func} done.')
```

After editing `lambda/admin-api/index.mjs`, rebuild the zip locally:
```bash
cd lambda/admin-api && zip -q function.zip index.mjs
```
Then commit, push to both `origin` and `wedid`, then run the deploy script in CloudShell.

## Stripe Webhook
Webhook URL set in Stripe dashboard to:
`https://4dh76rm510.execute-api.us-east-2.amazonaws.com/billing/webhook`

Handled events: `checkout.session.completed`, `customer.subscription.updated`,
`customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`

## Admin: Extend Trial
In the Admin Portal → Venues Management, each venue card has an **Extend Trial** button.
Opens a modal with quick-select (7/14/30/60 days) or custom input. Shows current and new
expiry before confirming. Calls `POST /admin/billing/extend-trial` with `{venueId, days}`.
Extending reactivates `trial_expired` venues back to `trial` status.
