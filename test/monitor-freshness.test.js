const test = require('node:test');
const assert = require('node:assert/strict');
const monitor = require('../monitor/service');

test('host is considered stale when it exceeds the freshness window', () => {
  const now = Date.now();
  const staleState = {
    ultimoResultado: 'ACESSIVEL',
    ultimoHorario: new Date(now - (3 * 60 * 1000) - 1000).toISOString()
  };

  assert.equal(typeof monitor.isHostStale, 'function');
  assert.equal(monitor.isHostStale(staleState, now), true);
});

test('fresh host remains current and not stale', () => {
  const now = Date.now();
  const freshState = {
    ultimoResultado: 'ACESSIVEL',
    ultimoHorario: new Date(now - 2000).toISOString()
  };

  assert.equal(monitor.isHostStale(freshState, now), false);
});

test('host list merges inventory IPs with custom targets without losing entries', () => {
  const fs = require('fs');
  const path = require('path');
  const alvos = monitor.obterAlvos();
  assert.ok(Array.isArray(alvos));

  // Nenhum target configurado pelo usuario pode sumir na mescla
  let targets = [];
  try {
    targets = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'monitor', 'data', 'targets.json'), 'utf8'));
  } catch { targets = []; }
  for (const t of targets) {
    if (t.ativo === false) continue; // desativados de proposito nao entram na mescla
    assert.ok(alvos.some(a => a.ip === (t.ipAddress || t.ip)), 'target ativo perdido na mescla: ' + (t.ipAddress || t.ip));
  }

  // Sem IPs duplicados na lista final
  const ips = alvos.map(a => a.ip);
  assert.equal(new Set(ips).size, ips.length, 'IPs duplicados na lista de alvos');

  // Todo alvo tem o minimo para virar linha no painel
  for (const a of alvos) {
    assert.ok(a.ip, 'alvo sem IP');
    assert.ok(a.nome, 'alvo sem nome: ' + (a.ip || '?'));
  }
});
