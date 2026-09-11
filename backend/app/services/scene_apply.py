"""
Apply ThePornDB scene/movie match to a library clip:
  metadata + tags, Stash-style rename, hard-links into co-performer libraries.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from . import library_store as store
from . import tpdb_client


def sanitize_filename(name: str, fallback_ext: str = ".mp4") -> str:
    name = (name or "").strip()
    name = re.sub(r'[<>:"/\\|?*]', "", name)
    name = re.sub(r"\s+", " ", name).strip(" .")
    if not name:
        name = "clip"
    if "." not in Path(name).name:
        ext = fallback_ext if fallback_ext.startswith(".") else f".{fallback_ext}"
        name = f"{name}{ext}"
    return name


def stash_filename(
    *,
    studio: str,
    date: str,
    title: str,
    performers: List[str],
    ext: str,
) -> str:
    """
    Stash-inspired pattern:
      Studio - YYYY-MM-DD - Title [Performer1, Performer2].ext
    """
    def clean(s: str) -> str:
        s = (s or "").strip()
        s = re.sub(r'[<>:"/\\\\|?*]', "", s)
        s = re.sub(r"\s+", " ", s).strip(" .")
        return s

    studio_c = clean(studio) or "Unknown"
    title_c = clean(title) or "Untitled"
    date_c = clean(date) or "0000-00-00"
    # keep date-looking strings
    if re.match(r"^\d{4}-\d{2}-\d{2}", date_c):
        date_c = date_c[:10]
    perf = ", ".join(clean(p) for p in performers if clean(p))
    base = f"{studio_c} - {date_c} - {title_c}"
    if perf:
        base = f"{base} [{perf}]"
    if not ext.startswith("."):
        ext = f".{ext}" if ext else ""
    return f"{base}{ext}"


def _rename_file(old: Path, new_name: str) -> Path:
    dest = old.with_name(new_name)
    if dest.resolve() == old.resolve():
        return old
    if dest.exists():
        # avoid clobber: append short suffix
        stem = dest.stem
        n = 2
        while dest.exists():
            dest = old.with_name(f"{stem} ({n}){old.suffix}")
            n += 1
    old.rename(dest)
    return dest


def _hardlink(src: Path, dest: Path) -> str:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        try:
            if dest.samefile(src):
                return "exists"
        except OSError:
            pass
        raise FileExistsError(str(dest))
    try:
        os.link(src, dest)
        return "hardlink"
    except OSError as e:
        raise RuntimeError(
            f"Hard link failed ({e}). Same NTFS volume required."
        ) from e


def _find_library_by_name(name: str) -> Optional[dict]:
    target = (name or "").strip().lower()
    for e in store.list_libraries():
        if (e.get("name") or "").strip().lower() == target:
            return e
    return None


def _create_sibling_library(current_root: Path, actress_name: str) -> dict:
    """Create a new library folder next to the current library root."""
    parent = current_root.parent
    safe = re.sub(r'[<>:"/\\\\|?*]', "", actress_name).strip() or "Performer"
    folder = parent / safe
    n = 2
    while folder.exists() and any(folder.iterdir()):
        # empty dir ok to reuse
        folder = parent / f"{safe} ({n})"
        n += 1
    folder.mkdir(parents=True, exist_ok=True)
    lib = store.create_library(safe, str(folder.resolve()), recurse=True)
    return lib.to_dict() if hasattr(lib, "to_dict") else {
        "id": lib.id,
        "name": lib.name,
        "root_path": lib.root_path,
    }


def apply_scene_match(
    lib_id: str,
    path: str,
    scene: dict,
    *,
    rename: bool = True,
    filename: Optional[str] = None,
    push_tags: bool = True,
    link_performers: Optional[List[str]] = None,
    create_missing_libraries: bool = True,
) -> Dict[str, Any]:
    """
    Apply matched scene to clip.
    link_performers: female names to hard-link into (excluding current library name).
    """
    lib = store.load_library(lib_id)
    if not lib:
        raise ValueError("Library not found")

    key = path
    if key not in lib.clips:
        try:
            key = str(Path(path).resolve())
        except Exception:
            pass
    if key not in lib.clips:
        raise ValueError("Clip not in library")

    src = Path(key)
    if not src.is_file():
        raise ValueError(f"File missing: {key}")

    females = scene.get("performers_female") or [
        p for p in (scene.get("performers") or [])
        if (p.get("gender") or "").lower() not in ("male", "man", "m")
    ]
    female_names = [p["name"] for p in females if p.get("name")]
    if not female_names:
        female_names = [
            p.get("name") for p in (scene.get("performers") or [])
            if p.get("name") and (p.get("gender") or "").lower() not in ("male", "man", "m")
        ]

    # --- rename ---
    new_path = src
    if rename:
        if filename and str(filename).strip():
            new_name = sanitize_filename(str(filename).strip(), src.suffix or ".mp4")
        else:
            new_name = stash_filename(
                studio=scene.get("studio") or "",
                date=scene.get("date") or "",
                title=scene.get("title") or "",
                performers=female_names,
                ext=src.suffix,
            )
        new_path = _rename_file(src, new_name)

    # --- update clip record (path may change) ---
    clip = dict(lib.clips.pop(key))
    clip["path"] = str(new_path.resolve())
    clip["name"] = new_path.name
    clip["scene"] = {
        "tpdb_id": scene.get("id"),
        "kind": scene.get("kind") or "scene",
        "title": scene.get("title"),
        "date": scene.get("date"),
        "studio": scene.get("studio"),
        "url": scene.get("url"),
        "poster": scene.get("poster") or scene.get("image") or "",
        "performers": female_names,
        "tags": list(scene.get("tags") or []),
    }

    if push_tags:
        tags = set(clip.get("tags") or [])
        for t in scene.get("tags") or []:
            tt = str(t).strip().lower()
            if tt:
                tags.add(tt)
                if tt not in lib.tags_vocab:
                    lib.tags_vocab.append(tt)
        # also add studio as soft tag
        if scene.get("studio"):
            st = str(scene["studio"]).strip().lower()
            if st:
                tags.add(st)
                if st not in lib.tags_vocab:
                    lib.tags_vocab.append(st)
        clip["tags"] = sorted(tags)

    lib.clips[clip["path"]] = clip
    store.save_library(lib)

    # --- hard-link into co-performer libraries ---
    link_names = link_performers if link_performers is not None else [
        n for n in female_names if n.strip().lower() != (lib.name or "").strip().lower()
    ]
    links: List[dict] = []
    prompts: List[dict] = []
    current_root = Path(lib.root_path)

    for name in link_names:
        name = (name or "").strip()
        if not name:
            continue
        existing = _find_library_by_name(name)
        if not existing:
            if not create_missing_libraries:
                prompts.append({"name": name, "reason": "missing_library"})
                continue
            created = _create_sibling_library(current_root, name)
            existing = created
            prompts.append({"name": name, "reason": "created", "library": created})

        dest_root = Path(existing["root_path"] if isinstance(existing, dict) else existing.root_path)
        dest_file = dest_root / new_path.name
        try:
            kind = _hardlink(new_path, dest_file)
            # register in other library
            other_id = existing["id"] if isinstance(existing, dict) else existing.id
            other = store.load_library(other_id)
            if other:
                # minimal clip entry
                other.clips[str(dest_file.resolve())] = {
                    "path": str(dest_file.resolve()),
                    "name": dest_file.name,
                    "tags": list(clip.get("tags") or []),
                    "heat": int(clip.get("heat") or 3),
                    "duration": clip.get("duration") or 0,
                    "width": clip.get("width") or 0,
                    "height": clip.get("height") or 0,
                    "size": clip.get("size") or 0,
                    "mtime": clip.get("mtime") or 0,
                    "scene": dict(clip.get("scene") or {}),
                }
                # merge tags vocab
                for t in clip.get("tags") or []:
                    if t not in other.tags_vocab:
                        other.tags_vocab.append(t)
                store.save_library(other)
            links.append({
                "performer": name,
                "library_id": other_id,
                "path": str(dest_file.resolve()),
                "kind": kind,
            })
        except Exception as e:
            links.append({
                "performer": name,
                "error": str(e),
            })

    return {
        "clip": clip,
        "path": clip["path"],
        "links": links,
        "prompts": prompts,
        "scene": clip.get("scene"),
    }


def rename_clip_only(lib_id: str, path: str, filename: str) -> Dict[str, Any]:
    """Rename a clip on disk and update library index."""
    lib = store.load_library(lib_id)
    if not lib:
        raise ValueError("Library not found")
    key = path
    if key not in lib.clips:
        try:
            key = str(Path(path).resolve())
        except Exception:
            pass
    if key not in lib.clips:
        raise ValueError("Clip not in library")
    src = Path(key)
    if not src.is_file():
        raise ValueError(f"File missing: {key}")
    new_name = sanitize_filename(filename, src.suffix or ".mp4")
    new_path = _rename_file(src, new_name)
    clip = dict(lib.clips.pop(key))
    clip["path"] = str(new_path.resolve())
    clip["name"] = new_path.name
    lib.clips[clip["path"]] = clip
    store.save_library(lib)
    return {"clip": clip, "path": clip["path"]}


def update_clip_scene(lib_id: str, path: str, scene_patch: dict) -> dict:
    """Patch stored scene metadata for a clip (manual edit after match)."""
    lib = store.load_library(lib_id)
    if not lib:
        raise ValueError("Library not found")
    key = path
    if key not in lib.clips:
        try:
            key = str(Path(path).resolve())
        except Exception:
            pass
    if key not in lib.clips:
        raise ValueError("Clip not in library")
    clip = dict(lib.clips[key])
    scene = dict(clip.get("scene") or {})
    for k in ("title", "date", "studio", "url", "poster", "kind", "tpdb_id"):
        if k in scene_patch and scene_patch[k] is not None:
            scene[k] = scene_patch[k]
    if "performers" in scene_patch:
        perf = scene_patch["performers"]
        if isinstance(perf, str):
            perf = [x.strip() for x in perf.split(",") if x.strip()]
        scene["performers"] = list(perf or [])
    if "tags" in scene_patch:
        tags = scene_patch["tags"]
        if isinstance(tags, str):
            tags = [x.strip().lower() for x in tags.split(",") if x.strip()]
        cleaned = sorted({str(t).strip().lower() for t in (tags or []) if str(t).strip()})
        scene["tags"] = cleaned
        # replace clip tags with the modal selection (allows unchecking)
        clip["tags"] = list(cleaned)
        for tg in cleaned:
            if tg not in lib.tags_vocab:
                lib.tags_vocab.append(tg)
    clip["scene"] = scene
    lib.clips[key] = clip
    store.save_library(lib)
    return {"clip": clip}
