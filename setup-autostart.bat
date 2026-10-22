@echo off
setlocal EnableDelayedExpansion

title GameLauncher - Setup Autostart

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [GameLauncher] Solicitando privilegios de Administrador para registrar tarefa...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-autostart.ps1"

echo.
pause
