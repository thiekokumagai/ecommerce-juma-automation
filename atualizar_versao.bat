@echo off
echo Gerando instalador do Juma Automacao para Windows...
cd /d "%~dp0"
call npm run build
echo Instalador gerado na pasta dist/
pause
