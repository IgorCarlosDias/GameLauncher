@echo off
setlocal EnableDelayedExpansion

title GameLauncher

:: ========================================================
:: Auto-elevacao para Administrador (necessario para UIPI)
:: Permite que o Touchpad/Teclado controlem jogos rodando como Admin
:: ========================================================
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [GameLauncher] Solicitando privilegios de Administrador...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"

echo ==============================================
echo            GameLauncher (Administrador)
echo ==============================================
echo.
echo Iniciando Backend e Frontend...
echo.

npm run dev

pause
