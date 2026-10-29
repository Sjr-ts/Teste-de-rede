# RELATÓRIO DE ESTUDO — Cadastro de Computadores v3 (Inventário de TI)

**Data:** 29/10/2026  
**Autor:** Agente de análise (OpenCode)  
**Repositório:** https://github.com/Sjr-ts/Teste-de-rede  
**Versão analisada:** commit `0f50c16`  

---

## 1. Visão Geral do Projeto

Sistema web de gestão de inventário de TI com monitoramento preventivo de rede, integrado ao Zabbix. Desenvolvido em Node.js (backend) + HTML/CSS/JS vanilla (frontend), com banco de dados em JSON.

### 1.1 Stack Tecnológica
| Camada | Tecnologia |
|--------|-----------|
| Backend | Node.js v24.16.0 + Express.js |
| Frontend | HTML5 + CSS3 + JavaScript vanilla (sem framework) |
| Banco de Dados | JSON (data.json) — 101 computadores, 97 ramais |
| Monitoramento | ICMP ping (nativo SO) + Zabbix 7.0 LTS (Docker) |
| Autenticação | JWT (HS256) + bcrypt |
| Gráficos | Chart.js (canvas) + SVG inline |
| PDF | jsPDF + autotable |
| Containerização | Docker Compose (Zabbix stack) |

### 1.2 Arquitetura
```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND (SPA)                           │
│  index.html + app.js (6.633 linhas) + monitor.js (2.300+)   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Dashboard│ │Computad. │ │ Ramais   │ │Monitoram.│       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP REST (fetch)
┌──────────────────────┴──────────────────────────────────────┐
│                    BACKEND (server.cjs)                     │
│  Express.js — Porta 5903 — Bind 192.168.0.186              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ /api/data│ │ /api/mon │ │/api/zabbix│ │/api/comp │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────────────┐
│              MONITOR (coletor + Zabbix bridge)              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ pinger.js│ │hostmetrics│ │service.js│ │zabbix-   │       │
│  │ (ICMP)   │ │(CPU/RAM) │ │(ciclo)   │ │bridge.js │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────────────┐
│              ZABBIX 7.0 LTS (Docker)                        │
│  zbx-postgres | zbx-server | zbx-web (8081) | zbx-agent     │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Estrutura de Arquivos (55 arquivos, 6.05 MB)

### 2.1 Arquivos Principais
| Arquivo | Tamanho | Linhas | Descrição |
|---------|---------|--------|-----------|
| `server.cjs` | 33.4 KB | ~700 | Backend Express, endpoints REST, monitoramento |
| `frontend/js/app.js` | 373.4 KB | 6.633 | Lógica do frontend (CRUD, dashboard, relatórios) |
| `frontend/js/monitor.js` | 147.6 KB | 2.300+ | Aba Monitoramento (KPIs, tabelas, gráficos SVG, SSE) |
| `frontend/index.html` | 60.3 KB | ~1.200 | SPA (Single Page Application) |
| `frontend/css/style.css` | 78.4 KB | ~2.000 | Estilos (tema dark/cyan) |
| `data.json` | 777 KB | ~4.000 | Banco de dados (101 computadores, 97 ramais) |
| `monitor/service.js` | 27.2 KB | ~700 | Coletor de métricas (ciclo de 60s) |
| `monitor/zabbix-bridge.js` | 34.5 KB | ~900 | Integração com Zabbix API JSON-RPC |
| `monitor/hostmetrics.js` | 9.4 KB | 210 | Métricas reais do SO (CPU/RAM/Disco/GPU/Uptime/Rede) |
| `monitor/pinger.js` | 6.6 KB | ~200 | ICMP ping nativo (PowerShell) |
| `monitor/mock-engine.js` | 10.9 KB | ~300 | Motor de simulação (101 hosts mock) |
| `monitor/storage.js` | 10.9 KB | ~300 | Armazenamento de medições (raw + agregados) |
| `monitor/alerts.js` | 14.4 KB | ~400 | Sistema de alertas |
| `monitor/zabbix.js` | 7.1 KB | ~200 | Integração Zabbix (config, status) |
| `monitor/config.json` | 1.5 KB | ~50 | Configuração do coletor + limites + Zabbix |

### 2.2 Dados do Inventário (data.json)
| Entidade | Quantidade | Detalhes |
|----------|-----------|----------|
| Computadores | 101 | Todos ATIVO, nenhum com ipAddress |
| Ramais | 97 | Todos vinculados via computadorId |
| Manutenções | 10 | 1 pendente, 1 andamento, 7 concluídas, 1 cancelada |
| Ordens de Serviço | 8 | 2 abertas, 3 execução, 2 concluídas, 1 análise |
| Usuários | 2 | admin (ADMIN), tecnico (TECNICO) |
| Departamentos | 22 | TI, Vendas, CD, Caixa, etc. |
| Software/Licenças | 4 | - |
| Trocas | 4 | Entradas/saídas/trocas |
| Logs de Auditoria | 486 | Login, criação, alteração, exclusão |
| Revision | 251 | Controle de versão otimista |

### 2.3 Monitoramento (monitor/data/)
| Arquivo | Descrição |
|---------|-----------|
| `targets.json` | 2 alvos monitorados (MEU-PC, TERM-COMPRAS10) |
| `state.json` | Estado atual do coletor (último ciclo) |
| `alerts.json` | Alertas ativos (vazio atualmente) |
| `raw/2026-10-XX.jsonl` | Medições brutas por dia (7 dias, ~5.800 medições) |
| `agg/2026-10-XX.json` | Agregados diários (latência média, p95, perda) |

---

## 3. Análise Profunda do Problema Persistente

### 3.1 Problema Original: "CPU sempre dá errado e diferente da realidade"

**Causa Raiz Identificada:**
O comando PowerShell em `hostmetrics.js` usava `% Processor Time` dentro de uma string com aspas duplas passada ao `cmd.exe` via `exec()`. O caractere `%` era interpretado/expandido pelo cmd.exe, corrompendo o comando.

**Evidência:**
```
Comando original: powershell -NoProfile -Command "$pc = New-Object System.Diagnostics.PerformanceCounter('Processor', '% Processor Time', '_Total'); ..."
Erro: "Uma expressão era esperada após '('"
```

O cmd.exe interpretava `% Processor Time` como variável de ambiente (vazia), resultando em:
```
New-Object System.Diagnostics.PerformanceCounter('Processor', ' Time', '_Total')
```

**Correção Aplicada:**
```javascript
// ANTES (quebrado):
exec('powershell -NoProfile -Command "' + script + '"', { timeout: 8000, windowsHide: true }, ...)

// DEPOIS (corrigido):
execFile('powershell', ['-NoProfile', '-Command', script], { timeout: 8000, windowsHide: true }, ...)
```

**Resultado:** CPU agora retorna valor real do PerformanceCounter (amostragem de 1s, compatível com Task Manager).

### 3.2 Problema Original: "IP que não está pegando (TERM-COMPRAS10)"

**Causa Raiz Identificada:**
TERM-COMPRAS10 (192.168.0.108) é um host com **Zabbix Agent ativo** (não passivo). A interface `available` fica `0` (unknown) porque agentes ativos não atualizam a disponibilidade da interface passiva. O frontend mostrava "Aguardando" mesmo com agent.ping=1, CPU 34%, RAM 80%.

**Evidência (API Zabbix):**
```json
{
  "host": "TERM-COMPRAS10",
  "interfaces": [{"ip": "192.168.0.108", "available": "0", "error": ""}],
  "items": [
    {"key_": "agent.ping", "lastvalue": "1"},
    {"key_": "system.cpu.util", "lastvalue": "34.246018"},
    {"key_": "vm.memory.util", "lastvalue": "80.8291829939"}
  ]
}
```

**Correção Aplicada (2 partes):**

1. **Mapeamento de disponibilidade** (`zabbix-bridge.js`):
```javascript
// ANTES (bugado):
if (iface.available === '1') disponiveis++;
else if (iface.available === '0') indisponiveis++;  // '0' = unknown, não unavailable!
else desconhecidos++;

// DEPOIS (corrigido):
if (iface.available === '1') disponiveis++;
else if (iface.available === '2') indisponiveis++;  // '2' = truly unavailable
else desconhecidos++;  // '0' = unknown
```

2. **Fallback por itens** (`zabbix-bridge.js` → `enriquecerDisponibilidade()`):
```javascript
// Para hosts sem agente passivo, consulta agent.ping/icmpping
if (ag.status === '0' && ag.state === '0' && ag.lastvalue === '1') avail = '1';
```

**Resultado:** TERM-COMPRAS10 agora mostra ✅ Conectado (5 disponíveis, 2 indisponíveis, 0 desconhecidos).

### 3.3 Problema Original: "Monitoramento mostra INDISP. para métricas Zabbix"

**Causa Raiz:**
O frontend (`monitor.js`) verificava `l.cpu && l.cpu !== 'INDISPONIVEL'`. Para hosts remotos, a API retornava strings como `"14.1% (Zabbix)"` que eram truthy e diferentes de 'INDISPONIVEL', então deveriam renderizar. Mas o código adicionava um badge "LOCAL" (verde) que era incorreto para dados do Zabbix.

**Correção Aplicada:**
```javascript
// Nova função que detecta fonte (Zabbix vs Local)
function _cellMetrica(val, titulo) {
    const fonte = _fonteMetrica(val);  // 'ZABBIX' ou 'LOCAL'
    if (!fonte) return '<span ...>INDISP.</span>';
    const corFonte = fonte === 'ZABBIX' ? 'var(--purple)' : 'var(--green)';
    const texto = String(val).replace(/\s*\(Zabbix\)\s*/g, '').trim();
    return '<span style="color:var(--cyan);font-weight:600;">' + esc(texto) + '</span>' +
           '<br><span style="font-size:9px;color:' + corFonte + ';">' + fonte + '</span>';
}
```

**Resultado:** TERM-COMPRAS10 agora exibe CPU 27%, RAM 73%, Disco 34.8% com badge roxo "ZABBIX".

---

## 4. Problemas Restantes (Pendências)

### 4.1 IPs não cadastrados nos 101 computadores
- **Status:** Nenhum dos 101 computadores tem `ipAddress` preenchido (todos `null`)
- **Impacto:** Monitoramento real só enxerga 2 hosts (MEU-PC + TERM-COMPRAS10)
- **Solução:** Preencher via CSV import ou API em lote

### 4.2 Zabbix Agent 2 não instalado nos PCs remotos
- **Status:** Apenas MEU-PC (servidor) e TERM-COMPRAS10 (agent ativo) têm métricas
- **Impacto:** Os outros 99 PCs do inventário não têm monitoramento real
- **Solução:** Instalar Zabbix Agent 2 em cada PC (script `instalar-agente.ps1` disponível)

### 4.3 Tokens compartilhados no chat
- **Status:** 2 tokens expostos (classic sem escopo + fine-grained sem acesso)
- **Solução:** Revogar em https://github.com/Sjr-ts/settings/tokens

---

## 5. Verificação Final

### 5.1 Servidor
- **Processo:** PID 15356 (detached, 63 MB)
- **Health:** `{"status":"UP"}`
- **Porta:** 192.168.0.186:5903

### 5.2 Endpoints (todos OK)
| Endpoint | Resultado |
|----------|-----------|
| `/api/computadores/estatisticas` | 101 total, 101 ativos |
| `/api/ramais` | 97 |
| `/api/manutencoes/estatisticas` | 10 (1 pend, 1 andamento, 7 concl, 1 canc) |
| `/api/ordens-servico/estatisticas` | 8 (2 aberta, 3 exec, 2 concl, 1 análise) |
| `/api/trocas` | 4 |
| `/api/logs` | 486 |
| `/api/computadores/paginado` | 101 total, 21 páginas |
| `/api/monitor/painel` | 2 hosts, SSE ativo |
| `/api/monitor/sistema` | CPU real, RAM, Disco, GPU, Uptime |
| `/api/zabbix/resumo` | Conectado, 7 hosts, 5 disp, 2 indispon, 0 desc |
| `/api/zabbix/hosts` | 7 hosts com disponibilidade enriquecida |

### 5.3 Zabbix
- **API:** v7.0.31
- **Hosts:** 7 (5 conectados, 2 sem agent)
- **Problemas:** 4 (todos severidade "average", 0 críticos)
- **fping:** `/usr/sbin/fping` (existe e configurado)
- **ICMP pingers:** 5 processos ativos

### 5.4 GitHub
- **Repositório:** https://github.com/Sjr-ts/Teste-de-rede
- **Commit:** `0f50c16` (sincronizado)
- **Arquivos:** 55 (6.05 MB)
- **Dados incluídos:** data.json (777 KB), api-data-dump.json (711 KB), uploads/

---

## 6. Conclusões

### Problemas Resolvidos Definitivamente
1. ✅ **CPU errada** — causa: `%` interpretado pelo cmd.exe. Correção: `execFile` sem shell.
2. ✅ **IP não capturado (TERM-COMPRAS10)** — causa: agent ativo não atualiza interface passiva. Correção: fallback por agent.ping/icmpping.
3. ✅ **Disponibilidade incorreta (0=unknown vs 2=unavailable)** — causa: mapeamento invertido. Correção: '0'→desconhecidos, '2'→indisponíveis.
4. ✅ **Frontend mostra INDISP. para métricas Zabbix** — causa: badge "LOCAL" incorreto. Correção: badge "ZABBIX"/"LOCAL" dinâmico.
5. ✅ **Servidor cai entre comandos** — causa: background shell timeout. Correção: processo detached.
6. ✅ **Endpoints REST inexistentes** — causa: frontend chamava endpoints que não existiam. Correção: 8 endpoints adicionados ao server.cjs.
7. ✅ **Zabbix desconectado** — causa: Docker Desktop parado. Correção: Docker iniciado + config habilitada.

### Problemas Pendentes (requerem ação do usuário)
1. ⚠️ IPs nos 101 computadores (decisão de dados)
2. ⚠️ Instalação de Zabbix Agent 2 nos PCs remotos
3. ⚠️ Revogação de tokens expostos

---

## 7. Scripts de Suporte

| Script | Descrição | Uso |
|--------|-----------|-----|
| `iniciar-servidor.ps1` | Inicia servidor de forma estável | `powershell -File iniciar-servidor.ps1` |
| `enviar-github.ps1` | Envia atualizações para GitHub | `powershell -File enviar-github.ps1 -msg "msg"` |
| `zabbix-deploy/instalar-agente.ps1` | Instala Zabbix Agent 2 | Executar em cada PC |

---

**Relatório gerado em:** 29/10/2026  
**Commit de referência:** `0f50c16`  
**Repositório:** https://github.com/Sjr-ts/Teste-de-rede