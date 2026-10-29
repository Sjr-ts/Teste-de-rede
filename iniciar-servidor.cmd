@echo off
title Servidor Inventario TI - Porta 5903
cd /d "%~dp0"
echo ============================================
echo  Servidor Inventario TI (clone local)
echo  Porta: 5903 | Zabbix: 192.168.0.186:8081
echo ============================================
echo.
echo Matando servidor antigo se existir...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :5903 ^| findstr LISTENING') do taskkill /F /PID %%p >nul 2>&1
timeout /t 1 /nobreak >nul
echo Iniciando servidor...
node server.cjs
