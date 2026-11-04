'use strict';
/**
 * tempo-real.js — Amostrador PERSISTENTE de CPU/GPU da maquina local.
 *
 * Problema que resolve (diagnosticado em 04/11/2026):
 *  - Cada leitura de CPU spawnava um PowerShell novo (~2s de startup + 1s de
 *    amostra) -> o valor exibido era sempre velho.
 *  - A "GPU tempo real" chamava a coleta COMPLETA (disco+WMI+GPU) que levava
 *    ~7 segundos -> GPU sempre several seconds atrasada.
 *  - O contador '% Processor Time' em CPUs HIBRIDAS (i7-1255U P+E cores) le
 *    systematicamente MAIS BAIXO que o Task Manager, que usa
 *    '% Processor Utility'. Ex.: painel 28-54% x Task Manager 34-84%.
 *
 * Solucao: UM unico processo PowerShell vivo, rodando em loop, que imprime
 * 'CPU|<pct>|<iso>' e 'GPU|<pct>|<iso>' a cada segundo. Node le o stdout
 * incrementalmente: zero startup por amostra, latencia ~1s, contador correto.
 */
const { spawn } = require('child_process');
const os = require('os');

// Marcador informativo do script (aparece como comentario no .ps1 e ajuda
// debugging interativo). NAO ha "kill por marcador" — o amostrador se
// auto-termina pelo check de pai no proprio loop.
const MARCADOR = 'inventario-ti-amostrador';

// Script PS: CPU 1x/s (contador do Task Manager), GPU a cada 2s (Get-Counter e
// mais custoso). ASCII puro na saida -> sem problema de encoding no pipe.
// O PID do Node e injetado: no loop o PowerShell confere se o pai ainda existe —
// se o Node morreu (kill forcado), o amostrador sai sozinho em ~1s (nunca orfa).
function montarScriptPs() {
    const pidNode = process.pid;
    return [
    '# ' + MARCADOR,
    '$NodePid = ' + pidNode,
    '$ErrorActionPreference = \'SilentlyContinue\'',
    'function Out($l) { [Console]::Out.WriteLine($l) }',
    'Out(\'READY|\' + (Get-Date).ToString(\'o\'))',
    '$cpu = $null',
    'try {',
    '  $cpu = New-Object System.Diagnostics.PerformanceCounter(\'Processor Information\',\'% Processor Utility\',\'_Total\')',
    '  $null = $cpu.NextValue()',
    '  Out(\'FONTECPU|utility\')',
    '} catch {',
    '  try {',
    '    $cpu = New-Object System.Diagnostics.PerformanceCounter(\'Processor\',\'% Processor Time\',\'_Total\')',
    '    $null = $cpu.NextValue()',
    '    Out(\'FONTECPU|time\')',
    '  } catch { Out(\'FONTECPU|indisponivel\') }',
    '}',
    'try { $g = nvidia-smi --query-gpu=name --format=csv,noheader,nounits 2>$null; if ($g) { Out(\'GPUOK|nvidia\') } } catch {}',
    '$i = 0',
    'while ($true) {',
    '  try { if (-not (Get-Process -Id $NodePid -ErrorAction Stop)) { break } } catch { break }',
    '  $ts = (Get-Date).ToString(\'o\')',
    '  if ($cpu) { try { $v = $cpu.NextValue(); Out(\'CPU|\' + [math]::Round([double]$v,1) + \'|\' + $ts) } catch {} }',
    '  $i++',
    '  if (($i % 2) -eq 0) {',
    '    try {',
    '      $c = Get-Counter \'\\GPU Engine(*)\\Utilization Percentage\' -ErrorAction SilentlyContinue',
    '      if ($c) {',
    '        $s = ($c.CounterSamples | Where-Object { $_.CookedValue -gt 0 } | Measure-Object -Property CookedValue -Sum).Sum',
    '        if ($null -eq $s) { $s = 0 }',
    '        Out(\'GPU|\' + [math]::Min(100,[math]::Round([double]$s,1)) + \'|\' + $ts)',
    '      } else { Out(\'GPU|INDISP|\' + $ts) }',
    '    } catch { Out(\'GPU|INDISP|\' + $ts) }',
    '  }',
    '  Start-Sleep -Milliseconds 1000',
    '}'
    ].join('\r\n');
}

let proc = null;
let buf = '';
let iniciado = false;
let estado = {
    cpu: null,          // % (contado com o contador do Task Manager)
    cpuFonte: null,     // 'utility' | 'time' | 'fallback-os' | null
    gpu: null,          // % ou null (indisponivel)
    gpuFonte: null,     // 'performance-counter' | 'nvidia' | 'indisponivel' | null
    ts: 0,              // epoch ms da ultima amostra de CPU
    gpuTs: 0,
    pronto: false,
    erros: 0,
    ultimoErro: null
};
let saudeTs = Date.now();        // ultima linha recebida
let parado = false;
let timerRestart = null;
let ouvintes = [];
let _cpuAnteriorOs = null;       // fallback via os.cpus()

// ---- leitura de fallback (os.cpus) caso o processo PS nao suba ----
function amostrarCpuOs() {
    const agora = os.cpus().map(c => {
        const t = c.times;
        return { total: t.user + t.nice + t.sys + t.idle + t.irq, idle: t.idle + t.irq };
    });
    let r = null;
    if (_cpuAnteriorOs && _cpuAnteriorOs.length === agora.length) {
        let tt = 0, di = 0;
        for (let i = 0; i < agora.length; i++) {
            tt += agora[i].total - _cpuAnteriorOs[i].total;
            di += agora[i].idle - _cpuAnteriorOs[i].idle;
        }
        if (tt > 0) r = Math.round(((tt - di) / tt) * 1000) / 10;
    }
    _cpuAnteriorOs = agora;
    return r;
}

function emitir() {
    for (const fn of ouvintes) {
        try { fn(obter()); } catch (e) {}
    }
}

function processarLinha(linha) {
    const p = linha.split('|');
    const tipo = p[0];
    if (tipo === 'READY') { estado.pronto = true; saudeTs = Date.now(); return; }
    if (tipo === 'FONTECPU') { estado.cpuFonte = p[1] || null; saudeTs = Date.now(); return; }
    if (tipo === 'GPUOK') { estado.gpuFonte = 'nvidia'; saudeTs = Date.now(); return; }
    if (tipo === 'CPU') {
        const v = parseFloat(String(p[1]).replace(',', '.'));
        saudeTs = Date.now();
        if (!isNaN(v)) {
            const mudou = estado.cpu === null || Math.abs(estado.cpu - v) >= 0.1;
            estado.cpu = Math.min(100, Math.max(0, v));
            estado.ts = Date.now();
            if (!estado.cpuFonte) estado.cpuFonte = 'utility';
            if (mudou) emitir();
        }
        return;
    }
    if (tipo === 'GPU') {
        saudeTs = Date.now();
        if (p[1] === 'INDISP') {
            if (estado.gpuFonte !== 'indisponivel') { estado.gpuFonte = 'indisponivel'; emitir(); }
            estado.gpu = null;
            return;
        }
        const v = parseFloat(String(p[1]).replace(',', '.'));
        if (!isNaN(v)) {
            const mudou = estado.gpu === null || Math.abs(estado.gpu - v) >= 0.5;
            estado.gpu = Math.min(100, Math.max(0, v));
            estado.gpuTs = Date.now();
            if (!estado.gpuFonte || estado.gpuFonte === 'indisponivel') estado.gpuFonte = 'performance-counter';
            if (mudou) emitir();
        }
        return;
    }
}

// NAO HA matarOrfaos: o amostrador se auto-termina em ~1s quando o Node pai
// morre (linha "Get-Process -Id $NodePid" no loop do script). Um "kill por
// linha de comando contendo o marcador" matava os PROPRIOS shells que o
// invocavam (incluindo os desta sessao) — removido.

function ligar() {
    if (parado) return;
    saudeTs = Date.now();
    buf = ''; // linha parcial do processo anterior nao pode vazar para o novo
    try {
        proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', montarScriptPs()], {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
    } catch (e) {
        estado.ultimoErro = 'spawn: ' + e.message;
        estado.erros++;
        return agendarRestart();
    }

    proc.stdout.setEncoding('ascii');
    proc.stdout.on('data', (chunk) => {
        buf += String(chunk);
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
            const linha = buf.slice(0, nl).replace(/\r$/, '').trim();
            buf = buf.slice(nl + 1);
            if (linha) { try { processarLinha(linha); } catch (e) {} }
        }
    });
    proc.stderr.on('data', (d) => {
        const s = String(d).trim();
        if (s) { estado.ultimoErro = s.slice(0, 200); }
    });
    proc.on('error', (e) => {
        estado.ultimoErro = e.message; estado.erros++;
        proc = null;
        agendarRestart();
    });
    proc.on('exit', (code) => {
        proc = null;
        if (parado) return;
        estado.erros++;
        estado.ultimoErro = 'processo saiu (code ' + code + ')';
        agendarRestart();
    });
}

function agendarRestart() {
    if (parado || timerRestart) return;
    const espera = Math.min(30000, 2000 * Math.max(1, estado.erros));
    timerRestart = setTimeout(() => { timerRestart = null; ligar(); }, espera);
}

/** Ponto de entrada. inicia o amostrador (idempotente). */
function iniciar() {
    if (iniciado) return;
    iniciado = true;
    parado = false;
    ligar();
}

/** Para o amostrador (usado em testes/encerramento). */
function parar() {
    iniciado = false;
    parado = true;
    if (timerRestart) { clearTimeout(timerRestart); timerRestart = null; }
    if (proc) { try { proc.kill(); } catch (e) {} proc = null; }
}

/**
 * Estado atual + idade das amostras. Se o processo PS morreu/nao subiu,
 * alimenta CPU por os.cpus() (delta) para nunca ficar sem dado — sempre
 * rotulado com a fonte real (nunca valor inventado).
 */
function obter() {
    const agora = Date.now();
    const idadeCpu = estado.ts ? agora - estado.ts : null;
    const idadeGpu = estado.gpuTs ? agora - estado.gpuTs : null;

    // Fallback: sem linha de CPU ha >4s -> mede via os.cpus() (rotulado)
    if (!proc && (idadeCpu == null || idadeCpu > 4000)) {
        const v = amostrarCpuOs();
        if (v != null) {
            estado.cpu = v;
            estado.ts = agora;
            estado.cpuFonte = 'fallback-os';
        }
    }

    const saudeOk = (agora - saudeTs) < 15000;
    return {
        cpu: estado.cpu,
        cpuFonte: saudeOk ? estado.cpuFonte : (estado.cpuFonte === 'utility' ? 'utility-sem-dados' : estado.cpuFonte),
        cpuIdadeMs: idadeCpu,
        gpu: estado.gpu,
        gpuFonte: estado.gpuFonte,
        gpuIdadeMs: idadeGpu,
        ts: estado.ts,
        gpuTs: estado.gpuTs,
        rodando: !!proc,
        saudeOk,
        pronto: estado.pronto,
        erros: estado.erros,
        ultimoErro: estado.ultimoErro,
        amostradoEm: agora
    };
}

function aoAtualizar(fn) { ouvintes.push(fn); }

module.exports = { iniciar, parar, obter, aoAtualizar };
