"""
Cock Hero endpoints — workspace, preview frame, render job.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from pathlib import Path
import uuid
import shutil
import json
from datetime import datetime

from ..config import get_temp_dir, PROJECT_NAME
from ..services import job_store
from ..services.cockhero_renderer import (
    CockHeroOptions,
    CockHeroResult,
    render_cockhero,
    extract_frame,
    draw_preview,
    load_beats,
    media_duration,
)

router = APIRouter()

_sessions: dict[str, dict] = {}


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _ch_root() -> Path:
    p = get_temp_dir() / "cockhero"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _load_session(session_id: str) -> dict:
    """Memory first, then disk (survives backend restarts)."""
    s = _sessions.get(session_id)
    if s:
        return s
    folder = _ch_root() / session_id
    meta = folder / "session.json"
    if meta.exists():
        s = json.loads(meta.read_text(encoding="utf-8"))
        s.setdefault("folder", str(folder))
        if not s.get("frame_path") or not Path(s["frame_path"]).exists():
            cand = folder / "frame0.jpg"
            if cand.exists():
                s["frame_path"] = str(cand)
        _sessions[session_id] = s
        return s
    raise HTTPException(404, "Session not found — create one from a finished PMV again")


class CreateFromPmvRequest(BaseModel):
    video_path: str
    beats_path: str  # companion .txt or original .osu
    original_beats_path: Optional[str] = None  # full beatmap if different
    label: Optional[str] = None


class SessionInfo(BaseModel):
    session_id: str
    video_path: str
    beats_path: str
    original_beats_path: Optional[str] = None
    label: str = ""
    duration: float = 0.0
    beat_count_full: int = 0
    beat_count_thinned: int = 0
    preview_url: Optional[str] = None
    created_at: str


class PreviewRequest(BaseModel):
    session_id: str
    circle_color: str = "#ff4da6"
    bar_height_pct: float = 10.0
    margin_bottom_pct: float = 4.0
    hit_zone_x_pct: float = 50.0
    circle_radius_pct: float = 1.8
    bar_opacity: float = 0.55


class RenderRequest(BaseModel):
    session_id: str
    circle_color: str = "#ff4da6"
    bar_height_pct: float = 10.0
    margin_bottom_pct: float = 4.0
    hit_zone_x_pct: float = 50.0
    circle_radius_pct: float = 1.8
    bar_opacity: float = 0.55
    lookahead: float = 3.0
    beat_mode: Literal["full", "thinned"] = "full"
    thin_dist: float = 0.4
    sound_enabled: bool = True
    sound_preset: Literal["tick", "wood", "kick", "custom"] = "tick"
    custom_sound: Optional[str] = None
    sound_volume: float = 0.7
    cuda: bool = False
    output_folder: Optional[str] = None


class JobStatus(BaseModel):
    job_id: str
    status: str
    progress: float = 0.0
    message: str = ""
    result: Optional[dict] = None
    created_at: str
    updated_at: str
    elapsed_seconds: Optional[float] = None


@router.post("/from-pmv", response_model=SessionInfo)
async def create_from_pmv(req: CreateFromPmvRequest):
    """Copy PMV video + beat file(s) into a Cock Hero workspace. No render yet."""
    video = Path(req.video_path)
    beats = Path(req.beats_path)
    if not video.exists():
        raise HTTPException(400, f"Video not found: {video}")
    if not beats.exists():
        raise HTTPException(400, f"Beats not found: {beats}")

    sid = str(uuid.uuid4())
    folder = _ch_root() / sid
    folder.mkdir(parents=True, exist_ok=True)

    vdest = folder / f"source{video.suffix.lower() or '.mp4'}"
    bdest = folder / f"beats{beats.suffix.lower() or '.txt'}"
    shutil.copy2(video, vdest)
    shutil.copy2(beats, bdest)

    orig_dest = None
    if req.original_beats_path and Path(req.original_beats_path).exists():
        op = Path(req.original_beats_path)
        orig_dest = folder / f"original_beats{op.suffix.lower()}"
        shutil.copy2(op, orig_dest)

    # base frame for previews (never fail the whole session)
    frame = folder / "frame0.jpg"
    try:
        extract_frame(str(vdest), str(frame), 0.5)
    except Exception:
        try:
            extract_frame(str(vdest), str(frame), 0.0)
        except Exception as e:
            # black placeholder so UI still works
            _run_placeholder_frame(str(frame), str(e))

    try:
        dur = media_duration(str(vdest))
    except Exception:
        dur = 0.0

    full_path = str(orig_dest) if orig_dest else str(bdest)
    try:
        full_beats = load_beats(full_path, "full")
        thin_beats = load_beats(str(bdest), "thinned", 0.4)
    except Exception:
        full_beats, thin_beats = [], []

    info = {
        "session_id": sid,
        "video_path": str(vdest),
        "beats_path": str(bdest),
        "original_beats_path": str(orig_dest) if orig_dest else str(bdest),
        "label": req.label or video.stem,
        "duration": dur,
        "beat_count_full": len(full_beats),
        "beat_count_thinned": len(thin_beats),
        "frame_path": str(frame),
        "folder": str(folder),
        "created_at": _now(),
    }
    _sessions[sid] = info
    # persist
    (folder / "session.json").write_text(json.dumps(info, indent=2), encoding="utf-8")

    return SessionInfo(
        session_id=sid,
        video_path=str(vdest),
        beats_path=str(bdest),
        original_beats_path=info["original_beats_path"],
        label=info["label"],
        duration=dur,
        beat_count_full=len(full_beats),
        beat_count_thinned=len(thin_beats),
        preview_url=f"/api/cockhero/session/{sid}/frame",
        created_at=info["created_at"],
    )




class CreateFromFilesRequest(BaseModel):
    """Standalone: any PMV video + beatmap on disk (not only post-generate)."""
    video_path: str
    beats_path: str
    original_beats_path: Optional[str] = None
    label: Optional[str] = None


@router.post("/from-files", response_model=SessionInfo)
async def create_from_files(req: CreateFromFilesRequest):
    """Same as from-pmv — explicit alias for manual path pick."""
    return await create_from_pmv(
        CreateFromPmvRequest(
            video_path=req.video_path,
            beats_path=req.beats_path,
            original_beats_path=req.original_beats_path,
            label=req.label,
        )
    )


@router.get("/session/{session_id}", response_model=SessionInfo)
async def get_session(session_id: str):
    s = _load_session(session_id)
    return SessionInfo(
        session_id=session_id,
        video_path=s["video_path"],
        beats_path=s["beats_path"],
        original_beats_path=s.get("original_beats_path"),
        label=s.get("label", ""),
        duration=s.get("duration", 0),
        beat_count_full=s.get("beat_count_full", 0),
        beat_count_thinned=s.get("beat_count_thinned", 0),
        preview_url=f"/api/cockhero/session/{session_id}/frame",
        created_at=s.get("created_at", ""),
    )


@router.get("/session/{session_id}/frame")
async def session_frame(session_id: str):
    s = _load_session(session_id)
    path = s.get("frame_path")
    if not path or not Path(path).exists():
        # try re-extract
        folder = Path(s.get("folder") or (_ch_root() / session_id))
        frame = folder / "frame0.jpg"
        try:
            extract_frame(s["video_path"], str(frame), 0.5)
            s["frame_path"] = str(frame)
            _sessions[session_id] = s
            path = str(frame)
        except Exception:
            raise HTTPException(404, "Frame missing")
    return FileResponse(path, media_type="image/jpeg")


@router.post("/preview")
async def preview_overlay(req: PreviewRequest):
    """Render a still preview of bar settings on the first frame."""
    s = _load_session(req.session_id)
    frame = s.get("frame_path")
    if not frame or not Path(frame).exists():
        raise HTTPException(400, "No frame — re-create the Cock Hero session from Generate")

    out = Path(s.get("folder") or (_ch_root() / req.session_id)) / "preview.jpg"
    try:
        draw_preview(
            frame,
            str(out),
            color=req.circle_color,
            bar_height_pct=req.bar_height_pct,
            margin_bottom_pct=req.margin_bottom_pct,
            hit_zone_x_pct=req.hit_zone_x_pct,
            circle_radius_pct=req.circle_radius_pct,
            bar_opacity=req.bar_opacity,
        )
    except Exception as e:
        raise HTTPException(500, str(e))

    return FileResponse(str(out), media_type="image/jpeg")


def _run_placeholder_frame(path: str, reason: str = "") -> None:
    import subprocess
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-y",
            "-f", "lavfi", "-i", "color=c=black:s=1280x720:d=0.1",
            "-frames:v", "1", path,
        ],
        capture_output=True,
        timeout=30,
    )


def _run_ch_job(job_id: str, options: CockHeroOptions):
    job_store.update_job(job_id, status="running", message="Starting…", started_at=_now())
    started = datetime.utcnow()

    def progress_cb(msg: str, pct: float):
        job_store.update_job(job_id, message=msg, progress=pct)

    result: CockHeroResult = render_cockhero(options, progress_cb=progress_cb)
    elapsed = (datetime.utcnow() - started).total_seconds()
    job_store.update_job(
        job_id,
        status="finished" if result.success else "error",
        message=result.message,
        progress=1.0 if result.success else (job_store.get_job(job_id) or {}).get("progress", 0),
        elapsed_seconds=result.elapsed or elapsed,
        result={
            "success": result.success,
            "output_video": result.output_video,
            "logs": result.logs,
            "elapsed_seconds": result.elapsed or elapsed,
        },
    )



@router.post("/render", response_model=JobStatus)
async def start_render(req: RenderRequest, background_tasks: BackgroundTasks):
    s = _load_session(req.session_id)

    if req.beat_mode == "full":
        beats_path = s.get("original_beats_path") or s["beats_path"]
    else:
        beats_path = s["beats_path"]

    out_dir = Path(req.output_folder) if req.output_folder else (_ch_root() / req.session_id / "out")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{s.get('label', 'cockhero')}_CH.mp4"

    options = CockHeroOptions(
        video_path=s["video_path"],
        beats_path=beats_path,
        output_path=str(out_file),
        circle_color=req.circle_color,
        bar_height_pct=req.bar_height_pct,
        margin_bottom_pct=req.margin_bottom_pct,
        hit_zone_x_pct=req.hit_zone_x_pct,
        circle_radius_pct=req.circle_radius_pct,
        bar_opacity=req.bar_opacity,
        lookahead=req.lookahead,
        beat_mode=req.beat_mode,
        thin_dist=req.thin_dist,
        sound_enabled=req.sound_enabled,
        sound_preset=req.sound_preset,
        custom_sound=req.custom_sound,
        sound_volume=req.sound_volume,
        cuda=req.cuda,
    )

    job = job_store.create_job({
        "message": "Queued",
        "session_id": req.session_id,
        "kind": "cockhero",
    })
    job_id = job["job_id"]
    background_tasks.add_task(_run_ch_job, job_id, options)
    return JobStatus(**{k: job.get(k) for k in JobStatus.model_fields})


@router.get("/status/{job_id}", response_model=JobStatus)
async def job_status(job_id: str):
    job = job_store.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return JobStatus(
        job_id=job["job_id"],
        status=job["status"],
        progress=job.get("progress", 0),
        message=job.get("message", ""),
        result=job.get("result"),
        created_at=job["created_at"],
        updated_at=job["updated_at"],
        elapsed_seconds=job.get("elapsed_seconds"),
    )


@router.get("/video/{job_id}")
async def stream_video(job_id: str):
    job = job_store.get_job(job_id)
    if not job or job.get("status") != "finished":
        raise HTTPException(404, "Not ready")
    path = (job.get("result") or {}).get("output_video")
    if not path or not Path(path).exists():
        raise HTTPException(404, "File missing")
    return FileResponse(path, media_type="video/mp4", filename=Path(path).name)


@router.get("/download/{job_id}")
async def download_video(job_id: str):
    job = job_store.get_job(job_id)
    if not job:
        raise HTTPException(404, "Not found")
    path = (job.get("result") or {}).get("output_video")
    if not path or not Path(path).exists():
        raise HTTPException(404, "File missing")
    return FileResponse(
        path,
        media_type="video/mp4",
        filename=Path(path).name,
        headers={"Content-Disposition": f'attachment; filename="{Path(path).name}"'},
    )
