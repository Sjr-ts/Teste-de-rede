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

test('host list merges inventory IPs with custom targets without losing active entries', () => {
  const alvos = monitor.obterAlvos();
  assert.ok(alvos.some(a => a.ip === '192.168.0.186'));
  assert.ok(alvos.some(a => a.ip === '192.168.0.108'));
  assert.ok(alvos.length >= 2);
});
