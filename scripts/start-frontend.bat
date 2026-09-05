@echo off
title PMVForge Frontend
cd /d "%~dp0..\frontend"

echo.
echo  ========================================
echo   PMVForge Frontend
echo  ========================================
echo.

if not exist "node_modules" (
    echo Installing npm packages...
    call npm install
)

echo.
echo Starting Vite dev server on http://localhost:5173
echo.

call npm run dev

pause
