# =============================================================================
# VIGIA DO SERVIDOR - Inventario TI (porta 5903)
#
# Roda como TAREFA AGENDADA a cada 1 minuto. Se o servidor nao responder em
# 8 segundos, reinicia sozinho. Assim ate um congelamento de event loop (ou
# qualquer outro problema) dura no maximo ~1 minuto em vez de para sempre.
#
# Log: vigia.log (ao lado deste arquivo). So escreve quando ha mudanca de
# estado - nunca enche o disco com "tudo ok" a cada minuto.
# =============================================================================
$ErrorActionPreference = 'SilentlyContinue'
$dir = $PSScriptRoot
if (-not $dir) { $dir = Split-Path -Parent $MyInvocation.MyCommand.Path }
$lg        = Join-Path $dir 'vigia.log'
$estadoF   = Join-Path $dir 'vigia-estado.txt'
$ultimaF   = Join-Path $dir 'vigia-ultima-restart.txt'
$porta     = 5903
$timeout   = 8

function Log([string]$msg) {
    $linha = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    try { Add-Content -LiteralPath $lg -Value $linha -Encoding UTF8 } catch { }
    # rotacao simples: acima de 400 linhas, mantem as 200 ultimas
    try {
        if ((Test-Path $lg) -and ((Get-Content $lg).Count -gt 400)) {
            Get-Content $lg -Tail 200 | Set-Content -LiteralPath $lg -Encoding UTF8
        }
    } catch { }
}

function LerEstado {
    if (Test-Path $estadoF) { try { return (Get-Content $estadoF -Raw).Trim() } catch { } }
    return ''
}
function GravarEstado([string]$s) {
    try { Set-Content -LiteralPath $estadoF -Value $s -Encoding ASCII } catch { }
}

# ---- 1) saude do servidor ----
$saudavel = $false
try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$porta/actuator/health" `
         -TimeoutSec $timeout -UseBasicParsing -ErrorAction Stop
    if ($r.StatusCode -eq 200) { $saudavel = $true }
} catch { }

$estadoAnterior = LerEstado

if ($saudavel) {
    if ($estadoAnterior -ne 'OK') {
        Log 'Servidor SAUDAVEL (recuperado ou iniciado).'
        GravarEstado 'OK'
    }
    exit 0
}

# ---- 2) nao respondeu: e problema de verdade? ----
# Nao reinicia se o servidor subiu ha menos de 90s (ainda aquecendo) ou se ja
# reiniciamos ha menos de 90s (evita loop de restart).
$pidServidor = $null
$c = Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($c) { $pidServidor = $c.OwningProcess }

$inicioServidor = $null
if ($pidServidor) {
    $np = Get-Process -Id $pidServidor -ErrorAction SilentlyContinue
    if ($np) { $inicioServidor = $np.StartTime }
}

$ultimaRestart = $null
if (Test-Path $ultimaF) { try { $ultimaRestart = [datetime]::Parse((Get-Content $ultimaF -Raw).Trim()) } catch { } }

$agora = Get-Date
$recente = $false
if ($inicioServidor -and (($agora - $inicioServidor).TotalSeconds -lt 90)) { $recente = $true }
if ($ultimaRestart -and (($agora - $ultimaRestart).TotalSeconds -lt 90)) { $recente = $true }

if ($recente) {
    if ($estadoAnterior -ne 'ESPERA') {
        Log "Sem resposta, mas o servidor subiu/reiniciou ha pouco - aguardando (PID=$pidServidor)."
        GravarEstado 'ESPERA'
    }
    exit 0
}

# ---- 3) reinicia ----
if ($estadoAnterior -ne 'FALHA') {
    Log "Servidor NAO respondeu em ${timeout}s (PID=$pidServidor). Reiniciando..."
} else {
    Log "Ainda sem resposta (PID=$pidServidor). Reiniciando novamente..."
}
GravarEstado 'FALHA'
try { Set-Content -LiteralPath $ultimaF -Value $agora.ToString('o') -Encoding ASCII } catch { }

$ps1 = Join-Path $dir 'iniciar-servidor.ps1'
if (Test-Path $ps1) {
    & powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File $ps1 2>&1 | ForEach-Object { Log ('  init> ' + "$_".Trim()) }
} else {
    Log 'iniciar-servidor.ps1 ausente - reinicio manual necessario.'
}

# confirma depois do reinicio
Start-Sleep -Seconds 5
try {
    $r2 = Invoke-WebRequest -Uri "http://127.0.0.1:$porta/actuator/health" -TimeoutSec 8 -UseBasicParsing -ErrorAction Stop
    if ($r2.StatusCode -eq 200) { Log 'Reinicio OK - servidor respondendo.'; GravarEstado 'OK' }
    else { Log 'Reinicio feito, mas ainda sem 200.' }
} catch { Log 'Reinicio feito, mas ainda sem resposta.' }
