"""
Source libraries — folders of clips with tags + heat ranking.

Metadata lives under the app config dir so it survives temp cleans:
  {config}/libraries/index.json
  {config}/libraries/{id}.json
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Set

from ..config import get_config_dir, PROJECT_NAME

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".wmv", ".m4v", ".mpg", ".mpeg", ".flv"}

# Starter vocabulary — user can add more
DEFAULT_TAGS = [
    "tease",
    "soft",
    "hard",
    "oral",
    "penetration",
    "cum",
    "face",
    "solo",
    "group",
    "babecock",
    "worship",
    "pov",
    "ass",
    "tits",
]


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _lib_dir() -> Path:
    d = get_config_dir() / "libraries"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _index_path() -> Path:
    return _lib_dir() / "index.json"


def _lib_path(lib_id: str) -> Path:
    return _lib_dir() / f"{lib_id}.json"


@dataclass
class ClipMeta:
    path: str
    tags: List[str] = field(default_factory=list)
    heat: int = 3  # 1–5
    duration: float = 0.0
    width: int = 0
    height: int = 0
    size: int = 0
    mtime: float = 0.0
    name: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    @staticmethod
    def from_dict(d: dict) -> "ClipMeta":
        return ClipMeta(
            path=d["path"],
            tags=list(d.get("tags") or []),
            heat=int(d.get("heat") or 3),
            duration=float(d.get("duration") or 0),
            width=int(d.get("width") or 0),
            height=int(d.get("height") or 0),
            size=int(d.get("size") or 0),
            mtime=float(d.get("mtime") or 0),
            name=d.get("name") or Path(d["path"]).name,
        )


@dataclass
class Library:
    id: str
    name: str
    root_path: str
    recurse: bool = True
    tags_vocab: List[str] = field(default_factory=list)
    clips: Dict[str, dict] = field(default_factory=dict)  # path -> ClipMeta dict
    created_at: str = ""
    updated_at: str = ""
    last_scan_at: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "root_path": self.root_path,
            "recurse": self.recurse,
            "tags_vocab": self.tags_vocab,
            "clips": self.clips,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "last_scan_at": self.last_scan_at,
            "clip_count": len(self.clips),
        }

    @staticmethod
    def from_dict(d: dict) -> "Library":
        return Library(
            id=d["id"],
            name=d.get("name") or "Library",
            root_path=d["root_path"],
            recurse=bool(d.get("recurse", True)),
            tags_vocab=list(d.get("tags_vocab") or DEFAULT_TAGS),
            clips=dict(d.get("clips") or {}),
            created_at=d.get("created_at") or "",
            updated_at=d.get("updated_at") or "",
            last_scan_at=d.get("last_scan_at"),
        )


def _load_index() -> List[dict]:
    p = _index_path()
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_index(entries: List[dict]) -> None:
    _index_path().write_text(json.dumps(entries, indent=2), encoding="utf-8")


def list_libraries() -> List[dict]:
    out = []
    for e in _load_index():
        lib = load_library(e["id"])
        if lib:
            out.append({
                "id": lib.id,
                "name": lib.name,
                "root_path": lib.root_path,
                "recurse": lib.recurse,
                "clip_count": len(lib.clips),
                "tags_vocab": lib.tags_vocab,
                "updated_at": lib.updated_at,
                "last_scan_at": lib.last_scan_at,
            })
    return out


def load_library(lib_id: str) -> Optional[Library]:
    p = _lib_path(lib_id)
    if not p.exists():
        return None
    try:
        return Library.from_dict(json.loads(p.read_text(encoding="utf-8")))
    except Exception:
        return None


def save_library(lib: Library) -> None:
    lib.updated_at = _now()
    _lib_path(lib.id).write_text(json.dumps(lib.to_dict(), indent=2), encoding="utf-8")
    # keep index in sync
    idx = _load_index()
    found = False
    for e in idx:
        if e["id"] == lib.id:
            e["name"] = lib.name
            e["root_path"] = lib.root_path
            e["updated_at"] = lib.updated_at
            found = True
            break
    if not found:
        idx.append({
            "id": lib.id,
            "name": lib.name,
            "root_path": lib.root_path,
            "created_at": lib.created_at,
            "updated_at": lib.updated_at,
        })
    _save_index(idx)


def create_library(name: str, root_path: str, recurse: bool = True) -> Library:
    root = Path(root_path)
    if not root.is_dir():
        raise ValueError(f"Folder not found: {root_path}")
    lib = Library(
        id=str(uuid.uuid4()),
        name=name or root.name,
        root_path=str(root.resolve()),
        recurse=recurse,
        tags_vocab=list(load_global_tags()),
        created_at=_now(),
        updated_at=_now(),
    )
    save_library(lib)
    return lib


def delete_library(lib_id: str) -> bool:
    p = _lib_path(lib_id)
    if p.exists():
        p.unlink()
    idx = [e for e in _load_index() if e["id"] != lib_id]
    _save_index(idx)
    return True


def _probe_quick(path: Path) -> dict:
    """Lightweight probe — duration/size; skip heavy ffprobe on every file if slow."""
    info = {
        "duration": 0.0,
        "width": 0,
        "height": 0,
        "size": path.stat().st_size if path.exists() else 0,
        "mtime": path.stat().st_mtime if path.exists() else 0,
    }
    try:
        import subprocess
        r = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height",
                "-show_entries", "format=duration",
                "-of", "json", str(path),
            ],
            capture_output=True, text=True, timeout=20,
        )
        if r.returncode == 0 and r.stdout:
            data = json.loads(r.stdout)
            if data.get("streams"):
                info["width"] = int(data["streams"][0].get("width") or 0)
                info["height"] = int(data["streams"][0].get("height") or 0)
            if data.get("format", {}).get("duration"):
                info["duration"] = float(data["format"]["duration"])
    except Exception:
        pass
    return info


def scan_library(lib_id: str, progress_cb=None) -> Library:
    lib = load_library(lib_id)
    if not lib:
        raise ValueError("Library not found")
    root = Path(lib.root_path)
    if not root.is_dir():
        raise ValueError(f"Root missing: {lib.root_path}")

    files: List[Path] = []
    if lib.recurse:
        for ext in VIDEO_EXTS:
            files.extend(root.rglob(f"*{ext}"))
            files.extend(root.rglob(f"*{ext.upper()}"))
    else:
        for f in root.iterdir():
            if f.is_file() and f.suffix.lower() in VIDEO_EXTS:
                files.append(f)

    # unique by resolved path
    seen: Set[str] = set()
    unique: List[Path] = []
    for f in files:
        try:
            key = str(f.resolve())
        except Exception:
            key = str(f)
        if key not in seen:
            seen.add(key)
            unique.append(f)

    old = dict(lib.clips)
    new_clips: Dict[str, dict] = {}
    total = len(unique)

    def _one(f: Path):
        try:
            key = str(f.resolve())
        except Exception:
            key = str(f)
        prev = old.get(key) or old.get(str(f))
        mtime = f.stat().st_mtime if f.exists() else 0
        if prev and float(prev.get("mtime") or 0) == mtime:
            return key, prev
        probe = _probe_quick(f)
        meta = {
            "path": key,
            "name": f.name,
            "tags": list(prev.get("tags") or []) if prev else [],
            "heat": int(prev.get("heat") or 3) if prev else 3,
            **probe,
        }
        return key, meta

    from concurrent.futures import ThreadPoolExecutor, as_completed
    workers = min(8, max(2, (total // 20) or 2))
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(_one, f) for f in unique]
        for fut in as_completed(futs):
            key, meta = fut.result()
            new_clips[key] = meta
            done += 1
            if progress_cb and done % 10 == 0:
                progress_cb(done, total)

    lib.clips = new_clips
    lib.last_scan_at = _now()
    save_library(lib)
    return lib


def update_clip(
    lib_id: str,
    path: str,
    tags: Optional[List[str]] = None,
    heat: Optional[int] = None,
) -> Optional[dict]:
    lib = load_library(lib_id)
    if not lib:
        return None
    # resolve key
    key = path
    if key not in lib.clips:
        # try resolve
        try:
            key = str(Path(path).resolve())
        except Exception:
            pass
    if key not in lib.clips:
        return None
    clip = dict(lib.clips[key])
    if tags is not None:
        cleaned = sorted({t.strip().lower() for t in tags if t and t.strip()})
        clip["tags"] = cleaned
        # extend vocab
        for t in cleaned:
            if t not in lib.tags_vocab:
                lib.tags_vocab.append(t)
    if heat is not None:
        clip["heat"] = max(1, min(5, int(heat)))
    lib.clips[key] = clip
    save_library(lib)
    return clip


def bulk_update_clips(
    lib_id: str,
    paths: List[str],
    add_tags: Optional[List[str]] = None,
    remove_tags: Optional[List[str]] = None,
    set_tags: Optional[List[str]] = None,
    heat: Optional[int] = None,
) -> int:
    lib = load_library(lib_id)
    if not lib:
        return 0
    add_tags = [t.strip().lower() for t in (add_tags or []) if t.strip()]
    remove_tags = {t.strip().lower() for t in (remove_tags or []) if t.strip()}
    set_tags = [t.strip().lower() for t in (set_tags or [])] if set_tags is not None else None
    count = 0
    for path in paths:
        key = path if path in lib.clips else None
        if not key:
            try:
                key = str(Path(path).resolve())
            except Exception:
                key = path
        if key not in lib.clips:
            continue
        clip = dict(lib.clips[key])
        tags = list(clip.get("tags") or [])
        if set_tags is not None:
            tags = list(set_tags)
        else:
            if add_tags:
                for t in add_tags:
                    if t not in tags:
                        tags.append(t)
            if remove_tags:
                tags = [t for t in tags if t not in remove_tags]
        clip["tags"] = sorted(set(tags))
        if heat is not None:
            clip["heat"] = max(1, min(5, int(heat)))
        lib.clips[key] = clip
        for t in clip["tags"]:
            if t not in lib.tags_vocab:
                lib.tags_vocab.append(t)
        count += 1
    save_library(lib)
    return count


def query_clips(
    lib_id: str,
    tags: Optional[List[str]] = None,
    tag_mode: str = "any",  # any | all
    min_heat: int = 1,
    max_heat: int = 5,
    limit: int = 0,
) -> List[dict]:
    lib = load_library(lib_id)
    if not lib:
        return []
    tags = [t.strip().lower() for t in (tags or []) if t.strip()]
    results = []
    for clip in lib.clips.values():
        heat = int(clip.get("heat") or 3)
        if heat < min_heat or heat > max_heat:
            continue
        ct = {t.lower() for t in (clip.get("tags") or [])}
        if tags:
            if tag_mode == "all":
                if not all(t in ct for t in tags):
                    continue
            else:
                if not any(t in ct for t in tags):
                    continue
        results.append(clip)
    # higher heat first, then name
    results.sort(key=lambda c: (-int(c.get("heat") or 0), c.get("name") or ""))
    if limit > 0:
        results = results[:limit]
    return results


def _tags_path() -> Path:
    return _lib_dir() / "tags.json"


def _normalize_tag(tag: str) -> str:
    return (tag or "").strip().lower()


def load_global_tags() -> List[str]:
    """
    Single source of truth for tag vocabulary.
    Stored at {config}/libraries/tags.json
    Seeded from DEFAULT_TAGS + any tags already on libraries/clips (once).
    """
    path = _tags_path()
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            tags = {_normalize_tag(t) for t in (data.get("tags") or []) if _normalize_tag(t)}
            return sorted(tags)
        except Exception:
            pass

    tags: Set[str] = set(DEFAULT_TAGS)
    for e in list_libraries():
        lib = load_library(e["id"])
        if not lib:
            continue
        tags.update(_normalize_tag(t) for t in (lib.tags_vocab or []) if _normalize_tag(t))
        for c in lib.clips.values():
            tags.update(_normalize_tag(t) for t in (c.get("tags") or []) if _normalize_tag(t))
    return save_global_tags(sorted(tags))


def save_global_tags(tags: List[str]) -> List[str]:
    cleaned = sorted({_normalize_tag(t) for t in tags if _normalize_tag(t)})
    path = _tags_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"tags": cleaned}, indent=2), encoding="utf-8")
    return cleaned


def all_tags() -> List[str]:
    """Alphabetically sorted global vocabulary."""
    return load_global_tags()


def _sync_tag_to_libraries(tag: str, *, add: bool, strip_from_clips: bool = False) -> None:
    """Keep per-library tags_vocab (and optionally clips) in sync with global ops."""
    tag = _normalize_tag(tag)
    if not tag:
        return
    for e in list_libraries():
        lib = load_library(e["id"])
        if not lib:
            continue
        changed = False
        if add:
            if tag not in lib.tags_vocab:
                lib.tags_vocab = sorted(set(lib.tags_vocab) | {tag})
                changed = True
        else:
            if tag in lib.tags_vocab:
                lib.tags_vocab = [t for t in lib.tags_vocab if t != tag]
                changed = True
            if strip_from_clips:
                for key, clip in list(lib.clips.items()):
                    old = list(clip.get("tags") or [])
                    new_tags = [t for t in old if t != tag]
                    if new_tags != old:
                        c = dict(clip)
                        c["tags"] = new_tags
                        lib.clips[key] = c
                        changed = True
        if changed:
            save_library(lib)


def add_tag_to_vocab(lib_id: Optional[str], tag: str) -> List[str]:
    """Add tag to the global vocabulary (and sync library vocabs). Always returns sorted global tags."""
    tag = _normalize_tag(tag)
    if not tag:
        raise ValueError("Empty tag")
    tags = set(load_global_tags())
    tags.add(tag)
    result = save_global_tags(list(tags))
    # Sync: all libraries if global, or one library if specified
    if lib_id:
        lib = load_library(lib_id)
        if not lib:
            raise ValueError("Library not found")
        if tag not in lib.tags_vocab:
            lib.tags_vocab = sorted(set(lib.tags_vocab) | {tag})
            save_library(lib)
    else:
        _sync_tag_to_libraries(tag, add=True)
    return result


def remove_tag_from_vocab(lib_id: Optional[str], tag: str, strip_from_clips: bool = False) -> List[str]:
    """
    Remove tag from global vocabulary (always when no lib_id).
    When lib_id is set, remove from that library's vocab; still drop from global
    if the tag is no longer used anywhere, but Tags panel delete should pass lib_id=None.
    Always returns the current sorted global tag list so the UI can refresh.
    """
    tag = _normalize_tag(tag)
    if not tag:
        raise ValueError("Empty tag")

    if lib_id:
        lib = load_library(lib_id)
        if not lib:
            raise ValueError("Library not found")
        lib.tags_vocab = [t for t in lib.tags_vocab if t != tag]
        if strip_from_clips:
            for key, clip in list(lib.clips.items()):
                old = list(clip.get("tags") or [])
                new_tags = [t for t in old if t != tag]
                if new_tags != old:
                    c = dict(clip)
                    c["tags"] = new_tags
                    lib.clips[key] = c
        save_library(lib)
        # If tag is gone from every library vocab and all clips, drop from global too
        still_used = False
        for e in list_libraries():
            other = load_library(e["id"])
            if not other:
                continue
            if tag in (other.tags_vocab or []):
                still_used = True
                break
            for c in other.clips.values():
                if tag in (c.get("tags") or []):
                    still_used = True
                    break
            if still_used:
                break
        if not still_used:
            save_global_tags([t for t in load_global_tags() if t != tag])
    else:
        # Global delete from Tags panel: drop everywhere
        save_global_tags([t for t in load_global_tags() if t != tag])
        _sync_tag_to_libraries(tag, add=False, strip_from_clips=strip_from_clips)

    return all_tags()


def is_path_in_any_library(path: str) -> bool:
    try:
        resolved = str(Path(path).resolve())
    except Exception:
        resolved = path
    for e in list_libraries():
        lib = load_library(e["id"])
        if not lib:
            continue
        if path in lib.clips or resolved in lib.clips:
            return True
        root = Path(lib.root_path)
        try:
            Path(resolved).relative_to(root.resolve())
            return True
        except Exception:
            continue
    return False
