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
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false
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
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
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
    const minFalhas = Number(regras.minFalhasParaDesligadoEsperado) ||
        (cfg.limites && cfg.limites.falhasConsecutivasParaAlerta) || 3;

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

    // Regra 2: erro de host nao encontrado persistente => IP obsoleto (revisar
    // cadastro), nao e "maquina caiu"
    if (ctx.erroPinger === 'host_nao_encontrado' && fc >= 24) {
        return Object.assign({}, base, {
            estado: 'IP_OBSOLETO', confianca: 'MEDIA',
            motivo: 'Host nao encontrado por muitas amostras — revisar IP do cadastro',
            suprimeAlerta: true
        });
    }

    // A partir daqui: nao responde. Descobre se ha justificativa de contexto.
    const jan = janelaAtiva(classCfg, local);
    const feriado = ehFeriado(classCfg, local);
    const excecao = excecaoAtiva(classCfg, ctx.ip, local);
    const dentroJanela = jan.dentro || feriado;
    const modo = classCfg.modo || 'CONSERVADOR';

    // Regra 3: dentro de janela esperada + falhas minimas => DESLIGADO_ESPERADO
    //   - CONSERVADOR: qualquer host dentro da janela (comportamento known do ambiente)
    //   - EXPLICITO: so com excecao nominal para o IP
    if (fc >= minFalhas && dentroJanela) {
        const permitido = modo === 'EXPLICITO' ? !!excecao : true;
        if (permitido) {
            return Object.assign({}, base, {
                estado: 'DESLIGADO_ESPERADO',
                confianca: excecao ? 'ALTA' : 'MEDIA',
                motivo: excecao
                    ? ('Desligamento esperado (excecao): ' + (excecao.motivo || jan.janela))
                    : ('Dentro da janela ' + (feriado ? 'FERIADO' : jan.janela) +
                       ' — desligamento esperado apos ' + fc + ' falhas'),
                janelaId: feriado ? 'FERIADO' : jan.janela,
                suprimeAlerta: true,
                categoriaAlerta: null
            });
        }
    }

    // Regra 4: muitos hosts do setor cairam juntos => parada coletiva legitima
    const maxH = Number(regras.maxHorizontalidadePct) || 40;
    if (fc >= minFalhas && (ctx.horizontalidadePct || 0) >= maxH) {
        return Object.assign({}, base, {
            estado: 'EMPRESA_PARADA', confianca: 'MEDIA',
            motivo: (Math.round(ctx.horizontalidadePct) + '% do setor fora — parada coletiva/fechamento'),
            suprimeAlerta: true, categoriaAlerta: 'INFO'
        });
    }

    // Regra 5: fora da janela / sem justificativa => falha real
    return Object.assign({}, base, {
        estado: 'SEM_RESPOSTA',
        confianca: 'ALTA',
        motivo: 'Sem resposta fora de janela esperada (' + fc + ' falhas' +
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
    hhmmParaMinutos
};
