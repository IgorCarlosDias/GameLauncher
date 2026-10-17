@echo off
echo Encerrando GameLauncher...

powershell -NoProfile -Command "$envPath = Join-Path '%~dp0' '.env'; $ports = @(); if (Test-Path $envPath) { Get-Content $envPath | ForEach-Object { if ($_ -match '^(PORT|FRONTEND_PORT|VITE_PORT)=(\d+)') { $ports += [int]$matches[2] } } }; if ($ports.Count -eq 0) { $ports = @(3060, 8060) }; $ports = $ports | Select-Object -Unique; Get-NetTCPConnection -LocalPort $ports -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"

echo GameLauncher encerrado com sucesso.
