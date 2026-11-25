# ============================================================================
#  INSTALADOR UNICO - Inventario TI  (orquestrador PowerShell)
#
#  O que faz, nesta ordem:
#    1. Detecta administrador de forma CONFIARVEL (WindowsPrincipal)
#    2. Se nao for admin, eleva a si proprio (UAC) via $PSCommandPath
#    3. Chama instalar-tudo.bat /silent (instala agente Zabbix + auto-heal)
#    4. Descobre o servidor na rede (127.0.0.1 + 192.168.0.100-129)
#    5. Abre o painel ja logado (acesso-automatico.html)
#
#  TUDO e logado em instalar.log ao lado deste arquivo - nada falha em silencio.
# ============================================================================

$ErrorActionPreference = 'Continue'
$scriptDir = Split-Path -Parent $PSCommandPath
$logPath = Join-Path $scriptDir 'instalar.log'

function Log([string]$msg, [string]$level = 'INFO') {
    $line = '[{0}] [{1,-5}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $level, $msg
    try { Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8 } catch { }
    Write-Host $line
}

function EhAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

Log '=== INSTALADOR INVENTARIO TI ==='
Log "scriptDir = $scriptDir"
Log "usuario   = $([Security.Principal.WindowsIdentity]::GetCurrent().Name)"

# ---------------------------------------------------------------- passo 1/2
if (-not (EhAdmin)) {
    Log 'Nao-admin detectado. Solicitando elevacao (UAC)...' 'AVISO'
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    try {
        $p = Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -Verb RunAs -PassThru
        Log "Elevacao aceita (PID=$($p.Id)). A janela elevada fara a instalacao." 'OK'
        Write-Host ''
        Write-Host '  ================================================' -ForegroundColor Cyan
        Write-Host '   UAC aceito! A instalacao roda em OUTRA janela' -ForegroundColor Green
        Write-Host '   (titulo: INSTALADOR UNICO - Inventario TI).' -ForegroundColor Green
        Write-Host '   Espere terminar e clique em Sim quando pedir.' -ForegroundColor Yellow
        Write-Host '   Esta janela pode ser fechada.' -ForegroundColor Gray
        Write-Host '  ================================================' -ForegroundColor Cyan
        Write-Host ''
        Read-Host '  Pressione Enter para fechar esta janela'
    } catch {
        Log "Elevacao RECUSADA ou falhou: $($_.Exception.Message)" 'ERRO'
        Write-Host ''
        Write-Host '  A elevacao foi recusada (UAC). Execute como Administrador.' -ForegroundColor Red
        Read-Host '  Pressione Enter para fechar'
    }
    exit 0
}

Log "Administrador CONFIRMADO ($([Security.Principal.WindowsIdentity]::GetCurrent().Name))." 'OK'

# ---------------------------------------------------------------- passo 3
$bat = Join-Path $scriptDir 'instalar-tudo.bat'
if (-not (Test-Path -LiteralPath $bat)) {
    Log "instalar-tudo.bat NAO encontrado em: $bat" 'ERRO'
    Write-Host '  ERRO: instalar-tudo.bat nao encontrado ao lado deste arquivo.' -ForegroundColor Red
    Read-Host '  Pressione Enter para fechar'
    exit 1
}

Log 'Chamando instalar-tudo.bat /silent (pode levar ~60s baixando o MSI)...' 'INFO'
$batLog = Join-Path $env:TEMP 'zabbix-install.log'
if (Test-Path -LiteralPath $batLog) { Remove-Item -LiteralPath $batLog -Force -ErrorAction SilentlyContinue }

$batOut = & cmd.exe /c "`"$bat`" /silent" 2>&1
foreach ($l in $batOut) { if ("$l".Trim()) { Log ('  bat> ' + "$l".Trim()) } }
$batExit = $LASTEXITCODE
Log "instalar-tudo.bat terminou (exit=$batExit)." $(if ($batExit -eq 0) { 'OK' } else { 'AVISO' })

# anexa o log proprio do bat (modo silent) para auditoria
if (Test-Path -LiteralPath $batLog) {
    Get-Content -LiteralPath $batLog -ErrorAction SilentlyContinue | ForEach-Object { Log ('  zblog> ' + $_) }
}

# ---------------------------------------------------------------- passo 4
Log 'Descobrindo o servidor na rede (127.0.0.1 + 192.168.0.100-129)...' 'INFO'
$server = $null
$ips = @('127.0.0.1', 'localhost') + (100..129 | ForEach-Object { "192.168.0.$_" })
foreach ($ip in $ips) {
    try {
        $r = Invoke-WebRequest -Uri "http://${ip}:5903/actuator/health" -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop
        if ($r.StatusCode -eq 200) { $server = "http://${ip}:5903"; break }
    } catch { }
}
if ($server) { Log "Servidor encontrado: $server" 'OK' }
else { Log 'Servidor NAO encontrado (nenhum IP respondeu na porta 5903).' 'AVISO' }

# ---------------------------------------------------------------- passo 5
if ($server) {
    $painel = "$server/acesso-automatico.html"
    Log "Abrindo painel: $painel" 'INFO'
    try { Start-Process $painel; Log 'Painel aberto no navegador.' 'OK' }
    catch { Log "Falha ao abrir navegador: $($_.Exception.Message)" 'ERRO' }
}

# ---------------------------------------------------------------- resumo
Write-Host ''
Write-Host '  ============================================================' -ForegroundColor Cyan
if ($server) {
    Write-Host "   INSTALACAO E ACESSO CONCLUIDOS  |  Servidor: $server" -ForegroundColor Green
    Write-Host '   Zabbix:     http://' + ($server -replace 'http://','') + ':8081  (Admin / Monitor2026!)' -ForegroundColor Gray
    Write-Host '   Inventario: ' + $painel -ForegroundColor Gray
} else {
    Write-Host '   INSTALACAO executada, mas o servidor nao foi encontrado.' -ForegroundColor Yellow
    Write-Host '   Verifique se o servidor esta ligado (porta 5903) e na mesma rede.' -ForegroundColor Yellow
}
Write-Host '   Log completo: instalar.log (ao lado deste arquivo)' -ForegroundColor Gray
Write-Host '  ============================================================' -ForegroundColor Cyan
Write-Host ''
Read-Host '  Pressione Enter para fechar'
