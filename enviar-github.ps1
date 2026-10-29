# =============================================================================
# Envia atualizacoes para o GitHub (Sjr-ts/Teste-de-rede)
# Uso:  powershell -ExecutionPolicy Bypass -File enviar-github.ps1
#       powershell -ExecutionPolicy Bypass -File enviar-github.ps1 -msg "minha mensagem"
# =============================================================================
param(
    [string]$msg = ""
)

$ErrorActionPreference = "Stop"
$dir = $PSScriptRoot
Set-Location $dir

# Garante que usa a conta com permissao de escrita
gh auth switch --user suporte04-BA 2>$null | Out-Null

# Verifica se ha mudancas
$changes = git status --porcelain
if (-not $changes) {
    Write-Host "Nada para enviar (working tree limpo)."
    exit 0
}

Write-Host "Mudancas detectadas:"
$changes | ForEach-Object { Write-Host "  $_" }
Write-Host ""

# Mensagem de commit
if ([string]::IsNullOrWhiteSpace($msg)) {
    $msg = "Atualizacao " + (Get-Date -Format "yyyy-MM-dd HH:mm")
}

git add -A
git commit -m $msg
git push origin main

Write-Host ""
Write-Host "Enviado com sucesso para https://github.com/Sjr-ts/Teste-de-rede"
