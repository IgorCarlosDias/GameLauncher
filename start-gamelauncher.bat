@echo off
setlocal EnableDelayedExpansion

title GameLauncher

set IS_HIDDEN=0
if "%1"=="--hidden" set IS_HIDDEN=1

:: ========================================================
:: Auto-elevacao para Administrador (necessario para UIPI)
:: Permite que o Touchpad/Teclado controlem jogos rodando como Admin
:: ========================================================
net session >nul 2>&1
if %errorlevel% neq 0 (
    if "!IS_HIDDEN!"=="1" (
        powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList '--hidden' -WorkingDirectory '%~dp0' -Verb RunAs -WindowStyle Hidden"
    ) else (
        echo [GameLauncher] Solicitando privilegios de Administrador...
        powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -WorkingDirectory '%~dp0' -Verb RunAs"
    )
    exit /b
)

cd /d "%~dp0"

:: Encerra processos presos nas portas do GameLauncher para evitar conflitos (ex: porta 8060 -> 8061)
powershell -NoProfile -Command "$ports = @(3060, 8060); Get-NetTCPConnection -LocalPort $ports -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }" >nul 2>&1

if "!IS_HIDDEN!"=="0" (
    echo ==============================================
    echo            GameLauncher (Administrador)
    echo ==============================================
    echo.
    echo Iniciando Backend e Frontend...
    echo.
)

call npm run dev

if "!IS_HIDDEN!"=="0" pause
