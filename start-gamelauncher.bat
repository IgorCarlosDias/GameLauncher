@echo off

title GameLauncher

echo ==============================================
echo                 GameLauncher
echo ==============================================

cd /d "%~dp0"

echo Iniciando Backend e Frontend...

npm run dev

pause