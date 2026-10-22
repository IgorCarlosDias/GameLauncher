# Setup-Autostart.ps1 - GameLauncher Auto-Start via Agendador de Tarefas (Admin Silencioso sem Senha)
param()

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  GameLauncher - Configuracao de Inicializacao Automatica " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

$taskName = "GameLauncherAutostart"
$projectDir = "C:\Users\igorc\GameLauncher"
$vbsPath = Join-Path $projectDir "start-hidden.vbs"
$currentUser = $env:USERNAME

if (-not (Test-Path $vbsPath)) {
    Write-Host "[ERRO] Arquivo nao encontrado: $vbsPath" -ForegroundColor Red
    exit 1
}

# 1. Remover tarefas antigas se existirem
Write-Host "[1/3] Verificando tarefas agendadas anteriores..." -ForegroundColor Yellow
$oldTasks = @("GameLauncherAutostart", "GameLauncherInteractive")
foreach ($t in $oldTasks) {
    if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
        Write-Host "      Removendo tarefa antiga '$t'..." -ForegroundColor Gray
        Unregister-ScheduledTask -TaskName $t -Confirm:$false
    }
}

# 2. Criar a nova tarefa no Agendador de Tarefas
Write-Host "[2/3] Registrando tarefa no Agendador do Windows..." -ForegroundColor Yellow

$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbsPath`"" -WorkingDirectory $projectDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit 0 -MultipleInstances Parallel

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null

Write-Host "      Tarefa '$taskName' criada com sucesso! (Nivel: Administrador Interativo)" -ForegroundColor Green

# 3. Remover atalho duplicado da pasta de inicializacao comum (shell:startup)
Write-Host "[3/3] Limpando pasta de inicializacao comum (evita duplicacao)..." -ForegroundColor Yellow
$startupFolder = [System.IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\Start Menu\Programs\Startup")
$startupVbs = Join-Path $startupFolder "start-hidden.vbs"
$startupLnk = Join-Path $startupFolder "GameLauncher.lnk"

if (Test-Path $startupVbs) {
    Remove-Item -Path $startupVbs -Force
    Write-Host "      Removido $startupVbs" -ForegroundColor Gray
}
if (Test-Path $startupLnk) {
    Remove-Item -Path $startupLnk -Force
    Write-Host "      Removido $startupLnk" -ForegroundColor Gray
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  CONFIGURACAO CONCLUIDA COM SUCESSO!                     " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Quando o Windows ligar e entrar no seu usuario:" -ForegroundColor White
Write-Host " - O GameLauncher vai iniciar como Administrador automaticamente." -ForegroundColor White
Write-Host " - Sem pedir senha nenhuma." -ForegroundColor White
Write-Host " - Sem exibir tela do UAC na TV." -ForegroundColor White
Write-Host ""
