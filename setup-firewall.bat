@echo off
chcp 65001 >nul
echo ============================================================================
echo   GameLauncher - Configuracao de Firewall (Rede Local + Tailscale VPN)
echo ============================================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-firewall.ps1"
pause
