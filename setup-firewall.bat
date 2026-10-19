@echo off
chcp 65001 >nul
echo ============================================================================
echo   GameLauncher - Configuracao de Firewall (Sub-rede 192.168.0.0/24)
echo ============================================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-firewall.ps1"
pause
