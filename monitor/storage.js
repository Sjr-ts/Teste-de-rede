'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const RAW_DIR = path.join(DATA_DIR, 'raw');
const AGG_DIR = path.join(DATA_DIR, 'agg');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const ALERTS_FILE = path.join(DATA_DIR, 'alerts.json');
const TARGETS_FILE = path.join(DATA_DIR, 'targets.json');

for (const d of [DATA_DIR, RAW_DIR, AGG_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function hoje() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
}

function rawFile(dia) {
    return path.join(RAW_DIR, (dia || hoje()) + '.jsonl');
}

/** Append uma medicao crua (1 linha JSON por evento). */
function appendMedicao(registro) {
    const linha = JSON.stringify(registro) + '\n';
    fs.appendFileSync(rawFile(), linha);
}

/**
 * Agrega medicoes de um dia por host em buckets horarios.
 * Calcula: n, sucessos, falhas, perdaMedia, latMedia, latMin, latMax, p95.
 */
function agregarDia(dia) {
    const arquivo = rawFile(dia);
    if (!fs.existsSync(arquivo)) return null;

    const porHost = {};
    const linhas = fs.readFileSync(arquivo, 'utf8').split('\n').filter(Boolean);
    for (const l of linhas) {
        let r;
        try { r = JSON.parse(l); } catch (e) { continue; }
        if (!r.host) continue;
        const h = r.host;
        if (!porHost[h]) porHost[h] = [];
        porHost[h].push(r);
    }

    const resultado = { dia, geradoEm: new Date().toISOString(), hosts: {} };

    for (const [host, regs] of Object.entries(porHost)) {
        const sucessos = regs.filter(r => r.ok);
        const falhas = regs.filter(r => !r.ok);
        const latencias = sucessos
            .map(r => r.latenciaMediaMs)
            .filter(v => v !== null && v !== undefined && !isNaN(v))
            .sort((a, b) => a - b);

        const buckets = {};
        for (const r of regs) {
            const hora = r.timestamp ? r.timestamp.slice(0, 13) : 'desconhecida';
            if (!buckets[hora]) buckets[hora] = { n: 0, ok: 0, falhas: 0, latencias: [] };
            buckets[hora].n++;
            if (r.ok) {
                buckets[hora].ok++;
                if (r.latenciaMediaMs != null) buckets[hora].latencias.push(r.latenciaMediaMs);
            } else {
                buckets[hora].falhas++;
            }
        }

        const bucketsOut = {};
        for (const [hora, b] of Object.entries(buckets)) {
            const avg = b.latencias.length ? b.latencias.reduce((a, c) => a + c, 0) / b.latencias.length : null;
            bucketsOut[hora] = {
                n: b.n,
                ok: b.ok,
                falhas: b.falhas,
                perdaPct: b.n ? Math.round((b.falhas / b.n) * 10000) / 100 : 0,
                latenciaMediaMs: avg !== null ? Math.round(avg * 100) / 100 : null,
                latenciaMinMs: b.latencias.length ? Math.min(...b.latencias) : null,
                latenciaMaxMs: b.latencias.length ? Math.max(...b.latencias) : null
            };
        }

        const p95 = percentil(latencias, 95);
        resultado.hosts[host] = {
            totalMedicoes: regs.length,
            sucessos: sucessos.length,
            falhas: falhas.length,
            perdaPct: regs.length ? Math.round((falhas.length / regs.length) * 10000) / 100 : 0,
            latenciaMediaMs: latencias.length ? Math.round((latencias.reduce((a, c) => a + c, 0) / latencias.length) * 100) / 100 : null,
            latenciaMedianaMs: percentil(latencias, 50),
            latenciaP95Ms: p95,
            latenciaMinMs: latencias.length ? latencias[0] : null,
            latenciaMaxMs: latencias.length ? latencias[latencias.length - 1] : null,
            buckets: bucketsOut
        };
    }

    const out = path.join(AGG_DIR, dia + '.json');
    fs.writeFileSync(out, JSON.stringify(resultado));
    return resultado;
}

function percentil(sortedArr, p) {
    if (!sortedArr || !sortedArr.length) return null;
    const idx = Math.ceil((p / 100) * sortedArr.length) - 1;
    return sortedArr[Math.max(0, Math.min(idx, sortedArr.length - 1))];
}

/** Le agregados de N dias atras. */
function lerAggregados(dias = 7) {
    const saida = [];
    const agora = new Date();
    for (let i = 0; i < dias; i++) {
        const d = new Date(agora.getTime() - i * 86400000);
        const dia = d.toISOString().slice(0, 10);
        const arq = path.join(AGG_DIR, dia + '.json');
        if (fs.existsSync(arq)) {
            try { saida.push(JSON.parse(fs.readFileSync(arq, 'utf8'))); } catch (e) {}
        }
    }
    return saida;
}

/** Limpeza de arquivos raw antigos (retencao configuravel). */
function limparAntigos(retencaoDias) {
    const corte = Date.now() - retencaoDias * 86400000;
    let removidos = 0;
    for (const tipo of [RAW_DIR, AGG_DIR]) {
        for (const f of fs.readdirSync(tipo)) {
            const m = f.match(/^(\d{4}-\d{2}-\d{2})/);
            if (!m) continue;
            if (new Date(m[1] + 'T00:00:00Z').getTime() < corte) {
                try { fs.unlinkSync(path.join(tipo, f)); removidos++; } catch (e) {}
            }
        }
    }
    return removidos;
}

// ---------- estado em memoria (transitorio entre ciclos) ----------
function lerEstado() {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return {}; }
}
function salvarEstado(estado) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(estado));
}

// ---------- alertas ----------
function lerAlertas() {
    try { return JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8')); } catch (e) { return []; }
}
function salvarAlertas(alertas) {
    fs.writeFileSync(ALERTS_FILE, JSON.stringify(alertas, null, 1));
}

// ---------- alvos (IPs cadastrados para monitorar) ----------
function lerAlvos() {
    try {
        let raw = fs.readFileSync(TARGETS_FILE, 'utf8');
        if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
        const a = JSON.parse(raw);
        if (Array.isArray(a)) return a.filter(t => t && (t.ip || t.ipAddress)).map(t => ({ ...t, ip: t.ip || t.ipAddress }));
    } catch (e) {}
    return [];
}
function salvarAlvos(alvos) {
    fs.writeFileSync(TARGETS_FILE, JSON.stringify(alvos, null, 1));
}

/** Estatisticas do armazenamento de medicoes (arquivos raw + agregados). */
function estatisticasArmazenamento() {
    const stats = {
        diretorioRaw: RAW_DIR,
        diretorioAgg: AGG_DIR,
        arquivos: [],
        totalMedicoes: 0,
        totalBytes: 0,
        totalBytesAgg: 0,
        diasComDados: 0,
        primeiraMedicao: null,
        ultimaMedicao: null,
        tamanhoHojeBytes: 0,
        medicoesHoje: 0
    };

    const hojeStr = hoje();

    // Arquivos raw (JSONL por dia)
    if (fs.existsSync(RAW_DIR)) {
        const arquivos = fs.readdirSync(RAW_DIR).filter(f => f.endsWith('.jsonl')).sort();
        stats.diasComDados = arquivos.length;
        for (const f of arquivos) {
            const caminho = path.join(RAW_DIR, f);
            const st = fs.statSync(caminho);
            const dia = f.replace('.jsonl', '');
            // Conta linhas (medicoes) — le em streaming para nao estourar memoria
            let medicoes = 0;
            try {
                const conteudo = fs.readFileSync(caminho, 'utf8');
                medicoes = conteudo.split('\n').filter(Boolean).length;
                // Primeira e ultima medicao do arquivo
                const linhas = conteudo.split('\n').filter(Boolean);
                if (linhas.length) {
                    try {
                        const primeira = JSON.parse(linhas[0]);
                        const ultima = JSON.parse(linhas[linhas.length - 1]);
                        if (primeira.timestamp) {
                            if (!stats.primeiraMedicao || primeira.timestamp < stats.primeiraMedicao) {
                                stats.primeiraMedicao = primeira.timestamp;
                            }
                        }
                        if (ultima.timestamp) {
                            if (!stats.ultimaMedicao || ultima.timestamp > stats.ultimaMedicao) {
                                stats.ultimaMedicao = ultima.timestamp;
                            }
                        }
                    } catch (e) {}
                }
            } catch (e) {}

            stats.totalMedicoes += medicoes;
            stats.totalBytes += st.size;
            if (dia === hojeStr) {
                stats.tamanhoHojeBytes = st.size;
                stats.medicoesHoje = medicoes;
            }
            stats.arquivos.push({ dia, medicoes, tamanhoBytes: st.size, caminho });
        }
    }

    // Arquivos de agregados
    if (fs.existsSync(AGG_DIR)) {
        for (const f of fs.readdirSync(AGG_DIR).filter(f => f.endsWith('.json')).sort()) {
            const st = fs.statSync(path.join(AGG_DIR, f));
            stats.totalBytesAgg += st.size;
        }
    }

    stats.tamanhoTotalMB = Math.round(((stats.totalBytes + stats.totalBytesAgg) / 1048576) * 100) / 100;
    return stats;
}

/** Historico de um host a partir dos agregados diarios. */
function historicoHost(ip, dias = 7) {
    const agregados = lerAggregados(dias);
    const serie = [];
    for (const agg of agregados) {
        const h = agg.hosts && agg.hosts[ip];
        if (h) {
            serie.push({
                dia: agg.dia,
                totalMedicoes: h.totalMedicoes,
                sucessos: h.sucessos,
                falhas: h.falhas,
                perdaPct: h.perdaPct,
                latenciaMediaMs: h.latenciaMediaMs,
                latenciaMedianaMs: h.latenciaMedianaMs,
                latenciaP95Ms: h.latenciaP95Ms,
                latenciaMinMs: h.latenciaMinMs,
                latenciaMaxMs: h.latenciaMaxMs
            });
        }
    }
    serie.reverse(); // mais antigo primeiro
    return serie;
}

/**
 * Catalogo de tipos de falha conhecidos pelo pinger.
 * Traduz o codigo tecnico (ex: tempo_esgotado) em linguagem humana,
 * com causa provavel e recomendacao de acao para a equipe de TI.
 */
const CATALOGO_FALHAS = {
    tempo_esgotado: {
        nome: 'Tempo esgotado (sem resposta ICMP)',
        causa: 'O host nao respondeu dentro do timeout. PC desligado, em suspensao/hibernacao, cabo desconectado, firewall bloqueando ICMP ou rede congestionada.',
        recomendacao: 'Verificar se o PC esta ligado (pedir ao usuario ou usar Wake-on-LAN). Se ligado, checar cabo/porta do switch e regra de firewall (ICMP).'
    },
    destino_inacessivel: {
        nome: 'Destino inacessivel',
        causa: 'O gateway/rede respondeu que nao ha rota ate o host. Geralmente cabo desconectado no destino, placa de rede desativada ou IP fora da sub-rede.',
        recomendacao: 'Verificar fisicamente cabo e LED da placa de rede do destino. Confirmar se o IP configurado corresponde a mesma sub-rede (192.168.0.x).'
    },
    host_nao_encontrado: {
        nome: 'Host nao encontrado',
        causa: 'Resolucao de nome falhou ou IP nao existe mais na rede (equipamento desligado a longo prazo ou IP alterado).',
        recomendacao: 'Confirmar se o IP do cadastro esta correto no inventario. Verificar tabela ARP do gateway.'
    },
    sem_resposta: {
        nome: 'Sem resposta',
        causa: 'Nenhuma das tentativas de ping obteve resposta e o SO nao indicou causa especifica.',
        recomendacao: 'Repetir a verificacao. Se persistir, testar ping de outra maquina do mesmo segmento para isolar o problema.'
    },
    timeout_do_processo: {
        nome: 'Tempo limite do processo de ping',
        causa: 'O processo de ping demorou mais que o permitido e foi finalizado. Indicativo de rede muito lenta ou host sobrecarregado.',
        recomendacao: 'Verificar carga da rede no horario da falha e consumo do host (via Zabbix quando disponivel).'
    },
    timeout: {
        nome: 'Timeout de conexao TCP',
        causa: 'A porta TCP configurada nao respondeu dentro do tempo limite. Servico parado ou firewall bloqueando a porta.',
        recomendacao: 'Confirmar se o servico esta rodando no host e se a porta esta aberta no firewall.'
    }
};

function descreverFalha(erro) {
    return CATALOGO_FALHAS[erro] || {
        nome: erro ? String(erro) : 'Falha desconhecida',
        causa: 'Tipo de erro nao catalogado pelo coletor.',
        recomendacao: 'Analisar manualmente o registro bruto da medicao.'
    };
}

/**
 * Analisa as falhas de um host nos ultimos N dias a partir dos arquivos raw.
 * Retorna registros individuais + agrupamento por tipo de erro com
 * descricao humana, causa provavel, recomendacao e janela temporal.
 */
function falhasHost(ip, dias = 7, limiteRegistros = 200) {
    const agora = new Date();
    const registros = [];
    for (let i = 0; i < dias; i++) {
        const d = new Date(agora.getTime() - i * 86400000);
        const dia = d.toISOString().slice(0, 10);
        const arquivo = path.join(RAW_DIR, dia + '.jsonl');
        if (!fs.existsSync(arquivo)) continue;
        try {
            const linhas = fs.readFileSync(arquivo, 'utf8').split('\n').filter(Boolean);
            for (const l of linhas) {
                let r;
                try { r = JSON.parse(l); } catch (e) { continue; }
                if (r.host !== ip) continue;
                if (r.ok !== false) continue;
                registros.push({
                    dia,
                    timestamp: r.timestamp,
                    erro: r.erro || 'sem_resposta',
                    perdaPct: r.perdaPct,
                    enviado: r.enviado,
                    recebido: r.recebido,
                    metodo: r.metodo,
                    nome: r.nome,
                    setor: r.setor
                });
            }
        } catch (e) {}
    }
    registros.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));

    // Agrupa por tipo de erro
    const grupos = {};
    for (const f of registros) {
        if (!grupos[f.erro]) {
            const desc = descreverFalha(f.erro);
            grupos[f.erro] = {
                erro: f.erro,
                nome: desc.nome,
                causa: desc.causa,
                recomendacao: desc.recomendacao,
                total: 0,
                primeiro: f.timestamp,
                ultimo: f.timestamp,
                dias: {},
                exemplos: []
            };
        }
        const g = grupos[f.erro];
        g.total++;
        if (f.timestamp < g.primeiro) g.primeiro = f.timestamp;
        if (f.timestamp > g.ultimo) g.ultimo = f.timestamp;
        g.dias[f.dia] = (g.dias[f.dia] || 0) + 1;
        if (g.exemplos.length < 10) {
            g.exemplos.push({ timestamp: f.timestamp, perdaPct: f.perdaPct, enviado: f.enviado, recebido: f.recebido, metodo: f.metodo });
        }
    }

    return {
        host: ip,
        diasAnalisados: dias,
        totalFalhas: registros.length,
        registros: registros.slice(0, limiteRegistros),
        porTipo: Object.values(grupos).sort((a, b) => b.total - a.total),
        geradoEm: new Date().toISOString()
    };
}

/** Le as ultimas N medicoes brutas de um host (do arquivo raw de hoje). */
function ultimasMedicoes(host, limite = 50) {
    const arquivo = rawFile();
    if (!fs.existsSync(arquivo)) return [];
    try {
        const linhas = fs.readFileSync(arquivo, 'utf8').split('\n').filter(Boolean);
        const resultado = [];
        for (let i = linhas.length - 1; i >= 0 && resultado.length < limite; i--) {
            try {
                const r = JSON.parse(linhas[i]);
                if (r.host === host) resultado.unshift(r);
            } catch (e) {}
        }
        return resultado;
    } catch (e) {
        return [];
    }
}

module.exports = {
    appendMedicao,
    agregarDia,
    lerAggregados,
    limparAntigos,
    lerEstado,
    salvarEstado,
    lerAlertas,
    salvarAlertas,
    lerAlvos,
    salvarAlvos,
    percentil,
    estatisticasArmazenamento,
    historicoHost,
    ultimasMedicoes,
    falhasHost,
    descreverFalha,
    CATALOGO_FALHAS,
    DATA_DIR,
    RAW_DIR,
    AGG_DIR
};
