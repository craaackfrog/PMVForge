@echo off
title PMVForge
cd /d "%~dp0.."

echo.
echo  ========================================
echo   PMVForge - Starting...
echo  ========================================
echo.

:: Start backend in a new window
start "PMVForge Backend" cmd /k "%~dp0start-backend.bat"

:: Small delay so backend can boot first
timeout /t 3 /nobreak > nul

:: Start frontend in a new window
start "PMVForge Frontend" cmd /k "%~dp0start-frontend.bat"

echo.
echo Backend  → http://127.0.0.1:8742
echo Frontend → http://localhost:5173
echo.
echo Both windows have been opened.
echo Close them to stop the servers.
echo.
pause
