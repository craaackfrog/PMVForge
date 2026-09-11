"""
PMVForge – Central configuration
================================
Change PROJECT_NAME and related values here to rebrand the entire application.
"""

from pathlib import Path
import os

# ─────────────────────────────────────────────────────────────
# PROJECT IDENTITY (change these to rename the whole app)
# ─────────────────────────────────────────────────────────────
PROJECT_NAME: str = "PMVForge"
PROJECT_SLUG: str = "pmvforge"
PROJECT_DESCRIPTION: str = "All-in-one local tool for creating PMVs from beatmaps"
PROJECT_VERSION: str = "0.2.0"
PROJECT_AUTHOR: str = "crackfrog"

# ─────────────────────────────────────────────────────────────
# PATHS
# ─────────────────────────────────────────────────────────────
# Default temporary directory (Windows-friendly)
DEFAULT_TEMP_DIR: str = r"G:\temp-pmv"

# Backend root (this file lives in backend/app/)
BACKEND_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_ROOT.parent

# ─────────────────────────────────────────────────────────────
# SERVER
# ─────────────────────────────────────────────────────────────
HOST: str = "127.0.0.1"
PORT: int = 8742
RELOAD: bool = True

# ─────────────────────────────────────────────────────────────
# CORS (frontend runs on a different port during development)
# ─────────────────────────────────────────────────────────────
CORS_ORIGINS: list[str] = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]

# ─────────────────────────────────────────────────────────────
# FEATURE FLAGS / DEFAULTS
# ─────────────────────────────────────────────────────────────
DEFAULT_FPS: int = 30
DEFAULT_RESOLUTION: str = "1280:720"
DEFAULT_BITRATE: str = "3M"
DEFAULT_THREADS: int = 4
DEFAULT_BATCH_SIZE: int = 10
DEFAULT_CLIP_DIST: float = 0.4
DEFAULT_VOLUME: float = 0.0

# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────
def get_temp_dir() -> Path:
    """Return the temporary directory, creating it if necessary.
    Priority: PMVFORGE_TEMP env → user settings.json → DEFAULT_TEMP_DIR.
    """
    env = os.environ.get("PMVFORGE_TEMP")
    if env:
        path = Path(env)
        path.mkdir(parents=True, exist_ok=True)
        return path
    try:
        from .services.user_settings import get_temp_dir_setting
        return get_temp_dir_setting()
    except Exception:
        path = Path(DEFAULT_TEMP_DIR)
        path.mkdir(parents=True, exist_ok=True)
        return path


def get_config_dir() -> Path:
    """User config / history directory."""
    if os.name == "nt":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    else:
        base = Path.home() / ".config"
    cfg = base / PROJECT_SLUG
    cfg.mkdir(parents=True, exist_ok=True)
    return cfg
