# Grava a configuracao do Zabbix Agent 2 + script de IP adaptativo.
#
# Uso (pelo instalar-tudo.bat, que ja detectou o servidor):
#   powershell -File gravar-config.ps1 -Server 192.168.0.167
#
# Sem parametro, detecta sozinho na ordem:
#   1) server-ip.txt ao lado deste script   2) detect-server.ps1 (scan da rede)   3) 127.0.0.1
#
# Por que existe: a versao anterior era um EncodedCommand base64 embutido no .bat
# (11764 chars > limite de 8191 do cmd). Agora e um .ps1 normal, legivel e valido.
param(
    [string]$Server = ''
)

$ErrorActionPreference = 'Stop'
$confDir = 'C:\Program Files\Zabbix Agent 2'
$conf = Join-Path $confDir 'zabbix_agent2.conf'
$meta = Join-Path $confDir 'scripts\inv-meta.ps1'
$hostname = $env:COMPUTERNAME
$d = [char]36      # $
$q = [char]34      # "
$sq = [char]39     # '

if (-not (Test-Path (Split-Path $meta))) { New-Item -ItemType Directory -Path (Split-Path $meta) -Force | Out-Null }

# --- deteccao do IP do SERVIDOR Zabbix ---
# IMPORTANTE: o servidor fica noutra maquina. NAO usar o IP LOCAL desta maquina
# (num cliente isso apontaria o agente para ele mesmo e nunca ligaria ao Zabbix).
$thisDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Server) {
    # 1) server-ip.txt (fixo, se existir)
    $ipFile = Join-Path $thisDir 'server-ip.txt'
    if (Test-Path -LiteralPath $ipFile) {
        $Server = (Get-Content -LiteralPath $ipFile -TotalCount 1 -ErrorAction SilentlyContinue)
        if ($Server) { $Server = $Server.Trim() }
    }
}
if (-not $Server) {
    # 2) scan da rede (127.0.0.1 + 192.168.0.100-129 na porta 5903)
    $det = Join-Path $thisDir 'detect-server.ps1'
    if (Test-Path -LiteralPath $det) {
        $Server = (& powershell -NoProfile -ExecutionPolicy Bypass -File $det | Select-Object -First 1)
        if ($Server) { $Server = "$Server".Trim() }
    }
}
if (-not $Server) { $Server = '127.0.0.1' }

# --- inv-meta.ps1 (IP do PC client - deteccao da rota padrao, com filtros) ---
$metaLines = @()
$metaLines += '# IP adaptativo: retorna o IP da rota padrao (interface real, ignora virtual/APIPA)'
$metaLines += $d + 'ip = $null'
$metaLines += $d + 'filtro = ' + $sq + 'vEthernet|Hyper-V|VMware|VirtualBox|Loopback' + $sq
$metaLines += $d + 'rotas = Get-NetRoute -DestinationPrefix ' + $sq + '0.0.0.0/0' + $sq + ' -ErrorAction SilentlyContinue | Sort-Object RouteMetric,InterfaceMetric'
$metaLines += 'foreach (' + $d + 'r in ' + $d + 'rotas) {'
$metaLines += '  ' + $d + 'if = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex ' + $d + 'r.ifIndex -ErrorAction SilentlyContinue | Where-Object { ' + $d + '_.IPAddress -notlike ' + $sq + '127.*' + $sq + ' -and ' + $d + '_.IPAddress -notlike ' + $sq + '169.254.*' + $sq + ' -and ' + $d + '_.PrefixOrigin -ne ' + $sq + 'WellKnown' + $sq + ' -and ' + $d + '_.InterfaceAlias -notmatch ' + $d + 'filtro } | Select-Object -First 1'
$metaLines += '  if (' + $d + 'if) { ' + $d + 'ip = ' + $d + 'if.IPAddress; break }'
$metaLines += '}'
$metaLines += 'if (-not ' + $d + 'ip) {'
$metaLines += '  ' + $d + 'ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { ' + $d + '_.IPAddress -notlike ' + $sq + '127.*' + $sq + ' -and ' + $d + '_.IPAddress -notlike ' + $sq + '169.254.*' + $sq + ' -and ' + $d + '_.InterfaceAlias -notmatch ' + $d + 'filtro } | Select-Object -First 1).IPAddress'
$metaLines += '}'
$metaLines += 'if (-not ' + $d + 'ip) { ' + $d + 'ip = ' + $sq + 'sem-ip' + $sq + ' }'
$metaLines += 'Write-Output (' + $sq + 'inventario-ti ' + $sq + ' + ' + $d + 'ip)'
$enc = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($meta, $metaLines, $enc)

# --- zabbix_agent2.conf (SEM PidFile - invalido no Agent 2 Windows) ---
$c = @()
$c += '# Zabbix Agent 2 - Configuracao automatica (Inventario TI)'
$c += '# Gerado pelo instalador - NAO editar manualmente'
$c += ''
$c += 'Server=' + $Server
$c += 'ServerActive=' + $Server
$c += 'Hostname=' + $hostname
$c += ''
$c += '# IP adaptativo: metadata DINAMICO (HostMetadataItem)'
$c += '# HostMetadata (estatico) NAO pode estar definido, senao este item e ignorado'
$c += 'HostMetadataItem=inv.meta'
$c += 'UnsafeUserParameters=1'
$c += 'UserParameter=inv.meta,powershell -NoProfile -ExecutionPolicy Bypass -File ' + $q + $meta + $q
$c += ''
$c += 'Include=' + $confDir + '\zabbix_agent2.d\*.conf'
$c += 'LogFile=' + $confDir + '\zabbix_agent2.log'
$c += 'LogFileSize=10'
$c += 'Timeout=30'
$c += ''
[System.IO.File]::WriteAllLines($conf, $c, $enc)

Write-Output ('CONF_OK server=' + $Server)
& powershell -NoProfile -ExecutionPolicy Bypass -File $meta
