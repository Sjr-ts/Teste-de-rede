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

/** Login e retorna token de autenticacao. */
async function login() {
    const cfg = loadConfig();
    if (!cfg || !cfg.apiToken && (!cfg.usuario || !cfg.senha)) {
        throw new Error('Credenciais Zabbix nao configuradas');
    }

    // Se usar API token (Zabbix 6.4+), envia no header
    if (cfg.apiToken) {
        return { token: cfg.apiToken, useHeader: true };
    }

    const result = await apiCall('user.login', {
        username: cfg.usuario,
        password: cfg.senha
    });
    return { token: result, useHeader: false };
}

/** Chamada autenticada. */
async function authCall(method, params) {
    const cfg = loadConfig();
    if (!cfg) throw new Error('Zabbix nao configurado');

    if (cfg.apiToken) {
        // API token: envia no header Authorization
        return apiCallWithToken(method, params, cfg.apiToken);
    }

    const sess = await login();
    return apiCall(method, params, sess.token);
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

/** Lista todos os hosts do Zabbix. */
async function listarHosts(filtro) {
    const params = {
        output: ['hostid', 'host', 'name', 'status'],
        selectInterfaces: ['interfaceid', 'ip', 'type', 'available', 'error'],
        selectParentTemplates: ['name'],
        selectTags: 'extend',
        filter: filtro || {}
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
            output: ['itemid', 'hostid', 'key_', 'lastvalue', 'state', 'status'],
            filter: { key_: ['icmpping', 'agent.ping', 'zabbix[host,active_agent,available]'] }
        });
        for (const it of (allItems || [])) {
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
            else if (v === '0' || v === '0.000000') avail = '2';
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
        output: ['hostid', 'host', 'name'],
        selectInterfaces: ['ip', 'available', 'error'],
        filter: {}
    });
    for (const h of hosts) {
        if (h.interfaces && h.interfaces.some(i => i.ip === ip)) return h;
    }
    return null;
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

/** Reconhece um problema (acknowledge). */
async function reconhecerProblema(eventid, mensagem) {
    return authCall('event.acknowledge', {
        eventid,
        action: 6, // acknowledge + add message
        message: mensagem
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
                output: ['itemid', 'hostid', 'key_', 'lastvalue', 'state', 'status'],
                filter: { key_: ['icmpping', 'agent.ping', 'zabbix[host,active_agent,available]'] }
            });
            for (const it of (allItems || [])) {
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
                if (v === '0' || v === '0.000000') return '2';
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
        for (const v of valores) {
            valoresMap[v.key_] = {
                valor: v.lastvalue,
                horario: new Date(parseInt(v.lastclock) * 1000).toISOString(),
                unidade: v.units,
                nome: v.name
            };
        }

        return {
            encontrado: true,
            ip,
            host: {
                hostid: host.hostid,
                hostname: host.host,
                nome: host.name,
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

/**
 * Sincroniza hosts do inventario para o Zabbix (cria se nao existir).
 * Usa template "ICMP Ping" (agentless) e grupo "Inventario TI".
 */
async function sincronizarHostsInventario(computadores) {
    const resultado = { criados: 0, existentes: 0, erros: [] };
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

    for (const comp of computadores) {
        const ip = comp.ipAddress || comp.ip;
        if (!ip) continue;
        const hostname = (comp.nomePc || comp.nome || 'PC-' + comp.id).replace(/[^a-zA-Z0-9._-]/g, '_');
        try {
            const existentes = await authCall('host.get', {
                output: ['hostid'],
                filter: { host: hostname }
            });
            if (existentes.length) { resultado.existentes++; continue; }
            const params = {
                host: hostname,
                name: comp.nomePc || comp.nome || hostname,
                groups: [{ groupid: groupId }],
                interfaces: [{
                    type: 1,
                    main: 1,
                    useip: 1,
                    ip: ip,
                    dns: '',
                    port: '10050'
                }],
                tags: [
                    { tag: 'setor', value: comp.departamento || comp.setor || '' },
                    { tag: 'inventario_id', value: String(comp.id || '') }
                ]
            };
            if (templateId) params.templates = [{ templateid: templateId }];
            await authCall('host.create', params);
            resultado.criados++;
        } catch (e) {
            resultado.erros.push(hostname + ': ' + e.message);
        }
    }
    return resultado;
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
                const vals = await ultimosValores(itemids);
                for (const v of vals) {
                    const key = keyMap[v.itemid];
                    // ICMP passivo
                    if (key === 'icmpping') disponivel = v.lastvalue === '1' ? true : (v.lastvalue === '0' ? false : null);
                    if (key === 'icmppingsec') latencia = parseFloat(v.lastvalue);
                    if (key === 'icmppingloss') perda = parseFloat(v.lastvalue);
                    // Agente ativo: agent.ping = 1 disponível, zabbix[host,active_agent,available] = 1 disponível
                    if (key === 'agent.ping') {
                        if (v.lastvalue === '1' || v.lastvalue === '1.000000') disponivel = true;
                        else if (v.lastvalue === '0' || v.lastvalue === '0.000000') disponivel = false;
                    }
                    if (key === 'zabbix[host,active_agent,available]') {
                        if (v.lastvalue === '1' || v.lastvalue === '1.000000') disponivel = true;
                        else if (v.lastvalue === '0' || v.lastvalue === '0.000000') disponivel = false;
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
    dadosMonitoramentoZabbix,
    apiCall,
    testarConexao,
    listarHosts,
    enriquecerDisponibilidade,
    buscarHostPorIp,
    listarProblemas,
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
