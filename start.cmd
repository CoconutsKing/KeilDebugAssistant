@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 20 or later.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:3210"
node server.mjs
pause
