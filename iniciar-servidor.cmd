@echo off
REM ===========================================================================
REM  Iniciar o servidor do Inventario TI (porta 5903) - versao SEGURO.
REM
REM  ANTES este .cmd rodava "node server.cjs" DIRETO no console. Com QuickEdit
REM  ativado (padrao do Windows), uma selecao de texto na janela congelava o
REM  event loop do node e o painel ficava em carregamento infinito.
REM
REM  AGORA a saida vai para ARQUIVO (server.log / server.err.log) via
REM  iniciar-servidor.ps1 - o WriteFile nunca pode bloquear o servidor.
REM ===========================================================================
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar-servidor.ps1"
if errorlevel 1 (
    echo.
    echo Falha ao iniciar. Veja iniciar-servidor.log e server.err.log
    pause
)
