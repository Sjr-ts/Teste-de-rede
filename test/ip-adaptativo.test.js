const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zb = require('../monitor/zabbix-bridge');

const repo = path.join(__dirname, '..');
const fonteServer = fs.readFileSync(path.join(repo, 'server.cjs'), 'utf8');
const fonteMonitor = fs.readFileSync(path.join(repo, 'frontend', 'js', 'monitor.js'), 'utf8');
const fonteIndex = fs.readFileSync(path.join(repo, 'frontend', 'index.html'), 'utf8');

/** Monta um host fake do Zabbix. */
function host(hostid, ip, opts) {
    opts = opts || {};
    return {
        hostid: String(hostid),
        host: opts.host || ('pc' + hostid),
        name: opts.nome || opts.host || ('PC ' + hostid),
        status: opts.status != null ? String(opts.status) : '0',
        interfaces: ip ? [{ interfaceid: String(hostid) + '1', ip: String(ip), main: '1', type: '1', useip: '1' }] : [],
        tags: opts.tags || []
    };
}

function comp(id, nome, ip) {
    return { id: id, nomePc: nome, ipAddress: ip };
}

// ---------------------------------------------------------------------------
// 1) Validacao de IP: loopback e lixo nunca podem virar cadastro
// ---------------------------------------------------------------------------
test('ehLoopback/ehIpValido barram loopback, vazio e lixo', () => {
    assert.equal(zb.ehLoopback('127.0.0.1'), true);
    assert.equal(zb.ehLoopback('127.0.5.3'), true);
    assert.equal(zb.ehLoopback('::1'), true);
    assert.equal(zb.ehLoopback('localhost'), true);
    assert.equal(zb.ehLoopback('192.168.0.10'), false);

    assert.equal(zb.ehIpValido('192.168.0.186'), true);
    assert.equal(zb.ehIpValido('10.0.0.169'), true);
    assert.equal(zb.ehIpValido('2001:db8::1'), true);
    assert.equal(zb.ehIpValido('127.0.0.1'), false);
    assert.equal(zb.ehIpValido('::1'), false);
    assert.equal(zb.ehIpValido(''), false);
    assert.equal(zb.ehIpValido(null), false);
    assert.equal(zb.ehIpValido('999.1.1.1'), false);   // octeto fora do intervalo
    assert.equal(zb.ehIpValido('abc'), false);
    assert.equal(zb.ehIpValido('ip novo'), false);

    // nao-unicast / reservado: um agente mal configurado nao pode sobrescrever
    // o IP valido do PC no cadastro com um destes
    assert.equal(zb.ehIpValido('0.0.0.0'), false);
    assert.equal(zb.ehIpValido('0.1.2.3'), false);
    assert.equal(zb.ehIpValido('169.254.121.56'), false);  // APIPA (sem DHCP)
    assert.equal(zb.ehIpValido('169.254.1.1'), false);
    assert.equal(zb.ehIpValido('224.0.0.1'), false);       // multicast
    assert.equal(zb.ehIpValido('239.255.255.250'), false);
    assert.equal(zb.ehIpValido('240.0.0.1'), false);       // reservado
    assert.equal(zb.ehIpValido('::'), false);              // unspecified v6
    assert.equal(zb.ehLoopback('::ffff:127.0.0.1'), true); // loopback mapeado
    assert.equal(zb.ehIpValido('::ffff:127.0.0.1'), false);
});

// ---------------------------------------------------------------------------
// 2) Deteccao de mudanca de IP (Zabbix -> cadastro)
// ---------------------------------------------------------------------------
test('detectarMudancasIp acha o IP novo quando o cadastro ficou para tras', () => {
    const computadores = [
        comp(1, 'PC-FINANCAS', '192.168.0.50'),
        comp(2, 'PC-RH', '192.168.0.51')
    ];
    const hosts = [
        host(10, '192.168.0.186', { nome: 'PC-FINANCAS', tags: [{ tag: 'inventario_id', value: '1' }] }),
        host(11, '192.168.0.51', { nome: 'PC-RH', tags: [{ tag: 'inventario_id', value: '2' }] })
    ];
    const r = zb.detectarMudancasIp(computadores, hosts);
    assert.equal(r.alteracoes.length, 1);
    const a = r.alteracoes[0];
    assert.equal(a.inventario_id, 1);
    assert.equal(a.ipAntigo, '192.168.0.50');
    assert.equal(a.ipNovo, '192.168.0.186');
    assert.equal(a.fonte, 'tag');
    assert.equal(a.nome, 'PC-FINANCAS');
    assert.equal(r.semVinculo.length, 0);
});

test('detectarMudancasIp usa o NOME quando nao ha tag inventario_id', () => {
    const computadores = [comp(7, 'PC-RH', '10.0.0.5')];
    const hosts = [host(20, '10.0.0.99', { nome: 'PC-RH' })]; // sem tag
    const r = zb.detectarMudancasIp(computadores, hosts);
    assert.equal(r.alteracoes.length, 1);
    assert.equal(r.alteracoes[0].fonte, 'nome');
    assert.equal(r.alteracoes[0].ipNovo, '10.0.0.99');
});

test('detectarMudancasIp ignora host desabilitado, loopback e host sem vinculo', () => {
    const computadores = [comp(1, 'PC-A', '192.168.0.50')];
    const hosts = [
        host(10, '192.168.0.99', { nome: 'PC-A', status: 1 }),      // host ZABBICADO (status=1)
        host(11, '127.0.0.1', { nome: 'PC-A' }),                     // loopback nunca vira cadastro
        host(12, '192.168.0.77', { nome: 'PC-DESCONHECIDO' })        // sem vinculo
    ];
    const r = zb.detectarMudancasIp(computadores, hosts);
    assert.equal(r.alteracoes.length, 0, 'nenhuma mudanca valida deveria ser detectada');
    assert.equal(r.semVinculo.length, 1);
    assert.equal(r.semVinculo[0].host, 'pc12');
});

test('detectarMudancasIp e idempotente: sem diferenca nao ha alteracao', () => {
    const computadores = [comp(1, 'PC-A', '192.168.0.50')];
    const hosts = [host(10, '192.168.0.50', { nome: 'PC-A', tags: [{ tag: 'inventario_id', value: '1' }] })];
    const r = zb.detectarMudancasIp(computadores, hosts);
    assert.equal(r.alteracoes.length, 0);
    assert.equal(r.semVinculo.length, 0);
});

test('detectarMudancasIp com listas vazias/invalidas nao quebra', () => {
    assert.deepEqual(zb.detectarMudancasIp(null, null), { alteracoes: [], semVinculo: [] });
    assert.deepEqual(zb.detectarMudancasIp([], []), { alteracoes: [], semVinculo: [] });
});

// ---------------------------------------------------------------------------
// 3) Aplicacao das mudancas no db (pura)
// ---------------------------------------------------------------------------
test('aplicarMudancasIp atualiza so o IP do computador certo', () => {
    const db = { computadores: [comp(1, 'PC-A', '192.168.0.50'), comp(2, 'PC-B', '192.168.0.60')] };
    const r = zb.aplicarMudancasIp([
        { inventario_id: 2, nome: 'PC-B', ipAntigo: '192.168.0.60', ipNovo: '192.168.0.186' }
    ], db);
    assert.equal(r.aplicados.length, 1);
    assert.equal(db.computadores[1].ipAddress, '192.168.0.186');
    assert.equal(db.computadores[0].ipAddress, '192.168.0.50', 'o outro PC nao pode ser mexido');
    assert.equal(db.computadores[1].nomePc, 'PC-B', 'so o IP muda, nunca o nome');
});

test('aplicarMudancasIp recusa IP invalido/loopback e id inexistente', () => {
    const db = { computadores: [comp(1, 'PC-A', '192.168.0.50')] };
    const r = zb.aplicarMudancasIp([
        { inventario_id: 1, ipNovo: '127.0.0.1' },
        { inventario_id: 999, ipNovo: '192.168.0.99' }
    ], db);
    assert.equal(r.aplicados.length, 0);
    assert.equal(r.ignorados.length, 2);
    assert.equal(db.computadores[0].ipAddress, '192.168.0.50', 'IP invalido nao pode ser gravado');
});

test('aplicarMudancasIp marca "ja esta no cadastro" quando nao ha diferenca', () => {
    const db = { computadores: [comp(1, 'PC-A', '192.168.0.50')] };
    const r = zb.aplicarMudancasIp([{ inventario_id: 1, ipNovo: '192.168.0.50' }], db);
    assert.equal(r.aplicados.length, 0);
    assert.equal(r.ignorados[0].motivo, 'ja esta no cadastro');
});

// ---------------------------------------------------------------------------
// 4) Cabos de amarracao: endpoint, job periodico e botao do frontend
// ---------------------------------------------------------------------------
test('server.cjs expoe /api/zabbix/sincronizar-ips e persiste via gravarIpsNoDados', () => {
    assert.match(fonteServer, /app\.post\('\/api\/zabbix\/sincronizar-ips'/);
    assert.match(fonteServer, /function gravarIpsNoDados\(alteracoes\)/);
    // persistencia precisa ser read-fresco + _rev+1 (janela minima de corrida)
    assert.match(fonteServer, /const fresco = carregarDados\(\);\s*\n\s*const r = zb\.aplicarMudancasIp\(alteracoes, fresco\);/);
    assert.match(fonteServer, /fresco\._rev = \(fresco\._rev \|\| 0\) \+ 1;/);
    // o sync principal tambem propaga IP
    assert.match(fonteServer, /ips = await zb\.sincronizarIpsDoZabbix\(db\)/);
    assert.match(fonteServer, /ips\.aplicados = gravarIpsNoDados\(ips\.aplicados\)/);
});

test('server.cjs roda o IP sync periodico com guarda de reentrada', () => {
    assert.match(fonteServer, /let ipSyncEmAndamento = false;/);
    assert.match(fonteServer, /if \(ipSyncEmAndamento\) return;/);
    assert.match(fonteServer, /setTimeout\(ipSyncPeriodico, 45000\)/);
    assert.match(fonteServer, /setInterval\(ipSyncPeriodico, 5 \* 60 \* 1000\)/);
    assert.match(fonteServer, /getConfigStatus\(\)\.configurado/, 'job so roda com Zabbix configurado');
});

test('deploy script opt-in de IP adaptativo existe e documenta a chave dinamica', () => {
    const fs2 = require('fs');
    const p = path.join(repo, 'zabbix-deploy', 'configurar-ip-adaptativo.ps1');
    assert.ok(fs2.existsSync(p), 'configurar-ip-adaptativo.ps1 deve existir');
    const src = fs2.readFileSync(p, 'utf8');
    assert.match(src, /HostMetadataItem=inv\.meta/);
    assert.match(src, /UserParameter=inv\.meta/);
    assert.match(src, /-Reverter/);
});

test('docs registram os gatilhos oficiais e a solucao comprovada', () => {
    const fs2 = require('fs');
    const doc = fs2.readFileSync(path.join(repo, 'docs', 'ZABBIX_INTEGRACAO.md'), 'utf8');
    assert.match(doc, /re-registra|re-roda|re-registro|rerun/i);
    assert.match(doc, /120 seconds|heartbeat/i);
    assert.match(doc, /PROVA_FINAL_PASS|sem reiniciar o agente/i);
    assert.match(doc, /HostMetadataItem/);
});
