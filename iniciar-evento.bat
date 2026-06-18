@echo off
title Servidor do Telao - Uniao Brasil
cd /d "%~dp0"

REM URL de contagem da nuvem (Apps Script + Sheets)
set "PRESENCA_URL=https://script.google.com/macros/s/AKfycbzS6viXBBHtDTDEv24EdesulH3tmlWQErwNkEZGx3ncjjNMQwJ4DYqNfiNRoXFRTtp7/exec?action=count"

echo ==================================================
echo   SERVIDOR DO TELAO (conectado a nuvem)
echo ==================================================
echo.
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
