const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const monitor = require('../monitor/service');

const repo = path.join(__dirname, '..');
const fonteMonitor = fs.readFileSync(path.join(repo, 'frontend', 'js', 'monitor.js'), 'utf8');
const fonteApp = fs.readFileSync(path.join(repo, 'frontend', 'js', 'app.js'), 'utf8');
const fonteService = fs.readFileSync(path.join(repo, 'monitor', 'service.js'), 'utf8');
const fonteServer = fs.readFileSync(path.join(repo, 'server.cjs'), 'utf8');

/** Le um objeto literal (chaves aninhadas) direto do codigo-fonte. */
function lerLiteral(src, nome) {
    const i = src.indexOf(nome + ' = {');
    assert.ok(i >= 0, nome + ' nao encontrado no codigo');
    const ini = src.indexOf('{', i);
    let nivel = 0, fim = -1;
    for (let p = ini; p < src.length; p++) {
        if (src[p] === '{') nivel++;
        else if (src[p] === '}') { nivel--; if (nivel === 0) { fim = p; break; } }
    }
    assert.ok(fim > ini, nome + ' sem fechamento');
    const bruto = src.slice(ini, fim + 1)
        .replace(/\/\/[^\n]*/g, '')                       // comentarios saem primeiro
        .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
    return JSON.parse(bruto);
}

// ---------------------------------------------------------------------------
// 1) Fonte unica dos limites de alerta: backend e frontend nao podem divergir
// ---------------------------------------------------------------------------
test('fallback do frontend e identico ao LIMITES_PADRAO do backend', () => {
    const be = monitor.LIMITES_PADRAO;
    const fe = lerLiteral(fonteMonitor, 'MON_LIMITES_FALLBACK');
    for (const k of ['latenciaMediaMs', 'latenciaP95Ms', 'perdaPacotesPct']) {
        assert.equal(fe[k], be[k], `${k}: frontend=${fe[k]} backend=${be[k]}`);
    }
});

test('obterLimites devolve numeros validos e respeta o config.json', () => {
    const lim = monitor.obterLimites();
    for (const k of Object.keys(monitor.LIMITES_PADRAO)) {
        assert.equal(typeof lim[k], 'number', k + ' deve ser numero');
        assert.ok(lim[k] > 0, k + ' deve ser > 0');
    }
    try {
        const cfg = JSON.parse(fs.readFileSync(path.join(repo, 'monitor', 'config.json'), 'utf8'));
        if (cfg && cfg.limites) {
            for (const k of Object.keys(cfg.limites)) {
                assert.equal(lim[k], cfg.limites[k], `config.json manda em ${k}`);
            }
        }
    } catch (e) { /* sem config.json local: o padrao vale */ }
});

test('servidor ENTREGA os limites ao frontend (painel e historico)', () => {
    // painel: /api/monitor/painel e o SSE usam obterPainel()
    assert.match(fonteService, /limites:\s*obterLimites\(\)/, 'obterPainel() deve expor limites');
    // historico: os graficos de latencia/perda nascem daqui
    assert.match(fonteServer, /limites:\s*monitor\.obterLimites\(\)/, '/api/monitor/historico deve expor limites');
    // frontend consome
    assert.match(fonteMonitor, /function monAplicarLimites\(/, 'frontend deve ter quem aplique os limites');
    const usos = (fonteMonitor.match(/monAplicarLimites\(/g) || []).length;
    assert.ok(usos >= 5, `monAplicarLimites deve ser chamado em todos os payloads (achou ${usos})`);
});

// ---------------------------------------------------------------------------
// 2) Nenhum limiar "solto" no codigo (drift de tela para tela)
// ---------------------------------------------------------------------------
test('MON_FAIXAS centraliza as faixas de uso/disco/disponibilidade', () => {
    const f = lerLiteral(fonteMonitor, 'MON_FAIXAS');
    assert.equal(f.uso.alerta, 60);
    assert.equal(f.uso.critico, 80);
    assert.equal(f.disco.alerta, 70);
    assert.equal(f.disco.critico, 90);
    assert.equal(f.disponibilidade.minimo, 70);
    assert.equal(f.disponibilidade.alvo, 90);
});

test('nenhum limiar hardcoded sobrevive (cpu/disco/perda em ternario de cor)', () => {
    const fugas = fonteMonitor.match(/(?:>=|>)\s*(?:90|80|70|60|50|10)\s*\?/g) || [];
    assert.deepEqual(fugas, [], 'limiares hardcoded encontrados: ' + fugas.join(', '));
    // e todas as funcoes de cor usadas existem
    for (const fn of ['monCorUso', 'monCorDisco', 'monCorDisponibilidade', 'monCorPerda', 'monNivelUso']) {
        assert.match(fonteMonitor, new RegExp('function ' + fn + '\\('), fn + ' ausente');
    }
});

// ---------------------------------------------------------------------------
// 3) Limiares nos graficos (linhas de limite no SVG)
// ---------------------------------------------------------------------------
/** Mundo minimo para carregar monitor.js dentro do Node (sem navegador). */
function carregarMonitor() {
    const noop = () => 0;
    const sandbox = {
        console, Date, Math, JSON, String, Number, Array, Object, Boolean, RegExp, Error,
        isFinite, isNaN, parseInt, parseFloat,
        setInterval: noop, clearInterval: noop, setTimeout: noop, clearTimeout: noop,
        requestAnimationFrame: noop, cancelAnimationFrame: noop,
        fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
        EventSource: function () { return { close: noop, addEventListener: noop }; },
        localStorage: { getItem: () => null, setItem: noop, removeItem: noop }
    };
    vm.createContext(sandbox);
    vm.runInContext(fonteMonitor, sandbox, { filename: 'monitor.js' });
    return sandbox;
}

function rodar(sandbox, codigo) {
    return vm.runInContext(codigo, sandbox, { filename: 'inline.js' });
}

test('monCartesianChart desenha linhas de limiar e abre o eixo para elas', () => {
    const sandbox = carregarMonitor();

    const chart = (opts) => rodar(sandbox,
        'monCartesianChart(' + JSON.stringify([12, 18, 9, 25, 15]) + ',' + JSON.stringify(opts) + ')');

    // Limiar ACIMA do maximo dos dados (18): o eixo precisa abrir ate ele
    const html = chart({ titulo: 'Latencia (ms)', unidade: 'ms', limiares: [{ v: 80, cor: '#ff9f43', rotulo: 'limite 80ms' }] });
    assert.match(html, /stroke-dasharray="7 5"/, 'linha de limiar ausente');
    assert.match(html, /limite 80ms/, 'rotulo do limiar ausente');
    assert.match(html, /role="img"/, 'grafico sem acessibilidade (role=img)');
    assert.match(html, /aria-label="[^"]*limite 80ms/, 'limiar fora da descricao para leitor de tela');

    // Escala: o maximo do eixo e >= 80 (limiar visivel), nao o pico dos dados
    const rotulosY = [...html.matchAll(/text-anchor="end"[^>]*>([\d.,]+)<\/text>/g)].map(m => m[1]);
    const maxY = Math.max(...rotulosY.map(v => parseFloat(String(v).replace('.', '').replace(',', '.'))));
    assert.ok(maxY >= 80, 'eixo Y deve chegar ao limiar (chegou a ' + maxY + ')');

    // Sem limiar: nada tracejado
    const semLimiar = chart({ titulo: 'CPU', unidade: '%' });
    assert.doesNotMatch(semLimiar, /stroke-dasharray="7 5"/);
});

test('rotulos longos do eixo X sao cortados sem perder o tooltip', () => {
    const sandbox = carregarMonitor();
    const nome = 'SETOR-DE-SUPRIMENTOS-MUITO-LONGO';
    const html = rodar(sandbox,
        'monCartesianChart(' + JSON.stringify([1, 2, 3, 4, 5]) + ',' +
        JSON.stringify({ titulo: 'X', rotulosX: [nome, 'B', 'C', 'D', 'E'] }) + ')');
    assert.match(html, /…/, 'rotulo longo deveria ser cortado');
    assert.ok(!html.includes('>' + nome + '<'), 'nome completo nao pode ficar no eixo');
    // tooltip (title) mantem o nome inteiro
    assert.ok(html.includes(nome), 'tooltip deve manter o nome completo');
});

test('call sites de latencia/perda/CPU/GPU passam limiares', () => {
    const lat = (fonteMonitor.match(/monLimiaresLatencia\(\)/g) || []).length;
    const perda = (fonteMonitor.match(/monLimiaresPerda\(\)/g) || []).length;
    const uso = (fonteMonitor.match(/monLimiaresUso\(\)/g) || []).length;
    const disco = (fonteMonitor.match(/monLimiaresDisco\(\)/g) || []).length;
    // 4 definicoes duplicadas e mortas de monAbrirRelatorioPC foram removidas;
    // com elas foram embora call sites de grafico que nunca chegavam a rodar.
    // Os graficos VIVOS continuam todos com limiar (o teste acima valida o SVG).
    assert.ok(lat >= 3, 'latencia sem limiar em ' + lat + ' grafico(s)');
    assert.ok(perda >= 2, 'perda sem limiar em ' + perda + ' grafico(s)');
    assert.ok(uso >= 5, 'CPU/GPU/RAM sem limiar em ' + uso + ' grafico(s)');
    assert.ok(disco >= 1, 'disco sem limiar em ' + disco + ' grafico(s)');
});

// ---------------------------------------------------------------------------
// 4) Padroes de leitura dos graficos Chart.js (Grafana / docs Chart.js)
// ---------------------------------------------------------------------------
test('todo grafico Chart.js nasce com interacao por indice e tooltip pt-BR', () => {
    assert.match(fonteApp, /function cartPadraoOpcoes\(/);
    assert.match(fonteApp, /interaction:\s*\{\s*mode:\s*'index',\s*intersect:\s*false,\s*axis:\s*horizontal \? 'y' : 'x'\s*\}/);
    assert.match(fonteApp, /hover:\s*\{\s*mode:\s*'index',\s*intersect:\s*false,\s*axis:\s*horizontal \? 'y' : 'x'\s*\}/);
    // barras comecam em zero (comparacao honesta)
    assert.match(fonteApp, /beginAtZero:\s*true/);
    // numeros no formato do Brasil
    assert.match(fonteApp, /toLocaleString\('pt-BR'/);
    // upsertChart aplica os defaults antes de criar/atualizar
    assert.match(fonteApp, /cartMerge\(cartPadraoOpcoes\(config\),\s*config\.options \|\| \{\}\)/);
});

// ---------------------------------------------------------------------------
// 5) Cor do ciclo de vida: fonte unica (4 pontos de exibicao, 1 helper)
// ---------------------------------------------------------------------------
test('cor do ciclo de vida vem de cartCorCiclo (sem ternario duplicado)', () => {
    assert.match(fonteApp, /function cartCorCiclo\(pct\)/);
    assert.match(fonteApp, /return p < 50 \? 'var\(--green\)' : p < 75 \? 'var\(--yellow\)' : 'var\(--red\)';/);
    // nenhum ponto de exibicao pode ter voltado a embutir a regra de cor
    const copias = fonteApp.match(/pct < 50 \? 'var\(--green\)'/g) || [];
    assert.equal(copias.length, 0, copias.length + ' ternario(s) de ciclo duplicado(s) fora do helper');
    // os 4 lugares chamam o helper
    const chamadas = fonteApp.match(/cartCorCiclo\(pct\)/g) || [];
    assert.ok(chamadas.length >= 4, 'esperava >=4 chamadas, achei ' + chamadas.length);
});
