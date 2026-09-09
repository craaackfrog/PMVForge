"""
Performer profile for Clip Libraries.

Resolution order:
  1. Local override in the library root folder (cover.* + info.json)
  2. On-disk cache under {config}/performer_cache/{key}/
  3. ThePornDB API (token from settings) — result is cached for next time

Local override files (optional, inside the library root_path):
  cover.jpg / cover.png / cover.webp
  info.json  → { "name", "bio", "aliases", "image" (optional path/url), "query" }
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..config import get_config_dir
from .user_settings import load_settings
from . import library_store as lib_store

TPDB_BASE = "https://api.theporndb.net"
COVER_NAMES = ("cover.jpg", "cover.jpeg", "cover.png", "cover.webp", "folder.jpg", "poster.jpg")


def _slug(name: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", (name or "").strip().lower()).strip("-")
    return s or "unknown"


def _cache_dir(key: str) -> Path:
    d = get_config_dir() / "performer_cache" / key
    d.mkdir(parents=True, exist_ok=True)
    return d


def _http_json(url: str, token: str, timeout: int = 30) -> dict:
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": "PMVForge/0.2",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def _download_image(url: str, dest: Path, token: Optional[str] = None, timeout: int = 60) -> bool:
    if not url:
        return False
    headers = {"User-Agent": "PMVForge/0.2"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        req = urllib.request.Request(url, headers=headers, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read()
        if not data:
            return False
        dest.write_bytes(data)
        return dest.exists() and dest.stat().st_size > 0
    except Exception:
        return False


def _read_local_override(root: Path) -> Optional[dict]:
    if not root.is_dir():
        return None
    info_path = root / "info.json"
    info: dict = {}
    if info_path.is_file():
        try:
            info = json.loads(info_path.read_text(encoding="utf-8"))
            if not isinstance(info, dict):
                info = {}
        except Exception:
            info = {}

    cover = None
    for name in COVER_NAMES:
        p = root / name
        if p.is_file():
            cover = str(p.resolve())
            break
    # explicit image path in info.json
    if info.get("image"):
        img = Path(str(info["image"]))
        if not img.is_absolute():
            img = root / img
        if img.is_file():
            cover = str(img.resolve())

    if not info and not cover:
        return None

    name = (info.get("name") or root.name or "").strip()
    return {
        "name": name,
        "bio": (info.get("bio") or info.get("description") or "").strip(),
        "aliases": list(info.get("aliases") or []),
        "image_path": cover,
        "source": "local",
        "tpdb_id": info.get("tpdb_id") or info.get("id"),
        "query": info.get("query") or name,
        "extras": dict(info.get("extras") or {}),
        "cached": True,
        "override": True,
    }


def _load_cache(key: str) -> Optional[dict]:
    d = _cache_dir(key)
    profile = d / "profile.json"
    if not profile.is_file():
        return None
    try:
        data = json.loads(profile.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    img = d / "image.jpg"
    if not img.is_file():
        # try other extensions
        for ext in (".png", ".webp", ".jpeg"):
            alt = d / f"image{ext}"
            if alt.is_file():
                img = alt
                break
    if img.is_file():
        data["image_path"] = str(img.resolve())
    data["cached"] = True
    data["source"] = data.get("source") or "cache"
    data["override"] = False
    return data


def _save_cache(key: str, data: dict, image_url: Optional[str], token: Optional[str]) -> dict:
    d = _cache_dir(key)
    out = {
        "name": data.get("name") or "",
        "bio": data.get("bio") or "",
        "aliases": list(data.get("aliases") or []),
        "tpdb_id": data.get("tpdb_id") or data.get("id"),
        "query": data.get("query") or data.get("name") or "",
        "extras": dict(data.get("extras") or {}),
        "source": "theporndb",
        "image_url": image_url or data.get("image_url") or "",
    }
    img_path = d / "image.jpg"
    if image_url:
        if _download_image(image_url, img_path, token=token):
            out["image_path"] = str(img_path.resolve())
    (d / "profile.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    out["cached"] = True
    out["override"] = False
    return out


def _normalize_tpdb_performer(raw: dict, query: str) -> dict:
    extras = raw.get("extras") if isinstance(raw.get("extras"), dict) else {}
    # some responses nest image differently
    image = raw.get("image") or raw.get("thumbnail") or ""
    if isinstance(image, dict):
        image = image.get("url") or image.get("full") or image.get("large") or ""
    aliases = raw.get("aliases") or []
    if isinstance(aliases, str):
        aliases = [aliases]
    bio = raw.get("bio") or raw.get("description") or extras.get("biography") or ""
    return {
        "name": raw.get("name") or raw.get("full_name") or query,
        "bio": (bio or "").strip(),
        "aliases": list(aliases),
        "tpdb_id": raw.get("_id") or raw.get("id") or raw.get("slug"),
        "query": query,
        "extras": {
            k: extras.get(k)
            for k in (
                "gender",
                "birthday",
                "birthplace",
                "ethnicity",
                "country",
                "height",
                "measurements",
                "cupsize",
                "tattoos",
                "piercings",
                "hair_colour",
                "eye_colour",
                "career_start_year",
                "career_end_year",
            )
            if extras.get(k)
        },
        "image_url": image,
        "source": "theporndb",
    }


def fetch_from_tpdb(query: str, token: str) -> Optional[dict]:
    q = (query or "").strip()
    if not q or not token:
        return None
    url = f"{TPDB_BASE}/performers?q={urllib.parse.quote(q)}&page=1&per_page=5"
    try:
        payload = _http_json(url, token)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"ThePornDB HTTP {e.code}: {e.reason}") from e
    except Exception as e:
        raise RuntimeError(f"ThePornDB request failed: {e}") from e

    items = payload.get("data") if isinstance(payload, dict) else None
    if not items:
        return None
    # Prefer exact / close name match
    q_low = q.lower()
    best = items[0]
    for it in items:
        name = (it.get("name") or it.get("full_name") or "").lower()
        if name == q_low:
            best = it
            break
    # Optional detail fetch when slug/id present
    ident = best.get("_id") or best.get("id") or best.get("slug")
    if ident:
        try:
            detail = _http_json(f"{TPDB_BASE}/performers/{urllib.parse.quote(str(ident))}", token)
            if isinstance(detail, dict) and detail.get("data"):
                best = detail["data"]
            elif isinstance(detail, dict) and detail.get("name"):
                best = detail
        except Exception:
            pass
    return _normalize_tpdb_performer(best, q)


def get_profile_for_library(lib_id: str, *, force_refresh: bool = False) -> dict:
    """
    Resolve performer profile for a clip library.
    Returns a dict always (may have found=False).
    """
    lib = lib_store.load_library(lib_id)
    if not lib:
        raise ValueError("Library not found")

    root = Path(lib.root_path)
    query_name = lib.name or root.name

    # 1) Local override always wins (unless force_refresh only for network)
    local = _read_local_override(root)
    if local and not force_refresh:
        local["found"] = True
        local["library_id"] = lib_id
        return local

    key = _slug(query_name)

    # 2) Cache
    if not force_refresh:
        cached = _load_cache(key)
        if cached and (cached.get("name") or cached.get("image_path")):
            cached["found"] = True
            cached["library_id"] = lib_id
            return cached

    # 3) ThePornDB
    token = (load_settings().get("theporndb_api_token") or "").strip()
    if not token:
        result = {
            "found": False,
            "library_id": lib_id,
            "name": query_name,
            "bio": "",
            "aliases": [],
            "image_path": None,
            "source": "none",
            "error": "No ThePornDB API token — set it in Settings, or add cover.jpg + info.json in the library folder.",
            "cached": False,
            "override": False,
            "query": query_name,
        }
        if local:
            # force_refresh with local available
            local["found"] = True
            local["library_id"] = lib_id
            return local
        return result

    try:
        remote = fetch_from_tpdb(query_name, token)
    except Exception as e:
        # fall back to cache/local on error
        if local:
            local["found"] = True
            local["library_id"] = lib_id
            local["error"] = str(e)
            return local
        cached = _load_cache(key)
        if cached:
            cached["found"] = True
            cached["library_id"] = lib_id
            cached["error"] = str(e)
            return cached
        return {
            "found": False,
            "library_id": lib_id,
            "name": query_name,
            "bio": "",
            "aliases": [],
            "image_path": None,
            "source": "none",
            "error": str(e),
            "cached": False,
            "override": False,
            "query": query_name,
        }

    if not remote:
        return {
            "found": False,
            "library_id": lib_id,
            "name": query_name,
            "bio": "",
            "aliases": [],
            "image_path": None,
            "source": "theporndb",
            "error": f"No performer match for “{query_name}”",
            "cached": False,
            "override": False,
            "query": query_name,
        }

    saved = _save_cache(key, remote, remote.get("image_url"), token)
    saved["found"] = True
    saved["library_id"] = lib_id
    return saved


def media_path_allowed(path: str) -> bool:
    """True if path is under performer_cache or a library root cover."""
    try:
        target = str(Path(path).resolve())
    except Exception:
        return False
    cache_root = str((get_config_dir() / "performer_cache").resolve())
    if target.startswith(cache_root):
        return True
    # library covers
    for e in lib_store.list_libraries():
        lib = lib_store.load_library(e["id"])
        if not lib:
            continue
        root = Path(lib.root_path)
        try:
            root_s = str(root.resolve())
        except Exception:
            root_s = lib.root_path
        if target.startswith(root_s.rstrip("\\/") + "\\") or target.startswith(root_s.rstrip("\\/") + "/"):
            name = Path(target).name.lower()
            if name in COVER_NAMES or name.startswith("cover."):
                return True
            if Path(target).parent == root or Path(target).parent == Path(root_s):
                # info-declared images in root
                return True
    return False
