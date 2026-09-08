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


PROJECTS_FILE = "projects.json"


def _projects_path() -> Path:
    return get_config_dir() / PROJECTS_FILE


def _load_projects() -> list:
    path = _projects_path()
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_projects(items: list):
    _projects_path().write_text(json.dumps(items, indent=2), encoding="utf-8")


@router.get("/saved")
async def list_projects(limit: int = 50):
    return _load_projects()[:limit]


@router.post("/saved")
async def save_project(entry: dict):
    """Save a named generate draft / project snapshot."""
    items = _load_projects()
    entry = dict(entry)
    entry["timestamp"] = datetime.utcnow().isoformat() + "Z"
    entry["app"] = PROJECT_NAME
    if not entry.get("id"):
        import uuid
        entry["id"] = str(uuid.uuid4())
    items = [i for i in items if i.get("id") != entry["id"]]
    items.insert(0, entry)
    items = items[:40]
    _save_projects(items)
    return {"ok": True, "project": entry}


@router.delete("/saved/{project_id}")
async def delete_project(project_id: str):
    items = [i for i in _load_projects() if i.get("id") != project_id]
    _save_projects(items)
    return {"ok": True}
