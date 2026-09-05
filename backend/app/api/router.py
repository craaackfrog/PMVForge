"""
Main API router – aggregates all endpoint modules.
"""

from fastapi import APIRouter

from . import beats, projects, system, generate, cockhero, libraries, presets

router = APIRouter()

router.include_router(system.router, prefix="/system", tags=["System"])
router.include_router(beats.router, prefix="/beats", tags=["Beatmap Creator"])
router.include_router(projects.router, prefix="/projects", tags=["Projects & History"])
router.include_router(generate.router, prefix="/generate", tags=["PMV Generation"])
router.include_router(cockhero.router, prefix="/cockhero", tags=["Cock Hero"])
router.include_router(libraries.router, prefix="/libraries", tags=["Source Libraries"])
router.include_router(presets.router, prefix="/presets", tags=["Presets / Modes"])
