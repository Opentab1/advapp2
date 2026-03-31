"""
VenueScope — Webhook server (port 8502).
Handles Stripe events + venue Tailscale callbacks.
"""
import os, sys, json, logging
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, str(Path(__file__).resolve().parent))

# Load .env
env_file = Path(__file__).resolve().parent / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

from core.billing import handle_webhook

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger("webhook")

PORT         = int(os.environ.get("WEBHOOK_PORT", 8502))
ALERT_EMAIL  = os.environ.get("ALERT_EMAIL_TO", "steph@advizia.ai")
AWS_REGION   = os.environ.get("AWS_REGION", "us-east-2")


def send_email(subject: str, body: str):
    """Send via AWS SES."""
    try:
        import boto3
        client = boto3.client("ses", region_name=AWS_REGION)
        client.send_email(
            Source=ALERT_EMAIL,
            Destination={"ToAddresses": [ALERT_EMAIL]},
            Message={
                "Subject": {"Data": subject},
                "Body":    {"Text": {"Data": body}},
            },
        )
        log.info("Email sent: %s", subject)
    except Exception as e:
        log.error("Email failed: %s", e)


def handle_venue_connected(ip: str, hostname: str, venue: str):
    """Called when a venue's Tailscale setup script phones home."""
    # Save to connections log
    log_file = Path(__file__).resolve().parent / "data" / "configs" / "tailscale_connections.json"
    log_file.parent.mkdir(parents=True, exist_ok=True)
    try:
        connections = json.loads(log_file.read_text()) if log_file.exists() else []
    except Exception:
        connections = []

    import time
    entry = {
        "ip":       ip,
        "hostname": hostname,
        "venue":    venue or hostname,
        "time":     time.time(),
    }
    connections.append(entry)
    log_file.write_text(json.dumps(connections, indent=2))
    log.info("Venue connected: %s @ %s", hostname, ip)

    # Email alert
    import datetime
    ts = datetime.datetime.now().strftime("%b %d %Y at %I:%M %p")
    send_email(
        subject=f"VenueScope — New venue connected: {venue or hostname}",
        body=(
            f"A venue just connected their camera network to VenueScope.\n\n"
            f"Venue:        {venue or hostname}\n"
            f"Tailscale IP: {ip}\n"
            f"Connected at: {ts}\n\n"
            f"Next step: add their cameras in the VenueScope dashboard.\n"
            f"Use {ip} as the IP in their RTSP URLs.\n\n"
            f"Dashboard: https://137-184-61-178.sslip.io"
        ),
    )


class WebhookHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        log.info(fmt % args)

    def do_GET(self):
        parsed = urlparse(self.path)

        # Venue Tailscale callback
        if parsed.path == "/venue-connected":
            params   = parse_qs(parsed.query)
            ip       = params.get("ip",       ["unknown"])[0]
            hostname = params.get("hostname", ["unknown"])[0]
            venue    = params.get("venue",    [""])[0]
            handle_venue_connected(ip, hostname, venue)
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")
            return

        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"VenueScope webhook OK")

    def do_POST(self):
        if self.path != "/webhook":
            self.send_response(404)
            self.end_headers()
            return

        length  = int(self.headers.get("Content-Length", 0))
        payload = self.rfile.read(length)
        sig     = self.headers.get("Stripe-Signature", "")

        try:
            etype = handle_webhook(payload, sig)
            log.info("Stripe event: %s", etype)
            self.send_response(200)
            self.end_headers()
            self.wfile.write(json.dumps({"received": True}).encode())
        except Exception as e:
            log.error("Webhook error: %s", e)
            self.send_response(400)
            self.end_headers()
            self.wfile.write(str(e).encode())


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), WebhookHandler)
    log.info("Webhook server listening on port %d", PORT)
    server.serve_forever()
