"""
VenueScope — Structured JSON logging.
Replaces bare print() statements with structured logs compatible with
CloudWatch Logs, Splunk, Datadog, or any JSON log aggregator.
"""
from __future__ import annotations
import logging, json, time, os, sys


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "ts":     time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "level":  record.levelname,
            "logger": record.name,
            "msg":    record.getMessage(),
            "venue":  os.environ.get("VENUESCOPE_VENUE_ID", ""),
        }
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False)


def setup_logging(name: str = "venuescope", level: str = None) -> logging.Logger:
    """
    Configure and return a structured JSON logger.
    Level controlled by VENUESCOPE_LOG_LEVEL env var (default INFO).
    Optional file output via VENUESCOPE_LOG_FILE env var.
    """
    log_level = getattr(
        logging,
        (level or os.environ.get("VENUESCOPE_LOG_LEVEL", "INFO")).upper(),
        logging.INFO,
    )
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger  # already configured

    logger.setLevel(log_level)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonFormatter())
    logger.addHandler(handler)

    log_file = os.environ.get("VENUESCOPE_LOG_FILE", "")
    if log_file:
        fh = logging.FileHandler(log_file)
        fh.setFormatter(_JsonFormatter())
        logger.addHandler(fh)

    logger.propagate = False
    return logger


# Convenience module-level logger
log = setup_logging()
