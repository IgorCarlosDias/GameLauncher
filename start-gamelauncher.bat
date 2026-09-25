@echo off
title GameLauncher

:: Auto-eleva para Administrador se necessário (essencial para o taskkill encerrar jogos protegidos/elevados)
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ===================================================
    echo Solicitando permissao de Administrador para o GameLauncher...
    echo (Necessario para que o controle remoto possa fechar jogos via taskkill)
    echo ===================================================
    powershell -NoProfile -Command "Start-Process cmd -ArgumentList '/c \"\"%~dpnx0\"\"' -Verb RunAs"
    exit /b
)

echo ===============================
echo       GameLauncher (Admin)
echo ===============================

cd /d "C:\Users\igorc\GameLauncher"

echo Iniciando Backend e Frontend...

npm run dev

pause