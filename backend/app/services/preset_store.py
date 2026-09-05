"""
Named modes / presets — bundles Generate + library filters + Cock Hero defaults.
Stored at {config_dir}/presets.json
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..config import get_config_dir

# Built-in modes (read-only id prefix "builtin:")
BUILTIN: List[Dict[str, Any]] = [
    {
        "id": "builtin:classic",
        "name": "Classic PMV",
        "description": "Landscape HD, random cuts, balanced heat.",
        "builtin": True,
        "generate": {
            "aspect": "16:9",
            "quality": "hd",
            "zoom_to_fill": False,
            "face_center": False,
            "clip_order": "random",
            "fps": 30,
            "clip_dist": 0.4,
            "volume": 0,
            "cuda": False,
        },
        "library": {
            "tags": [],
            "tag_mode": "any",
            "min_heat": 1,
            "prefer_library": False,
        },
        "cockhero": {
            "circle_color": "#ff4da6",
            "bar_height_pct": 10,
            "margin_bottom_pct": 4,
            "lookahead": 3,
            "hit_zone_x_pct": 50,
            "circle_radius_pct": 1.8,
            "bar_opacity": 0.55,
            "beat_mode": "full",
            "sound_enabled": True,
            "sound_preset": "tick",
            "sound_volume": 0.7,
        },
    },
    {
        "id": "builtin:vertical-goon",
        "name": "Vertical Goon",
        "description": "9:16, zoom-to-fill, sticky scenes, higher heat.",
        "builtin": True,
        "generate": {
            "aspect": "9:16",
            "quality": "fhd",
            "zoom_to_fill": True,
            "face_center": False,
            "clip_order": "sticky",
            "fps": 30,
            "clip_dist": 0.35,
            "volume": 0,
            "cuda": False,
        },
        "library": {
            "tags": [],
            "tag_mode": "any",
            "min_heat": 3,
            "prefer_library": True,
        },
        "cockhero": {
            "circle_color": "#ff4da6",
            "bar_height_pct": 12,
            "margin_bottom_pct": 5,
            "lookahead": 2.5,
            "hit_zone_x_pct": 50,
            "circle_radius_pct": 2.2,
            "bar_opacity": 0.6,
            "beat_mode": "thinned",
            "sound_enabled": True,
            "sound_preset": "tick",
            "sound_volume": 0.75,
        },
    },
    {
        "id": "builtin:hard-peak",
        "name": "Hard Peak",
        "description": "Hard / penetration tags, chronological, max heat bias.",
        "builtin": True,
        "generate": {
            "aspect": "16:9",
            "quality": "fhd",
            "zoom_to_fill": False,
            "face_center": False,
            "clip_order": "forward",
            "fps": 30,
            "clip_dist": 0.3,
            "volume": 0,
            "cuda": False,
        },
        "library": {
            "tags": ["hard", "penetration"],
            "tag_mode": "any",
            "min_heat": 4,
            "prefer_library": True,
        },
        "cockhero": {
            "circle_color": "#ff2244",
            "bar_height_pct": 11,
            "margin_bottom_pct": 4,
            "lookahead": 2.0,
            "hit_zone_x_pct": 50,
            "circle_radius_pct": 2.0,
            "bar_opacity": 0.65,
            "beat_mode": "full",
            "sound_enabled": True,
            "sound_preset": "kick",
            "sound_volume": 0.8,
        },
    },
    {
        "id": "builtin:babecock",
        "name": "Babecock Worship",
        "description": "babecock / worship tags, sticky, soft-to-hard friendly.",
        "builtin": True,
        "generate": {
            "aspect": "16:9",
            "quality": "hd",
            "zoom_to_fill": False,
            "face_center": False,
            "clip_order": "sticky",
            "fps": 30,
            "clip_dist": 0.45,
            "volume": 0,
            "cuda": False,
        },
        "library": {
            "tags": ["babecock", "worship"],
            "tag_mode": "any",
            "min_heat": 2,
            "prefer_library": True,
        },
        "cockhero": {
            "circle_color": "#c084fc",
            "bar_height_pct": 10,
            "margin_bottom_pct": 4,
            "lookahead": 3.5,
            "hit_zone_x_pct": 50,
            "circle_radius_pct": 1.8,
            "bar_opacity": 0.5,
            "beat_mode": "full",
            "sound_enabled": True,
            "sound_preset": "wood",
            "sound_volume": 0.65,
        },
    },
    {
        "id": "builtin:edge-session",
        "name": "Edge Session",
        "description": "Slower sticky pacing, thinned CH beats for edge-friendly rhythm.",
        "builtin": True,
        "generate": {
            "aspect": "16:9",
            "quality": "hd",
            "zoom_to_fill": False,
            "face_center": False,
            "clip_order": "sticky",
            "fps": 30,
            "clip_dist": 0.55,
            "volume": 0,
            "cuda": False,
        },
        "library": {
            "tags": ["tease", "soft"],
            "tag_mode": "any",
            "min_heat": 1,
            "prefer_library": False,
        },
        "cockhero": {
            "circle_color": "#38bdf8",
            "bar_height_pct": 9,
            "margin_bottom_pct": 4,
            "lookahead": 4.0,
            "hit_zone_x_pct": 50,
            "circle_radius_pct": 1.6,
            "bar_opacity": 0.45,
            "beat_mode": "thinned",
            "sound_enabled": True,
            "sound_preset": "tick",
            "sound_volume": 0.55,
        },
    },
]


def _path() -> Path:
    return get_config_dir() / "presets.json"


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def list_presets() -> List[Dict[str, Any]]:
    data = _load_raw()
    user = list(data.get("presets") or [])
    overrides = data.get("overrides") or {}
    out = []
    seen = set()
    for p in user:
        out.append({**p, "builtin": False})
        seen.add(p["id"])
    for p in BUILTIN:
        if p["id"] not in seen:
            item = dict(p)
            meta = overrides.get(p["id"]) or {}
            if meta.get("name"):
                item["name"] = meta["name"]
            if "description" in meta:
                item["description"] = meta["description"]
            out.append(item)
    return out


def get_preset(preset_id: str) -> Optional[Dict[str, Any]]:
    for p in list_presets():
        if p["id"] == preset_id:
            return p
    return None


def create_preset(payload: Dict[str, Any]) -> Dict[str, Any]:
    name = (payload.get("name") or "Custom").strip() or "Custom"
    preset = {
        "id": str(uuid.uuid4()),
        "name": name,
        "description": (payload.get("description") or "").strip(),
        "builtin": False,
        "generate": dict(payload.get("generate") or {}),
        "library": dict(payload.get("library") or {}),
        "cockhero": dict(payload.get("cockhero") or {}),
        "created_at": _now(),
        "updated_at": _now(),
    }
    user = _load_user()
    user.insert(0, preset)
    _save_user(user)
    return preset


def _load_raw() -> Dict[str, Any]:
    path = _path()
    if not path.exists():
        return {"presets": [], "overrides": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {"presets": [], "overrides": {}}
        data.setdefault("presets", [])
        data.setdefault("overrides", {})
        return data
    except Exception:
        return {"presets": [], "overrides": {}}


def _save_raw(data: Dict[str, Any]) -> None:
    data["updated_at"] = _now()
    _path().write_text(json.dumps(data, indent=2), encoding="utf-8")


def _load_user() -> List[Dict[str, Any]]:
    return list(_load_raw().get("presets") or [])


def _save_user(presets: List[Dict[str, Any]]) -> None:
    data = _load_raw()
    data["presets"] = presets
    _save_raw(data)


def update_preset(preset_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Update a user preset fully, or a built-in's name/description via overrides.
    Full generate/library/cockhero edits on builtins promote a user copy.
    """
    data = _load_raw()
    # User preset?
    for i, p in enumerate(data.get("presets") or []):
        if p["id"] == preset_id:
            for key in ("name", "description", "generate", "library", "cockhero"):
                if key in payload and payload[key] is not None:
                    p[key] = payload[key]
            p["updated_at"] = _now()
            data["presets"][i] = p
            _save_raw(data)
            return {**p, "builtin": False}

    # Built-in
    src = None
    for b in BUILTIN:
        if b["id"] == preset_id:
            src = dict(b)
            break
    if not src:
        raise ValueError("Preset not found")

    has_deep = any(
        k in payload and payload[k] is not None
        for k in ("generate", "library", "cockhero")
    )
    if has_deep:
        # Promote to user preset with edits
        return create_preset({
            "name": payload.get("name") or src["name"],
            "description": payload.get("description") if payload.get("description") is not None else src.get("description"),
            "generate": payload.get("generate") or src.get("generate"),
            "library": payload.get("library") or src.get("library"),
            "cockhero": payload.get("cockhero") or src.get("cockhero"),
        })

    # Meta-only override on builtin
    overrides = data.setdefault("overrides", {})
    meta = dict(overrides.get(preset_id) or {})
    if "name" in payload and payload["name"] is not None:
        meta["name"] = str(payload["name"]).strip() or src["name"]
    if "description" in payload and payload["description"] is not None:
        meta["description"] = str(payload["description"])
    overrides[preset_id] = meta
    data["overrides"] = overrides
    _save_raw(data)
    src["name"] = meta.get("name", src["name"])
    src["description"] = meta.get("description", src.get("description"))
    src["builtin"] = True
    return src


def delete_preset(preset_id: str) -> None:
    if preset_id.startswith("builtin:"):
        raise ValueError("Cannot delete built-in presets")
    user = [p for p in _load_user() if p["id"] != preset_id]
    _save_user(user)


def duplicate_preset(preset_id: str, new_name: Optional[str] = None) -> Dict[str, Any]:
    src = get_preset(preset_id)
    if not src:
        raise ValueError("Preset not found")
    return create_preset({
        "name": new_name or f"{src['name']} (copy)",
        "description": src.get("description") or "",
        "generate": src.get("generate") or {},
        "library": src.get("library") or {},
        "cockhero": src.get("cockhero") or {},
    })
