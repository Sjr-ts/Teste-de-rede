# =============================================================================
# Iniciar/Reiniciar o servidor do Inventario TI (porta 5903)
#
# Uso:  powershell -ExecutionPolicy Bypass -File iniciar-servidor.ps1
#
# POR QUE REDIRECIONA A SAIDA PARA ARQUIVO (nao para o console):
#   Se o node roda dentro de uma janela de console com QuickEdit ativado
#   (padrao do Windows), uma simples selecao de texto nessa janela faz o
#   console parar de consumir a saida. Quando o buffer enche, o WriteFile do
#   node BLOQUEIA e o event loop inteiro congela -> o painel fica em
#   carregamento infinito para sempre. Foi exatamente o que aconteceu em
#   25/11/2026 (node com 0,42s de CPU em 4,5 horas, aceitando conexao mas
#   nunca respondendo). Gravando em ARQUIVO o WriteFile nunca bloqueia.
# =============================================================================
$dir = $PSScriptRoot
if (-not $dir) { $dir = Split-Path -Parent $MyInvocation.MyCommand.Path }
$log = Join-Path $dir "server.log"
$err = Join-Path $dir "server.err.log"
$lg = Join-Path $dir "iniciar-servidor.log"

function Log([string]$msg) {
    $linha = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    try { Add-Content -LiteralPath $lg -Value $linha -Encoding UTF8 } catch { }
    Write-Host $linha
}

Log '=== iniciar-servidor ==='

# 1) Para qualquer node antigo escutando a 5903 (e o amostrador orfao dele)
$antigos = Get-NetTCPConnection -LocalPort 5903 -State Listen -ErrorAction SilentlyContinue |
           Select-Object -ExpandProperty OwningProcess -Unique
foreach ($p in $antigos) {
    Log "Encerrando processo antigo PID $p na porta 5903..."
    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 1

# 2) Sobe o servidor de forma desanexada, com saida em ARQUIVO
#    (-WindowStyle Hidden + redirect: a janela de console some e nada bloqueia)
Start-Process -FilePath "node" `
    -ArgumentList "server.cjs" `
    -WorkingDirectory $dir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $log `
    -RedirectStandardError $err

Start-Sleep -Seconds 3

# 3) Confere se responde (sempre por loopback: IP fixo da LAN muda com DHCP e
#    gerava falso negativo mesmo com o servidor no ar)
try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:5903/actuator/health" -TimeoutSec 8
    Log "SERVIDOR OK -> http://127.0.0.1:5903  (status: $($h.status))"
} catch {
    Log "Falha ao responder. Veja server.err.log"
    try { Get-Content $err -Tail 20 | ForEach-Object { Log ('  err> ' + $_) } } catch { }
}
