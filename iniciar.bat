@echo off
title Pod & Mais - Automacao Juma
echo ====================================================
echo  Iniciando Automacao Juma - Pod e Mais
echo ====================================================

:: Garante que o diretorio de execucao seja a pasta da automacao
cd /d "%~dp0"

:: Cria a pasta de logs se nao existir
if not exist logs mkdir logs

echo Diretorio: %cd%
echo Executando servico...
echo.

node index.js

pause
