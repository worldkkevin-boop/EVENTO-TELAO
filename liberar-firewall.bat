@echo off
title Liberar Firewall - Telao Evento (porta 3000)

REM Verifica se esta rodando como administrador
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ============================================================
    echo   ATENCAO: precisa rodar como ADMINISTRADOR.
    echo.
    echo   Feche esta janela, clique com o BOTAO DIREITO neste arquivo
    echo   e escolha "Executar como administrador".
    echo ============================================================
    echo.
    pause
    exit /b
)

echo Liberando a porta 3000 no Firewall do Windows...
netsh advfirewall firewall delete rule name="Telao Evento 3000" >nul 2>&1
netsh advfirewall firewall add rule name="Telao Evento 3000" dir=in action=allow protocol=TCP localport=3000

echo.
echo ============================================================
echo   PORTA 3000 LIBERADA!
echo   Agora os outros PCs/teloes da rede conseguem abrir:
echo   http://192.168.18.120:3000/receive.html?t=2
echo ============================================================
echo.
pause
