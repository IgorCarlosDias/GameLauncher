# ============================================================================
# GameLauncher - Regra Restrita (Apenas Rede Local 192.168.0.0/24 e Tailscale 100.64.0.0/10)
# ============================================================================

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "Solicitando permissao de Administrador (UAC)..." -ForegroundColor Yellow
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit 0
}

Write-Host "Removendo regras antigas do GameLauncher..." -ForegroundColor Cyan
Get-NetFirewallRule -DisplayName "GameLauncher*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue

Write-Host "Criando regra restrita para portas TCP 3060 e 8060..." -ForegroundColor Green
New-NetFirewallRule `
    -DisplayName "GameLauncher [TCP 3060, 8060 - Sub-rede e Tailscale]" `
    -Description "Permite acesso ao GameLauncher exclusivamente para rede local 192.168.0.0/24 e VPN Tailscale 100.64.0.0/10." `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort 3060, 8060 `
    -RemoteAddress "192.168.0.0/24", "100.64.0.0/10", "127.0.0.1" `
    -Profile Any `
    -Enabled True | Out-Null

Write-Host "Regra aplicada com sucesso!" -ForegroundColor Green
Get-NetFirewallRule -DisplayName "GameLauncher*" | ForEach-Object {
    $r = $_
    $a = Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $r
    $p = Get-NetFirewallPortFilter -AssociatedNetFirewallRule $r
    [PSCustomObject]@{
        Regra         = $r.DisplayName
        Acao          = $r.Action
        Portas        = ($p.LocalPort -join ", ")
        IPsPermitidos = ($a.RemoteAddress -join ", ")
    }
} | Format-List
