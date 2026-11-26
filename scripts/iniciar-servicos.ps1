# ================================================
# Inventario TI - Auto-start de servicos no logon
# -----------------------------------------------
# Sobe automaticamente ao entrar no Windows:
#   1) Docker Desktop (se o daemon estiver parado)
#   2) Todos os containers parados (Zabbix server/web/postgres)
#   3) server.cjs na porta 5903 (se nao estiver escutando)
#   4) Servico Zabbix Agent (se existir nesta maquina)
#
# Idempotente: pode rodar quantas vezes quiser - nada sobe 2x.
# Log: %TEMP%\inventario-ti-auto-start.log
#
# Registrado na Tarefa Agendada "Inventario TI - Auto Start"
# (trigger: ao logar no Windows). Re-registrar:
#   Register-ScheduledTask -TaskName 'Inventario TI - Auto Start' ...
# ================================================

param(
    [int]$Porta = 5903,
    [int]$TimeoutDockerSeg = 150
)

$ErrorActionPreference = 'SilentlyContinue'
$repo = Split-Path -Parent $PSScriptRoot
$nodeExe = 'C:\Program Files\nodejs\node.exe'
$dockerExe = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
$dockerDesktop = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
$logFile = Join-Path $env:TEMP 'inventario-ti-auto-start.log'

function Log([string]$m) {
    $linha = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
    Add-Content -Path $logFile -Value $linha -Encoding UTF8
}

function Test-DaemonDocker {
    if (-not (Test-Path $dockerExe)) { return $false }
    & $dockerExe info *> $null
    return ($LASTEXITCODE -eq 0)
}

Log '=== auto-start iniciado ==='

# ---- 1) Docker Desktop ------------------------------------------
try {
    $daemonOk = Test-DaemonDocker
    if (-not $daemonOk -and (Test-Path $dockerDesktop)) {
        Log 'Docker Desktop parado - iniciando...'
        Start-Process -FilePath $dockerDesktop
        $deadline = (Get-Date).AddSeconds($TimeoutDockerSeg)
        while ((Get-Date) -lt $deadline) {
            Start-Sleep -Seconds 5
            if (Test-DaemonDocker) { $daemonOk = $true; break }
        }
    }
    if ($daemonOk) {
        Log 'daemon Docker: OK'
    } else {
        Log "AVISO: daemon Docker nao respondeu em $TimeoutDockerSeg s (Zabbix nao sobe nesta execucao)"
    }
} catch {
    Log "ERRO docker: $($_.Exception.Message)"
    $daemonOk = $false
}

# ---- 2) Containers (Zabbix) -------------------------------------
# So a stack do Zabbix (zbx-*): os demais projetos tem restart policy
# propria (evolution: always) ou ficam parados de proposito (antigos).
if ($daemonOk) {
    try {
        $paraIniciar = & $dockerExe ps -aq --filter 'status=exited' --filter 'name=zbx-'
        $paraIniciar += & $dockerExe ps -aq --filter 'status=created' --filter 'name=zbx-'
        if ($paraIniciar) {
            & $dockerExe start $paraIniciar | Out-Null
            Log ("containers zbx iniciados: " + (@($paraIniciar) -join ', '))
        } else {
            Log 'containers zbx: nenhum parado (tudo ja rodando)'
        }
    } catch {
        Log "ERRO ao iniciar containers: $($_.Exception.Message)"
    }
}

# ---- 3) server.cjs (sistema Inventario TI) ----------------------
try {
    $escuta = Get-NetTCPConnection -LocalPort $Porta -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($escuta) {
        Log "server.cjs: ja rodando (PID $($escuta.OwningProcess), porta $Porta)"
    } else {
        if (-not (Test-Path $nodeExe)) {
            Log "ERRO: node nao encontrado em $nodeExe"
        } else {
            # SEGURANCA: usa iniciar-servidor.ps1 em vez de Start-Process node direto.
            # O inicializador redireciona stdout/stderr para ARQUIVO (server.log /
            # server.err.log). Rodar "node" em console - mesmo oculto - arrisca o
            # mesmo congelamento de event loop por QuickEdit/buffer que derrubou o
            # painel em 25/11/2026 (carregamento infinito).
            $init = Join-Path $repo 'iniciar-servidor.ps1'
            if (Test-Path -LiteralPath $init) {
                Log "server.cjs: subindo na porta $Porta (via iniciar-servidor.ps1)..."
                & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $init | ForEach-Object { Log ("  init> " + "$_".Trim()) }
            } else {
                Log "server.cjs: subindo na porta $Porta (fallback Start-Process oculto)..."
                Start-Process -FilePath $nodeExe `
                    -ArgumentList "`"$repo\server.cjs`"" `
                    -WorkingDirectory $repo `
                    -WindowStyle Hidden
            }
            $deadline = (Get-Date).AddSeconds(30)
            while ((Get-Date) -lt $deadline) {
                Start-Sleep -Seconds 2
                if (Get-NetTCPConnection -LocalPort $Porta -State Listen -ErrorAction SilentlyContinue) {
                    Log "server.cjs: OK (porta $Porta no ar)"
                    break
                }
            }
            if (-not (Get-NetTCPConnection -LocalPort $Porta -State Listen -ErrorAction SilentlyContinue)) {
                Log 'ERRO: server.cjs nao respondeu em 30s - veja %TEMP% ou inicie manualmente'
            }
        }
    }
} catch {
    Log "ERRO server.cjs: $($_.Exception.Message)"
}

# ---- 4) Zabbix Agent (servico Windows, se existir) --------------
try {
    $svc = Get-Service -Name 'Zabbix Agent*' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($svc) {
        if ($svc.Status -ne 'Running') { Start-Service $svc -Name $svc.Name }
        Log "Zabbix Agent: $((Get-Service $svc.Name).Status)"
    } else {
        Log 'Zabbix Agent: nao instalado nesta maquina (ok - agentes ficam nos PCs monitorados)'
    }
} catch {
    Log "ERRO zabbix agent: $($_.Exception.Message)"
}

Log '=== auto-start concluido ==='
