@echo off
REM ============================================================================
REM  INSTALADOR UNICO - Zabbix Agent 2 + IP Adaptativo
REM  Inventário TI - Monitoramento de TI
REM
REM  O que faz:
REM    1) Verifica privilegios de Administrador
REM    2) Instala o Zabbix Agent 2 (MSI silencioso)
REM    3) Configura o agente para conectar ao servidor Zabbix
REM    4) Habilita IP adaptativo (auto-registro + reinicio no evento de rede)
REM    5) Inicia/reinicia o servico
REM    6) Testa a conexao
REM
REM  USO: clique com botao direito -> "Executar como administrador"
REM  Nao e necessario editar nada - tudo e configurado automaticamente.
REM ============================================================================

setlocal enabledelayedexpansion
title Instalador Zabbix Agent 2 - Inventário TI
color 0A

REM ---- Configuracoes (ajuste apenas se o servidor mudar) ----
set "ZBX_SERVER=192.168.0.102"
set "ZBX_PORT=10051"
set "ZBX_WEB=192.168.0.102:8081"
set "ZBX_HOSTNAME=%COMPUTERNAME%"
set "ZBX_METADATA=inventario-ti"
set "ZBX_CONF_DIR=C:\Program Files\Zabbix Agent 2"
set "ZBX_CONF=%ZBX_CONF_DIR%\zabbix_agent2.conf"
set "ZBX_EXE=%ZBX_CONF_DIR%\zabbix_agent2.exe"
set "MSI_NAME=zabbix_agent2-7.0-latest-windows-amd64-openssl.msi"

REM ---- Descobre a pasta do script (onde esta o MSI) ----
set "SCRIPT_DIR=%~dp0"
set "MSI_PATH=%SCRIPT_DIR%%MSI_NAME%"

echo.
echo  ============================================================
echo   INSTALADOR UNICO - Zabbix Agent 2 + IP Adaptativo
echo   Servidor: %ZBX_SERVER%  ^|  Host: %ZBX_HOSTNAME%
echo  ============================================================
echo.

REM ---- 1) Verifica Administrador ----
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] Execute como Administrador!
    echo        Clique com botao direito no arquivo e escolha
    echo        "Executar como administrador".
    echo.
    pause
    exit /b 1
)
echo [OK] Privilegios de Administrador confirmados.

REM ---- 2) Verifica/Instala o MSI ----
if not exist "%MSI_PATH%" (
    echo [ERRO] MSI nao encontrado: %MSI_PATH%
    echo        Coloque o arquivo %MSI_NAME% na mesma pasta deste .bat
    echo.
    pause
    exit /b 1
)

sc query "Zabbix Agent 2" >nul 2>&1
if %errorlevel% equ 0 (
    echo [INFO] Agente ja instalado. Atualizando configuracao...
) else (
    echo [INFO] Instalando Zabbix Agent 2...
    msiexec /i "%MSI_PATH%" /qn /norestart SERVER=%ZBX_SERVER% SERVERACTIVE=%ZBX_SERVER% HOSTNAME=%ZBX_HOSTNAME% HOSTMETADATA=%ZBX_METADATA%
    if %errorlevel% neq 0 (
        echo [ERRO] Falha na instalacao do MSI. Codigo: %errorlevel%
        pause
        exit /b 1
    )
    echo [OK] Instalacao concluida.
)

REM ---- 3) Configura o agente ----
echo [INFO] Configurando agente...

if not exist "%ZBX_CONF_DIR%" mkdir "%ZBX_CONF_DIR%"

REM Backup do conf existente
if exist "%ZBX_CONF%" (
    copy /y "%ZBX_CONF%" "%ZBX_CONF%.bak" >nul 2>&1
)

REM Escreve o conf completo (sobrescreve para garantir consistencia)
(
echo # Zabbix Agent 2 - Configuracao automatica (Inventário TI)
echo # Gerado por instalar-tudo.bat
echo.
echo Server=%ZBX_SERVER%
echo ServerActive=%ZBX_SERVER%
echo Hostname=%ZBX_HOSTNAME%
echo HostMetadata=%ZBX_METADATA%
echo.
echo # IP Adaptativo: reinicio automatico ao mudar de rede/IP
echo # (o auto-registro do Zabbix atualiza a interface do host)
echo.
echo # Logs
echo LogFile=C:\Program Files\Zabbix Agent 2\zabbix_agent2.log
echo LogFileSize=10
echo.
echo # Timeout
echo Timeout=30
echo.
echo # EnableRemoteCommands (necessario para IP adaptativo via UserParameter)
echo EnableRemoteCommands=1
echo.
echo # UserParameter para IP adaptativo (HostMetadataItem)
echo UserParameter=inv.meta,powershell -NoProfile -ExecutionPolicy Bypass -Command "$ip=(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {$_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*'} | Select-Object -First 1).IPAddress; if(-not $ip){$ip='sem-ip'}; Write-Output ('inventario-ti ' + $ip)"
echo HostMetadataItem=inv.meta
) > "%ZBX_CONF%"

echo [OK] Configuracao gravada em %ZBX_CONF%

REM ---- 4) Cria script auxiliar de IP (backup da UserParameter) ----
set "SCRIPTS_DIR=%ZBX_CONF_DIR%\scripts"
if not exist "%SCRIPTS_DIR%" mkdir "%SCRIPTS_DIR%"
(
echo $ip = $null
echo try {
echo     $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop ^^^| Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } ^^^| Select-Object -First 1).IPAddress
echo } catch { $ip = $null }
echo if (-not $ip) { $ip = 'sem-ip' }
echo Write-Output ("inventario-ti " + $ip)
) > "%SCRIPTS_DIR%\inv-meta.ps1"

REM ---- 5) Tarefa agendada: reinicia o agente quando o IP muda ----
echo [INFO] Criando tarefa de reinicio automatico no evento de rede...
schtasks /create /tn "ZabbixAgent-RestartOnIPChange" /tr "cmd /c net stop \"Zabbix Agent 2\" && net start \"Zabbix Agent 2\"" /sc onevent /ec Microsoft-Windows-NetworkProfile/Operational /mo "*[System[EventID=10000]]" /ru SYSTEM /f >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Tarefa de reinicio automatico criada.
) else (
    echo [AVISO] Nao foi possivel criar a tarefa agendada. O agente ainda funciona.
)

REM ---- 6) Inicia/reinicia o servico ----
echo [INFO] Iniciando servico Zabbix Agent 2...
net stop "Zabbix Agent 2" >nul 2>&1
timeout /t 2 /nobreak >nul
net start "Zabbix Agent 2" >nul 2>&1
if %errorlevel% neq 0 (
    echo [AVISO] Servico nao iniciou automaticamente. Tentando iniciar...
    sc start "Zabbix Agent 2" >nul 2>&1
    timeout /t 3 /nobreak >nul
)

sc query "Zabbix Agent 2" | findstr /i "RUNNING" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Servico Zabbix Agent 2 rodando.
) else (
    echo [AVISO] Servico pode nao estar rodando. Verifique manualmente.
)

REM ---- 7) Testa a conexao ----
echo.
echo [INFO] Testando conexao com o servidor Zabbix...
timeout /t 5 /nobreak >nul
"%ZBX_EXE%" -c "%ZBX_CONF%" -t "agent.ping" 2>&1 | findstr /i "1" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Agente respondendo! Host: %ZBX_HOSTNAME%
) else (
    echo [AVISO] Agente pode estar iniciando. Aguarde 30s e verifique no painel.
)

REM ---- 8) Testa metadata (IP adaptativo) ----
echo [INFO] Testando metadata (IP adaptativo)...
"%ZBX_EXE%" -c "%ZBX_CONF%" -t "inv.meta" 2>&1

echo.
echo  ============================================================
echo   INSTALACAO CONCLUIDA!
echo.
echo   Servidor Zabbix: %ZBX_SERVER%:%ZBX_PORT%
echo   Host registrado: %ZBX_HOSTNAME%
echo   Metadata:        %ZBX_METADATA% (IP adaptativo ativo)
echo.
echo   Painel Zabbix:   http://%ZBX_SERVER%:8081
echo   Painel Inv. TI:  http://%ZBX_SERVER%:5903
echo.
echo   Login Zabbix:    Admin / Monitor2026!
echo   Login Inv. TI:   admin / admin123
echo.
echo   O agente reinicia automaticamente ao mudar de rede/IP.
echo   O servidor detecta o novo IP em ate 2 minutos.
echo  ============================================================
echo.
echo [INFO] Abrindo painel do Inventário TI no navegador...
start "" "http://%ZBX_SERVER%:5903"
echo.
pause
exit /b 0
