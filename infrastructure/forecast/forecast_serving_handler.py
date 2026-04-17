"""
forecast_serving_handler.py — AWS Lambda entry point for the forecast API.

Triggered by: API Gateway (HTTP API) — GET/POST /forecast/tonight
Env vars required:
  S3_BUCKET      — venuescope-media
  DYNAMODB_TABLE — forecast_models
  FORECASTER     — prophet | gbm (default: prophet)
  EVENT_PROVIDER — stub | ticketmaster | predicthq (default: stub)

Optional env vars:
  TICKETMASTER_API_KEY
  PREDICTHQ_API_KEY
  OPEN_METEO_BASE_URL  (override for testing)
"""
from __future__ import annotations
import json
import logging
import os
import sys
from urllib.parse import parse_qs

# Add venuescope package to path
sys.path.insert(0, "/var/task/venuescope")

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# CORS headers — allow the React Amplify frontend
_CORS_HEADERS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
}


def _build_response(status_code: int, body: dict) -> dict:
    return {
        "statusCode": status_code,
        "headers": {**_CORS_HEADERS, "Content-Type": "application/json"},
        "body": json.dumps(body, default=str),
    }


def handler(event: dict, context) -> dict:
    """Lambda handler for GET/POST /forecast/tonight."""
    logger.info("[serving] event: %s", json.dumps(event, default=str))

    http_method = (event.get("requestContext", {})
                   .get("http", {})
                   .get("method", event.get("httpMethod", "GET")).upper())

    # Handle CORS preflight
    if http_method == "OPTIONS":
        return _build_response(200, {})

    # Parse query string (GET) or body (POST)
    body: dict = {}
    if http_method == "POST":
        raw_body = event.get("body", "{}")
        if isinstance(raw_body, str):
            try:
                body = json.loads(raw_body)
            except json.JSONDecodeError:
                return _build_response(400, {"error": "Invalid JSON body"})
        else:
            body = raw_body or {}
    else:
        # GET — parse query string parameters
        qs = event.get("queryStringParameters") or {}
        body = {k: v for k, v in qs.items() if v is not None}

    try:
        from core.prophet_forecast.forecast_service import handle_request

        path = (event.get("requestContext", {})
                .get("http", {})
                .get("path", "/forecast/tonight"))
        raw_qs = event.get("rawQueryString", "")

        result, status = handle_request(http_method, path, raw_qs, body)
        return _build_response(status, result)

    except Exception as exc:
        logger.error("[serving] Unhandled error: %s", exc, exc_info=True)
        return _build_response(500, {"error": "Internal server error", "detail": str(exc)})
