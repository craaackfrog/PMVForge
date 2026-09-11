"""
Beat detection & export service.
Refactored and cleaned version of the standalone script.
"""

from pathlib import Path
from typing import List, Dict, Any
import json
import numpy as np

try:
    import librosa
except ImportError as e:
    raise ImportError(
        "librosa is required for beat detection. "
        "Install it with: pip install librosa soundfile"
    ) from e


def load_audio_preview(audio_path: str) -> Dict[str, Any]:
    """
    Load audio for the editor: duration, estimated tempo, downsampled waveform.
    Does not run onset/beat detection.
    """
    y, sr = librosa.load(audio_path, sr=None, mono=True)
    duration = float(librosa.get_duration(y=y, sr=sr))

    tempo, _ = librosa.beat.beat_track(y=y, sr=sr, units="time")
    tempo_value = float(np.asarray(tempo).flat[0])

    target_points = 800
    hop = max(1, len(y) // target_points)
    waveform_y = y[::hop]
    waveform_t = librosa.frames_to_time(
        np.arange(len(waveform_y)), sr=sr, hop_length=hop
    )

    max_abs = np.max(np.abs(waveform_y)) or 1.0
    waveform_values = (waveform_y / max_abs).tolist()

    return {
        "tempo": round(tempo_value, 2),
        "duration": round(duration, 3),
        "waveform": {
            "times": [round(float(t), 3) for t in waveform_t],
            "values": [round(float(v), 4) for v in waveform_values],
        },
    }


def detect_beats_from_file(
    audio_path: str,
    min_gap: float = 0.30,
    include_onsets: bool = True,
) -> Dict[str, Any]:
    """
    Detect beats from an audio file.

    Returns:
        {
            "beats": [float, ...],          # seconds
            "tempo": float,                 # BPM
            "duration": float,              # seconds
            "waveform": {                   # downsampled for UI preview
                "times": [...],
                "values": [...]
            }
        }
    """
    y, sr = librosa.load(audio_path, sr=None, mono=True)
    duration = float(librosa.get_duration(y=y, sr=sr))

    # Beat tracking
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, units="time")
    beat_times = beat_frames.tolist() if hasattr(beat_frames, "tolist") else list(beat_frames)

    if include_onsets:
        onset_times = librosa.onset.onset_detect(
            y=y, sr=sr, units="time", backtrack=True
        )
        beat_times.extend(
            onset_times.tolist() if hasattr(onset_times, "tolist") else list(onset_times)
        )

    # Clean + deduplicate
    beat_times = sorted(set(round(float(t), 3) for t in beat_times if t >= 0))

    # Enforce minimum gap
    cleaned: List[float] = []
    last = -999.0
    for t in beat_times:
        if t - last >= min_gap:
            cleaned.append(t)
            last = t

    # Simple downsampled waveform for the frontend (max ~800 points)
    target_points = 800
    hop = max(1, len(y) // target_points)
    waveform_y = y[::hop]
    waveform_t = librosa.frames_to_time(
        np.arange(len(waveform_y)), sr=sr, hop_length=hop
    )

    # Normalize amplitude for display
    max_abs = np.max(np.abs(waveform_y)) or 1.0
    waveform_values = (waveform_y / max_abs).tolist()

    tempo_value = float(np.asarray(tempo).flat[0])

    return {
        "beats": cleaned,
        "tempo": round(tempo_value, 2),
        "duration": round(duration, 3),
        "waveform": {
            "times": [round(float(t), 3) for t in waveform_t],
            "values": [round(float(v), 4) for v in waveform_values],
        },
        "count": len(cleaned),
    }


def export_beats(
    beat_times: List[float],
    title: str,
    artist: str,
    creator: str = "PMVForge",
    fmt: str = "osu",
    output_dir: Path = None,
    job_id: str = "export",
    audio_filename: str = "",
    bpm: float = 0.0,
) -> Path:
    """
    Write beats to the requested format and return the output path.
    Supported fmt: "osu" | "txt"
    """
    if output_dir is None:
        from ..config import get_temp_dir
        output_dir = get_temp_dir() / "exports"

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    safe_title = "".join(c for c in title if c.isalnum() or c in " -_").strip() or "Untitled"
    base_name = f"{safe_title} [{creator}]"

    if fmt == "txt":
        out_path = output_dir / f"{base_name}.txt"
        with open(out_path, "w", encoding="utf-8") as f:
            for t in beat_times:
                f.write(f"{t:.3f}\n")
        return out_path

    # Default
    # Default → .osu
    out_path = output_dir / f"{base_name}.osu"
    _write_osu(
        beat_times=beat_times,
        title=title,
        artist=artist,
        creator=creator,
        output_path=out_path,
        audio_filename=audio_filename or "audio.ogg",
        bpm=float(bpm) if bpm and bpm > 0 else 0.0,
    )
    return out_path


def _write_osu(
    beat_times: List[float],
    title: str,
    artist: str,
    creator: str,
    output_path: Path,
    version: str = "AutoBeats",
    bpm: float = 0.0,
    audio_filename: str = "audio.ogg",
):
    times_ms = [int(round(t * 1000)) for t in beat_times]
    first_time = times_ms[0] if times_ms else 0
    # Prefer detected tempo; estimate from median gap if missing
    if not bpm or bpm <= 0:
        if len(beat_times) >= 2:
            gaps = [beat_times[i + 1] - beat_times[i] for i in range(len(beat_times) - 1)]
            gaps = [g for g in gaps if g > 0.05]
            if gaps:
                gaps_sorted = sorted(gaps)
                median_gap = gaps_sorted[len(gaps_sorted) // 2]
                bpm = 60.0 / median_gap if median_gap > 0 else 120.0
            else:
                bpm = 120.0
        else:
            bpm = 120.0
    bpm = max(30.0, min(300.0, float(bpm)))
    beat_length = 60000.0 / bpm

    lines = [
        "osu file format v14",
        "",
        "[General]",
        f"AudioFilename: {audio_filename or 'audio.ogg'}",
        "AudioLeadIn: 0",
        "PreviewTime: -1",
        "Countdown: 0",
        "SampleSet: Soft",
        "StackLeniency: 0.7",
        "Mode: 0",
        "LetterboxInBreaks: 0",
        "WidescreenStoryboard: 0",
        "",
        "[Editor]",
        "DistanceSpacing: 1.0",
        "BeatDivisor: 4",
        "GridSize: 8",
        "TimelineZoom: 1.5",
        "",
        "[Metadata]",
        f"Title:{title}",
        f"TitleUnicode:{title}",
        f"Artist:{artist}",
        f"ArtistUnicode:{artist}",
        f"Creator:{creator}",
        f"Version:{version}",
        "Source:",
        "Tags:auto generated pmvforge",
        "BeatmapID:0",
        "BeatmapSetID:-1",
        "",
        "[Difficulty]",
        "HPDrainRate:5",
        "CircleSize:4",
        "OverallDifficulty:7",
        "ApproachRate:8",
        "SliderMultiplier:1.4",
        "SliderTickRate:1",
        "",
        "[Events]",
        "//Background and Video events",
        "//Break Periods",
        "",
        "[TimingPoints]",
        f"{first_time},{beat_length:.10f},4,2,0,70,1,0",
        "",
        "[Colours]",
        "Combo1 : 255,128,128",
        "Combo2 : 128,255,128",
        "Combo3 : 128,128,255",
        "",
        "[HitObjects]",
    ]

    x, y = 256, 192
    for t in times_ms:
        lines.append(f"{x},{y},{t},1,0,0:0:0:0:")

    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
