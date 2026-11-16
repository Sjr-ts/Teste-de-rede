@echo off
REM ============================================================================
REM  INSTALADOR UNICO - Zabbix Agent 2 + IP Adaptativo (Silencioso)
REM  Inventário TI - Monitoramento de TI
REM
REM  Modos:
REM    Normal:   duplo-clique -> mostra progresso, abre painel ao final
REM    Silencioso: instalar-silencioso.vbs ou "instalar-tudo.bat /silent"
REM               -> sem janela, sem interacao, log em C:\zabbix-install.log
REM
REM  USO MANUAL: clique com botao direito -> "Executar como administrador"
REM  USO AUTOMATICO: a Tarefa Agendada roda silenciosamente no boot
REM
REM  IMPORTANTE: coloque o .msi na MESMA pasta deste .bat
REM ============================================================================

setlocal enabledelayedexpansion

REM ---- Detecta modo silencioso ----
set "SILENT=0"
if /i "%~1"=="/silent" set "SILENT=1"
if /i "%~1"=="/s" set "SILENT=1"

if "%SILENT%"=="1" (
    set "LOGFILE=C:\zabbix-install.log"
) else (
    set "LOGFILE="
    title Instalador Zabbix Agent 2 - Inventário TI
    color 0A
)

REM ---- Configuracoes ----
set "ZBX_SERVER=192.168.0.102"
set "ZBX_HOSTNAME=%COMPUTERNAME%"
set "ZBX_CONF_DIR=C:\Program Files\Zabbix Agent 2"
set "ZBX_CONF=%ZBX_CONF_DIR%\zabbix_agent2.conf"
set "ZBX_EXE=%ZBX_CONF_DIR%\zabbix_agent2.exe"
set "MSI_NAME=zabbix_agent2-7.0-latest-windows-amd64-openssl.msi"
set "SCRIPT_DIR=%~dp0"
set "MSI_PATH=%SCRIPT_DIR%%MSI_NAME%"
set "VBS_PATH=%SCRIPT_DIR%instalar-silencioso.vbs"

REM ---- Funcao de log ----
goto :main

:log
if "%SILENT%"=="1" (
    echo [%date% %time%] %~1 >> "%LOGFILE%"
) else (
    echo %~1
)
goto :eof

:main

if "%SILENT%"=="0" (
    echo.
    echo  ============================================================
    echo   INSTALADOR UNICO - Zabbix Agent 2 + IP Adaptativo
    echo   Servidor: %ZBX_SERVER%  ^|  Host: %ZBX_HOSTNAME%
    echo  ============================================================
    echo.
)

REM ---- 1) Verifica Administrador ----
net session >nul 2>&1
if %errorlevel% neq 0 (
    call :log "[ERRO] Execute como Administrador!"
    if "%SILENT%"=="0" pause
    exit /b 1
)
call :log "[OK] Privilegios de Administrador confirmados."

REM ---- 2) Verifica MSI ----
if not exist "%MSI_PATH%" (
    call :log "[ERRO] MSI nao encontrado: %MSI_PATH%"
    if "%SILENT%"=="0" pause
    exit /b 1
)
call :log "[OK] MSI encontrado: %MSI_NAME%"

REM ---- 3) Instala (se necessario) ----
sc query "Zabbix Agent 2" >nul 2>&1
if %errorlevel% equ 0 (
    call :log "[INFO] Agente ja instalado. Atualizando configuracao..."
) else (
    call :log "[INFO] Instalando Zabbix Agent 2..."
    msiexec /i "%MSI_PATH%" /qn /norestart SERVER=%ZBX_SERVER% SERVERACTIVE=%ZBX_SERVER% HOSTNAME=%ZBX_HOSTNAME% HOSTMETADATA=inventario-ti
    if %errorlevel% neq 0 (
        call :log "[ERRO] Falha na instalacao. Codigo: %errorlevel%"
        if "%SILENT%"=="0" pause
        exit /b 1
    )
    call :log "[OK] Instalacao concluida."
    timeout /t 3 /nobreak >nul
)

REM ---- 4) Configura o agente ----
call :log "[INFO] Configurando agente..."
if not exist "%ZBX_CONF_DIR%" mkdir "%ZBX_CONF_DIR%"

if exist "%ZBX_CONF%" copy /y "%ZBX_CONF%" "%ZBX_CONF%.bak" >nul 2>&1

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
    "$lines += '# IP Adaptativo';" ^
    "$lines += '';" ^
    "$lines += 'LogFile=C:\Program Files\Zabbix Agent 2\zabbix_agent2.log';" ^
    "$lines += 'LogFileSize=10';" ^
    "$lines += 'Timeout=30';" ^
    "$lines += '';" ^
    "$lines += '# UserParameter para IP adaptativo';" ^
    "$d = [char]36;" ^
    "$up = 'UserParameter=inv.meta,powershell -NoProfile -ExecutionPolicy Bypass -Command \"' + $d + 'ip=(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {' + $d + '_.IPAddress -notlike ''127.*'' -and ' + $d + '_.IPAddress -notlike ''169.254.*''} | Select-Object -First 1).IPAddress; if(-not ' + $d + 'ip){' + $d + 'ip=''sem-ip''}; Write-Output (''inventario-ti '' + ' + $d + 'ip)\"';" ^
    "$lines += $up;" ^
    "$lines += 'HostMetadataItem=inv.meta';" ^
    "$lines += '';" ^
    "[System.IO.File]::WriteAllLines($conf, $lines, [System.Text.Encoding]::ASCII);" | Out-Null

if %errorlevel% neq 0 (
    call :log "[ERRO] Falha ao escrever configuracao."
    if "%SILENT%"=="0" pause
    exit /b 1
)
call :log "[OK] Configuracao gravada."

REM ---- 5) Script auxiliar de IP ----
set "SCRIPTS_DIR=%ZBX_CONF_DIR%\scripts"
if not exist "%SCRIPTS_DIR%" mkdir "%SCRIPTS_DIR%"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$p = 'C:\Program Files\Zabbix Agent 2\scripts\inv-meta.ps1';" ^
    "$c = @();" ^
    "$c += '$ip = $null';" ^
    "$c += 'try { $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.IPAddress -notlike ''127.*'' -and $_.IPAddress -notlike ''169.254.*'' } | Select-Object -First 1).IPAddress } catch { $ip = $null }';" ^
    "$c += 'if (-not $ip) { $ip = ''sem-ip'' }';" ^
    "$c += 'Write-Output (\"inventario-ti \" + $ip)';" ^
    "[System.IO.File]::WriteAllLines($p, $c, [System.Text.Encoding]::UTF8);" | Out-Null

REM ---- 6) Tarefa: reinicio automatico ao mudar de rede ----
schtasks /create /tn "ZabbixAgent-RestartOnIPChange" /tr "cmd /c net stop \"Zabbix Agent 2\" && net start \"Zabbix Agent 2\"" /sc onevent /ec "Microsoft-Windows-NetworkProfile/Operational" /mo "*[System[EventID=10000]]" /ru SYSTEM /f >nul 2>&1
if %errorlevel% equ 0 (
    call :log "[OK] Tarefa de reinicio automatico criada."
) else (
    call :log "[AVISO] Tarefa agendada nao criada."
)

REM ---- 7) Tarefa: execucao silenciosa no boot ----
if exist "%VBS_PATH%" (
    schtasks /create /tn "ZabbixAgent-SilentInstall" /tr "wscript.exe \"%VBS_PATH%\"" /sc onlogon /ru SYSTEM /rl HIGHEST /f >nul 2>&1
    if %errorlevel% equ 0 (
        call :log "[OK] Tarefa de execucao silenciosa no boot criada."
    )
)

REM ---- 8) Inicia/reinicia o servico ----
call :log "[INFO] Iniciando servico Zabbix Agent 2..."
net stop "Zabbix Agent 2" >nul 2>&1
timeout /t 2 /nobreak >nul
net start "Zabbix Agent 2" >nul 2>&1
timeout /t 3 /nobreak >nul

sc query "Zabbix Agent 2" | findstr /i "RUNNING" >nul 2>&1
if %errorlevel% equ 0 (
    call :log "[OK] Servico Zabbix Agent 2 rodando."
) else (
    call :log "[AVISO] Servico pode nao estar rodando."
)

REM ---- 9) Testa (apenas modo normal) ----
if "%SILENT%"=="0" (
    echo.
    echo [INFO] Testando conexao (aguarde 5s)...
    timeout /t 5 /nobreak >nul
    "%ZBX_EXE%" -c "%ZBX_CONF%" -t "agent.ping" 2>&1
    echo.
    echo [INFO] Testando metadata (IP adaptativo)...
    "%ZBX_EXE%" -c "%ZBX_CONF%" -t "inv.meta" 2>&1
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
    echo   Execucao silenciosa ativa no boot.
    echo  ============================================================
    echo.
    echo [INFO] Abrindo painel do Inventário TI no navegador...
    start "" "http://%ZBX_SERVER%:5903"
    echo.
    pause
)

exit /b 0