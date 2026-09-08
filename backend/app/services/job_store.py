"""Persistent job store with cancel support."""
from __future__ import annotations
import json, threading, uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
from ..config import get_config_dir

_lock = threading.RLock()
_jobs: Dict[str, dict] = {}
_cancel_flags: Dict[str, threading.Event] = {}

def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"

def _jobs_dir() -> Path:
    d = get_config_dir() / "jobs"
    d.mkdir(parents=True, exist_ok=True)
    return d

def _path(job_id: str) -> Path:
    return _jobs_dir() / f"{job_id}.json"

def _persist(job: dict) -> None:
    try:
        _path(job["job_id"]).write_text(json.dumps(job, indent=2), encoding="utf-8")
    except Exception:
        pass

def load_all() -> None:
    with _lock:
        for p in _jobs_dir().glob("*.json"):
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                jid = data.get("job_id") or p.stem
                data["job_id"] = jid
                if data.get("status") in ("queued", "running"):
                    data["status"] = "error"
                    data["message"] = "Interrupted by backend restart"
                    data["updated_at"] = _now()
                _jobs[jid] = data
                _cancel_flags[jid] = threading.Event()
            except Exception:
                continue

def create_job(extra: Optional[dict] = None) -> dict:
    job_id = str(uuid.uuid4())
    now = _now()
    job = {
        "job_id": job_id, "status": "queued", "progress": 0.0, "message": "Queued",
        "result": None, "created_at": now, "updated_at": now, "elapsed_seconds": None, "cancelled": False,
    }
    if extra:
        job.update(extra)
    with _lock:
        _jobs[job_id] = job
        _cancel_flags[job_id] = threading.Event()
        _persist(job)
    return dict(job)

def get_job(job_id: str) -> Optional[dict]:
    with _lock:
        job = _jobs.get(job_id)
        if job:
            return dict(job)
    p = _path(job_id)
    if p.exists():
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            with _lock:
                _jobs[job_id] = data
                _cancel_flags.setdefault(job_id, threading.Event())
            return dict(data)
        except Exception:
            return None
    return None

def list_jobs(limit: int = 20) -> List[dict]:
    with _lock:
        items = sorted(_jobs.values(), key=lambda j: j.get("created_at") or "", reverse=True)
        return [dict(j) for j in items[:limit]]

def update_job(job_id: str, **fields: Any) -> Optional[dict]:
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return None
        job.update(fields)
        job["updated_at"] = _now()
        _persist(job)
        return dict(job)

def request_cancel(job_id: str) -> Optional[dict]:
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return None
        if job.get("status") in ("finished", "error", "cancelled"):
            return dict(job)
        _cancel_flags.setdefault(job_id, threading.Event()).set()
        job["cancelled"] = True
        job["status"] = "cancelled"
        job["message"] = "Cancelled"
        job["updated_at"] = _now()
        _persist(job)
        return dict(job)

def is_cancelled(job_id: str) -> bool:
    with _lock:
        flag = _cancel_flags.get(job_id)
        if flag and flag.is_set():
            return True
        job = _jobs.get(job_id)
        return bool(job and job.get("cancelled"))

def cancel_checker(job_id: str) -> Callable[[], bool]:
    return lambda: is_cancelled(job_id)
