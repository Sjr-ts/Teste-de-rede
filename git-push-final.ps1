$ErrorActionPreference = 'Stop'
Set-Location 'C:\Users\usuario\Documents\cadastro-computadores-v3'
$env:GIT_TERMINAL_PROMPT = "0"
gh auth switch --user suporte04-BA 2>&1 | Out-Null
git add -A 2>&1 | Out-Null
git commit -m "fix: Corrigir CPU falsa quando Zabbix offline e estado acessível em desconexão

- dadosMonitoramentoZabbix(): agora verifica agent.ping e zabbix[host,active_agent,available]
  para hosts com agente ativo (não apenas ICMP passivo)
- enriquecerPainelComZabbix(): rastreia _zbHostFresh e _zbUltimaChamadaOK para não aplicar
  cache expirado quando Zabbix está offline
- Métricas CPU/RAM/GPU/Disco não são aplicadas quando host está indisponível no Zabbix
- Adicionado resumo.coletadoEm com timestamp da última coleta
- Frontend mostra 'Indisp.' quando não há dados reais do Zabbix
- SSE usa mesmo enriquecimento da API para evitar piscar INDISP."

git push origin main 2>&1 | Select-Object -Last 3
