# =============================================================================
# Instalacao remota do Zabbix Agent 2 — COMPATIBILIDADE
#
# ATENCAO: este script legado foi SUBSTITUIDO pelo instalador unico:
#     ..\execução bat\instalar-tudo.bat
#
# Ele仍然存在 para nao quebrar automacoes antigas, mas agora apenas delega para
# o instalador novo (que gera HostMetadataItem dinamico + IP adaptativo).
# Rodar a logica antiga aqui reintroduzia o HostMetadata estatico e MATAVA o
# IP adaptativo (o Zabbix ignora HostMetadataItem quando HostMetadata existe).
#
# Uso recomendado: execute "execução bat\instalar-tudo.bat" como Administrador.
# =============================================================================
param(
    [string]$ServidorZabbix = "192.168.0.102",
    [string]$Usuario = "",
    [string]$Senha = "",
    [string]$PSKIdentity = "",
    [string]$PSKKey = "",
    [string[]]$Computadores = @(),
    [string]$ListaCSV = "",
    [string]$MSIPath = "",
    [int]$Porta = 10050,
    [switch]$ModoAtivo = $true,
    [switch]$Forcar = $false,
    [switch]$DryRun = $false
)

$novo = Join-Path (Split-Path $PSScriptRoot -Parent) "execução bat\instalar-tudo.bat"
if (Test-Path $novo) {
    Write-Host "=== Script legado: delegando para o instalador unico ==="
    Write-Host $novo
    Write-Host "O novo instalador detecta o IP do servidor automaticamente e habilita IP adaptativo."
    Write-Host "Para instalacao remota em outros PCs, copie a pasta 'execução bat' e execute la."
    Write-Host ""
    Write-Host "Servidor informado (informativo): $ServidorZabbix"
    Write-Host "Computadores informados (informativo): $($Computadores -join ', ')"
    if (!$DryRun) {
        & $novo
    } else {
        Write-Host "[DRYRUN] Nada executado."
    }
} else {
    Write-Error "Instalador novo nao encontrado: $novo"
    exit 1
}
