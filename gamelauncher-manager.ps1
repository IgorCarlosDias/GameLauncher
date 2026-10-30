# ============================================================================
# GameLauncher - Painel de Controle e Gerenciamento Unificado
# ============================================================================
# Este script unifica:
#  - Iniciar / Parar o servidor (Frontend e Backend)
#  - Liberar regras no Firewall do Windows (Rede Local + Tailscale)
#  - Programar / Remover a inicializacao automatica com o Windows (Task Scheduler)
#  - Abrir no Navegador com IP atual da maquina e porta do frontend
#
# Preparado para execucao direta ou automacao CLI
# ============================================================================

[CmdletBinding()]
param(
    [ValidateSet("Menu", "Start", "StartHidden", "Stop", "Firewall", "AutoStart", "RemoveAutoStart", "OpenBrowser", "Status")]
    [string]$Action = "Menu"
)

# ----------------------------------------------------------------------------
# 1. Verificacao de Privilegios de Administrador (Auto-Elevacao UAC)
# ----------------------------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "[GameLauncher] Solicitando privilegios de Administrador..." -ForegroundColor Yellow
    $argsList = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    if ($Action -ne "Menu") {
        $argsList += " -Action $Action"
    }
    Start-Process powershell.exe -Verb RunAs -ArgumentList $argsList
    exit 0
}

# ----------------------------------------------------------------------------
# 2. Diretorio do Projeto
# ----------------------------------------------------------------------------
$projectDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $projectDir -or -not (Test-Path $projectDir)) { $projectDir = (Get-Location).Path }
Set-Location -Path $projectDir

# ----------------------------------------------------------------------------
# 3. Funcoes de Rede, IP e Frontend
# ----------------------------------------------------------------------------

function Get-GLFrontendPort {
    $envPath = Join-Path $projectDir ".env"
    if (Test-Path $envPath) {
        $line = Get-Content $envPath | Where-Object { $_ -match '^(FRONTEND_PORT|VITE_PORT)\s*=\s*(.+)$' } | Select-Object -First 1
        if ($line -match '=\s*([0-9]+)') {
            return [int]$matches[1]
        }
    }
    return 8060
}

function Get-GLLocalIp {
    try {
        # Procura adaptadores fisicos (Ethernet ou Wi-Fi) na rede local (192.168 ou 10)
        $addrs = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { 
                $_.InterfaceAlias -notmatch 'Loopback|vEthernet|Virtual|WSL' -and 
                $_.IPAddress -notmatch '^169\.254' -and
                ($_.IPAddress -match '^192\.168\.' -or $_.IPAddress -match '^10\.')
            }
        if ($addrs) {
            return ($addrs | Select-Object -First 1).IPAddress
        }

        # Qualquer adaptador fisico IPv4
        $any = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.InterfaceAlias -notmatch 'Loopback' -and $_.IPAddress -notmatch '^169\.254' }
        if ($any) {
            return ($any | Select-Object -First 1).IPAddress
        }
    } catch { }

    # Fallback do .env
    $envPath = Join-Path $projectDir ".env"
    if (Test-Path $envPath) {
        $line = Get-Content $envPath | Where-Object { $_ -match '^SERVER_IP\s*=\s*(.+)$' } | Select-Object -First 1
        if ($line -match '=\s*(.+)$') {
            return $matches[1].Trim().Trim('"').Trim("'")
        }
    }

    return "localhost"
}

function Get-GLFrontendUrl {
    $ip = Get-GLLocalIp
    $port = Get-GLFrontendPort
    return "http://${ip}:${port}"
}

function Open-GameLauncherBrowser {
    $url = Get-GLFrontendUrl
    Write-Host "`nAbrindo GameLauncher no navegador: $url" -ForegroundColor Green
    Start-Process $url
}

function Get-GLStatus {
    $frontendPort = Get-GLFrontendPort
    $ports = @(3060, $frontendPort)
    $activeConns = Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue
    $task = Get-ScheduledTask -TaskName "GameLauncherAutostart" -ErrorAction SilentlyContinue
    
    return [PSCustomObject]@{
        IsRunning   = ($null -ne $activeConns)
        PortsActive = if ($activeConns) { ($activeConns.LocalPort | Select-Object -Unique) -join ", " } else { "Nenhuma" }
        AutoStart   = ($null -ne $task -and $task.State -ne "Disabled")
        Url         = Get-GLFrontendUrl
    }
}

function Stop-GameLauncherServer {
    Write-Host "`n[GameLauncher] Encerrando servicos e liberando portas..." -ForegroundColor Yellow
    $frontendPort = Get-GLFrontendPort
    $ports = @(3060, $frontendPort, 8060)
    $connections = Get-NetTCPConnection -LocalPort $ports -ErrorAction SilentlyContinue
    if ($connections) {
        $connections | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
            Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
        }
    }
    Stop-Process -Name syscontrol -Force -ErrorAction SilentlyContinue
    Write-Host "[GameLauncher] Servidor encerrado com sucesso." -ForegroundColor Green
}

function Start-GameLauncherServer {
    param([switch]$HiddenMode)

    # Limpeza preventiva de portas ocupadas
    Stop-GameLauncherServer

    # Atualiza syscontrol.exe se houver nova versao
    $syscontrolNew = Join-Path $projectDir "backend\syscontrol_new.exe"
    $syscontrolBin = Join-Path $projectDir "backend\syscontrol.exe"
    if (Test-Path $syscontrolNew) {
        Move-Item -Path $syscontrolNew -Destination $syscontrolBin -Force -ErrorAction SilentlyContinue
    }

    if ($HiddenMode) {
        Write-Host "[GameLauncher] Iniciando servidor em segundo plano..." -ForegroundColor Cyan
        $startScript = Join-Path $projectDir "start-gamelauncher.ps1"
        Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`" -Hidden" -WindowStyle Hidden -WorkingDirectory $projectDir
        Write-Host "[GameLauncher] Inicializacao em segundo plano disparada." -ForegroundColor Green
        Write-Host "Acesse em: $(Get-GLFrontendUrl)" -ForegroundColor Yellow
    } else {
        $host.UI.RawUI.WindowTitle = "GameLauncher (Servidor Ativo)"
        Write-Host "`n==============================================" -ForegroundColor Cyan
        Write-Host "           GameLauncher (Administrador)       " -ForegroundColor Cyan
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host "`nIniciando Backend e Frontend via npm run dev...`n" -ForegroundColor Green
        & npm.cmd run dev
    }
}

function Setup-GameLauncherFirewall {
    Write-Host "`n==========================================================" -ForegroundColor Cyan
    Write-Host "  Configurando Firewall do Windows para GameLauncher      " -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan

    Write-Host "1. Removendo regras antigas do GameLauncher..." -ForegroundColor Yellow
    Get-NetFirewallRule -DisplayName "GameLauncher*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue

    Write-Host "2. Criando regra restrita para portas TCP 3060 e 8060..." -ForegroundColor Yellow
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
}

function Setup-GameLauncherAutoStart {
    Write-Host "`n==========================================================" -ForegroundColor Cyan
    Write-Host "  Configuracao de Inicializacao Automatica (Agendador)   " -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan

    $taskName = "GameLauncherAutostart"
    $vbsPath = Join-Path $projectDir "start-hidden.vbs"
    $currentUser = $env:USERNAME

    $oldTasks = @("GameLauncherAutostart", "GameLauncherInteractive")
    foreach ($t in $oldTasks) {
        if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
            Write-Host "Removendo tarefa agendada anterior '$t'..." -ForegroundColor Gray
            Unregister-ScheduledTask -TaskName $t -Confirm:$false
        }
    }

    Write-Host "Registrando tarefa '$taskName' no Agendador do Windows..." -ForegroundColor Yellow
    $action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbsPath`"" -WorkingDirectory $projectDir
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
    $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit 0 -MultipleInstances Parallel

    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null

    $startupFolder = [System.IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\Start Menu\Programs\Startup")
    $startupVbs = Join-Path $startupFolder "start-hidden.vbs"
    $startupLnk = Join-Path $startupFolder "GameLauncher.lnk"
    if (Test-Path $startupVbs) { Remove-Item -Path $startupVbs -Force -ErrorAction SilentlyContinue }
    if (Test-Path $startupLnk) { Remove-Item -Path $startupLnk -Force -ErrorAction SilentlyContinue }

    Write-Host "`nAuto-Start configurado com sucesso!" -ForegroundColor Green
    Write-Host "- O GameLauncher vai iniciar silenciosamente como Administrador ao ligar o PC." -ForegroundColor White
}

function Remove-GameLauncherAutoStart {
    Write-Host "`nRemovendo Inicializacao Automatica..." -ForegroundColor Yellow
    $oldTasks = @("GameLauncherAutostart", "GameLauncherInteractive")
    foreach ($t in $oldTasks) {
        if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $t -Confirm:$false
            Write-Host "Tarefa '$t' removida com sucesso." -ForegroundColor Green
        }
    }
}

# ----------------------------------------------------------------------------
# 4. Modo Linha de Comando Direta / Automacao
# ----------------------------------------------------------------------------
switch ($Action) {
    "Start"           { Start-GameLauncherServer; exit 0 }
    "StartHidden"     { Start-GameLauncherServer -HiddenMode; exit 0 }
    "Stop"            { Stop-GameLauncherServer; exit 0 }
    "Firewall"        { Setup-GameLauncherFirewall; exit 0 }
    "AutoStart"       { Setup-GameLauncherAutoStart; exit 0 }
    "RemoveAutoStart" { Remove-GameLauncherAutoStart; exit 0 }
    "OpenBrowser"     { Open-GameLauncherBrowser; exit 0 }
    "Status"          {
        $st = Get-GLStatus
        Write-Host "Servidor Rodando: $($st.IsRunning)"
        Write-Host "Portas Ativas:    $($st.PortsActive)"
        Write-Host "Auto-Start:       $($st.AutoStart)"
        Write-Host "URL de Acesso:    $($st.Url)"
        exit 0
    }
}

# ----------------------------------------------------------------------------
# 5. Modo Menu Interativo (Padrao)
# ----------------------------------------------------------------------------
function Show-Menu {
    do {
        Clear-Host
        $status = Get-GLStatus
        $statusText = if ($status.IsRunning) { "EM EXECUCAO (Portas: $($status.PortsActive))" } else { "PARADO" }
        $statusColor = if ($status.IsRunning) { "Green" } else { "Red" }
        $autoText = if ($status.AutoStart) { "ATIVADO" } else { "DESATIVADO" }

        Write-Host "==========================================================" -ForegroundColor Cyan
        Write-Host "               GAMELAUNCHER - PAINEL DE CONTROLE          " -ForegroundColor Cyan
        Write-Host "==========================================================" -ForegroundColor Cyan
        Write-Host " Status do Servidor : " -NoNewline
        Write-Host "$statusText" -ForegroundColor $statusColor
        Write-Host " URL de Acesso Web  : $($status.Url)" -ForegroundColor Green
        Write-Host " Auto-Start Windows : $autoText" -ForegroundColor White
        Write-Host " Diretorio          : $projectDir" -ForegroundColor Gray
        Write-Host "==========================================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host " [1] Iniciar Servidor (Janela visivel / logs)" -ForegroundColor White
        Write-Host " [2] Iniciar Servidor em Segundo Plano (Oculto)" -ForegroundColor White
        Write-Host " [3] Parar Servidor (Liberar portas)" -ForegroundColor White
        Write-Host " [4] Abrir GameLauncher no Navegador ($($status.Url))" -ForegroundColor Cyan
        Write-Host " [5] Configurar Regras de Firewall (Rede Local + VPN)" -ForegroundColor White
        Write-Host " [6] Programar Auto-Start no Windows (Sem senha / UAC)" -ForegroundColor White
        Write-Host " [7] Desativar Auto-Start no Windows" -ForegroundColor White
        Write-Host " [0] Sair" -ForegroundColor Gray
        Write-Host ""
        $choice = Read-Host "Escolha uma opcao [0-7]"

        switch ($choice) {
            "1" {
                Start-GameLauncherServer
            }
            "2" {
                Start-GameLauncherServer -HiddenMode
                Start-Sleep -Seconds 2
            }
            "3" {
                Stop-GameLauncherServer
                Start-Sleep -Seconds 2
            }
            "4" {
                Open-GameLauncherBrowser
                Start-Sleep -Seconds 1
            }
            "5" {
                Setup-GameLauncherFirewall
                Write-Host "`nPressione qualquer tecla para voltar ao menu..." -ForegroundColor Gray
                $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
            }
            "6" {
                Setup-GameLauncherAutoStart
                Write-Host "`nPressione qualquer tecla para voltar ao menu..." -ForegroundColor Gray
                $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
            }
            "7" {
                Remove-GameLauncherAutoStart
                Write-Host "`nPressione qualquer tecla para voltar ao menu..." -ForegroundColor Gray
                $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
            }
            "0" {
                Write-Host "Saindo..." -ForegroundColor Gray
                break
            }
            default {
                Write-Host "Opcao invalida. Tente novamente." -ForegroundColor Red
                Start-Sleep -Seconds 1
            }
        }
    } while ($choice -ne "0")
}

Show-Menu
