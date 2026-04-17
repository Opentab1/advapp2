# Forecast Lambda Infrastructure — Architecture Decisions

## Why Container Images, Not Zip Packages

Prophet + pystan compile to ~500 MB installed. AWS Lambda zip limit is 250 MB (uncompressed).
Lambda container images support up to 10 GB — the standard AWS solution for ML workloads.
ECR is free within-region pull; container cold start ~1-2 s vs zip cold start ~500 ms.
Acceptable trade-off given Prophet runs once per shift, not on every request.

## Three Separate Lambda Functions

| Function | Trigger | Memory | Timeout | Why separate |
|---|---|---|---|---|
| `forecast_training` | EventBridge weekly (Sun 02:00 UTC) | 3008 MB | 15 min | Fits full 90-day backfill; Prophet fit is CPU+RAM heavy |
| `forecast_serving` | API Gateway (GET/POST /forecast/tonight) | 1024 MB | 30 s | User-facing; needs fast response; loads pre-fitted model from S3 |
| `kalman_live` | EventBridge every 15 min | 256 MB | 60 s | No Prophet import — numpy only; tiny cold start; blends live actuals into forecast |

## S3 Model Storage

Bucket: `venuescope-media` (existing — no new bucket needed).
Path: `models/forecasts/{venue_id}/prophet-{YYYYMMDD}.pkl`

## DynamoDB Tables

`forecast_models` — keyed (venue_id, trained_at). Stores S3 key + backtest MAPE.
`forecast_live_state` — keyed venue_id. TTL auto-cleans after operating window ends. Stores rolling Kalman state (last alpha, last forecast, last actual).

## API Gateway

HTTP API (v2) — cheaper and lower latency than REST API (v1).
CORS configured at the API level, not in Lambda headers (simpler, avoids double-headers).
Single `$default` stage with AutoDeploy — no manual deploy step after CloudFormation.

## CloudFormation vs Terraform

CloudFormation chosen: no extra tooling, zero state file management, works in CI/CD with `aws cloudformation deploy`.
Everything in one stack — easier to tear down in staging, one-command deploy in prod.

## IAM

Single execution role for all three functions (principle of least privilege still satisfied — only S3 prefix and two DynamoDB tables are in the policy).

## Deployment Flow

```
# 1. Build and push container
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com

docker build -t venuescope-forecast \
  -f infrastructure/forecast/Dockerfile .

docker tag venuescope-forecast:latest \
  123456789012.dkr.ecr.us-east-1.amazonaws.com/venuescope-forecast:latest

docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/venuescope-forecast:latest

# 2. Deploy CloudFormation stack
aws cloudformation deploy \
  --template-file infrastructure/forecast/forecast_stack.yml \
  --stack-name venuescope-forecast-prod \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    Environment=prod \
    EcrImageUri=123456789012.dkr.ecr.us-east-1.amazonaws.com/venuescope-forecast:latest \
    S3Bucket=venuescope-media \
    ForecasterType=prophet \
    EventProvider=stub \
    VenueIds=blindgoat

# 3. Get the API URL
aws cloudformation describe-stacks \
  --stack-name venuescope-forecast-prod \
  --query "Stacks[0].Outputs[?OutputKey=='ForecastApiUrl'].OutputValue" \
  --output text

# 4. Test the endpoint
curl "https://<api-id>.execute-api.us-east-1.amazonaws.com/forecast/tonight?venue_id=blindgoat"

# 5. Trigger a training run manually (before Sunday cron fires)
aws lambda invoke \
  --function-name venuescope-forecast-training-prod \
  --payload '{"venue_id":"blindgoat"}' \
  response.json && cat response.json
```

## React Integration

After deploy, update `src/config.ts` (or `.env.production`):

```
REACT_APP_FORECAST_API_URL=https://<api-id>.execute-api.us-east-1.amazonaws.com
```

Events.tsx calls: `${REACT_APP_FORECAST_API_URL}/forecast/tonight?venue_id=${venueId}`
