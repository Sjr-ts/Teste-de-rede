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

function Get-ServerIp {
    $ipFile = Join-Path (Get-BaseDir) 'server-ip.txt'
    if (Test-Path $ipFile) {
        $s = (Get-Content $ipFile -Raw).Trim()
        if ($s) { return $s }
    }
    $ip = Get-IpReal
    if ($ip) { return $ip }
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
$serverIp = Get-ServerIp
$ipReal = Get-IpReal
$mudou = $false

if ($txt -notmatch '(?m)^HostMetadataItem=inv\.meta') {
    $txt = $txt -replace '(?m)^HostMetadata=.*\r?\n?', ''
    $txt = $txt.TrimEnd() + "`r`nHostMetadataItem=inv.meta`r`nUnsafeUserParameters=1`r`n"
    $mudou = $true; Log 'Corrigido: HostMetadataItem restaurado.'
}
if ($txt -match '(?m)^HostMetadata=') {
    $txt = $txt -replace '(?m)^HostMetadata=.*\r?\n?', ''
    $mudou = $true; Log 'Corrigido: HostMetadata estatico removido.'
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

$metaScript = Join-Path $confDir 'scripts\inv-meta.ps1'
if (Test-Path $metaScript) {
    $valor = & powershell -NoProfile -ExecutionPolicy Bypass -File $metaScript 2>$null | Select-Object -First 1
    Log "Metadata: $valor (IP real: $ipReal, servidor: $serverIp)"
} else { Log 'AVISO: inv-meta.ps1 ausente — IP adaptativo inativo.' }

Log '=== Self-heal concluido ==='
