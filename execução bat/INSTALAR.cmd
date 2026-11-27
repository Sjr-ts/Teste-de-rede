@echo off
REM ============================================================================
REM  Wrapper de compatibilidade. O lancador REAL e INSTALAR-1-CLIQUE.vbs:
REM  duplo clique nele nao pisca nenhuma janela de PowerShell.
REM ============================================================================
start "" wscript.exe "%~dp0INSTALAR-1-CLIQUE.vbs"
exit /b 0
