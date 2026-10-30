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
const zabbix = require('./zabbix');
const hostmetrics = require('./hostmetrics');

const CONFIG_PATH = path.join(__dirname, 'config.json');

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
    try {
        let raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
        return JSON.parse(raw);
    } catch (e) {
        return {
            coletor: { intervaloSegundos: 60, timeoutMs: 2000, tentativasPorCiclo: 3, concorrenciaMaxima: 10, retencaoMedicoesDias: 30 },
            limites: { latenciaMediaMs: 80, latenciaP95Ms: 200, perdaPacotesPct: 10, falhasConsecutivasParaAlerta: 3 },
            zabbix: { habilitado: false },
            servicos: []
        };
    }
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

                    // Usa reg.ok para considerar dados
                    const usouMock = r.ok;
                    const st = estado[alvo.ip] || { falhasConsecutivas: 0, downSince: null, upSince: null, historicoRecente: [] };
                    if (!usouMock) {
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
                    st.ultimoResultado = usouMock ? 'ACESSIVEL' : 'SEM_RESPOSTA';
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
    const agora = Date.now();
    const silencioMs = (config.alertas.silenciarRepetidosMinutos || 15) * 60000;
    const novosDiagnostico = {};

    for (const [host, st] of Object.entries(estado)) {
        const medicoes = st.historicoRecente || [];
        const { novos, resolucoes } = avaliarHost(host, medicoes, st, config, null);
        novosDiagnostico[host] = {
            observado: st,
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
            try { store.limparAntigos(config.coletor.retencaoMedicoesDias || 30); } catch (e) {}
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

    const acessiveis = Object.values(estado).filter(s => s.ultimoResultado === 'ACESSIVEL').length;
    const semResposta = Object.values(estado).filter(s => s.ultimoResultado === 'SEM_RESPOSTA').length;
    const instaveis = Object.values(estado).filter(s => s.falhasConsecutivas > 0 && s.falhasConsecutivas < (config.limites.falhasConsecutivasParaAlerta || 3)).length;
    const semDados = alvos.length - Object.keys(estado).length;

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
            estado: stale && st.ultimoResultado === 'ACESSIVEL' ? 'SEM_DADOS' : (st.ultimoResultado || 'SEM_DADOS'),
            latenciaMediaMs: st.latenciaMediaMs != null ? st.latenciaMediaMs : null,
            falhasConsecutivas: st.falhasConsecutivas || 0,
            downSince: st.downSince || null,
            recuperadoApos: st.recuperadoApos || null,
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
            semResposta,
            instaveis,
            semDados: Math.max(0, semDados),
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
