# =============================================================================
#  AUTO-CADASTRO DO PC NO INVENTARIO (chamado pelo instalar-tudo.bat)
#  Coleta dados REAIS do Windows e envia para a aplicacao. Nao inventa nada:
#  campo desconhecido fica vazio para o suporte completar depois.
# =============================================================================
param([string]$Servidor = '')
$ErrorActionPreference = 'Continue'
$dir = $PSScriptRoot
if (-not $dir) { $dir = Split-Path -Parent $MyInvocation.MyCommand.Path }
$log = Join-Path $env:TEMP 'zabbix-registro-pc.log'
function Log($m) {
    $l = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $m
    try { Add-Content -LiteralPath $log -Value $l -Encoding UTF8 } catch {}
    Write-Output $l
}

function Get-IpReal {
    $filtro = 'vEthernet|Hyper-V|VMware|VirtualBox|Loopback|WSL|Bluetooth'
    try {
        $rotas = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric, InterfaceMetric
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

Log '=== auto-cadastro do computador ==='

# --- IP do servidor (o mesmo detector do instalador) ---
if (-not $Servidor) {
    $det = Join-Path $dir 'detect-server.ps1'
    if (Test-Path -LiteralPath $det) {
        $Servidor = (& powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File $det | Select-Object -First 1)
        if ($Servidor) { $Servidor = "$Servidor".Trim() }
    }
}
if (-not $Servidor) { $Servidor = '127.0.0.1' }
Log ("servidor: $Servidor")

# --- dados reais do Windows ---
try {
    $cs   = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
    $bios = Get-CimInstance Win32_BIOS -ErrorAction SilentlyContinue
    $cpu  = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1
    $so   = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
    $disco = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'" -ErrorAction SilentlyContinue
    $memGb = [Math]::Round([double]$cs.TotalPhysicalMemory / 1GB, 1)
    $mac  = (Get-CimInstance Win32_NetworkAdapterConfiguration -Filter 'IPEnabled=True' -ErrorAction SilentlyContinue |
             Where-Object { $_.DefaultIPGateway } | Select-Object -First 1).MACAddress

    $corpo = [ordered]@{
        nomePc            = $env:COMPUTERNAME
        ipAddress         = Get-IpReal
        numeroSerie       = if ($bios) { "$($bios.SerialNumber)".Trim() } else { '' }
        modeloMarca       = if ($cs) { "$($cs.Manufacturer) $($cs.Model)".Trim() } else { '' }
        fornecedor        = if ($cs) { "$($cs.Manufacturer)".Trim() } else { '' }
        processador       = if ($cpu) { "$($cpu.Name)".Trim() } else { '' }
        memoriaRam        = if ($memGb -gt 0) { "$memGb GB" } else { '' }
        armazenamento     = if ($disco) { "C: $([Math]::Round($disco.Size/1GB,0)) GB (livre $([Math]::Round($disco.FreeSpace/1GB,0)) GB)" } else { '' }
        sistemaOperacional= if ($so) { "$($so.Caption) $($so.Version)".Trim() } else { '' }
        macAddress        = if ($mac) { "$mac" } else { '' }
        departamento      = 'TI'
    }
    Log ("coletado: " + $corpo.nomePc + ' | ' + $corpo.ipAddress + ' | ' + $corpo.modeloMarca + ' | ' + $corpo.processador + ' | ' + $corpo.memoriaRam)
} catch {
    Log ('FALHA ao coletar dados: ' + $_.Exception.Message)
    exit 1
}

# --- envia para a aplicacao (login + POST autenticado) ---
try {
    $base = 'http://' + $Servidor + ':5903'
    $sess = $null
    $cred = @{ username = 'admin'; senha = 'admin123' } | ConvertTo-Json -Compress
    $null = Invoke-WebRequest -SessionVariable sess -Uri ($base + '/api/auth/login') -Method Post `
              -ContentType 'application/json' -Body $cred -TimeoutSec 15
    $r = Invoke-RestMethod -WebSession $sess -Uri ($base + '/api/computadores/auto-registro') -Method Post `
              -ContentType 'application/json' -Body ($corpo | ConvertTo-Json -Compress) -TimeoutSec 20
    if ($r.ok) {
        Log ('OK: ' + $(if ($r.criado) { 'computador CRIADO' } else { 'dados COMPLETADOS' }) +
             ' | id=' + $r.computador.id + ' | campos preenchidos=' + $r.atualizados + ' | rev=' + $r.rev)
        exit 0
    }
    Log ('ERRO na resposta: ' + ($r | ConvertTo-Json -Compress))
    exit 1
} catch {
    Log ('ERRO ao enviar: ' + $_.Exception.Message)
    exit 1
}
