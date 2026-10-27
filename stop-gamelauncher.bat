@echo off
setlocal EnableDelayedExpansion

title GameLauncher - Encerrar

:: Auto-elevacao para garantir que processos em modo Administrador possam ser finalizados
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs -WindowStyle Hidden"
    exit /b
)

echo Encerrando GameLauncher...

powershell -NoProfile -Command "$ports = @(3060, 8060); Get-NetTCPConnection -LocalPort $ports -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }; Stop-Process -Name syscontrol -Force -ErrorAction SilentlyContinue"

echo GameLauncher encerrado com sucesso.
