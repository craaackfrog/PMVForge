"""
Persisted user settings (paths, defaults, cleanup).
Stored at {config_dir}/settings.json
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Optional

from ..config import (
    get_config_dir,
    DEFAULT_TEMP_DIR,
    DEFAULT_FPS,
    DEFAULT_THREADS,
    DEFAULT_BATCH_SIZE,
    DEFAULT_CLIP_DIST,
    DEFAULT_VOLUME,
)

DEFAULTS: Dict[str, Any] = {
    "temp_dir": DEFAULT_TEMP_DIR,
    "default_output_folder": "",
    "default_cuda": False,
    "default_fps": DEFAULT_FPS,
    "default_threads": DEFAULT_THREADS,
    "default_batch_size": DEFAULT_BATCH_SIZE,
    "default_clip_dist": DEFAULT_CLIP_DIST,
    "default_volume": DEFAULT_VOLUME,
    "default_aspect": "16:9",
    "default_quality": "hd",
    "default_clip_order": "random",
    "default_zoom_to_fill": True,
    "auto_cleanup_after_job": True,
    "cleanup_max_age_hours": 24.0,
    "theporndb_api_token": "",
}


def _path() -> Path:
    return get_config_dir() / "settings.json"


def load_settings() -> Dict[str, Any]:
    data = dict(DEFAULTS)
    p = _path()
    if p.exists():
        try:
            saved = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(saved, dict):
                data.update({k: v for k, v in saved.items() if k in DEFAULTS or k.startswith("default_") or k in (
                    "temp_dir", "default_output_folder", "auto_cleanup_after_job", "cleanup_max_age_hours", "theporndb_api_token",
                )})
        except Exception:
            pass
    return data


def save_settings(patch: Dict[str, Any]) -> Dict[str, Any]:
    data = load_settings()
    for k, v in patch.items():
        data[k] = v
    # normalize
    if data.get("temp_dir"):
        data["temp_dir"] = str(data["temp_dir"]).strip()
    if data.get("default_output_folder") is not None:
        data["default_output_folder"] = str(data["default_output_folder"] or "").strip()
    data["default_cuda"] = bool(data.get("default_cuda"))
    data["auto_cleanup_after_job"] = bool(data.get("auto_cleanup_after_job", True))
    try:
        data["cleanup_max_age_hours"] = float(data.get("cleanup_max_age_hours") or 24)
    except (TypeError, ValueError):
        data["cleanup_max_age_hours"] = 24.0
    _path().write_text(json.dumps(data, indent=2), encoding="utf-8")
    return data


def get_temp_dir_setting() -> Path:
    s = load_settings()
    path = Path(s.get("temp_dir") or DEFAULT_TEMP_DIR)
    path.mkdir(parents=True, exist_ok=True)
    return path
