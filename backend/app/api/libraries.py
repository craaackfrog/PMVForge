"""
Source library endpoints — folders of clips with tags + heat.
"""

from __future__ import annotations

from pathlib import Path
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import List, Optional, Literal

from ..services import library_store as store

router = APIRouter()


class CreateLibraryRequest(BaseModel):
    name: str = ""
    root_path: str
    recurse: bool = True
    scan: bool = True


class UpdateClipRequest(BaseModel):
    path: str
    tags: Optional[List[str]] = None
    heat: Optional[int] = Field(None, ge=1, le=5)


class BulkUpdateRequest(BaseModel):
    paths: List[str]
    add_tags: Optional[List[str]] = None
    remove_tags: Optional[List[str]] = None
    set_tags: Optional[List[str]] = None
    heat: Optional[int] = Field(None, ge=1, le=5)


class QueryRequest(BaseModel):
    tags: List[str] = []
    tag_mode: Literal["any", "all"] = "any"
    min_heat: int = 1
    max_heat: int = 5
    limit: int = 0


class RenameRequest(BaseModel):
    name: str


@router.get("")
async def list_libraries():
    return {"libraries": store.list_libraries(), "all_tags": store.all_tags()}


@router.post("")
async def create_library(req: CreateLibraryRequest):
    try:
        lib = store.create_library(req.name, req.root_path, req.recurse)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if req.scan:
        try:
            lib = store.scan_library(lib.id)
        except ValueError as e:
            raise HTTPException(400, str(e))
    return lib.to_dict()


@router.get("/tags")
async def list_tags():
    return {"tags": store.all_tags()}




class TagRequest(BaseModel):
    tag: str
    library_id: Optional[str] = None
    strip_from_clips: bool = False


@router.post("/tags")
async def add_tag(req: TagRequest):
    try:
        tags = store.add_tag_to_vocab(req.library_id, req.tag)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"tags": tags}


@router.delete("/tags/{tag}")
async def delete_tag(tag: str, library_id: Optional[str] = None, strip_from_clips: bool = False):
    try:
        tags = store.remove_tag_from_vocab(library_id, tag, strip_from_clips)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"tags": tags}


@router.get("/media")
async def stream_clip(path: str = Query(..., description="Absolute path to a library clip")):
    """Stream a local video for in-app preview. Only paths inside a known library root."""
    if not path or not Path(path).is_file():
        raise HTTPException(404, "File not found")
    if not store.is_path_in_any_library(path):
        raise HTTPException(403, "Path is not inside a registered library")
    suffix = Path(path).suffix.lower()
    media = {
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mkv": "video/x-matroska",
        ".mov": "video/quicktime",
        ".avi": "video/x-msvideo",
    }.get(suffix, "application/octet-stream")
    return FileResponse(path, media_type=media, filename=Path(path).name)


@router.get("/{lib_id}")
async def get_library(lib_id: str):
    lib = store.load_library(lib_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    return lib.to_dict()


@router.patch("/{lib_id}")
async def rename_library(lib_id: str, req: RenameRequest):
    lib = store.load_library(lib_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    lib.name = req.name.strip() or lib.name
    store.save_library(lib)
    return lib.to_dict()


@router.delete("/{lib_id}")
async def delete_library(lib_id: str):
    store.delete_library(lib_id)
    return {"ok": True}


@router.post("/{lib_id}/scan")
async def scan_library(lib_id: str):
    try:
        lib = store.scan_library(lib_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {
        "id": lib.id,
        "clip_count": len(lib.clips),
        "last_scan_at": lib.last_scan_at,
        "tags_vocab": lib.tags_vocab,
    }


@router.get("/{lib_id}/clips")
async def list_clips(
    lib_id: str,
    tag: Optional[str] = None,
    tags: Optional[str] = None,  # comma-separated
    tag_mode: Literal["any", "all"] = "any",
    min_heat: int = 1,
    max_heat: int = 5,
    limit: int = 0,
):
    lib = store.load_library(lib_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    tag_list: List[str] = []
    if tags:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]
    elif tag:
        tag_list = [tag]
    clips = store.query_clips(lib_id, tag_list, tag_mode, min_heat, max_heat, limit)
    return {"clips": clips, "total": len(clips)}


@router.post("/{lib_id}/query")
async def query_clips(lib_id: str, req: QueryRequest):
    lib = store.load_library(lib_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    clips = store.query_clips(
        lib_id, req.tags, req.tag_mode, req.min_heat, req.max_heat, req.limit
    )
    return {"clips": clips, "total": len(clips), "paths": [c["path"] for c in clips]}


@router.patch("/{lib_id}/clip")
async def update_clip(lib_id: str, req: UpdateClipRequest):
    clip = store.update_clip(lib_id, req.path, req.tags, req.heat)
    if not clip:
        raise HTTPException(404, "Clip not found in library")
    return clip


@router.post("/{lib_id}/clips/bulk")
async def bulk_update(lib_id: str, req: BulkUpdateRequest):
    n = store.bulk_update_clips(
        lib_id,
        req.paths,
        add_tags=req.add_tags,
        remove_tags=req.remove_tags,
        set_tags=req.set_tags,
        heat=req.heat,
    )
    return {"updated": n}

