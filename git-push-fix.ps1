$ErrorActionPreference = 'Stop'
Set-Location 'C:\Users\usuario\Documents\cadastro-computadores-v3'
$env:GIT_TERMINAL_PROMPT = "0"
gh auth switch --user suporte04-BA 2>&1 | Out-Null
git add -A 2>&1 | Out-Null
git commit -m "feat: TTL fix in server.cjs and zabbix-bridge.js (add explicit TTL checks in fallbacks)" 2>&1 | Select-Object -Last 2
Write-Host ""
git push origin main 2>&1 | Select-Object -Last 3