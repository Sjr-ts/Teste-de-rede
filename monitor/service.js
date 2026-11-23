'use strict';
/**
 * Servico central de monitoramento agentless.
 * Roda como processo de segundo plano (requerido pelo server.cjs ou standalone).
 * Nao instala nada nos PCs monitorados. Apenas ping/TCP a partir deste servidor.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { ping, tcpCheck } = require('./pinger');
const store = require('./storage');
const { avaliarHost, correlacionarSetor } = require('./alerts');
const classificador = require('./classificador');
const zabbix = require('./zabbix');
const hostmetrics = require('./hostmetrics');

const CONFIG_PATH = path.join(__dirname, 'config.json');

// Limites de alerta PADRAO. Unica fonte dos numeros: monitor/config.json
// sobrescreve estes valores quando existe; o frontend NAO pode copia-los na
// mao — ele recebe `limites` em /api/monitor/painel e /api/monitor/historico
// (ver obterLimites). O teste test/limiares.test.js garante que o fallback
// do frontend e identico a este objeto.
const LIMITES_PADRAO = {
    latenciaMediaMs: 80,
    latenciaP95Ms: 200,
    perdaPacotesPct: 10,
    falhasConsecutivasParaAlerta: 3
};

/** Limites EFETIVOS: padrao sobrescrito pelo monitor/config.json. */
function obterLimites() {
    return Object.assign({}, LIMITES_PADRAO, (config && config.limites) || {});
}

// Fonte unica da classificacao de contexto (desligado esperado vs falha).
// Declarada ANTES de carregarConfig() (que e chamada no load do modulo).
const CLASSIFICACAO_PADRAO = {
    timezone: 'America/Sao_Paulo',
    modo: 'CONSERVADOR',
    janelasEsperadas: [
        { id: 'EXPEDIENTE', dias: [1, 2, 3, 4, 5], inicio: '08:00', fim: '18:00', toleranciaMin: 15 }
    ],
    // Janelas em que o desligamento e AUTORIZADO durante o expediente.
    // Exemplo: desligar no almoco para reduzir ciclo de formatacao.
    // Vazio por padrao = nada e suprimido dentro do expediente sem evidencia.
    janelasDesligamento: [],
    feriados: [],
    regras: {
        minFalhasParaDesligadoEsperado: 3,
        maxHorizontalidadePct: 40,
        minHostsParaParadaColetiva: 5,
        minFalhasParaIpObsoleto: 24,
        minDiasRecorrencia: 3,
        janelaRecorrenciaDias: 30,
        foraDaJanelaSempreAlerta: true
    },
    excecoes: []
};

let config = carregarConfig();
let rodando = false;
let timerCiclo = null;
let timerAggregacao = null;
let emCiclo = false;
let ultimaExecucao = null;
let estatisticas = { ciclos: 0, medicoes: 0, erros: 0, ultimoCicloMs: null };
let diagnosticoCache = {};
let incidentesCache = [];
let metricasLocais = null; // ultima coleta completa da maquina local
let callbackCiclo = null; // callback chamado apos cada ciclo (para SSE)

// Histórico por host: { [hostIp]: { okHistory: [], latHistory: [], timestamps: [] } }
let hostHistorico = {};
const MAX_HISTORICO = 50; // ultimas N medicoes por host

function aoFinalizarCiclo(fn) { callbackCiclo = fn; }

const IPS_LOCAIS = new Set(['127.0.0.1', '::1', '0.0.0.0', 'localhost']);

function ehHostLocal(ip) {
    if (!ip) return false;
    if (IPS_LOCAIS.has(String(ip).toLowerCase())) return true;
    try {
        for (const addrs of Object.values(os.networkInterfaces())) {
            for (const a of (addrs || [])) {
                if ((a.family === 'IPv4' || a.family === 4) && a.address === ip) return true;
            }
        }
    } catch (e) {}
    return false;
}

function isHostStale(hostState, now = Date.now(), staleWindowMs = null) {
    if (!hostState) return true;
    const windowMs = staleWindowMs ?? ((config.coletor.intervaloSegundos || 60) * 1000 * 3);
    const ts = hostState.ultimoHorario ? new Date(hostState.ultimoHorario).getTime() : null;
    if (ts == null || !Number.isFinite(ts)) return true;
    return (now - ts) > windowMs;
}

function carregarConfig() {
    let cfg;
    try {
        let raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
        cfg = JSON.parse(raw);
    } catch (e) {
        cfg = {
            coletor: { intervaloSegundos: 60, timeoutMs: 2000, tentativasPorCiclo: 3, concorrenciaMaxima: 10, retencaoMedicoesDias: 30 },
            limites: Object.assign({}, LIMITES_PADRAO),
            zabbix: { habilitado: false },
            servicos: []
        };
    }
    // mescla classificacao padrao (config antigo / POST parcial nao a remove)
    if (!cfg.classificacao || typeof cfg.classificacao !== 'object') {
        cfg.classificacao = Object.assign({}, CLASSIFICACAO_PADRAO);
    } else {
        cfg.classificacao = Object.assign({}, CLASSIFICACAO_PADRAO, cfg.classificacao);
    }
    if (!cfg.alertas || typeof cfg.alertas !== 'object') cfg.alertas = { silenciarRepetidosMinutos: 15 };
    return cfg;
}

function recarregarConfig() {
    config = carregarConfig();
    return config;
}

/** Monta lista de alvos combinando targets.json e inventario. */
function obterAlvos() {
    const custom = store.lerAlvos()
        .map(t => ({
            id: t.id,
            nome: t.nome || t.nomePc || ('PC-' + (t.id || t.ip)),
            ip: (t.ip || t.ipAddress || '').trim(),
            setor: t.setor || t.departamento || 'DESCONHECIDO',
            mac: t.mac || t.macAddress || null,
            ativo: t.ativo !== false,
            fonte: t.fonte || 'TARGETS'
        }))
        .filter(t => t.ativo !== false && t.ip && t.ip !== '-' && t.ip !== 'N/A');

    const dataFile = path.join(__dirname, '..', 'data.json');
    const inventory = [];
    if (fs.existsSync(dataFile)) {
        try {
            let raw = fs.readFileSync(dataFile, 'utf8');
            if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
            const db = JSON.parse(raw);
            for (const c of (db.computadores || [])) {
                const ip = (c.ipAddress || '').trim();
                if (!ip || ip === '-' || ip === 'N/A') continue;
                inventory.push({
                    id: c.id,
                    nome: c.nomePc || ('PC-' + c.id),
                    ip,
                    setor: c.departamento || 'DESCONHECIDO',
                    mac: c.macAddress || null,
                    ativo: true,
                    fonte: 'INVENTARIO'
                });
            }
        } catch (e) {}
    }

    const merged = new Map();
    for (const alvo of custom) merged.set(alvo.ip, alvo);
    for (const alvo of inventory) {
        if (!merged.has(alvo.ip)) merged.set(alvo.ip, alvo);
    }

    return Array.from(merged.values()).sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
}

// ==================== MOTOR DE MOCK ====================
// Gera sequencias realistas de metricas que alternam entre estados POSITIVO (saudavel)
// e NEGATIVO (com falha). Cada host mock tem seu proprio ciclo temporal.
const mockEstado = {}; // { [ip]: { fase, t, cpuBase, ramBase, discoBase, ultimoOk, historicoMetricas } }

function gerarSequenciaMock(ip) {
    if (!mockEstado[ip]) {
        mockEstado[ip] = {
            t: 0,
            fase: 'POSITIVA',
            cpuBase: 15, cpuDrift: 0,
            ramBase: 35, ramDrift: 0,
            discoBase: 42, discoDrift: 0,
            ultimoOk: true,
            consecFalhas: 0,
            historicoMetricas: [],
            cicloDuracao: 20 // ciclos por fase (positiva ou negativa)
        };
    }
    const s = mockEstado[ip];
    s.t++;
    const dur = s.cicloDuracao;

    // Alterna entre POSITIVA e NEGATIVA
    if (s.t % dur === 1 && s.t > 1) {
        s.fase = s.fase === 'POSITIVA' ? 'NEGATIVA' : 'POSITIVA';
    }

    const fasePct = (s.t % dur) / dur; // 0..1 dentro da fase

    let cpu, ram, disco, latencia, ok, falhaTipo = null;

    if (s.fase === 'POSITIVA') {
        // Fase positiva: metricas saudaveis, CPU baixa, RAM moderada, disco estavel
        const waveCpu = Math.sin(fasePct * Math.PI * 2) * 8; // ondulacao suave
        cpu = Math.max(2, Math.min(35, s.cpuBase + waveCpu + (Math.random() * 6 - 3)));
        const waveRam = Math.sin(fasePct * Math.PI * 1.5) * 5;
        ram = Math.max(20, Math.min(55, s.ramBase + waveRam + (Math.random() * 4 - 2)));
        disco = Math.min(80, s.discoBase + s.t * 0.05 + (Math.random() * 1 - 0.5));
        latencia = Math.max(1, Math.round(5 + Math.random() * 25 + waveCpu));
        ok = true;
        s.consecFalhas = 0;
    } else {
        // Fase negativa: metricas criticas, CPU alta, RAM alta, disco cheio
        // Progressao gradual: comeca ruim e fica pior
        const progressao = fasePct; // 0..1, fica pior ao longo do tempo
        const waveCpu = Math.sin(fasePct * Math.PI * 3) * 10;
        cpu = Math.min(98, 60 + progressao * 35 + waveCpu + (Math.random() * 8 - 4));
        const waveRam = Math.sin(fasePct * Math.PI * 2) * 8;
        ram = Math.min(97, 70 + progressao * 25 + waveRam + (Math.random() * 5 - 2.5));
        disco = Math.min(95, 75 + progressao * 18 + (Math.random() * 1 - 0.5));

        // Latencia aumenta gradualmente
        latencia = Math.round(20 + progressao * 80 + Math.random() * 30);

        // Quase sempre DOWN na fase negativa, mas com picos intermitentes
        const chanceOk = 1 - progressao * 0.95; // 100% no inicio -> 5% no fim
        ok = Math.random() > (1 - chanceOk) * 0.3; // 30% de chance de ficar up
        if (!ok) falhaTipo = progressao > 0.7 ? 'mock_down_completo' : 'mock_intermitente';
        if (!ok) s.consecFalhas++;
        else s.consecFalhas = 0;
    }

    s.ultimoOk = ok;
    const resultado = {
        ok,
        perdaPct: ok ? Math.round(Math.random() * 5 * 100) / 100 : Math.round((70 + Math.random() * 30) * 100) / 100,
        latenciaMs: ok ? latencia : null,
        falhaTipo,
        metricas: {
            cpu: Math.round(cpu * 10) / 10,
            ram: Math.round(ram * 10) / 10,
            disco: Math.round(disco * 10) / 10,
            latencia: latencia,
            fase: s.fase,
            progressao: Math.round(fasePct * 100)
        }
    };

    // Armazena historico de metricas para graficos (ultimas 200)
    s.historicoMetricas.push({
        t: s.t,
        cpu: resultado.metricas.cpu,
        ram: resultado.metricas.ram,
        disco: resultado.metricas.disco,
        ok,
        fase: s.fase,
        timestamp: new Date().toISOString()
    });
    if (s.historicoMetricas.length > 200) s.historicoMetricas.shift();

    return resultado;
}

/**
 * Aplica o classificador de contexto a TODOS os hosts apos um ciclo completo.
 * Preenche ultimoResultado com um dos estados finais e guarda st.classificacao
 * (motivo/confianca/janela/suprimeAlerta) para auditoria e uso pelo frontend.
 * Calcula a horizontalidade por setor antes de classificar (parada coletiva).
 */
function classificarEstados(alvos, estado, config) {
    const setorDe = {};
    for (const a of alvos) setorDe[a.ip] = a.setor || 'GERAL';

    // agregados historicos (para detectar desligamento HABITUAL por recorrencia)
    const janelaDias = (config.classificacao && config.classificacao.regras && config.classificacao.regras.janelaRecorrenciaDias) || 30;
    let agregados = [];
    try { agregados = store.lerAggregados ? store.lerAggregados(janelaDias) : []; } catch (e) {}

    const totalPorSetor = {}, foraPorSetor = {};
    for (const a of alvos) {
        const setor = setorDe[a.ip];
        totalPorSetor[setor] = (totalPorSetor[setor] || 0) + 1;
        const st = estado[a.ip];
        if (st && st.ultimoResultado === 'SEM_RESPOSTA') {
            foraPorSetor[setor] = (foraPorSetor[setor] || 0) + 1;
        }
    }

    const agora = Date.now();
    for (const a of alvos) {
        const st = estado[a.ip];
        if (!st) continue;
        const setor = setorDe[a.ip];
        const total = totalPorSetor[setor] || 1;
        const horizontalidade = ((foraPorSetor[setor] || 0) / total) * 100;

        const decisao = classificador.classificar({
            ip: a.ip,
            now: agora,
            medicoesRecentes: st.historicoRecente || [],
            estadoAnterior: st,
            config,
            horizontalidadePct: horizontalidade,
            totalSetor: total,
            foraNoSetor: foraPorSetor[setor] || 0,
            erroPinger: st.erroPinger,
            agregados
        });

        st.ultimoResultado = decisao.estado;
        st.classificacao = {
            motivo: decisao.motivo,
            confianca: decisao.confianca,
            janelaId: decisao.janelaId,
            suprimeAlerta: decisao.suprimeAlerta,
            categoriaAlerta: decisao.categoriaAlerta,
            avaliadaEm: new Date(agora).toISOString()
        };
    }
}

async function executarCiclo() {
    if (emCiclo) return;
    emCiclo = true;
    const t0 = Date.now();

    try {
        const alvos = obterAlvos();
        if (!alvos.length) {
            ultimaExecucao = { quando: new Date().toISOString(), alvos: 0, nota: 'Nenhum IP cadastrado para monitorar. Cadastre ipAddress no inventario ou defina monitor/data/targets.json' };
            emCiclo = false;
            return;
        }

        const estado = store.lerEstado();
        const coletor = config.coletor;
        const resultados = [];

        // Pool de concorrencia limitada
        const fila = [...alvos];
        const conc = Math.max(1, coletor.concorrenciaMaxima || 10);

        async function trabalhador() {
            while (fila.length) {
                const alvo = fila.shift();
                if (!alvo) break;
                try {
                    const r = await ping(alvo.ip, {
                        tentativas: coletor.tentativasPorCiclo,
                        timeoutMs: coletor.timeoutMs
                    });
                    const reg = {
                        host: alvo.ip,
                        nome: alvo.nome,
                        setor: alvo.setor,
                        ok: r.ok,
                        perdaPct: r.perdaPct,
                        latenciaMediaMs: r.latenciaMediaMs,
                        latenciaMinMs: r.latenciaMinMs,
                        latenciaMaxMs: r.latenciaMaxMs,
                        enviado: r.enviado,
                        recebido: r.recebido,
                        erro: r.erro,
                        metodo: 'ICMP_PING_NATIVO_SO',
                        timestamp: r.timestamp
                    };
                    // CORRIGIDO: resultados sempre ficava vazio -> Zabbix recebia
                    // array vazio e estatisticas do ciclo eram zero.
                    resultados.push(reg);
                    estatisticas.medicoes++;

                    // Usa o resultado real do ping (antes chamado usouMock — nome enganoso)
                    const respondeu = r.ok;
                    const st = estado[alvo.ip] || { falhasConsecutivas: 0, downSince: null, upSince: null, historicoRecente: [] };
                    if (!respondeu) {
                        st.falhasConsecutivas = (st.falhasConsecutivas || 0) + 1;
                        if (!st.downSince) st.downSince = reg.timestamp || r.timestamp;
                        st.upSince = null;
                    } else {
                        if (st.downSince && st.falhasConsecutivas > 0) {
                            st.recuperadoApos = st.downSince;
                            st.duracaoIndisponivelMs = new Date(reg.timestamp || r.timestamp) - new Date(st.downSince);
                        }
                        st.falhasConsecutivas = 0;
                        st.downSince = null;
                        st.upSince = (reg.timestamp || r.timestamp);
                    }
                    st.ultimoResultado = respondeu ? 'ACESSIVEL' : 'SEM_RESPOSTA'; // classificado depois do ciclo
                    st.erroPinger = r.erro || null;
                    st.ultimoHorario = reg.timestamp || r.timestamp;
                    st.latenciaMediaMs = reg.latenciaMediaMs !== undefined ? reg.latenciaMediaMs : r.latenciaMediaMs;
                    // janela deslizante para avaliacao
                    st.historicoRecente = (st.historicoRecente || []);
                    st.historicoRecente.push({ ok: r.ok, latenciaMediaMs: r.latenciaMediaMs, timestamp: r.timestamp });
                    if (st.historicoRecente.length > 30) st.historicoRecente.shift();
                    estado[alvo.ip] = st;

                    // Mantener histórico global por host (para graficos)
                    let hHist = hostHistorico[alvo.ip];
                    if (!hHist) { hHist = { okHistory: [], latHistory: [], timestamps: [] }; hostHistorico[alvo.ip] = hHist; }
                    hHist.okHistory.push(r.ok ? 1 : 0);
                    hHist.latHistory.push(r.latenciaMediaMs || 0);
                    hHist.timestamps.push(r.timestamp);
                    if (hHist.okHistory.length > MAX_HISTORICO) {
                        hHist.okHistory.shift(); hHist.latHistory.shift(); hHist.timestamps.shift();
                    }

                    // Persiste medicao bruta para historico/relatorios
                    try { store.appendMedicao(reg); } catch (e) {}
                } catch (e) {
                    estatisticas.erros++;
                }
                // pausa entre hosts para nao sobrecarregar a rede
                await new Promise(res => setTimeout(res, coletor.pausaEntreHostsMs || 200));
            }
        }

        const workers = [];
        for (let i = 0; i < conc; i++) workers.push(trabalhador());
        await Promise.all(workers);

        // Testes de servicos TCP autorizados (se configurados)
        for (const svc of (config.servicos || [])) {
            if (!svc.host || !svc.porta) continue;
            try {
                const t = await tcpCheck(svc.host, svc.porta, config.coletor.timeoutMs);
                store.appendMedicao({
                    host: svc.host,
                    nome: svc.nome || ('svc-' + svc.porta),
                    setor: 'SERVICO',
                    ok: t.ok,
                    perdaPct: t.ok ? 0 : 100,
                    latenciaMediaMs: t.tempoConexaoMs,
                    metodo: 'TCP_CONNECT',
                    porta: svc.porta,
                    erro: t.erro,
                    timestamp: t.timestamp
                });
            } catch (e) {}
        }

        // ---- CLASSIFICACAO DE CONTEXTO: desligado esperado vs falha real ----
        // Roda DEPOIS de todos os pings (para saber a horizontalidade do setor)
        // e ANTES de gerar alertas/KPIs. Um PC desligado em horario esperado nao
        // vira "erro" e nao derruba a disponibilidade.
        try { classificarEstados(alvos, estado, config); } catch (e) {
            console.error('[classificador] falha:', e && e.message ? e.message : e);
        }

        store.salvarEstado(estado);

        // Auto-agrega dados de hoje apos o ciclo (mantem historico fresco)
        try { store.agregarDia(new Date().toISOString().slice(0, 10)); } catch (e) {}

        // --- Metricas REAIS da maquina local (CPU/RAM/disco/uptime/reinicio) ---
        try {
            if (alvos.some(a => ehHostLocal(a.ip))) {
                const anterior = metricasLocais && metricasLocais._snapshot;
                const m = await hostmetrics.coletar(anterior);
                metricasLocais = m;
                // Reinicio confirmado = uptime diminuiu desde a coleta anterior
                if (m.uptime && m.uptime.reiniciadoDesdeUltimaColeta) {
                    const alertasNow = store.lerAlertas();
                    const chave = 'REINICIO:' + m.hostname;
                    if (!alertasNow.some(a => a.chave === chave && a.estado === 'ABERTO')) {
                        alertasNow.push({
                            id: Date.now(),
                            chave,
                            categoria: 'SISTEMA',
                            gravidade: 'MEDIA',
                            host: m.hostname,
                            titulo: 'Reinicio detectado nesta maquina',
                            evidencias: [
                                'Uptime caiu de ' + anterior.uptime.uptimeSeg + 's para ' + m.uptime.uptimeSeg + 's',
                                'Novo boot em ' + m.uptime.bootTime
                            ],
                            confianca: 'CONFIRMADO',
                            recomendacao: 'Verifique o Historico de eventos do Windows para causa do reinicio (atualizacao, falha de energia, BSOD).',
                            estado: 'ABERTO',
                            ocorrencias: 1,
                            criadoEm: new Date().toISOString()
                        });
                        store.salvarAlertas(alertasNow);
                    }
                }
            }
        } catch (e) {
            estatisticas.erros++;
        }

        // Avaliacao de alertas
        avaliarEAlertar(estado);

        // Correlacao por setor
        const setorMap = {};
        for (const a of alvos) setorMap[a.ip] = a.setor;
        const porHost = {};
        for (const [ip, st] of Object.entries(estado)) {
            porHost[ip] = { ultimoResultado: st.ultimoResultado, falhasConsecutivas: st.falhasConsecutivas };
        }
        incidentesCache = correlacionarSetor(porHost, setorMap);

        estatisticas.ciclos++;
        estatisticas.ultimoCicloMs = Date.now() - t0;
        ultimaExecucao = {
            quando: new Date().toISOString(),
            alvos: alvos.length,
            medicoes: resultados.length,
            ok: resultados.filter(r => r.ok).length,
            falhas: resultados.filter(r => !r.ok).length,
            duracaoMs: estatisticas.ultimoCicloMs
        };

        // Envia ao Zabbix se habilitado
        if (config.zabbix && config.zabbix.habilitado) {
            zabbix.enviarMedicoes(resultados, config.zabbix).catch(() => {});
        }
    } catch (e) {
        estatisticas.erros++;
        console.error('[monitor] erro no ciclo:', e.message);
    } finally {
        emCiclo = false;
        // Notifica clientes SSE apos o ciclo
        if (callbackCiclo) {
            try { callbackCiclo(obterPainel()); } catch (e) {}
        }
    }
}

function avaliarEAlertar(estado) {
    const alertas = store.lerAlertas();
    // normaliza: alertas vindos de fontes externas/webhook podem nao ter
    // historico como array — sem isso o .push() abaixo derruba o ciclo.
    for (const a of alertas) if (!Array.isArray(a.historico)) a.historico = [];
    const agora = Date.now();
    // guarda: config.alertas pode faltar se config.json foi reescrito por
    // POST /api/monitor/config com um corpo parcial — sem isso o motor de
    // alertas lanca TypeError a cada ciclo e para de gerar/resolver alertas.
    const silencioMin = (config.alertas && config.alertas.silenciarRepetidosMinutos) || 15;
    const silencioMs = silencioMin * 60000;
    const novosDiagnostico = {};

    for (const [host, st] of Object.entries(estado)) {
        const medicoes = st.historicoRecente || [];
        const suprime = !!(st.classificacao && st.classificacao.suprimeAlerta);
        const { novos: novosBrutos, resolucoes } = avaliarHost(host, medicoes, st, config, null);
        // SUPRESSAO: se o classificador disse "desligado esperado / parada
        // coletiva / IP obsoleto", nao abre alerta de conectividade. Alertas de
        // latencia/perda (host UP) e resolucoes continuam valendo.
        const novos = suprime
            ? novosBrutos.filter(n => n.categoria !== 'CONECTIVIDADE' && n.categoria !== 'INFRA' && n.categoria !== 'INSTABILIDADE')
            : novosBrutos;
        if (suprime && novosBrutos.length > novos.length) {
            // registra SUPRIMIDO no historico de um alerta aberto anterior
            // (auditoria sem poluir a lista de alertas ativos)
            const anterior = alertas.find(a => a.host === host && a.estado === 'ABERTO' &&
                ['CONECTIVIDADE', 'INFRA', 'INSTABILIDADE'].indexOf(a.categoria) >= 0);
            if (anterior) {
                anterior.historico.push({
                    quando: new Date(agora).toISOString(), evento: 'SUPRIMIDO',
                    detalhe: 'Desligamento/classificacao esperada: ' + (st.classificacao.motivo || '')
                });
                // CORRIGIDO: apenas registrar SUPRIMIDo no historico nao bastava —
                // o alerta antigo continuava ABERTO, inflando o KPI "Alertas" e
                // gerando toast via SSE. Resolve o alerta com motivo explicito.
                anterior.estado = 'RESOLVIDO';
                anterior.resolvidoEm = new Date(agora).toISOString();
                anterior.motivoResolucao = 'SUPRIMIDO_PELA_CLASSIFICACAO';
            }
        }
        novosDiagnostico[host] = {
            observado: st,
            classificacao: st.classificacao || null,
            hipoteses: novos.map(n => ({ titulo: n.titulo, confianca: n.confianca })),
            indisponiveis: [
                'Uso de RAM: indisponivel — monitoramento interno do Windows nao disponivel.',
                'Uso de CPU: indisponivel — monitoramento interno do Windows nao disponivel.',
                'Reinicio confirmado: indisponivel — requer eventos do Windows.'
            ]
        };

        for (const novo of novos) {
            // Evita duplicata: procura alerta ABERTO do mesmo host+categoria
            const existente = alertas.find(a =>
                a.host === host && a.categoria === novo.categoria && a.estado === 'ABERTO'
            );
            if (existente) {
                const desdeUltima = agora - new Date(existente.ultimaOcorrencia).getTime();
                if (desdeUltima >= silencioMs) {
                    existente.ultimaOcorrencia = novo.ultimaOcorrencia;
                    existente.ocorrencias += 1;
                    existente.evidencias = novo.evidencias;
                    existente.historico.push({ quando: novo.ultimaOcorrencia, evento: 'ATUALIZADO', detalhe: novo.titulo });
                }
            } else {
                alertas.push(novo);
            }
        }

        // Resolucao automatica
        if (resolucoes.length) {
            for (const r of resolucoes) {
                for (const a of alertas) {
                    if (a.host === host && a.estado === 'ABERTO' && r.tipos.includes(a.categoria)) {
                        a.estado = 'RESOLVIDO';
                        a.resolvidoEm = new Date().toISOString();
                        a.historico.push({ quando: a.resolvidoEm, evento: 'RESOLVIDO', detalhe: 'Condicao normalizada apos novas medicoes' });
                    }
                }
            }
        }
    }

    diagnosticoCache = novosDiagnostico;
    store.salvarAlertas(alertas);
}

function iniciar() {
    if (rodando) return;
    rodando = true;
    const intervalo = (config.coletor.intervaloSegundos || 60) * 1000;
    console.log(`[monitor] servico iniciado. Intervalo=${intervalo / 1000}s Concorrencia=${config.coletor.concorrenciaMaxima}`);

    // primeiro ciclo rapido para feedback imediato
    setTimeout(() => { executarCiclo().catch(() => {}); }, 1500);

    timerCiclo = setInterval(() => {
        executarCiclo().catch(() => {});
    }, intervalo);

    // agregacao diaria 03:00
    timerAggregacao = setInterval(() => {
        const h = new Date().getHours();
        if (h === 3) {
            const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
            try { store.agregarDia(ontem); } catch (e) {}
            try {
                store.limparAntigos(
                    config.coletor.retencaoMedicoesDias || 30,
                    config.coletor.retencaoAggregadosDias || 365
                );
            } catch (e) {}
        }
    }, 3600000);
}

function parar() {
    rodando = false;
    if (timerCiclo) clearInterval(timerCiclo);
    if (timerAggregacao) clearInterval(timerAggregacao);
    timerCiclo = null;
    timerAggregacao = null;
}

/** Snapshot para a API / painel. */
function obterPainel() {
    const alvos = obterAlvos();
    const estadoBruto = store.lerEstado();
    const ipsAlvos = new Set(alvos.map(a => a.ip));
    // Limpa IPs que nao estao mais na lista de alvos
    const estado = {};
    for (const [ip, st] of Object.entries(estadoBruto)) {
        if (ipsAlvos.has(ip)) estado[ip] = st;
    }
    const alertas = store.lerAlertas().filter(a => a.estado === 'ABERTO' || a.estado === 'ACK');

    // KPIs MUTUAMENTE EXCLUSIVOS — a soma dos estados = totalAlvos.
    // Antes: semResposta (1 falha) e instaveis (1 falha) contavam o MESMO host,
    // e um PC desligado derrubava a disponibilidade na 1a falha.
    // ESTADO EFETIVO UNICO: aplica stale (dados velhos) e fallback SEM_DADOS
    // uma vez, para que KPI, detalhe, grafico e tabela usem a MESMA fonte.
    // Antes o stale era aplicado so na linha da tabela, divergindo do card.
    const estadoEfetivo = {};
    for (const [ip, s] of Object.entries(estado)) {
        estadoEfetivo[ip] = (isHostStale(s, Date.now()) && s.ultimoResultado === 'ACESSIVEL')
            ? 'SEM_DADOS'
            : (s.ultimoResultado || 'SEM_DADOS');
    }
    const estados = Object.values(estadoEfetivo);
    const acessiveis = estados.filter(e => e === 'ACESSIVEL').length;
    const semResposta = estados.filter(e => e === 'SEM_RESPOSTA').length;
    const desligadosEsperados = estados.filter(e => e === 'DESLIGADO_ESPERADO').length;
    const empresaParada = estados.filter(e => e === 'EMPRESA_PARADA').length;
    const ipObsoleto = estados.filter(e => e === 'IP_OBSOLETO').length;
    const semDados = alvos.length - Object.keys(estado).length + estados.filter(e => e === 'SEM_DADOS').length;
    // instaveis = hosts com oscilacao (falha+ok na janela) mas que NAO estao
    // classificados como desligado esperado, para nao dupla-contar
    const instaveis = Object.values(estado).filter(s =>
        s.ultimoResultado === 'SEM_RESPOSTA' &&
        (s.falhasConsecutivas > 0) &&
        (s.falhasConsecutivas < (obterLimites().falhasConsecutivasParaAlerta || 3))
    ).length;
    // semResposta "real" = falhas que passaram do limiar (as outras viram instaveis)
    const semRespostaReal = Math.max(0, semResposta - instaveis);
    const respondiveis = Math.max(0,
        alvos.length - desligadosEsperados - empresaParada - ipObsoleto - semDados);
    const dispOperacional = respondiveis > 0 ? Math.round((acessiveis / respondiveis) * 100) : 0;
    const dispBruta = alvos.length > 0 ? Math.round((acessiveis / alvos.length) * 100) : 0;

    // KPIs de VALOR (dados ja persistidos, antes nao expostos):
    // MTTR = media do tempo de indisponibilidade recuperada;
    // alertasEvitados = hosts com classificacao que suprimiu alerta;
    // tempoForaPlanejadoMs = soma do tempo fora de desligamentos esperados.
    const recuperacoes = Object.values(estado).filter(s => s.duracaoIndisponivelMs != null && s.recuperadoApos);
    const mttrMs = recuperacoes.length
        ? Math.round(recuperacoes.reduce((a, s) => a + s.duracaoIndisponivelMs, 0) / recuperacoes.length) : null;
    const alertasEvitados = Object.values(estado).filter(s =>
        s.classificacao && s.classificacao.suprimeAlerta).length;
    const tempoForaPlanejadoMs = Object.values(estado)
        .filter(s => s.classificacao && (s.classificacao.janelaId === 'FORA_EXPEDIENTE' || s.classificacao.janelaId === 'FERIADO' || s.ultimoResultado === 'DESLIGADO_ESPERADO'))
        .reduce((a, s) => a + (s.duracaoIndisponivelMs || 0), 0);

    // Persiste estado limpo (remove IPs fantasma)
    if (Object.keys(estadoBruto).length !== Object.keys(estado).length) {
        store.salvarEstado(estado);
    }

    const linhas = alvos.map(a => {
        const st = estado[a.ip] || {};
        const local = ehHostLocal(a.ip);
        const ml = local && metricasLocais;
        const stale = isHostStale(st, Date.now());
        return {
            id: a.id,
            nome: a.nome,
            ip: a.ip,
            setor: a.setor,
            mac: a.mac,
            local,
            stale,
            estado: estadoEfetivo[a.ip] || 'SEM_DADOS',
            classificacao: st.classificacao || null,
            latenciaMediaMs: st.latenciaMediaMs != null ? st.latenciaMediaMs : null,
            falhasConsecutivas: st.falhasConsecutivas || 0,
            downSince: st.downSince || null,
            recuperadoApos: st.recuperadoApos || null,
            duracaoIndisponivelMs: st.duracaoIndisponivelMs != null ? st.duracaoIndisponivelMs : null,
            ultimoHorario: st.ultimoHorario || null,
            alertasAtivos: alertas.filter(al => al.host === a.ip || al.host === (ml && ml.hostname)).length,
            fonte: local ? 'ICMP + METRICAS_LOCAIS' : 'ICMP_PING_NATIVO_SO',
            cpu: ml && ml.cpu && ml.cpu.usoPct != null ? ml.cpu.usoPct + '%' : (ml ? 'INDISPONIVEL' : 'INDISPONIVEL'),
            gpu: ml && ml.gpu && ml.gpu.gpus && ml.gpu.gpus.length ? ml.gpu.gpus.map(g => g.usoPct != null ? g.usoPct + '%' : '?').join(' | ') : (ml && ml.gpu && ml.gpu.indisponivel ? 'INDISP.' : 'INDISPONIVEL'),
            ram: ml && ml.memoria ? ml.memoria.usoPct + '% (' + ml.memoria.usadoGb + '/' + ml.memoria.totalGb + ' GB)' : 'INDISPONIVEL',
            disco: ml && ml.disco && ml.disco.discos ? ml.disco.discos.map(d => d.letra + ' ' + d.usoPct + '%').join(' | ') : 'INDISPONIVEL',
            uptime: ml && ml.uptime ? ml.uptime.uptimeHumano : null,
            reinicioConfirmado: ml && ml.uptime ? (ml.uptime.reiniciadoDesdeUltimaColeta ? 'SIM' : 'NAO (desde inicio do monitoramento)') : 'INDISPONIVEL',
            _localMetricasTs: ml ? ml.quando : null
        };
    });

    return {
        // Limites de alerta vigentes: os graficos do frontend desenham as
        // linhas de limiar a partir daqui (nao de valores fixos no JS).
        limites: obterLimites(),
        servico: {
            rodando,
            ultimaExecucao,
            estatisticas,
            intervaloSegundos: config.coletor.intervaloSegundos,
            zabbixHabilitado: !!(config.zabbix && config.zabbix.habilitado)
        },
        resumo: {
            totalAlvos: alvos.length,
            acessiveis,
            semResposta: semRespostaReal,
            instaveis,
            semDados: Math.max(0, semDados),
            desligadosEsperados,
            empresaParada,
            ipObsoleto,
            respondiveis,
            disponibilidadeOperacional: dispOperacional,
            disponibilidadeBruta: dispBruta,
            planejadoPct: alvos.length > 0 ? Math.round(((desligadosEsperados + empresaParada) / alvos.length) * 100) : 0,
            mttrMs,
            alertasEvitados,
            tempoForaPlanejadoMs,
            alertasAbertos: alertas.length,
            incidentesSetor: incidentesCache.length,
            coletadoEm: new Date().toISOString()
        },
        linhas,
        alertas: alertas.slice(0, 100),
        incidentes: incidentesCache,
        diagnosticos: diagnosticoCache,
        sistema: metricasLocais ? {
            hostname: metricasLocais.hostname,
            info: metricasLocais.info,
            cpu: metricasLocais.cpu,
            gpu: metricasLocais.gpu,
            memoria: metricasLocais.memoria,
            disco: metricasLocais.disco,
            uptime: metricasLocais.uptime,
            rede: metricasLocais.rede,
            quando: metricasLocais.quando
        } : null,
        indisponiveis: [
            'Uso de RAM/CPU em PCs REMOTOS: indisponivel (sem agente instalado no PC destino, sem WMI remoto autorizado). No PC LOCAL (este servidor) os valores sao REAIS e coletados por SO.',
            'Reinicio de PCs remotos: indisponivel (requer WEF/agent). No PC LOCAL e detectado por queda de uptime (confirmado).',
            'Porta do switch por IP: indisponivel (requer SNMP nos switches)',
            'Qualidade Wi-Fi: indisponivel (requer controlador Wi-Fi)',
            'Registros DHCP/DNS: indisponivel (requer acesso aos servidores)'
        ]
    };
}

function obterDetalheHost(ip) {
    const estado = store.lerEstado();
    const st = estado[ip] || {};
    const alertasHost = store.lerAlertas().filter(a => a.host === ip);
    const aggregados = store.lerAggregados(7);
    const serie = [];
    for (const agg of aggregados) {
        const h = agg.hosts && agg.hosts[ip];
        if (h) serie.push({ dia: agg.dia, perdaPct: h.perdaPct, latenciaMediaMs: h.latenciaMediaMs, latenciaP95Ms: h.latenciaP95Ms, total: h.totalMedicoes });
    }
    serie.reverse();

    const local = ehHostLocal(ip);
    const ml = local ? metricasLocais : null;

    return {
        ip,
        local,
        estadoAtual: {
            ultimoResultado: st.ultimoResultado || 'SEM_DADOS',
            latenciaMediaMs: st.latenciaMediaMs != null ? st.latenciaMediaMs : null,
            falhasConsecutivas: st.falhasConsecutivas || 0,
            downSince: st.downSince || null,
            ultimoHorario: st.ultimoHorario || null,
            janelaRecente: (st.historicoRecente || []).slice(-20)
        },
        serieDiaria: serie,
        alertas: alertasHost,
        diagnostico: diagnosticoCache[ip] || null,
        metricasLocais: ml ? {
            hostname: ml.hostname, info: ml.info, cpu: ml.cpu, gpu: ml.gpu,
            memoria: ml.memoria, disco: ml.disco, uptime: ml.uptime,
            rede: ml.rede, quando: ml.quando
        } : null,
        indisponiveis: local ? [
            'CPU: primeira amostra pode estar indisponivel (disponivel na proxima coleta)'
        ] : [
            'Uso de RAM: indisponivel — sem agente instalado neste PC remoto.',
            'Uso de CPU: indisponivel — sem agente instalado neste PC remoto.',
            'Reinicio confirmado: indisponivel — requer eventos internos do Windows (instale o Zabbix Agent 2).'
        ]
    };
}

/** Metricas REAIS desta maquina (coleta sob demanda se estiver velha). */
async function coletarMetricasLocais() {
    const anterior = metricasLocais && metricasLocais._snapshot;
    metricasLocais = await hostmetrics.coletar(anterior);
    return metricasLocais;
}

function obterMetricasLocais() {
    return metricasLocais;
}

module.exports = {
    iniciar,
    parar,
    recarregarConfig,
    obterPainel,
    obterDetalheHost,
    executarCiclo,
    obterAlvos,
    getConfig: () => config,
    obterLimites,
    LIMITES_PADRAO,
    isHostStale,
    isRodando: () => rodando,
    coletarMetricasLocais,
    obterMetricasLocais,
    ehHostLocal,
    aoFinalizarCiclo,
    getHostHistorico: (ip) => hostHistorico[ip] || { okHistory: [], latHistory: [], timestamps: [] },
    getMockMetricas: (ip) => {
        const s = mockEstado[ip];
        return s ? { historico: s.historicoMetricas, fase: s.fase, t: s.t } : null;
    }
};
