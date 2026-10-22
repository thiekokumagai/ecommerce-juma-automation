@echo off
title Instalar Automacao Juma no Inicio do Windows
cd /d "%~dp0"
node scripts/setup-startup.js
echo.
pause
