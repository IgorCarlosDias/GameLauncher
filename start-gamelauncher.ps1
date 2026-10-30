# ============================================================================
# GameLauncher - Iniciar Servidor (Administrador)
# ============================================================================
param(
    [switch]$Hidden
)

# Auto-elevacao para Administrador (necessario para UIPI / controle de janelas de jogos)
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    $scriptArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    if ($Hidden) {
        $scriptArgs += " -Hidden"
        Start-Process powershell.exe -Verb RunAs -ArgumentList $scriptArgs -WindowStyle Hidden
    } else {
        Write-Host "[GameLauncher] Solicitando privilegios de Administrador..." -ForegroundColor Yellow
        Start-Process powershell.exe -Verb RunAs -ArgumentList $scriptArgs
    }
    exit 0
}

# Define diretorio de trabalho como a pasta deste script
$projectDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $projectDir -or -not (Test-Path $projectDir)) { $projectDir = (Get-Location).Path }
Set-Location -Path $projectDir

# Le portas configuradas do .env (com limpeza preventiva das padroes e customizadas)
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
Get-NetTCPConnection -LocalPort $ports -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }

Stop-Process -Name syscontrol -Force -ErrorAction SilentlyContinue

# Atualiza binario do syscontrol se houver versao pendente
$syscontrolNew = Join-Path $projectDir "backend\syscontrol_new.exe"
$syscontrolBin = Join-Path $projectDir "backend\syscontrol.exe"
if (Test-Path $syscontrolNew) {
    Move-Item -Path $syscontrolNew -Destination $syscontrolBin -Force -ErrorAction SilentlyContinue
}

if (-not $Hidden) {
    $host.UI.RawUI.WindowTitle = "GameLauncher (Administrador)"
    Write-Host "==============================================" -ForegroundColor Cyan
    Write-Host "           GameLauncher (Administrador)       " -ForegroundColor Cyan
    Write-Host "==============================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Iniciando Backend e Frontend..." -ForegroundColor Green
    Write-Host ""
}

# Inicia o GameLauncher via npm
& npm.cmd run dev

if (-not $Hidden) {
    Write-Host ""
    Write-Host "GameLauncher encerrado. Pressione qualquer tecla para sair..." -ForegroundColor Gray
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}
