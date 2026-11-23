# Instalação em 1 clique — Zabbix Agent + IP adaptativo

Esta pasta contém o instalador único para os computadores Windows monitorados.

## Arquivos

| Arquivo | O que faz |
|---------|-----------|
| `instalar-tudo.bat` | Instalador principal (você executa **uma vez**) |
| `instalar-silencioso.vbs` | Executa o bat sem janela (usado pela tarefa agendada no boot) |

## Como abrir o painel (SEM digitar IP — o servidor muda por DHCP)

Na Área de Trabalho foram criados **2 atalhos**:

- **INVENTARIO TI - Abrir Painel** → abre `http://<IP-ATUAL>:5903`
- **ZABBIX - Abrir Painel** → abre `http://<IP-ATUAL>:8081`

Eles detectam o IP do servidor automaticamente (testam `127.0.0.1` e a interface LAN real, ignorando WSL/virtual). **Não use mais os IPs antigos `192.168.0.102` ou `192.168.0.186`** — eles mudaram e dão `ERR_CONNECTION_TIMED_OUT`. O IP atual desta máquina é detectado no boot.

Se precisar recriar os atalhos: execute `CRIAR-ATALHOS.ps1` (botão direito → Executar com PowerShell).

## Como usar (usuário final, sem conhecimento técnico)

1. Copie **esta pasta inteira** para o computador.
2. Clique com o **botão direito** em `instalar-tudo.bat`.
3. Escolha **"Executar como administrador"**.
4. Aguarde (~30 segundos). O painel do Inventário TI abrirá sozinho no navegador.

**Não é preciso:** baixar nada, editar arquivos, saber senhas ou configurar qualquer coisa. O instalador baixa o MSI oficial do Zabbix (17,6 MB) da CDN se ele ainda não estiver na pasta.

## IP do servidor (detecção automática)

O instalador **detecta sozinho** o IP da interface LAN real (ignora vEthernet/WSL/Hyper-V/APIPA), então funciona mesmo se o servidor trocou de IP por DHCP. Se quiser fixar manualmente, crie um arquivo `server-ip.txt` ao lado do `.bat` contendo só o IP (ex.: `192.168.0.102`).

## O que o instalador faz automaticamente

- Verifica privilégios de administrador.
- Baixa o MSI oficial do Zabbix Agent 2 7.0.31 se necessário (CDN: `cdn.zabbix.com`).
- Instala/atualiza o agente apontando para o servidor `192.168.0.102`.
- Grava uma configuração **válida para o Agent 2 no Windows** (sem `PidFile`, que é inválido e impede o serviço de subir):
  - `Server` / `ServerActive` = IP detectado automaticamente
  - `Hostname` = nome do computador (automático)
  - `HostMetadataItem=inv.meta` + `UnsafeUserParameters=1` (IP adaptativo)
  - `UserParameter=inv.meta` aponta para um script PowerShell que detecta o **IP real** da interface (ignora IP virtual/APIPA)
  - **Não** grava `HostMetadata` estático (isso anularia o IP adaptativo)
- Cria tarefas agendadas para execução **silenciosa no boot e no logon** (`ZabbixAgent-SilentInstall` / `ZabbixAgent-SilentLogon`).
- Inicia o serviço `Zabbix Agent 2`.
- Registra tudo em `%TEMP%\zabbix-install.log`.

## IP adaptativo (o que o usuário não precisa saber)

Quando o IP do PC muda (DHCP), o script `inv.meta` retorna um metadata novo (`inventario-ti <novo-ip>`). Isso faz o agente **re-registrar sozinho no Zabbix em menos de 20 segundos, sem reiniciar**. O servidor Zabbix atualiza a interface do host e o Inventário TI lê esse IP de volta para o cadastro (job a cada 5 min). O monitoramento continua sem perder histórico.

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

**Opção B (sem senha):** copie a pasta `execução bat` inteira pro PC .108 (pen drive/rede) e rode `instalar-tudo.bat` como Administrador **naquele PC**.

Depois confirme com:
```powershell
.\verificar-agente.ps1 -Computador 192.168.0.108
```
O resultado deve virar `>>> AGENTE CONECTADO — OK!` e o Zabbix `available: 1`.

## Credenciais (já embutidas no instalador)

| Sistema | Endereço | Usuário | Senha |
|---------|----------|---------|-------|
| Inventário TI | `http://192.168.0.102:5903` | `admin` | `admin123` |
| Zabbix | `http://192.168.0.102:8081` | `Admin` | `Monitor2026!` |

## Execução silenciosa

A tarefa agendada roda o `instalar-silencioso.vbs`, que chama o bat com `/silent` e janela oculta (`SW_HIDE`). Não aparece nada para o usuário. Se precisar executar manualmente em modo silencioso:

```
instalar-tudo.bat /silent
```

## Verificação (admin)

```powershell
schtasks /query /tn "ZabbixAgent-SilentInstall"
type "%TEMP%\zabbix-install.log"
```
