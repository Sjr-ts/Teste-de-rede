@echo off
REM ============================================================================
REM  INSTALADOR UNICO - Zabbix Agent 2 + IP Adaptativo (SILENCIOSO)
REM  Inventario TI - Monitoramento de TI
REM
REM  Uso: clique com botao direito -> Executar como administrador
REM  Tambem roda sozinho no boot via tarefa agendada (sem janela).
REM
REM  Arquivo UNICO e autocontido: o MSI oficial e baixado da CDN do Zabbix.
REM  A configuracao e gravada pelo gravar-config.ps1 (PowerShell normal,
REM  legivel e validavel - nada de base64 embutido no cmd).
REM
REM  ---------------------------------------------------------------------------
REM  REGRA DE OURO DESTE ARQUIVO: NAO USAR BLOCOS "if ... ( ... )".
REM
REM  O cmd casa os parenteses de forma textual. Uma linha comum como
REM      echo   Host: X  ^|  Servidor: Y
REM      echo   Zabbix: http://x  (Admin / Monitor2026!)
REM  fecha o bloco ANTES do fim. Tudo que vem depois passa a rodar
REM  INCONDICIONALMENTE - inclusive "pause". Com /silent isso deixava o
REM  instalador TRAVADO para sempre esperando tecla (e o instalador elevado
REM  morria junto), e fazia "schtasks" serem pulados enquanto o :log ainda
REM  reportava sucesso. Diagnosticado e reproduzido em 25/11/2026.
REM  Por isso TODO o fluxo aqui usa GOTO no nivel de topo, onde parenteses
REM  e pipe sao texto puro.
REM  ---------------------------------------------------------------------------

setlocal
chcp 65001 >nul 2>&1

set "SILENT=0"
if /i "%~1"=="/silent" set "SILENT=1"

REM ---- Logfile/titulo (antes: bloco if/else) ----
if "%SILENT%"=="1" goto :cfg_silent
set "LOGFILE="
title Instalador Zabbix Agent 2 - Inventario TI
color 0A
goto :cfg_fim
:cfg_silent
set "LOGFILE=%TEMP%\zabbix-install.log"
:cfg_fim

REM IP do servidor e DETECTADO automaticamente pelo detect-server.ps1 (DHCP-safe).
REM Se o admin quiser fixar, crie server-ip.txt ao lado deste bat.
set "ZBX_CONF_DIR=C:\Program Files\Zabbix Agent 2"
set "ZBX_EXE=%ZBX_CONF_DIR%\zabbix_agent2.exe"
set "SCRIPT_DIR=%~dp0"
set "ZBX_SCRIPT_DIR=%SCRIPT_DIR%"
set "MSI_PATH=%SCRIPT_DIR%zabbix_agent2-7.0.31-windows-amd64-openssl.msi"
set "MSI_URL=https://cdn.zabbix.com/zabbix/binaries/stable/7.0/7.0.31/zabbix_agent2-7.0.31-windows-amd64-openssl.msi"
set "VBS_PATH=%SCRIPT_DIR%instalar-silencioso.vbs"

goto :main

:log
REM Fluxo com GOTO (sem bloco if/else): mensagens com PARENTESES, como
REM "(encoded)...", quebram o parse do cmd quando expandidas via %%~1 dentro
REM de um bloco "if ( ... )". No nivel de topo os parenteses sao texto puro.
if "%SILENT%"=="1" goto :log_silent
echo %~1
goto :eof
:log_silent
echo [%date% %time%] %~1 >> "%LOGFILE%"
goto :eof

:ehAdmin
REM Deteccao CONFIARVEL de admin (WindowsPrincipal). Sai com 0=admin, 1=nao-admin.
powershell -NoProfile -Command "if ((New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 0 } else { exit 1 }"
exit /b %errorlevel%

:main

REM ---- Banner (antes: bloco if com parenteses no texto) ----
if "%SILENT%"=="1" goto :banner_fim
echo.
echo  ============================================================
echo   INSTALADOR UNICO - Zabbix Agent 2 + IP Adaptativo
echo   Host: %COMPUTERNAME%  (IP do servidor detectado automaticamente)
echo  ============================================================
echo.
:banner_fim

REM Deteccao CONFIARVEL de admin: WindowsPrincipal via PowerShell.
REM (evitamos "net session", que e instavel e pode retornar 0 sem admin)
call :ehAdmin
if errorlevel 1 goto :nao_admin
call :log "[OK] Administrador confirmado."
goto :admin_ok

:nao_admin
call :log "[ERRO] Execute como Administrador (botao direito -> Executar como administrador)"
if "%SILENT%"=="0" pause
exit /b 1

:admin_ok

REM ---- Detecta o IP do servidor UMA vez (vale para MSI, conf e validacao) ----
REM Ordem: INV_SERVER_IP (fixo) -> server-ip.txt via detect-server.ps1 -> 127.0.0.1
set "ZBX_SERVER="
if defined INV_SERVER_IP set "ZBX_SERVER=%INV_SERVER_IP%"
if defined ZBX_SERVER goto :ip_srv_pronto
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%detect-server.ps1" 2^>nul ^| findstr /r "[0-9][0-9]*\.[0-9]"`) do if not defined ZBX_SERVER set "ZBX_SERVER=%%I"
:ip_srv_pronto
if not defined ZBX_SERVER set "ZBX_SERVER=127.0.0.1"
call :log "[INFO] Servidor detectado: %ZBX_SERVER%"

REM ---- Baixa o MSI oficial se faltar ----
REM (fluxo com goto: evita if/else aninhado que causa erro de parse no cmd)
if exist "%MSI_PATH%" goto :msi_presente
call :log "[INFO] Baixando MSI oficial do Zabbix (17.6 MB, aguarde)..."
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -Uri '%MSI_URL%' -OutFile '%MSI_PATH%' -TimeoutSec 300 -ErrorAction Stop; exit 0 } catch { exit 1 }"
if errorlevel 1 goto :msi_falhou
call :log "[OK] MSI baixado."
goto :msi_fim

:msi_falhou
call :log "[ERRO] Falha ao baixar o MSI. Verifique a internet."
if "%SILENT%"=="0" pause
exit /b 1

:msi_presente
call :log "[OK] MSI ja presente."

:msi_fim

REM ---- Instala / atualiza ----
REM (fluxo com goto: %errorlevel% avaliado em tempo de execucao, nao no parse)
sc query "Zabbix Agent 2" >nul 2>&1
if not errorlevel 1 goto :agente_ja_instalado
call :log "[INFO] Instalando Zabbix Agent 2..."
REM ZBX_SERVER ja foi detectado no inicio (antes do MSI) - o MSI exige SERVER=.
call :log "[INFO] Usando SERVER=%ZBX_SERVER% na instalacao do MSI."
msiexec /i "%MSI_PATH%" SERVER=%ZBX_SERVER% /qn /norestart /l*v "%TEMP%\zabbix_msi.log"
REM no nivel de topo %errorlevel% e avaliado em tempo de execucao ( correto )
if %errorlevel% equ 0 goto :inst_ok
if %errorlevel% equ 3010 goto :inst_ok
goto :msi_erro

:msi_erro
call :log "[ERRO] Falha no MSI. Codigo %errorlevel%. Log: %TEMP%\zabbix_msi.log"
if "%SILENT%"=="0" pause
exit /b 1

:agente_ja_instalado
call :log "[INFO] Agente ja instalado. Atualizando configuracao..."

:inst_ok
call :log "[OK] Instalacao concluida."
ping -n 4 127.0.0.1 >nul 2>&1

call :log "[INFO] Gravando configuracao do agente..."
REM ---- Grava conf + script PowerShell (gravar-config.ps1) ----
REM (antes usavamos -EncodedCommand com base64: excedia o limite de 8191 chars do cmd)
if not exist "%SCRIPT_DIR%gravar-config.ps1" goto :cfg_ausente
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%gravar-config.ps1" -Server %ZBX_SERVER%
if errorlevel 1 goto :cfg_falhou
goto :cfg_ok

:cfg_ausente
call :log "[ERRO] gravar-config.ps1 nao encontrado ao lado do instalador."
if "%SILENT%"=="0" pause
exit /b 1

:cfg_falhou
call :log "[ERRO] Falha ao gravar configuracao."
if "%SILENT%"=="0" pause
exit /b 1

:cfg_ok
call :log "[OK] Configuracao gravada (HostMetadataItem + UnsafeUserParameters + IP real)."
REM le o IP do servidor que foi detectado e gravado no conf (para exibicao)
for /f "usebackq tokens=1,2 delims==" %%A in ("%ZBX_CONF_DIR%\zabbix_agent2.conf") do (
    if "%%A"=="Server" set "ZBX_SERVER=%%B"
)
if not defined ZBX_SERVER set "ZBX_SERVER=(detectado)"

REM ---- Atalhos na Area de Trabalho (abram painel sem depender de IP) ----
if not exist "%SCRIPT_DIR%CRIAR-ATALHOS.ps1" goto :atalhos_fim
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%CRIAR-ATALHOS.ps1"
if errorlevel 1 goto :atalhos_erro
call :log "[OK] Atalhos 'INVENTARIO TI' e 'ZABBIX' criados na Area de Trabalho."
goto :atalhos_fim

:atalhos_erro
call :log "[AVISO] Falha ao criar atalhos (veja CRIAR-ATALHOS.ps1). O painel abre ao final da instalacao."

:atalhos_fim

REM ---- Tarefas agendadas: AUTO-HEAL (boot + a cada 5 min) ----
REM Erro do schtasks AGORA e reportado de verdade (antes o :log dizia "criadas"
REM mesmo quando o schtasks falhava, porque estava dentro de bloco if).
set "HEAL_PATH=%SCRIPT_DIR%auto-heal.ps1"
if not exist "%HEAL_PATH%" goto :heal_ausente
schtasks /create /tn "ZabbixAgent-AutoHeal-Boot" /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%HEAL_PATH%\"" /sc onstart /ru SYSTEM /rl HIGHEST /f > "%TEMP%\zbx-schtasks.log" 2>&1
if errorlevel 1 goto :heal_erro
schtasks /create /tn "ZabbixAgent-AutoHeal-5min" /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%HEAL_PATH%\"" /sc minute /mo 5 /ru SYSTEM /rl HIGHEST /f >> "%TEMP%\zbx-schtasks.log" 2>&1
if errorlevel 1 goto :heal_erro
call :log "[OK] Auto-heal ativo (boot + a cada 5 min): reinicia agente e corrige IP/config."
goto :heal_fim

:heal_erro
call :log "[ERRO] schtasks nao criou o auto-heal. Detalhe: %TEMP%\zbx-schtasks.log"
goto :heal_fim

:heal_ausente
call :log "[AVISO] auto-heal.ps1 ausente - autocorrecao desativada."

:heal_fim

REM ---- Tarefa agendada: VIGIA do servidor de painel (5903) ----
REM Se o servidor travar (event loop congelado), o vigia reinicia sozinho
REM em ate 1 minuto. Detectado e corrigido em 25/11/2026.
if not exist "%SCRIPT_DIR%..\vigia-servidor.ps1" goto :vigia_ausente
set "VIGIA_PATH=%SCRIPT_DIR%..\vigia-servidor.ps1"
schtasks /create /tn "InventarioTI-Vigia-Servidor" /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%VIGIA_PATH%\"" /sc minute /mo 1 /f >> "%TEMP%\zbx-schtasks.log" 2>&1
if errorlevel 1 goto :vigia_erro
call :log "[OK] Vigia do servidor ativo (a cada 1 min: reinicia o painel se travar)."
goto :vigia_fim

:vigia_erro
call :log "[AVISO] schtasks nao criou o vigia do servidor. Detalhe: %TEMP%\zbx-schtasks.log"
goto :vigia_fim

:vigia_ausente
call :log "[AVISO] vigia-servidor.ps1 ausente - reinicio automatico do painel desativado."

:vigia_fim

REM ---- Tarefas agendadas: instalador silencioso no boot/logon (VBS) ----
if not exist "%VBS_PATH%" goto :vbs_fim
schtasks /create /tn "ZabbixAgent-SilentInstall" /tr "wscript.exe \"%VBS_PATH%\"" /sc onstart /ru SYSTEM /rl HIGHEST /f >> "%TEMP%\zbx-schtasks.log" 2>&1
if errorlevel 1 goto :vbs_erro
schtasks /create /tn "ZabbixAgent-SilentLogon" /tr "wscript.exe \"%VBS_PATH%\"" /sc onlogon /ru SYSTEM /rl HIGHEST /f >> "%TEMP%\zbx-schtasks.log" 2>&1
if errorlevel 1 goto :vbs_erro
call :log "[OK] Tarefas agendadas (boot + logon) criadas."
goto :vbs_fim

:vbs_erro
call :log "[AVISO] schtasks nao criou as tarefas do instalador silencioso. Detalhe: %TEMP%\zbx-schtasks.log"

:vbs_fim

REM ---- Inicia o servico ----
call :log "[INFO] (Re)iniciando servico Zabbix Agent 2..."
net stop "Zabbix Agent 2" >nul 2>&1
ping -n 3 127.0.0.1 >nul 2>&1
net start "Zabbix Agent 2" >nul 2>&1
ping -n 4 127.0.0.1 >nul 2>&1

sc query "Zabbix Agent 2" | findstr /i "RUNNING" >nul 2>&1
if errorlevel 1 goto :svc_erro
call :log "[OK] Servico Zabbix Agent 2 rodando."
goto :svc_fim

:svc_erro
call :log "[ERRO] Servico NAO esta rodando - nao concluir como sucesso."
if "%SILENT%"=="0" pause
exit /b 1

:svc_fim

REM ---- Validacao REAL de comunicacao (evita falso "Concluido") ----
call :log "[INFO] Validando agente (agent.ping + inv.meta)..."
"%ZBX_EXE%" -c "%ZBX_CONF_DIR%\zabbix_agent2.conf" -t "agent.ping" 2>&1 | findstr /i "ZBX_NOTSUPPORTED" >nul
if errorlevel 1 goto :ping_ok
call :log "[ERRO] agent.ping NAO respondeu - agente nao funcional."
if "%SILENT%"=="0" pause
exit /b 1

:ping_ok
call :log "[OK] agent.ping responde."
"%ZBX_EXE%" -c "%ZBX_CONF_DIR%\zabbix_agent2.conf" -t "inv.meta" 2>&1 | findstr /i "ZBX_NOTSUPPORTED" >nul
if errorlevel 1 goto :meta_ok
call :log "[AVISO] inv.meta nao respondeu - metadata pode nao chegar ao Zabbix."
goto :meta_fim

:meta_ok
call :log "[OK] inv.meta responde."

:meta_fim

REM ---- Testa conectividade com o servidor Zabbix (porta 10051) ----
REM (fluxo com goto: %errorlevel% avaliado em tempo de execucao, nao no parse)
if not defined ZBX_SERVER goto :zbx_srv_indef
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $c = New-Object Net.Sockets.TcpClient; $iar = $c.BeginConnect('%ZBX_SERVER%',10051,$null,$null); $ok = $iar.AsyncWaitHandle.WaitOne(3000); if ($ok) { exit 0 } else { exit 1 } } catch { exit 1 }"
if %errorlevel% equ 0 goto :zbx_10051_ok
call :log "[AVISO] Nao foi possivel contatar %ZBX_SERVER%:10051 - verifique rede/firewall."
goto :zbx_10051_fim

:zbx_10051_ok
call :log "[OK] Servidor Zabbix %ZBX_SERVER%:10051 alcancavel."
goto :zbx_10051_fim

:zbx_srv_indef
call :log "[AVISO] Servidor Zabbix indefinido - pulando teste 10051."

:zbx_10051_fim

call :log "[FIM] Concluido. Host=%COMPUTERNAME% Server=%ZBX_SERVER%"

REM ---- Resumo / abertura do painel (antes: bloco if que quebrava e rodava
REM      "pause" mesmo em modo silencioso -> travava para sempre) ----
if "%SILENT%"=="1" goto :fim_silent
echo.
echo  ============================================================
echo   INSTALACAO CONCLUIDA!
echo   Host: %COMPUTERNAME%  ^|  Servidor detectado: %ZBX_SERVER%
echo   Zabbix:  http://%ZBX_SERVER%:8081  (Admin / Monitor2026!)
echo   Inventario: http://%ZBX_SERVER%:5903  (admin / admin123)
echo  ============================================================
echo.
start "" "http://%ZBX_SERVER%:5903"
pause
:fim_silent

exit /b 0
