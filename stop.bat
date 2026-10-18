@echo off
cd /d "%~dp0"
node stop.mjs
if errorlevel 1 pause
