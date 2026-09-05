"""
Safe cleanup of PMVForge temporary working files.

Never deletes:
  - library metadata (config dir)
  - cockhero session workspaces (needed to re-render / preview)
  - user-chosen output folders outside temp

Does delete:
  - per-job intermediate clip folders (jobs/)
  - cockhero encode work folders (cockhero_work/)
  - staged uploads (uploads/)
  - orphaned intermediates after each finished job
"""

from __future__ import annotations

import os
import shutil
import time
from pathlib import Path
from typing import Iterable, Optional

from ..config import get_temp_dir


def safe_rmtree(path: Path | str, *, ignore_errors: bool = True, retries: int = 5) -> bool:
    """Remove file or directory; retry on Windows locks."""
    p = Path(path)
    if not p.exists():
        return False

    last_err: Optional[Exception] = None
    for attempt in range(max(1, retries)):
        try:
            if p.is_file() or p.is_symlink():
                p.unlink(missing_ok=True)
            else:
                # On Windows, chmod help for read-only bits left by tools
                if os.name == "nt":
                    for root, dirs, files in os.walk(p):
                        for name in files:
                            try:
                                os.chmod(Path(root) / name, 0o666)
                            except OSError:
                                pass
                shutil.rmtree(p, ignore_errors=False)
            return True
        except Exception as e:
            last_err = e
            time.sleep(0.15 * (attempt + 1))
            if not p.exists():
                return True

    if not ignore_errors and last_err:
        raise last_err
    # last attempt: force ignore_errors rmtree
    try:
        if p.exists():
            shutil.rmtree(p, ignore_errors=True)
        return not p.exists()
    except Exception:
        return False


def cleanup_job_work(work_dir: Optional[Path | str]) -> None:
    """Remove a single job intermediate folder (clips, concat lists, etc.)."""
    if not work_dir:
        return
    safe_rmtree(work_dir)


def cleanup_paths(paths: Iterable[Optional[Path | str]]) -> int:
    n = 0
    for p in paths:
        if p and safe_rmtree(p):
            n += 1
    return n


def cleanup_after_pmv_job(
    *,
    work_dir: Optional[Path | str] = None,
    upload_stage: Optional[Path | str] = None,
) -> None:
    cleanup_job_work(work_dir)
    if upload_stage:
        safe_rmtree(upload_stage)


def cleanup_after_ch_job(work_dir: Optional[Path | str] = None) -> None:
    cleanup_job_work(work_dir)


def cleanup_aged(
    *,
    max_age_hours: float = 24.0,
    subdirs: Optional[list[str]] = None,
) -> dict:
    """
    Delete aged entries under temp subfolders.
    Default: jobs, cockhero_work, uploads (not outputs, not cockhero sessions).
    """
    root = get_temp_dir()
    targets = subdirs or ["jobs", "cockhero_work", "uploads"]
    cutoff = time.time() - max(0.0, max_age_hours) * 3600
    removed = 0
    scanned = 0
    for name in targets:
        base = root / name
        if not base.is_dir():
            continue
        for child in list(base.iterdir()):
            scanned += 1
            try:
                mtime = child.stat().st_mtime
            except OSError:
                continue
            if mtime < cutoff and safe_rmtree(child):
                removed += 1
    return {"scanned": scanned, "removed": removed, "max_age_hours": max_age_hours}


def cleanup_all_intermediates(*, include_outputs: bool = False) -> dict:
    """
    Immediately wipe intermediate temp subdirs.
    Optionally also wipe temp/outputs (PMVs written when no output folder was chosen).
    Never touches cockhero session folders.
    """
    root = get_temp_dir()
    targets = ["jobs", "cockhero_work", "uploads"]
    if include_outputs:
        targets.append("outputs")
    removed = 0
    details = {}
    for name in targets:
        base = root / name
        if not base.is_dir():
            details[name] = 0
            continue
        count = 0
        for child in list(base.iterdir()):
            if safe_rmtree(child):
                count += 1
                removed += 1
        details[name] = count
    return {"removed": removed, "details": details, "root": str(root)}


def temp_usage_summary() -> dict:
    """Rough size stats for the temp root (for Settings UI)."""
    root = get_temp_dir()
    summary = {"root": str(root), "exists": root.is_dir(), "folders": {}}
    if not root.is_dir():
        return summary
    total = 0
    for child in root.iterdir():
        size = 0
        files = 0
        try:
            if child.is_file():
                size = child.stat().st_size
                files = 1
            else:
                for p in child.rglob("*"):
                    if p.is_file():
                        try:
                            size += p.stat().st_size
                            files += 1
                        except OSError:
                            pass
        except OSError:
            pass
        total += size
        summary["folders"][child.name] = {
            "bytes": size,
            "mb": round(size / (1024 * 1024), 1),
            "files": files,
        }
    summary["total_bytes"] = total
    summary["total_mb"] = round(total / (1024 * 1024), 1)
    return summary
