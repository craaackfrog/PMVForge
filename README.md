# PMVForge

Local all-in-one tool for PMVs, beatmaps, and Cock Hero overlays.

## Stack

- **Backend:** FastAPI (Python 3.11+)
- **Frontend:** React + Vite + Tailwind
- **Video:** ffmpeg / ffprobe on PATH

## Quick start (Windows)

```bat
scripts\start.bat
```

Or separately:

```bat
scripts\start-backend.bat
scripts\start-frontend.bat
```

- UI: http://localhost:5173  
- API: http://127.0.0.1:8742  

Backend venv:

```bat
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8742 --reload
```

Frontend:

```bat
cd frontend
npm install
npm run dev
```

## Features

- Beat Creator / Editor (waveform, .osu)
- PMV Generate (16:9 / 9:16, HD–4K, zoom-to-fill, library tags/heat)
- Beat effects post-pass (pulse, flash, pink glow)
- Source libraries + tags
- Cock Hero beatbar export
- Settings (temp path, defaults, cleanup)

## Config

- Settings: `%APPDATA%\pmvforge\settings.json`
- Temp default: `G:\temp-pmv` (override in Settings or `PMVFORGE_TEMP`)

## License

Local / personal use. Original Beats2Fun inspiration retained as concept only; runtime code is a clean rewrite.
