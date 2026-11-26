# ============================================================================
#  INSTALADOR UNICO - Inventario TI  (orquestrador PowerShell)
#
#  O que faz, nesta ordem:
#    1. Detecta administrador de forma CONFIARVEL (WindowsPrincipal)
#    2. Se nao for admin, eleva a si proprio (UAC) via $PSCommandPath
#    3. Chama instalar-tudo.bat /silent (instala agente Zabbix + auto-heal)
#    4. Descobre o servidor na rede (detect-server.ps1: scan paralelo de toda a sub-rede)
#    5. Abre o painel ja logado (acesso-automatico.html)
#
#  TUDO e logado em instalar.log ao lado deste arquivo - nada falha em silencio.
# ============================================================================

param(
    # Usado quando re-executado ja elevado (UAC aceito): a janela ORIGINAL fica
    # esperando com -Wait e mostra o resultado; a elevada entao NAO pausa no
    # final (senao o -Wait travaria as duas janelas para sempre).
    [switch]$Elevado
)

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
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Elevado')
    Write-Host ''
    Write-Host '  ================================================' -ForegroundColor Cyan
    Write-Host '   INSTALADOR INVENTARIO TI - 1 CLIQUE' -ForegroundColor Cyan
    Write-Host '  ================================================' -ForegroundColor Cyan
    Write-Host '   Vai aparecer o UAC (controle de conta de usuario).' -ForegroundColor Yellow
    Write-Host '   Clique em SIM para continuar.' -ForegroundColor Yellow
    Write-Host '   Depois a instalacao roda e esta janela espera ate' -ForegroundColor Gray
    Write-Host '   terminar - nao feche nada.' -ForegroundColor Gray
    Write-Host '  ================================================' -ForegroundColor Cyan
    Write-Host ''
    try {
        # -Wait: esta janela ESPERA a instalacao elevada terminar (nao fecha cedo)
        $p = Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -Verb RunAs -PassThru -Wait
        $rc = $p.ExitCode
        Log "Elevacao OK (PID=$($p.Id)). Instalacao elevada terminou (exit=$rc)." $(if ($rc -eq 0) { 'OK' } else { 'AVISO' })
        Write-Host ''
        if ($rc -eq 0) {
            Write-Host '  ================================================' -ForegroundColor Green
            Write-Host '   INSTALACAO E ACESSO CONCLUIDOS!' -ForegroundColor Green
            Write-Host '   Se o painel nao abriu, clique no atalho' -ForegroundColor Gray
            Write-Host '   INVENTARIO TI na Area de Trabalho.' -ForegroundColor Gray
            Write-Host '  ================================================' -ForegroundColor Green
        } else {
            Write-Host '  ================================================' -ForegroundColor Yellow
            Write-Host "   Instalacao terminou com aviso (exit=$rc)." -ForegroundColor Yellow
            Write-Host '   Veja instalar.log nesta pasta para detalhes.' -ForegroundColor Yellow
            Write-Host '  ================================================' -ForegroundColor Yellow
        }
        Write-Host ''
    } catch {
        Log "Elevacao RECUSADA ou falhou: $($_.Exception.Message)" 'ERRO'
        Write-Host ''
        Write-Host '  A elevacao foi recusada (UAC) ou falhou.' -ForegroundColor Red
        Write-Host '  Execute como Administrador (botao direito).' -ForegroundColor Red
        Write-Host ''
    }
    Read-Host '  Pressione Enter para fechar'
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
# Reutiliza o MESMO detect-server.ps1 do instalador (scan paralelo de toda a
# sub-rede na porta 5903). Antes havia uma faixa hardcoded 192.168.0.100-129
# duplicada aqui - nao cobria o servidor (ex.: .238) e o painel nao abria.
Log 'Descobrindo o servidor na rede (detect-server.ps1)...' 'INFO'
$server = $null
$det = Join-Path $scriptDir 'detect-server.ps1'
if (Test-Path -LiteralPath $det) {
    $serverIp = (& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $det | Select-Object -First 1)
    if ($serverIp) { $serverIp = "$serverIp".Trim() }
    if ($serverIp -match '^\d{1,3}(\.\d{1,3}){3}$') { $server = "http://${serverIp}:5903" }
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
# So pausa se for a janela UNICA (sem -Elevado). Com -Elevado, a janela
# original esta esperando com -Wait e mostrara o resultado - pausar aqui
# travaria as duas janelas para sempre.
if (-not $Elevado) { Read-Host '  Pressione Enter para fechar' }
