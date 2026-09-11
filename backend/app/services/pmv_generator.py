"""
PMV generation service – rewritten from the ground up.

Uses only ffmpeg/ffprobe + the stdlib / our own parsers.
No legacy Beats2Fun imports, no pydub, no Gooey, no broken Py3.14 deps.
"""

from __future__ import annotations

import json
import math
import os
import random
import re
import shutil
import subprocess
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable, List, Optional, Tuple

from ..config import PROJECT_NAME, get_temp_dir
from .temp_cleanup import cleanup_job_work
from .user_settings import load_settings
from .effects_pipeline import EffectsOptions, apply_effects, effects_from_dict
from .osu_editor import parse_osu_file

VIDEO_EXTS = {".mp4", ".wmv", ".mov", ".m4v", ".mpg", ".mpeg", ".avi", ".flv", ".mkv", ".webm"}

# aspect → quality → "W:H"
RESOLUTION_PRESETS = {
    "16:9": {
        "hd": "1280:720",
        "fhd": "1920:1080",
        "4k": "3840:2160",
    },
    "9:16": {
        "hd": "720:1280",
        "fhd": "1080:1920",
        "4k": "2160:3840",
    },
}

DEFAULT_BITRATE = {
    "hd": "4M",
    "fhd": "8M",
    "4k": "20M",
}


# ── helpers ─────────────────────────────────────────────────

# Active ffmpeg PIDs for cooperative cancel (kill on request)
_active_procs: List["subprocess.Popen"] = []


def _run(cmd: List[str], timeout: Optional[int] = None, cancel_cb: Optional[Callable[[], bool]] = None) -> Tuple[int, str]:
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    _active_procs.append(proc)
    try:
        try:
            out, _ = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            proc.kill()
            out, _ = proc.communicate()
            return 1, (out or "") + "\ntimeout"
        return proc.returncode or 0, out or ""
    finally:
        try:
            _active_procs.remove(proc)
        except ValueError:
            pass


def kill_active_ffmpeg() -> int:
    """Kill any in-flight ffmpeg processes started by this module."""
    n = 0
    for proc in list(_active_procs):
        try:
            if proc.poll() is None:
                proc.kill()
                n += 1
        except Exception:
            pass
    return n


def ffprobe_json(path: str) -> dict:
    code, out = _run([
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-show_entries", "stream=width,height,codec_type,channels,duration",
        "-print_format", "json",
        "-i", path,
    ])
    if code != 0:
        raise RuntimeError(f"ffprobe failed for {path}: {out[-500:]}")
    return json.loads(out)


def media_duration(path: str) -> float:
    info = ffprobe_json(path)
    if "format" in info and info["format"].get("duration"):
        return float(info["format"]["duration"])
    for s in info.get("streams", []):
        if s.get("duration"):
            return float(s["duration"])
    raise RuntimeError(f"Could not read duration: {path}")


def timestamp(seconds: float) -> str:
    if seconds < 0:
        seconds = 0
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds - h * 3600 - m * 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def resolve_resolution(aspect: str, quality: str, custom: Optional[str] = None) -> str:
    if custom and re.match(r"^\d+:\d+$", custom):
        return custom
    aspect = aspect if aspect in RESOLUTION_PRESETS else "16:9"
    quality = quality if quality in RESOLUTION_PRESETS[aspect] else "hd"
    return RESOLUTION_PRESETS[aspect][quality]


# ── beat loading ────────────────────────────────────────────

def load_beat_times(path: str) -> Tuple[List[float], Optional[str], str]:
    """
    Returns (beat_times_seconds, song_path_or_None, display_name).
    Supports .osu / .txt / .json.
    """
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(path)

    if p.is_dir():
        # pick first supported file inside
        for ext in (".osu", ".txt", ".json"):
            hits = list(p.glob(f"*{ext}"))
            if hits:
                return load_beat_times(str(hits[0]))
        raise ValueError(f"No supported beat file in folder: {path}")

    ext = p.suffix.lower()
    song: Optional[str] = None
    name = p.stem

    if ext == ".osu":
        data = parse_osu_file(p)
        beats = data["beats"]
        name = data.get("display_name") or name
        audio_name = data.get("audio_filename") or ""
        # try sibling audio
        for candidate in [
            p.parent / audio_name if audio_name else None,
            p.with_suffix(".ogg"),
            p.with_suffix(".mp3"),
            p.with_suffix(".wav"),
        ]:
            if candidate and candidate.exists():
                song = str(candidate)
                break
        return beats, song, name

    if ext == ".json":
        with open(p, encoding="utf-8") as f:
            data = json.load(f)
        actions = data.get("actions") or []
        beats = sorted({round(a["at"] / 1000.0, 3) for a in actions if "at" in a})
        for candidate in [p.with_suffix(".mp3"), p.with_suffix(".ogg"), p.with_suffix(".wav")]:
            if candidate.exists():
                song = str(candidate)
                break
        return beats, song, name

    if ext == ".txt":
        beats = []
        with open(p, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    beats.append(float(line))
                except ValueError:
                    continue
        beats = sorted(set(round(b, 3) for b in beats if b >= 0))
        for candidate in [p.with_suffix(".mp3"), p.with_suffix(".ogg"), p.with_suffix(".wav")]:
            if candidate.exists():
                song = str(candidate)
                break
        return beats, song, name

    raise ValueError(f"Unsupported beat input: {ext}")


def reduce_beats(times: List[float], min_dist: float, length: float) -> List[float]:
    """Ensure 0 and length bookends, thin out dense regions."""
    times = sorted(t for t in times if 0 <= t <= length)
    if not times or times[0] > 0.05:
        times = [0.0] + times
    if times[-1] < length - 0.05:
        times = times + [length]

    out = [times[0]]
    for t in times[1:]:
        if t - out[-1] >= min_dist:
            out.append(t)
    if out[-1] != length:
        if length - out[-1] < min_dist * 0.5 and len(out) > 1:
            out[-1] = length
        else:
            out.append(length)
    return out


# ── video pool ──────────────────────────────────────────────

@dataclass
class SourceVideo:
    path: str
    width: int
    height: int
    duration: float
    start_at: float
    end_at: float

    @property
    def usable(self) -> float:
        return max(0.0, self.end_at - self.start_at)


def _probe_video(path: Path) -> Optional[SourceVideo]:
    try:
        info = ffprobe_json(str(path))
        vs = next(s for s in info["streams"] if s.get("codec_type") == "video")
        w, h = int(vs["width"]), int(vs["height"])
        # yuv420p needs even dims — keep the clip and let scale/pad evenize
        w -= w % 2
        h -= h % 2
        if w < 2 or h < 2:
            return None
        dur = float(info["format"]["duration"])
        trim = min(10.0, dur * 0.1)
        if dur - 2 * trim < 1.0:
            return None
        return SourceVideo(str(path), w, h, dur, trim, dur - trim)
    except Exception:
        return None


def load_videos_from_paths(paths: List[str], limit: int = 0) -> List[SourceVideo]:
    files = [Path(p) for p in paths if Path(p).is_file() and Path(p).suffix.lower() in VIDEO_EXTS]
    random.shuffle(files)
    if limit > 0:
        files = files[:limit]
    videos: List[SourceVideo] = []
    for f in files:
        v = _probe_video(f)
        if v:
            videos.append(v)
    return videos


def scan_videos(folder: str, recurse: bool, limit: int = 0) -> List[SourceVideo]:
    root = Path(folder)
    files: List[Path] = []
    if recurse:
        for ext in VIDEO_EXTS:
            files.extend(root.rglob(f"*{ext}"))
    else:
        for f in root.iterdir():
            if f.is_file() and f.suffix.lower() in VIDEO_EXTS:
                files.append(f)

    random.shuffle(files)
    if limit > 0:
        files = files[:limit]

    videos: List[SourceVideo] = []
    for f in files:
        v = _probe_video(f)
        if v:
            videos.append(v)
    return videos


@dataclass
class ClipPlan:
    index: int
    video: SourceVideo
    src_start: float
    duration: float
    framecount: int
    out_path: str
    volume: float = 1.0  # clip (moan) gain for this segment


def _gaps_after(
    v: SourceVideo,
    used: List[Tuple[float, float]],
    dur: float,
    min_start: Optional[float] = None,
) -> List[Tuple[float, float]]:
    """Free windows that can hold `dur`, optionally only after min_start."""
    occupied = sorted(used)
    gaps: List[Tuple[float, float]] = []
    cursor = v.start_at
    if min_start is not None:
        cursor = max(cursor, min_start)
    for a, b in occupied:
        if a < cursor:
            cursor = max(cursor, b)
            continue
        if a - cursor >= dur:
            gaps.append((cursor, a))
        cursor = max(cursor, b)
    if v.end_at - cursor >= dur:
        gaps.append((cursor, v.end_at))
    return gaps


def plan_clips(
    beats: List[float],
    videos: List[SourceVideo],
    fps: int,
    work_dir: Path,
    order: str = "random",
) -> List[ClipPlan]:
    """
    order:
      - "random"  — classic random seeks
      - "forward" — always take the earliest free segment (chronological per file)
      - "sticky"  — stay on one source and play forward; switch when it runs out
    """
    if not videos:
        raise RuntimeError("No usable source videos")

    order = (order or "random").lower()
    if order not in ("random", "forward", "sticky"):
        order = "random"

    frame_time = 1.0 / fps
    plans: List[ClipPlan] = []
    used: dict[str, List[Tuple[float, float]]] = {v.path: [] for v in videos}
    cursor: dict[str, float] = {v.path: v.start_at for v in videos}

    pool = list(videos)
    random.shuffle(pool)
    sticky_v: Optional[SourceVideo] = pool[0] if pool else None
    sticky_streak = 0
    sticky_max = 12
    rr = 0

    for i in range(len(beats) - 1):
        start_t, end_t = beats[i], beats[i + 1]
        dur = end_t - start_t
        if dur <= 0.02:
            continue
        frames = max(1, int(round(dur / frame_time)))
        dur = frames * frame_time

        chosen: Optional[Tuple[SourceVideo, float]] = None

        if order == "sticky" and sticky_v is not None:
            gaps = _gaps_after(sticky_v, used[sticky_v.path], dur, cursor[sticky_v.path])
            if gaps and sticky_streak < sticky_max:
                chosen = (sticky_v, gaps[0][0])
            else:
                candidates = []
                for v in pool:
                    g = _gaps_after(v, used[v.path], dur, cursor[v.path])
                    if g:
                        candidates.append((v, g[0][0]))
                if candidates:
                    v, src = random.choice(candidates)
                    chosen = (v, src)
                    sticky_v = v
                    sticky_streak = 0

        elif order == "forward":
            for attempt in range(len(pool)):
                v = pool[(rr + attempt) % len(pool)]
                gaps = _gaps_after(v, used[v.path], dur, cursor[v.path])
                if gaps:
                    chosen = (v, gaps[0][0])
                    rr = (rr + attempt + 1) % len(pool)
                    break

        if order == "random" or chosen is None:
            random.shuffle(pool)
            for v in pool:
                min_s = None if order == "random" else cursor[v.path]
                gaps = _gaps_after(v, used[v.path], dur, min_s)
                if not gaps and order == "random":
                    gaps = _gaps_after(v, used[v.path], dur, None)
                if not gaps:
                    continue
                if order == "random":
                    gap = random.choice(gaps)
                    slack = gap[1] - gap[0] - dur
                    src_start = gap[0] + (random.random() * slack if slack > 0 else 0)
                else:
                    src_start = gaps[0][0]
                chosen = (v, src_start)
                break

        if chosen is None:
            # Exhaustion fallback: pick the longest usable source and a random
            # valid window (or start_at if the clip is shorter than needed).
            v = max(pool, key=lambda x: x.usable)
            max_start = max(v.start_at, v.end_at - dur)
            if max_start > v.start_at:
                src_start = v.start_at + random.random() * (max_start - v.start_at)
            else:
                src_start = v.start_at
            chosen = (v, src_start)

        v, src_start = chosen
        src_start = max(v.start_at, min(src_start, v.end_at - dur))
        out = str(work_dir / f"clip_{i:05d}.mp4")
        plans.append(ClipPlan(i, v, src_start, dur, frames, out))
        used[v.path].append((src_start, src_start + dur))
        cursor[v.path] = max(cursor[v.path], src_start + dur)
        if order == "sticky":
            if sticky_v and v.path == sticky_v.path:
                sticky_streak += 1
            else:
                sticky_v = v
                sticky_streak = 1

    return plans





def plans_from_edl(
    edl_clips: List[dict],
    fps: int,
    work_dir: Path,
) -> List[ClipPlan]:
    """
    Build ClipPlan list from a UI-owned EDL.
    Each item: {path, src_in, src_out, volume?, order?}
    Duration is driven by src_out - src_in (already beat-aligned by the UI).
    """
    frame_time = 1.0 / max(1, fps)
    plans: List[ClipPlan] = []
    cache: dict[str, SourceVideo] = {}
    for i, row in enumerate(edl_clips):
        path = str(row.get("path") or "")
        if not path:
            continue
        if path not in cache:
            v = _probe_video(Path(path))
            if not v:
                raise RuntimeError(f"Unusable EDL clip: {path}")
            cache[path] = v
        v = cache[path]
        src_in = float(row.get("src_in") or row.get("srcIn") or v.start_at)
        src_out = float(row.get("src_out") or row.get("srcOut") or (src_in + 0.4))
        dur = max(0.04, src_out - src_in)
        frames = max(1, int(round(dur / frame_time)))
        dur = frames * frame_time
        src_in = max(v.start_at, min(src_in, max(v.start_at, v.end_at - dur)))
        vol = float(row.get("volume") if row.get("volume") is not None else 1.0)
        vol = max(0.0, min(2.0, vol))
        out = str(work_dir / f"clip_{i:05d}.mp4")
        plans.append(ClipPlan(i, v, src_in, dur, frames, out, volume=vol))
    if not plans:
        raise RuntimeError("EDL produced no clips")
    return plans


def edl_from_plans(plans: List[ClipPlan], beats: List[float]) -> List[dict]:
    """Serialize plans back to a UI EDL (one row per planned segment)."""
    rows = []
    for i, p in enumerate(plans):
        beat_in = beats[i] if i < len(beats) else 0.0
        beat_out = beats[i + 1] if i + 1 < len(beats) else beat_in + p.duration
        rows.append({
            "id": f"seg-{i}",
            "path": p.video.path,
            "name": Path(p.video.path).name,
            "src_in": round(p.src_start, 4),
            "src_out": round(p.src_start + p.duration, 4),
            "beat_in": round(float(beat_in), 4),
            "beat_out": round(float(beat_out), 4),
            "duration": round(p.duration, 4),
            "volume": float(getattr(p, "volume", 1.0)),
            "order": i,
            "width": p.video.width,
            "height": p.video.height,
        })
    return rows



def build_scale_filter(
    src_w: int,
    src_h: int,
    resolution: str,
    zoom_to_fill: bool,
    fps: int,
) -> str:
    """
    zoom_to_fill=True  → scale up + crop (fills the frame)
    zoom_to_fill=False → fit inside + pad (letterbox/pillarbox)
    """
    tw, th = map(int, resolution.split(":"))
    tw -= tw % 2
    th -= th % 2

    parts = [f"fps={fps}"]

    if src_w == tw and src_h == th:
        return ",".join(parts)

    if zoom_to_fill:
        parts.append(f"scale={tw}:{th}:force_original_aspect_ratio=increase")
        parts.append(f"crop={tw}:{th}")
    else:
        parts.append(f"scale={tw}:{th}:force_original_aspect_ratio=decrease")
        parts.append(f"pad={tw}:{th}:(ow-iw)/2:(oh-ih)/2")

    return ",".join(parts)


def render_clip(
    plan: ClipPlan,
    resolution: str,
    bitrate: str,
    fps: int,
    zoom_to_fill: bool,
    cuda: bool,
    keep_audio: bool = False,
) -> None:
    vf = build_scale_filter(
        plan.video.width,
        plan.video.height,
        resolution,
        zoom_to_fill,
        fps,
    )
    vol = float(getattr(plan, "volume", 1.0) or 0.0)

    def _build(use_cuda: bool, with_audio: bool) -> list:
        encoder = "h264_nvenc" if use_cuda else "libx264"
        cmd = [
            "ffmpeg", "-hide_banner", "-y",
            "-ss", timestamp(plan.src_start),
            "-t", f"{plan.duration + 0.15:.4f}",
            "-i", plan.video.path,
            "-vf", vf,
            "-vframes", str(plan.framecount),
            "-c:v", encoder,
            "-b:v", bitrate,
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
        ]
        if with_audio:
            cmd.extend([
                "-af", f"volume={vol:.4f},aformat=sample_rates=48000:channel_layouts=stereo",
                "-c:a", "aac", "-b:a", "192k",
            ])
        else:
            cmd.append("-an")
        cmd.append(plan.out_path)
        if use_cuda:
            idx = cmd.index("-i")
            cmd = cmd[:idx] + ["-hwaccel", "cuda"] + cmd[idx:]
        return cmd

    def _build_silent_pad(use_cuda: bool) -> list:
        """Video has no audio stream — generate silent AAC so concat stays uniform."""
        encoder = "h264_nvenc" if use_cuda else "libx264"
        cmd = [
            "ffmpeg", "-hide_banner", "-y",
            "-ss", timestamp(plan.src_start),
            "-t", f"{plan.duration + 0.15:.4f}",
            "-i", plan.video.path,
            "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-vf", vf,
            "-vframes", str(plan.framecount),
            "-map", "0:v", "-map", "1:a",
            "-c:v", encoder,
            "-b:v", bitrate,
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k",
            "-shortest",
            "-movflags", "+faststart",
            plan.out_path,
        ]
        if use_cuda:
            idx = cmd.index("-i")
            cmd = cmd[:idx] + ["-hwaccel", "cuda"] + cmd[idx:]
        return cmd

    attempts = []
    if keep_audio:
        attempts.append(lambda: _build(bool(cuda), True))
        if cuda:
            attempts.append(lambda: _build(False, True))
        attempts.append(lambda: _build_silent_pad(False))
    else:
        attempts.append(lambda: _build(bool(cuda), False))
        if cuda:
            attempts.append(lambda: _build(False, False))

    last_out = ""
    for make in attempts:
        code, out = _run(make(), timeout=300)
        last_out = out
        if code == 0 and Path(plan.out_path).exists():
            return
    raise RuntimeError(f"Clip render failed ({plan.video.path}): {last_out[-400:]}")



def concat_clips(plans: List[ClipPlan], out_path: Path) -> None:
    list_file = out_path.parent / "concat.txt"
    with open(list_file, "w", encoding="utf-8") as f:
        for p in plans:
            # ffmpeg concat demuxer needs escaped paths
            path = p.out_path.replace("'", "'\\''")
            f.write(f"file '{path}'\n")

    cmd = [
        "ffmpeg", "-hide_banner", "-y",
        "-f", "concat", "-safe", "0",
        "-i", str(list_file),
        "-c", "copy",
        str(out_path),
    ]
    code, out = _run(cmd, timeout=600)
    if code != 0:
        # fallback: re-encode
        cmd = [
            "ffmpeg", "-hide_banner", "-y",
            "-f", "concat", "-safe", "0",
            "-i", str(list_file),
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            str(out_path),
        ]
        code, out = _run(cmd, timeout=1200)
        if code != 0:
            raise RuntimeError(f"Concat failed: {out[-400:]}")


def mux_audio(
    video_path: Path,
    audio_path: str,
    out_path: Path,
    length: float,
    song_volume: float = 1.0,
    mix_clip_audio: bool = False,
) -> None:
    """
    Attach song audio. When mix_clip_audio is True, amix song with
    whatever audio is already on the video (clip moans from render_clip).
    """
    song_vol = max(0.0, min(2.0, float(song_volume)))
    if mix_clip_audio:
        # 0 = video(+clip audio), 1 = song
        fc = (
            f"[0:a]volume=1.0[a0];"
            f"[1:a]volume={song_vol:.4f}[a1];"
            f"[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[aout]"
        )
        cmd = [
            "ffmpeg", "-hide_banner", "-y",
            "-i", str(video_path),
            "-i", audio_path,
            "-filter_complex", fc,
            "-map", "0:v", "-map", "[aout]",
            "-c:v", "copy",
            "-c:a", "aac", "-b:a", "192k",
            "-t", f"{length:.3f}",
            str(out_path),
        ]
    else:
        cmd = [
            "ffmpeg", "-hide_banner", "-y",
            "-i", str(video_path),
            "-i", audio_path,
            "-map", "0:v", "-map", "1:a",
            "-c:v", "copy",
            "-c:a", "aac", "-b:a", "192k",
            "-af", f"volume={song_vol:.4f}",
            "-shortest",
            "-t", f"{length:.3f}",
            str(out_path),
        ]
    code, out = _run(cmd, timeout=600)
    if code != 0:
        # fallback: song only (old behaviour)
        cmd = [
            "ffmpeg", "-hide_banner", "-y",
            "-i", str(video_path),
            "-i", audio_path,
            "-map", "0:v", "-map", "1:a",
            "-c:v", "copy",
            "-c:a", "aac", "-b:a", "192k",
            "-shortest",
            "-t", f"{length:.3f}",
            str(out_path),
        ]
        code, out = _run(cmd, timeout=600)
        if code != 0:
            raise RuntimeError(f"Audio mux failed: {out[-400:]}")



# ── public API ──────────────────────────────────────────────

@dataclass
class PMVJobOptions:
    beat_input: str
    video_folder: str = ""
    output_folder: str = ""
    song_path: Optional[str] = None
    video_paths: List[str] = field(default_factory=list)

    num_vids: int = 0
    recurse: bool = False
    clip_dist: float = 0.4

    # Output geometry
    aspect: str = "16:9"          # "16:9" | "9:16"
    quality: str = "hd"           # "hd" | "fhd" | "4k"
    resolution: Optional[str] = None  # optional override "W:H"
    zoom_to_fill: bool = False    # center crop (esp. useful for 9:16)
    clip_order: str = "random"    # random | forward | sticky

    fps: int = 30
    bitrate: Optional[str] = None
    threads: int = 4
    cuda: bool = False
    debug: bool = False

    # Beat effects post-pass
    effects: Optional[dict] = None

    # UI-owned EDL (optional). When set, skips plan_clips.
    edl_clips: Optional[List[dict]] = None
    song_volume: float = 1.0
    default_clip_volume: float = 1.0
    keep_clip_audio: bool = True

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class PMVJobResult:
    success: bool
    output_video: Optional[str] = None
    message: str = ""
    logs: List[str] = field(default_factory=list)


class PMVGenerator:
    def __init__(
        self,
        options: PMVJobOptions,
        progress_cb: Optional[Callable[[str, float], None]] = None,
        cancel_cb: Optional[Callable[[], bool]] = None,
    ):
        self.options = options
        self.progress_cb = progress_cb or (lambda msg, pct: None)
        self.cancel_cb = cancel_cb or (lambda: False)
        self.logs: List[str] = []

    def _log(self, msg: str):
        self.logs.append(msg)
        print(f"[{PROJECT_NAME}] {msg}")

    def _progress(self, msg: str, pct: float):
        self._log(msg)
        self.progress_cb(msg, pct)

    def run(self) -> PMVJobResult:
        opts = self.options
        self._work_dir = None
        try:
            if not Path(opts.beat_input).exists():
                return PMVJobResult(False, message=f"Beat input not found: {opts.beat_input}")
            if not opts.video_paths and opts.video_folder and not Path(opts.video_folder).exists():
                return PMVJobResult(False, message=f"Video folder not found: {opts.video_folder}")
            if not opts.video_paths and not opts.video_folder:
                return PMVJobResult(False, message="No video folder or clip list provided")

            out_dir = Path(opts.output_folder) if opts.output_folder else (get_temp_dir() / "outputs")
            out_dir.mkdir(parents=True, exist_ok=True)

            work_dir = get_temp_dir() / "jobs" / f"pmv_{os.getpid()}_{random.randint(1000,9999)}"
            work_dir.mkdir(parents=True, exist_ok=True)
            self._work_dir = work_dir

            resolution = resolve_resolution(opts.aspect, opts.quality, opts.resolution)
            bitrate = opts.bitrate or DEFAULT_BITRATE.get(opts.quality, "4M")
            zoom = bool(opts.zoom_to_fill)

            self._progress("Loading beats…", 0.05)
            beats, song, display_name = load_beat_times(opts.beat_input)
            if opts.song_path and Path(opts.song_path).exists():
                song = opts.song_path
            if not song:
                return PMVJobResult(
                    False,
                    message="No song/audio found next to the beat input. "
                            "Place an .mp3/.ogg/.wav beside it or set song_path.",
                    logs=self.logs,
                )

            length = media_duration(song)
            beats = reduce_beats(beats, opts.clip_dist, length)
            self._log(f"{len(beats)} beats after thinning · {length:.1f}s · {display_name}")

            self._progress("Scanning videos…", 0.12)
            if opts.video_paths:
                videos = load_videos_from_paths(opts.video_paths, opts.num_vids)
                self._log(f"{len(videos)} usable clips from explicit list")
            else:
                if not opts.video_folder or not Path(opts.video_folder).exists():
                    return PMVJobResult(False, message="Video folder not found", logs=self.logs)
                videos = scan_videos(opts.video_folder, opts.recurse, opts.num_vids)
                self._log(f"{len(videos)} usable source videos")
            if not videos:
                return PMVJobResult(False, message="No usable videos found", logs=self.logs)

            self._progress("Planning clips…", 0.18)
            order = getattr(opts, "clip_order", None) or "random"
            edl = getattr(opts, "edl_clips", None) or None
            if edl:
                plans = plans_from_edl(edl, opts.fps, work_dir)
                self._log(f"EDL: {len(plans)} segments from UI")
            else:
                plans = plan_clips(beats, videos, opts.fps, work_dir, order=order)
                dvol = float(getattr(opts, "default_clip_volume", 1.0) or 1.0)
                for pl in plans:
                    pl.volume = dvol
            self._log(
                f"{len(plans)} clips planned · {resolution} @ {opts.fps}fps · "
                f"order={order} · zoom_to_fill={zoom}"
            )

            if self.cancel_cb():
                kill_active_ffmpeg()
                return PMVJobResult(False, message="Cancelled", logs=self.logs)

            self._progress("Rendering clips…", 0.25)
            done = 0
            errors = []

            def _one(plan: ClipPlan):
                if self.cancel_cb():
                    return
                render_clip(
                    plan, resolution, bitrate, opts.fps, zoom, opts.cuda,
                    keep_audio=bool(getattr(opts, "keep_clip_audio", True)),
                )

            with ThreadPoolExecutor(max_workers=max(1, opts.threads)) as ex:
                futs = {ex.submit(_one, p): p for p in plans}
                for fut in as_completed(futs):
                    if self.cancel_cb():
                        for f in futs:
                            f.cancel()
                        kill_active_ffmpeg()
                        return PMVJobResult(False, message="Cancelled", logs=self.logs)
                    done += 1
                    if done % 5 == 0 or done == len(plans):
                        self._progress(
                            f"Rendering clips… {done}/{len(plans)}",
                            0.25 + 0.45 * (done / max(1, len(plans))),
                        )
                    try:
                        fut.result()
                    except Exception as e:
                        errors.append(str(e))

            if errors and len(errors) > len(plans) * 0.3:
                return PMVJobResult(
                    False,
                    message=f"Too many clip failures ({len(errors)}): {errors[0]}",
                    logs=self.logs + errors[:5],
                )

            # drop failed plans
            plans = [p for p in plans if Path(p.out_path).exists()]
            if not plans:
                return PMVJobResult(False, message="All clip renders failed", logs=self.logs + errors[:5])

            self._progress("Concatenating…", 0.75)
            silent = work_dir / "silent.mp4"
            concat_clips(plans, silent)

            safe_name = re.sub(r"[^\w\s\-\[\]\(\)]+", "", display_name).strip() or "pmv_output"
            final_path = out_dir / f"{safe_name}.mp4"

            self._progress("Muxing audio…", 0.88)
            mux_audio(
                silent,
                song,
                final_path,
                length,
                song_volume=float(getattr(opts, "song_volume", 1.0) or 1.0),
                mix_clip_audio=bool(getattr(opts, "keep_clip_audio", True)),
            )

            # Optional beat-effects post-pass
            fx_raw = opts.effects if isinstance(getattr(opts, "effects", None), dict) else {}
            if fx_raw and fx_raw.get("enabled"):
                self._progress("Applying beat effects… 0%", 0.9)

                def _fx_progress(frac: float):
                    pct = int(round(frac * 100))
                    self._progress(f"Applying beat effects… {pct}%", 0.9 + 0.08 * frac)

                fx = effects_from_dict(fx_raw)
                fx_out = work_dir / "effects.mp4"
                apply_effects(
                    str(final_path),
                    str(fx_out),
                    beats,
                    fx,
                    cuda=bool(opts.cuda),
                    bitrate=bitrate,
                    work_dir=str(work_dir),
                    progress_cb=_fx_progress,
                )
                # replace final
                import shutil
                shutil.move(str(fx_out), str(final_path))
                self._log("Beat effects applied")

            self._progress("Done", 1.0)
            self._log(f"Output → {final_path}")

            return PMVJobResult(
                success=True,
                output_video=str(final_path),
                message="PMV generated successfully",
                logs=self.logs,
            )

        except Exception as e:
            self._log(f"ERROR: {e}")
            self._log(traceback.format_exc())
            return PMVJobResult(success=False, message=str(e), logs=self.logs)
        finally:
            # Drop intermediate clips / concat lists — final MP4 lives in output_folder
            try:
                if load_settings().get("auto_cleanup_after_job", True):
                    wd = getattr(self, "_work_dir", None)
                    if wd is not None:
                        cleanup_job_work(wd)
            except Exception:
                pass
            self._work_dir = None
