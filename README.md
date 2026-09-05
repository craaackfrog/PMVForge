# PMVForge

**All-in-one local tool for creating PMVs from beatmaps and funscripts.**

Local web UI (React + FastAPI) that replaces the original Beats2Fun desktop tools and adds a powerful Beatmap Creator with an interactive waveform editor.

---

## Features

- **Beat Creator**
  - Automatic beat detection (librosa)
  - Interactive waveform editor (add / move / delete beats)
  - Title / Artist / Creator metadata
  - Export as `.osu`, `.txt` or `.funscript`
- **PMV Generation**
  - Full pipeline (beat input + video folder → output video)
  - All original quality / performance options
  - Optional beatbar overlay
  - GPU (CUDA) support
  - Background job with live progress
- Dark minimal UI (min-theme inspired + shadcn style)
- Easy rebranding via a single config file
- Temp files in `C:\temp-pmv`
- Recent history

---

## Quick start (Windows)

1. Make sure you have **Python 3.11+** and **Node.js 18+** installed.
2. Also make sure **ffmpeg** is on your PATH (required for PMV generation).
3. Double-click:

```
scripts\start.bat
```

This opens two terminals (backend + frontend).  
Then open **http://localhost:5173** in your browser.

---

## Project structure

```
PMVForge/
├── backend/
│   ├── app/
│   │   ├── config.py          ← rename the whole app here
│   │   ├── main.py
│   │   ├── api/               ← REST endpoints
│   │   └── services/
│   │       ├── beat_detector.py
│   │       ├── pmv_generator.py
│   │       └── legacy/        ← original Beats2Fun code (wrapped)
│   └── requirements.txt
├── frontend/                  ← React + Vite + Tailwind
├── scripts/                   ← Windows start scripts
└── README.md
```

---

## Renaming the project

Open `backend/app/config.py` and change:

```python
PROJECT_NAME = "PMVForge"
PROJECT_SLUG = "pmvforge"
```

Most user-facing strings derive from these values.  
Frontend constants live in `frontend/src/lib/config.js` — keep them in sync.

---

## Development status

- [x] Project scaffold + rename system
- [x] FastAPI skeleton
- [x] Beat detection + export
- [x] Interactive waveform editor
- [x] PMV generation service (first version)
- [x] Generate page with live job progress
- [ ] Polish / edge-case handling on generation
- [x] Folder browser dialogs (native)
- [ ] Queue of multiple jobs
- [ ] Docker support

---

## Original inspiration

Based on [Beats2Fun](https://github.com/Nootna8/Beats2Fun) by Nootna8.
