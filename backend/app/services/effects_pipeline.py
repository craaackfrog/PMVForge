"""
Beat-synced visual effects post-pass.

Static looks (pink glow) → ffmpeg filters.
Timed looks (pulse, flash, punch, RGB) → frame pipeline (numpy + ffmpeg pipes)
so long beatmaps work without giant enable= expressions or fragile sendcmd.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np


@dataclass
class EffectsOptions:
    enabled: bool = False

    soft_pulse: bool = True
    soft_pulse_strength: float = 0.7
    soft_pulse_ms: float = 150

    flash: bool = False
    flash_strength: float = 0.55
    flash_ms: float = 40
    flash_max_per_sec: float = 8.0

    zoom_punch: bool = True
    zoom_punch_amount: float = 5.06
    zoom_punch_ms: float = 150

    rgb_split: bool = False
    rgb_split_px: float = 8.0
    rgb_split_ms: float = 120

    pink_glow: bool = False
    pink_glow_strength: float = 0.35
    pink_glow_saturation: float = 1.15


    def to_dict(self) -> dict:
        return asdict(self)


def _run(cmd: List[str], timeout: int = 7200) -> Tuple[int, str]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except subprocess.TimeoutExpired:
        return 1, "timeout"
    except Exception as e:
        return 1, str(e)


def _thin_beats(beats: List[float], max_per_sec: float) -> np.ndarray:
    if not beats:
        return np.array([], dtype=np.float64)
    if max_per_sec <= 0:
        return np.array(beats, dtype=np.float64)
    min_gap = 1.0 / max_per_sec
    out: List[float] = []
    last = -1e9
    for b in beats:
        if b - last >= min_gap:
            out.append(float(b))
            last = b
    return np.array(out, dtype=np.float64)


def _near_beat(t: float, beats: np.ndarray, half_win: float) -> bool:
    if beats.size == 0 or half_win <= 0:
        return False
    # binary search nearest
    i = int(np.searchsorted(beats, t))
    for j in (i - 1, i, i + 1):
        if 0 <= j < beats.size and abs(float(beats[j]) - t) <= half_win:
            return True
    return False


def _build_static_vf(opts: EffectsOptions) -> str:
    filters: List[str] = []
    if opts.pink_glow and opts.pink_glow_strength > 0:
        s = max(0.0, min(1.0, float(opts.pink_glow_strength)))
        sat = max(0.5, min(2.0, float(opts.pink_glow_saturation)))
        filters.append(
            f"colorbalance=rs={0.15 * s:.3f}:gs={-0.05 * s:.3f}:bs={0.08 * s:.3f}:"
            f"rm={0.20 * s:.3f}:gm={-0.08 * s:.3f}:bm={0.12 * s:.3f}:"
            f"rh={0.18 * s:.3f}:gh={-0.06 * s:.3f}:bh={0.10 * s:.3f}"
        )
        filters.append(f"eq=saturation={sat:.3f}:brightness={0.04 * s:.3f}")
        filters.append(f"vignette=PI/{max(2.5, 4 + 2 * (1 - s)):.2f}")

    if not filters:
        return ""
    filters.append("format=yuv420p")
    return ",".join(filters)


def _has_timed(opts: EffectsOptions) -> bool:
    return bool(
        opts.soft_pulse
        or opts.flash
        or opts.zoom_punch
        or opts.rgb_split
    )


def _ffmpeg_static_pass(src: str, dst: str, vf: str, cuda: bool, bitrate: str) -> None:
    if not vf:
        code, out = _run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", src, "-c", "copy", dst,
        ], timeout=600)
        if code != 0:
            raise RuntimeError(f"copy failed: {out[-300:]}")
        return
    if cuda:
        cmd = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", src, "-vf", vf,
            "-c:v", "h264_nvenc", "-b:v", bitrate,
            "-c:a", "copy", "-movflags", "+faststart", dst,
        ]
    else:
        cmd = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", src, "-vf", vf,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
            "-c:a", "copy", "-movflags", "+faststart", dst,
        ]
    code, out = _run(cmd, timeout=7200)
    if code != 0 or not Path(dst).exists():
        raise RuntimeError(f"static effects failed: {out[-500:]}")


def _probe(path: str) -> Tuple[int, int, float]:
    code, out = _run([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate",
        "-of", "json", path,
    ], timeout=30)
    if code != 0:
        raise RuntimeError(f"ffprobe failed: {out[-200:]}")
    data = json.loads(out)
    st = data["streams"][0]
    w, h = int(st["width"]), int(st["height"])
    rate = st.get("r_frame_rate", "30/1")
    if "/" in rate:
        a, b = rate.split("/")
        fps = float(a) / max(float(b), 1e-6)
    else:
        fps = float(rate) or 30.0
    return w, h, fps


def _rgb_shift(frame: np.ndarray, px: int) -> np.ndarray:
    """Simple horizontal channel shift (R right, B left)."""
    if px <= 0:
        return frame
    out = frame.copy()
    # R channel
    out[:, px:, 0] = frame[:, :-px, 0]
    out[:, :px, 0] = frame[:, :px, 0]
    # B channel
    out[:, :-px, 2] = frame[:, px:, 2]
    out[:, -px:, 2] = frame[:, -px:, 2]
    return out


def _apply_timed_frames(
    src: str,
    dst: str,
    beats: List[float],
    opts: EffectsOptions,
    *,
    cuda: bool,
    bitrate: str,
) -> None:
    w, h, fps = _probe(src)
    pulse_beats = _thin_beats(beats, 6.0)
    flash_beats = _thin_beats(beats, min(8.0, max(1.0, opts.flash_max_per_sec))) if opts.flash else np.array([])

    pulse_half = max(0.02, opts.soft_pulse_ms / 2000.0)
    flash_half = max(0.015, opts.flash_ms / 2000.0)
    punch_half = max(0.02, opts.zoom_punch_ms / 2000.0)
    rgb_half = max(0.02, opts.rgb_split_ms / 2000.0)

    pulse_amt = max(0.0, min(0.6, float(opts.soft_pulse_strength)))
    flash_amt = max(0.0, min(1.0, float(opts.flash_strength)))
    punch_c = max(1.0, min(1.25, float(opts.zoom_punch_amount)))  # use as contrast proxy
    rgb_px = int(max(1, min(16, float(opts.rgb_split_px))))

    dec = subprocess.Popen(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-i", src,
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-an", "-",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    raw_out = Path(dst).with_suffix(".timed.mp4")
    encoder = "h264_nvenc" if cuda else "libx264"
    enc_cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s", f"{w}x{h}", "-r", f"{fps}",
        "-i", "-",
        "-c:v", encoder, "-pix_fmt", "yuv420p",
        "-an", str(raw_out),
    ]
    if not cuda:
        enc_cmd = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "rawvideo", "-pix_fmt", "rgb24",
            "-s", f"{w}x{h}", "-r", f"{fps}",
            "-i", "-",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
            "-pix_fmt", "yuv420p", "-an", str(raw_out),
        ]
    enc = subprocess.Popen(enc_cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)

    frame_size = w * h * 3
    frame_i = 0
    assert dec.stdout is not None and enc.stdin is not None

    while True:
        buf = dec.stdout.read(frame_size)
        if not buf or len(buf) < frame_size:
            break
        frame = np.frombuffer(buf, dtype=np.uint8).reshape((h, w, 3)).copy()
        t = frame_i / fps

        if opts.soft_pulse and pulse_amt > 0 and _near_beat(t, pulse_beats, pulse_half):
            # lift toward white
            frame = np.clip(frame.astype(np.float32) + 255.0 * pulse_amt, 0, 255).astype(np.uint8)

        if opts.flash and flash_amt > 0 and _near_beat(t, flash_beats, flash_half):
            frame = np.clip(frame.astype(np.float32) + 255.0 * flash_amt, 0, 255).astype(np.uint8)

        if opts.zoom_punch and _near_beat(t, pulse_beats, punch_half):
            # contrast around mid-gray
            f = frame.astype(np.float32)
            f = (f - 128.0) * punch_c + 128.0
            frame = np.clip(f, 0, 255).astype(np.uint8)

        if opts.rgb_split and _near_beat(t, pulse_beats, rgb_half):
            frame = _rgb_shift(frame, rgb_px)

        try:
            enc.stdin.write(frame.tobytes())
        except BrokenPipeError:
            break
        frame_i += 1

    dec.stdout.close()
    enc.stdin.close()
    dec.wait(timeout=60)
    enc_err = enc.stderr.read().decode("utf-8", errors="ignore") if enc.stderr else ""
    enc_code = enc.wait(timeout=120)
    if enc_code != 0 or not raw_out.exists():
        raise RuntimeError(f"timed encode failed: {enc_err[-400:]}")

    # mux original audio back
    code, out = _run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(raw_out),
        "-i", src,
        "-map", "0:v:0", "-map", "1:a:0?",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        "-movflags", "+faststart",
        dst,
    ], timeout=1200)
    try:
        raw_out.unlink(missing_ok=True)
    except Exception:
        pass
    if code != 0 or not Path(dst).exists():
        raise RuntimeError(f"timed mux failed: {out[-400:]}")


def apply_effects(
    input_video: str,
    output_video: str,
    beats: List[float],
    opts: EffectsOptions,
    *,
    cuda: bool = False,
    bitrate: str = "6M",
    work_dir: Optional[str] = None,
) -> None:
    if not opts.enabled:
        if Path(input_video).resolve() != Path(output_video).resolve():
            code, out = _run([
                "ffmpeg", "-hide_banner", "-y", "-i", input_video,
                "-c", "copy", output_video,
            ], timeout=600)
            if code != 0:
                raise RuntimeError(f"Effects copy failed: {out[-300:]}")
        return

    work = Path(work_dir) if work_dir else Path(output_video).parent
    work.mkdir(parents=True, exist_ok=True)

    static_vf = _build_static_vf(opts)
    has_timed = _has_timed(opts)
    has_static = bool(static_vf)

    if not has_timed and not has_static:
        # nothing selected
        code, out = _run([
            "ffmpeg", "-hide_banner", "-y", "-i", input_video,
            "-c", "copy", output_video,
        ], timeout=600)
        if code != 0:
            raise RuntimeError(out[-300:])
        return

    current = input_video

    # 1) static look
    if has_static:
        static_path = str(work / "fx_static.mp4")
        _ffmpeg_static_pass(current, static_path, static_vf, cuda, bitrate)
        current = static_path

    # 2) timed beat effects
    if has_timed:
        timed_path = str(work / "fx_timed.mp4")
        _apply_timed_frames(current, timed_path, beats, opts, cuda=cuda, bitrate=bitrate)
        current = timed_path

    # move to output
    if Path(current).resolve() != Path(output_video).resolve():
        import shutil
        shutil.move(current, output_video)
