# Compila o GameLauncher.exe a partir de app\*.cs usando o csc.exe nativo do Windows (.NET Framework 4.x).
param([string]$Output)

$ErrorActionPreference = "Stop"

$root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
Set-Location -Path $root

$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { $csc = "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe" }
if (-not (Test-Path $csc)) { Write-Host "[ERRO] csc.exe nao encontrado." -ForegroundColor Red; exit 1 }

if (-not $Output) { $Output = Join-Path $root "GameLauncher.exe" }
$sources = Get-ChildItem -Path (Join-Path $root "app") -Filter *.cs | ForEach-Object { "`"$($_.FullName)`"" }

$cscArgs = @(
    "/nologo", "/target:winexe", "/optimize+", "/codepage:65001", "/utf8output",
    "/out:`"$Output`"",
    "/win32icon:`"$(Join-Path $root 'app.ico')`"",
    "/win32manifest:`"$(Join-Path $root 'app.manifest')`"",
    "/r:System.dll", "/r:System.Core.dll", "/r:System.Drawing.dll", "/r:System.Windows.Forms.dll"
) + $sources

$process = Start-Process -FilePath $csc -ArgumentList $cscArgs -NoNewWindow -Wait -PassThru

if ($process.ExitCode -ne 0 -or -not (Test-Path $Output)) {
    Write-Host "[ERRO] Falha na compilacao. Se o GameLauncher estiver aberto, feche-o (bandeja > Sair) e tente novamente." -ForegroundColor Red
    exit 1
}

$size = [math]::Round((Get-Item $Output).Length / 1KB, 1)
Write-Host "[OK] $Output ($size KB)" -ForegroundColor Green
