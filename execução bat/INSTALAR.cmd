@echo off
REM ============================================================================
REM  INSTALAR TUDO - 1 CLIQUE, SEM DIGITAR NADA  (lancador fino)
REM
REM  So chama o orquestrador PowerShell (INSTALAR.ps1), que faz TUDO:
REM   - detecta admin de forma confiavel e eleva (UAC) se preciso
REM   - instala o agente Zabbix + auto-heal
REM   - descobre o servidor e abre os paineis ja logados
REM
REM  Motivo de existir so para chamar o .ps1: duplo-clique em .ps1 nao roda
REM  por padrao no Windows; o .cmd roda e passa a execucao para o PowerShell.
REM ============================================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALAR.ps1"
