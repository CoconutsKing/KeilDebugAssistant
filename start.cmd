@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 20 or later.
  pause
  exit /b 1
)
node scripts\start.mjs
pause
