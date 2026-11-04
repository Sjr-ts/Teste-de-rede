# Zabbix × Inventário TI — Integração completa (estado 2026-11-03)

Este documento descreve como o Zabbix 7.0 (LTS) neste servidor está configurado,
o que foi corrigido em 03/11/2026 e como operar/restaurar o ambiente.

## Arquitetura

```
 ┌────────────────────────┐        10051/TCP (agente ativo)
 │ TERM-COMPRAS10         │ ─────────────────────────┐
 │ (agente Zabbix 2)      │                          │
 └────────────────────────┘                          ▼
                                        ┌─────────────────────────┐
 192.168.0.108 / 10.0.0.169 ◄─ ICMP ──► │ Docker Desktop (este PC)│
                                        │  ┌──────────────────┐   │
 ┌────────────────────────┐              │  │ zbx-server       │   │
 │ Inventário TI (Node)   │── loopback ─►│  │  (Zabbix 7.0 LTS) │   │
 │ :5903  (este servidor) │  8081/TCP    │  ├──────────────────┤   │
 └────────────────────────┘              │  │ zbx-web          │   │
                                        │  │  nginx+php :8081 │   │
                                        ├──────────────────┤
                                        │ zbx-postgres     │
                                        │ postgres:16      │
                                        ├──────────────────┤
                                        │ zbx-agent-local  │
                                        │ agent2 → host "servidor-monitoramento" │
                                        └──────────────────┘
```

- **Web Zabbix**: `http://<IP-desta-maquina>:8081` (porta mapeada direto no Docker)
- **API JSON-RPC**: `http://127.0.0.1:8081/api_jsonrpc.php` (o back-end usa loopback — imune a mudança de IP/rede)
- **Inventário TI**: `http://<IP-desta-maquina>:5903`
- **Stack**: `docker-compose.zabbix.yml` (postgres 16 + server-pgsql + web-nginx-pgsql + agent2)
- **Credenciais API**: `monitor/zabbix-config.json` e `monitor/config.json`
  ⚠️ **Estão versionados no git e contêm a senha admin do Zabbix.** Mova para
  variáveis de ambiente e remova do histórico quando possível.

## O que foi corrigido em 03/11/2026

### 1. Problema de rede (causa de tudo)
A máquina servidor **mudou de `192.168.0.186` (rede 192.168.0.0/24) para o Wi-Fi
"BA - CPD" (`10.0.0.169`, gateway 10.0.0.1)**. Não há rota para 192.168.0.0/24,
logo TERM-COMPRAS10 (192.168.0.108), MEU_PC (192.168.0.186) e pc-131 ficaram
inalcançáveis. A rede é **temporária** — quando voltar:

- TERM-COMPRAS10 e MEU_PC voltam a reportar automaticamente (agente ativo reconecta);
- Os alertas de "ICMP Ping: Unavailable" e "Active checks are not available" se auto-resolvem;
- Nenhuma ação manual necessária.

### 2. Auto-monitoramento estabilizado
- **Targets**: `monitor/data/targets.json` — MEU-PC agora monitora `127.0.0.1`
  (nunca quebra com mudança de rede; backup em `targets.json.bak-2026-11-03`).
- **Backend → Zabbix**: todos os `192.168.0.186:8081` viraram `127.0.0.1:8081`.
- **Frontend**: links "Abrir no Zabbix" agora usam `window.location.hostname:8081`
  (funciona de qualquer endereço: localhost, 10.0.0.169, 192.168.0.x).
- **Host `servidor-monitoramento` (ID 10689) criado** com template
  "Linux by Zabbix agent" — resolve o log "cannot process heartbeat ... host not found"
  a cada 3 min e passa a coletar CPU/RAM/Disco/Uptime do servidor Docker.

### 3. Dados falsos eliminados do Zabbix → Inventário
- **Bug**: `dadosCompletosZabbix()` nunca enviava `lastclock`; o Inventário tratava
  dados de dias/semanas como "frescos" e mostrava `CPU 0% (Zabbix)`, `RAM 100% livre`,
  `uptime 0d` no PC local.
- **Correção**: `_lastclock` agora propaga o último `lastclock` usado; itens com
  mais de **5 minutos** são ignorados pelo Inventário (o PC local usa as métricas
  locais como canônicas — nunca mais sobrescritas pelo Zabbix).
- **Bug**: `zabbix[host,active_agent,available]` era lido errado (`0` tratado como
  "indisponível", `2` ignorado). Agora: `1`=disponível, `2`=indisponível,
  `0`=desconhecido, sempre com gate de frescor. Mesma correção em
  `enriquecerDisponibilidade` e `resumoMonitoramento`.

### 4. Ruído GoogleUpdater eliminado (TERM-COMPRAS10)
- Sintoma: 2 triggers "GoogleUpdaterService157... is not running (startup type
  automatic)" — serviços Google sob demanda que ficam parados por design.
- Causa: regra "Windows services discovery" **herdada de um template inexistente
  (templateid 42545)** → não pode ser editada no host (`readonly parameter
  "overrides" of inherited object`).
- **Correção aplicada** (segura, apenas neste host):
  - Itens `51018`/`51019` **desabilitados** (sem coleta → sem alerta);
  - Triggers `25378`/`25379` **desabilitados**;
  - Problemas abertos `100`/`101` **reconhecidos + suprimidos indefinidamente**
    (mensagem registrada; histórico preservado).
- O ruído não volta. Se a máquina for para outro host, repetir: item.update
  status=1 + trigger.update status=1 + ack/suppress.

### 5. Hosts mortos desativados (a pedido do usuário — "não deletar")
- `pc-131` (192.168.0.131, ID 10683) — agente nunca instalado; inalcançável há 13+ dias.
- `Zabbix server` (127.0.0.1, ID 10084) — host da imagem Docker sem agente.
- Ambos com `status=1` (not monitored). **Problemas `30` e `23` suprimidos**
  com mensagem registrada. Hosts somem das listagens (`host.get` filtra `status=0`).
- Para reativar: Configuration → Hosts → enable (ou API `host.update {status:0}`).

### 6. Diagnósticos de rede abertos (honestamente reportados)
- `102` ICMP Ping: Unavailable (Alto) — TERM-COMPRAS10
- `105` Windows: Active checks are not available (Alto) — TERM-COMPRAS10
- `112` Zabbix server: More than 100 items have been missing data for 10+ min (Aviso)
- `113` Windows: Zabbix agent is not available (Medio) — TERM-COMPRAS10
- Todos são consequência da perda de rota e **se auto-resolvem com o retorno da rede**.

## Por que "MEU PC (este computador)" aparecia como ICMP unavailable
O host `MEU_PC__este_computador_` (ID 10684) tem interface em `192.168.0.186` —
o ICMP do Zabbix o testa de dentro do Docker. Sem rota para 192.168.0.0/24 →
inalcançável. Quando a rede for restaurada, voltará automaticamente.

## Procedimentos

### Restaurar o ambiente após a rede voltar
1. Reconectar a rede da máquina à faixa 192.168.0.0/24 (Wi-Fi "BA - CPD"
   com o DHCP antigo, ou cabo).
2. Nada mais é necessário: o Zabbix reconecta sozinho (agente ativo a cada 60s)
   e o Inventário reflete em ≤60s (ciclo do coletor).
3. Se a faixa de IP mudar de forma definitiva, atualizar:
   - `monitor/data/targets.json` (alvo de auto-monitoramento — pode ficar 127.0.0.1 para sempre)
   - `monitor/zabbix-config.json` / `monitor/config.json` (já estão em 127.0.0.1)
   - Hosts do Zabbix (`Configuration → Hosts`) para os novos IPs

### Reconhecer/suprimir um problema (via Inventário TI)
No painel **Monitoramento → Problemas Zabbix (Abertos)**, cada problema tem:
- **Reconhecer** — `event.acknowledge` (action 6: ack + mensagem)
- **Silenciar** — mesmo fluxo (o painel usa action 38 para o relatório, ou
  o botão Reconhecer com mensagem)
- **Abrir no Zabbix** — `zabbix.php?action=problem.view&hostids[]=<id>`
- **Abrir O.S.** — cria Ordem de Serviço pré-preenchida com diagnóstico
- **Relatório de Falhas** — documento profissional (impressão/PDF) com sumário
  executivo, severidade e plano de ação por incidente

### Desabilitar um host morto (sem deletar)
```powershell
# 1) Descobrir o hostid
# 2) Desabilitar (not monitored)
$body = '{"jsonrpc":"2.0","method":"host.update","params":{"hostids":["<id>"],"status":1},"id":1,"auth":"<token>"}'

# 3) Suprimir os problemas abertos do host (opcional)
#    event.acknowledge {"eventids":[".."],"action":38,"message":"...","suppress_until":0}
```
Para reativar: `status: 0`.

### Host "servidor-monitoramento" (novo, ID 10689)
- Coleta via passivo (`Linux by Zabbix agent`) — sem depender da faixa de IP.
- Dados aparecem em ~5 min da criação. Itens visíveis em Monitoring → Latest data.
- Se nunca aparecer dado: verificar `docker logs zbx-agent-local` (deve mostrar
  heartbeats sem "host not found").

## Credenciais e segurança
- `monitor/zabbix-config.json` e `monitor/config.json` contêm **senha admin do
  Zabbix em texto claro e estão no histórico do git**.
- Recomendação: rotacionar a senha do Admin, mover para variáveis de ambiente
  (`ZBX_DB_PASS`, `ZBX_API_USER`, `ZBX_API_PASS`) e remover os arquivos do git
  (com reescrita de histórico ou `git rm --cached` + novo commit).
- O repositório é privado, mas a senha vazou para quem tem acesso ao clone.
- `monitor/data/*` (state.json, raw, agg) muda a cada ciclo e é commitado por
  hábito — mova para fora do git quando possível.

## Estado final (2026-11-03 ~12h)
- Zabbix: **operacional** (API loopback OK, Web OK).
- Hosts monitorados: 6 (TERM-COMPRAS10, MEU_PC, Gateway, DNS_Google, Loopback,
  servidor-monitoramento). pc-131 e Zabbix server **desabilitados** por decisão.
- Problemas abertos reais: 4 (rede) + 0 de ruído.
- Métricas: sem valores falsos; stale >5 min = INDISPONIVEL.
- Auto-monitoramento do servidor: OK via 127.0.0.1.

## Sincronização inteligente Inventário ↔ Zabbix (2026-11-04)

Implementada em `monitor/zabbix-bridge.js` (estilo *netbox-zabbix-sync*), com
endpoints novos no `server.cjs`.

### Como funciona o vínculo host ↔ computador
Match nesta ordem de prioridade (nunca inventa dado):
1. tag `inventario_id` no host;
2. IP da interface do host;
3. nome normalizado (minúsculas, sem pontuação).

### Sync de hosts — `POST /api/zabbix/sincronizar`
- Lê `data.json` (computadores + ordens) no servidor.
- **Smart update**: só chama `host.update` quando há diferença real de inventário,
  tags ou `inventory_mode`; preserva tags/campos não gerenciados.
- Cria host (template *ICMP Ping*, grupo *Inventario TI*) só quando o registro
  **tem IP**; registros sem IP são reportados (`semIp`) — sem vínculo, sem criação.
- Inventário preenchido: `name, os, serialno_a, model, hardware, contact,
  location, software, notes, vendor, deployment_status, asset_tag (INV-<id>),
  date_hw_purchase, date_hw_install`. `inventory_mode` forçado para `0` (manual),
  porque `selectInventory` devolve `[]` quando está `-1`.
- Relata `semVinculo` (hosts monitorados sem tag `inventario_id`) — informativo.

### Sync de manutenções — `POST /api/zabbix/sincronizar-manutencoes`
- `proximaManutencao` futura do computador **vinculado** → janela one-time no dia;
- ordens abertas com `dataPrevisao` futura → janela no dia previsto;
- limpa janelas `InvTI` já vencidas (idempotente, sem lixo);
- sem vínculo → reporta `semVinculo` (nunca cria host fantasma).

### Dashboard — `POST /api/zabbix/dashboard` (garante) e `GET /api/zabbix/dashboard`
Dashboard **"Inventario TI"** (id 401) com 4 widgets, idempotente:
`problems` (ao vivo, grupo Inventario TI), `problemsbysv`, `hostavail` e
`url` apontando para o próprio painel (`urlPainel` enviado pelo request).

## Acesso simplificado (2026-11-04)

O menu lateral do Zabbix mostra ~40 itens administrativos — a maioria nunca
usada. Foi criada uma **role restrita para o dia a dia**, via API:

- **Role "Inventário TI — Operador"** (id 6, tipo Super admin — as permissões
  de host não mudam), com quase tudo **revogado**:
  - Ficam visíveis: **Dashboards** (o "Inventário TI" aparece lá), **Problems**,
    **Hosts**, **Latest data**, **Inventory** (Overview/Hosts) e **Availability
    report**.
  - Esconde: Maps, Discovery, Services/SLA, Data collection, Alerts, Users,
    Administration (Geral, Proxies, Housekeeping, Filas, Macros...) e tudo mais.
  - Ações permitidas: reconhecer/suprimir/fechar problemas e comentar — nada de
    editar dashboards, scripts, manutenção, SLA, severity ou API tokens.
  - `*.default_access = 0` (UI/API/ações/módulos): **upgrades futuros do Zabbix
    não reintroduzem itens novos** na conta do dia a dia.
  - **API totalmente desabilitada** (`api.access=0`) — a UI funciona normalmente;
    chamadas de API são recusadas (o painel usa a conta `Admin`, fora da role).
- **Usuário `inventario`** (userid 3, grupo *Zabbix administrators*) — login do
  dia a dia. Senha forte em **`monitor/zabbix-inventario.txt`** (fora do git).
- **`Admin` continua completo** para manutenção/integração — não foi alterado.
- Amostra **"Local network"** (map padrão vazio, id 1) foi removida.
- Verificado ao vivo: login OK; `dashboard.get`/`authentication.get`/`user.get`/
  `map.delete` via API → **negados**; Admin inalterado.

### Antes/depois
- Antes: Admin/zabbix com 40+ itens de menu (Administration, Alerts, Users,
  Filas, Housekeeping...).
- Agora: `inventario` vê só o essencial; `Admin` intacto para manutenção.

### Frontend
- Botão **Sincronizar** agora usa o sync completo e mostra relatório detalhado
  (criados/atualizados/inalterados/sem IP/sem vínculo + manutenções).
- Botão **Ver no Zabbix**: deep-link `host.view` dinâmico (`name`, `groupids[]=22`,
  `status=0`, `sort=name`) — sem IP fixo no código.
- Botão **Dashboard**: cria/atualiza e abre o dashboard no Zabbix.
- Linha de cada host ganhou ações: abrir host no Zabbix (`host.view`) e ver
  problemas (`problem.view` por `hostids[]`).

### Estado dos dados (2026-11-04)
- 101 computadores **sem IP** em `data.json` → `semIp: 101`, nenhum host criado.
- 2 hosts sem tag `inventario_id` → `semVinculo: 2` (informativo).
- Manutenções: `semVinculo: 101`, `ignoradas: 3` (sem host correspondente).
- Dashboard 401 atualizado com os 4 widgets.

## Integridade dos dados no detalhe do host (2026-11-04)
Correção pós-revisão profunda: dados do Zabbix nunca são exibidos como válidos
quando estão velhos.
- `buscarHostPorIp` prefere hosts **habilitados** (`status=0`); antes,
  `host/127.0.0.1` devolvia o "Zabbix server" (10084, desativado) pelo IP.
- Todo valor consultado passa pela checagem de `lastclock`:
  `lastclock=0` (item nunca coletou) ou **mais velho que 5 min** → `stale:true`,
  `valor:null`, `idadeSeg` medida. Nunca mais exibe `1970-01-01` nem 0% falso.
- O detalhe do host no painel mostra:
  - badge amarelo **"SEM DADOS RECENTES (há N min)"** para métricas antigas;
  - aviso **"Host DESATIVADO no Zabbix"** quando o host está com coleta parada.
- Verificado ao vivo: TERM-COMPRAS10 com agente sem dados há ~8 min →
  `stale:true`/`valor:null` (antes: 0% "válido"); MEU_PC/servidor-monitoramento
  com dados de há ~20s → valor real exibido.

