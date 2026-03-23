"""
VenueScope — S3 backup module.
Daily backup of SQLite database and config files to S3 (gzipped).

Required env vars:
  S3_BUCKET              — bucket for backups (same as clip bucket)
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  AWS_REGION             (default: us-east-2)
  VENUESCOPE_VENUE_ID    (used as S3 prefix)
"""
from __future__ import annotations
import gzip, io, json, os, time
from pathlib import Path
from typing import Optional

_BACKUP_PREFIX = "venuescope-backups"


def _get_s3():
    import boto3
    return boto3.client(
        "s3",
        region_name=os.environ.get("AWS_REGION", "us-east-2"),
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
    )


def _gzip_file(path: Path) -> bytes:
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
        gz.write(path.read_bytes())
    return buf.getvalue()


def backup_to_s3(db_path: Path, config_dir: Path) -> bool:
    """
    Upload gzipped copies of jobs.db and all config JSON files to S3.
    Returns True if at least the DB was uploaded successfully.
    """
    bucket = os.environ.get("S3_BUCKET", "")
    if not bucket:
        print("[backup] S3_BUCKET not set — skipping backup", flush=True)
        return False

    venue_id = os.environ.get("VENUESCOPE_VENUE_ID", "unknown")
    date_str  = time.strftime("%Y-%m-%d")
    prefix    = f"{_BACKUP_PREFIX}/{venue_id}/{date_str}"

    s3      = _get_s3()
    success = False

    # Backup SQLite DB
    if db_path.exists():
        try:
            data    = _gzip_file(db_path)
            s3_key  = f"{prefix}/jobs.db.gz"
            s3.put_object(Bucket=bucket, Key=s3_key, Body=data,
                          ContentType="application/gzip")
            print(f"[backup] DB backed up to s3://{bucket}/{s3_key}", flush=True)
            success = True
        except Exception as e:
            print(f"[backup] DB backup failed: {e}", flush=True)

    # Backup config JSON files
    if config_dir.exists():
        for cfg_file in config_dir.glob("*.json"):
            try:
                data   = _gzip_file(cfg_file)
                s3_key = f"{prefix}/configs/{cfg_file.name}.gz"
                s3.put_object(Bucket=bucket, Key=s3_key, Body=data,
                              ContentType="application/gzip")
                print(f"[backup] Config backed up: {cfg_file.name}", flush=True)
            except Exception as e:
                print(f"[backup] Config backup failed ({cfg_file.name}): {e}", flush=True)

    # Write backup manifest
    if success:
        try:
            manifest = {
                "venue_id":   venue_id,
                "date":       date_str,
                "timestamp":  time.time(),
                "db_backed":  success,
            }
            s3.put_object(
                Bucket=bucket,
                Key=f"{prefix}/manifest.json",
                Body=json.dumps(manifest, indent=2).encode(),
                ContentType="application/json",
            )
        except Exception:
            pass

    return success


def prune_old_backups(keep_days: int = 30) -> int:
    """Delete backup prefixes older than keep_days. Returns count deleted."""
    bucket = os.environ.get("S3_BUCKET", "")
    if not bucket:
        return 0

    venue_id = os.environ.get("VENUESCOPE_VENUE_ID", "unknown")
    cutoff   = time.time() - keep_days * 86400
    deleted  = 0

    try:
        s3      = _get_s3()
        prefix  = f"{_BACKUP_PREFIX}/{venue_id}/"
        paginator = s3.get_paginator("list_objects_v2")
        to_delete = []

        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                if obj["LastModified"].timestamp() < cutoff:
                    to_delete.append({"Key": obj["Key"]})

        # Delete in batches of 1000
        for i in range(0, len(to_delete), 1000):
            batch = to_delete[i:i + 1000]
            s3.delete_objects(Bucket=bucket, Delete={"Objects": batch})
            deleted += len(batch)

        if deleted:
            print(f"[backup] Pruned {deleted} old backup objects", flush=True)
    except Exception as e:
        print(f"[backup] Prune failed: {e}", flush=True)

    return deleted
