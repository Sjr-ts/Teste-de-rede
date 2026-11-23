# =============================================================================
# Iniciar/Reiniciar o servidor do Inventario TI (porta 5903)
# Uso:  powershell -ExecutionPolicy Bypass -File iniciar-servidor.ps1
# =============================================================================
$dir = $PSScriptRoot
$log = Join-Path $dir "server.log"
$err = Join-Path $dir "server.err.log"

# 1) Para qualquer node antigo escutando a 5903
$antigos = Get-NetTCPConnection -LocalPort 5903 -State Listen -ErrorAction SilentlyContinue |
           Select-Object -ExpandProperty OwningProcess -Unique
foreach ($p in $antigos) {
    Write-Host "Encerrando processo antigo PID $p na porta 5903..."
    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 1

# 2) Sobe o servidor de forma desanexada (sobrevive ao terminal)
Start-Process -FilePath "node" `
    -ArgumentList "server.cjs" `
    -WorkingDirectory $dir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $log `
    -RedirectStandardError $err

Start-Sleep -Seconds 3

# 3) Confere se responde (sempre por loopback: IP fixo da LAN muda com DHCP e
#    gerava falso negativo mesmo com o servidor no ar)
try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:5903/actuator/health" -TimeoutSec 5
    Write-Host "SERVIDOR OK -> http://127.0.0.1:5903  (status: $($h.status))"
    $e = Invoke-RestMethod -Uri "http://127.0.0.1:5903/api/computadores/estatisticas" -TimeoutSec 5
    Write-Host "Computadores: $($e.total) | Zabbix: $((Invoke-RestMethod -Uri 'http://127.0.0.1:5903/api/zabbix/resumo' -TimeoutSec 15).conectado)"
} catch {
    Write-Host "Falha ao responder. Veja $err"
    Get-Content $err -Tail 20
}
