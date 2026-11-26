# =============================================================================
#  AGENTE AUTOCURATIVO - Zabbix Agent 2 (Windows)
#  Roda via tarefa agendada (boot + a cada 5 min) e garante que o agente:
#    1) Esta RODANDO (reinicia se parou)
#    2) Tem HostMetadataItem dinamico com o IP ATUAL (sobrevive a DHCP)
#    3) Aponta para o servidor certo (sobrevive a mudanca de IP do servidor)
#    4) Nao tem HostMetadata estatico nem PidFile (quebram o Agent2 Windows)
#  Log: %TEMP%\zabbix-selfheal.log
# =============================================================================
$ErrorActionPreference = 'Stop'
$log = Join-Path $env:TEMP 'zabbix-selfheal.log'
$confDir = 'C:\Program Files\Zabbix Agent 2'
$conf = Join-Path $confDir 'zabbix_agent2.conf'
$serviceName = 'Zabbix Agent 2'

function Log($msg) {
    $linha = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    try { Add-Content -Path $log -Value $linha -ErrorAction SilentlyContinue } catch {}
    Write-Host $linha
}

function Get-BaseDir {
    if ($PSScriptRoot) { return $PSScriptRoot }
    if ($MyInvocation -and $MyInvocation.ScriptName) { return (Split-Path $MyInvocation.ScriptName -Parent) }
    return (Get-Location).Path
}

function Get-IpReal {
    $filtro = 'vEthernet|Hyper-V|VMware|VirtualBox|Loopback|WSL'
    try {
        $rotas = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric,InterfaceMetric
        foreach ($r in $rotas) {
            $if = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $r.ifIndex -ErrorAction SilentlyContinue |
                  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and
                                 $_.PrefixOrigin -ne 'WellKnown' -and $_.InterfaceAlias -notmatch $filtro } |
                  Select-Object -First 1
            if ($if) { return $if.IPAddress }
        }
    } catch {}
    return $null
}

function Test-ZbxServer([string]$ip) {
    # true se $ip:10051 aceita conexao (o Zabbix server esta vivo la)
    if (-not $ip -or $ip -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { return $false }
    try {
        $c = New-Object Net.Sockets.TcpClient
        $iar = $c.BeginConnect($ip, 10051, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(1500)
        try { $c.Close() } catch { }
        return [bool]$ok
    } catch { return $false }
}

function Get-ServerIp([string]$atual) {
    # 1) arquivo fixo
    $ipFile = Join-Path (Get-BaseDir) 'server-ip.txt'
    if (Test-Path $ipFile) {
        $s = (Get-Content $ipFile -Raw).Trim()
        if ($s) { return $s }
    }
    # 2) Se o Server= que JA esta no conf ainda responde em 10051, MANTÉM.
    #    (nao ha razao para trocar o que esta funcionando)
    if ($atual -and (Test-ZbxServer $atual)) { return $atual }
    # 3) detecta o servidor de verdade (quem responde /actuator/health:5903)
    #    NUNCA o IP local desta maquina: em clientes isso apontava o agente
    #    para SI MESMO e o Zabbix nunca recebia os dados.
    $scan = Join-Path (Get-BaseDir) 'detect-server.ps1'
    if (Test-Path $scan) {
        $ip = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scan 2>$null |
              Where-Object { $_ -match '^\d{1,3}(\.\d{1,3}){3}$' } | Select-Object -First 1
        if ($ip -and (Test-ZbxServer "$ip".Trim())) { return "$ip".Trim() }
        if ($ip -and -not (Test-ZbxServer "$ip".Trim())) {
            # achou o painel mas nao o Zabbix: melhor 127.0.0.1 que o IP local
            return '127.0.0.1'
        }
    }
    # 4) fallback: o servidor Zabbix costuma estar nesta mesma maquina
    return '127.0.0.1'
}

Log '=== Self-heal iniciado ==='

# 1) servico rodando?
try { $svc = Get-Service -Name $serviceName -ErrorAction Stop }
catch { Log 'ERRO: servico Zabbix Agent 2 nao existe. Execute instalar-tudo.bat.'; exit 1 }
if ($svc.Status -ne 'Running') {
    Log "Servico parado ($($svc.Status)). Reiniciando..."
    try { Restart-Service -Name $serviceName -Force -ErrorAction Stop; Log 'OK: servico reiniciado.' }
    catch { Log "ERRO ao reiniciar: $($_.Exception.Message)"; exit 1 }
} else { Log 'OK: servico ja esta rodando.' }

# 2) conf existe?
if (-not (Test-Path $conf)) { Log 'ERRO: zabbix_agent2.conf ausente. Execute instalar-tudo.bat.'; exit 1 }
$txt = Get-Content $conf -Raw
if (-not $txt) { $txt = '' }
# Passa o Server= ATUAL: se ele ainda responde em 10051, Get-ServerIp MANTEM.
# (antes chamava sem argumento, entao a protecao "manter o que funciona" nunca rodava)
$serverAtual = ''
$mAtual = [regex]::Match($txt, '(?m)^Server=(\S+)')
if ($mAtual.Success) { $serverAtual = $mAtual.Groups[1].Value.Trim() }
$serverIp = Get-ServerIp $serverAtual
$ipReal = Get-IpReal
$mudou = $false

# IP adaptativo SEM UserParameter: o Agent 2 nao consegue executar cmd.exe
# neste Windows ("Acesso negado" ate para "echo OK"). O metadata e gravado
# como HostMetadata estatico e REESCRITO aqui quando o IP da maquina muda.
$metaEsperado = 'inventario-ti ' + $ipReal
if ($txt -match '(?m)^HostMetadataItem=') {
    $txt = $txt -replace '(?m)^HostMetadataItem=.*\r?\n?', ''
    $mudou = $true; Log 'Corrigido: HostMetadataItem removido.'
}
if ($txt -match '(?m)^UserParameter=inv\.meta') {
    $txt = $txt -replace '(?m)^UserParameter=inv\.meta.*\r?\n?', ''
    $mudou = $true; Log 'Corrigido: UserParameter inv.meta removido.'
}
$mMeta = [regex]::Match($txt, '(?m)^HostMetadata=(.*)$')
if (-not $mMeta.Success) {
    $txt = $txt.TrimEnd() + "`r`nHostMetadata=$metaEsperado`r`n"
    $mudou = $true; Log "Corrigido: HostMetadata gravado ($metaEsperado)."
} elseif ($mMeta.Groups[1].Value.Trim() -ne $metaEsperado) {
    $txt = $txt -replace '(?m)^HostMetadata=.*$', "HostMetadata=$metaEsperado"
    $mudou = $true; Log "Corrigido: IP mudou -> HostMetadata=$metaEsperado."
}
if ($txt -match '(?m)^PidFile=') {
    $txt = $txt -replace '(?m)^PidFile=.*\r?\n?', ''
    $mudou = $true; Log 'Corrigido: PidFile removido (invalido no Agent2).'
}
$serverMatch = [regex]::Match($txt, '(?m)^Server=(\S+)')
if ($serverMatch.Success -and $serverIp -and $serverMatch.Groups[1].Value -ne $serverIp) {
    $atual = $serverMatch.Groups[1].Value
    $txt = $txt -replace '(?m)^Server=.*$', "Server=$serverIp"
    $txt = $txt -replace '(?m)^ServerActive=.*$', "ServerActive=$serverIp"
    $mudou = $true; Log "Corrigido: servidor $atual -> $serverIp."
}

if ($mudou) {
    try { Copy-Item $conf "$conf.bak-selfheal" -Force -ErrorAction SilentlyContinue } catch {}
    [System.IO.File]::WriteAllText($conf, $txt, (New-Object System.Text.UTF8Encoding($false)))
    Log 'Config gravada. Reiniciando servico...'
    try { Restart-Service -Name $serviceName -Force -ErrorAction SilentlyContinue } catch {}
    Start-Sleep -Seconds 3
}

$metaFinal = [regex]::Match((Get-Content $conf -Raw), '(?m)^HostMetadata=(.*)$')
if ($metaFinal.Success) { Log ('Metadata efetivo: ' + $metaFinal.Groups[1].Value.Trim() + ' (servidor: ' + $serverIp + ')') }
else { Log 'AVISO: HostMetadata ausente — IP adaptativo inativo.' }

Log '=== Self-heal concluido ==='
