"""Song library endpoints — osu! set folders with audio + beatmaps."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..services import song_library_store as store

router = APIRouter()


class CreateRequest(BaseModel):
    name: str = ""
    root_path: str
    scan: bool = True


class RenameRequest(BaseModel):
    name: str


@router.get("")
async def list_libraries():
    return {"libraries": store.list_libraries()}


@router.post("")
async def create_library(req: CreateRequest):
    try:
        lib = store.create_library(req.name, req.root_path)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if req.scan:
        try:
            lib = store.scan_library(lib.id)
        except ValueError as e:
            raise HTTPException(400, str(e))
    return lib.to_dict()


@router.get("/media")
async def stream_media(path: str = Query(..., description="Absolute path to a library file")):
    """Stream audio (or other media) from a registered song library."""
    if not path or not Path(path).is_file():
        raise HTTPException(404, "File not found")
    if not store.is_path_in_any_library(path):
        raise HTTPException(403, "Path is not inside a registered song library")
    suffix = Path(path).suffix.lower()
    media = {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".ogg": "audio/ogg",
        ".flac": "audio/flac",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
        ".opus": "audio/opus",
        ".osu": "text/plain",
    }.get(suffix, "application/octet-stream")
    return FileResponse(path, media_type=media, filename=Path(path).name)


@router.get("/{lib_id}")
async def get_library(lib_id: str):
    lib = store.load_library(lib_id)
    if not lib:
        raise HTTPException(404, "Library not found")
    return lib.to_dict()


@router.post("/{lib_id}/scan")
async def scan_library(lib_id: str):
    try:
        lib = store.scan_library(lib_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return lib.to_dict()


@router.patch("/{lib_id}")
async def rename_library(lib_id: str, req: RenameRequest):
    try:
        lib = store.rename_library(lib_id, req.name)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return lib.to_dict()


@router.delete("/{lib_id}")
async def delete_library(lib_id: str):
    store.delete_library(lib_id)
    return {"ok": True}
