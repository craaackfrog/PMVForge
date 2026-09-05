@echo off
title PMVForge Backend
cd /d "%~dp0..\backend"

echo.
echo  ========================================
echo   PMVForge Backend
echo  ========================================
echo.

if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv
)

call venv\Scripts\activate.bat

echo Installing / updating dependencies...
pip install -r requirements.txt --quiet

echo.
echo Starting server on http://127.0.0.1:8742
echo API docs: http://127.0.0.1:8742/api/docs
echo.

python -m uvicorn app.main:app --host 127.0.0.1 --port 8742 --reload

pause
