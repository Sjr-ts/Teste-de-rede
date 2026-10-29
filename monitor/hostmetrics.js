'use strict';
/**
 * hostmetrics.js — metricas REAIS da maquina local (onde o servidor roda).
 * Fontes: Node (os) para CPU/RAM/uptime/rede; PowerShell/WMI para disco.
 * Nao inventa valores: se nao conseguir medir, retorna indisponivel.
 */
const os = require('os');
const { exec, execFile } = require('child_process');


function cpuPorNucleo() {
    const cpus = os.cpus();
    const agora = cpus.map(c => {
        const t = c.times;
        const total = t.user + t.nice + t.sys + t.idle + t.irq;
        return { total, idle: t.idle };
    });
    const uso = [];
    if (_cpuAnterior && _cpuAnterior.length === agora.length) {
        for (let i = 0; i < agora.length; i++) {
            const dt = agora[i].total - _cpuAnterior[i].total;
            const di = agora[i].idle - _cpuAnterior[i].idle;
            uso.push(dt > 0 ? Math.round(((dt - di) / dt) * 1000) / 10 : 0);
        }
    }
    _cpuAnterior = agora;
    return uso;
}

function cpuUsoPct() {
    return new Promise((resolve) => {
        // Amostragem de 1 segundo: captura a media real do intervalo (compativel com Task Manager).
        // IMPORTANTE: usamos execFile (sem shell) para que o caractere '%' de '% Processor Time'
        // nao seja interpretado/expandido pelo cmd.exe (bug anterior: comando falhava e caia no fallback).
        const script = [
            "$pc = New-Object System.Diagnostics.PerformanceCounter('Processor', '% Processor Time', '_Total');",
            "$pc.NextValue() | Out-Null;",
            "Start-Sleep -Milliseconds 1000;",
            "$v = $pc.NextValue();",
            "Write-Output $v;"
        ].join(' ');
        execFile('powershell', ['-NoProfile', '-Command', script], { timeout: 8000, windowsHide: true }, (err, stdout) => {
            if (err) { resolve(cpuUsoPctFallback()); return; }
            const raw = (stdout || '').trim().replace(',', '.');
            const val = parseFloat(raw);
            if (isNaN(val)) { resolve(cpuUsoPctFallback()); return; }
            resolve(Math.round(Math.min(100, Math.max(0, val)) * 10) / 10);
        });
    });
}

// Fallback usando os.cpus() (delta entre amostras)
let _cpuAnterior = null;
function cpuUsoPctFallback() {
    const cpus = os.cpus();
    const agora = cpus.map(c => {
        const t = c.times;
        const total = t.user + t.nice + t.sys + t.idle + t.irq;
        return { total, idle: t.idle };
    });
    let resultado = null;
    if (_cpuAnterior && _cpuAnterior.length === agora.length) {
        const uso = [];
        for (let i = 0; i < agora.length; i++) {
            const dt = agora[i].total - _cpuAnterior[i].total;
            const di = agora[i].idle - _cpuAnterior[i].idle;
            uso.push(dt > 0 ? Math.round(((dt - di) / dt) * 1000) / 10 : 0);
        }
        const media = uso.reduce((a, b) => a + b, 0) / uso.length;
        resultado = Math.round(media * 10) / 10;
    }
    _cpuAnterior = agora;
    return resultado;
}

function memoria() {
    const total = os.totalmem();
    const livre = os.freemem();
    const usado = total - livre;
    return {
        totalGb: Math.round((total / 1073741824) * 100) / 100,
        usadoGb: Math.round((usado / 1073741824) * 100) / 100,
        livreGb: Math.round((livre / 1073741824) * 100) / 100,
        usoPct: Math.round((usado / total) * 1000) / 10
    };
}

function disco() {
    return new Promise((resolve) => {
        const cmd = 'powershell -NoProfile -Command "Get-CimInstance Win32_LogicalDisk -Filter \\"DriveType=3\\" | Select-Object DeviceID,@{n=\'TotalGB\';e={[math]::Round($_.Size/1GB,2)}},@{n=\'FreeGB\';e={[math]::Round($_.FreeSpace/1GB,2)}},@{n=\'UsedGB\';e={[math]::Round(($_.Size-$_.FreeSpace)/1GB,2)}},@{n=\'UsagePct\';e={[math]::Round(($_.Size-$_.FreeSpace)/$_.Size*100,1)}} | ConvertTo-Json"';
        exec(cmd, { timeout: 10000, windowsHide: true }, (err, stdout) => {
            if (err) return resolve({ indisponivel: 'Falha ao consultar discos (WMI/PowerShell).' });
            try {
                let raw = stdout.trim();
                if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
                let d = JSON.parse(raw);
                if (!Array.isArray(d)) d = [d];
                resolve({ discos: d.map(x => ({
                    letra: x.DeviceID,
                    totalGb: x.TotalGB,
                    usadoGb: x.UsedGB,
                    livreGb: x.FreeGB,
                    usoPct: x.UsagePct
                })) });
            } catch (e) {
                resolve({ indisponivel: 'Saida do PowerShell ilegivel para disco.' });
            }
        });
    });
}

/** GPU: tenta nvidia-smi (NVIDIA), depois Get-Counter (Windows GPU Engine). */
function gpu() {
    return new Promise((resolve) => {
        // 1) nvidia-smi (NVIDIA)
        exec('nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits', { timeout: 8000, windowsHide: true }, (errNv, outNv) => {
            if (!errNv && outNv && outNv.trim()) {
                const linhas = outNv.trim().split('\n');
                const gpus = linhas.map(l => {
                    const p = l.split(',').map(x => x.trim());
                    return { nome: p[0], usoPct: parseFloat(p[1]), memoriaUsadaMb: parseFloat(p[2]), memoriaTotalMb: parseFloat(p[3]), temperaturaC: parseFloat(p[4]) };
                });
                return resolve({ fonte: 'nvidia-smi', gpus });
            }
            // 2) Get-Counter (funciona pra GPU dedicada ou integrada com contador)
            const cmd = 'powershell -NoProfile -Command "$c = Get-Counter \'\\GPU Engine(*)\\Utilization Percentage\' -ErrorAction SilentlyContinue; if ($c) { $total = ($c.CounterSamples | Measure-Object -Property CookedValue -Sum).Sum; [math]::Round($total,1) } else { $null }"';
            exec(cmd, { timeout: 8000, windowsHide: true }, (err2, out2) => {
                if (err2) return resolve({ indisponivel: 'Sem nvidia-smi e sem contador GPU (WMI/Performance Counter).' });
                const val = parseFloat((out2 || '').trim());
                if (isNaN(val)) return resolve({ indisponivel: 'Contador GPU sem dados (GPU ociosa ou driver sem contador).' });
                // Nome da GPU via WMI
                exec('powershell -NoProfile -Command "(Get-CimInstance Win32_VideoController | Select-Object -First 1).Name"', { timeout: 8000, windowsHide: true }, (err3, out3) => {
                    const nome = (out3 || '').trim() || 'GPU desconhecida';
                    resolve({ fonte: 'performance-counter', gpus: [{ nome, usoPct: Math.min(100, val) }] });
                });
            });
        });
    });
}

/** Estado do uptime com deteccao REAL de reinicio (uptime diminuiu = reiniciou). */
function uptimeEstado(estadoAnterior) {
    const uptimeSeg = Math.floor(os.uptime());
    const bootTime = new Date(Date.now() - uptimeSeg * 1000).toISOString();
    const reiniciado = estadoAnterior && typeof estadoAnterior.uptimeSeg === 'number'
        ? uptimeSeg < estadoAnterior.uptimeSeg
        : false;
    const horas = Math.floor(uptimeSeg / 3600);
    const minutos = Math.floor((uptimeSeg % 3600) / 60);
    return {
        uptimeSeg,
        uptimeHumano: horas + 'h ' + minutos + 'm',
        bootTime,
        reiniciadoDesdeUltimaColeta: reiniciado,
        deltaUptimeSeg: estadoAnterior && typeof estadoAnterior.uptimeSeg === 'number'
            ? uptimeSeg - estadoAnterior.uptimeSeg
            : null
    };
}

function rede() {
    const ifaces = os.networkInterfaces();
    const placas = [];
    for (const [nome, addrs] of Object.entries(ifaces)) {
        for (const a of (addrs || [])) {
            if ((a.family === 'IPv4' || a.family === 4) && !a.internal) {
                const virtual = /vEthernet|WSL|Hyper-V|VPN|TAP|TUN|Loopback/i.test(nome);
                placas.push({ nome, ip: a.address, mac: a.mac, virtual });
            }
        }
    }
    placas.sort((a, b) => (a.virtual ? 1 : 0) - (b.virtual ? 1 : 0));
    return placas;
}

function infoBase() {
    return {
        hostname: os.hostname(),
        plataforma: os.platform(),
        arquitetura: os.arch(),
        release: os.release(),
        node: process.version,
        cargaMedia: os.loadavg().map(x => Math.round(x * 100) / 100)
    };
}

/** Coleta completa (CPU na 2a chamada em diante). estadoAnterior guarda cpu/uptime da coleta passada. */
async function coletar(estadoAnterior) {
    const ant = estadoAnterior || {};
    const cpuPct = await cpuUsoPct();
    const mem = memoria();
    const up = uptimeEstado(ant.uptime);
    const [discos, gpuInfo] = await Promise.all([disco(), gpu()]);
    return {
        quando: new Date().toISOString(),
        hostname: os.hostname(),
        info: infoBase(),
        cpu: cpuPct != null
            ? { usoPct: cpuPct, nucleos: os.cpus().length, modelo: (os.cpus()[0] && os.cpus()[0].model || '').trim() }
            : { indisponivel: 'Primeira amostra ainda sem delta de tempo — disponivel na proxima coleta.', nucleos: os.cpus().length, modelo: (os.cpus()[0] && os.cpus()[0].model || '').trim() },
        gpu: gpuInfo,
        memoria: mem,
        disco: discos,
        uptime: up,
        rede: rede(),
        // snapshot para comparacao no proximo ciclo
        _snapshot: { uptime: { uptimeSeg: up.uptimeSeg }, cpuPct }
    };
}

module.exports = { coletar, rede, infoBase, memoria };
