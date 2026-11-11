# Inventário de TI

Sistema interno de **Inventário de TI + Monitoramento integrado com Zabbix** para
uma operação de ~100 equipamentos (PCs, servidores e rede), com métricas em
tempo real da máquina local, disponibilidade ICMP da rede, problemas ativos do
Zabbix e sincronização inteligente do inventário.

> Estado atual: produção interna em `http://192.168.0.186:5903/`
> (acesso pela rede do escritório).

## O que ele faz

- **Inventário de computadores**: cadastro completo (PC, usuário, setor, hardware,
  SO, ciclo de vida, O.S., manutenções, software, ramais) com histórico e logs.
- **Monitoramento de rede (ICMP)**: disponibilidade, latência, perda %, falhas
  consecutivas, incidentes por setor, correlação e diagnósticos.
- **Métricas REAIS do PC local** (onde o servidor roda): CPU (inclusive CPUs
  híbridas, via o mesmo contador do Gerenciador de Tarefas), GPU, RAM, disco e
  uptime — em tempo real (SSE), sem refresh.
- **Zabbix integrado**:
  - painel "Problemas" com ACK/supressão, filtros estilo *problem view*;
  - **sincronização inteligente** inventário → Zabbix (smart update, cria host
    só com IP; nunca inventa dado);
  - manutenções → janelas no Zabbix (idempotente);
  - dashboard "Inventário TI" (problemas, severidade, disponibilidade, link ao painel);
  - Webhook ação → alerta em tempo real no painel (action 7, mediatype 72);
  - acesso simplificado para o dia a dia (role "Inventário TI — Operador").

## Arquitetura

```
 Navegador do técnico
        │  HTTPS/HTTP  (rede local)
        ▼
  server.cjs  ────────────────────────────────┐
   ├─ REST/SSE (/api/monitor/*, /api/zabbix/*) │   data.json (inventário)
   ├─ monitor/  (ICMP + métricas locais)      │   monitor/data/ (telemetria)
   │    ├─ pinger.js       ping real ICMP      │
   │    ├─ hostmetrics.js  CPU/GPU/RAM/disco   │
   │    ├─ tempo-real.js   amostrador 1x/s     │
   │    ├─ zabbix-bridge.js sync + API Zabbix  │
   │    └─ service.js      orquestração/estado │
   └─ frontend/ (SPA único, vanilla JS)        │
                                               ▼
                            Docker: zbx-server / zbx-web / zbx-postgres / zbx-agent
```

Sem build de frontend, sem framework: um único `index.html` + JS vanilla com
renderização diferencial (anti-travamento) e SSE (Server-Sent Events).

## Requisitos

- **Windows 10/11** (coleta local usa `os` + PowerShell para disco/GPU)
- **Node.js ≥ 18** e npm
- **Docker Desktop** (para o Zabbix 7.0 local: `docker compose -f docker-compose.zabbix.yml up -d`)

## Instalação rápida

```powershell
git clone https://github.com/Sjr-ts/Teste-de-rede.git
cd Teste-de-rede
npm install

# 1) Configs locais (fora do git — copie os exemplos e preencha)
Copy-Item monitor\config.example.json         monitor\config.json
Copy-Item monitor\zabbix-config.example.json  monitor\zabbix-config.json
#    edite URL/usuário/senha do Zabbix

# 2) (Opcional) stack Zabbix local
& "C:\Program Files\Docker\Docker\resources\bin\docker.exe" compose -f docker-compose.zabbix.yml up -d

# 3) Inicie
node server.cjs        # ou clique em iniciar-servidor.cmd
```

Abrir: `http://localhost:5903/index.html` (ou `http://192.168.0.186:5903/index.html` na rede).

## Scripts

| Comando     | Descrição                                        |
|-------------|---------------------------------------------------|
| `npm start` | Inicia o servidor (porta 5903)                     |
| `npm test`  | Roda os testes (node:test)                         |
| `scripts\enviar-github.ps1` | Publica no GitHub (com confirmação; usa `gh auth`) |
| `scripts\criar-usuario.cjs` | Cria usuário do painel (ex.: `node scripts\criar-usuario.cjs ti.admin SenhaForte123 ADMIN "Ana"` ) |
| `scripts\criar-token.cjs`   | Cria token de API para automação/agentes           |

## Estrutura

```
server.cjs              Express: REST + SSE + proxy Zabbix (enriquecimento)
frontend/               SPA (index.html, css, js) — sem build
monitor/                Coletor: ICMP, métricas locais, Zabbix bridge, estado
  data/                 Telemetria LOCAL (não versionada; targets.json e seed ficam)
docs/                   Documentação técnica (Zabbix, métricas em tempo real)
  arquivo/              Relatórios antigos de correção (histórico)
  apresentacao/         Slides e gerador da apresentação
scripts/                Utilitários (publicação no GitHub)
zabbix-deploy/          Instalação do agente (PC remoto) e PSK de exemplo
test/                   Testes (node:test)
```

## Segurança

- **Login real no servidor** (scrypt + sessão em cookie **HttpOnly** assinado,
  8 h de validade). Não existe cadastro público: contas são criadas por um
  administrador (tela `registro.html`, restrita a ADMIN) ou pelo script
  `scripts\criar-usuario.cjs`. As senhas ficam em `monitor/users.json` (fora do git).
- **Tokens de automação** (para agentes/scripts como este): header
  `Authorization: Bearer agt_...` — criados com `scripts\criar-token.cjs`,
  gravados em `monitor/api-tokens.json` (fora do git). **Revogação**: apague a
  entrada no arquivo (ou o arquivo inteiro).
- **Webhook do Zabbix autenticado**: o endpoint `/api/zabbix/webhook` exige o
  header `X-Webhook-Token` (segredo em `monitor/webhook-secret.json`, fora do
  git; já configurado no media type 72 do Zabbix). Sem o token → 401.
- **Credenciais nunca são commitadas** (`monitor/config.json`, `zabbix-config.json`,
  `users.json`, `auth-secret.json`, `webhook-secret.json`, `api-tokens.json`,
  chaves PSK) — veja `.gitignore`.
- Acesso diário ao Zabbix: a conta **`Admin`** (usada de fato) tem **menu enxuto**
  (só Dashboards, Problems, Hosts, Latest data, Maps, Inventory e Availability
  report — 36 itens administrativos ocultos) e cai direto no dashboard
  "Inventario TI"; a role built-in foi ajustada via `scripts/zabbix-setup-diario.cjs --menu`.
  A conta **`inventario`** (senha em `monitor/zabbix-inventario.txt`) também
  segue restrita para quem preferir.
- Headers de resposta: `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, sem `X-Powered-By`; respostas em gzip; vendor com cache
  imutável. **O app roda 100% offline** (libs/fontes locais em `frontend/vendor/`).
- Acesso externo ao app é somente leitura/operacional da rede local; não exponha
  a porta 5903 na internet.

## Documentação

- `docs/ZABBIX_INTEGRACAO.md` — arquitetura da integração, sync, dashboard, dados
- `docs/METRICAS_TEMPO_REAL.md` — CPU/GPU tempo real, diagnóstico do contador
  (% Processor Utility) e amostrador persistente
- `docs/RELATORIO_ESTUDO.md` — estudo comparativo e lições aprendidas

## Licença

Uso interno — Todos os direitos reservados. Repositório privado.
