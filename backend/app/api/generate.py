"""
PMV generation endpoints.
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks, UploadFile, File, Form, Query
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


BEAT_EXTS = {".osu", ".txt", ".json"}


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



class EffectsPreviewRequest(BaseModel):
    clip_path: str
    effects: dict
    duration: float = 4.0
    cuda: bool = False
    bitrate: Optional[str] = None


@router.post("/effects-preview")
async def effects_preview(body: EffectsPreviewRequest):
    """Render a short effects preview from one source clip + synthetic beats."""
    clip = Path(body.clip_path)
    if not clip.is_file():
        raise HTTPException(400, f"Clip not found: {body.clip_path}")
    from ..services.effects_pipeline import EffectsOptions, apply_effects, effects_from_dict
    from ..config import get_temp_dir
    import random, time as _time

    work = get_temp_dir() / "fx_preview" / str(int(_time.time() * 1000))
    work.mkdir(parents=True, exist_ok=True)
    # cut a short segment from a random offset near the start/middle
    dur = max(1.5, min(8.0, float(body.duration or 4.0)))
    cut = work / "cut.mp4"
    # random start 0..10s
    ss = random.uniform(0.0, 8.0)
    code_cut = __import__("subprocess").run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-ss", f"{ss:.2f}", "-i", str(clip), "-t", f"{dur:.2f}",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
            "-an", str(cut),
        ],
        capture_output=True, timeout=120,
    )
    if code_cut.returncode != 0 or not cut.exists():
        raise HTTPException(500, "Failed to cut preview clip")

    # synthetic beats every 0.4s across the cut
    beats = [i * 0.4 for i in range(int(dur / 0.4) + 2)]
    fx_raw = body.effects or {}
    fx = effects_from_dict(fx_raw)
    out = work / "preview.mp4"
    try:
        apply_effects(
            str(cut), str(out), beats, fx,
            cuda=bool(body.cuda),
            bitrate=body.bitrate or "8M",
            work_dir=str(work),
        )
    except Exception as e:
        raise HTTPException(500, f"Preview failed: {e}")
    if not out.exists():
        raise HTTPException(500, "Preview produced no file")
    return FileResponse(str(out), media_type="video/mp4", filename="effects-preview.mp4")


@router.get("/presets")
async def list_presets():
    return {
        "aspects": list(RESOLUTION_PRESETS.keys()),
        "qualities": ["hd", "fhd", "4k"],
        "resolutions": RESOLUTION_PRESETS,
        "labels": {"hd": "HD", "fhd": "Full HD", "4k": "4K"},
    }

class SampleClipRequest(BaseModel):
    folder: str
    recurse: bool = True


@router.post("/sample-clip")
async def sample_clip(body: SampleClipRequest):
    """Pick a random usable video under a folder for effects preview."""
    import random
    root = Path(body.folder)
    if not root.is_dir():
        raise HTTPException(400, f"Folder not found: {body.folder}")
    files = []
    if body.recurse:
        for ext in VIDEO_EXTS:
            files.extend(root.rglob(f"*{ext}"))
    else:
        for f in root.iterdir():
            if f.is_file() and f.suffix.lower() in VIDEO_EXTS:
                files.append(f)
    files = [f for f in files if f.is_file()]
    if not files:
        raise HTTPException(400, "No video files in folder")
    random.shuffle(files)
    pick = files[0]
    return {"path": str(pick.resolve()), "name": pick.name}




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
    clip_order: Literal["random", "forward", "sticky"] = "random"
    effects: Optional[dict] = None

    fps: int = 30
    bitrate: Optional[str] = None
    threads: int = 4
    cuda: bool = False
    debug: bool = False

    edl_clips: Optional[List[dict]] = None
    song_volume: float = 1.0
    default_clip_volume: float = 1.0
    keep_clip_audio: bool = True




class PlanEdlRequest(BaseModel):
    beat_input: str
    video_folder: str = ""
    video_paths: List[str] = []
    song_path: Optional[str] = None
    recurse: bool = False
    num_vids: int = 0
    clip_order: Literal["random", "forward", "sticky"] = "random"
    fps: int = 30
    default_clip_volume: float = 1.0


@router.post("/plan-edl")
async def plan_edl(req: PlanEdlRequest):
    """Fill an EDL from beats + clip pool without encoding."""
    from ..services.pmv_generator import (
        load_beat_times,
        load_videos_from_paths,
        scan_videos,
        plan_clips,
        edl_from_plans,
    )
    import tempfile

    if not req.beat_input or not Path(req.beat_input).exists():
        raise HTTPException(400, f"Beat input not found: {req.beat_input}")

    try:
        beats, song, display_name = load_beat_times(req.beat_input)
    except Exception as e:
        raise HTTPException(400, f"Failed to load beats: {e}")

    if req.song_path and Path(req.song_path).exists():
        song = req.song_path

    if not beats or len(beats) < 2:
        raise HTTPException(400, "Need at least 2 beat timestamps")

    paths = [p for p in (req.video_paths or []) if p]
    if paths:
        videos = load_videos_from_paths(paths, limit=req.num_vids or 0)
    elif req.video_folder:
        if not Path(req.video_folder).is_dir():
            raise HTTPException(400, f"Video folder not found: {req.video_folder}")
        videos = scan_videos(req.video_folder, recurse=req.recurse, limit=req.num_vids or 0)
    else:
        raise HTTPException(400, "Provide video_paths or video_folder")

    if not videos:
        raise HTTPException(400, "No usable source videos")

    work = Path(tempfile.mkdtemp(prefix="edl_plan_", dir=str(get_temp_dir())))
    try:
        plans = plan_clips(beats, videos, req.fps, work, order=req.clip_order)
        dvol = float(req.default_clip_volume or 1.0)
        for pl in plans:
            pl.volume = dvol
        edl = edl_from_plans(plans, beats)
    finally:
        try:
            work.rmdir()
        except Exception:
            pass

    return {
        "beats": beats,
        "song_path": song,
        "display_name": display_name,
        "clips": edl,
        "count": len(edl),
        "duration": beats[-1] if beats else 0,
    }


@router.get("/media")
async def stream_generate_media(path: str = Query(...)):
    """Stream any local media path for timeline source preview."""
    pth = Path(path)
    if not pth.is_file():
        raise HTTPException(404, f"Not found: {path}")
    suffix = pth.suffix.lower()
    media = {
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mkv": "video/x-matroska",
        ".mov": "video/quicktime",
        ".avi": "video/x-msvideo",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".ogg": "audio/ogg",
        ".flac": "audio/flac",
        ".m4a": "audio/mp4",
    }.get(suffix, "application/octet-stream")
    return FileResponse(str(pth.resolve()), media_type=media, filename=pth.name)


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
    beat_file: UploadFile = File(..., description="Beatmap (.osu / .txt / .json)"),
    videos: List[UploadFile] = File(..., description="One or more video clips"),
    song_file: Optional[UploadFile] = File(None),
    output_folder: str = Form(""),
    clip_dist: float = Form(0.4),
    aspect: str = Form("16:9"),
    quality: str = Form("hd"),
    zoom_to_fill: str = Form("false"),
    fps: int = Form(30),
    bitrate: str = Form(""),
    threads: int = Form(4),
    cuda: str = Form("false"),
    debug: str = Form("false"),
    num_vids: int = Form(0),
    clip_order: str = Form("random"),
    effects: str = Form(""),
):
    """
    Browser-friendly start: upload beatmap + clips (and optional song).
    Videos are stored in a per-job folder and fed to the generator.
    """
    def _as_bool(v: str) -> bool:
        return str(v).strip().lower() in ("1", "true", "yes", "on")

    zoom_to_fill_b = _as_bool(zoom_to_fill)
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

    effects_obj = None
    if effects and effects.strip():
        try:
            effects_obj = json.loads(effects)
        except Exception:
            effects_obj = None
    order = clip_order if clip_order in ("random", "forward", "sticky") else "random"

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
        clip_order=order,
        fps=fps,
        bitrate=bitrate or None,
        threads=threads,
        cuda=cuda_b,
        debug=debug_b,
        effects=effects_obj,
    )

    job_store.update_job(job_id, message=f"Queued · {saved} clips")
    background_tasks.add_task(_run_job, job_id, options)
    job = job_store.get_job(job_id)
    return JobStatus(**{k: job.get(k) for k in JobStatus.model_fields})


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
