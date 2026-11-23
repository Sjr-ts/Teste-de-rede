const test = require('node:test');
const assert = require('node:assert/strict');
const cls = require('../monitor/classificador');

// helper: constroi um timestamp UTC a partir de hora LOCAL de Brasilia (UTC-3)
// ex.: 12:30 BRT -> 15:30Z
function brt(diaSemanaISO, hh, mm) {
    // diaSemanaISO: 2026-11-23 (segunda). constroi ISO em UTC = hora local + 3h,
    // ajustando o dia quando passa da meia-noite.
    const base = new Date(`${diaSemanaISO}T00:00:00Z`);
    base.setUTCHours(hh + 3, mm, 0, 0);
    return base.getTime();
}
function medicoes(falhas, okFinal) {
    // array de ' falhas' com ok:false e (se okFinal) uma ultima ok:true
    const arr = [];
    for (let i = 0; i < falhas; i++) arr.push({ ok: false, latenciaMediaMs: null, timestamp: new Date(Date.now() - i * 60000).toISOString() });
    if (okFinal) arr.push({ ok: true, latenciaMediaMs: 5, timestamp: new Date().toISOString() });
    return arr;
}
function config(overrides) {
    return Object.assign({}, {
        limites: { falhasConsecutivasParaAlerta: 3 },
        classificacao: {
            timezone: 'America/Sao_Paulo',
            modo: 'CONSERVADOR',
            janelasEsperadas: [
                { id: 'EXPEDIENTE', dias: [1, 2, 3, 4, 5], inicio: '08:00', fim: '18:00', toleranciaMin: 15 }
            ],
            feriados: [],
            regras: { minFalhasParaDesligadoEsperado: 3, maxHorizontalidadePct: 40 },
            excecoes: []
        }
    }, overrides || {});
}

// ---------------------------------------------------------------------------
test('horaLocal converte UTC para America/Sao_Paulo corretamente', () => {
    const local = cls.horaLocal(brt('2026-11-23', 12, 30)); // 15:30Z
    assert.equal(local.minutoDoDia, 12 * 60 + 30);
    assert.equal(local.diaSemana, 1); // segunda
    assert.equal(local.dataLocal, '2026-11-23');
});

test('ping respondeu => ACESSIVEL e suprime alerta', () => {
    const r = cls.classificar({ ip: '192.168.0.10', now: brt('2026-11-23', 12, 0), medicoesRecentes: medicoes(2, true), config: config() });
    assert.equal(r.estado, 'ACESSIVEL');
    assert.equal(r.suprimeAlerta, true);
});

test('sem medicoes => SEM_DADOS (nao e falha)', () => {
    const r = cls.classificar({ ip: '192.168.0.10', now: brt('2026-11-23', 12, 0), medicoesRecentes: [], config: config() });
    assert.equal(r.estado, 'SEM_DADOS');
});

test('PC desligado DENTRO da janela (12h) => DESLIGADO_ESPERADO, sem alerta', () => {
    const r = cls.classificar({ ip: '192.168.0.108', now: brt('2026-11-23', 12, 30), medicoesRecentes: medicoes(5), config: config() });
    assert.equal(r.estado, 'DESLIGADO_ESPERADO');
    assert.equal(r.suprimeAlerta, true);
    assert.equal(r.janelaId, 'EXPEDIENTE');
    assert.match(r.motivo, /janela/i);
});

test('PC desligado FORA da janela (22h) => SEM_RESPOSTA (falha real)', () => {
    const r = cls.classificar({ ip: '192.168.0.108', now: brt('2026-11-23', 22, 0), medicoesRecentes: medicoes(5), config: config() });
    assert.equal(r.estado, 'SEM_RESPOSTA');
    assert.equal(r.suprimeAlerta, false);
    assert.equal(r.categoriaAlerta, 'CONECTIVIDADE');
});

test('tolerancia de janela: 07:50 (inicio 08:00, tol 15) ainda e esperado', () => {
    const r = cls.classificar({ ip: '192.168.0.108', now: brt('2026-11-23', 7, 50), medicoesRecentes: medicoes(4), config: config() });
    assert.equal(r.estado, 'DESLIGADO_ESPERADO');
});

test('fim de semana nao e janela (dias 1-5) => SEM_RESPOSTA', () => {
    // 2026-11-28 e sabado
    const local = cls.horaLocal(brt('2026-11-28', 12, 0));
    assert.equal(local.diaSemana, 6);
    const r = cls.classificar({ ip: '192.168.0.108', now: brt('2026-11-28', 12, 0), medicoesRecentes: medicoes(5), config: config() });
    assert.equal(r.estado, 'SEM_RESPOSTA');
});

test('feriado => DESLIGADO_ESPERADO mesmo fora da janela de dias', () => {
    const c = config();
    c.classificacao.feriados = ['2026-12-25'];
    const r = cls.classificar({ ip: '192.168.0.108', now: brt('2026-12-25', 22, 0), medicoesRecentes: medicoes(5), config: c });
    assert.equal(r.estado, 'DESLIGADO_ESPERADO');
    assert.equal(r.janelaId, 'FERIADO');
});

test('parada coletiva (>=40% do setor fora) => EMPRESA_PARADA', () => {
    const r = cls.classificar({ ip: '192.168.0.108', now: brt('2026-11-23', 22, 0), medicoesRecentes: medicoes(5), config: config(), horizontalidadePct: 60 });
    assert.equal(r.estado, 'EMPRESA_PARADA');
    assert.equal(r.suprimeAlerta, true);
});

test('modo EXPLICITO sem excecao => SEM_RESPOSTA mesmo dentro da janela', () => {
    const c = config();
    c.classificacao.modo = 'EXPLICITO';
    const r = cls.classificar({ ip: '192.168.0.108', now: brt('2026-11-23', 12, 30), medicoesRecentes: medicoes(5), config: c });
    assert.equal(r.estado, 'SEM_RESPOSTA');
});

test('modo EXPLICITO com excecao ativa => DESLIGADO_ESPERADO', () => {
    const c = config();
    c.classificacao.modo = 'EXPLICITO';
    c.classificacao.excecoes = [{ ip: '192.168.0.108', motivo: 'Reduz ciclo de formatacao', ate: '2027-12-31' }];
    const r = cls.classificar({ ip: '192.168.0.108', now: brt('2026-11-23', 12, 30), medicoesRecentes: medicoes(5), config: c });
    assert.equal(r.estado, 'DESLIGADO_ESPERADO');
    assert.equal(r.confianca, 'ALTA');
});

test('IP obsoleto (host_nao_encontrado por 24h) => IP_OBSOLETO, sem alerta', () => {
    const r = cls.classificar({ ip: '192.168.0.99', now: brt('2026-11-23', 22, 0), medicoesRecentes: medicoes(25), config: config(), erroPinger: 'host_nao_encontrado' });
    assert.equal(r.estado, 'IP_OBSOLETO');
    assert.equal(r.suprimeAlerta, true);
});

test('falhas consecutivas sao contadas pelo fim do historico', () => {
    assert.equal(cls.falhasConsecutivas(medicoes(3)), 3);
    assert.equal(cls.falhasConsecutivas(medicoes(3, true)), 0);
    assert.equal(cls.falhasConsecutivas([]), 0);
});

test('abaixo do limiar de falhas (1) dentro da janela => SEM_RESPOSTA (ainda nao classifica)', () => {
    const r = cls.classificar({ ip: '192.168.0.108', now: brt('2026-11-23', 12, 30), medicoesRecentes: medicoes(1), config: config() });
    assert.equal(r.estado, 'SEM_RESPOSTA');
});
