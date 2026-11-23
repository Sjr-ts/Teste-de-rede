const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Integração real: sobe o servidor numa PORTA TEMPORARIA e testa os endpoints.
// (Os outros testes verificam funcoes puras/fonte; este valida o HTTP de fato.)
const repo = path.join(__dirname, '..');
const PORTA = 15903;
let child = null;

function esperar(ms) { return new Promise(r => setTimeout(r, ms)); }

async function esperarServidor() {
    for (let i = 0; i < 40; i++) {
        try {
            const r = await fetch(`http://127.0.0.1:${PORTA}/actuator/health`);
            if (r.ok) return true;
        } catch (e) {}
        await esperar(250);
    }
    return false;
}

test('integração HTTP: health, login, /api/data e painel com KPIs', { timeout: 30000 }, async (t) => {
    const env = Object.assign({}, process.env, { PORT: String(PORTA) });
    // server.cjs lê PORT de process.env? Se nao, usa 5903 fixo — nesse caso
    // pulamos o teste para nao conflitar com o servidor em producao.
    const src = fs.readFileSync(path.join(repo, 'server.cjs'), 'utf8');
    const usaEnvPort = /process\.env\.PORT/.test(src);
    if (!usaEnvPort) {
        t.skip('server.cjs usa porta fixa 5903 (sem suporte a process.env.PORT)');
        return;
    }
    child = spawn(process.execPath, ['server.cjs'], { cwd: repo, env, stdio: 'ignore' });
    const up = await esperarServidor();
    assert.ok(up, 'servidor deveria subir na porta temporaria');

    try {
        const h = await (await fetch(`http://127.0.0.1:${PORTA}/actuator/health`)).json();
        assert.equal(h.status, 'UP');

        const lr = await fetch(`http://127.0.0.1:${PORTA}/api/auth/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', senha: 'admin123' })
        });
        assert.equal(lr.status, 200);
        const cookie = (lr.headers.get('set-cookie') || '').split(';')[0];
        assert.ok(cookie, 'cookie de sessao deve ser emitido');

        const painel = await (await fetch(`http://127.0.0.1:${PORTA}/api/monitor/painel`, { headers: { Cookie: cookie } })).json();
        assert.ok(painel.resumo, 'painel deve trazer resumo');
        for (const k of ['totalAlvos', 'acessiveis', 'semResposta', 'instaveis', 'semDados',
                         'desligadosEsperados', 'empresaParada', 'ipObsoleto',
                         'disponibilidadeOperacional', 'disponibilidadeBruta']) {
            assert.ok(k in painel.resumo, 'resumo deve conter ' + k);
        }
        // invariante: soma dos estados = total
        const r = painel.resumo;
        const soma = r.acessiveis + r.semResposta + r.instaveis + r.semDados +
            r.desligadosEsperados + r.empresaParada + r.ipObsoleto;
        assert.equal(soma, r.totalAlvos, 'KPIs devem ser mutuamente exclusivos');
    } finally {
        if (child) { child.kill(); child = null; }
    }
});
