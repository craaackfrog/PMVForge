"""
PMVForge – FastAPI entry point
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from .config import (
    PROJECT_NAME,
    PROJECT_DESCRIPTION,
    PROJECT_VERSION,
    CORS_ORIGINS,
    HOST,
    PORT,
)
from .api import router as api_router

app = FastAPI(
    title=PROJECT_NAME,
    description=PROJECT_DESCRIPTION,
    version=PROJECT_VERSION,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
app.include_router(api_router, prefix="/api")


@app.get("/")
async def root():
    return {
        "app": PROJECT_NAME,
        "version": PROJECT_VERSION,
        "status": "running",
        "docs": "/api/docs",
    }


@app.get("/api/health")
async def health():
    return {"status": "ok", "app": PROJECT_NAME, "version": PROJECT_VERSION}


def run():
    """Convenience runner used by the Windows start script."""
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=HOST,
        port=PORT,
        reload=True,
        reload_dirs=[str(Path(__file__).parent)],
    )


if __name__ == "__main__":
    run()
