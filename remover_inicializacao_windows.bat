@echo off
title Remover Automacao Juma do Inicio do Windows
cd /d "%~dp0"
node scripts/setup-startup.js --remove
echo.
pause
