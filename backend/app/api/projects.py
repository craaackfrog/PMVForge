"""
Projects & history endpoints (recent jobs, saved settings, etc.).
"""

from fastapi import APIRouter
from pathlib import Path
import json
from datetime import datetime

from ..config import get_config_dir, PROJECT_NAME

router = APIRouter()

HISTORY_FILE = "history.json"


def _history_path() -> Path:
    return get_config_dir() / HISTORY_FILE


def _load_history() -> list:
    path = _history_path()
    if not path.exists():
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _save_history(items: list):
    path = _history_path()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(items, f, indent=2)


@router.get("/history")
async def get_history(limit: int = 20):
    items = _load_history()
    return items[:limit]


@router.post("/history")
async def add_history_entry(entry: dict):
    """
    body example:
    {
      "type": "pmv" | "beatmap",
      "title": "...",
      "artist": "...",
      "output": "path/to/file",
      "meta": {}
    }
    """
    items = _load_history()
    entry["timestamp"] = datetime.utcnow().isoformat() + "Z"
    entry["app"] = PROJECT_NAME
    items.insert(0, entry)
    # keep last 50
    items = items[:50]
    _save_history(items)
    return {"ok": True, "count": len(items)}


@router.delete("/history")
async def clear_history():
    _save_history([])
    return {"ok": True}
