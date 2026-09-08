"""
PMV generation endpoints.
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List, Literal
from pathlib import Path
import json
import shutil
from datetime import datetime

from ..config import get_config_dir, get_temp_dir, PROJECT_NAME
from ..services import job_store
from ..services.pmv_generator import (
    PMVGenerator,
    PMVJobOptions,
    PMVJobResult,
    RESOLUTION_PRESETS,
    VIDEO_EXTS,
)

router = APIRouter()


BEAT_EXTS = {".osu", ".txt", ".funscript", ".json"}


class GenerateRequest(BaseModel):
    """Path-based start (still available for power users / scripts)."""
    beat_input: str
    video_folder: str
    output_folder: str
    song_path: Optional[str] = None

    num_vids: int = 0
    recurse: bool = False
    clip_dist: float = 0.4

    aspect: Literal["16:9", "9:16"] = "16:9"
    quality: Literal["hd", "fhd", "4k"] = "hd"
    resolution: Optional[str] = None
    zoom_to_fill: bool = False
    face_center: bool = False
    clip_order: Literal["random", "forward", "sticky"] = "random"
    effects: Optional[dict] = None

    fps: int = 30
    bitrate: Optional[str] = None
    threads: int = 4
    cuda: bool = False
    debug: bool = False


class JobStatus(BaseModel):
    job_id: str
    status: str
    progress: float = 0.0
    message: str = ""
    result: Optional[dict] = None
    created_at: str
    updated_at: str
    elapsed_seconds: Optional[float] = None
    cancelled: bool = False


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _save_upload(file: UploadFile, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)


def _run_job(job_id: str, options: PMVJobOptions):
    import time as _time
    _t0 = _time.time()
    job_store.update_job(job_id, status="running", message="Starting…", started_at=_now())

    def progress_cb(msg: str, pct: float):
        if job_store.is_cancelled(job_id):
            return
        job_store.update_job(job_id, message=msg, progress=pct)

    cancel_cb = job_store.cancel_checker(job_id)
    generator = PMVGenerator(options, progress_cb=progress_cb, cancel_cb=cancel_cb)
    result: PMVJobResult = generator.run()
    elapsed = _time.time() - _t0

    if job_store.is_cancelled(job_id) or (result.message or "").lower().startswith("cancelled"):
        job_store.update_job(
            job_id,
            status="cancelled",
            message="Cancelled",
            elapsed_seconds=elapsed,
            cancelled=True,
            result={
                "success": False,
                "output_video": None,
                "logs": result.logs,
                "elapsed_seconds": elapsed,
                "beat_input": options.beat_input,
                "song_path": options.song_path,
            },
        )
        return

    job_store.update_job(
        job_id,
        status="finished" if result.success else "error",
        message=result.message,
        progress=1.0 if result.success else (job_store.get_job(job_id) or {}).get("progress", 0),
        elapsed_seconds=elapsed,
        result={
            "success": result.success,
            "output_video": result.output_video,
            "logs": result.logs,
            "elapsed_seconds": elapsed,
            "beat_input": options.beat_input,
            "song_path": options.song_path,
        },
    )

    try:
        history_path = get_config_dir() / "history.json"
        items = []
        if history_path.exists():
            items = json.loads(history_path.read_text(encoding="utf-8"))
        items.insert(0, {
            "type": "pmv",
            "title": Path(options.beat_input).stem,
            "output": result.output_video,
            "success": result.success,
            "timestamp": _now(),
            "app": PROJECT_NAME,
            "job_id": job_id,
            "beat_input": options.beat_input,
            "song_path": options.song_path,
        })
        history_path.write_text(json.dumps(items[:50], indent=2), encoding="utf-8")
    except Exception:
        pass


def _queue_job(options: PMVJobOptions, background_tasks: BackgroundTasks, extra: dict | None = None) -> dict:
    job = job_store.create_job(extra)
    background_tasks.add_task(_run_job, job["job_id"], options)
    return job


@router.get("/presets")
async def list_presets():
    return {
        "aspects": list(RESOLUTION_PRESETS.keys()),
        "qualities": ["hd", "fhd", "4k"],
        "resolutions": RESOLUTION_PRESETS,
        "labels": {"hd": "HD", "fhd": "Full HD", "4k": "4K"},
    }


class StartPathsRequest(BaseModel):
    """Path-based start — no file uploads. Paths must exist on the backend host."""
    beat_input: str
    video_folder: str = ""
    video_paths: List[str] = []
    output_folder: str = ""
    song_path: Optional[str] = None

    num_vids: int = 0
    recurse: bool = False
    clip_dist: float = 0.4

    aspect: Literal["16:9", "9:16"] = "16:9"
    quality: Literal["hd", "fhd", "4k"] = "hd"
    resolution: Optional[str] = None
    zoom_to_fill: bool = False
    face_center: bool = False
    clip_order: Literal["random", "forward", "sticky"] = "random"
    effects: Optional[dict] = None

    fps: int = 30
    bitrate: Optional[str] = None
    threads: int = 4
    cuda: bool = False
    debug: bool = False


@router.post("/start", response_model=JobStatus)
async def start_generation(req: GenerateRequest, background_tasks: BackgroundTasks):
    if not Path(req.beat_input).exists():
        raise HTTPException(400, f"Beat input not found: {req.beat_input}")
    if not Path(req.video_folder).exists():
        raise HTTPException(400, f"Video folder not found: {req.video_folder}")

    options = PMVJobOptions(**req.model_dump())
    return JobStatus(**_queue_job(options, background_tasks))


@router.post("/start-paths", response_model=JobStatus)
async def start_generation_paths(req: StartPathsRequest, background_tasks: BackgroundTasks):
    """
    Start a job from absolute paths (native dialogs). Zero uploading.
    Provide either video_folder or video_paths.
    """
    if not Path(req.beat_input).exists():
        raise HTTPException(400, f"Beat input not found: {req.beat_input}")

    paths = [p for p in (req.video_paths or []) if Path(p).is_file()]
    folder = (req.video_folder or "").strip()

    if not paths and not folder:
        raise HTTPException(400, "Provide video_folder or video_paths")
    if folder and not paths and not Path(folder).exists():
        raise HTTPException(400, f"Video folder not found: {folder}")
    if req.song_path and not Path(req.song_path).exists():
        raise HTTPException(400, f"Song not found: {req.song_path}")

    out = (req.output_folder or "").strip()
    if out:
        Path(out).mkdir(parents=True, exist_ok=True)
    else:
        out = str(get_temp_dir() / "outputs")
        Path(out).mkdir(parents=True, exist_ok=True)

    data = req.model_dump()
    data["video_folder"] = folder
    data["video_paths"] = paths
    data["output_folder"] = out
    options = PMVJobOptions(**data)
    return JobStatus(**_queue_job(options, background_tasks))


@router.post("/start-upload", response_model=JobStatus)
async def start_generation_upload(
    background_tasks: BackgroundTasks,
    beat_file: UploadFile = File(..., description="Beatmap (.osu / .txt / .funscript)"),
    videos: List[UploadFile] = File(..., description="One or more video clips"),
    song_file: Optional[UploadFile] = File(None),
    output_folder: str = Form(""),
    clip_dist: float = Form(0.4),
    aspect: str = Form("16:9"),
    quality: str = Form("hd"),
    zoom_to_fill: str = Form("false"),
    face_center: str = Form("false"),
    fps: int = Form(30),
    bitrate: str = Form(""),
    threads: int = Form(4),
    cuda: str = Form("false"),
    debug: str = Form("false"),
    num_vids: int = Form(0),
):
    """
    Browser-friendly start: upload beatmap + clips (and optional song).
    Videos are stored in a per-job folder and fed to the generator.
    """
    def _as_bool(v: str) -> bool:
        return str(v).strip().lower() in ("1", "true", "yes", "on")

    zoom_to_fill_b = _as_bool(zoom_to_fill)
    face_center_b = _as_bool(face_center)
    cuda_b = _as_bool(cuda)
    debug_b = _as_bool(debug)

    if not beat_file.filename:
        raise HTTPException(400, "Beat file is required")

    beat_ext = Path(beat_file.filename).suffix.lower()
    if beat_ext not in BEAT_EXTS:
        raise HTTPException(400, f"Unsupported beat format: {beat_ext}")

    if not videos:
        raise HTTPException(400, "Select at least one video clip")

    job = job_store.create_job({"message": "Staging uploads…"})
    job_id = job["job_id"]
    stage = get_temp_dir() / "uploads" / job_id
    video_dir = stage / "videos"
    video_dir.mkdir(parents=True, exist_ok=True)

    beat_path = stage / f"beat{beat_ext}"
    _save_upload(beat_file, beat_path)

    song_path = None
    if song_file and song_file.filename:
        song_ext = Path(song_file.filename).suffix.lower() or ".mp3"
        song_path = stage / f"song{song_ext}"
        _save_upload(song_file, song_path)

    saved = 0
    for vf in videos:
        if not vf.filename:
            continue
        ext = Path(vf.filename).suffix.lower()
        if ext not in VIDEO_EXTS:
            continue
        # preserve unique names
        dest = video_dir / Path(vf.filename).name
        n = 1
        while dest.exists():
            dest = video_dir / f"{Path(vf.filename).stem}_{n}{ext}"
            n += 1
        _save_upload(vf, dest)
        saved += 1

    if saved == 0:
        raise HTTPException(400, "No valid video files in the upload")

    out = output_folder.strip() if output_folder else ""
    if out:
        out_dir = Path(out)
        out_dir.mkdir(parents=True, exist_ok=True)
    else:
        out_dir = get_temp_dir() / "outputs" / job_id
        out_dir.mkdir(parents=True, exist_ok=True)

    if aspect not in ("16:9", "9:16"):
        aspect = "16:9"
    if quality not in ("hd", "fhd", "4k"):
        quality = "hd"

    options = PMVJobOptions(
        beat_input=str(beat_path),
        video_folder=str(video_dir),
        output_folder=str(out_dir),
        song_path=str(song_path) if song_path else None,
        num_vids=num_vids,
        recurse=False,
        clip_dist=clip_dist,
        aspect=aspect,
        quality=quality,
        zoom_to_fill=zoom_to_fill_b,
        face_center=face_center_b,
        fps=fps,
        bitrate=bitrate or None,
        threads=threads,
        cuda=cuda_b,
        debug=debug_b,
        effects=None,
    )

    now = _now()
    _jobs[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "progress": 0.0,
        "message": f"Queued · {saved} clips",
        "result": None,
        "created_at": now,
        "updated_at": now,
    }
    background_tasks.add_task(_run_job, job_id, options)
    return JobStatus(**_jobs[job_id])


@router.get("/status/{job_id}", response_model=JobStatus)
async def get_status(job_id: str):
    job = job_store.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return JobStatus(**{k: job.get(k) for k in JobStatus.model_fields})


@router.post("/cancel/{job_id}", response_model=JobStatus)
async def cancel_job(job_id: str):
    job = job_store.request_cancel(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return JobStatus(**{k: job.get(k) for k in JobStatus.model_fields})


@router.get("/jobs", response_model=List[JobStatus])
async def list_jobs(limit: int = 20):
    items = job_store.list_jobs(limit)
    return [JobStatus(**{k: j.get(k) for k in JobStatus.model_fields}) for j in items]


@router.get("/video/{job_id}")
async def stream_video(job_id: str):
    """Stream the finished PMV for in-browser preview."""
    job = job_store.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.get("status") != "finished":
        raise HTTPException(400, "Job is not finished")
    path = (job.get("result") or {}).get("output_video")
    if not path or not Path(path).is_file():
        raise HTTPException(404, "Output video not found on disk")
    return FileResponse(
        path=path,
        media_type="video/mp4",
        filename=Path(path).name,
        headers={"Accept-Ranges": "bytes"},
    )


@router.get("/download/{job_id}")
async def download_video(job_id: str):
    """Force-download the finished PMV."""
    job = job_store.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    path = (job.get("result") or {}).get("output_video")
    if not path or not Path(path).is_file():
        raise HTTPException(404, "Output video not found on disk")
    return FileResponse(
        path=path,
        media_type="application/octet-stream",
        filename=Path(path).name,
    )
