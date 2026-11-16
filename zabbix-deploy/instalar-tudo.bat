@echo off
REM ============================================================================
REM  INSTALADOR UNICO - Zabbix Agent 2 + IP Adaptativo
REM  Inventário TI - Monitoramento de TI
REM
REM  O que faz:
REM    1) Verifica privilegios de Administrador
REM    2) Instala o Zabbix Agent 2 (MSI silencioso) se necessario
REM    3) Configura o agente para conectar ao servidor Zabbix
REM    4) Habilita IP adaptativo (auto-registro)
REM    5) Cria tarefa de reinicio automatico ao mudar de rede/IP
REM    6) Inicia/reinicia o servico
REM    7) Testa a conexao e abre o painel
REM
REM  USO: clique com botao direito -> "Executar como administrador"
REM  IMPORTANTE: coloque o arquivo .msi na MESMA pasta deste .bat
REM ============================================================================

setlocal enabledelayedexpansion
title Instalador Zabbix Agent 2 - Inventário TI
color 0A

REM ---- Configuracoes ----
set "ZBX_SERVER=192.168.0.102"
set "ZBX_HOSTNAME=%COMPUTERNAME%"
set "ZBX_CONF_DIR=C:\Program Files\Zabbix Agent 2"
set "ZBX_CONF=%ZBX_CONF_DIR%\zabbix_agent2.conf"
set "ZBX_EXE=%ZBX_CONF_DIR%\zabbix_agent2.exe"
set "MSI_NAME=zabbix_agent2-7.0-latest-windows-amd64-openssl.msi"
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

REM ---- 2) Verifica MSI ----
if not exist "%MSI_PATH%" (
    echo [ERRO] MSI nao encontrado!
    echo        Esperado em: %MSI_PATH%
    echo.
    echo        Coloque o arquivo %MSI_NAME% na mesma pasta deste .bat
    echo.
    pause
    exit /b 1
)
echo [OK] MSI encontrado: %MSI_NAME%

REM ---- 3) Instala (se necessario) ----
sc query "Zabbix Agent 2" >nul 2>&1
if %errorlevel% equ 0 (
    echo [INFO] Agente ja instalado. Atualizando configuracao...
) else (
    echo [INFO] Instalando Zabbix Agent 2...
    msiexec /i "%MSI_PATH%" /qn /norestart SERVER=%ZBX_SERVER% SERVERACTIVE=%ZBX_SERVER% HOSTNAME=%ZBX_HOSTNAME% HOSTMETADATA=inventario-ti
    if %errorlevel% neq 0 (
        echo [ERRO] Falha na instalacao. Codigo: %errorlevel%
        pause
        exit /b 1
    )
    echo [OK] Instalacao concluida.
    timeout /t 3 /nobreak >nul
)

REM ---- 4) Configura o agente (via PowerShell para evitar problemas de escape) ----
echo [INFO] Configurando agente...
if not exist "%ZBX_CONF_DIR%" mkdir "%ZBX_CONF_DIR%"

REM Backup
if exist "%ZBX_CONF%" copy /y "%ZBX_CONF%" "%ZBX_CONF%.bak" >nul 2>&1

REM Escreve o conf via PowerShell (evita problemas com caracteres especiais)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$conf = '%ZBX_CONF%';" ^
    "$hostname = '%ZBX_HOSTNAME%';" ^
    "$server = '%ZBX_SERVER%';" ^
    "$lines = @();" ^
    "$lines += '# Zabbix Agent 2 - Configuracao automatica (Inventario TI)';" ^
    "$lines += '# Gerado por instalar-tudo.bat';" ^
    "$lines += '';" ^
    "$lines += \"Server=$server\";" ^
    "$lines += \"ServerActive=$server\";" ^
    "$lines += \"Hostname=$hostname\";" ^
    "$lines += 'HostMetadata=inventario-ti';" ^
    "$lines += '';" ^
    "$lines += '# IP Adaptativo: reinicio automatico ao mudar de rede/IP';" ^
    "$lines += '';" ^
    "$lines += 'LogFile=C:\Program Files\Zabbix Agent 2\zabbix_agent2.log';" ^
    "$lines += 'LogFileSize=10';" ^
    "$lines += 'Timeout=30';" ^
    "$lines += '';" ^
    "$lines += '# UserParameter para IP adaptativo (HostMetadataItem)';" ^
    "$lines += 'UserParameter=inv.meta,powershell -NoProfile -ExecutionPolicy Bypass -Command \"' + chr(36) + 'ip=(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue ^^^| Where-Object {' + chr(36) + '_.IPAddress -notlike ''127.*'' -and ' + chr(36) + '_.IPAddress -notlike ''169.254.*''} ^^^| Select-Object -First 1).IPAddress; if(-not ' + chr(36) + 'ip){' + chr(36) + 'ip=''sem-ip''}; Write-Output (''inventario-ti '' + ' + chr(36) + 'ip)\"';" ^
    "$lines += 'HostMetadataItem=inv.meta';" ^
    "$lines += '';" ^
    "[System.IO.File]::WriteAllLines($conf, $lines, [System.Text.Encoding]::ASCII);" ^
    "Write-Host '[OK] Configuracao gravada.'"

if %errorlevel% neq 0 (
    echo [ERRO] Falha ao escrever configuracao.
    pause
    exit /b 1
)

REM ---- 5) Cria script auxiliar de IP ----
set "SCRIPTS_DIR=%ZBX_CONF_DIR%\scripts"
if not exist "%SCRIPTS_DIR%" mkdir "%SCRIPTS_DIR%"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$p = 'C:\Program Files\Zabbix Agent 2\scripts\inv-meta.ps1';" ^
    "$c = @();" ^
    "$c += '$ip = $null';" ^
    "$c += 'try { $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.IPAddress -notlike ''127.*'' -and $_.IPAddress -notlike ''169.254.*'' } | Select-Object -First 1).IPAddress } catch { $ip = $null }';" ^
    "$c += 'if (-not $ip) { $ip = ''sem-ip'' }';" ^
    "$c += 'Write-Output (\"inventario-ti \" + $ip)';" ^
    "[System.IO.File]::WriteAllLines($p, $c, [System.Text.Encoding]::UTF8);" ^
    "Write-Host '[OK] Script auxiliar criado.'"

REM ---- 6) Tarefa agendada: reinicia o agente quando o IP muda ----
echo [INFO] Criando tarefa de reinicio automatico no evento de rede...
schtasks /create /tn "ZabbixAgent-RestartOnIPChange" /tr "cmd /c net stop \"Zabbix Agent 2\" && net start \"Zabbix Agent 2\"" /sc onevent /ec "Microsoft-Windows-NetworkProfile/Operational" /mo "*[System[EventID=10000]]" /ru SYSTEM /f >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Tarefa de reinicio automatico criada.
) else (
    echo [AVISO] Tarefa agendada nao criada. O agente ainda funciona.
)

REM ---- 7) Inicia/reinicia o servico ----
echo [INFO] Iniciando servico Zabbix Agent 2...
net stop "Zabbix Agent 2" >nul 2>&1
timeout /t 2 /nobreak >nul
net start "Zabbix Agent 2" >nul 2>&1
timeout /t 3 /nobreak >nul

sc query "Zabbix Agent 2" | findstr /i "RUNNING" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Servico Zabbix Agent 2 rodando.
) else (
    echo [AVISO] Servico pode nao estar rodando. Verifique manualmente.
)

REM ---- 8) Testa a conexao ----
echo.
echo [INFO] Testando conexao (aguarde 5s)...
timeout /t 5 /nobreak >nul
"%ZBX_EXE%" -c "%ZBX_CONF%" -t "agent.ping" 2>&1

echo.
echo [INFO] Testando metadata (IP adaptativo)...
"%ZBX_EXE%" -c "%ZBX_CONF%" -t "inv.meta" 2>&1

REM ---- 9) Abre o painel ----
echo.
echo  ============================================================
echo   INSTALACAO CONCLUIDA!
echo.
echo   Servidor Zabbix: %ZBX_SERVER%
echo   Host registrado: %ZBX_HOSTNAME%
echo   Metadata:        inventario-ti (IP adaptativo ativo)
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