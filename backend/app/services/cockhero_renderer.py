"""
Cock Hero beatbar renderer — no OpenCV.

ffmpeg decode/encode + numpy compositing. Pillow optional for preview save.
"""

from __future__ import annotations

import json
import math
import os
import subprocess
import wave
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Callable, List, Optional, Tuple

import numpy as np

from ..config import get_temp_dir, PROJECT_NAME
from .temp_cleanup import cleanup_after_ch_job
from .user_settings import load_settings


@dataclass
class CockHeroOptions:
    video_path: str
    beats_path: str
    output_path: str

    circle_color: str = "#ff4da6"
    bar_height_pct: float = 10.0
    margin_bottom_pct: float = 4.0
    lookahead: float = 3.0
    hit_zone_x_pct: float = 50.0
    circle_radius_pct: float = 1.8
    bar_opacity: float = 0.55

    beat_mode: str = "full"
    thin_dist: float = 0.4

    sound_enabled: bool = True
    sound_preset: str = "tick"
    custom_sound: Optional[str] = None
    sound_volume: float = 0.7

    fps: Optional[int] = None
    cuda: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class CockHeroResult:
    success: bool
    output_video: Optional[str] = None
    message: str = ""
    logs: List[str] = field(default_factory=list)
    elapsed: float = 0.0


def _run(cmd: List[str], timeout: Optional[int] = None) -> Tuple[int, str]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout or 600)
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except subprocess.TimeoutExpired:
        return 1, "timeout"
    except Exception as e:
        return 1, str(e)


def _hex_to_rgb(hex_color: str) -> Tuple[int, int, int]:
    h = hex_color.lstrip("#")
    if len(h) != 6:
        h = "ff4da6"
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def load_beats(path: str, mode: str = "full", thin_dist: float = 0.4) -> List[float]:
    from .pmv_generator import load_beat_times, reduce_beats
    beats, _, _ = load_beat_times(path)
    if mode == "thinned":
        end = beats[-1] + 1 if beats else 0
        beats = reduce_beats(beats, thin_dist, end)
    return beats


def media_duration(path: str) -> float:
    code, out = _run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "json", path,
    ], timeout=30)
    if code != 0:
        raise RuntimeError(f"ffprobe failed: {out[-200:]}")
    return float(json.loads(out)["format"]["duration"])


def probe_video(path: str) -> Tuple[int, int, float, int]:
    code, out = _run([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate,nb_frames",
        "-show_entries", "format=duration", "-of", "json", path,
    ], timeout=30)
    if code != 0:
        raise RuntimeError(f"ffprobe failed: {out[-200:]}")
    data = json.loads(out)
    stream = data["streams"][0]
    w, h = int(stream["width"]), int(stream["height"])
    rate = stream.get("r_frame_rate", "30/1")
    if "/" in rate:
        a, b = rate.split("/")
        fps = float(a) / max(float(b), 1e-6)
    else:
        fps = float(rate) or 30.0
    dur = float(data.get("format", {}).get("duration") or 0)
    nb = stream.get("nb_frames")
    frames = int(nb) if nb and str(nb).isdigit() else int(round(dur * fps))
    return w, h, fps, frames


def extract_frame(video: str, out_png: str, at: float = 0.0) -> str:
    out_path = Path(out_png)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    last_err = ""
    for ss_before in (True, False):
        cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
        if ss_before:
            cmd += ["-ss", f"{max(0.0, at):.3f}", "-i", str(video)]
        else:
            cmd += ["-i", str(video), "-ss", f"{max(0.0, at):.3f}"]
        cmd += ["-frames:v", "1", "-q:v", "2", str(out_path)]
        code, out = _run(cmd, timeout=90)
        last_err = out
        if code == 0 and out_path.exists() and out_path.stat().st_size > 0:
            return str(out_path)
    raise RuntimeError(f"Frame extract failed: {last_err[-300:] if last_err else 'no output'}")


def _blend_rect(img, y0, y1, rgb, alpha):
    h, w = img.shape[:2]
    y0, y1 = max(0, min(h, y0)), max(0, min(h, y1))
    if y1 <= y0:
        return
    patch = img[y0:y1].astype(np.float32)
    color = np.array(rgb, dtype=np.float32)
    img[y0:y1] = np.clip(patch * (1 - alpha) + color * alpha, 0, 255).astype(np.uint8)


def _draw_circle(img, cx, cy, r, rgb, fill=True, thickness=1):
    h, w = img.shape[:2]
    if r <= 0:
        return
    y0, y1 = max(0, cy - r - 1), min(h, cy + r + 2)
    x0, x1 = max(0, cx - r - 1), min(w, cx + r + 2)
    if y1 <= y0 or x1 <= x0:
        return
    yy, xx = np.ogrid[y0:y1, x0:x1]
    dist2 = (xx - cx) ** 2 + (yy - cy) ** 2
    if fill:
        img[y0:y1, x0:x1][dist2 <= r * r] = rgb
    else:
        outer = dist2 <= r * r
        inner = dist2 <= max(0, r - thickness) ** 2
        img[y0:y1, x0:x1][outer & ~inner] = rgb


def _draw_vline(img, x, y0, y1, rgb):
    h, w = img.shape[:2]
    if 0 <= x < w:
        y0, y1 = max(0, y0), min(h, y1)
        if y1 > y0:
            img[y0:y1, x] = rgb


def _compose_beatbar(frame, beats, t, *, color, bar_height_pct, margin_bottom_pct,
                     hit_zone_x_pct, circle_radius_pct, bar_opacity, lookahead, fps):
    img = frame
    h, w = img.shape[:2]
    bar_h = max(8, int(h * bar_height_pct / 100.0))
    margin = max(0, int(h * margin_bottom_pct / 100.0))
    bar_y0 = h - margin - bar_h
    bar_y1 = h - margin
    cy = (bar_y0 + bar_y1) // 2
    hit_x = int(w * hit_zone_x_pct / 100.0)
    radius = max(4, int(min(w, h) * circle_radius_pct / 100.0))
    lookahead = max(0.2, float(lookahead))

    _blend_rect(img, bar_y0, bar_y1, (0, 0, 0), bar_opacity)
    _draw_circle(img, hit_x, cy, radius + 4, (255, 255, 255), fill=False, thickness=2)
    _draw_vline(img, hit_x, bar_y0 + 2, bar_y1 - 2, (220, 220, 220))

    lo, hi = t, t + lookahead
    i0 = int(np.searchsorted(beats, lo, side="left"))
    i1 = int(np.searchsorted(beats, hi, side="right"))
    for bi in range(i0, i1):
        bt = float(beats[bi])
        frac = (bt - t) / lookahead
        x = int(hit_x + frac * (w - hit_x))
        _draw_circle(img, x, cy, radius, color, fill=True)
        _draw_circle(img, x, cy, radius, (255, 255, 255), fill=False, thickness=1)

    hit_tol = 0.5 / max(fps, 1)
    for bi in range(max(0, i0 - 2), min(len(beats), i0 + 3)):
        if abs(float(beats[bi]) - t) < hit_tol:
            _draw_circle(img, hit_x, cy, radius + 2, color, fill=True)
            break
    return img


def draw_preview(frame_png, out_png, color="#ff4da6", bar_height_pct=10.0,
                 margin_bottom_pct=4.0, hit_zone_x_pct=50.0, circle_radius_pct=1.8,
                 bar_opacity=0.55, sample_positions=None):
    rgb = _hex_to_rgb(color)
    sample_positions = sample_positions or [0.15, 0.4, 0.65, 0.9]
    try:
        from PIL import Image
        arr = np.array(Image.open(frame_png).convert("RGB"))
    except Exception:
        arr = _ffmpeg_read_still(frame_png)

    h, w = arr.shape[:2]
    bar_h = max(8, int(h * bar_height_pct / 100.0))
    margin = max(0, int(h * margin_bottom_pct / 100.0))
    bar_y0, bar_y1 = h - margin - bar_h, h - margin
    cy = (bar_y0 + bar_y1) // 2
    hit_x = int(w * hit_zone_x_pct / 100.0)
    radius = max(4, int(min(w, h) * circle_radius_pct / 100.0))

    _blend_rect(arr, bar_y0, bar_y1, (0, 0, 0), bar_opacity)
    _draw_circle(arr, hit_x, cy, radius + 4, (255, 255, 255), fill=False, thickness=2)
    _draw_vline(arr, hit_x, bar_y0 + 2, bar_y1 - 2, (255, 255, 255))
    for frac in sample_positions:
        x = int(hit_x + frac * (w - hit_x))
        _draw_circle(arr, x, cy, radius, rgb, fill=True)
        _draw_circle(arr, x, cy, radius, (255, 255, 255), fill=False, thickness=1)
    _draw_circle(arr, hit_x, cy, radius, rgb, fill=True)

    try:
        from PIL import Image
        Image.fromarray(arr).save(out_png, quality=92)
    except Exception:
        _ffmpeg_write_still(arr, out_png)
    return out_png


def _ffmpeg_read_still(path):
    code, out = _run([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "json", path,
    ], timeout=15)
    data = json.loads(out)
    w, h = int(data["streams"][0]["width"]), int(data["streams"][0]["height"])
    p = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", path,
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True, timeout=30,
    )
    if p.returncode != 0:
        raise RuntimeError("Could not read still")
    return np.frombuffer(p.stdout, dtype=np.uint8).reshape((h, w, 3)).copy()


def _ffmpeg_write_still(arr, path):
    h, w = arr.shape[:2]
    p = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-i", "-",
         "-frames:v", "1", "-q:v", "2", path],
        input=arr.tobytes(), capture_output=True, timeout=30,
    )
    if p.returncode != 0:
        raise RuntimeError("Could not write still")


def _make_click_wav(preset, custom, dest: Path) -> Path:
    sr = 44100
    if preset == "custom" and custom and Path(custom).exists():
        out = dest.with_suffix(".wav")
        code, _ = _run(["ffmpeg", "-hide_banner", "-y", "-i", custom, "-ac", "1", "-ar", str(sr), str(out)], timeout=60)
        if code == 0 and out.exists():
            return out
    t = np.linspace(0, 0.04, int(sr * 0.04), endpoint=False)
    if preset == "wood":
        sig = np.sin(2 * np.pi * 800 * t) * np.exp(-t * 80)
        sig += 0.4 * np.sin(2 * np.pi * 400 * t) * np.exp(-t * 60)
    elif preset == "kick":
        t = np.linspace(0, 0.08, int(sr * 0.08), endpoint=False)
        sig = np.sin(2 * np.pi * (120 * np.exp(-t * 30)) * t) * np.exp(-t * 25)
    else:
        noise = np.random.randn(len(t)) * 0.3
        sig = np.sin(2 * np.pi * 2000 * t) * np.exp(-t * 120) + noise * np.exp(-t * 100)
    sig = sig / (np.max(np.abs(sig)) + 1e-9) * 0.9
    dest.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(dest), "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes((sig * 32767).astype(np.int16).tobytes())
    return dest


def _mix_clicks(video, beats, click_wav: Path, volume, out_wav: Path, duration) -> Path:
    song = out_wav.parent / "song_extract.wav"
    code, out = _run(["ffmpeg", "-hide_banner", "-y", "-i", video, "-vn", "-ac", "2", "-ar", "44100", str(song)], timeout=300)
    if code != 0:
        raise RuntimeError(f"Audio extract failed: {out[-300:]}")
    if not beats or volume <= 0:
        return song
    sr = 44100
    n = int(math.ceil(duration * sr)) + sr
    track = np.zeros(n, dtype=np.float32)
    with wave.open(str(click_wav), "r") as wf:
        click = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
        click_sr = wf.getframerate()
    if click_sr != sr:
        x_old = np.linspace(0, 1, len(click))
        x_new = np.linspace(0, 1, int(len(click) * sr / click_sr))
        click = np.interp(x_new, x_old, click).astype(np.float32)
    click *= float(np.clip(volume, 0, 1))
    for b in beats:
        pos = int(b * sr)
        if 0 <= pos < n:
            end = min(n, pos + len(click))
            track[pos:end] += click[: end - pos]
    track = np.clip(track, -1, 1)
    click_track = out_wav.parent / "clicks.wav"
    with wave.open(str(click_track), "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes((track * 32767).astype(np.int16).tobytes())
    code, out = _run([
        "ffmpeg", "-hide_banner", "-y", "-i", str(song), "-i", str(click_track),
        "-filter_complex", "amix=inputs=2:duration=first:dropout_transition=0,volume=1.2",
        "-ac", "2", "-ar", "44100", str(out_wav),
    ], timeout=300)
    if code != 0:
        raise RuntimeError(f"Audio mix failed: {out[-300:]}")
    return out_wav


def render_cockhero(options: CockHeroOptions, progress_cb=None) -> CockHeroResult:
    import time
    t0 = time.time()
    logs: List[str] = []

    def prog(msg, pct):
        logs.append(msg)
        if progress_cb:
            progress_cb(msg, pct)

    try:
        video = Path(options.video_path)
        if not video.exists():
            return CockHeroResult(False, message=f"Video not found: {video}")

        beats = load_beats(options.beats_path, options.beat_mode, options.thin_dist)
        if not beats:
            return CockHeroResult(False, message="No beats found")

        duration = media_duration(str(video))
        w, h, src_fps, total_frames = probe_video(str(video))
        work = get_temp_dir() / "cockhero_work" / f"ch_{os.getpid()}_{int(t0)}"
        work.mkdir(parents=True, exist_ok=True)
        prog(f"Loaded {len(beats)} beats · {w}x{h} @ {src_fps:.2f}fps · {duration:.1f}s", 0.05)

        audio_path = work / "audio.wav"
        if options.sound_enabled:
            click = _make_click_wav(options.sound_preset, options.custom_sound, work / "click.wav")
            _mix_clicks(str(video), beats, click, options.sound_volume, audio_path, duration)
            prog("Click track mixed", 0.1)
        else:
            code, out = _run(["ffmpeg", "-hide_banner", "-y", "-i", str(video), "-vn", "-ac", "2", "-ar", "44100", str(audio_path)], timeout=300)
            if code != 0:
                return CockHeroResult(False, message=f"Audio extract failed: {out[-200:]}", logs=logs)

        color = _hex_to_rgb(options.circle_color)
        beats_arr = np.array(beats, dtype=np.float64)

        dec = subprocess.Popen(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(video),
             "-f", "rawvideo", "-pix_fmt", "rgb24", "-an", "-"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        raw_out = work / "video_no_audio.mp4"
        encoder = "h264_nvenc" if options.cuda else "libx264"
        enc = subprocess.Popen(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
             "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", f"{src_fps}",
             "-i", "-", "-c:v", encoder, "-pix_fmt", "yuv420p", "-an", str(raw_out)],
            stdin=subprocess.PIPE, stderr=subprocess.PIPE,
        )

        frame_size = w * h * 3
        frame_i = 0
        prog("Rendering beatbar…", 0.12)
        assert dec.stdout is not None and enc.stdin is not None
        while True:
            buf = dec.stdout.read(frame_size)
            if not buf or len(buf) < frame_size:
                break
            frame = np.frombuffer(buf, dtype=np.uint8).reshape((h, w, 3)).copy()
            t = frame_i / src_fps
            _compose_beatbar(
                frame, beats_arr, t, color=color,
                bar_height_pct=options.bar_height_pct,
                margin_bottom_pct=options.margin_bottom_pct,
                hit_zone_x_pct=options.hit_zone_x_pct,
                circle_radius_pct=options.circle_radius_pct,
                bar_opacity=options.bar_opacity,
                lookahead=options.lookahead,
                fps=src_fps,
            )
            try:
                enc.stdin.write(frame.tobytes())
            except BrokenPipeError:
                break
            frame_i += 1
            if frame_i % 30 == 0 and total_frames > 0:
                prog(f"Rendering… {frame_i}/{total_frames}", 0.12 + 0.7 * min(1.0, frame_i / max(total_frames, 1)))

        dec.stdout.close()
        enc.stdin.close()
        dec.wait(timeout=60)
        enc_err = enc.stderr.read().decode("utf-8", errors="ignore") if enc.stderr else ""
        enc_code = enc.wait(timeout=120)
        if enc_code != 0 or not raw_out.exists():
            return CockHeroResult(False, message=f"Encode failed: {enc_err[-400:]}", logs=logs, elapsed=time.time() - t0)

        prog("Muxing audio…", 0.9)
        out_path = Path(options.output_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        code, out = _run([
            "ffmpeg", "-hide_banner", "-y",
            "-i", str(raw_out), "-i", str(audio_path),
            "-map", "0:v", "-map", "1:a", "-c:v", "copy",
            "-c:a", "aac", "-b:a", "192k", "-shortest", str(out_path),
        ], timeout=1200)
        if code != 0 or not out_path.exists():
            return CockHeroResult(False, message=f"Mux failed: {out[-400:]}", logs=logs, elapsed=time.time() - t0)

        elapsed = time.time() - t0
        prog(f"Done in {elapsed:.1f}s", 1.0)
        return CockHeroResult(True, output_video=str(out_path), message=f"Cock Hero ready · {elapsed:.1f}s", logs=logs, elapsed=elapsed)
    except Exception as e:
        return CockHeroResult(False, message=str(e), logs=logs, elapsed=time.time() - t0)
    finally:
        try:
            if load_settings().get("auto_cleanup_after_job", True):
                wd = locals().get("work")
                if wd is not None:
                    cleanup_after_ch_job(wd)
        except Exception:
            pass
