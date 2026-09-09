"""
ThePornDB REST helpers — scenes & movies search (no hash matching).
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

from .user_settings import load_settings

TPDB_BASE = "https://api.theporndb.net"


def _token() -> str:
    return (load_settings().get("theporndb_api_token") or "").strip()


def _http_json(url: str, token: str, timeout: int = 45) -> dict:
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


def _extract_list(payload: dict) -> List[dict]:
    if not isinstance(payload, dict):
        return []
    data = payload.get("data")
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    return []


def _site_name(raw: dict) -> str:
    site = raw.get("site") or raw.get("studio") or {}
    if isinstance(site, dict):
        return (site.get("name") or site.get("short_name") or "").strip()
    return str(site or "").strip()


def _performer_entries(raw: dict) -> List[dict]:
    out = []
    for p in raw.get("performers") or []:
        if not isinstance(p, dict):
            continue
        parent = p.get("parent") if isinstance(p.get("parent"), dict) else p
        name = (parent.get("name") or p.get("name") or "").strip()
        if not name:
            continue
        gender = (
            parent.get("gender")
            or (parent.get("extras") or {}).get("gender")
            or p.get("gender")
            or ""
        )
        gender = str(gender).strip().lower()
        out.append(
            {
                "id": parent.get("_id") or parent.get("id") or p.get("id"),
                "name": name,
                "gender": gender,
                "image": parent.get("image") or p.get("image") or "",
            }
        )
    return out


def _female_only(performers: List[dict]) -> List[dict]:
    """Keep women; drop explicit male. Unknown gender kept (user can ignore)."""
    filtered = []
    for p in performers:
        g = (p.get("gender") or "").lower()
        if g in ("male", "man", "m"):
            continue
        filtered.append(p)
    return filtered


def _poster(raw: dict) -> str:
    for key in ("poster", "image", "thumbnail"):
        v = raw.get(key)
        if isinstance(v, str) and v:
            return v
        if isinstance(v, dict):
            u = v.get("url") or v.get("full") or v.get("large") or ""
            if u:
                return u
    posters = raw.get("posters") or []
    if isinstance(posters, list) and posters:
        first = posters[0]
        if isinstance(first, str):
            return first
        if isinstance(first, dict):
            return first.get("url") or ""
    return ""



def _trailer(raw: dict) -> str:
    """Extract trailer/stream URL if ThePornDB provides one."""
    for key in ("trailer", "trailer_url", "preview", "video", "media"):
        v = raw.get(key)
        if isinstance(v, str) and v.startswith("http"):
            return v
        if isinstance(v, dict):
            for kk in ("url", "full", "high", "medium", "low", "src"):
                u = v.get(kk)
                if isinstance(u, str) and u.startswith("http"):
                    return u
        if isinstance(v, list):
            for item in v:
                if isinstance(item, str) and item.startswith("http"):
                    return item
                if isinstance(item, dict):
                    u = item.get("url") or item.get("src") or ""
                    if isinstance(u, str) and u.startswith("http"):
                        return u
    # nested extras
    extras = raw.get("extras") if isinstance(raw.get("extras"), dict) else {}
    for key in ("trailer", "trailer_url"):
        v = extras.get(key)
        if isinstance(v, str) and v.startswith("http"):
            return v
    return ""

def normalize_scene(raw: dict, kind: str = "scene") -> dict:
    performers = _performer_entries(raw)
    tags = []
    for t in raw.get("tags") or []:
        if isinstance(t, dict):
            n = (t.get("name") or "").strip()
        else:
            n = str(t).strip()
        if n:
            tags.append(n)
    return {
        "id": raw.get("_id") or raw.get("id") or raw.get("slug") or "",
        "kind": kind,
        "title": (raw.get("title") or raw.get("name") or "").strip(),
        "date": (raw.get("date") or raw.get("release_date") or "").strip(),
        "studio": _site_name(raw),
        "description": (raw.get("description") or raw.get("details") or "").strip(),
        "duration": raw.get("duration") or 0,
        "url": raw.get("url") or "",
        "poster": _poster(raw),
        "trailer": _trailer(raw),
        "performers": performers,
        "performers_female": _female_only(performers),
        "tags": tags,
    }


def filename_parse_query(filename: str, actress: str = "") -> str:
    """Build a TPDB parse/q string from a clip filename + optional actress."""
    stem = Path_stem(filename)
    # strip common junk
    stem = re.sub(r"[_\.]+", " ", stem)
    stem = re.sub(r"\b(xxx|mp4|mkv|1080p|720p|2160p|4k|uhd|hd)\b", " ", stem, flags=re.I)
    stem = re.sub(r"\s+", " ", stem).strip()
    if actress and actress.lower() not in stem.lower():
        stem = f"{actress} {stem}".strip()
    return stem


def Path_stem(filename: str) -> str:
    from pathlib import Path
    return Path(filename).stem


def search_scenes(
    *,
    q: Optional[str] = None,
    parse: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
) -> List[dict]:
    token = _token()
    if not token:
        raise RuntimeError("No ThePornDB API token — set it in Settings.")
    params: Dict[str, Any] = {"page": page, "per_page": per_page}
    if parse:
        params["parse"] = parse
    elif q:
        params["q"] = q
    else:
        return []
    url = f"{TPDB_BASE}/scenes?{urllib.parse.urlencode(params)}"
    try:
        payload = _http_json(url, token)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"ThePornDB scenes HTTP {e.code}") from e
    return [normalize_scene(x, "scene") for x in _extract_list(payload)]


def search_movies(
    *,
    q: Optional[str] = None,
    parse: Optional[str] = None,
    page: int = 1,
    per_page: int = 10,
) -> List[dict]:
    token = _token()
    if not token:
        raise RuntimeError("No ThePornDB API token — set it in Settings.")
    params: Dict[str, Any] = {"page": page, "per_page": per_page}
    if parse:
        params["parse"] = parse
    elif q:
        params["q"] = q
    else:
        return []
    url = f"{TPDB_BASE}/movies?{urllib.parse.urlencode(params)}"
    try:
        payload = _http_json(url, token)
    except urllib.error.HTTPError as e:
        # movies endpoint may 404 on some tokens — soft fail
        if e.code in (404, 400):
            return []
        raise RuntimeError(f"ThePornDB movies HTTP {e.code}") from e
    except Exception:
        return []
    return [normalize_scene(x, "movie") for x in _extract_list(payload)]


def get_scene(scene_id: str, kind: str = "scene") -> Optional[dict]:
    token = _token()
    if not token or not scene_id:
        return None
    path = "movies" if kind == "movie" else "scenes"
    url = f"{TPDB_BASE}/{path}/{urllib.parse.quote(str(scene_id))}"
    try:
        payload = _http_json(url, token)
    except Exception:
        return None
    raw = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(raw, dict):
        raw = payload if isinstance(payload, dict) and payload.get("title") else None
    if not raw:
        return None
    return normalize_scene(raw, kind)


def search_combined(
    query: str,
    *,
    use_parse: bool = True,
    page: int = 1,
) -> Dict[str, Any]:
    q = (query or "").strip()
    if not q:
        return {"results": [], "query": q}
    scenes = search_scenes(parse=q if use_parse else None, q=None if use_parse else q, page=page)
    if not scenes and use_parse:
        scenes = search_scenes(q=q, page=page)
    movies = search_movies(parse=q if use_parse else None, q=None if use_parse else q, page=page)
    if not movies and use_parse:
        movies = search_movies(q=q, page=page)
    # scenes first, then movies; de-dupe by id
    seen = set()
    results = []
    for item in scenes + movies:
        iid = item.get("id") or item.get("title")
        if iid in seen:
            continue
        seen.add(iid)
        results.append(item)
    return {"results": results, "query": q}
