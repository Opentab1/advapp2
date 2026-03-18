"""
VenueScope — Job runner (Streamlit side).
Streamlit does NOT spawn the worker. The worker_daemon.py process runs
separately and polls the DB. This module just submits jobs to the DB
and reads progress back from it.
"""
from __future__ import annotations
from core.database import get_job, _raw_update


def get_runner():
    import streamlit as st
    if "job_runner" not in st.session_state:
        st.session_state["job_runner"] = _DBRunner()
    return st.session_state["job_runner"]


class _DBRunner:
    def submit(self, job_id: str):
        _raw_update(job_id, status="pending", progress=0.0,
                    error_msg=None, finished_at=None)

    def poll(self, job_id: str) -> list:
        job = get_job(job_id)
        if not job:
            return [("error", 0, "Job not found")]
        status   = job.get("status", "pending")
        progress = float(job.get("progress") or 0)
        error    = job.get("error_msg", "")
        if status == "done":
            return [("progress", 100, "Complete")]
        elif status == "failed":
            return [("error", 0, error or "Job failed")]
        elif status == "running":
            return [("progress", progress, f"Processing… {progress:.0f}%")]
        else:
            return [("progress", 0, "Queued — waiting for worker")]

    def is_alive(self, job_id: str) -> bool:
        job = get_job(job_id)
        if not job:
            return False
        return job.get("status") in ("pending", "running")
