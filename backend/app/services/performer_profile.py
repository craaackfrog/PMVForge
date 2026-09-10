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
    extras = dict(info.get("extras") or {})
    for k in ("ethnicity", "birthplace", "country", "nationality", "birthday", "flag_country", "flag"):
        if info.get(k) and not extras.get(k):
            extras[k] = info.get(k)
    rating = info.get("rating")
    try:
        rating = float(rating) if rating is not None and rating != "" else None
    except (TypeError, ValueError):
        rating = None
    age = info.get("age")
    try:
        age = int(age) if age is not None and age != "" else None
    except (TypeError, ValueError):
        age = None
    return {
        "name": name,
        "bio": (info.get("bio") or info.get("description") or "").strip(),
        "aliases": list(info.get("aliases") or []),
        "image_path": cover,
        "source": "local",
        "tpdb_id": info.get("tpdb_id") or info.get("id"),
        "query": info.get("query") or name,
        "extras": extras,
        "rating": rating,
        "age": age,
        "cached": True,
        "override": True,
        "found": True,
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
    paths: List[str] = []
    primary = d / "image.jpg"
    if primary.is_file():
        paths.append(str(primary.resolve()))
    else:
        for ext in (".png", ".webp", ".jpeg"):
            alt = d / f"image{ext}"
            if alt.is_file():
                paths.append(str(alt.resolve()))
                break
    # gallery frames image_1.jpg …
    for i in range(1, 16):
        f = d / f"image_{i}.jpg"
        if f.is_file():
            paths.append(str(f.resolve()))
    # also accept image_0 if primary missing
    z = d / "image_0.jpg"
    if z.is_file() and str(z.resolve()) not in paths:
        paths.insert(0, str(z.resolve()))
    if paths:
        fav = data.get("favorite_image")
        if fav:
            try:
                fav_r = str(Path(fav).resolve())
            except Exception:
                fav_r = fav
            if fav_r in paths:
                paths = [fav_r] + [x for x in paths if x != fav_r]
            elif Path(str(fav)).is_file():
                paths = [str(Path(fav).resolve())] + paths
        data["image_path"] = paths[0]
        data["image_paths"] = paths
    data["cached"] = True
    data["source"] = data.get("source") or "cache"
    data["override"] = False
    return data


def _save_cache(key: str, data: dict, image_url: Optional[str], token: Optional[str]) -> dict:
    d = _cache_dir(key)
    urls = list(data.get("image_urls") or [])
    if image_url and image_url not in urls:
        urls = [image_url] + urls
    # Cap gallery size
    urls = urls[:12]
    out = {
        "name": data.get("name") or "",
        "bio": data.get("bio") or "",
        "aliases": list(data.get("aliases") or []),
        "tpdb_id": data.get("tpdb_id") or data.get("id"),
        "query": data.get("query") or data.get("name") or "",
        "extras": dict(data.get("extras") or {}),
        "rating": data.get("rating"),
        "source": "theporndb",
        "image_url": (urls[0] if urls else "") or image_url or data.get("image_url") or "",
        "image_urls": urls,
    }
    image_paths: List[str] = []
    for i, u in enumerate(urls):
        dest = d / (f"image_{i}.jpg" if i else "image.jpg")
        if _download_image(u, dest, token=token):
            image_paths.append(str(dest.resolve()))
    if image_paths:
        out["image_path"] = image_paths[0]
        out["image_paths"] = image_paths
    (d / "profile.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    out["cached"] = True
    out["override"] = False
    return out


def _extract_url(val) -> str:
    if not val:
        return ""
    if isinstance(val, dict):
        return str(val.get("url") or val.get("full") or val.get("large") or val.get("medium") or "")
    return str(val)


def _collect_image_urls(raw: dict) -> List[str]:
    """Primary + posters/face/thumbnail, de-duplicated, order preserved."""
    urls: List[str] = []
    seen = set()

    def add(u: str):
        u = (u or "").strip()
        if not u or u in seen:
            return
        seen.add(u)
        urls.append(u)

    for key in ("image", "face", "thumbnail"):
        add(_extract_url(raw.get(key)))
    posters = raw.get("posters") or raw.get("images") or []
    if isinstance(posters, dict):
        for v in posters.values():
            add(_extract_url(v))
    elif isinstance(posters, list):
        for p in posters:
            add(_extract_url(p))
    return urls


def _normalize_tpdb_performer(raw: dict, query: str) -> dict:
    extras = raw.get("extras") if isinstance(raw.get("extras"), dict) else {}
    image_urls = _collect_image_urls(raw)
    image = image_urls[0] if image_urls else ""
    aliases = raw.get("aliases") or []
    if isinstance(aliases, str):
        aliases = [aliases]
    bio = raw.get("bio") or raw.get("description") or extras.get("biography") or ""
    rating = raw.get("rating")
    try:
        rating = float(rating) if rating is not None and rating != "" else None
    except (TypeError, ValueError):
        rating = None
    # Keep only display-relevant extras (race + place); measurements intentionally omitted
    slim_extras = {}
    for k in ("ethnicity", "country", "birthplace", "nationality", "birthday", "flag_country", "flag"):
        if extras.get(k):
            slim_extras[k] = extras.get(k)
    return {
        "name": raw.get("name") or raw.get("full_name") or query,
        "bio": (bio or "").strip(),
        "aliases": list(aliases),
        "tpdb_id": raw.get("_id") or raw.get("id") or raw.get("slug"),
        "query": query,
        "rating": rating,
        "extras": slim_extras,
        "image_url": image,
        "image_urls": image_urls,
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




def save_performer_edit(lib_id: str, payload: dict) -> dict:
    """
    Edit the existing on-disk profile JSON in place.

    Priority:
      1. {library_root}/info.json  — if it already exists
      2. {config}/performer_cache/{slug}/profile.json — the cached ThePornDB profile

    Does not create a separate "override layer"; merges into the file already in use.
    """
    lib = lib_store.load_library(lib_id)
    if not lib:
        raise ValueError("Library not found")
    root = Path(lib.root_path)
    query_name = lib.name or (root.name if root.exists() else lib_id)
    key = _slug(query_name)

    info_path = root / "info.json" if root.is_dir() else None
    cache_path = _cache_dir(key) / "profile.json"

    if info_path and info_path.is_file():
        target = info_path
        kind = "info.json"
    elif cache_path.is_file():
        target = cache_path
        kind = "cache"
    else:
        # No file yet — create cache profile so edits persist
        target = cache_path
        kind = "cache"

    existing: dict = {}
    if target.is_file():
        try:
            existing = json.loads(target.read_text(encoding="utf-8"))
            if not isinstance(existing, dict):
                existing = {}
        except Exception:
            existing = {}

    extras = dict(existing.get("extras") or {})
    extras_in = payload.get("extras") if isinstance(payload.get("extras"), dict) else {}
    for k in ("ethnicity", "birthplace", "country", "nationality", "birthday", "flag_country", "flag"):
        if k in extras_in:
            v = extras_in.get(k)
            if v is None or str(v).strip() == "":
                extras.pop(k, None)
            else:
                extras[k] = str(v).strip()
        elif k in payload:
            v = payload.get(k)
            if v is None or str(v).strip() == "":
                extras.pop(k, None)
            else:
                extras[k] = str(v).strip()

    aliases = payload.get("aliases") if "aliases" in payload else existing.get("aliases") or []
    if isinstance(aliases, str):
        aliases = [a.strip() for a in aliases.split(",") if a.strip()]
    else:
        aliases = [str(a).strip() for a in (aliases or []) if str(a).strip()]

    def _num(val, cast):
        if val is None or val == "":
            return None
        try:
            return cast(val)
        except (TypeError, ValueError):
            return None

    rating = _num(payload["rating"], float) if "rating" in payload else existing.get("rating")
    age = _num(payload["age"], int) if "age" in payload else existing.get("age")

    data = dict(existing)
    if "name" in payload and payload.get("name") is not None:
        data["name"] = str(payload.get("name") or "").strip() or data.get("name") or query_name
    if "bio" in payload and payload.get("bio") is not None:
        data["bio"] = str(payload.get("bio") or "").strip()
    data["aliases"] = aliases
    data["extras"] = extras
    data["query"] = data.get("query") or query_name
    if rating is not None:
        data["rating"] = rating
    elif "rating" in payload:
        data.pop("rating", None)
    if age is not None:
        data["age"] = age
    elif "age" in payload:
        data.pop("age", None)
    if payload.get("tpdb_id"):
        data["tpdb_id"] = payload.get("tpdb_id")
    data["source"] = existing.get("source") or ("local" if kind == "info.json" else "cache")
    data["user_edited"] = True

    # Keep image paths already on disk
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    out = get_profile_for_library(lib_id, force_refresh=False)
    out["edited_path"] = str(target.resolve())
    out["edited_kind"] = kind
    return out


def clear_local_override(lib_id: str) -> dict:
    """Compatibility: remove library-root info.json if present."""
    lib = lib_store.load_library(lib_id)
    if not lib:
        raise ValueError("Library not found")
    root = Path(lib.root_path)
    info_path = root / "info.json"
    if info_path.is_file():
        info_path.unlink()
    return get_profile_for_library(lib_id, force_refresh=False)



def save_local_override(lib_id: str, payload: dict) -> dict:
    """Deprecated name — edits existing JSON in place."""
    return save_performer_edit(lib_id, payload)


def set_favorite_image(lib_id: str, image_path: str) -> dict:
    """Mark one cached gallery image as primary (shown first on card)."""
    lib = lib_store.load_library(lib_id)
    if not lib:
        raise ValueError("Library not found")
    root = Path(lib.root_path)
    query_name = lib.name or (root.name if root.exists() else lib_id)
    key = _slug(query_name)
    d = _cache_dir(key)
    profile_path = d / "profile.json"
    if not profile_path.is_file():
        raise ValueError("No cached performer profile to update")
    try:
        data = json.loads(profile_path.read_text(encoding="utf-8"))
    except Exception as e:
        raise ValueError(f"Bad profile.json: {e}") from e
    if not isinstance(data, dict):
        raise ValueError("Bad profile.json")

    target = str(Path(image_path).resolve())
    # Collect existing gallery paths
    paths = []
    for i, name in enumerate(["image.jpg"] + [f"image_{i}.jpg" for i in range(1, 16)]):
        f = d / name
        if f.is_file():
            paths.append(str(f.resolve()))
    # also honor listed image_paths
    for pth in data.get("image_paths") or []:
        try:
            rp = str(Path(pth).resolve())
        except Exception:
            rp = pth
        if rp not in paths and Path(rp).is_file():
            paths.append(rp)

    if target not in paths and Path(target).is_file() and target.startswith(str(d.resolve())):
        paths.append(target)
    if target not in paths:
        raise ValueError("Image is not part of this performer gallery")

    # Reorder: favorite first
    ordered = [target] + [x for x in paths if x != target]
    data["image_paths"] = ordered
    data["image_path"] = target
    data["favorite_image"] = target
    data["user_edited"] = True

    # Make image.jpg a copy of favorite for simple loaders
    fav = Path(target)
    primary = d / "image.jpg"
    if fav.resolve() != primary.resolve():
        try:
            primary.write_bytes(fav.read_bytes())
            data["image_path"] = str(primary.resolve())
            # keep favorite path as preferred display if different files
            ordered = [str(primary.resolve())] + [x for x in ordered if Path(x).resolve() != primary.resolve()]
            data["image_paths"] = ordered
        except Exception:
            pass

    profile_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    out = get_profile_for_library(lib_id, force_refresh=False)
    out["favorite_image"] = data.get("favorite_image")
    return out


def summary_for_library(lib_id: str = None, name: str = None) -> dict:
    """Lightweight performer fields for library list filtering (from cache/override only)."""
    lib = lib_store.load_library(lib_id) if lib_id else None
    label = (lib.name if lib else None) or name or ""
    if not label and lib:
        label = Path(lib.root_path).name
    key = _slug(label)
    cached = _load_cache(key)
    if not cached and lib:
        local = _read_local_override(Path(lib.root_path))
        if local:
            cached = local
    if not cached:
        return {}
    extras = cached.get("extras") or {}
    return {
        "ethnicity": extras.get("ethnicity") or "",
        "birthplace": extras.get("birthplace") or "",
        "flag_country": extras.get("flag_country") or extras.get("flag") or "",
        "country": extras.get("country") or extras.get("flag_country") or "",
        "rating": cached.get("rating"),
        "age": cached.get("age"),
        "name": cached.get("name") or label,
    }

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
