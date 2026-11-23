@echo off
REM ============================================================================
REM  ATALHO DE COMPATIBILIDADE — NAO USE ESTE ARQUIVO
REM  O instalador correto esta na pasta "execução bat":
REM      ..\execução bat\instalar-tudo.bat
REM
REM  Este arquivo existia com um bug (HostMetadata estatico + HostMetadataItem
REM  juntos anulavam o IP adaptativo). Agora so redireciona para o correto.
REM ============================================================================
echo.
echo  [AVISO] Este arquivo e o instalador ANTIGO (pre-2026-11).
echo  Redirecionando para o instalador unico em "execução bat"...
echo.
set "NOVO=%~dp0..\execução bat\instalar-tudo.bat"
if not exist "%NOVO%" (
    echo  [ERRO] Instalador novo nao encontrado: %NOVO%
    pause
    exit /b 1
)
call "%NOVO%" %*
exit /b %errorlevel%
