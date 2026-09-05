"""
Beatmap Creator + Editor endpoints.
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from pathlib import Path
import uuid
import shutil
import json

from ..config import get_temp_dir
from ..services.beat_detector import detect_beats_from_file, export_beats, load_audio_preview
from ..services.osu_editor import parse_osu_file, export_edited_osu

router = APIRouter()

AUDIO_EXTS = {".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac"}


def _save_upload(file: UploadFile, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)


@router.post("/detect")
async def detect_beats(
    file: UploadFile = File(...),
    min_gap: float = Form(0.30),
):
    """
    Upload an audio file and receive detected beat timestamps + basic waveform peaks.
    """
    if not file.filename:
        raise HTTPException(400, "No filename provided")

    suffix = Path(file.filename).suffix.lower()
    if suffix not in AUDIO_EXTS:
        raise HTTPException(400, f"Unsupported audio format: {suffix}")

    temp_dir = get_temp_dir() / "uploads"
    temp_dir.mkdir(parents=True, exist_ok=True)

    job_id = str(uuid.uuid4())
    audio_path = temp_dir / f"{job_id}{suffix}"
    _save_upload(file, audio_path)

    try:
        result = detect_beats_from_file(str(audio_path), min_gap=min_gap)
        result["job_id"] = job_id
        result["audio_filename"] = file.filename
        return result
    except Exception as e:
        raise HTTPException(500, f"Beat detection failed: {str(e)}")


@router.post("/export")
async def export_beatmap(
    job_id: str = Form(...),
    title: str = Form(...),
    artist: str = Form(...),
    creator: str = Form("PMVForge"),
    format: str = Form("osu"),
    beats: str = Form(...),
):
    """
    Export the (possibly manually edited) beat list to the requested format.
    """
    try:
        beat_times = json.loads(beats)
        if not isinstance(beat_times, list) or not beat_times:
            raise ValueError("beats must be a non-empty list of numbers")
    except Exception as e:
        raise HTTPException(400, f"Invalid beats payload: {e}")

    temp_dir = get_temp_dir() / "exports"
    temp_dir.mkdir(parents=True, exist_ok=True)

    out_path = export_beats(
        beat_times=beat_times,
        title=title,
        artist=artist,
        creator=creator,
        fmt=format,
        output_dir=temp_dir,
        job_id=job_id,
    )

    return FileResponse(
        path=out_path,
        filename=out_path.name,
        media_type="application/octet-stream",
    )


@router.post("/load-osu")
async def load_osu(
    audio: UploadFile = File(...),
    osu: UploadFile = File(...),
):
    """
    Load an audio file + existing .osu beatmap for the Beat Editor.
    Returns metadata, beat times from hit objects, and a waveform preview.
    """
    if not audio.filename or not osu.filename:
        raise HTTPException(400, "Both audio and .osu files are required")

    audio_suffix = Path(audio.filename).suffix.lower()
    osu_suffix = Path(osu.filename).suffix.lower()
    if audio_suffix not in AUDIO_EXTS:
        raise HTTPException(400, f"Unsupported audio format: {audio_suffix}")
    if osu_suffix != ".osu":
        raise HTTPException(400, "Beatmap must be a .osu file")

    job_id = str(uuid.uuid4())
    temp_dir = get_temp_dir() / "uploads"
    temp_dir.mkdir(parents=True, exist_ok=True)

    audio_path = temp_dir / f"{job_id}{audio_suffix}"
    osu_path = temp_dir / f"{job_id}.osu"
    _save_upload(audio, audio_path)
    _save_upload(osu, osu_path)

    try:
        parsed = parse_osu_file(osu_path)
        preview = load_audio_preview(str(audio_path))
    except Exception as e:
        raise HTTPException(500, f"Failed to load beatmap: {str(e)}")

    tempo = parsed.get("tempo") or preview.get("tempo")

    return {
        "job_id": job_id,
        "audio_filename": audio.filename,
        "osu_filename": osu.filename,
        "title": parsed["title"],
        "artist": parsed["artist"],
        "creator": parsed["creator"],
        "version": parsed["version"],
        "display_name": parsed["display_name"],
        "beats": parsed["beats"],
        "count": parsed["count"],
        "tempo": tempo,
        "duration": preview["duration"],
        "waveform": preview["waveform"],
    }


@router.post("/export-osu")
async def export_edited_osu_endpoint(
    job_id: str = Form(...),
    beats: str = Form(...),
    filename: str = Form(""),
):
    """
    Rewrite the original .osu [HitObjects] with the edited beat times
    and return the file for download.
    """
    try:
        beat_times = json.loads(beats)
        if not isinstance(beat_times, list) or not beat_times:
            raise ValueError("beats must be a non-empty list of numbers")
    except Exception as e:
        raise HTTPException(400, f"Invalid beats payload: {e}")

    osu_path = get_temp_dir() / "uploads" / f"{job_id}.osu"
    if not osu_path.exists():
        raise HTTPException(404, "Original .osu not found for this job. Load the files again.")

    original_text = osu_path.read_text(encoding="utf-8", errors="replace")
    parsed = parse_osu_file(osu_path)

    safe = "".join(
        c for c in parsed["display_name"] if c.isalnum() or c in " -_()"
    ).strip() or "edited"
    out_name = filename.strip() or f"{safe}.osu"
    if not out_name.lower().endswith(".osu"):
        out_name += ".osu"

    out_dir = get_temp_dir() / "exports"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / out_name

    export_edited_osu(original_text, beat_times, out_path)

    return FileResponse(
        path=out_path,
        filename=out_name,
        media_type="application/octet-stream",
    )
