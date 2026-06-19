@echo off
title Servidor do Telao - Uniao Brasil
cd /d "%~dp0"

REM URL base do Web App da nuvem (Apps Script). NAO coloque ?action aqui.
set "WEBAPP_URL=https://script.google.com/macros/s/AKfycbzS6viXBBHtDTDEv24EdesulH3tmlWQErwNkEZGx3ncjjNMQwJ4DYqNfiNRoXFRTtp7/exec"

echo ==================================================
echo   SERVIDOR DO TELAO - UNIAO BRASIL
echo ==================================================
echo.
set /p EVENTO=Digite o NOME DO EVENTO (ou ENTER para contar todos):
echo.

REM Encerra qualquer servidor antigo na porta 3000
echo Liberando a porta 3000 (se houver servidor antigo)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
timeout /t 1 >nul

echo.
echo   Evento:  %EVENTO%
echo   Painel:  http://localhost:3000/transmit.html
echo   Telao:   http://localhost:3000/receive.html?t=1
echo.
echo   Para parar: feche esta janela.
echo ==================================================
echo.

node server.js

echo.
echo (Servidor parou. Pressione uma tecla para fechar.)
pause >nul
