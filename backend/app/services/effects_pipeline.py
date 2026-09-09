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
    zoom_punch_amount: float = 1.06
    zoom_punch_ms: float = 150

    rgb_split: bool = False
    rgb_split_px: float = 8.0
    rgb_split_ms: float = 120
    rgb_split_static: bool = False

    # Diffuse glow (tint + brightness / contrast) — was pink_glow
    diffuse_glow: bool = False
    diffuse_glow_color: str = "#ff4da6"
    diffuse_glow_strength: float = 0.35
    diffuse_glow_saturation: float = 1.15
    diffuse_glow_brightness: float = 0.04
    diffuse_glow_contrast: float = 1.0

    # Backward-compat aliases still accepted when parsing from dict
    pink_glow: bool = False
    pink_glow_strength: float = 0.35
    pink_glow_saturation: float = 1.15

    vignette: bool = False
    vignette_intensity: float = 0.5
    vignette_color: str = "#000000"

    chromatic_aberration: bool = False
    chromatic_aberration_amount: float = 1.5

    camera_sway: bool = False
    camera_sway_amount: float = 6.0
    camera_sway_speed: float = 0.7

    def to_dict(self) -> dict:
        return asdict(self)


def effects_from_dict(fx_raw: dict) -> EffectsOptions:
    """Build EffectsOptions from a frontend / API dict (with legacy keys)."""
    fx_raw = fx_raw or {}
    diffuse = bool(fx_raw.get("diffuse_glow", fx_raw.get("pink_glow", False)))
    return EffectsOptions(
        enabled=bool(fx_raw.get("enabled", True)),
        soft_pulse=bool(fx_raw.get("soft_pulse", True)),
        soft_pulse_strength=float(fx_raw.get("soft_pulse_strength", 0.7)),
        soft_pulse_ms=float(fx_raw.get("soft_pulse_ms", 150)),
        flash=bool(fx_raw.get("flash", False)),
        flash_strength=float(fx_raw.get("flash_strength", 0.55)),
        flash_ms=float(fx_raw.get("flash_ms", 40)),
        flash_max_per_sec=float(fx_raw.get("flash_max_per_sec", 8)),
        zoom_punch=bool(fx_raw.get("zoom_punch", True)),
        zoom_punch_amount=float(fx_raw.get("zoom_punch_amount", 1.06)),
        zoom_punch_ms=float(fx_raw.get("zoom_punch_ms", 150)),
        rgb_split=bool(fx_raw.get("rgb_split", False)),
        rgb_split_px=float(fx_raw.get("rgb_split_px", 8)),
        rgb_split_ms=float(fx_raw.get("rgb_split_ms", 120)),
        rgb_split_static=bool(fx_raw.get("rgb_split_static", False)),
        diffuse_glow=diffuse,
        diffuse_glow_color=str(fx_raw.get("diffuse_glow_color", "#ff4da6")),
        diffuse_glow_strength=float(
            fx_raw.get("diffuse_glow_strength", fx_raw.get("pink_glow_strength", 0.35))
        ),
        diffuse_glow_saturation=float(
            fx_raw.get("diffuse_glow_saturation", fx_raw.get("pink_glow_saturation", 1.15))
        ),
        diffuse_glow_brightness=float(fx_raw.get("diffuse_glow_brightness", 0.04)),
        diffuse_glow_contrast=float(fx_raw.get("diffuse_glow_contrast", 1.0)),
        vignette=bool(fx_raw.get("vignette", False)),
        vignette_intensity=float(fx_raw.get("vignette_intensity", 0.5)),
        vignette_color=str(fx_raw.get("vignette_color", "#000000")),
        chromatic_aberration=bool(fx_raw.get("chromatic_aberration", False)),
        chromatic_aberration_amount=float(fx_raw.get("chromatic_aberration_amount", 1.5)),
        camera_sway=bool(fx_raw.get("camera_sway", False)),
        camera_sway_amount=float(fx_raw.get("camera_sway_amount", 6.0)),
        camera_sway_speed=float(fx_raw.get("camera_sway_speed", 0.7)),
    )


def _parse_hex_color(color: str) -> Tuple[float, float, float]:
    """Return RGB in 0..1."""
    h = (color or "#ffffff").strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        return 1.0, 1.0, 1.0
    try:
        r = int(h[0:2], 16) / 255.0
        g = int(h[2:4], 16) / 255.0
        b = int(h[4:6], 16) / 255.0
        return r, g, b
    except Exception:
        return 1.0, 1.0, 1.0


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

    glow_on = bool(opts.diffuse_glow or opts.pink_glow)
    if glow_on:
        s = float(opts.diffuse_glow_strength if opts.diffuse_glow else opts.pink_glow_strength)
        sat = float(
            opts.diffuse_glow_saturation if opts.diffuse_glow else opts.pink_glow_saturation
        )
        bri = float(getattr(opts, "diffuse_glow_brightness", 0.04))
        con = float(getattr(opts, "diffuse_glow_contrast", 1.0))
        cr, cg, cb = _parse_hex_color(getattr(opts, "diffuse_glow_color", "#ff4da6"))
        # shift midtones toward chosen color, scaled by strength (no hard clamp)
        rs = (cr - 0.5) * s * 0.9
        gs = (cg - 0.5) * s * 0.9
        bs = (cb - 0.5) * s * 0.9
        filters.append(
            f"colorbalance=rs={rs:.4f}:gs={gs:.4f}:bs={bs:.4f}:"
            f"rm={rs:.4f}:gm={gs:.4f}:bm={bs:.4f}:"
            f"rh={rs * 0.8:.4f}:gh={gs * 0.8:.4f}:bh={bs * 0.8:.4f}"
        )
        filters.append(
            f"eq=saturation={sat:.4f}:brightness={bri:.4f}:contrast={con:.4f}"
        )

    if opts.vignette and float(opts.vignette_intensity) > 0:
        inten = float(opts.vignette_intensity)
        # larger intensity → stronger darkening (smaller PI divisor)
        angle = max(0.35, 5.5 - inten * 3.5)
        filters.append(f"vignette=PI/{angle:.3f}")
        vr, vg, vb = _parse_hex_color(opts.vignette_color)
        # mild edge color bias when vignette color isn't pure black
        if (vr + vg + vb) > 0.05:
            vs = min(1.5, inten) * 0.25
            filters.append(
                f"colorbalance=rs={(vr - 0.5) * vs:.4f}:gs={(vg - 0.5) * vs:.4f}:bs={(vb - 0.5) * vs:.4f}"
            )

    if opts.rgb_split and opts.rgb_split_static:
        px = int(round(float(opts.rgb_split_px)))
        if px != 0:
            # chromashift: rh/bh in pixels (ffmpeg filter)
            filters.append(f"rgbashift=rh={px}:bh={-px}:rv=0:bv=0")

    if not filters:
        return ""
    filters.append("format=yuv420p")
    return ",".join(filters)


def _has_timed(opts: EffectsOptions) -> bool:
    rgb_timed = bool(opts.rgb_split) and not bool(opts.rgb_split_static)
    return bool(
        opts.soft_pulse
        or opts.flash
        or opts.zoom_punch
        or rgb_timed
        or opts.chromatic_aberration
        or opts.camera_sway
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
    br = _resolve_bitrate(bitrate, src)
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", src, "-vf", vf,
        *_video_encode_args(cuda, br),
        "-c:a", "copy", "-movflags", "+faststart", dst,
    ]
    code, out = _run(cmd, timeout=7200)
    if code != 0 or not Path(dst).exists():
        raise RuntimeError(f"static effects failed: {out[-500:]}")


def _probe_bitrate(path: str) -> Optional[str]:
    """Return a ffmpeg -b:v style string from the source stream, or None."""
    code, out = _run([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=bit_rate:format=bit_rate",
        "-of", "json", path,
    ], timeout=30)
    if code != 0:
        return None
    try:
        data = json.loads(out)
        br = None
        if data.get("streams"):
            br = data["streams"][0].get("bit_rate")
        if not br or br in ("N/A", "0"):
            br = (data.get("format") or {}).get("bit_rate")
        if not br or br in ("N/A", "0"):
            return None
        bps = int(float(br))
        if bps <= 0:
            return None
        # express as k or M for ffmpeg
        if bps >= 1_000_000:
            return f"{max(1, int(round(bps / 1_000_000)))}M"
        return f"{max(100, int(round(bps / 1000)))}k"
    except Exception:
        return None


def _resolve_bitrate(requested: str, src: str) -> str:
    """Prefer explicit request; otherwise keep source bitrate; floor at 8M for quality."""
    req = (requested or "").strip()
    src_br = _probe_bitrate(src)
    if req:
        return req
    if src_br:
        return src_br
    return "12M"


def _video_encode_args(cuda: bool, bitrate: str) -> list:
    """High-quality encode args that honor bitrate (no destructive CRF defaults)."""
    if cuda:
        return [
            "-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr",
            "-b:v", bitrate, "-maxrate", bitrate, "-bufsize", _bufsize(bitrate),
            "-pix_fmt", "yuv420p",
        ]
    return [
        "-c:v", "libx264", "-preset", "medium", "-b:v", bitrate,
        "-maxrate", bitrate, "-bufsize", _bufsize(bitrate),
        "-pix_fmt", "yuv420p",
    ]


def _bufsize(bitrate: str) -> str:
    s = bitrate.strip().lower()
    try:
        if s.endswith("m"):
            return f"{max(1, int(float(s[:-1]) * 2))}M"
        if s.endswith("k"):
            return f"{max(100, int(float(s[:-1]) * 2))}k"
    except Exception:
        pass
    return "16M"


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
    """Horizontal channel shift (R right, B left). px may be large."""
    px = int(px)
    if px == 0:
        return frame
    if px < 0:
        px = -px
        # swap direction
        out = frame.copy()
        out[:, :-px, 0] = frame[:, px:, 0]
        out[:, -px:, 0] = frame[:, -px:, 0]
        out[:, px:, 2] = frame[:, :-px, 2]
        out[:, :px, 2] = frame[:, :px, 2]
        return out
    out = frame.copy()
    out[:, px:, 0] = frame[:, :-px, 0]
    out[:, :px, 0] = frame[:, :px, 0]
    out[:, :-px, 2] = frame[:, px:, 2]
    out[:, -px:, 2] = frame[:, -px:, 2]
    return out


def _chromatic_aberration(frame: np.ndarray, amount: float) -> np.ndarray:
    """Radial chromatic aberration: R zooms out, B zooms in from center."""
    amount = float(amount)
    if abs(amount) < 0.001:
        return frame
    h, w = frame.shape[:2]
    # scale factors — amount in ~pixels at the edge
    # convert to relative scale: edge shift ≈ amount px → scale = 1 + amount/(0.5*diag)
    diag = 0.5 * (w ** 2 + h ** 2) ** 0.5
    delta = amount / max(diag, 1.0)
    scale_r = 1.0 + delta
    scale_b = max(0.5, 1.0 - delta)

    def _scale_channel(ch: np.ndarray, scale: float) -> np.ndarray:
        if abs(scale - 1.0) < 1e-4:
            return ch
        nh = max(2, int(h / scale))
        nw = max(2, int(w / scale))
        nh -= nh % 2
        nw -= nw % 2
        nh = max(2, min(h, nh))
        nw = max(2, min(w, nw))
        y0 = (h - nh) // 2
        x0 = (w - nw) // 2
        crop = ch[y0:y0 + nh, x0:x0 + nw]
        ys = (np.linspace(0, nh - 1, h)).astype(np.int32)
        xs = (np.linspace(0, nw - 1, w)).astype(np.int32)
        return crop[ys][:, xs]

    out = frame.copy()
    out[:, :, 0] = _scale_channel(frame[:, :, 0], scale_r)
    out[:, :, 2] = _scale_channel(frame[:, :, 2], scale_b)
    return out


def _camera_sway(frame: np.ndarray, t: float, amount: float, speed: float) -> np.ndarray:
    """Handheld-like crop sway. amount ≈ max pixel shift."""
    amount = float(amount)
    speed = float(speed) if speed else 0.7
    if abs(amount) < 0.01:
        return frame
    h, w = frame.shape[:2]
    # keep a margin so we can shift
    margin = int(min(w, h, max(2, abs(amount) * 2)))
    if margin < 2 or w <= margin * 2 or h <= margin * 2:
        return frame
    ox = int(round(amount * np.sin(2 * np.pi * speed * t)))
    oy = int(round(amount * 0.65 * np.cos(2 * np.pi * speed * 0.83 * t)))
    ox = int(max(-margin, min(margin, ox)))
    oy = int(max(-margin, min(margin, oy)))
    # center crop then offset
    cw, ch_ = w - 2 * margin, h - 2 * margin
    x0 = margin + ox
    y0 = margin + oy
    x0 = max(0, min(w - cw, x0))
    y0 = max(0, min(h - ch_, y0))
    crop = frame[y0:y0 + ch_, x0:x0 + cw]
    ys = (np.linspace(0, ch_ - 1, h)).astype(np.int32)
    xs = (np.linspace(0, cw - 1, w)).astype(np.int32)
    return crop[ys][:, xs]


def _apply_timed_frames(
    src: str,
    dst: str,
    beats: List[float],
    opts: EffectsOptions,
    *,
    cuda: bool,
    bitrate: str,
    progress_cb=None,
) -> None:
    w, h, fps = _probe(src)
    pulse_beats = _thin_beats(beats, 6.0)
    flash_beats = _thin_beats(beats, min(8.0, max(1.0, opts.flash_max_per_sec))) if opts.flash else np.array([])

    pulse_half = max(0.02, opts.soft_pulse_ms / 2000.0)
    flash_half = max(0.015, opts.flash_ms / 2000.0)
    punch_half = max(0.02, opts.zoom_punch_ms / 2000.0)
    rgb_half = max(0.02, opts.rgb_split_ms / 2000.0)

    pulse_amt = max(0.0, float(opts.soft_pulse_strength))
    flash_amt = max(0.0, float(opts.flash_strength))
    # zoom_punch_amount applied per-frame as scale
    rgb_px = int(round(float(opts.rgb_split_px)))
    rgb_timed = bool(opts.rgb_split) and not bool(opts.rgb_split_static)
    ca_amt = float(getattr(opts, "chromatic_aberration_amount", 0.0) or 0.0)
    sway_amp = float(getattr(opts, "camera_sway_amount", 0.0) or 0.0)
    sway_spd = float(getattr(opts, "camera_sway_speed", 0.7) or 0.7)

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
    br = _resolve_bitrate(bitrate, src)
    enc_cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s", f"{w}x{h}", "-r", f"{fps}",
        "-i", "-",
        *_video_encode_args(cuda, br),
        "-an", str(raw_out),
    ]
    enc = subprocess.Popen(enc_cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)

    frame_size = w * h * 3
    frame_i = 0
    assert dec.stdout is not None and enc.stdin is not None

    # estimate total frames from duration for progress
    total_frames = None
    try:
        code_d, out_d = _run([
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", src,
        ], timeout=20)
        if code_d == 0 and out_d.strip():
            total_frames = max(1, int(float(out_d.strip()) * fps))
    except Exception:
        total_frames = None

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
            scale = max(1.0, float(opts.zoom_punch_amount))
            if scale > 1.001:
                nh, nw = int(h / scale), int(w / scale)
                nh -= nh % 2
                nw -= nw % 2
                nh = max(2, nh)
                nw = max(2, nw)
                if nh < h and nw < w:
                    y0 = (h - nh) // 2
                    x0 = (w - nw) // 2
                    crop = frame[y0:y0 + nh, x0:x0 + nw]
                    ys = (np.linspace(0, nh - 1, h)).astype(np.int32)
                    xs = (np.linspace(0, nw - 1, w)).astype(np.int32)
                    frame = crop[ys][:, xs]

        if rgb_timed and rgb_px != 0 and _near_beat(t, pulse_beats, rgb_half):
            frame = _rgb_shift(frame, abs(rgb_px))

        if opts.chromatic_aberration and abs(ca_amt) > 0.001:
            frame = _chromatic_aberration(frame, ca_amt)

        if opts.camera_sway and abs(sway_amp) > 0.01:
            frame = _camera_sway(frame, t, sway_amp, sway_spd)

        try:
            enc.stdin.write(frame.tobytes())
        except BrokenPipeError:
            break
        frame_i += 1
        if progress_cb and total_frames and frame_i % max(1, total_frames // 50) == 0:
            try:
                progress_cb(min(0.99, frame_i / total_frames))
            except Exception:
                pass

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
    progress_cb=None,
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
        def _timed_progress(frac: float):
            if progress_cb:
                # map timed pass into outer 0..1
                progress_cb(frac)
        _apply_timed_frames(
            current, timed_path, beats, opts, cuda=cuda, bitrate=bitrate,
            progress_cb=_timed_progress if progress_cb else None,
        )
        current = timed_path

    # move to output
    if Path(current).resolve() != Path(output_video).resolve():
        import shutil
        shutil.move(current, output_video)
