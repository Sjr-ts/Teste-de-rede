# Detecta o IP do servidor Inventario TI / Zabbix.
# Saida: um IP (ex.: 192.168.0.238 ou 127.0.0.1) - usado pelo instalador
#        para passar SERVER= ao msiexec (exigido pelo LaunchCondition do MSI)
#        e pelo INSTALAR.ps1/atalhos para abrir o painel.
#
# Ordem:
#   1) server-ip.txt (fixo, se existir ao lado deste script)
#   2) servidor LOCAL (127.0.0.1:5903 responde = esta maquina E o servidor)
#   3) scan PARALELO de TODA a sub-rede (/24 da rota padrao) na porta 5903
#      - TCP connect assincrono em TODOS os IPs de uma vez + espera global
#        de 2s (antes: 254 IPs x timeout sequencial = minutos; e a faixa
#        antiga 192.168.0.100-129 NAO cobria o servidor em .238 - o cliente
#        acabava apontando para 127.0.0.1 e NUNCA enviava dados)
#      - so devolve IP cujo /actuator/health responder 200 (prova que e o
#        Inventario TI de verdade, nao qualquer dispositivo com a porta aberta)
#   4) fallback: 127.0.0.1
param(
    [switch]$SemLocal   # teste/fora-da-maquina: ignora o caminho local e forca o scan
)
$ErrorActionPreference = 'SilentlyContinue'
$dir = Split-Path -Parent $PSCommandPath

# 1) arquivo fixo
$fixo = Join-Path $dir 'server-ip.txt'
if (Test-Path -LiteralPath $fixo) {
    $ip = Get-Content -LiteralPath $fixo -TotalCount 1
    if ($ip -and $ip.Trim()) { Write-Output $ip.Trim(); exit 0 }
}

function Testar-Saude([string]$alvo) {
    try {
        $r = Invoke-WebRequest -Uri "http://${alvo}:5903/actuator/health" -TimeoutSec 1 -UseBasicParsing
        if ($r.StatusCode -eq 200 -and $r.Content -match 'UP') { return $true }
    } catch { }
    return $false
}

# 2) esta maquina e o servidor?
if (-not $SemLocal) {
    if (Testar-Saude '127.0.0.1') { Write-Output '127.0.0.1'; exit 0 }
}

# 3) sub-rede da rota padrao (interface real, ignora loopback/APIPA)
$ips = @()
$rotas = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric, InterfaceMetric
foreach ($r0 in $rotas) {
    $a = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $r0.ifIndex -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Select-Object -First 1
    if ($a) {
        $prefixo = ($a.IPAddress -split '\.')[0..2] -join '.'
        $ips = 1..254 | ForEach-Object { "$prefixo.$_" }
        break
    }
}
if (-not $ips) { $ips = 1..254 | ForEach-Object { "192.168.0.$_" } }

# connect ASSINCRONO em todos de uma vez (254 sockets simultaneos)
$clientes = @()
foreach ($ip in $ips) {
    try {
        $c = New-Object Net.Sockets.TcpClient
        $ar = $c.BeginConnect($ip, 5903, $null, $null)
        $clientes += [pscustomobject]@{ Ip = $ip; C = $c; Ar = $ar }
    } catch { }
}

# espera GLOBAL de 2s (quem respondeu, respondeu; sem resposta nao segura nada)
$limite = [DateTime]::UtcNow.AddMilliseconds(2000)
while ([DateTime]::UtcNow -lt $limite) {
    if (-not (@($clientes | Where-Object { -not $_.Ar.IsCompleted }).Count)) { break }
    Start-Sleep -Milliseconds 50
}

$abertos = @()
foreach ($x in $clientes) {
    try { if ($x.Ar.IsCompleted -and $x.C.Connected) { $abertos += $x.Ip } } catch { }
    try { $x.C.Close() } catch { }
}

# confirma com o health check (200 = Inventario TI de verdade)
foreach ($ip in ($abertos | Sort-Object)) {
    if (Testar-Saude $ip) { Write-Output $ip; exit 0 }
}

# 4) fallback
Write-Output '127.0.0.1'
