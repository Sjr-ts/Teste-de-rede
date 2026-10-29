const express = require('express');
const fs = require('fs');
const path = require('path');
const { ping, tcpCheck } = require('./monitor/pinger');
const store = require('./monitor/storage');
const monitor = require('./monitor/service');
const monitorConfig = require('./monitor/config.json');
const mockEngine = require('./monitor/mock-engine');

const app = express();
const PORT = 5903;

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

async function enriquecerPainelComZabbix(painel) {
    if (!painel || !Array.isArray(painel.linhas)) return painel;
    try {
        const zb = require('./monitor/zabbix-bridge');
        const cfg = zb.loadConfig ? zb.loadConfig() : null;
        if (!cfg || !cfg.url) return painel;

        // 1) Disponibilidade / latencia / perda
        let dadosZb = null;
        try {
            const fresh = await zb.dadosMonitoramentoZabbix();
            if (Array.isArray(fresh) && fresh.length) { dadosZb = fresh; _zbCache.dados = fresh; _zbCache.dadosTs = Date.now(); }
        } catch (e) {}
        if (!dadosZb && _zbCache.dados) dadosZb = _zbCache.dados; // fallback permanente (sem TTL)

        if (Array.isArray(dadosZb) && dadosZb.length) {
            const zbMap = {};
            for (const z of dadosZb) { if (!zbMap[z.ip] || zbMap[z.ip].disponivel === null) zbMap[z.ip] = z; }
            for (const linha of painel.linhas) {
                const z = zbMap[linha.ip];
                if (z) {
                    linha.zabbix = {
                        disponivel: z.disponivel,
                        latenciaMs: z.latenciaMs,
                        perdaPct: z.perdaPct,
                        available: z.available,
                        error: z.error
                    };
                    const localFresco = linha.ultimoHorario && (Date.now() - new Date(linha.ultimoHorario).getTime()) < 120000;
                    if (!localFresco) {
                        if (z.disponivel === true) {
                            if (linha.estado !== 'ACESSIVEL') linha.estado = 'ACESSIVEL';
                        } else if (z.disponivel === false) {
                            if (linha.estado === 'ACESSIVEL') linha.estado = 'SEM_RESPOSTA';
                        }
                        if (z.latenciaMs != null) linha.latenciaMediaMs = z.latenciaMs;
                    }
                }
            }
        }

        // 2) Metricas completas (CPU/RAM/Disco/Uptime)
        let metricasZb = null;
        try {
            const freshM = await zb.dadosCompletosZabbix();
            if (Array.isArray(freshM) && freshM.length) { metricasZb = freshM; _zbCache.metricas = freshM; _zbCache.metricasTs = Date.now(); }
        } catch (e) {}
        if (!metricasZb && _zbCache.metricas) metricasZb = _zbCache.metricas; // fallback permanente (sem TTL)

        if (Array.isArray(metricasZb) && metricasZb.length) {
            const mzMap = {};
            for (const m of metricasZb) { if (m.ip) mzMap[m.ip] = m; }
            for (const linha of painel.linhas) {
                const mz = mzMap[linha.ip];
                if (mz) {
                    if (mz.cpu != null) { linha.cpu = mz.cpu + '% (Zabbix)'; linha._zabbixCpu = mz.cpu; }
                    if (mz.gpu != null) { linha.gpu = mz.gpu + '% (Zabbix)'; linha._zabbixGpu = mz.gpu; }
                    if (mz.ram && mz.ram.usadoPct != null) { linha.ram = mz.ram.usadoPct + '% (' + (mz.ram.disponivelPct || '?') + '% livre) (Zabbix)'; linha._zabbixRam = mz.ram; }
                    if (mz.disco && mz.disco.length) { linha.disco = mz.disco.map(d => (100 - (d.livrePct || 0)).toFixed(1) + '% usado').join(' | ') + ' (Zabbix)'; linha._zabbixDisco = mz.disco; }
                    if (mz.uptime != null) { const dias = Math.floor(mz.uptime / 86400); const horas = Math.floor((mz.uptime % 86400) / 3600); linha.uptime = dias + 'd ' + horas + 'h (Zabbix)'; linha._zabbixUptime = mz.uptime; }
                    if (!(linha.fonte || '').includes('ZABBIX')) linha.fonte = (linha.fonte || '') + (linha.fonte ? ' + ' : '') + 'ZABBIX';
                }
            }
        }
    } catch (e) {}
    return painel;
}

// ---- SSE: push automatico de metricas do PC local a cada 10s ----
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
        let current = {};
        try { current = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { current = {}; }
        const baseRev = (body.baseRev != null) ? body.baseRev : null;
        const merged = baseRev != null && current._rev != null && baseRev !== current._rev;
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
        fs.writeFileSync(DATA_FILE, JSON.stringify(newData, null, 2), 'utf8');
        res.json({ rev: newData._rev, merged });
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
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { return {}; }
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
        res.json({
            total: comps.length,
            ativos,
            manutencaoPreditiva: preditiva,
            manutencaoPreventiva: preventiva,
            manutencaoEmergencial: emergencial,
            concluso
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
        res.json({
            total: mans.length,
            pendente, emAndamento, concluida, cancelada,
            preventiva, preditiva, emergencial, corretiva
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
            baixa, media, alta, critica
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
        try {
            const zb = require('./monitor/zabbix-bridge');
            const cfg = zb.loadConfig ? zb.loadConfig() : null;
            if (cfg && cfg.url) {
                const dadosZb = await zb.dadosMonitoramentoZabbix();
                if (Array.isArray(dadosZb) && dadosZb.length) {
                    const zbMap = {};
                    for (const z of dadosZb) { if (!zbMap[z.ip] || zbMap[z.ip].disponivel === null) zbMap[z.ip] = z; }
                    for (const linha of (painel.linhas || [])) {
                        const z = zbMap[linha.ip];
                        if (z) {
                            linha.zabbix = { disponivel: z.disponivel, latenciaMs: z.latenciaMs, perdaPct: z.perdaPct, available: z.available, error: z.error };
                            const localFresco = linha.ultimoHorario && (Date.now() - new Date(linha.ultimoHorario).getTime()) < 120000;
                            if (!localFresco) {
                                if (z.disponivel === true) linha.estado = 'ACESSIVEL';
                                else if (z.disponivel === false) linha.estado = 'SEM_RESPOSTA';
                                if (z.latenciaMs != null) linha.latenciaMediaMs = z.latenciaMs;
                            }
                        }
                    }
                }
                try {
                    const metricasZb = await zb.dadosCompletosZabbix();
                    if (Array.isArray(metricasZb) && metricasZb.length) {
                        const mzMap = {};
                        for (const m of metricasZb) { if (m.ip) mzMap[m.ip] = m; }
                        for (const linha of (painel.linhas || [])) {
                            const mz = mzMap[linha.ip];
                            if (mz) {
                                if (mz.cpu != null) { linha.cpu = mz.cpu + '% (Zabbix)'; linha._zabbixCpu = mz.cpu; }
                                if (mz.gpu != null) { linha.gpu = mz.gpu + '% (Zabbix)'; linha._zabbixGpu = mz.gpu; }
                                if (mz.ram && mz.ram.usadoPct != null) { linha.ram = mz.ram.usadoPct + '% (' + (mz.ram.disponivelPct || '?') + '% livre) (Zabbix)'; linha._zabbixRam = mz.ram; }
                                if (mz.disco && mz.disco.length) { linha.disco = mz.disco.map(d => (100 - (d.livrePct || 0)).toFixed(1) + '% usado').join(' | ') + ' (Zabbix)'; linha._zabbixDisco = mz.disco; }
                                if (mz.uptime != null) { const dias = Math.floor(mz.uptime / 86400); const horas = Math.floor((mz.uptime % 86400) / 3600); linha.uptime = dias + 'd ' + horas + 'h (Zabbix)'; linha._zabbixUptime = mz.uptime; }
                                linha.fonte = (linha.fonte || '') + (linha.fonte ? ' + ' : '') + 'ZABBIX';
                            }
                        }
                    }
                } catch (e2) {}
            }
        } catch (e) {}
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

app.get('/api/monitor/host/:ip', (req, res) => {
    try { res.json(monitor.obterDetalheHost(decodeURIComponent(req.params.ip))); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/monitor/ciclo', async (req, res) => {
    try { await monitor.executarCiclo(); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/monitor/config', (req, res) => res.json(monitor.getConfig()));
app.post('/api/monitor/config', (req, res) => {
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
monitor.aoFinalizarCiclo(function(painel) {
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
    sseBroadcast('painel', painel);
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

app.post('/api/zabbix/sincronizar', async (req, res) => {
    try {
        const zb = require('./monitor/zabbix-bridge');
        const resultado = await zb.sincronizarHosts();
        res.json(resultado);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/zabbix/config', (req, res) => {
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

app.post('/api/zabbix/config', (req, res) => {
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
        const dados = req.body && Array.isArray(req.body.computadores) ? req.body.computadores : [];
        const r = await zb.sincronizarHostsInventario(dados);
        res.json(r);
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

// ---- Zabbix webhook: notificacoes push (action → nosso servidor → SSE) ----
const alertasWebhook = [];
app.post('/api/zabbix/webhook', (req, res) => {
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
            res.json({ host: host, dias: dias, serie: serie, ultimasMedicoes: ultimas });
        } else {
            res.json({ error: 'Parametro host e necessario' });
        }
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
app.get('/api/monitor/status', (req, res) => res.json({ rodando: monitor.isRodando() }));

// ---- Static ----
app.use('/uploads', express.static('uploads'));
app.use(express.static('frontend'));

app.listen(PORT, () => {
    console.log('Servidor rodando em http://192.168.0.186:' + PORT);
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
