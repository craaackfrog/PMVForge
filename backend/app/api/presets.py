"""Named mode / preset endpoints."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Any, Dict, Optional

from ..services import preset_store as store

router = APIRouter()


class PresetBody(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    generate: Optional[Dict[str, Any]] = None
    library: Optional[Dict[str, Any]] = None
    cockhero: Optional[Dict[str, Any]] = None


class DuplicateBody(BaseModel):
    name: Optional[str] = None


@router.get("")
async def list_presets():
    return {"presets": store.list_presets()}


@router.get("/{preset_id}")
async def get_preset(preset_id: str):
    p = store.get_preset(preset_id)
    if not p:
        raise HTTPException(404, "Preset not found")
    return p


@router.post("")
async def create_preset(body: PresetBody):
    return store.create_preset({
        "name": body.name or "Custom",
        "description": body.description or "",
        "generate": body.generate or {},
        "library": body.library or {},
        "cockhero": body.cockhero or {},
    })


@router.put("/{preset_id}")
async def update_preset(preset_id: str, body: PresetBody):
    try:
        return store.update_preset(preset_id, body.model_dump(exclude_none=True))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/{preset_id}")
async def patch_preset(preset_id: str, body: PresetBody):
    try:
        return store.update_preset(preset_id, body.model_dump(exclude_none=True))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/{preset_id}")
async def delete_preset(preset_id: str):
    try:
        store.delete_preset(preset_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


@router.post("/{preset_id}/duplicate")
async def duplicate_preset(preset_id: str, body: DuplicateBody = DuplicateBody()):
    try:
        return store.duplicate_preset(preset_id, body.name)
    except ValueError as e:
        raise HTTPException(400, str(e))
