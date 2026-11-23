const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const compression = require('compression');
const { ping, tcpCheck } = require('./monitor/pinger');
const store = require('./monitor/storage');
const monitor = require('./monitor/service');
const monitorConfig = require('./monitor/config.json');
const mockEngine = require('./monitor/mock-engine');

const app = express();
// Porta configuravel (padrao 5903) — permite subir instancias de teste em
// portas temporarias sem conflitar com a producao.
const PORT = Number(process.env.PORT || 5903);

// Seguranca basica e profissional: nao expor stack, protecao MIME/clickjacking
app.disable('x-powered-by');
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
});
// Compressao gzip/deflate — nunca no stream SSE (bufferizaria o push ao vivo)
app.use(compression({
    filter: (req) => req.path !== '/api/monitor/stream'
}));

// Protecao global: nao deixa o servidor cair com unhandled rejection
process.on('unhandledRejection', (err) => {
    console.error('[server] unhandledRejection:', err && err.message ? err.message : err);
});
process.on('uncaughtException', (err) => {
    console.error('[server] uncaughtException:', err && err.message ? err.message : err);
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ---- Health check ----
app.get('/actuator/health', (req, res) => res.json({ status: 'UP' }));

// ---- Zabbix webhook: recebe alertas do action → painel (publico, protegido por TOKEN) ----
// O Zabbix nao tem sessao — autenticamos por segredo compartilhado no header.
// (Antes da autenticacao este endpoint era aberto; depois do login de verdade,
//  ficou de fora do portão mas exige o token.)
const WEBHOOK_SECRET = (() => {
    try {
        return String(JSON.parse(fs.readFileSync(path.join(__dirname, 'monitor', 'webhook-secret.json'), 'utf8')).webhookToken || '');
    } catch (e) { return process.env.ZABBIX_WEBHOOK_TOKEN || ''; }
})();
const alertasWebhook = [];
app.post('/api/zabbix/webhook', (req, res) => {
    const token = String(req.headers['x-webhook-token'] || '');
    if (!WEBHOOK_SECRET || token !== WEBHOOK_SECRET) {
        console.warn('[zabbix-webhook] rejeitado: token invalido');
        return res.status(401).json({ error: 'Token invalido ou webhook nao configurado (monitor/webhook-secret.json).' });
    }
    try {
        const body = req.body || {};
        const alerta = {
            id: Date.now(),
            recebidoEm: new Date().toISOString(),
            status: body.status || 'PROBLEM',
            severidade: body.severity || 'Unknown',
            trigger: body.trigger || '',
            host: body.host || '',
            mensagem: body.message || '',
            hora: body.time || ''
        };
        alertasWebhook.unshift(alerta);
        if (alertasWebhook.length > 500) alertasWebhook.length = 500;
        // Broadcast SSE para todos os clientes conectados
        sseBroadcast('alerta', alerta);
        console.log('[zabbix-webhook]', alerta.status, alerta.trigger, '@', alerta.host);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== AUTENTICACAO (sessao HttpOnly assinada) ====================
// Publico: apenas /api/auth/login e o health check. TODO o resto de /api exige sessao.
const authMw = require('./monitor/auth');

// Rate limit simples de login (por IP): 10 falhas em 10 min -> 429
const _loginTentativas = new Map();
function _registrarFalhaLogin(ip) {
    const agora = Date.now();
    const e = _loginTentativas.get(ip) || { n: 0, primeiro: agora };
    if (agora - e.primeiro > 10 * 60 * 1000) { e.n = 0; e.primeiro = agora; }
    e.n += 1;
    _loginTentativas.set(ip, e);
}

app.post('/api/auth/login', (req, res) => {
    // Usa SEMPRE o IP real do socket: X-Forwarded-For pode ser forjado pelo
    // cliente para burlar o rate limit. So confia nele se trust proxy estiver
    // configurado explicitamente (o que nao e o caso aqui).
    const ipReal = String(req.socket.remoteAddress || '?');
    const ip = crypto.createHash('sha256').update(ipReal).digest('hex').slice(0, 16);
    const bloqueio = _loginTentativas.get(ip);
    if (bloqueio && bloqueio.n >= 10 && (Date.now() - bloqueio.primeiro) < 10 * 60 * 1000) {
        return res.status(429).json({ error: 'Muitas tentativas. Aguarde 10 minutos.' });
    }
    const username = String((req.body && req.body.username) || '').trim();
    const senha = String((req.body && req.body.senha) || '');
    const u = authMw.buscarUsuario(username);
    if (!u || !authMw.verificarSenha(senha, u.senhaHash)) {
        _registrarFalhaLogin(ip);
        return res.status(401).json({ error: 'Credenciais invalidas.' });
    }
    _loginTentativas.delete(ip);
    const token = authMw.assinarSessao(u);
    authMw.setCookieSessao(res, token);
    res.json({ ok: true, username: u.username, nome: u.nome, perfil: u.perfil, expiresIn: authMw.SESSAO_HORAS * 3600 });
});

app.post('/api/auth/logout', (req, res) => {
    authMw.limparCookieSessao(res);
    res.json({ ok: true });
});

// Tudo em /api daqui para baixo exige sessao (cookie HttpOnly — imune a roubo via XSS)
function requireAuthApi(req, res, next) {
    const u = authMw.sessaoDeReq(req);
    if (!u) return res.status(401).json({ error: 'Nao autenticado. Faca login.' });
    req.usuario = u;
    next();
}
function requireAdminApi(req, res, next) {
    const u = authMw.sessaoDeReq(req);
    if (!u) return res.status(401).json({ error: 'Nao autenticado. Faca login.' });
    if (u.perfil !== 'ADMIN') return res.status(403).json({ error: 'Restrito a administradores (ADMIN).' });
    req.usuario = u;
    next();
}
app.use('/api', requireAuthApi);

app.get('/api/auth/me', (req, res) => {
    res.json({ username: req.usuario.username, nome: req.usuario.nome, perfil: req.usuario.perfil });
});

// Criar usuario — SOMENTE administradores logados (o registro publico era falso e ficou aberto)
app.post('/api/auth/register', requireAdminApi, (req, res) => {
    const r = authMw.criarUsuario({
        username: req.body && req.body.username,
        senha: req.body && req.body.senha,
        nome: req.body && req.body.nome,
        perfil: req.body && req.body.perfil
    });
    if (r.erro) return res.status(400).json({ error: r.erro });
    res.json(r);
});

// ---- SSE: atualizacao em tempo real do monitoramento ----
const sseClients = new Set();
function sseBroadcast(tipo, dados) {
    const msg = 'event: ' + tipo + '\ndata: ' + JSON.stringify(dados) + '\n\n';
    for (const res of sseClients) {
        try { res.write(msg); } catch (e) { sseClients.delete(res); }
    }
}
app.get('/api/monitor/stream', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });
    res.write('event: connected\ndata: {}\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
});

// ---- Enriquecimento do painel com Zabbix (unico caminho p/ SSE e API — evita dados piscando) ----
// Cache separado para dados e metricas (timestamps independentes) para evitar
// que a expiracao de um invalide o outro.
let _zbCache = { dados: null, dadosTs: 0, metricas: null, metricasTs: 0 };
const ZB_CACHE_MS = 15000; // 15s: reutiliza ultimo dado valido

// Rastreia quando cada IP teve dados frescos do Zabbix (para nao aplicar cache expirado em hosts offline)
let _zbHostFresh = {}; // { ip: timestamp }
// Rastreia se a ultima chamada ao Zabbix API foi bem-sucedida
let _zbUltimaChamadaOK = false;

async function enriquecerPainelComZabbix(painel) {
    if (!painel || !Array.isArray(painel.linhas)) return painel;
    try {
        const zb = require('./monitor/zabbix-bridge');
        const cfg = zb.loadConfig ? zb.loadConfig() : null;
        if (!cfg || !cfg.url) return painel;

        const now = Date.now();

        // 1) Disponibilidade / latencia / perda
        let dadosZb = null;
        try {
            const fresh = await zb.dadosMonitoramentoZabbix();
            if (Array.isArray(fresh) && fresh.length) {
                dadosZb = fresh;
                _zbCache.dados = fresh;
                _zbCache.dadosTs = now;
                _zbUltimaChamadaOK = true;
                // Marca todos os IPs com dados frescos
                for (const z of fresh) {
                    if (z.ip) _zbHostFresh[z.ip] = now;
                }
            } else {
                _zbUltimaChamadaOK = false;
            }
        } catch (e) {
            _zbUltimaChamadaOK = false;
        }

        // Se nao houve dados frescos, verifica se o cache nao expirou
        // Se a ultima chamada falhou, nao usamos cache de disponibilidade (forca reavaliacao)
        if (!dadosZb && _zbCache.dados && (now - _zbCache.dadosTs) < ZB_CACHE_MS && _zbUltimaChamadaOK) {
            dadosZb = _zbCache.dados; // fallback apenas se dentro do TTL (ex: 15s)
        }

        if (Array.isArray(dadosZb) && dadosZb.length) {
            const zbMap = {};
            for (const z of dadosZb) { if (!zbMap[z.ip] || zbMap[z.ip].disponivel === null) zbMap[z.ip] = z; }
            for (const linha of painel.linhas) {
                const z = zbMap[linha.ip];
                const localFresco = linha.ultimoHorario && (now - new Date(linha.ultimoHorario).getTime()) < 120000;
                const ehLocalFresco = !!linha.local && localFresco;
                if (z) {
                    // Host LOCAL: o coletor local e a fonte de verdade — o Zabbix
                    // nunca rebaixa o estado nem a latencia do PC do servidor.
                    const indisponivelZb = ehLocalFresco ? false :
                        (z.disponivel === false) || (z.available === '2') ||
                        (z.available === '0' && z.error) ||
                        (z.disponivel === null && z.available === '0' && z.error);
                    linha.zabbix = {
                        disponivel: z.disponivel,
                        latenciaMs: z.latenciaMs,
                        perdaPct: z.perdaPct,
                        available: z.available,
                        error: z.error,
                        indisponivelZb: indisponivelZb,
                        atualizadoEm: now
                    };
                    if (ehLocalFresco) continue; // nao rebaixa estado local
                    if (!localFresco || indisponivelZb) {
                        if (indisponivelZb) {
                            if (linha.estado === 'ACESSIVEL') linha.estado = 'SEM_RESPOSTA';
                        } else if (z.disponivel === true) {
                            if (linha.estado !== 'ACESSIVEL') linha.estado = 'ACESSIVEL';
                        } else if (z.disponivel === false) {
                            if (linha.estado === 'ACESSIVEL') linha.estado = 'SEM_RESPOSTA';
                        }
                        if (z.latenciaMs != null) linha.latenciaMediaMs = z.latenciaMs;
                    }
                } else {
                    // Host nao esta mais no Zabbix ou nao retornou dados
                    if (linha.local) continue; // host local: nunca marcar SEM_DADOS por causa do Zabbix
                    const temDadosFrescos = _zbHostFresh[linha.ip] && (now - _zbHostFresh[linha.ip]) < ZB_CACHE_MS;
                    if (!temDadosFrescos && linha.estado === 'ACESSIVEL') {
                        linha.estado = 'SEM_DADOS';
                    }
                }
            }
        } else {
            // Sem dados do Zabbix de todo: invalida hosts que estavam acessiveis sem dados frescos
            for (const linha of painel.linhas) {
                if (linha.local) continue; // host local nunca cai para SEM_DADOS por falha do Zabbix
                const temDadosFrescos = _zbHostFresh[linha.ip] && (now - _zbHostFresh[linha.ip]) < ZB_CACHE_MS;
                if (!temDadosFrescos && linha.estado === 'ACESSIVEL') {
                    linha.estado = 'SEM_DADOS';
                    linha.zabbix = { indisponivelZb: true, error: 'Zabbix sem resposta', atualizadoEm: now };
                }
            }
        }

        // 2) Metricas completas (CPU/RAM/Disco/Uptime)
        let metricasZb = null;
        try {
            const freshM = await zb.dadosCompletosZabbix();
            if (Array.isArray(freshM) && freshM.length) {
                metricasZb = freshM;
                _zbCache.metricas = freshM;
                _zbCache.metricasTs = now;
                _zbUltimaChamadaOK = true;
            } else {
                _zbUltimaChamadaOK = false;
            }
        } catch (e) {
            _zbUltimaChamadaOK = false;
        }
        if (!metricasZb && _zbCache.metricas && (now - _zbCache.metricasTs) < ZB_CACHE_MS && _zbUltimaChamadaOK) {
            metricasZb = _zbCache.metricas; // fallback apenas se dentro do TTL (ex: 15s)
        }

        if (Array.isArray(metricasZb) && metricasZb.length) {
            const mzMap = {};
            for (const m of metricasZb) { if (m.ip) mzMap[m.ip] = m; }
            for (const linha of painel.linhas) {
                const mz = mzMap[linha.ip];
                if (mz) {
                    // Se o host esta indisponível no Zabbix, nao aplicar metricas do cache
                    const z = linha.zabbix || {};
                    if (z.indisponivelZb) continue;
                    // Host LOCAL: metricas do coletor local sao canonicas — nunca sobrescrever com o Zabbix
                    if (linha.local) continue;

                    // Validar idade dos dados do Zabbix (se muito antigos ou sem lastclock, nao aplicar)
                    let metricaFresca = true;
                    const idadeMaximaMs = 300000; // 5 minutos
                    const lastclock = mz._lastclock || mz.lastclock;
                    if (!lastclock) {
                        // Sem confirmacao de frescor — nunca aplica (evita dados falsos/zeros)
                        metricaFresca = false;
                    } else if ((now - parseInt(lastclock) * 1000) > idadeMaximaMs) {
                        metricaFresca = false;
                        if (!(linha.fonte || '').includes('ZABBIX_DADOS_ANTIGOS')) linha.fonte = (linha.fonte || '') + ' ZABBIX_DADOS_ANTIGOS';
                    }

                    if (metricaFresca) {
                        let algumAplicado = false;
                        if (mz.cpu != null) { linha.cpu = mz.cpu + '% (Zabbix)'; linha._zabbixCpu = mz.cpu; algumAplicado = true; }
                        if (mz.gpu != null) { linha.gpu = mz.gpu + '% (Zabbix)'; linha._zabbixGpu = mz.gpu; algumAplicado = true; }
                        if (mz.ram && mz.ram.usadoPct != null) { linha.ram = mz.ram.usadoPct + '% (' + (mz.ram.disponivelPct || '?') + '% livre) (Zabbix)'; linha._zabbixRam = mz.ram; algumAplicado = true; }
                        if (mz.disco && mz.disco.length) { linha.disco = mz.disco.map(d => (100 - (d.livrePct || 0)).toFixed(1) + '% usado').join(' | ') + ' (Zabbix)'; linha._zabbixDisco = mz.disco; algumAplicado = true; }
                        if (mz.uptime != null) { const dias = Math.floor(mz.uptime / 86400); const horas = Math.floor((mz.uptime % 86400) / 3600); linha.uptime = dias + 'd ' + horas + 'h (Zabbix)'; linha._zabbixUptime = mz.uptime; algumAplicado = true; }
                        if (algumAplicado && !(linha.fonte || '').includes('ZABBIX')) linha.fonte = (linha.fonte || '') + (linha.fonte ? ' + ' : '') + 'ZABBIX';
                        linha._zabbixAtualizadoEm = now;
                    }
                }
            }
        }
    } catch (e) {}
    return painel;
}

// ---- SSE: push automatico de metricas do PC local a cada 3s ----
setInterval(async () => {
    if (sseClients.size === 0) return;
    try {
        const m = await monitor.coletarMetricasLocais();
        sseBroadcast('sistema', {
            hostname: m.hostname, info: m.info, cpu: m.cpu, gpu: m.gpu,
            memoria: m.memoria, disco: m.disco, uptime: m.uptime,
            rede: m.rede, quando: m.quando
        });
    } catch (e) {}
}, 3000);

// ---- SSE: push das metricas EM TEMPO REAL do PC local (CPU/GPU) ----
// O amostrador persistente dispara a cada amostra (~1s de CPU, ~2s de GPU);
// aqui so encaminhamos ao navegador — sem polling e sem spawn de PowerShell.
// (antes: o frontend fazia poll a cada 3s em endpoints que spawnavam PS novo,
//  e a GPU chamava a coleta COMPLETA de ~7s -> dado sempre atrasado)
const tempoRealMonitor = require('./monitor/tempo-real');
tempoRealMonitor.iniciar();
tempoRealMonitor.aoAtualizar((estado) => {
    if (sseClients.size === 0) return;
    sseBroadcast('metricas-tempo-real', estado);
});

// ---- SSE: push do painel real (Zabbix + local) a cada 15s ----
setInterval(async () => {
    if (sseClients.size === 0) return;
    try {
        const painel = monitor.obterPainel();
        // Usa o mesmo enriquecimento da API (/api/monitor/painel) para que
        // CPU/RAM/Disco/Uptime do Zabbix sejam incluidos no SSE. Antes o SSE
        // so enriquecia disponibilidade/latencia, causando "piscar" INDISP./valor.
        const painelEnr = await enriquecerPainelComZabbix(painel);
        sseBroadcast('painel', painelEnr);
    } catch (e) {}
}, 5000);

// ---- dados do inventario (cadastro de computadores) ----
const DATA_FILE = path.join(__dirname, 'data.json');

/**
 * Escrita ATOMICA de JSON: grava num arquivo temporario (no mesmo diretorio)
 * e renomeia. Nunca deixa data.json truncado/invalido se o processo cair no
 * meio da escrita — o proximo save nao apaga o cadastro.
 */
function gravarJsonAtomico(file, obj) {
    const tmp = file + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
    let fd = fs.openSync(tmp, 'w');
    try {
        fs.writeFileSync(fd, JSON.stringify(obj, null, 2), 'utf8');
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
}

/** Le data.json com seguranca (BOM, JSON invalido, arquivo ausente). */
function lerJsonSeguro(file, fallback) {
    try {
        let raw = fs.readFileSync(file, 'utf8');
        if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
        return JSON.parse(raw);
    } catch (e) { return fallback; }
}
app.get('/api/rev', (req, res) => {
    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        res.json({ rev: (data && typeof data._rev === 'number') ? data._rev : 0 });
    } catch (e) { res.json({ rev: 0 }); }
});
app.get('/api/data', (req, res) => {
    try {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        res.type('application/json').send(raw);
    } catch (e) { res.status(404).json({}); }
});
app.post('/api/data', (req, res) => {
    try {
        const body = req.body || {};
        const current = lerJsonSeguro(DATA_FILE, {});
        const baseRev = (body.baseRev != null) ? body.baseRev : null;
        // Controle de concorrência OTIMISTA REAL: se a revisão do cliente está
        // desatualizada, rejeita (409) em vez de sobrescrever silenciosamente.
        if (baseRev != null && current._rev != null && baseRev !== current._rev) {
            return res.status(409).json({ error: 'Conflito de revisão: o cadastro foi alterado em outra aba/sessão.', rev: current._rev, baseRev });
        }
        const newData = {
            computadores: Array.isArray(body.computadores) ? body.computadores : (current.computadores || []),
            manutencoes: Array.isArray(body.manutencoes) ? body.manutencoes : (current.manutencoes || []),
            ordens: Array.isArray(body.ordens) ? body.ordens : (current.ordens || []),
            usuarios: Array.isArray(body.usuarios) ? body.usuarios : (current.usuarios || []),
            departamentos: Array.isArray(body.departamentos) ? body.departamentos : (current.departamentos || []),
            software: Array.isArray(body.software) ? body.software : (current.software || []),
            ramais: Array.isArray(body.ramais) ? body.ramais : (current.ramais || []),
            trocas: Array.isArray(body.trocas) ? body.trocas : (current.trocas || []),
            logs: Array.isArray(body.logs) ? body.logs : (current.logs || []),
            _rev: (current._rev || 0) + 1
        };
        gravarJsonAtomico(DATA_FILE, newData);
        res.json({ rev: newData._rev, merged: false });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/upload', (req, res) => {
    try {
        const { filename, data } = req.body || {};
        const base64 = (data || '').split(',').pop();
        const buf = Buffer.from(base64, 'base64');
        const safe = (filename || 'upload.bin').replace(/[^a-zA-Z0-9._-]/g, '_');
        const outPath = path.join(__dirname, 'uploads', Date.now() + '_' + safe);
        fs.writeFileSync(outPath, buf);
        res.json({ url: '/uploads/' + path.basename(outPath) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== INVENTÁRIO REST API (compatibilidade frontend) ====================
function carregarDados() {
    return lerJsonSeguro(DATA_FILE, {});
}

/** Grava data.json preservando as demais secoes e incrementando _rev. */
function gravarDados(db) {
    const atual = carregarDados();
    const novo = Object.assign({}, atual, db);
    novo._rev = (atual._rev || 0) + 1;
    gravarJsonAtomico(DATA_FILE, novo);
    return novo._rev;
}

/**
 * Persiste APENAS as mudancas de IP vindas do Zabbix no data.json.
 * Re-le o arquivo fresco (minimiza corrida com o POST /api/data do frontend),
 * aplica so os IPs via zb.aplicarMudancasIp e grava sincrono com _rev+1.
 * @returns {Array} lista de alteracoes efetivamente aplicadas
 */
function gravarIpsNoDados(alteracoes) {
    if (!Array.isArray(alteracoes) || alteracoes.length === 0) return [];
    const zb = require('./monitor/zabbix-bridge');
    const fresco = carregarDados();
    const r = zb.aplicarMudancasIp(alteracoes, fresco);
    if (r.aplicados.length) {
        fresco._rev = (fresco._rev || 0) + 1;
        gravarJsonAtomico(DATA_FILE, fresco);
        console.log('[zabbix] IP(s) do cadastro atualizado(s): '
            + r.aplicados.map(a => a.nome + ': ' + (a.ipAntigo || '?') + ' -> ' + a.ipNovo).join('; '));
    }
    return r.aplicados;
}

function paginar(array, page, size) {
    const start = (page || 0) * (size || 10);
    return array.slice(start, start + (size || 10));
}

// Computadores - Estatísticas
app.get('/api/computadores/estatisticas', (req, res) => {
    try {
        const db = carregarDados();
        const comps = db.computadores || [];
        const ativos = comps.filter(c => c.status === 'ATIVO').length;
        const preditiva = comps.filter(c => c.status === 'MANUTENCAO_PREDITIVA').length;
        const preventiva = comps.filter(c => c.status === 'MANUTENCAO_PREVENTIVA').length;
        const emergencial = comps.filter(c => c.status === 'MANUTENCAO_EMERGENCIAL').length;
        const concluso = comps.filter(c => c.status === 'CONCLUIDO').length;
        // Ciclo de manutencao de 240 dias — mesma regra do frontend computeCycle()
        const fases = { ATIVO: 0, PREDITIVO: 0, PREVENTIVO: 0, ATRASADO: 0 };
        let vencidos = 0;
        for (const c of comps) {
            const inicio = new Date(c.dataInicioCiclo || c.dataCadastro);
            const dias = isNaN(inicio.getTime()) ? 0 : Math.floor((Date.now() - inicio.getTime()) / 86400000);
            if (dias > 240) { fases.ATRASADO++; vencidos++; }
            else if (dias > 180) fases.PREVENTIVO++;
            else if (dias > 120) fases.PREDITIVO++;
            else fases.ATIVO++;
        }
        res.json({
            total: comps.length,
            ativos,
            manutencaoPreditiva: preditiva,
            manutencaoPreventiva: preventiva,
            manutencaoEmergencial: emergencial,
            concluso,
            concluidos: concluso,
            manutencaoVencida: vencidos,
            faseAtivo: fases.ATIVO,
            fasePreditivo: fases.PREDITIVO,
            fasePreventivo: fases.PREVENTIVO,
            faseAtrasado: fases.ATRASADO,
            porStatus: {
                ATIVO: ativos,
                MANUTENCAO_PREDITIVA: preditiva,
                MANUTENCAO_PREVENTIVA: preventiva,
                MANUTENCAO_EMERGENCIAL: emergencial,
                CONCLUIDO: concluso
            }
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Computadores - Paginado com filtros
app.get('/api/computadores/paginado', (req, res) => {
    try {
        const db = carregarDados();
        let comps = db.computadores || [];
        const page = parseInt(req.query.page) || 0;
        const size = parseInt(req.query.size) || 10;
        const status = req.query.status || '';
        const termo = (req.query.termo || '').toLowerCase();

        if (status) comps = comps.filter(c => c.status === status);
        if (termo) comps = comps.filter(c =>
            (c.nomePc || '').toLowerCase().includes(termo) ||
            (c.modeloMarca || '').toLowerCase().includes(termo) ||
            (c.numeroSerie || '').toLowerCase().includes(termo) ||
            (c.usuarioDesignado || '').toLowerCase().includes(termo)
        );

        const total = comps.length;
        const content = paginar(comps, page, size);
        res.json({ content, total, page, size, totalPages: Math.ceil(total / size) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Computadores - Alertas (próximas manutenções, etc)
app.get('/api/computadores/alertas', (req, res) => {
    try {
        const db = carregarDados();
        const comps = db.computadores || [];
        const agora = new Date();
        const alertas = [];
        for (const c of comps) {
            if (c.proximaManutencao) {
                const prox = new Date(c.proximaManutencao);
                const diffDias = Math.ceil((prox - agora) / (1000 * 60 * 60 * 24));
                if (diffDias <= 30 && diffDias >= 0) {
                    alertas.push({
                        computadorId: c.id,
                        computadorNome: c.nomePc,
                        tipo: 'MANUTENCAO_PROXIMA',
                        dias: diffDias,
                        data: c.proximaManutencao
                    });
                } else if (diffDias < 0) {
                    alertas.push({
                        computadorId: c.id,
                        computadorNome: c.nomePc,
                        tipo: 'MANUTENCAO_ATRASADA',
                        dias: Math.abs(diffDias),
                        data: c.proximaManutencao
                    });
                }
            }
        }
        res.json({ totalAlertas: alertas.length, alertas });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Manutenções - Estatísticas
app.get('/api/manutencoes/estatisticas', (req, res) => {
    try {
        const db = carregarDados();
        const mans = db.manutencoes || [];
        const pendente = mans.filter(m => m.status === 'PENDENTE').length;
        const emAndamento = mans.filter(m => m.status === 'EM_ANDAMENTO').length;
        const concluida = mans.filter(m => m.status === 'CONCLUIDA').length;
        const cancelada = mans.filter(m => m.status === 'CANCELADA').length;
        const preventiva = mans.filter(m => m.tipo === 'PREVENTIVA').length;
        const preditiva = mans.filter(m => m.tipo === 'PREDITIVA').length;
        const emergencial = mans.filter(m => m.tipo === 'EMERGENCIAL').length;
        const corretiva = mans.filter(m => m.tipo === 'CORRETIVA').length;
        const porMes = {};
        for (const m of mans) {
            if (!m.dataCadastro) continue;
            const dt = new Date(m.dataCadastro);
            if (isNaN(dt.getTime())) continue;
            const k = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
            porMes[k] = (porMes[k] || 0) + 1;
        }
        res.json({
            total: mans.length,
            pendente, emAndamento, concluida, cancelada,
            preventiva, preditiva, emergencial, corretiva,
            // aliases no contrato do frontend (plural) — mesma fonte, sem recalculo
            pendentes: pendente, concluidas: concluida, canceladas: cancelada,
            porTipo: { CORRETIVA: corretiva, PREVENTIVA: preventiva, PREDITIVA: preditiva, EMERGENCIAL: emergencial },
            porStatus: { PENDENTE: pendente, EM_ANDAMENTO: emAndamento, CONCLUIDA: concluida, CANCELADA: cancelada },
            porMes
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ordens de Serviço - Estatísticas
app.get('/api/ordens-servico/estatisticas', (req, res) => {
    try {
        const db = carregarDados();
        const os = db.ordens || [];
        const aberta = os.filter(o => o.status === 'ABERTA').length;
        const emAnalise = os.filter(o => o.status === 'EM_ANALISE').length;
        const emExecucao = os.filter(o => o.status === 'EM_EXECUCAO').length;
        const concluida = os.filter(o => o.status === 'CONCLUIDA').length;
        const cancelada = os.filter(o => o.status === 'CANCELADA').length;
        const baixa = os.filter(o => o.prioridade === 'BAIXA').length;
        const media = os.filter(o => o.prioridade === 'MEDIA').length;
        const alta = os.filter(o => o.prioridade === 'ALTA').length;
        const critica = os.filter(o => o.prioridade === 'CRITICA').length;
        res.json({
            total: os.length,
            aberta, emAnalise, emExecucao, concluida, cancelada,
            baixa, media, alta, critica,
            // aliases no contrato do frontend (plural) — mesma fonte, sem recalculo
            abertas: aberta, concluidas: concluida, canceladas: cancelada,
            porPrioridade: { BAIXA: baixa, MEDIA: media, ALTA: alta, CRITICA: critica },
            porStatus: { ABERTA: aberta, EM_ANALISE: emAnalise, EM_EXECUCAO: emExecucao, CONCLUIDA: concluida, CANCELADA: cancelada }
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ramais - Lista completa
app.get('/api/ramais', (req, res) => {
    try {
        const db = carregarDados();
        res.json(db.ramais || []);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Trocas - Lista completa
app.get('/api/trocas', (req, res) => {
    try {
        const db = carregarDados();
        res.json(db.trocas || []);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Logs - Paginado
app.get('/api/logs', (req, res) => {
    try {
        const db = carregarDados();
        let logs = db.logs || [];
        const page = parseInt(req.query.page) || 0;
        const size = parseInt(req.query.size) || 10;
        // Ordenar por data desc
        logs.sort((a, b) => new Date(b.dataAtividade) - new Date(a.dataAtividade));
        const total = logs.length;
        const content = paginar(logs, page, size);
        res.json({ content, total, page, size, totalPages: Math.ceil(total / size) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== MONITORAMENTO ====================
app.get('/api/monitor/painel', async (req, res) => {
    try {
        const painel = monitor.obterPainel();
        // Usa o MESMO enriquecimento do SSE para garantir consistencia absoluta
        try { painel = await enriquecerPainelComZabbix(painel); } catch (e) {}
        res.json(painel);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Painel mock — 101 PCs do inventario original (192.168.0.94:3030)
app.get('/api/monitor/mock/painel', (req, res) => {
    try { res.json(mockEngine.gerarPainelMock()); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/monitor/host/:ip/historico', (req, res) => {
    try { res.json(monitor.getHostHistorico(decodeURIComponent(req.params.ip))); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/monitor/mock/:ip', (req, res) => {
    try {
        const ip = decodeURIComponent(req.params.ip);
        // Tenta primeiro pelo mock-engine (PCs do inventario), depois pelo service
        const m = mockEngine.obterHistoricoMock(ip);
        if (m && m.historico && m.historico.length) return res.json(m);
        res.json(monitor.getMockMetricas(ip) || { historico: [] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/monitor/sistema', async (req, res) => {
    try {
        const atual = monitor.obterMetricasLocais();
        const velho = !atual || (Date.now() - new Date(atual.quando).getTime() > 3000);
        const m = velho ? await monitor.coletarMetricasLocais() : atual;
        res.json({
            hostname: m.hostname, info: m.info, cpu: m.cpu, gpu: m.gpu,
            memoria: m.memoria, disco: m.disco, uptime: m.uptime,
            rede: m.rede, quando: m.quando
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== CPU EM TEMPO REAL ====================
// Le do AMOSTRADOR PERSISTENTE (1 amostra/s, contador do Task Manager).
// Antes spawnavam um PowerShell novo por chamada (~2s) -> valor sempre velho.
app.get('/api/monitor/cpu-tempo-real', async (req, res) => {
    try {
        const s = tempoRealMonitor.obter();
        if (s.cpu != null && s.cpuIdadeMs != null && s.cpuIdadeMs < 4000) {
            return res.json({
                cpu: s.cpu, ts: s.ts, idadeMs: s.cpuIdadeMs,
                fonte: s.cpuFonte, contador: 'Processor Information / % Processor Utility (o mesmo do Task Manager)'
            });
        }
        // Fallback pontual: contador direto (ainda assim com a cadeia correta)
        const hostmetrics = require('./monitor/hostmetrics');
        const cpu = await hostmetrics.coletarCpuApenas();
        if (cpu != null) return res.json({ cpu, ts: Date.now(), idadeMs: 0, fonte: 'contador-direto' });
        res.json({ cpu: s.cpu, ts: s.ts, idadeMs: s.cpuIdadeMs, fonte: s.cpuFonte, semDados: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== GPU EM TEMPO REAL ====================
// Le do AMOSTRADOR (GPU a cada 2s, sem custo). Antes chamava hostmetrics.coletar()
// — a coleta COMPLETA de ~6.9s (disco+WMI+3 amostras de GPU) -> GPU sempre atrasada.
app.get('/api/monitor/gpu-tempo-real', async (req, res) => {
    try {
        const hostmetrics = require('./monitor/hostmetrics');
        const s = tempoRealMonitor.obter();
        if (s.gpu != null && s.gpuIdadeMs != null && s.gpuIdadeMs < 8000) {
            // Nome: responde com cache; se nunca foi resolvido, dispara em
            // background (nao bloqueia o request — nome aparece na proxima).
            let nome = hostmetrics.gpuNome();
            if (!nome) { hostmetrics.resolverNomeGpu().catch(() => {}); }
            return res.json({
                gpu: s.gpu, nome: nome || 'GPU local', ts: s.gpuTs, idadeMs: s.gpuIdadeMs,
                fonte: s.gpuFonte, amostra: 'GPU Engine Utilization (amostrador a cada 2s)'
            });
        }
        // Fallback raro: GPU sem amostra fresca -> resolve nome+coleta sob demanda
        const m2 = await hostmetrics.coletar(null);
        if (m2 && m2.gpu && m2.gpu.gpus && m2.gpu.gpus.length) {
            const g = m2.gpu.gpus[0];
            return res.json({ gpu: g.usoPct, nome: g.nome, ts: Date.now(), idadeMs: 0, fonte: m2.gpu.fonte });
        }
        res.json({ gpu: null, nome: null, ts: 0, idadeMs: null, fonte: 'indisponivel', motivo: m2 && m2.gpu ? m2.gpu.indisponivel : 'Sem dados' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/monitor/host/:ip', (req, res) => {
    try { res.json(monitor.obterDetalheHost(decodeURIComponent(req.params.ip))); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/monitor/ciclo', async (req, res) => {
    try { await monitor.executarCiclo(); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/monitor/config', requireAdminApi, (req, res) => res.json(monitor.getConfig()));
app.post('/api/monitor/config', requireAdminApi, (req, res) => {
    try {
        const CONFIG_PATH = path.join(__dirname, 'monitor', 'config.json');
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(req.body, null, 2), 'utf8');
        monitor.recarregarConfig();
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/monitor/targets', (req, res) => {
    try { res.json(store.lerAlvos()); }
    catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/monitor/targets', (req, res) => {
    try {
        const fs2 = require('fs');
        const TARGETS_PATH = path.join(__dirname, 'monitor', 'data', 'targets.json');
        let alvos = [];
        try {
            const raw = fs2.readFileSync(TARGETS_PATH, 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) alvos = parsed;
            else if (parsed && parsed.ipAddress) alvos = [parsed];
        } catch (e) {}
        // Normaliza o novo alvo
        const novo = req.body || {};
        if (novo.ipAddress || novo.ip) {
            const ip = novo.ipAddress || novo.ip;
            // Evita duplicatas
            if (!alvos.some(a => (a.ipAddress || a.ip) === ip)) {
                alvos.push({
                    id: novo.id || Date.now(),
                    nome: novo.nomePc || novo.nome || ('PC-' + ip),
                    ip: ip,
                    ipAddress: ip,
                    setor: novo.departamento || novo.setor || 'TI',
                    departamento: novo.departamento || novo.setor || 'TI',
                    ativo: true,
                    fonte: 'API'
                });
            }
        } else if (Array.isArray(req.body)) {
            for (const item of req.body) {
                const ip = item.ipAddress || item.ip;
                if (ip && !alvos.some(a => (a.ipAddress || a.ip) === ip)) {
                    alvos.push(Object.assign({ ativo: true, fonte: 'API' }, item));
                }
            }
        }
        fs2.writeFileSync(TARGETS_PATH, JSON.stringify(alvos, null, 2));
        res.json({ ok: true, total: alvos.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/monitor/alertas', (req, res) => {
    try { res.json(store.lerAlertas()); }
    catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/monitor/alertas', (req, res) => {
    try {
        const fs2 = require('fs');
        fs2.writeFileSync(path.join(__dirname, 'monitor', 'data', 'alerts.json'), JSON.stringify(req.body, null, 2));
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Registra callback para emitir SSE apos cada ciclo
// Map<id, estado> (nao Set): detecta reabertura de alerta com o mesmo id.
let _alertasConhecidos = new Map();
try { store.lerAlertas().forEach(a => _alertasConhecidos.set(a.id, a.estado)); } catch (e) {}
let _zbStatusAnterior = null; // rastreia se Zabbix estava online/offline
monitor.aoFinalizarCiclo(async function(painel) {
    // Inclui metricas mock de todos os hosts mock
    const mockIps = (painel.linhas || [])
        .filter(l => l.ip === '192.168.0.220')
        .map(l => l.ip);
    const mockData = {};
    for (const ip of mockIps) {
        const m = monitor.getMockMetricas(ip);
        if (m) mockData[ip] = m;
    }
    painel.mockMetricas = mockData;
    // Usa o MESMO enriquecimento da API para evitar piscar INDISP. no SSE
    try { painel = await enriquecerPainelComZabbix(painel); } catch (e) {}
    sseBroadcast('painel', painel);

    // Notifica clientes SSE sobre alertas novos (falhas diagnosticadas)
    try {
        const alertas = store.lerAlertas().filter(a => a.estado === 'ABERTO' || a.estado === 'ACK');
        // estados classificados como desligamento esperado nao disparam toast
        const suprimidos = new Set((painel.linhas || [])
            .filter(l => l.classificacao && l.classificacao.suprimeAlerta)
            .map(l => l.ip));
        for (const a of alertas) {
            if (suprimidos.has(a.host)) continue;
            if (_alertasConhecidos.get(a.id) === a.estado) continue; // ja emitido, sem mudanca
            _alertasConhecidos.set(a.id, a.estado);
            a.fonte = a.fonte || 'COLETOR';
            sseBroadcast('alerta', a);
        }
    } catch (e) {}

    // Alerta proativo quando Zabbix fica online/offline
    try {
        const zbOnline = !!(_zbUltimaChamadaOK && _zbCache.dados && Array.isArray(_zbCache.dados) && _zbCache.dados.length);
        if (_zbStatusAnterior !== zbOnline) {
            _zbStatusAnterior = zbOnline;
            const alerta = {
                id: 'ZB-STATUS-' + Date.now(),
                categoria: zbOnline ? 'INFRA' : 'INFRA',
                gravidade: zbOnline ? 'INFO' : 'ALTA',
                host: 'SERVIDOR',
                titulo: zbOnline ? 'Zabbix reconectado' : 'Zabbix desconectado',
                evidencias: [
                    zbOnline
                        ? 'API do Zabbix respondeu com sucesso (porta 8081)'
                        : 'Falha ao conectar na API do Zabbix (http://127.0.0.1:8081). Verifique se o Docker Desktop esta rodando.'
                ],
                confianca: 'CONFIRMADO',
                recomendacao: zbOnline
                    ? 'Monitoramento via Zabbix restaurado.'
                    : 'Iniciar Docker Desktop e rodar: docker compose -f docker-compose.zabbix.yml up -d',
                estado: 'ABERTO',
                ocorrencias: 1,
                criadoEm: new Date().toISOString(),
                fonte: 'ZABBIX_STATUS'
            };
            sseBroadcast('alerta', alerta);
        }
    } catch (e) {}
});

// ---- Zabbix ----
app.get('/api/zabbix/status', async (req, res) => {
    try {
        const zb = require('./monitor/zabbix-bridge');
        const cfgStatus = zb.getConfigStatus();
        res.json({ configurado: cfgStatus.configurado, nota: cfgStatus.nota });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/zabbix/resumo', async (req, res) => {
    try {
        const cfg = require('./monitor/config.json');
        if (cfg && cfg.zabbix && cfg.zabbix.habilitado === false) {
            return res.json({
                conectado: false,
                desabilitado: true,
                mensagem: 'Zabbix desabilitado na configuracao atual. Ative monitor/config.json para reativar a integracao.',
                atualizadoEm: new Date().toISOString()
            });
        }
        const zb = require('./monitor/zabbix-bridge');
        const r = await zb.resumoMonitoramento();
        res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/zabbix/host/:ip', async (req, res) => {
    try {
        const zb = require('./monitor/zabbix-bridge');
        res.json(await zb.monitoramentoHost(decodeURIComponent(req.params.ip)));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/zabbix/hosts', async (req, res) => {
    try {
        const zb = require('./monitor/zabbix-bridge');
        const r = await zb.listarHosts();
        // Enriquece a disponibilidade real: para hosts sem agente passivo
        // (interface available=0/unknown), usa icmpping/agent.ping para
        // determinar se esta disponivel. Evita mostrar "Aguardando" para
        // hosts que estao respondendo (bug reportado pelo usuario).
        const enriquecidos = await zb.enriquecerDisponibilidade(r);
        res.json(enriquecidos);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Sincronizacao COMPLETA: hosts + manutencoes (le o data.json do servidor).
// Corrige o bug antigo que chamava zb.sincronizarHosts() (funcao inexistente).
app.post('/api/zabbix/sincronizar', async (req, res) => {
    try {
        const zb = require('./monitor/zabbix-bridge');
        const db = carregarDados();
        const computadores = Array.isArray(db.computadores) ? db.computadores : [];
        const ordens = Array.isArray(db.ordensServico) ? db.ordensServico
            : (Array.isArray(db.ordens) ? db.ordens : []);
        // IP adaptativo PRIMEIRO (Zabbix -> cadastro): o agente ja avisou o
        // servidor sobre o IP novo via auto-registro. Se rodarmos o host sync
        // antes, ele empurraria o IP VELHO do cadastro para o Zabbix e apagaria
        // a mudanca que o agente acabou de registrar (falso negativo).
        let ips = null;
        if (!req.body || req.body.ips !== false) {
            try {
                ips = await zb.sincronizarIpsDoZabbix(db);
                // persiste so os IPs num read fresco (nao sobrescreve edicoes do frontend)
                ips.aplicados = gravarIpsNoDados(ips.aplicados);
            } catch (e) { ips = { aplicados: [], ignorados: [], semVinculo: [], erros: [e.message] }; }
        }
        // Depois: hosts + manutencoes (cadastro -> Zabbix), ja com IP atualizado.
        const hosts = await zb.sincronizarHostsInventario(computadores);
        let manutencoes = null;
        if (!req.body || req.body.manutencoes !== false) {
            try { manutencoes = await zb.sincronizarManutencoes(computadores, ordens); }
            catch (e) { manutencoes = { erros: [e.message] }; }
        }
        res.json({ ok: true, computadores: computadores.length, hosts, manutencoes, ips, atualizadoEm: new Date().toISOString() });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/zabbix/config', requireAdminApi, (req, res) => {
    try {
        const zb = require('./monitor/zabbix-bridge');
        // Timeout de 5s para nao travar quando Zabbix/Docker offline
        const timer = setTimeout(() => {
            if (!res.headersSent) res.json({ configurado: false, nota: 'Zabbix offline ou timeout' });
        }, 5000);
        res.on('finish', () => clearTimeout(timer));
        const status = zb.getConfigStatus();
        if (!res.headersSent) { clearTimeout(timer); res.json(status); }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/zabbix/config', requireAdminApi, (req, res) => {
    try {
        const CONFIG_PATH = path.join(__dirname, 'monitor', 'zabbix-config.json');
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(req.body, null, 2), 'utf8');
        monitor.recarregarConfig();
        res.json({ ok: true, nota: 'Configuracao atualizada' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Armazenamento ----
// ---- Zabbix: sincronizar hosts do inventario ----
app.post('/api/zabbix/sincronizar-inventario', async (req, res) => {
    try {
        const zb = require('./monitor/zabbix-bridge');
        const dados = req.body && Array.isArray(req.body.computadores)
            ? req.body.computadores
            : (carregarDados().computadores || []);
        const r = await zb.sincronizarHostsInventario(dados);
        res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Zabbix: sincronizar manutencoes (proximaManutencao + ordens abertas) ----
app.post('/api/zabbix/sincronizar-manutencoes', async (req, res) => {
    try {
        const zb = require('./monitor/zabbix-bridge');
        const db = carregarDados();
        const r = await zb.sincronizarManutencoes(
            Array.isArray(db.computadores) ? db.computadores : [],
            Array.isArray(db.ordens) ? db.ordens : []
        );
        res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Zabbix: sincronizar IPs do cadastro a partir do Zabbix (IP adaptativo) ----
// Le os IPs reportados pelos agentes ativos (auto-registro) e atualiza
// data.json. Idempotente — so escreve quando ha diferenca real.
app.post('/api/zabbix/sincronizar-ips', async (req, res) => {
    try {
        const zb = require('./monitor/zabbix-bridge');
        const db = carregarDados();
        const r = await zb.sincronizarIpsDoZabbix(db);
        const aplicados = gravarIpsNoDados(r.aplicados);
        res.json(Object.assign({ ok: true, aplicados, atualizadoEm: new Date().toISOString() }, r));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Zabbix: garantir dashboard "Inventario TI" (idempotente) ----
app.post('/api/zabbix/dashboard', async (req, res) => {
    try {
        const zb = require('./monitor/zabbix-bridge');
        const urlPainel = (req.body && req.body.urlPainel) || `http://${req.hostname}:5903/index.html`;
        const r = await zb.garantirDashboardInventario(urlPainel);
        res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/zabbix/dashboard', async (req, res) => {
    try {
        const zb = require('./monitor/zabbix-bridge');
        res.json(await zb.obterDashboardInventario());
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Zabbix: dados de monitoramento (disponibilidade, latencia, perda) ----
app.get('/api/zabbix/monitoramento', async (req, res) => {
    try {
        const zb = require('./monitor/zabbix-bridge');
        const dados = await zb.dadosMonitoramentoZabbix();
        res.json(dados);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Zabbix: incidentes abertos enriquecidos (para a aba Monitoramento) ----
// Cache curto (10s) para nao martelar a API do Zabbix a cada refresh do painel.
let _zbProblemasCache = { ts: 0, data: null };

// Monta o payload de problemas (usado pelo endpoint REST e pelo push SSE — fonte unica)
async function montarPayloadProblemas(hostid) {
    const agora = Date.now();
    if (!hostid && _zbProblemasCache.data && (agora - _zbProblemasCache.ts) < 10000) {
        return _zbProblemasCache.data;
    }
    const zb = require('./monitor/zabbix-bridge');
    const problemas = await zb.listarProblemasDetalhado(hostid || undefined);
    const porSeveridade = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const p of problemas) porSeveridade[p.severidade] = (porSeveridade[p.severidade] || 0) + 1;
    const payload = {
        conectado: true,
        total: problemas.length,
        criticos: (porSeveridade['4'] || 0) + (porSeveridade['5'] || 0),
        naoReconhecidos: problemas.filter(p => !p.reconhecido).length,
        naoSuprimidos: problemas.filter(p => !p.suppressed).length,
        criticosNaoSuprimidos: problemas.filter(p => (p.severidade === '4' || p.severidade === '5') && !p.suppressed).length,
        suprimidos: problemas.filter(p => p.suppressed).length,
        porSeveridade,
        problemas,
        atualizadoEm: new Date().toISOString()
    };
    if (!hostid) _zbProblemasCache = { ts: agora, data: payload };
    return payload;
}

app.get('/api/zabbix/problemas', async (req, res) => {
    try {
        const hostid = (req.query.hostid || '').trim();
        res.json(await montarPayloadProblemas(hostid || undefined));
    } catch (e) {
        res.json({ conectado: false, erro: e.message, total: 0, criticos: 0, problemas: [], atualizadoEm: new Date().toISOString() });
    }
});

// ---- SSE: push de problemas Zabbix quando algo muda (max 1x a cada 30s) ----
// Assinatura: eventid + reconhecido + suprimido — so envia quando ha diferenca real
let _zbProbSseTs = 0;
let _zbProbSseAssinatura = '';
setInterval(async () => {
    if (sseClients.size === 0) return;
    const agora = Date.now();
    if (agora - _zbProbSseTs < 30000) return;
    _zbProbSseTs = agora;
    try {
        const payload = await montarPayloadProblemas();
        const assinatura = payload.problemas.map(p => p.eventid + ':' + (p.reconhecido ? 1 : 0) + ':' + (p.suppressed ? 1 : 0)).join('|') + '#' + payload.total;
        if (assinatura !== _zbProbSseAssinatura) {
            _zbProbSseAssinatura = assinatura;
            sseBroadcast('zabbix-problemas', payload);
        }
    } catch (e) {}
}, 10000);

// ---- Zabbix: reconhecer problema (acknowledge) — aceita eventid unico ou eventids[] (massa) ----
app.post('/api/zabbix/problemas/ack', async (req, res) => {
    try {
        const body = req.body || {};
        // Normaliza para lista: eventids[] (massa) ou eventid (unico)
        const eventids = Array.isArray(body.eventids)
            ? body.eventids.map(String).filter(Boolean)
            : (body.eventid != null && String(body.eventid) ? [String(body.eventid)] : []);
        if (!eventids.length) return res.status(400).json({ ok: false, error: 'eventid ou eventids obrigatorio' });
        if (eventids.length > 50) return res.status(400).json({ ok: false, error: 'maximo de 50 por chamada' });
        const mensagem = (body.message || 'Reconhecido via Inventario TI').toString().slice(0, 2000);
        const zb = require('./monitor/zabbix-bridge');
        const resultados = [];
        const falhas = [];
        for (const id of eventids) {
            try {
                resultados.push({ eventid: id, ok: true, resultado: await zb.reconhecerProblema(id, mensagem) });
            } catch (e) {
                falhas.push({ eventid: id, erro: e.message });
            }
        }
        // Invalida o cache de problemas para o painel refletir o ack na hora
        _zbProblemasCache = { ts: 0, data: null };
        // Push imediato do novo estado (nao espera o ciclo de 30s)
        try {
            const payload = await montarPayloadProblemas();
            _zbProbSseAssinatura = payload.problemas.map(p => p.eventid + ':' + (p.reconhecido ? 1 : 0) + ':' + (p.suppressed ? 1 : 0)).join('|') + '#' + payload.total;
            sseBroadcast('zabbix-problemas', payload);
        } catch (e) {}
        res.json({ ok: falhas.length === 0, resultados, falhas });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get('/api/zabbix/webhook', (req, res) => {
    res.json(alertasWebhook.slice(0, 50));
});

app.get('/api/monitor/armazenamento', async (req, res) => {
    try {
        const stats = store.estatisticasArmazenamento();
        let discos = [];
        try {
            const m = monitor.obterMetricasLocais();
            if (m && m.disco && m.disco.discos) discos = m.disco.discos;
        } catch (e) {}
        res.json(Object.assign({}, stats, {
            discos: discos,
            retencao: { medicoesDias: (monitor.getConfig().coletor || {}).retencaoMedicoesDias || 30, agregadosDias: 365 }
        }));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/monitor/historico', (req, res) => {
    try {
        const host = req.query.host;
        const dias = parseInt(req.query.dias) || 7;
        if (host) {
            const serie = store.historicoHost(host, dias);
            const ultimas = store.ultimasMedicoes(host, 100);
            // Analise detalhada das falhas (por tipo de erro, com causa e recomendacao)
            let falhasDetalhadas = null;
            try { falhasDetalhadas = store.falhasHost(host, dias, 100); } catch (e) {}
            res.json({ host: host, dias: dias, serie: serie, ultimasMedicoes: ultimas, falhasDetalhadas: falhasDetalhadas, limites: monitor.obterLimites() });
        } else {
            res.json({ error: 'Parametro host e necessario' });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Analise detalhada de falhas de um host (agrupada por tipo de erro)
app.get('/api/monitor/falhas', (req, res) => {
    try {
        const host = req.query.host;
        const dias = parseInt(req.query.dias) || 30;
        if (!host) return res.status(400).json({ error: 'Parametro host e necessario' });
        res.json(store.falhasHost(host, dias, 300));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/monitor/limpar-antigos', (req, res) => {
    try {
        const dias = parseInt(req.body.dias) || 30;
        const removidos = store.limparAntigos(dias);
        res.json({ ok: true, removidos });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Ciclo de coleta ----
const hojeStr = () => new Date().toISOString().slice(0, 10);

app.post('/api/monitor/agregar', async (req, res) => {
    try {
        const dia = (req.body && req.body.dia) || hojeStr();
        const resultado = store.agregarDia(dia);
        res.json({ ok: true, dia, hosts: resultado ? Object.keys(resultado.hosts || {}).length : 0 });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/monitor/agregar-hoje', async (req, res) => {
    try {
        const resultado = store.agregarDia(hojeStr());
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Servico ----
// ---- Identidade local (para o frontend saber qual host e "este PC") ----
// Independente de rede: loopback/localhost sempre contam como local; senao
// compara com os enderecos IPv4 desta maquina. Sem IP fixo no codigo.
app.get('/api/monitor/local', (req, res) => {
    try {
        const os = require('os');
        const LOCAIS = new Set(['127.0.0.1', '::1', '0.0.0.0', 'localhost']);
        const locaisDestaMaquina = new Set(LOCAIS);
        try {
            for (const addrs of Object.values(os.networkInterfaces())) {
                for (const a of (addrs || [])) {
                    if ((a.family === 'IPv4' || a.family === 4) && a.address) locaisDestaMaquina.add(a.address);
                }
            }
        } catch (e) {}
        const alvos = (monitor.obterAlvos && monitor.obterAlvos()) || [];
        const local = alvos.find(t => locaisDestaMaquina.has(String(t.ip || '').toLowerCase())) ||
                      alvos.find(t => LOCAIS.has(String(t.ip || '').toLowerCase())) || alvos[0] || {};
        res.json({ ip: local.ip || '127.0.0.1', nome: local.nome || 'MEU-PC', hostname: os.hostname() });
    } catch (e) {
        res.json({ ip: '127.0.0.1', nome: 'MEU-PC', hostname: require('os').hostname() });
    }
});

app.get('/api/monitor/status', (req, res) => res.json({ rodando: monitor.isRodando() }));

// ---- Static ----
// Fotos de equipamentos: somente usuarios logados (sao dados internos)
app.use('/uploads', requireAuthApi, express.static('uploads'));
// Assets vendorizados (libs/fontes locais): imutaveis, cache longo
// Assets vendorizados (libs/fontes locais): imutaveis, cache de 90 dias.
// (maxAge do express.static e em MILISSEGUNDOS: 90*24*3600*1000 = 7776000000)
// Se atualizar uma lib do vendor/, troque a URL (ex.: ?v=novo) nos HTMLs.
app.use('/vendor', express.static('frontend/vendor', { maxAge: 7776000000, immutable: true }));
// Demais arquivos estaticos: ETag do Express + sem cache longo (front anda rapido)
app.use(express.static('frontend', { maxAge: 0 }));

const servidorHttp = app.listen(PORT, () => {
    console.log('Servidor rodando em http://localhost:' + PORT + ' (acesso externo: http://<IP-desta-maquina>:' + PORT + ')');
    // Inicia o coletor em background (ciclos automaticos + SSE)
    try { monitor.iniciar(); } catch (e) { console.error('[server] falha ao iniciar monitor:', e.message); }

    // Pre-aquecimento do cache Zabbix (evita primeiro SSE com INDISP.)
    setTimeout(async () => {
        try {
            const zb = require('./monitor/zabbix-bridge');
            const cfg = zb.loadConfig ? zb.loadConfig() : null;
            if (cfg && cfg.url) {
                await enriquecerPainelComZabbix(monitor.obterPainel());
                console.log('[zabbix] cache pre-aquecido com sucesso');
            }
        } catch (e) { console.log('[zabbix] pre-aquecimento falhou:', e.message); }
    }, 5000);
});

// Se a porta ja estiver em uso (instancia antiga), ENCERRA o processo em vez
// de virar zumbim: o handler global de uncaughtException so logava e mantinha
// os timers de IP sync rodando sem ninguem escutar HTTP.
servidorHttp.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error('[server] PORTA ' + PORT + ' JA EM USO. Encerre a instancia antiga (taskkill /PID <pid> /F) e reinicie.');
    } else {
        console.error('[server] falha ao abrir servidor:', err.message);
    }
    process.exit(1);
});

// ==================== IP ADAPTATIVO: job periodico ====================
// (registrado dentro do listen via iniciarIpSync — so roda se o HTTP subiu)
let ipSyncEmAndamento = false;
async function ipSyncPeriodico() {
    if (ipSyncEmAndamento) return;
    try {
        const zb = require('./monitor/zabbix-bridge');
        if (!zb.getConfigStatus || !zb.getConfigStatus().configurado) return;
        ipSyncEmAndamento = true;
        const db = carregarDados();
        const r = await zb.sincronizarIpsDoZabbix(db);
        const aplicados = gravarIpsNoDados(r.aplicados);
        if (aplicados.length) console.log('[zabbix] ip-sync periodico: ' + aplicados.length + ' IP(s) atualizado(s)');
        if (r.erros && r.erros.length) console.log('[zabbix] ip-sync periodico erros:', r.erros.join('; '));
    } catch (e) {
        console.log('[zabbix] ip-sync periodico falhou:', e.message);
    } finally {
        ipSyncEmAndamento = false;
    }
}
function iniciarIpSync() {
    setTimeout(ipSyncPeriodico, 45000);
    setInterval(ipSyncPeriodico, 5 * 60 * 1000);
}
// so agenda se o servidor HTTP realmente subiu
if (servidorHttp && servidorHttp.listening) iniciarIpSync();
else servidorHttp.once('listening', iniciarIpSync);
