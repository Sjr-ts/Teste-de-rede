# Detecta o IP do servidor Inventario TI / Zabbix.
# Saida: um IP (ex.: 192.168.0.167 ou 127.0.0.1) - usado pelo instalador
#        para passar SERVER= ao msiexec (exigido pelo LaunchCondition do MSI).
#
# Ordem: 1) server-ip.txt (fixo, se existir)  2) scan da rede  3) 127.0.0.1
$ErrorActionPreference = 'SilentlyContinue'
$dir = Split-Path -Parent $PSCommandPath

# 1) arquivo fixo
$fixo = Join-Path $dir 'server-ip.txt'
if (Test-Path -LiteralPath $fixo) {
    $ip = Get-Content -LiteralPath $fixo -TotalCount 1
    if ($ip -and $ip.Trim()) { Write-Output $ip.Trim(); exit 0 }
}

# 2) scan: 127.0.0.1 + faixa 192.168.0.100-129 (porta 5903 = Inventario TI)
$ips = @('127.0.0.1', 'localhost') + (100..129 | ForEach-Object { "192.168.0.$_" })
foreach ($i in $ips) {
    try {
        $r = Invoke-WebRequest -Uri "http://${i}:5903/actuator/health" -TimeoutSec 1 -UseBasicParsing
        if ($r.StatusCode -eq 200) { Write-Output $i; exit 0 }
    } catch { }
}

# 3) fallback
Write-Output '127.0.0.1'
