"""
Parse and rewrite osu! beatmaps for the Beat Editor.

Keeps original metadata / timing / colours, and only replaces [HitObjects]
with the (possibly edited) beat times.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional


def parse_osu_text(text: str) -> Dict[str, Any]:
    """
    Extract metadata + unique hit-object start times (seconds).
    Spinner end times are included as extra beats.
    """
    text = text.lstrip("\ufeff")
    meta: Dict[str, str] = {}
    general: Dict[str, str] = {}
    beat_times: List[float] = []
    beat_length: Optional[float] = None
    section: Optional[str] = None

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1]
            continue
        if line.startswith("//"):
            continue

        if section == "Metadata" and ":" in line:
            key, value = line.split(":", 1)
            meta[key.strip()] = value.strip()
            continue

        if section == "General" and ":" in line:
            key, value = line.split(":", 1)
            general[key.strip()] = value.strip()
            continue

        if section == "TimingPoints":
            parts = line.split(",")
            if len(parts) >= 2:
                try:
                    bl = float(parts[1])
                except ValueError:
                    continue
                # Uninherited timing point (positive beatLength)
                if bl > 0 and beat_length is None:
                    beat_length = bl
            continue

        if section == "HitObjects":
            parts = line.split(",")
            if len(parts) < 3:
                continue
            try:
                t = float(parts[2]) / 1000.0
            except ValueError:
                continue
            if t >= 0:
                beat_times.append(round(t, 3))

            # Spinner: type bit 3 set → extra end time in field 5
            if len(parts) >= 6:
                try:
                    obj_type = int(parts[3])
                except ValueError:
                    obj_type = 0
                if obj_type & 8:
                    try:
                        end_t = float(parts[5]) / 1000.0
                        if end_t >= 0:
                            beat_times.append(round(end_t, 3))
                    except ValueError:
                        pass

    unique = sorted(set(beat_times))
    tempo = round(60000.0 / beat_length, 2) if beat_length and beat_length > 0 else None

    artist = meta.get("Artist") or meta.get("ArtistUnicode") or "Unknown"
    title = meta.get("Title") or meta.get("TitleUnicode") or "Untitled"
    creator = meta.get("Creator") or "Unknown"

    return {
        "title": title,
        "artist": artist,
        "creator": creator,
        "version": meta.get("Version") or "",
        "audio_filename": general.get("AudioFilename") or "",
        "beats": unique,
        "count": len(unique),
        "tempo": tempo,
        "display_name": _display_name(artist, title, creator),
    }


def parse_osu_file(path: str | Path) -> Dict[str, Any]:
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    data = parse_osu_text(text)
    data["source_text"] = text
    return data


def rewrite_osu_hitobjects(original_text: str, beat_times: List[float]) -> str:
    """
    Keep every section of the original .osu except [HitObjects],
    which is replaced with simple circles at the given times.
    """
    original_text = original_text.lstrip("\ufeff")
    lines = original_text.splitlines()
    out: List[str] = []
    in_hitobjects = False
    hitobjects_written = False

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            if in_hitobjects:
                in_hitobjects = False
            if stripped == "[HitObjects]":
                in_hitobjects = True
                hitobjects_written = True
                out.append("[HitObjects]")
                out.extend(_hitobject_lines(beat_times))
                continue

        if in_hitobjects:
            continue
        out.append(line)

    if not hitobjects_written:
        if out and out[-1].strip() != "":
            out.append("")
        out.append("[HitObjects]")
        out.extend(_hitobject_lines(beat_times))

    return "\n".join(out) + "\n"


def export_edited_osu(
    original_text: str,
    beat_times: List[float],
    output_path: Path,
) -> Path:
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    rewritten = rewrite_osu_hitobjects(original_text, beat_times)
    output_path.write_text(rewritten, encoding="utf-8")
    return output_path


def _hitobject_lines(beat_times: List[float]) -> List[str]:
    lines = []
    x, y = 256, 192
    for t in sorted(beat_times):
        ms = int(round(float(t) * 1000))
        lines.append(f"{x},{y},{ms},1,0,0:0:0:0:")
    return lines


def _display_name(artist: str, title: str, creator: str) -> str:
    return f"{artist} - {title} ({creator})"
