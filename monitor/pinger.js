'use strict';
const { spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';

/**
 * Executa ping nativo do SO (sem agente, sem raw socket, sem admin).
 * Windows: ping -n <tentativas> -w <timeoutMs> <ip>
 * Linux:   ping -c <tentativas> -W <timeoutSeg> <ip>
 * Interpreta saida PT-BR e EN.
 */
function ping(host, { tentativas = 3, timeoutMs = 2000 } = {}) {
    return new Promise((resolve) => {
        const args = IS_WIN
            ? ['-n', String(tentativas), '-w', String(timeoutMs), host]
            : ['-c', String(tentativas), '-W', String(Math.ceil(timeoutMs / 1000)), host];

        let stdout = '';
        let stderr = '';
        let done = false;

        const proc = spawn('ping', args, { windowsHide: true });

        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            try { proc.kill('SIGKILL'); } catch (e) {}
            resolve({
                host,
                ok: false,
                erro: 'timeout_do_processo',
                enviado: tentativas,
                recebido: 0,
                perdaPct: 100,
                latenciasMs: [],
                latenciaMediaMs: null,
                latenciaMinMs: null,
                latenciaMaxMs: null,
                timestamp: new Date().toISOString()
            });
        }, timeoutMs * tentativas + 3000);

        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });

        proc.on('close', () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(parsePingOutput(host, stdout, stderr, tentativas));
        });

        proc.on('error', (err) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve({
                host,
                ok: false,
                erro: err.message,
                enviado: tentativas,
                recebido: 0,
                perdaPct: 100,
                latenciasMs: [],
                latenciaMediaMs: null,
                latenciaMinMs: null,
                latenciaMaxMs: null,
                timestamp: new Date().toISOString()
            });
        });
    });
}

function parsePingOutput(host, stdout, stderr, tentativas) {
    const text = (stdout || '') + '\n' + (stderr || '');

    const latenciasMs = [];
    // PT: "Resposta de 1.2.3.4: bytes=32 tempo=12ms TTL=64"
    // EN: "Reply from 1.2.3.4: bytes=32 time=12ms TTL=64"
    // PT: "Resposta de 1.2.3.4: bytes=32 tempo<1ms TTL=64"
    const reTempo = /tempo[=<]?\s*(\d+(?:[.,]\d+)?)\s*ms/i;
    const reTime = /time[=<]?\s*(\d+(?:[.,]\d+)?)\s*ms/i;
    for (const line of text.split(/\r?\n/)) {
        if (/resposta de|reply from/i.test(line)) {
            let m = reTempo.exec(line) || reTime.exec(line);
            if (m) latenciasMs.push(parseFloat(m[1].replace(',', '.')));
        }
    }

    // Estatisticas: "Pacotes: Enviados = 4, Recebidos = 4, Perdidos = 0 (0% de perda)"
    // EN: "Packets: Sent = 4, Received = 4, Lost = 0 (0% loss)"
    let enviado = tentativas;
    let recebido = latenciasMs.length;
    let perdaPct = tentativas > 0 ? ((tentativas - recebido) / tentativas) * 100 : 100;

    const reStats = /Enviados\s*=\s*(\d+).*?Recebidos\s*=\s*(\d+).*?Perdidos\s*=\s*(\d+)/i;
    const reStatsEn = /Sent\s*=\s*(\d+).*?Received\s*=\s*(\d+).*?Lost\s*=\s*(\d+)/i;
    const ms = reStats.exec(text) || reStatsEn.exec(text);
    if (ms) {
        enviado = parseInt(ms[1], 10);
        recebido = parseInt(ms[2], 10);
        const perdidos = parseInt(ms[3], 10);
        perdaPct = enviado > 0 ? (perdidos / enviado) * 100 : 100;
    } else {
        // fallback: "0% de perda" / "0% loss"
        const reLoss = /(\d+(?:[.,]\d+)?)\s*%\s*(?:de\s*)?perda|(\d+(?:[.,]\d+)?)\s*%\s*loss/i;
        const ml = reLoss.exec(text);
        if (ml) perdaPct = parseFloat((ml[1] || ml[2]).replace(',', '.'));
    }

    // Min/Max/Avg
    let min = null, max = null, avg = null;
    const reMM = /M[ií]nimo\s*=\s*(\d+(?:[.,]\d+)?)\s*ms.*?M[aá]ximo\s*=\s*(\d+(?:[.,]\d+)?)\s*ms.*?M[eé]dia\s*=\s*(\d+(?:[.,]\d+)?)\s*ms/i;
    const reMMEn = /Minimum\s*=\s*(\d+(?:[.,]\d+)?)\s*ms.*?Maximum\s*=\s*(\d+(?:[.,]\d+)?)\s*ms.*?Average\s*=\s*(\d+(?:[.,]\d+)?)\s*ms/i;
    const mmm = reMM.exec(text) || reMMEn.exec(text);
    if (mmm) {
        min = parseFloat(mmm[1].replace(',', '.'));
        max = parseFloat(mmm[2].replace(',', '.'));
        avg = parseFloat(mmm[3].replace(',', '.'));
    } else if (latenciasMs.length) {
        min = Math.min(...latenciasMs);
        max = Math.max(...latenciasMs);
        avg = latenciasMs.reduce((a, b) => a + b, 0) / latenciasMs.length;
    }

    const hostUnreachable = /destino inacessivel|destination unreachable|host unreachable|general failure|falha geral/i.test(text);
    const requestTimeout = /esgotado o tempo limite do pedido|request timed out/i.test(text);

    const ok = recebido > 0;
    let erro = null;
    if (!ok) {
        if (hostUnreachable) erro = 'destino_inacessivel';
        else if (requestTimeout) erro = 'tempo_esgotado';
        else if (/não encontrado|could not find host/i.test(text)) erro = 'host_nao_encontrado';
        else erro = 'sem_resposta';
    }

    return {
        host,
        ok,
        erro,
        enviado,
        recebido,
        perdaPct: Math.round(perdaPct * 100) / 100,
        latenciasMs,
        latenciaMediaMs: avg !== null ? Math.round(avg * 100) / 100 : null,
        latenciaMinMs: min,
        latenciaMaxMs: max,
        timestamp: new Date().toISOString()
    };
}

/**
 * Teste TCP simples: tenta conectar em host:porta.
 * Nao faz varredura - apenas um servico explicitamente configurado.
 */
function tcpCheck(host, port, timeoutMs = 2000) {
    return new Promise((resolve) => {
        const net = require('net');
        const start = Date.now();
        const socket = new net.Socket();
        let done = false;

        const finish = (ok, erro) => {
            if (done) return;
            done = true;
            try { socket.destroy(); } catch (e) {}
            resolve({
                host,
                port,
                ok,
                erro,
                tempoConexaoMs: ok ? Date.now() - start : null,
                timestamp: new Date().toISOString()
            });
        };

        socket.setTimeout(timeoutMs);
        socket.once('connect', () => finish(true, null));
        socket.once('timeout', () => finish(false, 'timeout'));
        socket.once('error', (err) => finish(false, err.code || err.message));
        socket.connect(port, host);
    });
}

module.exports = { ping, tcpCheck, parsePingOutput };
