'use strict';
/**
 * Classificador de CONTEXTO — separa "PC desligado legitimamente" de "falha real".
 *
 * O ping so diz "respondeu / nao respondeu". Este modulo interpreta o contexto
 * (horario local, janela esperada, excecoes por IP, horizontalidade do setor)
 * ANTES de o motor gerar alertas ou KPIs. Assim um PC desligado no almoco nao
 * vira "erro" e nao derruba a disponibilidade.
 *
 * Deterministico e puro: nao faz I/O, so recebe dados e devolve uma decisao.
 * Fuso horario explicito (America/Sao_Paulo) — timestamps sao ISO/UTC, entao
 * NADA de getHours() direto: usamos Intl.DateTimeFormat com timeZone.
 */

const FMT_HORA = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const FMT_DIA = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', weekday: 'short'
});
const FMT_DATA = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
});

const DIAS = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };

/** remove acentos: "sáb" -> "sab" */
function semAcento(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Converte "HH:MM" em minutos desde a meia-noite. */
function hhmmParaMinutos(s) {
    const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = Number(m[1]), min = Number(m[2]);
    if (h > 24 || min > 59) return null;
    if (h === 24 && min === 0) return 0; // ICU pode emitir "24:00" para meia-noite
    return (h % 24) * 60 + min;
}

/** Retorna { minutoDoDia, diaSemana, dataLocal } no fuso configurado. */
function horaLocal(now) {
    const d = new Date(now);
    const horaStr = FMT_HORA.format(d);              // "12:34"
    const minutoDoDia = hhmmParaMinutos(horaStr);
    const diaFormatado = semAcento(FMT_DIA.format(d)).replace('.', ''); // "sab"
    let diaSemana = DIAS[diaFormatado];
    if (diaSemana == null) diaSemana = DIAS[semAcento(FMT_DIA.format(d)).replace('.', '')];
    const dataLocal = FMT_DATA.format(d);            // AAAA-MM-DD (en-CA)
    return { minutoDoDia, diaSemana, dataLocal };
}

/**
 * Verifica se agora esta dentro de alguma janela esperada.
 * @returns {janela, dentro, motivo}
 */
function janelaAtiva(classificacao, local) {
    const janelas = (classificacao && classificacao.janelasEsperadas) || [];
    for (const j of janelas) {
        const ini = hhmmParaMinutos(j.inicio);
        const fim = hhmmParaMinutos(j.fim);
        if (ini == null || fim == null) continue;
        const dias = Array.isArray(j.dias) ? j.dias : [1, 2, 3, 4, 5];
        if (local.diaSemana != null && dias.indexOf(local.diaSemana) < 0) continue;
        const tol = Number(j.toleranciaMin || 0);
        // janela estendida pela tolerancia (cobre boot logo apos o inicio)
        if (local.minutoDoDia >= ini - tol && local.minutoDoDia <= fim + tol) {
            return { janela: j.id || 'JANELA', dentro: true };
        }
    }
    return { janela: null, dentro: false };
}

function ehFeriado(classificacao, local) {
    const feriados = (classificacao && classificacao.feriados) || [];
    return feriados.indexOf(local.dataLocal) >= 0;
}

function excecaoAtiva(classificacao, ip, local) {
    const excecoes = (classificacao && classificacao.excecoes) || [];
    for (const e of excecoes) {
        if (String(e.ip) !== String(ip)) continue;
        if (e.ate && local.dataLocal > e.ate) continue;
        return e;
    }
    return null;
}

/** Verifica janelas de desligamento EXPLICITAS (durante o expediente). */
function janelaDesligamentoAtiva(classCfg, local) {
    const copia = Object.assign({}, classCfg, { janelasEsperadas: classCfg.janelasDesligamento || [] });
    return janelaAtiva(copia, local);
}

/**
 * Detecta padrao de desligamento HABITUAL: o host caiu no mesmo bucket horario
 * em >= minDias dias distintos dentro da janela de recorrencia. Isso captura
 * o cenario real do usuario (PC desligado durante o dia para reduzir formata-
 * caO), mesmo que occurs dentro do "expediente".
 */
function detectarRecorrencia(ip, agora, cfg, agregados) {
    const regras = (cfg && cfg.classificacao && cfg.classificacao.regras) || {};
    const minDias = Number.isFinite(Number(regras.minDiasRecorrencia)) ? Number(regras.minDiasRecorrencia) : 3;
    const janelaDias = Number.isFinite(Number(regras.janelaRecorrenciaDias)) ? Number(regras.janelaRecorrenciaDias) : 30;
    const local = horaLocal(agora);
    const horaAtual = String(Math.floor(local.minutoDoDia / 60)).padStart(2, '0');
    const limite = agora - janelaDias * 86400000;
    let diasComQueda = 0;
    const vistos = new Set();
    for (const agg of (Array.isArray(agregados) ? agregados : [])) {
        const tsDia = new Date(String(agg && agg.dia) + 'T00:00:00Z').getTime();
        if (!Number.isFinite(tsDia) || tsDia < limite) continue;
        const host = agg.hosts && agg.hosts[ip];
        if (!host || !host.buckets) continue;
        for (const [bk, m] of Object.entries(host.buckets)) {
            if (bk.slice(11, 13) !== horaAtual) continue;
            const perda = m.perdaPct != null ? m.perdaPct : (m.n > 0 ? (m.falhas / m.n) * 100 : 0);
            if (perda >= 50) { vistos.add(agg.dia); break; }
        }
    }
    diasComQueda = vistos.size;
    return { recorrente: diasComQueda >= minDias, dias: diasComQueda, hora: horaAtual,
             confianca: diasComQueda >= minDias ? 'ALTA' : 'BAIXA' };
}

/**
 * Conta falhas consecutivas a partir do fim do historico recente.
 * @param {Array} medicoes [{ok, timestamp, ...}]
 */
function falhasConsecutivas(medicoes) {
    let n = 0;
    const arr = Array.isArray(medicoes) ? medicoes : [];
    for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i] && arr[i].ok) break;
        n++;
    }
    return n;
}

/**
 * Classifica o estado de um host.
 *
 * @param {Object} ctx
 *   @param {string} ctx.ip
 *   @param {number} ctx.now            timestamp ms (testes podem fixar)
 *   @param {Array}  ctx.medicoesRecentes
 *   @param {Object} ctx.estadoAnterior (st do state.json)
 *   @param {Object} ctx.config          config.json completo
 *   @param {number} ctx.horizontalidadePct  % do setor fora ao mesmo tempo (0-100)
 *   @param {string} ctx.erroPinger      erro bruto do pinger (opcional)
 * @returns {{estado, confianca, motivo, janelaId, suprimeAlerta, categoriaAlerta}}
 */
function classificar(ctx) {
    const cfg = ctx.config || {};
    const classCfg = cfg.classificacao || {};
    const regras = classCfg.regras || {};
    const agora = ctx.now != null ? ctx.now : Date.now();
    const local = horaLocal(agora);
    const medicoes = ctx.medicoesRecentes || [];
    const st = ctx.estadoAnterior || {};
    // coalescencia nula: 0 e um valor valido (classificar imediatamente)
    const minFalhasCfg = Number(regras.minFalhasParaDesligadoEsperado);
    const minFalhas = Number.isFinite(minFalhasCfg) ? minFalhasCfg
        : (Number(cfg.limites && cfg.limites.falhasConsecutivasParaAlerta) || 3);

    const base = {
        estado: 'SEM_RESPOSTA', confianca: 'BAIXA', motivo: '', janelaId: null,
        suprimeAlerta: false, categoriaAlerta: null
    };

    // Regra 0: historico insuficiente / dado velho => SEM_DADOS (nao e falha)
    if (!medicoes.length) {
        return Object.assign({}, base, {
            estado: 'SEM_DADOS', motivo: 'Sem medicoes recentes para classificar'
        });
    }

    const fc = falhasConsecutivas(medicoes);
    const ultima = medicoes[medicoes.length - 1];
    const ultimaOk = !!(ultima && ultima.ok);

    // Regra 1: respondeu => ACESSIVEL (recuperacao; o motor resolve alertas)
    if (ultimaOk) {
        return Object.assign({}, base, {
            estado: 'ACESSIVEL', confianca: 'ALTA', motivo: 'Ping respondeu',
            suprimeAlerta: true
        });
    }

    // Regra 2: erro de host nao encontrado persistente => IP obsoleto.
    // PROBLEMA ACIONAVEL DE CADASTRO: gera alerta (nao suprime) para o admin
    // revisar o ipAddress no inventario.
    const minObsoleto = Number.isFinite(Number(regras.minFalhasParaIpObsoleto))
        ? Number(regras.minFalhasParaIpObsoleto) : 24;
    if (ctx.erroPinger === 'host_nao_encontrado' && fc >= minObsoleto) {
        return Object.assign({}, base, {
            estado: 'IP_OBSOLETO', confianca: 'MEDIA',
            motivo: 'Host nao encontrado por ' + fc + ' amostras — revisar IP no cadastro',
            suprimeAlerta: false, categoriaAlerta: 'CADASTRO'
        });
    }

    // Agora: a partir daqui o host NAO responde. Descobre se ha justificativa
    // de contexto para tratar como desligamento legitimo (e nao como falha).
    const jan = janelaAtiva(classCfg, local);
    const feriado = ehFeriado(classCfg, local);
    const excecao = excecaoAtiva(classCfg, ctx.ip, local);
    // janelasEsperadas = JANELAS DE OPERACAO: horarios em que o PC DEVE estar UP.
    // Fora delas (noite, fim de semana, feriado) o desligamento e esperado.
    // ANTES estava invertido: dentro do expediente era tratado como desligado,
    // o que escondia falha real as 10h e alertava desligamento as 22h.
    const foraDoExpediente = !jan.dentro || feriado;
    const modo = classCfg.modo || 'CONSERVADOR';
    // Janelas de DESLIGAMENTO explicitas (ex.: almoco 12-13h): o admin marca
    // quando o PC pode ser desligado DURANTE o expediente. Resolve o cenario do
    // usuario sem inferir padrao onde os dados nao mostram um.
    const janDeslig = janelaDesligamentoAtiva(classCfg, local);
    // Recorrencia APRENDIDA com o historico: se o host costuma cair nesta mesma
    // hora em varios dias, e desligamento habitual — mesmo dentro do expediente.
    const recorrencia = detectarRecorrencia(ctx.ip, agora, cfg, ctx.agregados);
    const desligamentoHabitual = recorrencia.recorrente && modo !== 'DESLIGADO';
    const minHosts = Number.isFinite(Number(regras.minHostsParaParadaColetiva))
        ? Number(regras.minHostsParaParadaColetiva) : 5;
    const totalSetor = Number(ctx.totalSetor || 0);
    const foraSetor = Number(ctx.foraNoSetor || 0);
    const maxH = Number.isFinite(Number(regras.maxHorizontalidadePct))
        ? Number(regras.maxHorizontalidadePct) : 40;

    // Parada COLETIVA primeiro (so com setor grande o suficiente para nao
    // transformar a falha de 1 PC isolado em "fechamento da empresa").
    if (fc >= minFalhas && totalSetor >= minHosts && foraSetor >= 2 &&
        (ctx.horizontalidadePct || 0) >= maxH) {
        return Object.assign({}, base, {
            estado: 'EMPRESA_PARADA', confianca: 'MEDIA',
            motivo: (Math.round(ctx.horizontalidadePct) + '% do setor (' + foraSetor +
                '/' + totalSetor + ') fora — parada coletiva/fechamento'),
            suprimeAlerta: true, categoriaAlerta: 'INFO'
        });
    }

    // DESLIGADO HABITUAL (recorrencia aprendida): padrao repetido nos agregados
    // — captura o PC que desliga todo dia as 12h mesmo dentro do expediente.
    if (fc >= minFalhas && desligamentoHabitual) {
        return Object.assign({}, base, {
            estado: 'DESLIGADO_ESPERADO',
            confianca: 'ALTA',
            motivo: ('Desligamento habitual: caiu as ' + recorrencia.hora + 'h em ' +
                     recorrencia.dias + ' dias differentes (padrao aprendido)'),
            janelaId: 'RECORRENCIA',
            suprimeAlerta: true,
            categoriaAlerta: null
        });
    }

    // Janela de DESLIGAMENTO explicitamente configurada (ex.: almoco).
    if (fc >= minFalhas && janDeslig.dentro) {
        return Object.assign({}, base, {
            estado: 'DESLIGADO_ESPERADO',
            confianca: 'ALTA',
            motivo: ('Dentro da janela de desligamento ' + (janDeslig.janela || 'configurada') +
                     ' — desligamento autorizado apos ' + fc + ' falhas'),
            janelaId: janDeslig.janela || 'DESLIGAMENTO',
            suprimeAlerta: true,
            categoriaAlerta: null
        });
    }

    // DESLIGADO ESPERADO: fora do expediente (noite/fds/feriado) + falhas
    // minimas. Noite/fds e quando o pessoal desliga o PC para reduzir ciclo
    // de formatacao — exatamente o cenario do usuario.
    //   - CONSERVADOR: qualquer host fora do expediente
    //   - EXPLICITO: so com excecao nominal para o IP
    if (fc >= minFalhas && foraDoExpediente) {
        const permitido = modo === 'EXPLICITO' ? !!excecao : true;
        if (permitido) {
            return Object.assign({}, base, {
                estado: 'DESLIGADO_ESPERADO',
                confianca: excecao ? 'ALTA' : 'MEDIA',
                motivo: excecao
                    ? ('Desligamento esperado (excecao): ' + (excecao.motivo || 'fora do expediente'))
                    : ('Fora do expediente' + (feriado ? ' (feriado)' : (jan.janela ? ' (' + jan.janela + ')' : '')) +
                       ' — desligamento esperado apos ' + fc + ' falhas'),
                janelaId: feriado ? 'FERIADO' : (jan.janela ? null : 'FORA_EXPEDIENTE'),
                suprimeAlerta: true,
                categoriaAlerta: null
            });
        }
    }

    // FALHA REAL: dentro do expediente (PC deveria estar ligado) e sem
    // justificativa de parada coletiva => alerta normal.
    return Object.assign({}, base, {
        estado: 'SEM_RESPOSTA',
        confianca: 'ALTA',
        motivo: 'Sem resposta dentro do expediente (' + fc + ' falhas' +
            (jan.janela ? ', janela ' + jan.janela : '') + ')',
        janelaId: jan.janela,
        categoriaAlerta: 'CONECTIVIDADE'
    });
}

module.exports = {
    classificar,
    falhasConsecutivas,
    janelaAtiva,
    horaLocal,
    hhmmParaMinutos,
    detectarRecorrencia
};
