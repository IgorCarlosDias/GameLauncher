# ============================================================================
# GameLauncher - Encerrar Servidor
# ============================================================================
param()

# Auto-elevacao para Administrador caso necessario
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -WindowStyle Hidden
    exit 0
}

$projectDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $projectDir -or -not (Test-Path $projectDir)) { $projectDir = (Get-Location).Path }

Write-Host "Encerrando GameLauncher..." -ForegroundColor Yellow

# Le portas configuradas do .env (com limpeza preventiva)
$bePort = 3060
$fePort = 8060
$envFile = Join-Path $projectDir ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^(PORT)\s*=\s*(\d+)') { $bePort = [int]$matches[2] }
        if ($_ -match '^(FRONTEND_PORT|VITE_PORT)\s*=\s*(\d+)') { $fePort = [int]$matches[2] }
    }
}
$ports = @(3060, 8060, $bePort, $fePort) | Select-Object -Unique
$connections = Get-NetTCPConnection -LocalPort $ports -ErrorAction SilentlyContinue
if ($connections) {
    $connections | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
        Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
    }
}

# Encerra o processo auxiliar syscontrol
Stop-Process -Name syscontrol -Force -ErrorAction SilentlyContinue

Write-Host "GameLauncher encerrado com sucesso." -ForegroundColor Green
Start-Sleep -Seconds 1
