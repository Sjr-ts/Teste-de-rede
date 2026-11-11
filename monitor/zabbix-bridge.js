'use strict';
/**
 * Bridge de integracao: Inventario de TI <-> Zabbix API
 * 
 * Este modulo permite que o Inventário consulte dados de monitoramento
 * do Zabbix sem acessar diretamente o banco de dados.
 * 
 * Configuracao: monitor/zabbix-config.json
 * Conta de API: criar no Zabbix com permissoes minimas (leitura de hosts, itens, historicos, triggers).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const CONFIG_FILE = path.join(__dirname, 'zabbix-config.json');

let configCache = null;
let requestCounter = 1;

function loadConfig() {
    if (configCache) return configCache;
    try {
        let raw = fs.readFileSync(CONFIG_FILE, 'utf8');
        if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
        configCache = JSON.parse(raw);
        return configCache;
    } catch (e) {
        return null;
    }
}

function saveConfig(cfg) {
    configCache = cfg;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

/**
 * Chamada generica a API JSON-RPC do Zabbix.
 */
function apiCall(method, params, auth) {
    const cfg = loadConfig();
    if (!cfg || !cfg.url) return Promise.reject(new Error('Zabbix nao configurado'));

    return new Promise((resolve, reject) => {
        let urlObj;
        try { urlObj = new URL(cfg.url); } catch (e) { return reject(new Error('URL invalida')); }

        const body = JSON.stringify({
            jsonrpc: '2.0',
            method,
            params: params || {},
            id: requestCounter++,
            auth: auth || undefined
        });

        const lib = urlObj.protocol === 'https:' ? https : http;
        const req = lib.request({
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json-rpc',
                'Content-Length': Buffer.byteLength(body)
            },
            timeout: 15000
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const j = JSON.parse(data);
                    if (j.error) return reject(new Error(`Zabbix API [${method}]: ${j.error.data || j.error.message}`));
                    resolve(j.result);
                } catch (e) { reject(new Error('Resposta Zabbix invalida')); }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout Zabbix API')); });
        req.write(body);
        req.end();
    });
}

// Sessao do Zabbix reutilizada (user.login a cada chamada era ~2x o custo da API).
// Expira em 55 min por seguranca; se o servidor recusar (sessao caiu), reloga 1x.
let _sessao = { token: null, ts: 0, cfgKey: null };
const SESSAO_TTL_MS = 55 * 60 * 1000;

async function obterToken(cfg) {
    const agora = Date.now();
    const chave = String(cfg.url || '') + '|' + String(cfg.usuario || '');
    if (_sessao.token && _sessao.cfgKey === chave && (agora - _sessao.ts) < SESSAO_TTL_MS) {
        return _sessao.token;
    }
    const token = await apiCall('user.login', {
        username: cfg.usuario,
        password: cfg.senha
    });
    _sessao = { token, ts: agora, cfgKey: chave };
    return token;
}

/** Chamada autenticada. */
async function authCall(method, params) {
    const cfg = loadConfig();
    if (!cfg) throw new Error('Zabbix nao configurado');

    if (cfg.apiToken) {
        // API token: envia no header Authorization
        return apiCallWithToken(method, params, cfg.apiToken);
    }
    if (!cfg.usuario || !cfg.senha) {
        throw new Error('Credenciais Zabbix nao configuradas');
    }

    const token = await obterToken(cfg);
    try {
        return await apiCall(method, params, token);
    } catch (e) {
        const msg = String(e && e.message || '');
        if (/not authorized|session|auten/i.test(msg)) {
            // Sessao caiu no servidor -> reloga uma vez e repete
            _sessao = { token: null, ts: 0, cfgKey: null };
            return apiCall(method, params, await obterToken(cfg));
        }
        throw e;
    }
}

function apiCallWithToken(method, params, token) {
    return new Promise((resolve, reject) => {
        const cfg = loadConfig();
        let urlObj;
        try { urlObj = new URL(cfg.url); } catch (e) { return reject(new Error('URL invalida')); }

        const body = JSON.stringify({
            jsonrpc: '2.0',
            method,
            params: params || {},
            id: requestCounter++
        });

        const lib = urlObj.protocol === 'https:' ? https : http;
        const req = lib.request({
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json-rpc',
                'Authorization': 'Bearer ' + token,
                'Content-Length': Buffer.byteLength(body)
            },
            timeout: 15000
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const j = JSON.parse(data);
                    if (j.error) return reject(new Error(`Zabbix API [${method}]: ${j.error.data || j.error.message}`));
                    resolve(j.result);
                } catch (e) { reject(new Error('Resposta Zabbix invalida')); }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.write(body);
        req.end();
    });
}

// ==================== OPERACOES DE CONSULTA ====================

/** Testa conexao e retorna versao. */
async function testarConexao() {
    try {
        const versao = await apiCall('apiinfo.version', {});
        return { ok: true, versao, url: loadConfig().url };
    } catch (e) {
        return { ok: false, erro: e.message };
    }
}

/** Lista todos os hosts do Zabbix (por padrao apenas monitorados, status=0). */
async function listarHosts(filtro) {
    const params = {
        output: ['hostid', 'host', 'name', 'status'],
        selectInterfaces: ['interfaceid', 'ip', 'type', 'available', 'error'],
        selectParentTemplates: ['name'],
        selectTags: 'extend',
        // Sem filtro explicito: retorna apenas hosts monitorados (status=0).
        // Hosts desabilitados somem de todas as visoes (painel, resumo, listas).
        filter: filtro || { status: '0' }
    };
    return authCall('host.get', params);
}

/**
 * Enriquece a lista de hosts com a disponibilidade REAL.
 * Para hosts cuja interface esta '0' (unknown — tipico de agentes ativos e hosts ICMP-only),
 * consulta os itens icmpping / agent.ping / zabbix[host,active_agent,available] e
 * sobrescreve interfaces[0].available com '1' (disponivel) ou '2' (indisponivel).
 * Usado pelo endpoint /api/zabbix/hosts para que o frontend nao mostre "Aguardando"
 * para hosts que estao respondendo.
 */
async function enriquecerDisponibilidade(hosts) {
    if (!Array.isArray(hosts) || !hosts.length) return hosts;
    // Hosts que precisam de enriquecimento (interface available != '1' e != '2')
    const aEnriquecer = hosts.filter(h => {
        const iface = h.interfaces && h.interfaces[0];
        return iface && (iface.available === '0' || iface.available === null || iface.available === undefined);
    });
    if (!aEnriquecer.length) return hosts;

    let itensPorHost = {};
    try {
        const allItems = await authCall('item.get', {
            output: ['itemid', 'hostid', 'key_', 'lastvalue', 'lastclock', 'state', 'status'],
            filter: { key_: ['icmpping', 'agent.ping', 'zabbix[host,active_agent,available]'] }
        });
        const agora = Date.now();
        for (const it of (allItems || [])) {
            // Ignora itens sem dados frescos (5 min) — lastvalue antigo nao e disponibilidade
            const lc = parseInt(it.lastclock, 10);
            if (!isNaN(lc) && (agora - lc * 1000) > 300000) continue;
            if (!itensPorHost[it.hostid]) itensPorHost[it.hostid] = {};
            const key = it.key_;
            if (key === 'zabbix[host,active_agent,available]' || key === 'agent.ping') {
                if (!itensPorHost[it.hostid].agent) itensPorHost[it.hostid].agent = it;
            } else if (key === 'icmpping') {
                if (!itensPorHost[it.hostid].icmp) itensPorHost[it.hostid].icmp = it;
            }
        }
    } catch (e) { return hosts; }

    for (const h of hosts) {
        const iface = h.interfaces && h.interfaces[0];
        if (!iface || (iface.available !== '0' && iface.available !== null && iface.available !== undefined)) continue;
        const info = itensPorHost[h.hostid];
        if (!info) continue;
        let avail = null;
        // Agente ativo primeiro
        const ag = info.agent;
        if (ag && ag.status === '0' && ag.state === '0' && ag.lastvalue != null && ag.lastvalue !== '') {
            const v = ag.lastvalue;
            if (v === '1' || v === '1.000000') avail = '1';
            else if (ag.key_ === 'agent.ping' && (v === '0' || v === '0.000000')) avail = '2';
            else if (ag.key_ === 'zabbix[host,active_agent,available]' && (v === '2' || v === '2.000000')) avail = '2';
            // active_agent value 0 = desconhecido -> ignora
        }
        // ICMP
        if (!avail) {
            const ic = info.icmp;
            if (ic && ic.status === '0' && ic.state === '0' && ic.lastvalue != null && ic.lastvalue !== '') {
                const v = ic.lastvalue;
                if (v === '1' || v === '1.000000') avail = '1';
                else if (v === '0' || v === '0.000000') avail = '2';
            }
        }
        if (avail) iface.available = avail;
    }
    return hosts;
}

/** Busca host por IP ou nome. */
async function buscarHostPorIp(ip) {
    const hosts = await authCall('host.get', {
        output: ['hostid', 'host', 'name', 'status'],
        selectInterfaces: ['ip', 'available', 'error']
    });
    const match = hosts.filter(h => h.interfaces && h.interfaces.some(i => i.ip === ip));
    // Prefere hosts HABILITADOS (status=0); se so houver desabilitados,
    // retorna o desabilitado e quem decide e o chamador (badge "desativado").
    return match.find(h => String(h.status) === '0') || match[0] || null;
}

/** Busca problemas (triggers em estado PROBLEM) de um host ou todos. */
async function listarProblemas(hostid) {
    const params = {
        output: 'extend',
        selectAcknowledges: 'extend',
        selectTags: 'extend',
        sortfield: ['eventid'],
        sortorder: 'DESC',
        limit: 50
    };
    if (hostid) params.hostids = [hostid];
    return authCall('problem.get', params);
}

const SEVERIDADE_LABELS = { '0': 'Nao classificada', '1': 'Informacao', '2': 'Aviso', '3': 'Medio', '4': 'Alto', '5': 'Desastre' };

/** Formata duracao em segundos para texto legivel (ex.: "237 dias, 4 horas"). */
function formatarDuracao(segundos) {
    let s = Math.max(0, Math.floor(segundos || 0));
    const dias = Math.floor(s / 86400); s %= 86400;
    const horas = Math.floor(s / 3600); s %= 3600;
    const minutos = Math.floor(s / 60);
    const partes = [];
    if (dias > 0) partes.push(dias + (dias === 1 ? ' dia' : ' dias'));
    if (horas > 0) partes.push(horas + (horas === 1 ? ' hora' : ' horas'));
    if (dias === 0 && minutos > 0) partes.push(minutos + (minutos === 1 ? ' minuto' : ' minutos'));
    if (!partes.length) partes.push('menos de 1 minuto');
    return partes.join(', ');
}

/**
 * Problemas abertos enriquecidos para o painel do Inventario TI.
 * O problem.get do Zabbix 7.0 NAO tem selectHosts; o host e resolvido pelo
 * objectid (triggerid) via trigger.get + selectHosts em uma unica chamada.
 */
async function listarProblemasDetalhado(hostid) {
    const raw = await listarProblemas(hostid);
    // Resolve triggerid -> host em lote
    const objectids = [...new Set((raw || []).map(function (p) { return p.objectid; }).filter(Boolean))];
    const hostPorTrigger = {};
    if (objectids.length) {
        try {
            const triggers = await authCall('trigger.get', {
                triggerids: objectids,
                output: ['triggerid'],
                selectHosts: ['hostid', 'host', 'name']
            });
            for (const t of (triggers || [])) {
                const h = (t.hosts && t.hosts[0]) || null;
                if (h) hostPorTrigger[t.triggerid] = h;
            }
        } catch (e) { /* sem host resolvido — segue com "Desconhecido" */ }
    }
    const agora = Date.now();
    return (raw || []).map(function (p) {
        const host = hostPorTrigger[p.objectid] || {};
        const clock = (parseInt(p.clock, 10) || 0) * 1000;
        const dur = clock ? Math.max(0, Math.round((agora - clock) / 1000)) : 0;
        const ackViaFlag = p.acknowledged === '1' || p.acknowledged === 1 || p.acknowledged === true;
        const ackViaMensagens = Array.isArray(p.acknowledges) && p.acknowledges.length > 0;
        return {
            eventid: String(p.eventid || ''),
            hostid: host.hostid || null,
            host: host.name || host.host || 'Desconhecido',
            hostTecnico: host.host || null,
            trigger: p.name || ('Problema no objeto ' + (p.objectid || '?')),
            objeto: p.object || null,
            objetoId: p.objectid || null,
            severidade: String(p.severity == null ? '0' : p.severity),
            severidadeLabel: SEVERIDADE_LABELS[String(p.severity == null ? '0' : p.severity)] || 'Desconhecida',
            inicio: clock ? new Date(clock).toISOString() : null,
            duracaoSegundos: dur,
            duracaoTexto: formatarDuracao(dur),
            reconhecido: ackViaFlag || ackViaMensagens,
            supresso: p.suppressed === '1' || p.suppressed === 1 || p.suppressed === true,
            suppressed: p.suppressed === '1' || p.suppressed === 1 || p.suppressed === true,
            opdata: p.opdata || '',
            tags: Array.isArray(p.tags) ? p.tags.map(function (t) { return { tag: t.tag, value: t.value }; }) : [],
            mensagensAck: Array.isArray(p.acknowledges) ? p.acknowledges.length : 0
        };
    });
}

/** Busca historico de um item especifico. */
async function historicoItem(itemids, time_from, time_till, limit) {
    return authCall('history.get', {
        itemids: Array.isArray(itemids) ? itemids : [itemids],
        time_from: time_from || undefined,
        time_till: time_till || undefined,
        output: 'extend',
        sortfield: 'clock',
        sortorder: 'ASC',
        limit: limit || 1000
    });
}

/** Busca itens de um host (para descobrir quais metricas estao disponiveis). */
async function listarItens(hostid) {
    return authCall('item.get', {
        hostids: [hostid],
        output: ['itemid', 'name', 'key_', 'value_type', 'units', 'delay'],
        selectTriggers: ['triggerid', 'description', 'priority', 'status']
    });
}

/** Busca triggers de um host. */
async function listarTriggers(hostid) {
    return authCall('trigger.get', {
        hostids: [hostid],
        output: ['triggerid', 'description', 'priority', 'status', 'state', 'value'],
        selectLastEvent: ['eventid', 'clock', 'severity'],
        sortfield: 'priority',
        sortorder: 'DESC'
    });
}

/** Busca metricas de CPU, RAM, disco para um host (itens comuns). */
async function obterMetricasHost(hostid) {
    const itens = await listarItens(hostid);
    
    const metricas = {
        cpu: null,
        memoria: null,
        gpu: null,
        disco: null,
        rede: null,
        uptime: null,
        disponibilidade: null,
        todos: itens.length
    };

    for (const item of itens) {
        const key = item.key_ || '';
        
        // CPU
        if (key === 'system.cpu.util' || key.includes('cpu.util')) {
            metricas.cpu = { itemid: item.itemid, nome: item.name, key };
        }
        
        // Memoria (pavailable OU vm.memory.util)
        if (key === 'vm.memory.size[pavailable]' || key === 'vm.memory.util') {
            metricas.memoria = { itemid: item.itemid, nome: item.name, key, unidade: item.units };
        }
        
        // GPU
        if (key.toLowerCase().includes('gpu')) {
            metricas.gpu = { itemid: item.itemid, nome: item.name, key, unidade: item.units };
        }
        
        // Disco (espaco livre)
        if ((key.includes('vfs.fs.size') || key.includes('vfs.fs.dependent.size')) && (key.includes('pfree') || key.includes('pused'))) {
            if (!metricas.disco) metricas.disco = [];
            metricas.disco.push({ itemid: item.itemid, nome: item.name, key, unidade: item.units });
        }
        
        // Rede (trafego)
        if (key.includes('net.if.in') || key.includes('net.if.out')) {
            if (!metricas.rede) metricas.rede = [];
            metricas.rede.push({ itemid: item.itemid, nome: item.name, key });
        }
        
        // Uptime
        if (key === 'system.uptime') {
            metricas.uptime = { itemid: item.itemid, nome: item.name, key };
        }
        
        // Disponibilidade (ICMP ou agent.ping)
        if (key === 'icmpping' || key === 'net.tcp.service[icmpping]' || key === 'agent.ping' || key === 'zabbix[host,active_agent,available]') {
            metricas.disponibilidade = { itemid: item.itemid, nome: item.name, key };
        }
    }

    return metricas;
}

/** Busca valores atuais (lastvalue) de itens especificos. */
async function ultimosValores(itemids) {
    return authCall('item.get', {
        itemids: Array.isArray(itemids) ? itemids : [itemids],
        output: ['itemid', 'name', 'key_', 'lastvalue', 'lastclock', 'units', 'state'],
        selectHosts: ['hostid', 'name']
    });
}

// ==================== OPERACOES DE ESCRITA (INTEGRACAO) ====================

/** Cria host no Zabbix (para sincronizar inventario). */
async function criarHost(dados) {
    return authCall('host.create', {
        host: dados.hostname,
        name: dados.nome || dados.hostname,
        groups: dados.grupos.map(g => ({ name: g })),
        templates: dados.templates.map(t => ({ name: t })),
        interfaces: [{
            type: 1, // agent
            main: 1,
            useip: 1,
            ip: dados.ip,
            dns: '',
            port: '10050'
        }],
        tags: (dados.tags || []).map(t => ({ tag: t.tag, value: t.value }))
    });
}

/** Adiciona tag a um host. */
async function adicionarTag(hostid, tag, value) {
    const host = await authCall('host.get', {
        hostids: [hostid],
        output: ['hostid'],
        selectTags: true
    });
    if (!host.length) throw new Error('Host nao encontrado');
    
    const tags = host[0].tags || [];
    tags.push({ tag, value });
    
    return authCall('host.update', {
        hostid,
        tags
    });
}

/**
 * Reconhece um problema (acknowledge) conforme doc oficial Zabbix 7.0:
 * event.acknowledge exige `eventids` (ID/array) e `action` (bitmask).
 * action=6 = 2 (acknowledge event) + 4 (add message); message e obrigatoria.
 */
async function reconhecerProblema(eventid, mensagem) {
    if (!eventid) throw new Error('eventid obrigatorio');
    return authCall('event.acknowledge', {
        eventids: [String(eventid)],
        action: 6, // 2=acknowledge + 4=add message
        message: mensagem || 'Reconhecido via Inventario TI'
    });
}

// ==================== RELATORIOS E DASHBOARD ====================

/** Gera resumo do monitoramento para o dashboard do Inventário. */
async function resumoMonitoramento() {
    try {
        const hosts = await listarHosts();
        const problemas = await listarProblemas();
        
        const totalHosts = hosts.length;
        const hostsAtivos = hosts.filter(h => h.status === '0').length; // '0' = monitored
        const hostsInativos = totalHosts - hostsAtivos;
        
        // Conta hosts disponiveis vs indisponiveis.
        // Mapeamento correto da API Zabbix: '1'=available, '2'=unavailable, '0'=unknown (ainda nao determinado).
        // BUG anterior: tratava '0' (unknown) como indisponivel e ignorava '2' (unavailable real).
        // Para hosts sem agente passivo (interface available=0/unknown), a disponibilidade real vem de:
        //   - icmpping (hosts ICMP-only)
        //   - agent.ping (hosts com Zabbix Agent ativo)
        //   - zabbix[host,active_agent,available] (hosts com agente ativo)
        let itemPorHost = {};
        try {
            const allItems = await authCall('item.get', {
                output: ['itemid', 'hostid', 'key_', 'lastvalue', 'lastclock', 'state', 'status'],
                filter: { key_: ['icmpping', 'agent.ping', 'zabbix[host,active_agent,available]'] }
            });
            const agora = Date.now();
            for (const it of (allItems || [])) {
                // Ignora itens sem dados frescos (5 min)
                const lc = parseInt(it.lastclock, 10);
                if (!isNaN(lc) && (agora - lc * 1000) > 300000) continue;
                if (!itemPorHost[it.hostid]) itemPorHost[it.hostid] = {};
                // Prioridade: agent.ping/active_agent > icmpping
                const key = it.key_;
                if (key === 'zabbix[host,active_agent,available]' || key === 'agent.ping') {
                    itemPorHost[it.hostid].agent = it;
                } else if (key === 'icmpping') {
                    if (!itemPorHost[it.hostid].icmp) itemPorHost[it.hostid].icmp = it;
                }
            }
        } catch (e) { /* segue sem fallback */ }
        // Funcao para determinar disponibilidade a partir dos itens
        function disponibilidadePorItens(hostid) {
            const info = itemPorHost[hostid];
            if (!info) return null;
            // Tenta agent primeiro
            const ag = info.agent;
            if (ag && ag.status === '0' && ag.state === '0' && ag.lastvalue != null && ag.lastvalue !== '') {
                const v = ag.lastvalue;
                if (v === '1' || v === '1.000000') return '1';
                if (ag.key_ === 'agent.ping' && (v === '0' || v === '0.000000')) return '2';
                if (ag.key_ === 'zabbix[host,active_agent,available]' && (v === '2' || v === '2.000000')) return '2';
                // active_agent value 0 = desconhecido -> ignora
            }
            // ICMP
            const ic = info.icmp;
            if (ic && ic.status === '0' && ic.state === '0' && ic.lastvalue != null && ic.lastvalue !== '') {
                const v = ic.lastvalue;
                if (v === '1' || v === '1.000000') return '1';
                if (v === '0' || v === '0.000000') return '2';
            }
            return null;
        }
        let disponiveis = 0, indisponiveis = 0, desconhecidos = 0;
        for (const h of hosts) {
            if (h.interfaces && h.interfaces.length) {
                const iface = h.interfaces[0];
                let avail = iface.available;
                // Fallback para hosts sem agente passivo (interface available=0/unknown):
                // usa agent.ping / icmpping para determinar disponibilidade real
                if (avail === '0' || avail === null || avail === undefined) {
                    const fb = disponibilidadePorItens(h.hostid);
                    if (fb) avail = fb;
                }
                if (avail === '1') disponiveis++;
                else if (avail === '2') indisponiveis++;
                else desconhecidos++;
            } else {
                desconhecidos++;
            }
        }

        // Problemas por severidade
        const porSeveridade = { not_classified: 0, info: 0, warning: 0, average: 0, high: 0, disaster: 0 };
        for (const p of problemas) {
            const sev = p.severity || '0';
            if (sev === '0') porSeveridade.not_classified++;
            else if (sev === '1') porSeveridade.info++;
            else if (sev === '2') porSeveridade.warning++;
            else if (sev === '3') porSeveridade.average++;
            else if (sev === '4') porSeveridade.high++;
            else if (sev === '5') porSeveridade.disaster++;
        }

        return {
            conectado: true,
            zabbix: {
                totalHosts,
                hostsAtivos,
                hostsInativos,
                disponiveis,
                indisponiveis,
                desconhecidos
            },
            problemas: {
                total: problemas.length,
                porSeveridade,
                criticos: problemas.filter(p => ['4', '5'].includes(p.severity)).length
            },
            atualizadoEm: new Date().toISOString()
        };
    } catch (e) {
        return {
            conectado: false,
            erro: e.message,
            atualizadoEm: new Date().toISOString()
        };
    }
}

/** Gera dados de monitoramento para um host especifico do inventario. */
async function monitoramentoHost(ip) {
    try {
        const host = await buscarHostPorIp(ip);
        if (!host) {
            return { encontrado: false, ip, nota: 'Host nao encontrado no Zabbix. Verifique se o agente esta instalado e o host cadastrado.' };
        }

        const metricas = await obterMetricasHost(host.hostid);
        const problemas = await listarProblemas(host.hostid);
        const triggers = await listarTriggers(host.hostid);

        // Busca valores atuais das metricas principais
        const itemids = [];
        if (metricas.cpu) itemids.push(metricas.cpu.itemid);
        if (metricas.memoria) itemids.push(metricas.memoria.itemid);
        if (metricas.gpu) itemids.push(metricas.gpu.itemid);
        if (metricas.uptime) itemids.push(metricas.uptime.itemid);
        if (metricas.disponibilidade) itemids.push(metricas.disponibilidade.itemid);
        // Inclui agent.ping e active_agent para disponibilidade de agentes ativos
        const agentItems = (await listarItens(host.hostid)).filter(it =>
            it.key_ === 'agent.ping' || it.key_ === 'zabbix[host,active_agent,available]'
        );
        for (const ai of agentItems) itemids.push(ai.itemid);

        let valores = [];
        if (itemids.length) {
            valores = await ultimosValores(itemids);
        }

        const valoresMap = {};
        const agoraSeg = Math.floor(Date.now() / 1000);
        for (const v of valores) {
            const lastclock = parseInt(v.lastclock, 10) || 0;
            // lastclock=0 (item criado, nunca coletou) ou coleta mais velha
            // que 5 min -> SEM DADOS RECENTES (nunca exibir epoch 1970)
            const idadeSeg = lastclock > 0 ? agoraSeg - lastclock : null;
            const stale = idadeSeg == null || idadeSeg > 300;
            const horario = lastclock > 0 ? new Date(lastclock * 1000).toISOString() : null;
            valoresMap[v.key_] = {
                valor: stale ? null : v.lastvalue,
                horario,
                unidade: v.units,
                nome: v.name,
                stale,
                idadeSeg
            };
        }

        return {
            encontrado: true,
            ip,
            desativado: String(host.status) === '1',
            nota: String(host.status) === '1'
                ? 'Host DESATIVADO no Zabbix (decisao do usuario) — metricas antigas nao sao exibidas; dados frescos exigem reativar o host.'
                : undefined,
            host: {
                hostid: host.hostid,
                hostname: host.host,
                nome: host.name,
                status: String(host.status),
                disponivel: (function() {
                    const iface = host.interfaces && host.interfaces[0];
                    if (!iface) return null;
                    if (iface.available === '1') return true;
                    if (iface.available === '2') return false;
                    // Fallback para hosts sem agente passivo (available=0 unknown):
                    // 1) agente ativo: zabbix[host,active_agent,available] ou agent.ping
                    const vAgent = valoresMap && (valoresMap['zabbix[host,active_agent,available]'] || valoresMap['agent.ping']);
                    if (vAgent && vAgent.valor != null) {
                        const v = vAgent.valor && (vAgent.valor.valor != null ? vAgent.valor.valor : vAgent.valor);
                        if (v === '1' || v === '1.000000' || v === true) return true;
                        if (v === '0' || v === '0.000000' || v === false) return false;
                    }
                    // 2) ICMP
                    const ic = (metricas && metricas.disponibilidade && metricas.disponibilidade.valor);
                    if (ic && (ic.valor != null)) {
                        const v = ic.valor && (ic.valor.valor != null ? ic.valor.valor : ic.valor);
                        if (v === '1' || v === '1.000000' || v === true) return true;
                        if (v === '0' || v === '0.000000' || v === false) return false;
                    }
                    return null;
                })(),
                erroInterface: host.interfaces && host.interfaces[0] ? host.interfaces[0].error : null
            },
            metricas: {
                cpu: metricas.cpu ? { definicao: metricas.cpu, valor: valoresMap['system.cpu.util'] || null } : { indisponivel: 'CPU nao configurada no Zabbix' },
                memoria: metricas.memoria ? { definicao: metricas.memoria, valor: (metricas.memoria.key === 'vm.memory.util' ? valoresMap['vm.memory.util'] : valoresMap['vm.memory.size[pavailable]']) || null } : { indisponivel: 'Memoria nao configurada no Zabbix' },
                gpu: metricas.gpu ? { definicao: metricas.gpu, valor: valoresMap[metricas.gpu.key] || null } : { indisponivel: 'GPU nao configurada no Zabbix' },
                uptime: metricas.uptime ? { definicao: metricas.uptime, valor: valoresMap['system.uptime'] || null } : null,
                disco: metricas.disco || [],
                rede: metricas.rede || [],
                disponibilidade: metricas.disponibilidade ? { definicao: metricas.disponibilidade, valor: valoresMap['icmpping'] || valoresMap['agent.ping'] || null } : null
            },
            problemas: problemas.map(p => ({
                eventid: p.eventid,
                objeto: p.name || p.objectid,
                severidade: p.severity,
                horaInicio: new Date(parseInt(p.clock) * 1000).toISOString(),
                tags: p.tags
            })),
            triggers: triggers.map(t => ({
                triggerid: t.triggerid,
                descricao: t.description,
                prioridade: t.priority,
                estado: t.value, // '0' = OK, '1' = PROBLEM
                ultimoEvento: t.lastEvent ? { eventid: t.lastEvent.eventid, clock: t.lastEvent.clock } : null
            })),
            atualizadoEm: new Date().toISOString()
        };
    } catch (e) {
        return { encontrado: false, ip, erro: e.message };
    }
}

// ==================== CONFIGURACAO ====================

function getConfigStatus() {
    const cfg = loadConfig();
    if (!cfg) return { configurado: false };
    return {
        configurado: true,
        url: cfg.url,
        usuario: cfg.usuario ? '****' : null,
        usaApiToken: !!cfg.apiToken,
        usaPSK: !!cfg.usaPSK
    };
}

// ==================== SINCRONIZACAO INVENTARIO <-> ZABBIX (smart sync) ====================
// Inspirado em TheNetworkGuy/netbox-zabbix-sync: o Inventario de TI e a fonte da
// verdade; atualiza APENAS o que mudou (smart update), preserva tags nao gerenciadas
// e nunca apaga dados escritos manualmente no Zabbix.

/** Normaliza nome para comparacao (minusculas, sem espacos/simbolos). */
function normalizarNome(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Monta o objeto de inventario do Zabbix a partir de um registro do Inventario de TI.
 * Campos oficiais do host inventory (Zabbix 7.0): name, os, serialno_a, hardware,
 * software, contact, location, notes, model, vendor, deployment_status, asset_tag,
 * date_hw_purchase, date_hw_install... Só retorna campos com valor (nunca apaga).
 */
function montarInventario(comp) {
    const inv = {};
    if (comp.nomePc) inv.name = String(comp.nomePc).slice(0, 200);
    if (comp.sistemaOperacional) inv.os = String(comp.sistemaOperacional).slice(0, 200);
    if (comp.numeroSerie) inv.serialno_a = String(comp.numeroSerie).slice(0, 200);
    if (comp.modeloMarca) inv.model = String(comp.modeloMarca).slice(0, 200);
    const hw = [comp.processador, comp.memoriaRam, comp.armazenamento].filter(Boolean).join(' | ');
    if (hw) inv.hardware = String(hw).slice(0, 2000);
    if (comp.usuarioDesignado) inv.contact = String(comp.usuarioDesignado).slice(0, 200);
    const loc = [comp.departamento, comp.localizacao].filter(Boolean).join(' / ');
    if (loc) inv.location = String(loc).slice(0, 200);
    if (comp.softwareInstalado) inv.software = String(comp.softwareInstalado).slice(0, 2000);
    if (comp.notas) inv.notes = String(comp.notas).slice(0, 2000);
    if (comp.fornecedor) inv.vendor = String(comp.fornecedor).slice(0, 200);
    if (comp.status) inv.deployment_status = String(comp.status).slice(0, 200);
    if (comp.id) inv.asset_tag = 'INV-' + comp.id;
    const d = (v) => { const x = new Date(v); return isNaN(x) ? null : x.toISOString().slice(0, 10); };
    if (comp.dataAquisicao && d(comp.dataAquisicao)) inv.date_hw_purchase = d(comp.dataAquisicao);
    if (comp.dataInicioCiclo && d(comp.dataInicioCiclo)) inv.date_hw_install = d(comp.dataInicioCiclo);
    return inv;
}

/** Tags gerenciadas pelo sync (as demais sao preservadas como estiverem no Zabbix). */
function montarTagsGerenciadas(comp) {
    const tags = {};
    if (comp.id) tags['inventario_id'] = String(comp.id);
    const setor = comp.departamento || comp.setor;
    if (setor) tags['setor'] = String(setor).slice(0, 200);
    if (comp.usuarioDesignado) tags['usuario'] = String(comp.usuarioDesignado).slice(0, 200);
    return tags;
}

/**
 * Indexa os hosts do Zabbix para vinculo com o Inventario de TI.
 * Chaves de match (nesta ordem de prioridade): tag inventario_id, IP da interface, nome normalizado.
 */
async function indexarHostsParaVinculo() {
    const hosts = await authCall('host.get', {
        output: ['hostid', 'host', 'name', 'status', 'inventory_mode'],
        selectInterfaces: ['ip'],
        selectTags: 'extend',
        selectInventory: 'extend',
        filter: { status: '0' }
    });
    const porId = {}, porIp = {}, porNome = {};
    for (const h of hosts) {
        const tagId = (h.tags || []).find(t => t.tag === 'inventario_id' && t.value);
        if (tagId && !porId[tagId.value]) porId[tagId.value] = h;
        const ip = h.interfaces && h.interfaces[0] && h.interfaces[0].ip;
        if (ip && !porIp[ip]) porIp[ip] = h;
        const n = normalizarNome(h.name || h.host);
        if (n && !porNome[n]) porNome[n] = h;
    }
    return { hosts, porId, porIp, porNome };
}

/** Resolve o host Zabbix correspondente a um computador do Inventario de TI. */
function vincularHost(comp, idx) {
    if (comp.id && idx.porId[String(comp.id)]) return idx.porId[String(comp.id)];
    const ip = comp.ipAddress || comp.ip;
    if (ip && idx.porIp[ip]) return idx.porIp[ip];
    const n = normalizarNome(comp.nomePc || comp.nome);
    if (n && idx.porNome[n]) return idx.porNome[n];
    return null;
}

/**
 * Smart update: preenche inventario + tags do host no Zabbix SEMPRE que houver
 * diferenca real em relacao ao Inventario de TI. Preserva campos/tags nao
 * gerenciados. Retorna true se chamou host.update.
 */
async function atualizarHostDoInventario(host, comp) {
    const invDesejado = montarInventario(comp);
    const tagsGerenciadas = montarTagsGerenciadas(comp);

    // inventory volta [] quando inventory_mode=-1 (desabilitado) -> trata como vazio
    const invAtual = (host.inventory && !Array.isArray(host.inventory)) ? host.inventory : {};
    const invMudou = Object.keys(invDesejado).some(k => String(invAtual[k] || '') !== String(invDesejado[k]));

    // Merge de tags: preserva as nao gerenciadas, sobrescreve as gerenciadas
    const atuais = host.tags || [];
    const naoGerenciadas = atuais.filter(t => !(t.tag in tagsGerenciadas));
    const desejadas = Object.keys(tagsGerenciadas).map(v => ({ tag: v, value: tagsGerenciadas[v] }));
    const tagsMudou = JSON.stringify(naoGerenciadas.map(t => [t.tag, t.value]).sort()) !==
        JSON.stringify(atuais.filter(t => !(t.tag in tagsGerenciadas)).map(t => [t.tag, t.value]).sort()) ||
        desejadas.some(d => {
            const a = atuais.find(t => t.tag === d.tag);
            return !a || a.value !== d.value;
        });

    // inventory_mode: -1 (desabilitado) atrapalha o sync de inventario; usa 0 (manual)
    const modoMudou = String(host.inventory_mode) === '-1';

    if (!invMudou && !tagsMudou && !modoMudou) return false;

    const params = { hostid: host.hostid };
    if (invMudou || modoMudou) {
        params.inventory_mode = 0; // manual: Inventario de TI e a fonte da verdade
        params.inventory = invDesejado;
    }
    if (tagsMudou) params.tags = naoGerenciadas.concat(desejadas);
    await authCall('host.update', params);
    return true;
}

/**
 * Sincroniza hosts do Inventario de TI com o Zabbix:
 *  - cria host (ICMP agentless) quando o registro TEM IP e ainda nao existe;
 *  - atualiza inventario, tags e vinculo dos hosts existentes (smart update);
 *  - relata registros SEM IP e hosts SEM vinculo (sem inventar dado nenhum).
 * Usa template "ICMP Ping" e grupo "Inventario TI".
 */
async function sincronizarHostsInventario(computadores) {
    const resultado = { criados: 0, atualizados: 0, inalterados: 0, semIp: 0, semVinculo: 0, erros: [], vinculos: [] };
    if (!Array.isArray(computadores)) computadores = [];

    // Busca template e grupo
    let templateId = null, groupId = null;
    try {
        const templates = await authCall('template.get', { output: ['templateid'], filter: { name: 'ICMP Ping' } });
        if (templates.length) templateId = templates[0].templateid;
    } catch (e) {}
    try {
        const groups = await authCall('hostgroup.get', { output: ['groupid'], filter: { name: 'Inventario TI' } });
        if (groups.length) groupId = groups[0].groupid;
    } catch (e) {}
    if (!groupId) {
        try {
            const g = await authCall('hostgroup.create', { name: 'Inventario TI' });
            groupId = g.groupids[0];
        } catch (e) { resultado.erros.push('Grupo: ' + e.message); return resultado; }
    }

    let idx = await indexarHostsParaVinculo();

    for (const comp of computadores) {
        try {
            const vinculado = vincularHost(comp, idx);
            if (vinculado) {
                const mudou = await atualizarHostDoInventario(vinculado, comp);
                if (mudou) {
                    resultado.atualizados++;
                    resultado.vinculos.push({ inventario_id: comp.id, hostid: vinculado.hostid, acao: 'atualizado' });
                    // reindexa para refletir o update (proximos computadores veem estado fresco)
                    idx = await indexarHostsParaVinculo();
                } else {
                    resultado.inalterados++;
                }
                continue;
            }

            // Sem vinculo: so cria se o registro tiver IP (sem IP nao ha o que monitorar)
            const ip = comp.ipAddress || comp.ip;
            if (!ip) { resultado.semIp++; continue; }

            const hostname = (comp.nomePc || comp.nome || 'PC-' + comp.id).replace(/[^a-zA-Z0-9._-]/g, '_');
            const params = {
                host: hostname,
                name: comp.nomePc || comp.nome || hostname,
                groups: [{ groupid: groupId }],
                inventory_mode: 0,
                inventory: montarInventario(comp),
                interfaces: [{ type: 1, main: 1, useip: 1, ip: ip, dns: '', port: '10050' }],
                tags: Object.keys(montarTagsGerenciadas(comp)).map(k => ({ tag: k, value: montarTagsGerenciadas(comp)[k] }))
            };
            if (templateId) params.templates = [{ templateid: templateId }];
            await authCall('host.create', params);
            resultado.criados++;
            idx = await indexarHostsParaVinculo();
        } catch (e) {
            resultado.erros.push((comp.nomePc || comp.id || '?') + ': ' + e.message);
        }
    }

    // Hosts monitorados sem vinculo com nenhum registro (informativo, nao mexe neles)
    resultado.semVinculo = idx.hosts.filter(h => {
        const tagId = (h.tags || []).find(t => t.tag === 'inventario_id');
        return !tagId;
    }).length;

    return resultado;
}

/**
 * Sincroniza manutencoes do Inventario de TI para o Zabbix (maintenance.create):
 *  - proximaManutencao futura de cada computador VINCULADO -> janela de manutencao no dia;
 *  - ordens de servico abertas com dataPrevisao futura -> janela no dia previsto;
 *  - limpa janelas "InvTI" ja vencidas (idempotente, sem lixo acumulado).
 * Sem vinculo host<->computador, a janela e ignorada e reportada (nunca inventa host).
 */
async function sincronizarManutencoes(computadores, ordens) {
    const resultado = { criadas: 0, atualizadas: 0, removidas: 0, semVinculo: 0, ignoradas: 0, janelas: [], erros: [] };
    if (!Array.isArray(computadores)) computadores = [];
    if (!Array.isArray(ordens)) ordens = [];

    const idx = await indexarHostsParaVinculo();
    const porIdComp = {};
    for (const c of computadores) porIdComp[String(c.id)] = c;

    const fimDoDia = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
    const inicioDoDia = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
    const agora = Date.now();
    const janelas = []; // {name, hostid, active_since, active_till, descricao}

    // 1) proximaManutencao de computadores vinculados
    for (const comp of computadores) {
        if (!comp.proximaManutencao) continue;
        const ini = new Date(comp.proximaManutencao);
        if (isNaN(ini)) continue;
        const vinculado = vincularHost(comp, idx);
        if (!vinculado) { resultado.semVinculo++; continue; }
        if (ini.getTime() < agora) { resultado.ignoradas++; continue; } // janela ja venceu
        janelas.push({
            name: 'InvTI Manutencao ' + (comp.nomePc || comp.id) + ' ' + ini.toISOString().slice(0, 10),
            hostid: vinculado.hostid,
            active_since: inicioDoDia(ini).getTime(),
            active_till: fimDoDia(ini).getTime(),
            descricao: 'Manutencao preventiva programada no Inventario de TI (' + (comp.nomePc || comp.id) + ')'
        });
    }

    // 2) Ordens de servico abertas com previsao futura
    for (const os of ordens) {
        if (['CONCLUIDA', 'CANCELADA'].includes(String(os.status || '').toUpperCase())) continue;
        if (!os.dataPrevisao) continue;
        const ini = new Date(os.dataPrevisao);
        if (isNaN(ini) || ini.getTime() < agora) { resultado.ignoradas++; continue; }
        const comp = porIdComp[String(os.computadorId)];
        const vinculado = comp ? vincularHost(comp, idx) : null;
        if (!vinculado) { resultado.semVinculo++; continue; }
        janelas.push({
            name: 'InvTI OS' + os.id + ' ' + (os.computadorNome || comp.nomePc || ''),
            hostid: vinculado.hostid,
            active_since: inicioDoDia(ini).getTime(),
            active_till: fimDoDia(ini).getTime(),
            descricao: 'Ordem de servico #' + os.id + ': ' + (os.titulo || os.descricao || '').slice(0, 180)
        });
    }

    // Janelas existentes gerenciadas por nos (prefixo "InvTI ")
    let existentes = [];
    try {
        const todas = await authCall('maintenance.get', { output: ['maintenanceid', 'name', 'active_till'] });
        existentes = todas.filter(m => String(m.name || '').startsWith('InvTI '));
    } catch (e) { resultado.erros.push('maintenance.get: ' + e.message); return resultado; }

    const porNomeExistente = {};
    for (const m of existentes) porNomeExistente[m.name] = m;

    // 3) cria/atualiza janelas desejadas
    for (const j of janelas) {
        const periodo = {
            timeperiod_type: 0, // one-time
            start_date: Math.floor(j.active_since / 1000),
            period: Math.max(60, Math.ceil((j.active_till - j.active_since) / 1000)) + 's'
        };
        try {
            if (porNomeExistente[j.name]) {
                await authCall('maintenance.update', {
                    maintenanceid: porNomeExistente[j.name].maintenanceid,
                    active_since: Math.floor(j.active_since / 1000),
                    active_till: Math.floor(j.active_till / 1000),
                    description: j.descricao,
                    hosts: [{ hostid: j.hostid }],
                    timeperiods: [periodo]
                });
                resultado.atualizadas++;
            } else {
                await authCall('maintenance.create', {
                    name: j.name,
                    active_since: Math.floor(j.active_since / 1000),
                    active_till: Math.floor(j.active_till / 1000),
                    description: j.descricao,
                    maintenance_type: 0, // one-time
                    hosts: [{ hostid: j.hostid }],
                    timeperiods: [periodo]
                });
                resultado.criadas++;
            }
            resultado.janelas.push(j.name);
        } catch (e) { resultado.erros.push(j.name + ': ' + e.message); }
    }

    // 4) limpa janelas InvTI vencidas ou que perderam o vinculo
    const desejadas = janelas.map(j => j.name);
    for (const m of existentes) {
        if (desejadas.includes(m.name)) continue;
        if (parseInt(m.active_till, 10) * 1000 < agora) {
            try {
                await authCall('maintenance.delete', [m.maintenanceid]);
                resultado.removidas++;
            } catch (e) { resultado.erros.push('remover ' + m.name + ': ' + e.message); }
        }
    }

    return resultado;
}

/**
 * Garante o dashboard "Inventario TI" no Zabbix com widgets uteis:
 * problemas (ao vivo), problemas por severidade, disponibilidade dos hosts e
 * um widget URL apontando para o proprio painel do Inventario de TI.
 * Idempotente: cria se nao existir, atualiza os widgets se existir.
 * Retorna { dashboardid, criado, atualizado }.
 */
async function garantirDashboardInventario(urlPainel) {
    // Grupo "Inventario TI" (para os widgets de disponibilidade/severidade)
    let groupId = null;
    try {
        const g = await authCall('hostgroup.get', { output: ['groupid'], filter: { name: 'Inventario TI' } });
        if (g.length) groupId = g[0].groupid;
    } catch (e) {}
    if (!groupId) {
        const novo = await authCall('hostgroup.create', { name: 'Inventario TI' });
        groupId = novo.groupids[0];
    }

    const widgets = [
        {
            type: 'problems', name: 'Problemas - Inventario TI', x: 0, y: 0, width: 40, height: 12, view_mode: 0,
            fields: [
                { type: 0, name: 'rf_rate', value: 60 },
                { type: 0, name: 'show', value: 1 },
                { type: 2, name: 'groupids.0', value: groupId },
                { type: 0, name: 'show_tags', value: 3 },
                { type: 0, name: 'tag_name_format', value: 1 },
                { type: 0, name: 'show_suppressed', value: 1 },
                { type: 0, name: 'show_lines', value: 25 }
            ]
        },
        {
            type: 'problemsbysv', name: 'Problemas por severidade', x: 40, y: 0, width: 32, height: 6, view_mode: 0,
            fields: [
                { type: 0, name: 'rf_rate', value: 60 },
                { type: 2, name: 'groupids.0', value: groupId },
                { type: 0, name: 'show_type', value: 1 },
                { type: 0, name: 'show_suppressed', value: 1 },
                { type: 1, name: 'reference', value: 'SVINV' }
            ]
        },
        {
            type: 'hostavail', name: 'Disponibilidade dos hosts', x: 40, y: 6, width: 16, height: 6, view_mode: 0,
            fields: [
                { type: 0, name: 'rf_rate', value: 60 },
                { type: 2, name: 'groupids.0', value: groupId },
                { type: 0, name: 'layout', value: 1 }
            ]
        },
        {
            type: 'url', name: 'Painel Inventario TI', x: 56, y: 6, width: 16, height: 6, view_mode: 0,
            fields: [
                { type: 1, name: 'url', value: urlPainel || 'http://localhost:5903/index.html' },
                { type: 0, name: 'rf_rate', value: 60 }
            ]
        }
    ];

    const existentes = await authCall('dashboard.get', {
        output: ['dashboardid', 'name'],
        filter: { name: 'Inventario TI' },
        editable: true
    });

    if (!existentes.length) {
        const r = await authCall('dashboard.create', {
            name: 'Inventario TI',
            display_period: 30,
            auto_start: 1,
            pages: [{ widgets: widgets }]
        });
        return { dashboardid: r.dashboardids[0], criado: true, atualizado: false };
    }

    await authCall('dashboard.update', {
        dashboardid: existentes[0].dashboardid,
        display_period: 30,
        auto_start: 1,
        pages: [{ widgets: widgets }]
    });
    return { dashboardid: existentes[0].dashboardid, criado: false, atualizado: true };
}

/** Retorna o dashboardid do "Inventario TI" se existir (para links do painel). */
async function obterDashboardInventario() {
    try {
        const r = await authCall('dashboard.get', {
            output: ['dashboardid', 'name'],
            filter: { name: 'Inventario TI' },
            editable: true
        });
        return r.length ? { dashboardid: r[0].dashboardid } : null;
    } catch (e) { return null; }
}

/**
 * Busca dados de monitoramento de todos os hosts Zabbix (disponibilidade, latencia, perda).
 */
async function dadosMonitoramentoZabbix() {
    const hosts = await listarHosts();
    const resultado = [];
    for (const h of hosts) {
        const ip = h.interfaces && h.interfaces.length ? h.interfaces[0].ip : null;
        if (!ip) continue;
        let disponivel = null, latencia = null, perda = null;
        try {
            const itens = await listarItens(h.hostid);
            // Verifica ICMP (agente passivo) OU agent.ping / zabbix[host,active_agent,available] (agente ativo)
            const icmpItens = itens.filter(it => it.key_ === 'icmpping' || it.key_ === 'icmppingsec' || it.key_ === 'icmppingloss');
            const agentItens = itens.filter(it => it.key_ === 'agent.ping' || it.key_ === 'zabbix[host,active_agent,available]');
            const itemids = [...icmpItens, ...agentItens].map(it => it.itemid);
            const keyMap = {};
            for (const it of [...icmpItens, ...agentItens]) keyMap[it.itemid] = it.key_;
            if (itemids.length) {
                const agora = Date.now();
                const vals = await ultimosValores(itemids);
                for (const v of vals) {
                    // Ignora itens sem dados frescos (5 min) — lastvalue antigo nao e disponibilidade
                    const lc = parseInt(v.lastclock, 10);
                    if (!isNaN(lc) && (agora - lc * 1000) > 300000) continue;
                    const key = keyMap[v.itemid];
                    // ICMP passivo
                    if (key === 'icmpping') disponivel = v.lastvalue === '1' ? true : (v.lastvalue === '0' ? false : null);
                    if (key === 'icmppingsec') latencia = parseFloat(v.lastvalue);
                    if (key === 'icmppingloss') perda = parseFloat(v.lastvalue);
                    // Agente ativo: agent.ping = 1 disponivel; active_agent,available = 2 indisponivel / 1 disponivel / 0 desconhecido
                    if (key === 'agent.ping') {
                        if (v.lastvalue === '1' || v.lastvalue === '1.000000') disponivel = true;
                        else if (v.lastvalue === '0' || v.lastvalue === '0.000000') disponivel = false;
                    }
                    if (key === 'zabbix[host,active_agent,available]') {
                        if (v.lastvalue === '1' || v.lastvalue === '1.000000') disponivel = true;
                        else if (v.lastvalue === '2' || v.lastvalue === '2.000000') disponivel = false;
                        // '0' = desconhecido -> ignora
                    }
                }
            }
        } catch (e) {}
        resultado.push({
            hostid: h.hostid,
            host: h.host,
            nome: h.name,
            ip,
            disponivel,
            latenciaMs: latencia != null ? Math.round(latencia * 1000) : null,
            perdaPct: perda,
            available: h.interfaces && h.interfaces[0] ? h.interfaces[0].available : null,
            error: h.interfaces && h.interfaces[0] ? h.interfaces[0].error : null,
            problemas: []
        });
    }
    // Busca problemas
    try {
        const probs = await listarProblemas();
        for (const p of probs) {
            // find host
            // problem.get doesn't return hostid directly in all versions; skip for now
        }
    } catch (e) {}
    return resultado;
}

// ==================== METRICAS COMPLETAS (CPU/RAM/DISCO/UPTIME) ====================

/** Cache de metricas Zabbix (TTL 60s) */
let _cacheMetricas = null;
let _cacheMetricasTs = 0;
const CACHE_TTL_MS = 10000;

/**
 * Busca metricas completas (CPU, RAM, disco, uptime, ICMP) de TODOS os hosts Zabbix.
 * Usa cache de 60s para evitar sobrecarga na API.
 * Retorna array com { host, nome, ip, cpu, ram, disco, uptime, disponivel, latenciaMs, perdaPct }
 */
async function dadosCompletosZabbix() {
    const now = Date.now();
    if (_cacheMetricas && (now - _cacheMetricasTs) < CACHE_TTL_MS) {
        return _cacheMetricas;
    }

    try {
        const hosts = await listarHosts();
        if (!hosts || !hosts.length) return [];

        const hostids = hosts.map(h => h.hostid);

        // Busca todos os itens relevantes de todos os hosts de uma vez
        const itens = await authCall('item.get', {
            hostids: hostids,
            output: ['itemid', 'hostid', 'name', 'key_', 'lastvalue', 'lastclock', 'units', 'state'],
            filter: {}
        });

        // Filtra apenas itens relevantes (CPU, RAM, disco, uptime, ICMP, GPU)
        const keysRelevantes = ['system.cpu.util', 'vm.memory.size', 'vm.memory.util', 'vfs.fs.size', 'vfs.fs.dependent.size', 'system.uptime', 'icmpping', 'icmppingsec', 'icmppingloss', 'agent.ping'];
        const itensFiltrados = itens.filter(it => {
            const k = (it.key_ || '').toLowerCase();
            const n = (it.name || '').toLowerCase();
            if (k.includes('gpu') || n.includes('gpu')) return true;  // GPU (perf_counter ou item customizado)
            return keysRelevantes.some(kr => k.includes(kr));
        });

        // Agrupa itens por hostid
        const itensPorHost = {};
        for (const it of itensFiltrados) {
            if (!itensPorHost[it.hostid]) itensPorHost[it.hostid] = [];
            itensPorHost[it.hostid].push(it);
        }

        // Monta resultado por host
        const resultado = [];
        for (const h of hosts) {
            const ip = h.interfaces && h.interfaces.length ? h.interfaces[0].ip : null;
            if (!ip) continue;

            const itensHost = itensPorHost[h.hostid] || [];
            const metricas = {
                cpu: null,
                ram: null,
                disco: [],
                uptime: null,
                gpu: null,
                disponivel: null,
                latenciaMs: null,
                perdaPct: null
            };

            for (const it of itensHost) {
                const key = (it.key_ || '').toLowerCase();
                const val = it.lastvalue;
                const numVal = parseFloat(val);
                // Rastreia o lastclock mais recente entre os itens realmente usados
                if (it.lastclock) {
                    const lc = parseInt(it.lastclock, 10);
                    if (!isNaN(lc)) metricas._lastclock = Math.max(metricas._lastclock || 0, lc);
                }

                if (key === 'system.cpu.util' || key.includes('system.cpu.util')) {
                    if (!isNaN(numVal)) metricas.cpu = Math.round(numVal * 10) / 10;
                }
                else if (key === 'vm.memory.util' || key === 'vm.memory.size[pavailable]' || key.includes('vm.memory.util') || key.includes('vm.memory.size[pavailable]')) {
                    if (!isNaN(numVal)) { if (key.includes('util')) metricas.ram = { disponivelPct: Math.round((100 - numVal) * 10) / 10, usadoPct: Math.round(numVal * 10) / 10 }; else metricas.ram = { disponivelPct: numVal, usadoPct: Math.round((100 - numVal) * 10) / 10 }; }
                }
                else if (key.includes('vfs.fs') && (key.includes('pused') || key.includes('pfree') || key.includes('free') || key.includes('total'))) {
                    if (!isNaN(numVal) && key.includes('pused')) {
                        const diskName = key.split(',')[0].replace('vfs.fs.dependent.size[', '').replace('vfs.fs.size[', '');
                        if (!metricas.disco.some(d => d.nome === diskName)) {
                            metricas.disco.push({ nome: diskName, livrePct: 100 - numVal, usadoPct: Math.round(numVal * 10) / 10 });
                        }
                    }
                }
                else if (key === 'system.uptime') {
                    if (!isNaN(numVal)) metricas.uptime = Math.round(numVal);
                }
                else if (key.includes('gpu')) {
                    if (!isNaN(numVal)) metricas.gpu = Math.round(numVal * 10) / 10;
                }
                else if (key === 'icmpping' || key === 'agent.ping') {
                    metricas.disponivel = (val === '1' || val === '1.000000') ? true : (val === '0' || val === '0.000000' ? false : (val === 'agent.ping' ? true : null));
                }
                else if (key === 'icmppingsec') {
                    if (!isNaN(numVal)) metricas.latenciaMs = Math.round(numVal * 1000);
                }
                else if (key === 'icmppingloss') {
                    if (!isNaN(numVal)) metricas.perdaPct = numVal;
                }
            }

            resultado.push({
                hostid: h.hostid,
                host: h.host,
                nome: h.name,
                ip,
                cpu: metricas.cpu,
                ram: metricas.ram,
                disco: metricas.disco,
                uptime: metricas.uptime,
                gpu: metricas.gpu,
                disponivel: metricas.disponivel,
                latenciaMs: metricas.latenciaMs,
                perdaPct: metricas.perdaPct,
                _lastclock: metricas._lastclock || null,
                available: h.interfaces && h.interfaces[0] ? h.interfaces[0].available : null,
                error: h.interfaces && h.interfaces[0] ? h.interfaces[0].error : null
            });
        }

        _cacheMetricas = resultado;
        _cacheMetricasTs = now;
        return resultado;
    } catch (e) {
        console.error('[zabbix-bridge] dadosCompletosZabbix error:', e.message);
        if (_cacheMetricas && (now - _cacheMetricasTs) < CACHE_TTL_MS) return _cacheMetricas;
        return [];
    }
}
module.exports = {
    authCall,
    dadosCompletosZabbix,
    sincronizarHostsInventario,
    sincronizarManutencoes,
    garantirDashboardInventario,
    obterDashboardInventario,
    dadosMonitoramentoZabbix,
    apiCall,
    testarConexao,
    listarHosts,
    enriquecerDisponibilidade,
    buscarHostPorIp,
    listarProblemas,
    listarProblemasDetalhado,
    formatarDuracao,
    historicoItem,
    listarItens,
    listarTriggers,
    obterMetricasHost,
    ultimosValores,
    criarHost,
    adicionarTag,
    reconhecerProblema,
    resumoMonitoramento,
    monitoramentoHost,
    getConfigStatus,
    loadConfig,
    saveConfig
};
