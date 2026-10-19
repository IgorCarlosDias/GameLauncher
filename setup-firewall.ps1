# ============================================================================
# GameLauncher - Regra de Firewall do Windows (Apenas Sub-rede Local 192.168.0.0/24)
# Libera TCP 3060 (Backend) e TCP 8060 (Frontend) exclusivamente para 192.168.0.0/24
# ============================================================================

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "Solicitando permissao de Administrador (UAC) para aplicar regras no Firewall..." -ForegroundColor Yellow
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit 0
}

$ErrorActionPreference = "Stop"
$RulePrefix = "GameLauncher - Rede Local (192.168.0.0/24)"

Write-Host "Removendo regras antigas do GameLauncher (se existirem)..." -ForegroundColor Cyan
Get-NetFirewallRule -DisplayName "GameLauncher*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue

Write-Host "Criando regra para portas TCP 3060 e 8060 restrita a 192.168.0.0/24 e 127.0.0.1..." -ForegroundColor Cyan
New-NetFirewallRule `
    -DisplayName "$RulePrefix [TCP 3060, 8060 Allow]" `
    -Description "Permite acesso ao GameLauncher (Backend 3060 e Frontend 8060) exclusivamente para dispositivos da sub-rede local 192.168.0.0/24." `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort 3060, 8060 `
    -RemoteAddress "192.168.0.0/24", "127.0.0.1" `
    -Profile Private, Domain, Public `
    -Enabled True | Out-Null

Write-Host "Criando regra de bloqueio explicito para IPs fora da sub-rede local nas portas 3060 e 8060..." -ForegroundColor Cyan
# Nota: No Windows Firewall, regras Block tem precedencia sobre Allow se cobrirem o mesmo IP,
# portanto bloqueamos explicitamente as faixas fora de 192.168.0.0/24 e 127.0.0.1:
New-NetFirewallRule `
    -DisplayName "$RulePrefix [TCP 3060, 8060 Block External]" `
    -Description "Bloqueia conexoes de outras sub-redes/redes externas nas portas 3060 e 8060, mesmo que o Node.js tenha permissao global no firewall." `
    -Direction Inbound `
    -Action Block `
    -Protocol TCP `
    -LocalPort 3060, 8060 `
    -RemoteAddress "0.0.0.0-126.255.255.255", "128.0.0.0-192.167.255.255", "192.168.1.0-255.255.255.255" `
    -Profile Any `
    -Enabled True | Out-Null

Write-Host "Regras de Firewall aplicadas com sucesso!" -ForegroundColor Green
Get-NetFirewallRule -DisplayName "GameLauncher*" | Select-Object DisplayName, Direction, Action, Enabled | Format-Table -AutoSize
