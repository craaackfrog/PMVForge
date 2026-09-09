"""
Song libraries — folders of extracted osu! beatmap sets.

Layout expected under a library root (one level only):

  Root/
    Artist - Song Name/
      audio.mp3
      [easy].osu
      [hard].osu
    Another Song/
      ...

Each immediate child directory is one song. Files deeper than that are ignored.
.osu entries are sorted by file size descending (larger ≈ more hit objects).
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from ..config import get_config_dir
from .osu_editor import parse_osu_file

AUDIO_EXTS = {".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".wma", ".opus"}
OSU_EXT = ".osu"


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _lib_dir() -> Path:
    d = get_config_dir() / "song_libraries"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _index_path() -> Path:
    return _lib_dir() / "index.json"


def _lib_path(lib_id: str) -> Path:
    return _lib_dir() / f"{lib_id}.json"


def _fmt_size(n: int) -> str:
    if n >= 1024 * 1024:
        return f"{n / (1024 * 1024):.1f}MB"
    if n >= 1024:
        return f"{n / 1024:.1f}KB"
    return f"{n}B"


@dataclass
class FileEntry:
    path: str
    name: str
    size: int = 0
    mtime: float = 0.0

    def to_dict(self) -> dict:
        d = asdict(self)
        d["size_label"] = _fmt_size(self.size)
        return d

    @staticmethod
    def from_path(p: Path) -> "FileEntry":
        st = p.stat() if p.exists() else None
        return FileEntry(
            path=str(p.resolve()) if p.exists() else str(p),
            name=p.name,
            size=st.st_size if st else 0,
            mtime=st.st_mtime if st else 0.0,
        )


@dataclass
class SongEntry:
    path: str
    name: str
    osu_files: List[dict] = field(default_factory=list)
    audio_files: List[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "path": self.path,
            "name": self.name,
            "osu_files": self.osu_files,
            "audio_files": self.audio_files,
            "osu_count": len(self.osu_files),
            "audio_count": len(self.audio_files),
        }


@dataclass
class SongLibrary:
    id: str
    name: str
    root_path: str
    songs: Dict[str, dict] = field(default_factory=dict)  # path -> SongEntry dict
    created_at: str = ""
    updated_at: str = ""
    last_scan_at: Optional[str] = None

    def to_dict(self) -> dict:
        # stable sort: song name alpha
        song_list = sorted(self.songs.values(), key=lambda s: (s.get("name") or "").lower())
        return {
            "id": self.id,
            "name": self.name,
            "root_path": self.root_path,
            "songs": self.songs,
            "song_list": song_list,
            "song_count": len(self.songs),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "last_scan_at": self.last_scan_at,
        }

    @staticmethod
    def from_dict(d: dict) -> "SongLibrary":
        return SongLibrary(
            id=d["id"],
            name=d.get("name") or "Songs",
            root_path=d["root_path"],
            songs=dict(d.get("songs") or {}),
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
                "song_count": len(lib.songs),
                "updated_at": lib.updated_at,
                "last_scan_at": lib.last_scan_at,
            })
    return out


def load_library(lib_id: str) -> Optional[SongLibrary]:
    p = _lib_path(lib_id)
    if not p.exists():
        return None
    try:
        return SongLibrary.from_dict(json.loads(p.read_text(encoding="utf-8")))
    except Exception:
        return None


def save_library(lib: SongLibrary) -> None:
    lib.updated_at = _now()
    _lib_path(lib.id).write_text(json.dumps(lib.to_dict(), indent=2), encoding="utf-8")
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


def create_library(name: str, root_path: str) -> SongLibrary:
    root = Path(root_path)
    if not root.is_dir():
        raise ValueError(f"Folder not found: {root_path}")
    lib = SongLibrary(
        id=str(uuid.uuid4()),
        name=name or root.name,
        root_path=str(root.resolve()),
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


def rename_library(lib_id: str, name: str) -> SongLibrary:
    lib = load_library(lib_id)
    if not lib:
        raise ValueError("Library not found")
    lib.name = (name or lib.name).strip() or lib.name
    save_library(lib)
    return lib


def _display_name_from_meta(artist: str, title: str, creator: str, fallback: str) -> str:
    artist = (artist or "").strip()
    title = (title or "").strip()
    creator = (creator or "").strip()
    if artist and title and creator:
        return f"{artist} - {title} ({creator})"
    if artist and title:
        return f"{artist} - {title}"
    if title:
        return title
    return fallback


def _scan_song_dir(folder: Path) -> Optional[SongEntry]:
    """Index one immediate child folder — no further recursion.

    Song label comes from .osu [Metadata] (Artist - Title (Creator)).
    Only the AudioFilename referenced by the maps is kept as audio.
    """
    if not folder.is_dir():
        return None
    osu_files: List[dict] = []
    audio_by_name: Dict[str, dict] = {}
    audio_filenames: set = set()
    artist = title = creator = ""
    try:
        children = list(folder.iterdir())
    except PermissionError:
        return None

    for f in children:
        if not f.is_file():
            continue
        ext = f.suffix.lower()
        if ext == OSU_EXT:
            entry = FileEntry.from_path(f).to_dict()
            try:
                meta = parse_osu_file(f)
                entry["version"] = meta.get("version") or ""
                entry["audio_filename"] = meta.get("audio_filename") or ""
                entry["artist"] = meta.get("artist") or ""
                entry["title"] = meta.get("title") or ""
                entry["creator"] = meta.get("creator") or ""
                if entry["audio_filename"]:
                    audio_filenames.add(Path(entry["audio_filename"]).name.lower())
                # Prefer metadata from the largest map later; collect candidates now
                if not artist and entry["artist"]:
                    artist = entry["artist"]
                if not title and entry["title"]:
                    title = entry["title"]
                if not creator and entry["creator"]:
                    creator = entry["creator"]
            except Exception:
                pass
            osu_files.append(entry)
        elif ext in AUDIO_EXTS:
            entry = FileEntry.from_path(f).to_dict()
            audio_by_name[f.name.lower()] = entry

    if not osu_files and not audio_by_name:
        return None

    # Larger .osu first (more lines ≈ harder / more beats)
    osu_files.sort(key=lambda e: int(e.get("size") or 0), reverse=True)

    # Re-pick metadata from the largest map (most authoritative for the set)
    if osu_files:
        top = osu_files[0]
        artist = top.get("artist") or artist
        title = top.get("title") or title
        creator = top.get("creator") or creator
        if top.get("audio_filename"):
            audio_filenames.add(Path(top["audio_filename"]).name.lower())

    # Only keep the audio file(s) referenced by AudioFilename
    audio_files: List[dict] = []
    if audio_filenames:
        for name in sorted(audio_filenames):
            if name in audio_by_name:
                audio_files.append(audio_by_name[name])
            else:
                # try case-insensitive / missing extension edge cases
                for k, v in audio_by_name.items():
                    if k == name or Path(k).stem.lower() == Path(name).stem.lower():
                        audio_files.append(v)
                        break
    elif len(audio_by_name) == 1:
        # no AudioFilename parsed — fall back to the single audio present
        audio_files = list(audio_by_name.values())

    display = _display_name_from_meta(artist, title, creator, folder.name)

    return SongEntry(
        path=str(folder.resolve()),
        name=display,
        osu_files=osu_files,
        audio_files=audio_files,
    )


def scan_library(lib_id: str, progress_cb=None) -> SongLibrary:
    """
    Scan only immediate subdirectories of the library root.
    Each subdirectory becomes one song entry.
    """
    lib = load_library(lib_id)
    if not lib:
        raise ValueError("Library not found")
    root = Path(lib.root_path)
    if not root.is_dir():
        raise ValueError(f"Root folder missing: {lib.root_path}")

    try:
        subdirs = [p for p in sorted(root.iterdir(), key=lambda x: x.name.lower()) if p.is_dir()]
    except PermissionError as e:
        raise ValueError(f"Cannot read root: {e}") from e

    total = len(subdirs)
    songs: Dict[str, dict] = {}
    for i, d in enumerate(subdirs):
        entry = _scan_song_dir(d)
        if entry:
            songs[entry.path] = entry.to_dict()
        if progress_cb and total and i % 5 == 0:
            progress_cb(i, total)

    lib.songs = songs
    lib.last_scan_at = _now()
    save_library(lib)
    return lib


def is_path_in_any_library(path: str) -> bool:
    """Allow streaming media only if path belongs to a known song library."""
    try:
        target = str(Path(path).resolve())
    except Exception:
        target = path
    for e in _load_index():
        lib = load_library(e["id"])
        if not lib:
            continue
        root = str(Path(lib.root_path).resolve()) if lib.root_path else ""
        if root and (target == root or target.startswith(root.rstrip("\\/") + "\\") or target.startswith(root.rstrip("\\/") + "/")):
            return True
        for song in lib.songs.values():
            for bucket in ("osu_files", "audio_files"):
                for f in song.get(bucket) or []:
                    if f.get("path") == target or f.get("path") == path:
                        return True
    return False
