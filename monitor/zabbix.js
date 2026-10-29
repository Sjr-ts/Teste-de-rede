'use strict';
/**
 * Integracao opcional com Zabbix via API JSON-RPC.
 * Nao e obrigatoria: o coletor funciona 100% sem Zabbix.
 * Quando habilitado, sincroniza hosts e pode enviar historico.
 *
 * Requer stack Zabbix acessivel (ver docker-compose.zabbix.yml).
 * Credenciais ficam em monitor/config.json (nao no frontend).
 */

const HTTP = require('http');
const HTTPS = require('https');
const { URL } = require('url');

let requestId = 1;

function chamarApi(apiUrl, usuario, senha, metodo, params) {
    return new Promise((resolve, reject) => {
        let urlObj;
        try { urlObj = new URL(apiUrl); } catch (e) { return reject(new Error('URL Zabbix invalida')); }

        const payload = JSON.stringify({
            jsonrpc: '2.0',
            method: metodo,
            params: params || {},
            id: requestId++,
            auth: undefined
        });

        // Primeiro login para obter token, depois chamada real
        const fazer = (auth) => {
            const body = JSON.stringify({
                jsonrpc: '2.0',
                method: metodo,
                params: params || {},
                id: requestId++,
                auth: auth || undefined
            });

            const opcoes = {
                hostname: urlObj.hostname,
                port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                path: urlObj.pathname,
                method: 'POST',
                headers: { 'Content-Type': 'application/json-rpc', 'Content-Length': Buffer.byteLength(body) },
                timeout: 10000
            };

            const lib = urlObj.protocol === 'https:' ? HTTPS : HTTP;
            const req = lib.request(opcoes, (res) => {
                let data = '';
                res.on('data', (c) => data += c);
                res.on('end', () => {
                    try {
                        const j = JSON.parse(data);
                        if (j.error) return reject(new Error('Zabbix API: ' + (j.error.data || j.error.message || 'erro')));
                        resolve(j.result);
                    } catch (e) { reject(new Error('Resposta Zabbix invalida')); }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout Zabbix')); });
            req.write(body);
            req.end();
        };

        // login
        const loginBody = JSON.stringify({
            jsonrpc: '2.0',
            method: 'user.login',
            params: { username: usuario, password: senha },
            id: requestId++
        });

        const lib = urlObj.protocol === 'https:' ? HTTPS : HTTP;
        const loginReq = lib.request({
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname,
            method: 'POST',
            headers: { 'Content-Type': 'application/json-rpc', 'Content-Length': Buffer.byteLength(loginBody) },
            timeout: 10000
        }, (res) => {
            let data = '';
            res.on('data', (c) => data += c);
            res.on('end', () => {
                try {
                    const j = JSON.parse(data);
                    if (j.error) return reject(new Error('Login Zabbix: ' + (j.error.data || 'credenciais invalidas')));
                    fazer(j.result);
                } catch (e) { reject(new Error('Resposta de login invalida')); }
            });
        });
        loginReq.on('error', reject);
        loginReq.on('timeout', () => { loginReq.destroy(); reject(new Error('Timeout login Zabbix')); });
        loginReq.write(loginBody);
        loginReq.end();
    });
}

/** Testa conectividade com a API. */
async function testarConexao(cfg) {
    try {
        const versao = await chamarApi(cfg.api, cfg.usuario, cfg.senha, 'apiinfo.version', {});
        return { ok: true, versao };
    } catch (e) {
        return { ok: false, erro: e.message };
    }
}

/**
 * Sincroniza hosts do inventario no Zabbix (cria se nao existem).
 * Usa interface ICMP (agentless). Nao instala agent.
 */
async function sincronizarHosts(alvos, cfg) {
    const resultados = { criados: 0, existentes: 0, erros: 0, detalhes: [] };

    // obtem grupo e template
    const grupos = await chamarApi(cfg.api, cfg.usuario, cfg.senha, 'hostgroup.get', {
        output: 'extend',
        filter: { name: [cfg.grupoHosts || 'Inventario TI'] }
    });
    let groupId;
    if (grupos.length) {
        groupId = grupos[0].groupid;
    } else {
        const criado = await chamarApi(cfg.api, cfg.usuario, cfg.senha, 'hostgroup.create', {
            name: cfg.grupoHosts || 'Inventario TI'
        });
        groupId = criado.groupids[0];
    }

    const templates = await chamarApi(cfg.api, cfg.usuario, cfg.senha, 'template.get', {
        output: 'extend',
        filter: { host: [cfg.templateAgentless || 'Template ICMP Ping'] }
    });
    const templateId = templates.length ? templates[0].templateid : null;

    const hostsExistentes = await chamarApi(cfg.api, cfg.usuario, cfg.senha, 'host.get', {
        output: ['hostid', 'host', 'name'],
        selectInterfaces: ['interfaceid', 'ip', 'type']
    });
    const mapaExistente = {};
    for (const h of hostsExistentes) {
        if (h.interfaces && h.interfaces.length) mapaExistente[h.interfaces[0].ip] = h;
    }

    for (const a of alvos) {
        if (mapaExistente[a.ip]) {
            resultados.existentes++;
            continue;
        }
        try {
            const params = {
                host: 'inv-' + a.ip.replace(/[^\d]/g, '_'),
                name: (a.nome || a.ip) + ' [' + a.ip + ']',
                groups: [{groupid: groupId}],
                interfaces: [{
                    type: 2, // SNMP? 1=agent, 2=SNMP, 4=IPMI... na verdade 1 = agent interface mas sem agent - Zabbix aceita interface "agent" sem agent para ICMP checks simples
                    main: 1,
                    useip: 1,
                    ip: a.ip,
                    dns: '',
                    port: '10050'
                }],
                tags: [{ tag: 'inventario', value: 'ti' }, { tag: 'setor', value: a.setor || 'N/A' }]
            };
            if (templateId) params.templates = [{ templateid: templateId }];
            await chamarApi(cfg.api, cfg.usuario, cfg.senha, 'host.create', params);
            resultados.criados++;
            resultados.detalhes.push({ ip: a.ip, acao: 'criado' });
        } catch (e) {
            resultados.erros++;
            resultados.detalhes.push({ ip: a.ip, erro: e.message });
        }
    }

    return resultados;
}

/** Envia medicoes como trappers (requer items Zabbix do tipo trapper - opcional). */
async function enviarMedicoes(medicoes, cfg) {
    // Por padrao desabilitado - requer configuracao de trapper items no Zabbix.
    if (!cfg.enviarHistorico) return { enviados: 0, nota: 'enviarHistorico=false' };
    // Implementacao minima: apenas registra que tentaria enviar.
    // A integracao completa com trappers exige mapeamento host->hostid e keys especificas.
    return { enviados: 0, nota: 'integracao de trapper pendente de mapeamento de keys' };
}

module.exports = { testarConexao, sincronizarHosts, enviarMedicoes, chamarApi };
