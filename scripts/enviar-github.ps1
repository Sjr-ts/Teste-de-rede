# =============================================================================
# enviar-github.ps1 — publica as mudancas do Inventário TI no GitHub
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts\enviar-github.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\enviar-github.ps1 -msg "feat: minha mensagem"
#
# O que NAO faz (por seguranca):
#   - nao usa "git add -A" cego: voce VE e CONFIRMA a lista de arquivos antes
#     do commit; arquivos ignorados pelo .gitignore nunca entram.
#
# Requisitos: git e gh autenticado (gh auth login; conta suporte04-BA)
# =============================================================================
param(
    [string]$msg = ""
)

$ErrorActionPreference = "Stop"
$dir = $PSScriptRoot | Split-Path -Parent
Set-Location $dir

# Conta com permissao de escrita no repo
try { gh auth switch --user suporte04-BA 2>$null | Out-Null } catch {}

Write-Host "==> atualizando main (git pull --rebase)..." -ForegroundColor Cyan
git pull --rebase origin main

$changes = git status --porcelain
if (-not $changes) {
    Write-Host "Nada para enviar (working tree limpo)." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Mudancas encontradas:" -ForegroundColor Cyan
$changes | ForEach-Object { Write-Host "  $_" }
Write-Host ""

# Confirmacao explicita antes de envolver o commit
$confirmar = Read-Host "Prosseguir com git add . e commit? (s/N)"
if ($confirmar -ne 's' -and $confirmar -ne 'S') {
    Write-Host "Cancelado pelo usuario. Nada foi alterado." -ForegroundColor Yellow
    exit 1
}

git add .

if ([string]::IsNullOrWhiteSpace($msg)) {
    $msg = "Atualizacao " + (Get-Date -Format "yyyy-MM-dd HH:mm")
}

git commit -m $msg
Write-Host ""
Write-Host "==> enviando para origin/main..." -ForegroundColor Cyan
git push origin main
Write-Host ""
Write-Host "Publicado com sucesso." -ForegroundColor Green
