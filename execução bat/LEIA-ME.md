# Instalação em 1 clique — Zabbix Agent + IP adaptativo

Esta pasta contém o instalador único para os computadores Windows monitorados.

## 📌 ARQUIVO ÚNICO — é só dar 2 cliques

**`INSTALAR.cmd`** — duplo-clique nele e **não digita nada**:

1. **Auto-eleva a Administrador** (detecção confiável via `WindowsPrincipal` — sem `net session`, que é instável) → aparece o UAC "Sim"
2. **`INSTALAR.ps1`** assume o controle: cria o log **`instalar.log`** nesta pasta (nada falha em silêncio)
3. Baixa o MSI oficial do Zabbix da CDN e instala o agente (`SERVER=` do servidor detectado)
4. Grava a configuração + script de IP adaptativo e inicia o serviço
5. Cria atalhos na Área de Trabalho e tarefas agendadas (auto-heal boot + 5min)
6. Descobre o servidor na rede (127.0.0.1 + faixa 192.168.0.100-129)
7. Abre o Inventário TI **já logado** no navegador

> **Arquitetura:** `INSTALAR.cmd` (lançador fino) → `INSTALAR.ps1` (orquestrador com log + auto-elevação) → `instalar-tudo.bat /silent` (instala o agente). O VBS foi **abandonado** (erros de compilação `800A0405`/`800A01B6`).

Tudo que é preciso estar na pasta (ela inteira):

| Arquivo | O que faz |
|---------|-----------|
| **`INSTALAR.cmd`** | **← duplo-clique aqui, não digita nada** |
| `INSTALAR.ps1` | Orquestrador: auto-elevação, log `instalar.log`, descobre servidor, abre painel |
| `instalar-tudo.bat` | Instalador do agente (MSI + config + serviço) |
| `gravar-config.ps1` | Grava `zabbix_agent2.conf` + script `inv-meta.ps1` (IP adaptativo) |
| `detect-server.ps1` | Detecta o IP do servidor (server-ip.txt → scan PARALELO de toda a sub-rede → 127.0.0.1) |
| `auto-heal.ps1` | Mantém agente vivo (boot + a cada 5 min) |
| `CRIAR-ATALHOS.ps1` | Recria os atalhos na Área de Trabalho |
| `instalar-silencioso.vbs` | Janela oculta para a tarefa agendada no boot/logon |
| `instalar-remoto.ps1` | Instala em outro PC da rede (ex.: 192.168.0.108) |
| `verificar-agente.ps1` | Confirma se o agente de outro PC está conectado |

## Logs (onde ver o que aconteceu)

| Log | O que registra |
|-----|----------------|
| `instalar.log` (nesta pasta) | Tudo que o `INSTALAR.ps1` fez: elevação, servidor encontrado, painel aberto |
| `%TEMP%\zabbix-install.log` | Cada passo do `instalar-tudo.bat` (admin, MSI, config, serviço) |
| `%TEMP%\zabbix_msi.log` | Log verboso do Windows Installer (diagnóstico de falha de MSI) |

## Como abrir o painel (SEM digitar IP — o servidor muda por DHCP)

Na Área de Trabalho foram criados **2 atalhos**:

- **INVENTARIO TI - Abrir Painel** → abre `http://<IP-ATUAL>:5903`
- **ZABBIX - Abrir Painel** → abre `http://<IP-ATUAL>:8081`

Eles detectam o IP do servidor automaticamente (testam `server-ip.txt`, depois `127.0.0.1`, depois fazem um **scan paralelo de toda a sub-rede** na porta `5903` — 254 IPs ao mesmo tempo, resposta em ~2s). **Não use IPs antigos fixos** (`192.168.0.102`, `.186`) — mudaram e dão `ERR_CONNECTION_TIMED_OUT`.

Se precisar recriar os atalhos: execute `CRIAR-ATALHOS.ps1` (botão direito → Executar com PowerShell).

## Como usar (usuário final, sem conhecimento técnico)

1. Copie **esta pasta inteira** para o computador.
2. Clique em **`INSTALAR.cmd`** (duplo clique).
3. Clique **"Sim"** no UAC.
4. Aguarde (~30 segundos). O painel do Inventário TI abrirá sozinho no navegador.

**Não é preciso:** baixar nada, editar arquivos, saber senhas ou configurar qualquer coisa. O instalador baixa o MSI oficial do Zabbix (17,6 MB) da CDN se ele ainda não estiver na pasta.

## IP do servidor (detecção automática)

O instalador **detecta sozinho** o IP do servidor:

1. `server-ip.txt` (se existir ao lado do `.bat` — fixa o IP manualmente)
2. Servidor local: `127.0.0.1:5903` responde → esta máquina **é** o servidor
3. **Scan paralelo de toda a sub-rede** (254 IPs simultâneos na porta `5903`, espera global de 2s) e confirma com `/actuator/health` = 200 — só devolve IP que responde **UP**
4. Fallback: `127.0.0.1`

> **Por que paralelo:** a versão antiga testava a faixa `192.168.0.100-129` um IP por vez (timeout de 1s cada). Se o servidor estava fora da faixa (ex.: `.238`), o cliente apontava para `127.0.0.1` — o agente falava com ele mesmo e **nenhum dado chegava ao servidor**. Com o scan paralelo isso não acontece mais: qualquer IP da sub-rede é encontrado em ~2s.

Esse IP é passado ao MSI como **`SERVER=`** (exigido pelo `LaunchCondition` do instalador do Zabbix — sem ele o MSI falha com código **1603**) e gravado em `Server=`/`ServerActive=` do `zabbix_agent2.conf`.

## O que o instalador faz automaticamente

- Verifica privilégios de administrador (confiável, via `WindowsPrincipal`).
- Baixa o MSI oficial do Zabbix Agent 2 7.0.31 se necessário (CDN: `cdn.zabbix.com`).
- Instala o agente com `SERVER=<IP detectado>` (instalação silenciosa `/qn`).
- Grava uma configuração **válida para o Agent 2 no Windows** (sem `PidFile`, que é inválido e impede o serviço de subir):
  - `Server` / `ServerActive` = IP do servidor detectado
  - `Hostname` = nome do computador (automático)
  - `HostMetadataItem=inv.meta` + `UnsafeUserParameters=1` (IP adaptativo)
  - `UserParameter=inv.meta` aponta para um script PowerShell que detecta o **IP real** da interface (ignora IP virtual/APIPA)
  - **Não** grava `HostMetadata` estático (isso anularia o IP adaptativo)
- Cria tarefas agendadas para execução **silenciosa no boot e no logon** (`ZabbixAgent-SilentInstall` / `ZabbixAgent-SilentLogon`).
- Cria o **auto-heal** (`ZabbixAgent-AutoHeal-Boot` + `ZabbixAgent-AutoHeal-5min`).
- Inicia o serviço `Zabbix Agent 2`.
- Registra tudo em `%TEMP%\zabbix-install.log` e `instalar.log`.

## IP adaptativo (o que o usuário não precisa saber)

Quando o IP do PC muda (DHCP), o script `inv.meta` retorna um metadata novo (`inventario-ti <novo-ip>`). Isso faz o agente **re-registrar sozinho no Zabbix em menos de 20 segundos, sem reiniciar**. O servidor Zabbix atualiza a interface do host e o Inventário TI lê esse IP de volta para o cadastro (job a cada 5 min). O monitoramento continua sem perder histórico.

## Auto-registro no Zabbix (PC novo aparece com dados sozinho)

A ação **"Inventario TI - Auto-registro de agentes"** do Zabbix foi configurada para, quando um agente novo se registra, fazer **tudo automaticamente**:

1. **Adicionar o host** ao Zabbix
2. **Colocar no grupo** `Inventario TI`
3. **Vincular o template** `Windows by Zabbix agent active` (48 itens: CPU, RAM, disco, uptime, rede…) ← *esta etapa faltava; sem ela o PC novo chegava com 0 itens e nenhum dado*
4. **Marcar inventário automático** (`inventory_mode=0`)
5. **Tag** `inventario_origem=autoreg` (identifica veio do instalador)

Ou seja: **basta rodar `INSTALAR.cmd` no PC novo** — em até ~1 min o host aparece no Zabbix com template vinculado e começam a chegar dados reais. Nada de configurar à mão.

Para ver os hosts: painel do Inventário TI → seção **HOSTS ZABBIX** (lista todos, com status "Conectado/Sem Agente" e o template de cada um).

## Auto-heal (sobrevive a reboot, queda de rede e mudanca de IP)

O instalador cria 2 tarefas agendadas no PC:

- **ZabbixAgent-AutoHeal-Boot** — roda no boot do Windows
- **ZabbixAgent-AutoHeal-5min** — roda a cada 5 minutos

O `auto-heal.ps1` garante automaticamente que:

- O serviço **Zabbix Agent 2 está rodando** (reinicia se parou)
- O **metadata contém o IP atual** do PC (sobrevive a DHCP)
- O conf aponta para o **servidor certo** (se o IP do servidor mudou, corrige)
- Remove `HostMetadata` estático e `PidFile` inválido se aparecerem

Tudo é logado em `%TEMP%\zabbix-selfheal.log`. Ou seja: **o PC se re-registra sozinho no Zabbix** após qualquer reboot, queda de rede ou troca de IP — sem ninguém mexer.

## Situacao atual do TERM-COMPRAS10 (diagnostico 23/11/2026)

| Verificacao | Resultado |
|-------------|-----------|
| Ping (ICMP) | ✅ OK (RTT 0.7ms) |
| Porta 10050 (agente Zabbix) | ❌ FECHADA |
| Agente no Zabbix (`available`) | ❌ 0 = indisponível |
| Problema ativo no Zabbix | "Zabbix agent is not available" desde 11/11 |

**Ou seja: o PC responde ping, mas o AGENTE não está rodando nele.** O instalador está pronto e correto — falta **executá-lo no próprio PC .108** (acesso remoto foi negado sem credenciais admin).

### Como instalar no .108

**Opção A (recomendada — você tem a senha de admin do .108):**
```powershell
.\instalar-remoto.ps1 -Computador 192.168.0.108 -Usuario ADMIN -Senha "SENHA_DO_ADMIN"
```
Ele copia a pasta pro PC e dispara o instalador silenciosamente.

**Opção B (sem senha):** copie a pasta `execução bat` inteira pro PC .108 (pen drive/rede) e rode **`INSTALAR.cmd`** como Administrador **naquele PC**.

Depois confirme com:
```powershell
.\verificar-agente.ps1 -Computador 192.168.0.108
```
O resultado deve virar `>>> AGENTE CONECTADO — OK!` e o Zabbix `available: 1`.

## Credenciais (já embutidas no instalador)

| Sistema | Endereço | Usuário | Senha |
|---------|----------|---------|-------|
| Inventário TI | `http://<IP>:5903` | `admin` | `admin123` |
| Zabbix | `http://<IP>:8081` | `Admin` | `Monitor2026!` |

## Execução silenciosa

A tarefa agendada roda o `instalar-silencioso.vbs`, que chama o bat com `/silent` e janela oculta (`SW_HIDE`). Não aparece nada para o usuário. Se precisar executar manualmente em modo silencioso:

```
instalar-tudo.bat /silent
```

## Verificação (admin)

```powershell
schtasks /query /tn "ZabbixAgent-SilentInstall"
type "%TEMP%\zabbix-install.log"
type "instalar.log"
```
