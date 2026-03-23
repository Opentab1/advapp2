"""
VenueScope — Alert system.
Sends email (AWS SES) and/or webhook notifications for theft detection
and camera health issues.

Required env vars:
  ALERT_EMAIL_TO          — comma-separated recipient emails
  ALERT_EMAIL_FROM        — SES-verified sender address
  ALERT_WEBHOOK_URL       — optional POST webhook (Slack, custom)
  ALERT_UNRUNG_THRESHOLD  — min unrung drinks to trigger alert (default: 5)
  AWS_REGION              — for SES (default: us-east-2)
"""
from __future__ import annotations
import os, json, time
from typing import Dict, Any

ALERT_UNRUNG_THRESHOLD = int(os.environ.get("ALERT_UNRUNG_THRESHOLD", "5"))

# Deduplication: don't re-alert the same job within 1 hour
_alerted_jobs: Dict[str, float] = {}


def _should_alert_theft(summary: Dict[str, Any]) -> bool:
    unrung   = int(summary.get("unrung_drinks", 0) or 0)
    has_flag = bool(summary.get("has_theft_flag"))
    return has_flag or unrung >= ALERT_UNRUNG_THRESHOLD


def _format_theft_message(job_id: str, summary: Dict[str, Any], venue_id: str) -> str:
    unrung    = int(summary.get("unrung_drinks", 0) or 0)
    total     = int(summary.get("total_drinks", 0) or 0)
    clip      = summary.get("clip_label") or job_id
    bartender = summary.get("top_bartender") or "Unknown"
    pct       = round(unrung / max(total, 1) * 100, 1)
    return (
        f"VENUESCOPE THEFT ALERT — {venue_id}\n\n"
        f"Clip:           {clip}\n"
        f"Bartender:      {bartender}\n"
        f"Total drinks:   {total}\n"
        f"Unrung drinks:  {unrung} ({pct}% unrung)\n"
        f"Job ID:         {job_id}\n"
        f"Time:           {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}\n\n"
        f"Review this job in the VenueScope dashboard.\n"
        f"Compare with POS transaction log for this shift.\n"
    )


def send_theft_alert(job_id: str, summary: Dict[str, Any]) -> bool:
    """
    Send theft alert if unrung drinks exceed threshold.
    Deduplicates: won't re-alert the same job within 1 hour.
    Returns True if at least one alert was dispatched.
    """
    if not _should_alert_theft(summary):
        return False

    # Deduplication check
    last = _alerted_jobs.get(job_id, 0)
    if time.time() - last < 3600:
        return False
    _alerted_jobs[job_id] = time.time()

    venue_id = os.environ.get("VENUESCOPE_VENUE_ID", "unknown_venue")
    message  = _format_theft_message(job_id, summary, venue_id)
    sent     = False

    email_to  = os.environ.get("ALERT_EMAIL_TO", "")
    email_from = os.environ.get("ALERT_EMAIL_FROM", "")
    if email_to and email_from:
        sent = _send_ses_email(email_to, email_from, message, venue_id) or sent

    webhook_url = os.environ.get("ALERT_WEBHOOK_URL", "")
    if webhook_url:
        sent = _send_webhook(webhook_url, message, summary, venue_id) or sent

    if not sent:
        _log_alert_locally(job_id, message)
        sent = True  # local log counts as "handled"

    return sent


def send_camera_offline_alert(camera_id: str, camera_label: str, last_seen: float) -> bool:
    """Alert when a camera hasn't reported frames for > CAMERA_OFFLINE_THRESHOLD_SEC."""
    venue_id = os.environ.get("VENUESCOPE_VENUE_ID", "unknown_venue")
    minutes_offline = round((time.time() - last_seen) / 60, 1) if last_seen else "?"
    message = (
        f"VENUESCOPE CAMERA OFFLINE — {venue_id}\n\n"
        f"Camera:       {camera_label} ({camera_id})\n"
        f"Last seen:    {minutes_offline} minutes ago\n"
        f"Time:         {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}\n\n"
        f"Check the camera connection and RTSP stream.\n"
    )
    sent = False
    email_to   = os.environ.get("ALERT_EMAIL_TO", "")
    email_from = os.environ.get("ALERT_EMAIL_FROM", "")
    webhook_url = os.environ.get("ALERT_WEBHOOK_URL", "")
    if email_to and email_from:
        sent = _send_ses_email(email_to, email_from, message, venue_id) or sent
    if webhook_url:
        sent = _send_webhook(webhook_url, message, {}, venue_id) or sent
    if not sent:
        _log_alert_locally(camera_id, message)
    return sent


def _send_ses_email(email_to: str, email_from: str, message: str, venue_id: str) -> bool:
    try:
        import boto3
        ses = boto3.client(
            "ses",
            region_name=os.environ.get("AWS_REGION", "us-east-2"),
            aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
        )
        recipients = [e.strip() for e in email_to.split(",") if e.strip()]
        subject    = f"[VenueScope] Alert — {venue_id}"
        ses.send_email(
            Source=email_from,
            Destination={"ToAddresses": recipients},
            Message={
                "Subject": {"Data": subject},
                "Body":    {"Text": {"Data": message}},
            },
        )
        print(f"[alerts] Email sent to {email_to}", flush=True)
        return True
    except Exception as e:
        print(f"[alerts] SES email failed: {e}", flush=True)
        return False


def _send_webhook(url: str, message: str, summary: Dict[str, Any], venue_id: str) -> bool:
    try:
        import urllib.request
        payload = json.dumps({
            "text":          message,
            "venue_id":      venue_id,
            "unrung_drinks": summary.get("unrung_drinks", 0),
            "total_drinks":  summary.get("total_drinks", 0),
            "timestamp":     time.time(),
        }).encode("utf-8")
        req = urllib.request.Request(
            url, data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status < 300:
                print(f"[alerts] Webhook sent to {url}", flush=True)
                return True
        return False
    except Exception as e:
        print(f"[alerts] Webhook failed: {e}", flush=True)
        return False


def _log_alert_locally(ref_id: str, message: str):
    """Fallback: write alert to ~/.venuescope/alerts.log when email/webhook not configured."""
    try:
        log_dir = os.path.join(os.path.expanduser("~"), ".venuescope")
        os.makedirs(log_dir, exist_ok=True)
        log_path = os.path.join(log_dir, "alerts.log")
        with open(log_path, "a") as f:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {ref_id}\n{message}\n{'='*60}\n")
        print(f"[alerts] Alert logged to {log_path}", flush=True)
    except Exception as e:
        print(f"[alerts] Local alert log failed: {e}", flush=True)
