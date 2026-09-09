"""
System / health / config + native path pickers + user settings + temp cleanup.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Any, Dict

from ..config import (
    PROJECT_NAME,
    PROJECT_SLUG,
    PROJECT_VERSION,
    PROJECT_DESCRIPTION,
    DEFAULT_TEMP_DIR,
    get_temp_dir,
    get_config_dir,
)
from ..services.native_dialog import pick_file, pick_files, pick_folder
from ..services import user_settings as settings_store
from ..services import temp_cleanup

router = APIRouter()


class PickResult(BaseModel):
    path: Optional[str] = None
    paths: List[str] = []
    cancelled: bool = False


class SettingsPatch(BaseModel):
    temp_dir: Optional[str] = None
    default_output_folder: Optional[str] = None
    default_cuda: Optional[bool] = None
    default_fps: Optional[int] = None
    default_threads: Optional[int] = None
    default_batch_size: Optional[int] = None
    default_clip_dist: Optional[float] = None
    default_volume: Optional[float] = None
    default_aspect: Optional[str] = None
    default_quality: Optional[str] = None
    default_clip_order: Optional[str] = None
    default_zoom_to_fill: Optional[bool] = None
    auto_cleanup_after_job: Optional[bool] = None
    cleanup_max_age_hours: Optional[float] = None
    theporndb_api_token: Optional[str] = None


@router.get("/info")
async def app_info():
    s = settings_store.load_settings()
    usage = temp_cleanup.temp_usage_summary()
    return {
        "name": PROJECT_NAME,
        "slug": PROJECT_SLUG,
        "version": PROJECT_VERSION,
        "description": PROJECT_DESCRIPTION,
        "temp_dir": str(get_temp_dir()),
        "config_dir": str(get_config_dir()),
        "default_temp_dir": DEFAULT_TEMP_DIR,
        "settings": s,
        "temp_usage": usage,
    }


@router.get("/settings")
async def get_settings():
    return {
        "settings": settings_store.load_settings(),
        "temp_usage": temp_cleanup.temp_usage_summary(),
        "temp_dir_active": str(get_temp_dir()),
        "config_dir": str(get_config_dir()),
        "defaults": settings_store.DEFAULTS,
    }


@router.put("/settings")
async def put_settings(patch: SettingsPatch):
    data = patch.model_dump(exclude_none=True)
    if "temp_dir" in data and data["temp_dir"]:
        p = __import__("pathlib").Path(data["temp_dir"])
        try:
            p.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            raise HTTPException(400, f"Cannot use temp_dir: {e}")
    saved = settings_store.save_settings(data)
    return {
        "settings": saved,
        "temp_dir_active": str(get_temp_dir()),
        "temp_usage": temp_cleanup.temp_usage_summary(),
    }


@router.post("/cleanup")
async def run_cleanup(
    mode: Literal["aged", "all", "all_with_outputs"] = "aged",
    max_age_hours: Optional[float] = None,
):
    """
    Clean temp intermediates.
    - aged: delete jobs/uploads/cockhero_work older than max_age_hours
    - all: wipe those folders now
    - all_with_outputs: also wipe temp/outputs
    """
    if mode == "aged":
        hours = max_age_hours
        if hours is None:
            hours = float(settings_store.load_settings().get("cleanup_max_age_hours") or 24)
        result = temp_cleanup.cleanup_aged(max_age_hours=hours)
    elif mode == "all_with_outputs":
        result = temp_cleanup.cleanup_all_intermediates(include_outputs=True)
    else:
        result = temp_cleanup.cleanup_all_intermediates(include_outputs=False)
    result["temp_usage"] = temp_cleanup.temp_usage_summary()
    return result


@router.post("/pick-folder", response_model=PickResult)
async def api_pick_folder(title: str = "Select folder"):
    try:
        path = pick_folder(title=title)
    except Exception as e:
        raise HTTPException(500, f"Folder dialog failed: {e}")
    if not path:
        return PickResult(cancelled=True)
    return PickResult(path=path, paths=[path])


@router.post("/pick-file", response_model=PickResult)
async def api_pick_file(
    kind: Literal["beat", "audio", "any"] = "any",
    title: str = "Select file",
):
    filetypes = {
        "beat": [
            ("Beatmaps", "*.osu *.txt *.json"),
            ("osu!", "*.osu"),
        ],
        "audio": [
            ("Audio", "*.mp3 *.wav *.ogg *.flac *.m4a"),
        ],
        "any": None,
    }.get(kind)

    if filetypes and os_is_windows():
        fixed = []
        for label, pattern in filetypes:
            fixed.append((label, pattern.replace(" ", ";")))
        filetypes = fixed

    try:
        path = pick_file(title=title, filetypes=filetypes)
    except Exception as e:
        raise HTTPException(500, f"File dialog failed: {e}")
    if not path:
        return PickResult(cancelled=True)
    return PickResult(path=path, paths=[path])


@router.post("/pick-files", response_model=PickResult)
async def api_pick_files(
    kind: Literal["video", "any"] = "video",
    title: str = "Select clips",
):
    filetypes = {
        "video": [
            ("Video", "*.mp4 *.mov *.mkv *.webm *.avi *.wmv *.m4v *.mpg *.mpeg *.flv"),
        ],
        "any": None,
    }.get(kind)

    if filetypes and os_is_windows():
        fixed = []
        for label, pattern in filetypes:
            fixed.append((label, pattern.replace(" ", ";")))
        filetypes = fixed

    try:
        paths = pick_files(title=title, filetypes=filetypes)
    except Exception as e:
        raise HTTPException(500, f"File dialog failed: {e}")
    if not paths:
        return PickResult(cancelled=True)
    return PickResult(path=paths[0], paths=list(paths))


def os_is_windows() -> bool:
    import os
    return os.name == "nt"
