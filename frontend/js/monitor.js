'use strict';
/**
 * Monitoramento e Diagnostico — frontend
 * Consome /api/monitor/* e /api/zabbix/* do server.cjs
 * Nao inicia testes de rede pelo navegador — apenas consulta dados ja coletados.
 */

// ==================== ESTADO ====================
let _monTimer = null;
let _monDados = null;
let _monZabbix = null;
let _monSistema = null;
let _monCpuHist = [];
let _monRamHist = [];
let _monFiltroEstado = '';
let _monFiltroSetor = '';
let _monBusca = '';
let _monEventSource = null;
let _monAlertasZabbix = [];
let _monKpiCharts = {};
let _monChartAtual = null;
let _monChartExpandido = false;

// ==================== INICIALIZACAO ====================
function monInit() {
    monAtualizar();
    monConectarSSE();
    // Auto-refresh a cada 30s (fallback caso SSE falhe)
    if (_monTimer) clearInterval(_monTimer);
    _monTimer = setInterval(function() {
        if (typeof document !== 'undefined' && !document.hidden) {
            const secao = document.getElementById('monitoramento');
            if (secao && !secao.classList.contains('hidden')) {
                monAtualizar();
            }
        }
    }, 30000);
}

// Conecta ao stream SSE para atualizacao em tempo real
function monConectarSSE() {
    if (typeof EventSource === 'undefined') return;
    if (_monEventSource) { try { _monEventSource.close(); } catch(e) {} }
    try {
        _monEventSource = new EventSource('/api/monitor/stream');

        // Evento: painel real (ciclo do coletor)
        _monEventSource.addEventListener('painel', function(e) {
            try {
                _monDados = JSON.parse(e.data);
                _monArmKPIs = null;
                monRenderKPIs(_monDados);
                monRenderFiltroSetores(_monDados);
                monRenderTabela(_monDados);
                monRenderAlertas(_monDados);
                monRenderIncidentes(_monDados);
                monRenderIndisponiveis(_monDados);
            } catch (err) {}
        });

        // Evento: painel mock (101 PCs inventario original) — a cada 15s
        _monEventSource.addEventListener('mock-painel', function(e) {
            try {
                const mock = JSON.parse(e.data);
                if (_monFonteMock && mock && mock.linhas && mock.linhas.length) {
                    _monDados = mock;
                    _monArmKPIs = null;
                    monRenderKPIs(mock);
                    monRenderFiltroSetores(mock);
                    monRenderTabela(mock);
                    monRenderAlertas(mock);
                    monRenderIncidentes(mock);
                    monRenderIndisponiveis(mock);
                    console.log('[monitor] [MOCK] mock-painel atualizado com dados do inventario (', mock.linhas.length, ' PCs)');
                }
            } catch (err) {
                console.error('[monitor] [MOCK] Erro ao processar mock-painel:', err && err.message ? err.message : err);
            }
        });

        // Evento: metricas do PC local (RAM/CPU/Disco) — a cada 10s
        _monEventSource.addEventListener('sistema', function(e) {
            try {
                const s = JSON.parse(e.data);
                _monSistema = s;
                monRenderSistema(s);
            } catch (err) {}
        });

        // Evento: notificacao Zabbix webhook (action → SSE)
        _monEventSource.addEventListener('alerta', function(e) {
            try {
                const a = JSON.parse(e.data);
                _monAlertasZabbix = _monAlertasZabbix || [];
                _monAlertasZabbix.unshift(a);
                if (_monAlertasZabbix.length > 100) _monAlertasZabbix.length = 100;
                monRenderAlertasZabbix();
                if (typeof showToast === 'function') showToast((a.status === 'PROBLEM' ? '⚠ PROBLEMA' : '✓ RESOLVIDO') + ': ' + a.trigger + ' @ ' + a.host, a.status === 'PROBLEM' ? 'error' : 'success');
            } catch (err) {}
        });

        _monEventSource.addEventListener('connected', function() {
            monAtualizar();
        });
        _monEventSource.onerror = function() {
            try { _monEventSource.close(); } catch(e) {}
            _monEventSource = null;
            setTimeout(function() {
                const secao = document.getElementById('monitoramento');
                if (secao && !secao.classList.contains('hidden')) {
                    monConectarSSE();
                }
            }, 5000);
        };
    } catch (e) {}
}

// Hook: quando showSection('monitoramento') e chamado pelo app.js
// Interceptamos via observer para disparar a carga
if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', function() {
        // Expoe globalmente para o app.js chamar
        window.monInit = monInit;
        window.monAtualizar = monAtualizar;
        window.monExecutarCiclo = monExecutarCiclo;
        window.monExportarCSV = monExportarCSV;
        window.monVerDetalhe = monVerDetalhe;
        window.monVerZabbix = monVerZabbix;
        window.monAtualizarArmazenamento = monAtualizarArmazenamento;
        window.monVerHistorico = monVerHistorico;
        window.monCarregarHistorico = monCarregarHistorico;
        window.monToggleKpiDetail = monToggleKpiDetail;
        window.monCloseKpiDetail = monCloseKpiDetail;
    });
}

// Observa mudanca de secao para auto-carregar
if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function() {
        const observer = new MutationObserver(function() {
            const secao = document.getElementById('monitoramento');
            if (secao && !secao.classList.contains('hidden') && !_monDados) {
                monAtualizar();
            }
        });
        const alvo = document.querySelector('.section-content');
        if (alvo) observer.observe(alvo, { attributes: true, subtree: true, attributeFilter: ['class'] });
    });
}

// ==================== CARREGAMENTO ====================
let _monFonteMock = false; // usa painel real (meu PC + 1 mock)

async function monAtualizar() {
    try {
        // Busca painel real + painel mock (101 PCs inventario original)
        const [painelReal, painelMock, zabbix, sistema] = await Promise.all([
            fetch('/api/monitor/painel').then(r => r.json()).catch(() => null),
            fetch('/api/monitor/mock/painel').then(r => r.json()).catch(() => null),
            fetch('/api/zabbix/resumo').then(r => r.json()).catch(() => null),
            fetch('/api/monitor/sistema').then(r => r.json()).catch(() => null)
        ]);
        _monZabbix = zabbix;
        _monSistema = sistema;
        monRenderZabbixStatus(zabbix);
        monRenderSistema(sistema);

        // Painel mock (101 PCs inventario) tem prioridade se disponivel
        if (_monFonteMock && painelMock && painelMock.linhas && painelMock.linhas.length > 0) {
            painelMock.fonte = 'MOCK_INVENTARIO_ORIGINAL';
            _monDados = painelMock;
        } else {
            _monDados = painelReal;
        }

        monRenderKPIs(_monDados);
        monRenderFiltroSetores(_monDados);
        monRenderTabela(_monDados);
        monRenderAlertas(_monDados);
        monRenderIncidentes(_monDados);
        monRenderIndisponiveis(_monDados);
        monRenderZabbixHosts();
        monAtualizarArmazenamento();
    } catch (e) {
        console.error('Erro ao carregar monitoramento:', e);
    }
}

async function monExecutarCiclo() {
    try {
        const btn = document.querySelector('#monitoramento .toolbar-actions .btn-primary');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando...'; }
        await fetch('/api/monitor/ciclo', { method: 'POST' });
        await monAtualizar();
        if (typeof showToast === 'function') showToast('Verificacao concluida.', 'success');
    } catch (e) {
        if (typeof showToast === 'function') showToast('Erro ao executar ciclo: ' + e.message, 'error');
    } finally {
        const btn = document.querySelector('#monitoramento .toolbar-actions .btn-primary');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync"></i> Verificar Agora'; }
    }
}

// ==================== RENDER: STATUS ZABBIX ====================
function monRenderZabbixStatus(z) {
    const el = document.getElementById('mon-zabbix-status');
    if (!el) return;
    if (z && z.desabilitado) {
        el.innerHTML = '<div class="glass-panel" style="border-left:3px solid var(--yellow);margin-bottom:0;">' +
            '<div style="padding:14px 18px;display:flex;align-items:center;gap:12px;">' +
            '<i class="fas fa-plug-circle-xmark" style="color:var(--yellow);font-size:18px;"></i>' +
            '<div><b style="font-size:13px;color:var(--text-primary);">Zabbix: desabilitado</b>' +
            '<p style="font-size:11px;color:var(--text-muted);margin:2px 0 0;">' + z.mensagem + '</p></div>' +
            '</div></div>';
        return;
    }
    if (!z || z.erro) {
        el.innerHTML = '<div class="glass-panel" style="border-left:3px solid var(--yellow);margin-bottom:0;">' +
            '<div style="padding:14px 18px;display:flex;align-items:center;gap:12px;">' +
            '<i class="fas fa-plug-circle-xmark" style="color:var(--yellow);font-size:18px;"></i>' +
            '<div><b style="font-size:13px;color:var(--text-primary);">Zabbix: ' + (z && z.erro ? 'desconectado' : 'nao configurado') + '</b>' +
            '<p style="font-size:11px;color:var(--text-muted);margin:2px 0 0;">' + (z && z.erro ? z.erro : 'Configure monitor/zabbix-config.json e reinicie o servidor.') + '</p></div>' +
            '</div></div>';
        return;
    }
    const zx = z.zabbix || {};
    const pr = z.problemas || {};
    const ok = z.conectado;
    el.innerHTML = '<div class="glass-panel" style="border-left:3px solid ' + (ok ? 'var(--green)' : 'var(--red)') + ';margin-bottom:0;">' +
        '<div style="padding:14px 18px;display:flex;align-items:center;gap:18px;flex-wrap:wrap;">' +
        '<div style="display:flex;align-items:center;gap:10px;">' +
        '<i class="fas fa-' + (ok ? 'circle-check' : 'circle-xmark') + '" style="color:var(--' + (ok ? 'green' : 'red') + ');font-size:18px;"></i>' +
        '<div><b style="font-size:13px;color:var(--text-primary);">Zabbix ' + (ok ? 'Conectado' : 'Desconectado') + '</b>' +
        '<p style="font-size:11px;color:var(--text-muted);margin:0;">Hosts: ' + (zx.totalHosts || 0) + ' | Disponiveis: ' + (zx.disponiveis || 0) + ' | Indisponiveis: ' + (zx.indisponiveis || 0) + '</p></div></div>' +
        (pr.total ? '<div style="display:flex;align-items:center;gap:8px;margin-left:auto;">' +
            '<span style="font-size:11px;color:var(--text-muted);">Problemas:</span>' +
            '<span class="badge badge-' + (pr.criticos ? 'cancelada' : 'pendente') + '">' + pr.total + ' (' + (pr.criticos || 0) + ' criticos)</span>' +
            '</div>' : '') +
        '</div></div>';
}

// ==================== RENDER: SISTEMA LOCAL ====================
function monRenderSistema(s) {
    const el = document.getElementById('mon-sistema');
    if (!el) return;
    if (!s || s.error) {
        el.innerHTML = '<div class="glass-panel" style="border-left:3px solid var(--yellow);margin-bottom:0;">' +
            '<div style="padding:14px 18px;display:flex;align-items:center;gap:12px;">' +
            '<i class="fas fa-microchip" style="color:var(--yellow);font-size:18px;"></i>' +
            '<div><b style="font-size:13px;color:var(--text-primary);">Metricas Locais</b>' +
            '<p style="font-size:11px;color:var(--text-muted);margin:2px 0 0;">' + (s && s.error ? s.error : 'Indisponivel') + '</p></div>' +
            '</div></div>';
        return;
    }
    const cpu = s.cpu || {};
    const mem = s.memoria || {};
    const up = s.uptime || {};
    const gpuInfo = s.gpu || {};
    const disco = (s.disco && s.disco.discos) ? s.disco.discos[0] : null;
    const info = s.info || {};
    const rede = (s.rede || [])[0] || {};

    let gpuValor = 'Indisp.';
    let gpuSub = gpuInfo.indisponivel || '';
    let gpuCor = 'muted';
    if (gpuInfo.gpus && gpuInfo.gpus.length) {
        const g0 = gpuInfo.gpus[0];
        gpuValor = g0.usoPct != null ? g0.usoPct + '%' : '?';
        gpuSub = g0.nome + (g0.memoriaTotalMb ? ' · ' + g0.memoriaUsadaMb + '/' + g0.memoriaTotalMb + ' MB' : '') + (g0.temperaturaC ? ' · ' + g0.temperaturaC + '°C' : '');
        gpuCor = g0.usoPct != null ? (g0.usoPct > 80 ? 'red' : g0.usoPct > 50 ? 'yellow' : 'green') : 'muted';
    }

    el.innerHTML = '<div class="glass-panel" style="border-left:3px solid var(--cyan);margin-bottom:0;">' +
        '<div style="padding:16px 20px;">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">' +
        '<i class="fas fa-microchip" style="color:var(--cyan);font-size:16px;"></i>' +
        '<b style="font-size:13px;color:var(--text-primary);">PC Local — ' + esc(s.hostname || '?') + ' (' + esc((s.rede && s.rede[0] && s.rede[0].ip) || '?') + ')</b>' +
        '<span style="font-size:10px;color:var(--text-muted);margin-left:auto;">Coletado: ' + new Date(s.quando).toLocaleString('pt-BR') + '</span>' +
        '<button class="btn btn-ghost btn-sm" style="margin-left:8px;" onclick="monAbrirRelatorioPC()" title="Relatorio detalhado em nova aba"><i class="fas fa-file-lines"></i> Relatorio</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;">' +
        monSistemaItem('fa-microchip', 'CPU', cpu.usoPct != null ? cpu.usoPct + '%' : 'Aguardando...', cpu.modelo ? cpu.nucleos + ' nucleos · ' + cpu.modelo : '', cpu.usoPct != null ? (cpu.usoPct > 80 ? 'red' : cpu.usoPct > 50 ? 'yellow' : 'green') : 'muted') +
        monSistemaItem('fa-microchip', 'GPU', gpuValor, gpuSub, gpuCor) +
        monSistemaItem('fa-memory', 'RAM', mem.usoPct != null ? mem.usoPct + '%' : '?', mem.usoPct != null ? mem.usadoGb + '/' + mem.totalGb + ' GB (livre: ' + mem.livreGb + ' GB)' : '', mem.usoPct != null ? (mem.usoPct > 80 ? 'red' : mem.usoPct > 50 ? 'yellow' : 'green') : 'muted') +
        monSistemaItem('fa-hard-drive', 'Disco ' + (disco ? disco.letra : '') + ' (espaço)', disco ? disco.usoPct + '%' : 'Indisp.', disco ? disco.usadoGb + '/' + disco.totalGb + ' GB (livre: ' + disco.livreGb + ' GB)' : '', disco ? (disco.usoPct > 90 ? 'red' : disco.usoPct > 70 ? 'yellow' : 'green') : 'muted') +
        monSistemaItem('fa-clock', 'Uptime', up.uptimeHumano || '?', 'Boot: ' + (up.bootTime ? new Date(up.bootTime).toLocaleString('pt-BR') : '?') + (up.reiniciadoDesdeUltimaColeta ? ' · REINICIADO!' : ''), up.reiniciadoDesdeUltimaColeta ? 'red' : 'cyan') +
        monSistemaItem('fa-network-wired', 'Rede', rede.ip || '?', rede.nome ? rede.nome + ' · MAC: ' + rede.mac : '', 'purple') +
        monSistemaItem('fa-server', 'Sistema', (info.plataforma || '?') + ' ' + (info.arquitetura || ''), 'Kernel ' + (info.release || '?') + ' · Node ' + (info.node || '?'), 'magenta') +
        '</div></div></div>';

    // Acumula historico para grafico cardiaco (ultimos 30 pontos)
    if (cpu.usoPct != null) { _monCpuHist.push(cpu.usoPct); if (_monCpuHist.length > 30) _monCpuHist.shift(); }
    if (mem.usoPct != null) { _monRamHist.push(mem.usoPct); if (_monRamHist.length > 30) _monRamHist.shift(); }

    // Acumula graficos para uso no KPI detalhado / relatorio (sem renderizar inline)
    if (_monCpuHist.length >= 2) {
        const cpuHtml = monCartesianChart(_monCpuHist, { titulo: 'CPU', unidade: '%', cor: '#00d4ff', altura: 220, minForcado: 0, maxForcado: 100 });
        const ramHtml = monCartesianChart(_monRamHist, { titulo: 'RAM', unidade: '%', cor: '#a855f7', altura: 220, minForcado: 0, maxForcado: 100 });
        _monKpiCharts['sys-cpu'] = { titulo: 'CPU do PC Local (%)', html: cpuHtml };
        _monKpiCharts['sys-ram'] = { titulo: 'RAM do PC Local (%)', html: ramHtml };
    }
}

function monSistemaItem(icon, label, valor, sub, cor) {
    const corMap = { green: 'var(--green)', yellow: 'var(--yellow)', red: 'var(--red)', cyan: 'var(--cyan)', purple: 'var(--purple)', magenta: 'var(--magenta)', muted: 'var(--text-muted)' };
    const corVal = corMap[cor] || 'var(--text-primary)';
    return '<div style="padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:10px;border-left:3px solid ' + corVal + ';">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">' +
        '<i class="fas ' + icon + '" style="color:' + corVal + ';font-size:11px;"></i>' +
        '<span style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">' + label + '</span>' +
        '</div>' +
        '<div style="font-size:20px;font-weight:700;color:' + corVal + ';">' + valor + '</div>' +
        (sub ? '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">' + sub + '</div>' : '') +
        '</div>';
}

// ==================== SISTEMA DE GRAFICOS SVG ====================
/**
 * Gera um grafico de linha estilo "cardiaco" (EKG) em SVG.
 * @param {Array} dados - Array de numeros (0-100 ou valores reais)
 * @param {string} cor - cor da linha
 * @param {string} corFundo - cor do fundo do grafico
 * @param {number} largura - largura do SVG
 * @param {number} altura - altura do SVG
 * @param {boolean} marcarFalhas - se true, marca pontos de falha em vermelho
 * @returns {string} HTML do SVG
 */
function monSvgChart(dados, cor, corFundo, largura, altura, marcarFalhas) {
    if (!dados || dados.length < 2) return '<div style="font-size:10px;color:var(--text-muted);padding:4px;">Dados insuficientes</div>';
    const pts = dados.filter(v => v !== null && v !== undefined && !isNaN(v));
    if (pts.length < 2) return '<div style="font-size:10px;color:var(--text-muted);padding:4px;">Dados insuficientes</div>';

    const max = Math.max(...pts);
    const min = Math.min(...pts);
    const range = (max - min) || 1;
    const padX = 2, padY = 3;
    const w = largura || 280;
    const h = altura || 60;

    // Gera pontos do polilinha
    const step = (w - padX * 2) / (pts.length - 1);
    let pontos = [];
    for (let i = 0; i < pts.length; i++) {
        const x = padX + i * step;
        const y = padY + (h - padY * 2) - ((pts[i] - min) / range) * (h - padY * 2);
        pontos.push([x, y]);
    }

    const polilinha = pontos.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');

    // Preenchimento sob a linha
    const fillPoints = padX + ',' + (h - padY) + ' ' + polilinha + ' ' + (padX + (pts.length - 1) * step).toFixed(1) + ',' + (h - padY);

    // Pontos de falha (onde ok=false)
    let falhaMarkers = '';
    if (marcarFalhas && dados.originais) {
        for (let i = 0; i < pontos.length; i++) {
            const v = dados.originais[i];
            if (v !== null && v !== undefined && !v.ok) {
                falhaMarkers += '<circle cx="' + pontos[i][0].toFixed(1) + '" cy="' + pontos[i][1].toFixed(1) + '" r="2.5" fill="#ff4444" opacity="0.9"/>';
            }
        }
    }

    // Grid lines
    const gridLines = [0.25, 0.5, 0.75].map(frac => {
        const y = padY + (h - padY * 2) * frac;
        return '<line x1="' + padX + '" y1="' + y + '" x2="' + (w - padX) + '" y2="' + y + '" stroke="rgba(255,255,255,0.06)" stroke-width="0.5"/>';
    }).join('');

    // Valor atual
    const atual = pts[pts.length - 1];
    const valorAtual = typeof atual === 'number' ? atual.toFixed(1) : atual;

    return '<svg width="' + w + '" height="' + h + '" style="display:block;background:' + (corFundo || 'rgba(0,0,0,0.2)') + ';border-radius:6px;">' +
        gridLines +
        '<polygon points="' + fillPoints + '" fill="' + cor + '" opacity="0.12"/>' +
        '<polyline points="' + polilinha + '" fill="none" stroke="' + cor + '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>' +
        falhaMarkers +
        '<circle cx="' + pontos[pontos.length - 1][0].toFixed(1) + '" cy="' + pontos[pontos.length - 1][1].toFixed(1) + '" r="3" fill="' + cor + '" stroke="white" stroke-width="1"/>' +
        '<text x="' + (w - 5) + '" y="12" text-anchor="end" fill="' + cor + '" font-size="9" font-weight="700">' + valorAtual + '</text>' +
        '</svg>';
}

/**
 * Grafico cartesiano SVG completo: eixos X/Y com rotulos, grid, area,
 * linha, marcadores de falha, tooltip hover e legenda.
 * dados: [{t: timestamp, v: valor, ok: bool}] ou array numerico
 * opts: {titulo, unidade, cor, largura, altura, minForcado, maxForcado, formatarY, formatarX}
 */
function monCartesianChart(dados, opts) {
    opts = opts || {};
    if (!dados || dados.length < 2) return '<div style="font-size:10px;color:var(--text-muted);padding:8px;">Dados insuficientes</div>';

    // Normaliza para [{t,v,ok}]
    let pts;
    if (typeof dados[0] === 'object' && dados[0] !== null) {
        pts = dados.map(d => ({ t: d.t || d.timestamp || 0, v: d.v != null ? d.v : d.valor, ok: d.ok !== false }));
    } else {
        const agora = Date.now();
        pts = dados.map((v, i) => ({ t: agora - (dados.length - 1 - i) * 60000, v: v, ok: v != null }));
    }
    const validos = pts.filter(p => p.v != null && !isNaN(p.v));
    if (validos.length < 2) return '<div style="font-size:10px;color:var(--text-muted);padding:8px;">Dados insuficientes</div>';

    const cor = opts.cor || '#2962FF';
    const corFundo = opts.corFundo || 'rgba(0,0,0,0.25)';
    const w = opts.largura || 560;
    const h = opts.altura || 260;
    const padL = 48, padR = 16, padT = 28, padB = 36;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const valores = validos.map(p => p.v);
    let min = opts.minForcado != null ? opts.minForcado : Math.min(...valores);
    let max = opts.maxForcado != null ? opts.maxForcado : Math.max(...valores);
    if (min === max) { min = min - 1; max = max + 1; }
    const range = max - min;

    const tMin = Math.min(...pts.map(p => p.t));
    const tMax = Math.max(...pts.map(p => p.t));
    const tRange = (tMax - tMin) || 1;

    const fmtY = opts.formatarY || (v => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10));
    const fmtX = opts.formatarX || (t => {
        const d = new Date(t);
        return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    });

    const xOf = t => padL + ((t - tMin) / tRange) * plotW;
    const yOf = v => padT + plotH - ((v - min) / range) * plotH;

    // Grid horizontal + labels Y
    let gridH = '', lblY = '';
    const nY = 5;
    for (let i = 0; i <= nY; i++) {
        const v = min + (range * i) / nY;
        const y = yOf(v);
        gridH += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (w - padR) + '" y2="' + y.toFixed(1) + '" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>';
        lblY += '<text x="' + (padL - 6) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end" fill="rgba(255,255,255,0.45)" font-size="10">' + fmtY(v) + '</text>';
    }

    // Grid vertical + labels X
    let gridV = '', lblX = '';
    const nX = Math.min(6, pts.length);
    for (let i = 0; i <= nX; i++) {
        const t = tMin + (tRange * i) / nX;
        const x = xOf(t);
        gridV += '<line x1="' + x.toFixed(1) + '" y1="' + padT + '" x2="' + x.toFixed(1) + '" y2="' + (padT + plotH) + '" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>';
        lblX += '<text x="' + x.toFixed(1) + '" y="' + (h - 8) + '" text-anchor="middle" fill="rgba(255,255,255,0.45)" font-size="10">' + fmtX(t) + '</text>';
    }

    // Linha + area
    const coords = pts.filter(p => p.v != null).map(p => xOf(p.t).toFixed(1) + ',' + yOf(p.v).toFixed(1));
    const linha = coords.join(' ');
    const area = padL + ',' + (padT + plotH) + ' ' + linha + ' ' + (w - padR) + ',' + (padT + plotH);

    // Marcadores de falha
    let falhas = '';
    for (const p of pts) {
        if (p.v != null && p.ok === false) {
            falhas += '<circle cx="' + xOf(p.t).toFixed(1) + '" cy="' + yOf(p.v).toFixed(1) + '" r="4" fill="#ff4444" stroke="#fff" stroke-width="1"/>';
        }
    }

    // Ponto atual
    const ultimo = validos[validos.length - 1];
    const pontoAtual = '<circle cx="' + xOf(ultimo.t).toFixed(1) + '" cy="' + yOf(ultimo.v).toFixed(1) + '" r="5" fill="' + cor + '" stroke="#fff" stroke-width="2"/>';

    // Hover points com tooltip nativo SVG (<title>)
    let hoverPts = '';
    for (const p of pts) {
        if (p.v == null) continue;
        const tip = new Date(p.t).toLocaleString('pt-BR') + ' — ' + fmtY(p.v) + (opts.unidade || '') + (p.ok === false ? ' (FALHA)' : '');
        hoverPts += '<circle class="mchov" cx="' + xOf(p.t).toFixed(1) + '" cy="' + yOf(p.v).toFixed(1) + '" r="7" fill="transparent">' +
            '<title>' + esc(tip) + '</title></circle>';
    }

    const titulo = opts.titulo ? '<text x="' + padL + '" y="16" fill="rgba(255,255,255,0.7)" font-size="11" font-weight="600">' + esc(opts.titulo) + '</text>' : '';
    const legendaValor = '<text x="' + (w - padR) + '" y="16" text-anchor="end" fill="' + cor + '" font-size="13" font-weight="700">' + fmtY(ultimo.v) + (opts.unidade || '') + '</text>';

    return '<svg width="' + w + '" height="' + h + '" style="display:block;background:' + corFundo + ';border-radius:8px;max-width:100%;">' +
        titulo + legendaValor +
        gridH + gridV + lblY + lblX +
        '<polygon points="' + area + '" fill="' + cor + '" opacity="0.10"/>' +
        '<polyline points="' + linha + '" fill="none" stroke="' + cor + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
        falhas + pontoAtual +
        hoverPts +
        '<line x1="' + padL + '" y1="' + (padT + plotH) + '" x2="' + (w - padR) + '" y2="' + (padT + plotH) + '" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>' +
        '<line x1="' + padL + '" y1="' + padT + '" x2="' + padL + '" y2="' + (padT + plotH) + '" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>' +
        '</svg>';
}

/**
 * Gera sparkline inline (pequeno grafico no estilo Unicode block)
 */
function monSparklineUnicode(dados, maxVal) {
    if (!dados || dados.length < 2) return '';
    const blocks = '▁▂▃▄▅▆▇█';
    const max = maxVal || Math.max(...dados.filter(v => v != null)) || 1;
    let result = '';
    for (const v of dados.slice(-20)) {
        const norm = v != null ? v / max : 0;
        const level = Math.max(1, Math.min(8, Math.ceil(norm * 8)));
        result += blocks.charAt(level - 1);
    }
    return result;
}

// ==================== MOCK METRICS ====================
let _mockMetricas = {};
async function monCarregarMockMetricas(ip) {
    if (_mockMetricas[ip] && _mockMetricas[ip]._ts && (Date.now() - _mockMetricas[ip]._ts < 5000)) {
        return _mockMetricas[ip];
    }
    try {
        const d = await fetch('/api/monitor/mock/' + encodeURIComponent(ip)).then(r => r.json());
        d._ts = Date.now();
        _mockMetricas[ip] = d;
        return d;
    } catch (e) { return null; }
}

// ==================== RENDER: KPIs ====================
function monRenderKPIs(p) {
    const el = document.getElementById('mon-kpis');
    if (!el || !p || !p.resumo) { if (el) el.innerHTML = ''; return; }
    const r = p.resumo;
    const servico = p.servico || {};

    let html =
        monKpiCard('fa-desktop', 'cyan', r.totalAlvos, 'Equipamentos', 'Total cadastrado com IP', 'mon-kpi-total') +
        monKpiCard('fa-circle-check', 'green', r.acessiveis, 'Acessiveis', 'Respondendo agora', 'mon-kpi-acessiveis') +
        monKpiCard('fa-circle-xmark', 'red', r.semResposta, 'Sem Resposta', 'Nao responderam', 'mon-kpi-semresposta') +
        monKpiCard('fa-wave-square', 'yellow', r.instaveis, 'Instaveis', 'Oscilando', 'mon-kpi-instaveis') +
        monKpiCard('fa-triangle-exclamation', 'orange', r.alertasAbertos, 'Alertas', 'Abertos', 'mon-kpi-alertas') +
        monKpiCard('fa-share-nodes', 'purple', r.incidentesSetor, 'Incidentes Setor', 'Falha em massa', 'mon-kpi-incidentes') +
        monKpiCard('fa-circle-question', 'magenta', r.semDados, 'Sem Dados', 'Ainda nao verificados', 'mon-kpi-semdados') +
        monKpiCard('fa-clock', 'cyan', servico.rodando ? 'ON' : 'OFF', 'Coletor', servico.rodando ? 'Ativo' : 'Parado', 'mon-kpi-coletor');

    el.innerHTML = html;

    // KPIs de armazenamento (carrega sob demanda)
    monRenderArmazenamentoKPIs();
}

let _monArmKPIs = null;
async function monRenderArmazenamentoKPIs() {
    const el = document.getElementById('mon-kpis');
    if (!el) return;
    try {
        if (!_monArmKPIs) {
            _monArmKPIs = await fetch('/api/monitor/armazenamento').then(r => r.json()).catch(() => null);
        }
        if (!_monArmKPIs) return;
        const dm = _monArmKPIs || {};
        const discos = _monArmKPIs.discos || [];
        const disco0 = discos[0] || null;
        // Mostrar valores em GB em vez de % (conforme requisito do usuario)
        let discoTexto = 'Indisp.';
        let discoSub = '';
        let discoCor = 'green';
        if (disco0) {
            discoTexto = disco0.usadoGb + ' de ' + disco0.totalGb + ' GB';
            discoSub = disco0.livreGb + ' GB livre';
            discoCor = disco0.usoPct > 90 ? 'red' : disco0.usoPct > 70 ? 'yellow' : 'green';
        }
        const armHtml =
            monKpiCard('fa-hard-drive', discoCor,
                disco0 ? disco0.usadoGb + ' de ' + disco0.totalGb + ' GB' : '?', 'Disco ' + (disco0 ? disco0.letra : ''),
                discoSub, 'mon-kpi-disco') +
            monKpiCard('fa-database', 'purple', dm.totalMedicoes != null ? dm.totalMedicoes : '?', 'Medicoes', dm.diasComDados + ' dia(s) | ' + (dm.tamanhoTotalMB || 0) + ' MB', 'mon-kpi-medicoes');
        el.insertAdjacentHTML('beforeend', armHtml);
    } catch (e) {}
}

function monKpiCard(icon, cor, valor, label, sub, key) {
    return '<div class="kpi-card kpi-card-' + cor + '" onclick="monToggleKpiDetail(\'' + key + '\')" data-key="' + key + '">' +
        '<div class="kpi-header">' +
        '<div class="kpi-icon kpi-icon-' + cor + '"><i class="fas ' + icon + '"></i></div>' +
        '</div>' +
        '<div class="kpi-value" style="font-size:28px;">' + valor + '</div>' +
        '<div class="kpi-label">' + label + '</div>' +
        '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">' + sub + '</div>' +
        '</div>';
}

// ==================== KPI DETAIL (Monitoramento) ====================
let _activeMonKpiKey = null;

function monToggleKpiDetail(key) {
    if (_activeMonKpiKey === key) { monCloseKpiDetail(); return; }
    monCloseKpiDetail();
    _activeMonKpiKey = key;
    document.querySelectorAll('#mon-kpis .kpi-card').forEach(el => el.classList.toggle('active', el.dataset.key === key));
    monRenderKpiDetail(key);
}

function monCloseKpiDetail() {
    _activeMonKpiKey = null;
    document.querySelectorAll('#mon-kpis .kpi-card').forEach(el => el.classList.remove('active'));
    const ov = document.getElementById('sdOverlay-mon'); if (ov) ov.remove();
    const ct = document.getElementById('sdContainer-mon'); if (ct) ct.remove();
}

function monRenderKpiDetail(key) {
    const p = _monDados;
    if (!p || !p.linhas) return;

    let title = '', icon = '', color = '', itemsHtml = '';

    // Helper to create a simple sparkline with Unicode blocks
    function sparkline(values, maxVal, minVal) {
        if (!values || values.length === 0) return '—';
        const normalized = values.map(v => v != null ? v : 0);
        const range = (maxVal || Math.max(...normalized)) - (minVal || 0) || 1;
        const steps = 8; // 8 block levels
        let result = '';
        for (const v of normalized) {
            const norm = ((v - (minVal || 0)) / range) * steps;
            const level = Math.max(0, Math.min(steps, Math.round(norm)));
            const fullBlocks = '▁▂▃▄▅▆▇█';
            const ch = fullBlocks.slice(level - 1, level)[0];
            result += ch;
        }
        return result;
    }

    // Helper to create failure summary
    function failureSummary(items, label) {
        const fails = items.filter(i => i.ok === false || i.estado === 'SEM_RESPOSTA' || i.falhasConsecutivas > 0);
        if (!fails.length) return '<div class="stat-detail-item"><div style="font-size:10px;color:var(--green);">✓ Nenhuma falha registrada</div></div>';
        return '<div class="stat-detail-item"><div style="font-size:10px;color:var(--red);">✗ ' + fails.length + ' falha(s) — ' + label + '</div></div>';
    }

    if (key === 'mon-kpi-total') {
        title = 'Todos os Equipamentos Monitorados'; icon = 'fa-desktop'; color = 'cyan';
        itemsHtml = p.linhas.map(l => '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--cyan-bg);color:var(--cyan);"><i class="fas fa-desktop"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + esc(l.nome || l.ip) + '</div><div class="stat-detail-item-sub">' + esc(l.ip) + ' | Setor: ' + esc(l.setor || '-') + ' | Estado: ' + monEstadoBadge(l.estado) + ' | Lat: ' + (l.latenciaMediaMs != null ? Math.round(l.latenciaMediaMs) + 'ms' : '—') + '</div><div class="stat-detail-item-badge">' + monEstadoBadge(l.estado) + '</div></div>').join('');
        itemsHtml += failureSummary(p.linhas, 'Total: ' + p.resumo.totalAlvos + ' equipamentos');
    } else if (key === 'mon-kpi-acessiveis') {
        title = 'Equipamentos Acessiveis'; icon = 'fa-circle-check'; color = 'green';
        const list = p.linhas.filter(l => l.estado === 'ACESSIVEL');
        itemsHtml = list.map(l => '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--green-bg);color:var(--green);"><i class="fas fa-circle-check"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + esc(l.nome || l.ip) + '</div><div class="stat-detail-item-sub">' + esc(l.ip) + ' | Setor: ' + esc(l.setor || '-') + ' | Lat: ' + (l.latenciaMediaMs != null ? Math.round(l.latenciaMediaMs) + 'ms' : '—') + '</div><div class="stat-detail-item-badge ' + (l.estado === 'ACESSIVEL' ? 'badge-ativo' : '') + '">' + esc(l.estado) + '</div></div>').join('');
        itemsHtml += '<div class="stat-detail-item" style="padding:8px;border-top:1px solid var(--divider);"><div style="font-size:10px;color:var(--text-muted)">Total acessiveis: ' + list.length + ' de ' + p.resumo.totalAlvos + '</div></div>';
    } else if (key === 'mon-kpi-semresposta') {
        title = 'Equipamentos Sem Resposta'; icon = 'fa-circle-xmark'; color = 'red';
        const list = p.linhas.filter(l => l.estado === 'SEM_RESPOSTA');
        itemsHtml = list.map(l => '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--red-bg);color:var(--red);"><i class="fas fa-circle-xmark"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + esc(l.nome || l.ip) + '</div><div class="stat-detail-item-sub">' + esc(l.ip) + ' | Setor: ' + esc(l.setor || '-') + ' | Falhas consec.: ' + (l.falhasConsecutivas || 0) + '</div><div class="stat-detail-item-badge">' + esc(l.estado) + '</div></div>').join('');
    } else if (key === 'mon-kpi-instaveis') {
        title = 'Equipamentos Instaveis'; icon = 'fa-wave-square'; color = 'yellow';
        const list = p.linhas.filter(l => l.estado === 'INSTAVEL' || (l.falhasConsecutivas > 0 && l.falhasConsecutivas < 3));
        itemsHtml = list.map(l => '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--yellow-bg);color:var(--yellow);"><i class="fas fa-wave-square"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + esc(l.nome || l.ip) + '</div><div class="stat-detail-item-sub">' + esc(l.ip) + ' | Setor: ' + esc(l.setor || '-') + ' | Transicoes: ' + (l.transicoes || 0) + '</div><div class="stat-detail-item-badge">' + esc(l.estado) + '</div></div>').join('');
    } else if (key === 'mon-kpi-alertas') {
        title = 'Alertas Ativos'; icon = 'fa-triangle-exclamation'; color = 'orange';
        const alertas = p.alertas || [];
        itemsHtml = alertas.map(a => {
            const gravClass = { CRITICA: 'cancelada', ALTA: 'cancelada', MEDIA: 'pendente', BAIXA: 'pendente', INFO: 'inativo' }[a.gravidade] || 'inativo';
            return '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--orange-bg);color:var(--orange);"><i class="fas fa-triangle-exclamation"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + esc(a.titulo) + '</div><div class="stat-detail-item-sub">Host: ' + esc(a.host) + ' | Categoria: ' + esc(a.categoria) + ' | Gravidade: ' + esc(a.gravidade) + ' | Confianca: ' + esc(a.confianca) + ' | ' + a.ocorrencias + 'x</div></div><div class="stat-detail-item-badge"><span class="badge badge-' + gravClass + '">' + esc(a.gravidade) + '</span></div></div>';
        }).join('');
        itemsHtml += '<div class="stat-detail-item" style="padding:8px;border-top:1px solid var(--divider);"><div style="font-size:10px;color:var(--text-muted)">Total alertas: ' + alertas.length + '</div></div>';
    } else if (key === 'mon-kpi-incidentes') {
        title = 'Incidentes por Setor'; icon = 'fa-share-nodes'; color = 'purple';
        const incs = p.incidentes || [];
        itemsHtml = incs.map(inc => {
            return '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--purple-bg);color:var(--purple);"><i class="fas fa-share-nodes"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + esc(inc.titulo) + '</div><div class="stat-detail-item-sub">' + inc.afetados + ' de ' + inc.total + ' equipamentos | Setor: ' + esc(inc.setor) + ' | Confianca: ' + esc(inc.confianca || '') + '</div></div><div class="stat-detail-item-badge"><span class="badge badge-cancelada">' + esc(inc.confianca || '') + '</span></div></div>';
        }).join('');
    } else if (key === 'mon-kpi-semdados') {
        title = 'Equipamentos Sem Dados'; icon = 'fa-circle-question'; color = 'magenta';
        const list = p.linhas.filter(l => l.estado === 'SEM_DADOS');
        itemsHtml = list.map(l => '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--magenta-bg);color:var(--magenta);"><i class="fas fa-circle-question"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + esc(l.nome || l.ip) + '</div><div class="stat-detail-item-sub">' + esc(l.ip) + ' | Setor: ' + esc(l.setor || '-') + ' | Motivo: ' + (l.motivoDados || 'Sem medições recentes') + '</div><div class="stat-detail-item-badge">' + esc(l.estado) + '</div></div>').join('');
    } else if (key === 'mon-kpi-coletor') {
        title = 'Status do Coletor'; icon = 'fa-clock'; color = 'cyan';
        const s = p.servico || {};
        const ue = s.ultimaExecucao || {};
        const est = s.estatisticas || {};
        itemsHtml =
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--cyan-bg);color:var(--cyan);"><i class="fas fa-info-circle"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Status</div><div class="stat-detail-item-sub">' + (s.rodando ? '<span class="badge badge-ativo">Ativo</span>' : '<span class="badge badge-cancelada">Parado</span>') + '</div></div></div>' +
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--cyan-bg);color:var(--cyan);"><i class="fas fa-clock"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Intervalo</div><div class="stat-detail-item-sub">' + (s.intervaloSegundos || 60) + 's entre ciclos' + '</div></div></div>' +
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--cyan-bg);color:var(--cyan);"><i class="fas fa-history"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Ultima execucao</div><div class="stat-detail-item-sub">' + (ue.quando ? new Date(ue.quando).toLocaleString('pt-BR') : 'Nunca') + '</div></div></div>' +
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--cyan-bg);color:var(--cyan);"><i class="fas fa-database"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Medicoes total</div><div class="stat-detail-item-sub">' + (est.medicoes || 0) + '</div></div></div>' +
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--cyan-bg);color:var(--cyan);"><i class="fas fa-error"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Erros</div><div class="stat-detail-item-sub">' + (est.erros || 0) + '</div></div></div>';
        itemsHtml += '<div class="stat-detail-item" style="padding:8px;border-top:1px solid var(--divider);"><div style="font-size:10px;color:var(--text-muted)">Zabbix: ' + (s.zabbixHabilitado ? '<span class="badge badge-ativo">Sim</span>' : '<span class="badge badge-inativo">Não</span>') + '</div></div>';
    } else if (key === 'mon-kpi-disco') {
        title = 'Discos do PC Local'; icon = 'fa-hard-drive'; color = 'green';
        const arm = _monArmKPIs || {};
        const discos = arm.discos || [];
        itemsHtml = discos.map(d => {
            const pct = d.usoPct || 0;
            const cor = pct > 90 ? 'red' : pct > 70 ? 'yellow' : 'green';
            return '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--' + cor + '-bg);color:var(--' + cor + ');"><i class="fas fa-hard-drive"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Disco ' + esc(d.letra) + '</div><div class="stat-detail-item-sub">Usado: ' + d.usadoGb + ' GB | Livre: ' + d.livreGb + ' GB | Total: ' + d.totalGb + ' GB</div></div><div class="stat-detail-item-badge"><span class="badge badge-' + (pct > 90 ? 'cancelada' : pct > 70 ? 'pendente' : 'ativo') + '">' + pct + '%</span></div></div>';
        }).join('');
        itemsHtml += failureSummary(discos, 'Disco local');
    } else if (key === 'mon-kpi-mock-cpu' || key === 'mon-kpi-mock-ram' || key === 'mon-kpi-mock-disco') {
        title = 'Metricas Internas (CPU/RAM)'; icon = 'fa-microchip'; color = 'muted';
        itemsHtml = '<div class="stat-detail-empty"><i class="fas fa-info-circle"></i> Uso de RAM/CPU: indisponivel - monitoramento interno do Windows nao disponivel (sem agente).</div>';
    } else if (key === 'mon-kpi-medicoes') {
        title = 'Medicoes Armazenadas'; icon = 'fa-database'; color = 'purple';
        const arm = _monArmKPIs || {};
        const dm = arm || {};
        const ret = arm.retencao || {};
        itemsHtml =
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--purple-bg);color:var(--purple);"><i class="fas fa-info-circle"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Total de medicoes</div><div class="stat-detail-item-sub">' + (dm.totalMedicoes || 0) + '</div></div></div>' +
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--purple-bg);color:var(--purple);"><i class="fas fa-calendar"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Medicoes hoje</div><div class="stat-detail-item-sub">' + (dm.medicoesHoje || 0) + '</div></div></div>' +
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--purple-bg);color:var(--purple);"><i class="fas fa-calendar"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Dias com dados</div><div class="stat-detail-item-sub">' + (dm.diasComDados || 0) + '</div></div></div>' +
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--purple-bg);color:var(--purple);"><i class="fas fa-archive"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Espaco total</div><div class="stat-detail-item-sub">' + (dm.tamanhoTotalMB || 0) + ' MB</div></div></div>' +
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--purple-bg);color:var(--purple);"><i class="fas fa-file-lines"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Ultima medicao</div><div class="stat-detail-item-sub">' + (dm.ultimaMedicao ? new Date(dm.ultimaMedicao).toLocaleString('pt-BR') : '—') + '</div></div></div>';
        // Arquivos por dia - grafico simples
        if (dm.arquivos && dm.arquivos.length) {
            itemsHtml += '<div class="stat-detail-item" style="padding-top:8px;border-top:1px solid var(--divider);"><div style="font-size:10px;color:var(--text-muted);font-weight:700">Arquivos por dia (ultima semana):</div>';
            // Contar medicoes por dia para "grafico"
            const diaCount = {};
            for (const arq of dm.arquivos) {
                diaCount[arq.dia] = (diaCount[arq.dia] || 0) + arq.medicoes;
            }
            const diasOrdenados = Object.keys(diaCount).sort((a, b) => new Date(a) - new Date(b)).slice(-7).reverse();
            for (const dia of diasOrdenados) {
                const qtd = diaCount[dia];
                const barra = '▇'.repeat(Math.min(Math.round(qtd / 5), 20)); // simples bar
                itemsHtml += '<div style="font-size:10px;margin:2px 0;">' + dia + ': ' + qtd + ' med ' + barra + '</div>';
            }
        }
        itemsHtml += failureSummary(Object.values(dm), 'Medicoes');
    }

    if (!itemsHtml) itemsHtml = '<div class="stat-detail-empty"><i class="fas fa-inbox"></i> Nenhum item encontrado</div>';
    itemsHtml += monKpiChartBlock(key);
    const count = (itemsHtml.match(/class="stat-detail-item"/g) || []).length;

    const ov = document.createElement('div'); ov.id = 'sdOverlay-mon'; ov.className = 'sd-overlay';
    const ct = document.createElement('div'); ct.id = 'sdContainer-mon'; ct.className = 'sd-container';
    ct.innerHTML = '<div class="stat-detail-header"><h4><i class="fas ' + icon + '" style="color:var(--' + color + ');"></i> ' + title + ' <span style="font-weight:400;font-size:11px;color:var(--text-muted);">(' + count + ' itens)</span></h4><button class="stat-detail-close" onclick="monCloseKpiDetail()"><i class="fas fa-times"></i> Fechar</button></div><div class="stat-detail-body">' + itemsHtml + '</div>';
    document.body.appendChild(ov); document.body.appendChild(ct);
}

function monKpiDetailItem(l, icon, color) {
    const estadoBadge = monEstadoBadge(l.estado);
    const lat = l.latenciaMediaMs != null ? Math.round(l.latenciaMediaMs) + 'ms' : '—';
    return '<div class="stat-detail-item" onclick="monVerDetalhe(\'' + esc(l.ip) + '\')">' +
        '<div class="stat-detail-item-icon" style="background:var(--' + color + '-bg);color:var(--' + color + ');"><i class="fas ' + icon + '"></i></div>' +
        '<div class="stat-detail-item-info"><div class="stat-detail-item-name">' + esc(l.nome || l.ip) + '</div>' +
        '<div class="stat-detail-item-sub">' + esc(l.ip) + ' | ' + esc(l.setor || '-') + ' | Lat: ' + lat + '</div></div>' +
        '<div class="stat-detail-item-badge">' + estadoBadge + '</div></div>';
}

function monKpiInfoItem(label, valor) {
    return '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--cyan-bg);color:var(--cyan);"><i class="fas fa-info-circle"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + label + '</div><div class="stat-detail-item-sub">' + valor + '</div></div></div>';
}

// ==================== RENDER: FILTRO SETORES ====================
function monRenderFiltroSetores(p) {
    const sel = document.getElementById('mon-filtro-setor');
    if (!sel || !p || !p.linhas) return;
    const setores = [...new Set(p.linhas.map(l => l.setor).filter(Boolean))].sort();
    const atual = sel.value;
    sel.innerHTML = '<option value="">Todos os Setores</option>' +
        setores.map(s => '<option value="' + esc(s) + '"' + (s === atual ? ' selected' : '') + '>' + esc(s) + '</option>').join('');
    sel.onchange = function() { _monFiltroSetor = this.value; monRenderTabela(_monDados); };
}

// ==================== RENDER: TABELA ====================
function monRenderTabela(p) {
    const tbody = document.querySelector('#monTable tbody');
    if (!tbody) return;
    if (!p || !p.linhas || !p.linhas.length) {
        tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:30px;color:var(--text-muted);">' +
            '<i class="fas fa-satellite-dish" style="font-size:28px;display:block;margin-bottom:10px;opacity:0.3;"></i>' +
            'Nenhum IP cadastrado para monitorar.<br>' +
            '<span style="font-size:11px;">Cadastre o campo <b>ipAddress</b> nos computadores do inventario ou defina <b>monitor/data/targets.json</b>.</span>' +
            '</td></tr>';
        return;
    }

    // Filtros
    let linhas = p.linhas;
    if (_monFiltroEstado) linhas = linhas.filter(l => l.estado === _monFiltroEstado);
    if (_monFiltroSetor) linhas = linhas.filter(l => l.setor === _monFiltroSetor);
    if (_monBusca) {
        const b = _monBusca.toLowerCase();
        linhas = linhas.filter(l =>
            (l.nome || '').toLowerCase().includes(b) ||
            (l.ip || '').toLowerCase().includes(b) ||
            (l.setor || '').toLowerCase().includes(b)
        );
    }

    tbody.innerHTML = linhas.map(function(l) {
        const estadoBadge = monEstadoBadge(l.estado);
        const zbx = l.zabbix || {};
        const perda = (zbx.perdaPct != null) ? zbx.perdaPct.toFixed(1) + '% perda' : '';
        const lat = l.latenciaMediaMs != null ? Math.round(l.latenciaMediaMs) + 'ms' + (perda ? ' <span style="font-size:9px;color:var(--text-muted);">(' + perda + ')</span>' : '') : '<span style="color:var(--text-muted);">—</span>';
        const falhas = l.falhasConsecutivas > 0 ?
            '<span class="badge badge-cancelada">' + l.falhasConsecutivas + '</span>' :
            '<span style="color:var(--green);">0</span>';
        const alertas = l.alertasAtivos > 0 ?
            '<span class="badge badge-cancelada">' + l.alertasAtivos + '</span>' :
            '<span style="color:var(--text-muted);">—</span>';
        // Detecta se o valor vem do Zabbix (string contendo "(Zabbix)") ou e local
        function _fonteMetrica(val) {
            if (!val || val === 'INDISPONIVEL' || val === 'INDISP.') return null;
            return String(val).indexOf('(Zabbix)') >= 0 ? 'ZABBIX' : 'LOCAL';
        }
        function _cellMetrica(val, titulo) {
            const fonte = _fonteMetrica(val);
            if (!fonte) return '<span style="color:var(--text-muted);font-size:10px;" title="Sem agente instalado neste PC remoto">' + esc(titulo || 'INDISP.') + '</span>';
            const corFonte = fonte === 'ZABBIX' ? 'var(--purple)' : 'var(--green)';
            const texto = String(val).replace(/\s*\(Zabbix\)\s*/g, '').trim();
            return '<span style="color:var(--cyan);font-weight:600;">' + esc(texto) + '</span><br><span style="font-size:9px;color:' + corFonte + ';">' + fonte + '</span>';
        }
        const cpuCell = _cellMetrica(l.cpu, 'INDISP.');
        const gpuCell = _cellMetrica(l.gpu, 'INDISP.');
        const ramCell = _cellMetrica(l.ram, 'INDISP.');
        const discoCell = _cellMetrica(l.disco, 'INDISP.');
        return '<tr>' +
            '<td><b style="color:var(--text-primary);">' + esc(l.nome || '-') + '</b><br><span style="font-size:11px;color:var(--text-muted);font-family:monospace;">' + esc(l.ip) + '</span></td>' +
            '<td style="font-size:11px;">' + esc(l.setor || '-') + '</td>' +
            '<td>' + estadoBadge + '</td>' +
            '<td>' + lat + '</td>' +
            '<td>' + falhas + '</td>' +
            '<td>' + cpuCell + '</td>' +
            '<td>' + gpuCell + '</td>' +
            '<td>' + ramCell + '</td>' +
            '<td>' + discoCell + '</td>' +
            '<td>' + alertas + '</td>' +
            '<td><span style="font-size:10px;color:var(--cyan);">' + esc(l.fonte || '-') + '</span></td>' +
            '<td><button class="action-btn action-btn-edit" onclick="monVerDetalhe(\'' + esc(l.ip) + '\')" title="Detalhes"><i class="fas fa-chart-line"></i></button></td>' +
            '</tr>';
    }).join('');

    const stamp = document.getElementById('mon-atualizado-em');
    if (stamp && p.servico && p.servico.ultimaExecucao) {
        stamp.textContent = 'Ultima coleta: ' + new Date(p.servico.ultimaExecucao.quando).toLocaleString('pt-BR');
    }
}

function monEstadoBadge(estado) {
    switch (estado) {
        case 'ACESSIVEL': return '<span class="badge badge-ativo">Acessivel</span>';
        case 'SEM_RESPOSTA': return '<span class="badge badge-cancelada">Sem Resposta</span>';
        case 'INSTAVEL': return '<span class="badge badge-pendente">Instavel</span>';
        case 'SEM_DADOS': return '<span class="badge badge-inativo">Sem Dados</span>';
        default: return '<span class="badge badge-desconhecido">' + esc(estado || '?') + '</span>';
    }
}

// ==================== RENDER: ALERTAS ====================
function monRenderAlertas(p) {
    const el = document.getElementById('mon-alertas-list');
    if (!el) return;
    if (!p || !p.alertas || !p.alertas.length) {
        el.innerHTML = '<p style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px;">Nenhum alerta ativo</p>';
        return;
    }
    el.innerHTML = p.alertas.map(function(a) {
        const gravClass = { CRITICA: 'cancelada', ALTA: 'cancelada', MEDIA: 'pendente', BAIXA: 'pendente', INFO: 'inativo' }[a.gravidade] || 'inativo';
        const confBadge = { CONFIRMADO: 'badge-ativo', ALTA: 'badge-ativo', MODERADA: 'badge-pendente', BAIXA: 'badge-inativo', INCONCLUSIVO: 'badge-inativo' }[a.confianca] || 'badge-inativo';
        return '<div style="display:flex;align-items:flex-start;gap:12px;padding:12px;border-bottom:1px solid var(--border);">' +
            '<span class="badge badge-' + gravClass + '" style="margin-top:2px;">' + a.gravidade + '</span>' +
            '<div style="flex:1;min-width:0;">' +
            '<b style="font-size:12px;color:var(--text-primary);">' + esc(a.titulo) + '</b>' +
            '<p style="font-size:11px;color:var(--text-muted);margin:3px 0 0;">Host: <code>' + esc(a.host) + '</code> | Categoria: ' + esc(a.categoria) + ' | Ocorrencias: ' + a.ocorrencias + '</p>' +
            '<p style="font-size:11px;color:var(--text-secondary);margin:4px 0 0;">' + (a.evidencias || []).map(e => '• ' + esc(e)).join('<br>') + '</p>' +
            (a.recomendacao ? '<p style="font-size:11px;color:var(--cyan);margin:4px 0 0;"><i class="fas fa-lightbulb"></i> ' + esc(a.recomendacao) + '</p>' : '') +
            '</div>' +
            '<span class="badge ' + confBadge + '" style="margin-top:2px;" title="Confianca do diagnostico">' + a.confianca + '</span>' +
            '</div>';
    }).join('');

    // Badge no sidebar
    const badge = document.getElementById('nav-monitor-alerts');
    if (badge) {
        if (p.alertas.length) {
            badge.textContent = p.alertas.length;
            badge.style.display = '';
        } else {
            badge.style.display = 'none';
        }
    }
}

function monRenderAlertasZabbix() {
    const el = document.getElementById('mon-zabbix-alertas');
    if (!el) return;
    const lista = _monAlertasZabbix || [];
    if (!lista.length) {
        el.innerHTML = '<p style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px;">Nenhuma notificacao recebida</p>';
        return;
    }
    el.innerHTML = lista.map(function(a) {
        const cor = a.status === 'PROBLEM' ? 'var(--red)' : 'var(--green)';
        const icone = a.status === 'PROBLEM' ? 'fa-triangle-exclamation' : 'fa-check-circle';
        return '<div style="display:flex;align-items:flex-start;gap:12px;padding:10px;border-bottom:1px solid var(--border);">' +
            '<i class="fas ' + icone + '" style="color:' + cor + ';margin-top:2px;"></i>' +
            '<div style="flex:1;min-width:0;">' +
            '<b style="font-size:12px;color:var(--text-primary);">' + esc(a.trigger || '') + '</b>' +
            '<p style="font-size:11px;color:var(--text-muted);margin:2px 0 0;">Host: <code>' + esc(a.host || '') + '</code> | Severidade: ' + esc(a.severidade || '') + ' | ' + esc(a.hora || a.recebidoEm || '') + '</p>' +
            (a.mensagem ? '<p style="font-size:11px;color:var(--text-secondary);margin:4px 0 0;">' + esc(a.mensagem).slice(0, 200) + '</p>' : '') +
            '</div>' +
            '<span class="badge ' + (a.status === 'PROBLEM' ? 'badge-cancelada' : 'badge-ativo') + '">' + esc(a.status) + '</span>' +
            '</div>';
    }).join('');
}

function monLimparAlertasZabbix() {
    _monAlertasZabbix = [];
    monRenderAlertasZabbix();
}

// ==================== RENDER: INCIDENTES ====================
function monRenderIncidentes(p) {
    const el = document.getElementById('mon-incidentes');
    if (!el) return;
    if (!p || !p.incidentes || !p.incidentes.length) { el.innerHTML = ''; return; }
    el.innerHTML = p.incidentes.map(function(inc) {
        return '<div class="glass-panel" style="border-left:3px solid var(--red);margin-bottom:8px;">' +
            '<div style="padding:14px 18px;display:flex;align-items:center;gap:12px;">' +
            '<i class="fas fa-share-nodes" style="color:var(--red);font-size:16px;"></i>' +
            '<div><b style="font-size:13px;color:var(--text-primary);">' + esc(inc.titulo) + '</b>' +
            '<p style="font-size:11px;color:var(--text-muted);margin:2px 0 0;">' +
            inc.afetados + ' de ' + inc.total + ' equipamentos afetados | Confianca: ' + inc.confianca + '</p>' +
            '<p style="font-size:11px;color:var(--text-secondary);margin:2px 0 0;">Hosts: ' + inc.hosts.map(h => '<code>' + esc(h) + '</code>').join(', ') + '</p>' +
            '</div></div></div>';
    }).join('');
}

// ==================== RENDER: INDISPONIVEIS ====================
function monRenderIndisponiveis(p) {
    const el = document.getElementById('mon-indisponiveis');
    if (!el) return;
    const lista = (p && p.indisponiveis) || [
        'Uso de RAM/CPU em PCs REMOTOS: indisponivel (sem agente instalado no PC destino)',
        'Reinicio de PCs remotos: indisponivel (requer WEF/agent)',
        'Porta do switch: indisponivel (requer SNMP nos switches)',
        'Qualidade Wi-Fi: indisponivel (requer controlador Wi-Fi)',
        'Registros DHCP/DNS: indisponivel (requer acesso aos servidores)'
    ];
    el.innerHTML = lista.map(function(item) {
        return '<div><i class="fas fa-ban" style="color:var(--red);width:16px;"></i> ' + esc(item) + '</div>';
    }).join('') +
    '<p style="margin-top:10px;font-size:11px;color:var(--green);"><i class="fas fa-check-circle"></i> No PC LOCAL (este servidor) CPU/RAM/disco/uptime sao REAIS e coletados por SO — veja o painel "PC Local" no topo.</p>' +
    '<p style="margin-top:4px;font-size:11px;color:var(--yellow);"><i class="fas fa-info-circle"></i> Para PCs remotos completos, instale o Zabbix Agent 2.</p>';
}

// ==================== RENDER: HOSTS ZABBIX ====================
async function monRenderZabbixHosts() {
    const el = document.getElementById('mon-zabbix-hosts');
    if (!el) return;
    try {
        const z = await fetch('/api/zabbix/hosts').then(r => r.json()).catch(() => null);
        const hosts = Array.isArray(z) ? z : (z && z.hosts) || [];
        if (!hosts.length) {
            el.innerHTML = '<p style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px;">' +
                (z && z.erro ? 'Zabbix: ' + esc(z.erro) : 'Nenhum host cadastrado no Zabbix.') + '</p>';
            return;
        }
        el.innerHTML = '<div style="overflow-x:auto;"><table class="data-table" style="font-size:11px;"><thead><tr>' +
            '<th>Hostname</th><th>Nome</th><th>IP</th><th>Status Agente</th><th>Templates</th><th>Erro</th>' +
            '</tr></thead><tbody>' +
            hosts.map(h => {
                const iface = (h.interfaces || [])[0] || {};
                const avail = iface.available; // '0'=unknown, '1'=available, '2'=unavailable
                let statusBadge, statusCor;
                if (avail === '1') { statusBadge = '<span class="badge badge-ativo">Conectado</span>'; }
                else if (avail === '2') { statusBadge = '<span class="badge badge-cancelada">Sem Agente</span>'; }
                else { statusBadge = '<span class="badge badge-pendente">Aguardando</span>'; }
                const templates = (h.parentTemplates || []).map(t => t.name).join(', ');
                return '<tr>' +
                    '<td><code>' + esc(h.host) + '</code></td>' +
                    '<td>' + esc(h.name || '-') + '</td>' +
                    '<td><code>' + esc(iface.ip || '-') + '</code></td>' +
                    '<td>' + statusBadge + '</td>' +
                    '<td style="font-size:10px;">' + esc(templates) + '</td>' +
                    '<td style="font-size:10px;color:var(--text-muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="' + esc(iface.error || '') + '">' + esc((iface.error || '—').substring(0, 60)) + '</td>' +
                    '</tr>';
            }).join('') +
            '</tbody></table></div>';
    } catch (e) {
        el.innerHTML = '<p style="color:var(--red);font-size:12px;text-align:center;padding:20px;">Erro ao listar hosts Zabbix</p>';
    }
}

async function monSyncZabbix() {
    try {
        const btn = document.querySelector('#mon-zabbix-hosts') && document.querySelector('.glass-panel-header .btn-ghost');
        const r = await fetch('/api/zabbix/sincronizar', { method: 'POST' }).then(r => r.json());
        if (r.ok) {
            if (typeof showToast === 'function') showToast('Sincronizado: ' + (r.criados || 0) + ' hosts criados, ' + (r.atualizados || 0) + ' atualizados.', 'success');
            monRenderZabbixHosts();
        } else {
            if (typeof showToast === 'function') showToast('Erro: ' + (r.erro || 'desconhecido'), 'error');
        }
    } catch (e) {
        if (typeof showToast === 'function') showToast('Erro ao sincronizar: ' + e.message, 'error');
    }
}

// ==================== ARMAZENAMENTO ====================
async function monAtualizarArmazenamento() {
    try {
        const dados = await fetch('/api/monitor/armazenamento').then(r => r.json()).catch(() => null);
        monRenderArmazenamento(dados);
    } catch (e) {
        const el = document.getElementById('mon-armazenamento');
        if (el) el.innerHTML = '<p style="color:var(--red);font-size:12px;text-align:center;padding:20px;">Erro ao carregar armazenamento: ' + esc(e.message) + '</p>';
    }
}

function monRenderArmazenamento(d) {
    const el = document.getElementById('mon-armazenamento');
    if (!el) return;
    if (!d || d.error) {
        el.innerHTML = '<p style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px;">' + esc(d && d.error ? d.error : 'Indisponivel') + '</p>';
        return;
    }

    let html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;">';

    // --- DISCOS DO PC LOCAL ---
    html += '<div>';
    html += '<h4 style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin:0 0 10px;"><i class="fas fa-hard-drive" style="color:var(--cyan);"></i> Discos do PC Local</h4>';
    if (d.discos && d.discos.length) {
        for (const disco of d.discos) {
            const pct = disco.usoPct || 0;
            const corBarra = pct > 90 ? 'var(--red)' : pct > 70 ? 'var(--yellow)' : 'var(--green)';
            html += '<div style="padding:12px;background:rgba(255,255,255,0.03);border-radius:10px;margin-bottom:8px;border-left:3px solid ' + corBarra + ';">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">';
            html += '<b style="font-size:13px;color:var(--text-primary);"><i class="fas fa-hard-drive" style="color:' + corBarra + ';margin-right:6px;"></i>' + esc(disco.letra || '?') + '</b>';
            html += '<span style="font-size:18px;font-weight:700;color:' + corBarra + ';">' + pct + '%</span>';
            html += '</div>';
            // Barra de progresso
            html += '<div style="width:100%;height:8px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;margin-bottom:6px;">';
            html += '<div style="width:' + Math.min(100, pct) + '%;height:100%;background:' + corBarra + ';border-radius:4px;transition:width 0.5s;"></div>';
            html += '</div>';
            html += '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);">';
            html += '<span>Usado: <b style="color:var(--text-secondary);">' + disco.usadoGb + ' GB</b></span>';
            html += '<span>Livre: <b style="color:var(--text-secondary);">' + disco.livreGb + ' GB</b></span>';
            html += '<span>Total: <b style="color:var(--text-secondary);">' + disco.totalGb + ' GB</b></span>';
            html += '</div>';
            html += '</div>';
        }
    } else {
        html += '<p style="color:var(--text-muted);font-size:12px;padding:12px;">Discos indisponiveis (sem acesso WMI/PowerShell).</p>';
    }
    html += '</div>';

    // --- DADOS DO MONITORAMENTO ---
    const dm = d || {};
    const ret = d.retencao || {};
    html += '<div>';
    html += '<h4 style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin:0 0 10px;"><i class="fas fa-database" style="color:var(--purple);"></i> Dados do Monitoramento</h4>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
    html += monArmItem('fa-database', 'Medicoes Hoje', dm.medicoesHoje != null ? dm.medicoesHoje : '?', (dm.tamanhoHojeBytes ? monFormatBytes(dm.tamanhoHojeBytes) : ''), 'purple');
    html += monArmItem('fa-database', 'Total Medicoes', dm.totalMedicoes != null ? dm.totalMedicoes : '?', (dm.diasComDados != null ? dm.diasComDados : 0) + ' dia(s) de dados', 'purple');
    html += monArmItem('fa-weight-hanging', 'Espaco Total', dm.tamanhoTotalMB != null ? dm.tamanhoTotalMB + ' MB' : '?', 'raw + agregados', 'magenta');
    html += monArmItem('fa-calendar', 'Retencao', (ret.medicoesDias || 30) + ' dias', 'agregados: ' + (ret.agregadosDias || 365) + ' dias', 'cyan');
    html += '</div>';
    // Ultima medicao
    if (dm.ultimaMedicao) {
        html += '<div style="margin-top:10px;padding:10px;background:rgba(255,255,255,0.03);border-radius:8px;font-size:11px;color:var(--text-muted);">';
        html += '<i class="fas fa-clock" style="color:var(--cyan);margin-right:6px;"></i>Ultima medicao: <b style="color:var(--text-secondary);">' + new Date(dm.ultimaMedicao).toLocaleString('pt-BR') + '</b>';
        if (dm.primeiraMedicao) {
            html += ' | Primeira: <b style="color:var(--text-secondary);">' + new Date(dm.primeiraMedicao).toLocaleString('pt-BR') + '</b>';
        }
        html += '</div>';
    }
    // Arquivos por dia
    if (dm.arquivos && dm.arquivos.length) {
        html += '<h4 style="font-size:10px;color:var(--text-muted);text-transform:uppercase;margin:12px 0 6px;">Arquivos por Dia</h4>';
        html += '<div style="max-height:150px;overflow-y:auto;">';
        html += '<table class="data-table" style="font-size:10px;"><thead><tr><th>Dia</th><th>Medicoes</th><th>Tamanho</th></tr></thead><tbody>';
        for (const arq of dm.arquivos.slice().reverse()) {
            html += '<tr><td>' + esc(arq.dia) + '</td><td>' + arq.medicoes + '</td><td>' + monFormatBytes(arq.tamanhoBytes) + '</td></tr>';
        }
        html += '</tbody></table></div>';
    }
    html += '</div>';
    html += '</div>';

    el.innerHTML = html;
}

function monArmItem(icon, label, valor, sub, cor) {
    const corMap = { green: 'var(--green)', yellow: 'var(--yellow)', red: 'var(--red)', cyan: 'var(--cyan)', purple: 'var(--purple)', magenta: 'var(--magenta)', muted: 'var(--text-muted)' };
    const corVal = corMap[cor] || 'var(--text-primary)';
    return '<div style="padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:10px;border-left:3px solid ' + corVal + ';">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">' +
        '<i class="fas ' + icon + '" style="color:' + corVal + ';font-size:11px;"></i>' +
        '<span style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">' + label + '</span>' +
        '</div>' +
        '<div style="font-size:18px;font-weight:700;color:' + corVal + ';">' + valor + '</div>' +
        (sub ? '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">' + sub + '</div>' : '') +
        '</div>';
}

function monFormatBytes(bytes) {
    if (bytes == null) return '?';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
}

// ==================== HISTORICO DE HOST ====================
async function monVerHistorico(ip, dias) {
    try {
        // Sem IP: abre modal de selecao
        if (!ip) {
            const alvos = (_monDados && _monDados.linhas) || [];
            if (!alvos.length) { alert('Nenhum host disponivel para historico.'); return; }
            let selHtml = '<div style="font-size:12px;">';
            selHtml += '<p style="color:var(--text-muted);margin-bottom:12px;">Selecione um host para ver o historico:</p>';
            selHtml += '<select id="mon-hist-host-select" class="form-input" style="width:100%;margin-bottom:12px;">';
            for (const a of alvos) {
                selHtml += '<option value="' + esc(a.ip) + '">' + esc(a.nome) + ' (' + esc(a.ip) + ')</option>';
            }
            selHtml += '</select>';
            selHtml += '<select id="mon-hist-dias-select" class="form-input" style="width:100%;margin-bottom:12px;">';
            selHtml += '<option value="7">Ultimos 7 dias</option><option value="14">Ultimos 14 dias</option><option value="30">Ultimos 30 dias</option>';
            selHtml += '</select>';
            selHtml += '<button onclick="monCarregarHistorico(document.getElementById(\'mon-hist-host-select\').value, document.getElementById(\'mon-hist-dias-select\').value)" class="btn btn-primary" style="width:100%;"><i class="fas fa-chart-line"></i> Ver Historico</button>';
            selHtml += '<div id="mon-hist-conteudo" style="margin-top:16px;"></div>';
            selHtml += '</div>';
            if (typeof openModal === 'function') {
                openModal('Historico de Monitoramento', selHtml, '');
            }
            return;
        }

        // Com IP: carrega direto
        const d = (dias && parseInt(dias, 10)) || 7;
        const dados = await fetch('/api/monitor/historico?host=' + encodeURIComponent(ip) + '&dias=' + d).then(r => r.json()).catch(() => null);
        monRenderHistorico(dados);
    } catch (e) {
        if (typeof showToast === 'function') showToast('Erro ao carregar historico: ' + e.message, 'error');
    }
}

async function monCarregarHistorico(ip, dias) {
    try {
        const conteudo = document.getElementById('mon-hist-conteudo');
        if (conteudo) conteudo.innerHTML = '<p style="text-align:center;color:var(--text-muted);"><i class="fas fa-spinner fa-spin"></i> Carregando...</p>';
        const dados = await fetch('/api/monitor/historico?host=' + encodeURIComponent(ip) + '&dias=' + (dias || 7)).then(r => r.json()).catch(() => null);
        if (conteudo) {
            conteudo.innerHTML = '';
            // Monta HTML do historico e insere
            const tmp = document.createElement('div');
            monRenderHistoricoInner(dados, tmp);
            conteudo.appendChild(tmp);
        }
    } catch (e) {
        const conteudo = document.getElementById('mon-hist-conteudo');
        if (conteudo) conteudo.innerHTML = '<p style="color:var(--red);font-size:12px;">Erro: ' + esc(e.message) + '</p>';
    }
}

function monRenderHistorico(dados) {
    // Para uso em modal standalone
    let html = '<div style="font-size:12px;">';
    html += monHistoricoHtml(dados);
    html += '</div>';
    if (typeof openModal === 'function') {
        openModal('Historico: ' + (dados && dados.host || '?'), html, '');
    }
}

function monRenderHistoricoInner(dados, container) {
    container.innerHTML = monHistoricoHtml(dados);
}

function monHistoricoHtml(dados) {
    if (!dados || (!dados.serie || !dados.serie.length)) {
        return '<p style="color:var(--text-muted);text-align:center;padding:20px;">Sem dados historicos para este host.</p>';
    }
    let html = '<h4 style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin:0 0 10px;">Historico de ' + esc(dados.host) + ' (' + dados.dias + ' dias)</h4>';

    // Tabela resumo
    html += '<table class="data-table" style="font-size:11px;"><thead><tr><th>Dia</th><th>Medicoes</th><th>Sucessos</th><th>Falhas</th><th>Perda</th><th>Lat Media</th><th>Lat Min</th><th>Lat Max</th><th>P95</th></tr></thead><tbody>';
    for (const s of dados.serie) {
        const perdaCor = s.perdaPct > 10 ? 'var(--red)' : s.perdaPct > 0 ? 'var(--yellow)' : 'var(--green)';
        html += '<tr>' +
            '<td>' + s.dia + '</td>' +
            '<td>' + s.totalMedicoes + '</td>' +
            '<td style="color:var(--green);">' + s.sucessos + '</td>' +
            '<td style="color:var(--red);">' + s.falhas + '</td>' +
            '<td style="color:' + perdaCor + ';font-weight:600;">' + s.perdaPct + '%</td>' +
            '<td>' + (s.latenciaMediaMs != null ? s.latenciaMediaMs + 'ms' : '—') + '</td>' +
            '<td>' + (s.latenciaMinMs != null ? s.latenciaMinMs + 'ms' : '—') + '</td>' +
            '<td>' + (s.latenciaMaxMs != null ? s.latenciaMaxMs + 'ms' : '—') + '</td>' +
            '<td>' + (s.latenciaP95Ms != null ? s.latenciaP95Ms + 'ms' : '—') + '</td>' +
            '</tr>';
    }
    html += '</tbody></table>';

    // Grafico de barras de perda por dia (CSS puro)
    if (dados.serie.length > 1) {
        html += '<h4 style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin:16px 0 8px;">Perda de Pacotes por Dia</h4>';
        html += '<div style="display:flex;align-items:flex-end;gap:4px;height:80px;padding:8px;background:rgba(255,255,255,0.02);border-radius:8px;">';
        const maxPerda = Math.max(1, ...dados.serie.map(s => s.perdaPct));
        for (const s of dados.serie) {
            const altura = Math.max(2, (s.perdaPct / maxPerda) * 100);
            const cor = s.perdaPct > 10 ? 'var(--red)' : s.perdaPct > 0 ? 'var(--yellow)' : 'var(--green)';
            html += '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;">';
            html += '<span style="font-size:9px;color:var(--text-muted);">' + s.perdaPct + '%</span>';
            html += '<div style="width:100%;max-width:40px;height:' + altura + '%;background:' + cor + ';border-radius:3px 3px 0 0;min-height:2px;"></div>';
            html += '<span style="font-size:8px;color:var(--text-muted);writing-mode:vertical-rl;transform:rotate(180deg);max-height:50px;overflow:hidden;">' + s.dia.slice(5) + '</span>';
            html += '</div>';
        }
        html += '</div>';
    }

    // Ultimas medicoes brutas
    if (dados.ultimasMedicoes && dados.ultimasMedicoes.length) {
        html += '<h4 style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin:16px 0 8px;">Ultimas ' + dados.ultimasMedicoes.length + ' Medicoes Brutas (hoje)</h4>';
        html += '<div style="max-height:200px;overflow-y:auto;">';
        html += '<table class="data-table" style="font-size:10px;"><thead><tr><th>Horario</th><th>OK</th><th>Latencia</th><th>Perda</th><th>Metodo</th></tr></thead><tbody>';
        for (const m of dados.ultimasMedicoes.slice().reverse()) {
            const okBadge = m.ok ? '<span style="color:var(--green);">✓</span>' : '<span style="color:var(--red);">✗</span>';
            html += '<tr><td>' + (m.timestamp ? new Date(m.timestamp).toLocaleTimeString('pt-BR') : '?') + '</td>' +
                '<td>' + okBadge + '</td>' +
                '<td>' + (m.latenciaMediaMs != null ? m.latenciaMediaMs + 'ms' : '—') + '</td>' +
                '<td>' + (m.perdaPct != null ? m.perdaPct + '%' : '—') + '</td>' +
                '<td>' + esc(m.metodo || '?') + '</td></tr>';
        }
        html += '</tbody></table></div>';
    }

    // Graficos cartesianos: latencia + perda (a partir das ultimas medicoes brutas)
    if (dados.ultimasMedicoes && dados.ultimasMedicoes.length > 2) {
        const lats = dados.ultimasMedicoes.map(function(m) {
            return { t: m.timestamp ? new Date(m.timestamp).getTime() : 0, v: m.latenciaMediaMs, ok: m.ok };
        }).filter(function(p) { return p.t > 0; });
        const perdas = dados.ultimasMedicoes.map(function(m) {
            return { t: m.timestamp ? new Date(m.timestamp).getTime() : 0, v: m.perdaPct, ok: m.ok };
        }).filter(function(p) { return p.t > 0; });
        const latHtml = monCartesianChart(lats, { titulo: 'Latencia (ms)', unidade: 'ms', cor: '#2962FF', altura: 220, formatarY: function(v){return Math.round(v);} });
        const perdaHtml = monCartesianChart(perdas, { titulo: 'Perda (%)', unidade: '%', cor: '#FF6D00', altura: 200, minForcado: 0, maxForcado: Math.max(10, ...perdas.map(p=>p.v||0)), formatarY: function(v){return Math.round(v);} });
        _monKpiCharts['hist-lat'] = { titulo: 'Latencia (ms)', html: latHtml };
        _monKpiCharts['hist-perda'] = { titulo: 'Perda (%)', html: perdaHtml };
        html += '<h4 style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin:16px 0 8px;">Latencia ao Longo do Tempo</h4>';
        html += '<div style="display:flex;gap:6px;justify-content:flex-end;margin-bottom:4px;"><button class="btn btn-ghost btn-sm" onclick="monAbrirGrafico(\'Latencia (ms)\', _monKpiCharts[\'hist-lat\'].html)"><i class="fas fa-expand"></i> Expandir</button><button class="btn btn-ghost btn-sm" onclick="monAbrirGraficoNovaAba(\'Latencia (ms)\', _monKpiCharts[\'hist-lat\'].html)"><i class="fas fa-external-link-alt"></i> Nova aba</button></div>';
        html += latHtml;
        html += '<h4 style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin:16px 0 8px;">Perda de Pacotes ao Longo do Tempo</h4>';
        html += '<div style="display:flex;gap:6px;justify-content:flex-end;margin-bottom:4px;"><button class="btn btn-ghost btn-sm" onclick="monAbrirGrafico(\'Perda (%)\', _monKpiCharts[\'hist-perda\'].html)"><i class="fas fa-expand"></i> Expandir</button><button class="btn btn-ghost btn-sm" onclick="monAbrirGraficoNovaAba(\'Perda (%)\', _monKpiCharts[\'hist-perda\'].html)"><i class="fas fa-external-link-alt"></i> Nova aba</button></div>';
        html += perdaHtml;
    }

    return html;
}
async function monVerDetalhe(ip) {
    try {
        const [mon, zbx] = await Promise.all([
            fetch('/api/monitor/host/' + encodeURIComponent(ip)).then(r => r.json()).catch(() => null),
            fetch('/api/zabbix/host/' + encodeURIComponent(ip)).then(r => r.json()).catch(() => null)
        ]);

        let html = '<div style="font-size:12px;">';

        // Estado atual (coletor proprio)
        if (mon && mon.estadoAtual) {
            const st = mon.estadoAtual;
            html += '<div class="glass-panel" style="margin-bottom:12px;"><div class="glass-panel-header"><h3><i class="fas fa-satellite-dish"></i> Coletor Proprio (ICMP)</h3></div><div style="padding:14px;">';
            html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">';
            html += monDetailItem('Estado', st.ultimoResultado === 'ACESSIVEL' ? '<span class="badge badge-ativo">Acessivel</span>' : '<span class="badge badge-cancelada">' + esc(st.ultimoResultado) + '</span>');
            html += monDetailItem('Latencia', st.latenciaMediaMs != null ? st.latenciaMediaMs + 'ms' : 'Indisponivel');
            html += monDetailItem('Falhas consecutivas', st.falhasConsecutivas || 0);
            html += monDetailItem('Desde', st.downSince ? new Date(st.downSince).toLocaleString('pt-BR') : '—');
            html += '</div>';
            // Serie diaria
            if (mon.serieDiaria && mon.serieDiaria.length) {
                html += '<h4 style="font-size:11px;color:var(--text-muted);margin:14px 0 8px;text-transform:uppercase;">Historico (7 dias) <button onclick="monVerHistorico(\'' + esc(ip) + '\', 30)" class="btn btn-ghost btn-sm" style="margin-left:8px;font-size:10px;"><i class="fas fa-chart-line"></i> Ver Completo (30 dias)</button></h4>';
                html += '<table class="data-table" style="font-size:11px;"><thead><tr><th>Dia</th><th>Medicoes</th><th>Perda</th><th>Lat Media</th><th>P95</th></tr></thead><tbody>';
                for (const s of mon.serieDiaria) {
                    html += '<tr><td>' + s.dia + '</td><td>' + s.total + '</td><td>' + s.perdaPct + '%</td><td>' + (s.latenciaMediaMs != null ? s.latenciaMediaMs + 'ms' : '—') + '</td><td>' + (s.latenciaP95Ms != null ? s.latenciaP95Ms + 'ms' : '—') + '</td></tr>';
                }
                html += '</tbody></table>';
            } else {
                html += '<p style="margin:12px 0;"><button onclick="monVerHistorico(\'' + esc(ip) + '\', 7)" class="btn btn-ghost btn-sm"><i class="fas fa-chart-line"></i> Ver Historico</button></p>';
            }
            html += '</div></div>';
        }

        // Metricas locais REAIS (se este IP e o PC onde roda o servidor)
        if (mon && mon.metricasLocais) {
            const ml = mon.metricasLocais;
            const cpu = ml.cpu || {};
            const mem = ml.memoria || {};
            const up = ml.uptime || {};
            const gpuInfo = ml.gpu || {};
            const disco = (ml.disco && ml.disco.discos) ? ml.disco.discos : [];
            const rede = (ml.rede || [])[0] || {};
            const info = ml.info || {};
            html += '<div class="glass-panel" style="margin-bottom:12px;border-left:3px solid var(--green);"><div class="glass-panel-header"><h3><i class="fas fa-microchip"></i> Metricas REAIS deste PC (' + esc(ml.hostname || '?') + ')</h3></div><div style="padding:14px;">';
            html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;">';
            html += monDetailItem('CPU', cpu.usoPct != null ? '<span style="color:var(--cyan);">' + cpu.usoPct + '%</span> <span style="font-size:10px;color:var(--text-muted);">(' + cpu.nucleos + ' nucleos)</span>' : 'Aguardando 2a amostra');
            // GPU
            if (gpuInfo.gpus && gpuInfo.gpus.length) {
                const g0 = gpuInfo.gpus[0];
                html += monDetailItem('GPU', g0.usoPct != null ? '<span style="color:var(--cyan);">' + g0.usoPct + '%</span> <span style="font-size:10px;color:var(--text-muted);">' + esc(g0.nome || '') + '</span>' : esc(g0.nome || '?'));
                if (g0.memoriaTotalMb) html += monDetailItem('GPU Memoria', g0.memoriaUsadaMb + '/' + g0.memoriaTotalMb + ' MB');
                if (g0.temperaturaC) html += monDetailItem('GPU Temp', g0.temperaturaC + '°C');
            } else {
                html += monDetailItem('GPU', '<span style="color:var(--text-muted);">' + esc(gpuInfo.indisponivel || 'Indisponivel') + '</span>');
            }
            html += monDetailItem('RAM', mem.usoPct != null ? '<span style="color:var(--cyan);">' + mem.usoPct + '%</span> <span style="font-size:10px;color:var(--text-muted);">(' + mem.usadoGb + '/' + mem.totalGb + ' GB)</span>' : '?');
            // Discos (todos)
            for (const d of disco) {
                html += monDetailItem('Disco ' + d.letra, '<span style="color:var(--cyan);">' + d.usoPct + '%</span> <span style="font-size:10px;color:var(--text-muted);">(' + d.usadoGb + '/' + d.totalGb + ' GB, livre: ' + d.livreGb + ' GB)</span>');
            }
            html += monDetailItem('Uptime', up.uptimeHumano || '?');
            html += monDetailItem('Boot', up.bootTime ? new Date(up.bootTime).toLocaleString('pt-BR') : '?');
            html += monDetailItem('Reinicio detectado', up.reiniciadoDesdeUltimaColeta ? '<span style="color:var(--red);font-weight:700;">SIM</span>' : '<span style="color:var(--green);">Nao</span>');
            html += monDetailItem('IP local', rede.ip || '?');
            html += monDetailItem('Host rede', rede.nome || '?');
            html += monDetailItem('Kernel', info.release || '?');
            html += '</div></div></div>';
        }

        // Zabbix
        if (zbx && zbx.encontrado) {
            html += '<div class="glass-panel" style="margin-bottom:12px;"><div class="glass-panel-header"><h3><i class="fas fa-server"></i> Zabbix (Agente)</h3></div><div style="padding:14px;">';
            const h = zbx.host;
            html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">';
            html += monDetailItem('Hostname Zabbix', esc(h.hostname));
            html += monDetailItem('Disponivel', h.disponivel === null ? 'Desconhecido' : (h.disponivel ? '<span class="badge badge-ativo">Sim</span>' : '<span class="badge badge-cancelada">Nao</span>'));
            // CPU
            const cpu = zbx.metricas && zbx.metricas.cpu;
            if (cpu && cpu.valor) {
                const cpuVal = parseFloat(cpu.valor.valor);
                const cpuStr = isNaN(cpuVal) ? cpu.valor.valor : (Math.round(cpuVal * 10) / 10) + '%';
                html += monDetailItem('CPU', cpuStr + ' <span style="color:var(--text-muted);font-size:10px;">(' + (cpu.valor.nome || '') + ')</span>');
            } else if (cpu && cpu.indisponivel) {
                html += monDetailItem('CPU', '<span style="color:var(--text-muted);">' + esc(cpu.indisponivel) + '</span>');
            }
            // GPU
            const gpu = zbx.metricas && zbx.metricas.gpu;
            if (gpu && gpu.valor) {
                const gpuVal = parseFloat(gpu.valor.valor);
                const gpuStr = isNaN(gpuVal) ? gpu.valor.valor : (Math.round(gpuVal * 10) / 10) + '%';
                html += monDetailItem('GPU', gpuStr + ' <span style="color:var(--text-muted);font-size:10px;">(' + (gpu.valor.nome || '') + ')</span>');
            } else if (gpu && gpu.indisponivel) {
                html += monDetailItem('GPU', '<span style="color:var(--text-muted);">' + esc(gpu.indisponivel) + '</span>');
            }
            // RAM
            const ram = zbx.metricas && zbx.metricas.memoria;
            if (ram && ram.valor) {
                const ramVal = parseFloat(ram.valor.valor);
                const ramStr = isNaN(ramVal) ? ram.valor.valor : (Math.round(ramVal * 10) / 10) + '%';
                html += monDetailItem('RAM', ramStr + ' <span style="color:var(--text-muted);font-size:10px;">(' + (ram.valor.nome || '') + ')</span>');
            } else if (ram && ram.indisponivel) {
                html += monDetailItem('RAM', '<span style="color:var(--text-muted);">' + esc(ram.indisponivel) + '</span>');
            }
            // Uptime
            const uptime = zbx.metricas && zbx.metricas.uptime;
            if (uptime && uptime.valor) {
                const secs = parseInt(uptime.valor.valor);
                if (!isNaN(secs)) {
                    const dias = Math.floor(secs / 86400);
                    const horas = Math.floor((secs % 86400) / 3600);
                    html += monDetailItem('Uptime', dias + 'd ' + horas + 'h <span style="color:var(--text-muted);font-size:10px;">(' + (uptime.valor.nome || '') + ')</span>');
                } else {
                    html += monDetailItem('Uptime', esc(uptime.valor.valor));
                }
            }
            html += '</div>';
            // Triggers
            if (zbx.triggers && zbx.triggers.length) {
                html += '<h4 style="font-size:11px;color:var(--text-muted);margin:14px 0 8px;text-transform:uppercase;">Triggers (' + zbx.triggers.length + ')</h4>';
                for (const t of zbx.triggers.slice(0, 10)) {
                    const isProblem = t.estado === '1';
                    html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">' +
                        '<span class="badge badge-' + (isProblem ? 'cancelada' : 'ativo') + '">' + (isProblem ? 'PROBLEM' : 'OK') + '</span>' +
                        '<span style="font-size:11px;color:var(--text-secondary);">' + esc(t.descricao) + '</span>' +
                        '</div>';
                }
            }
            html += '</div></div>';
        } else if (zbx && !zbx.encontrado) {
            html += '<div class="glass-panel" style="margin-bottom:12px;border-left:3px solid var(--yellow);"><div style="padding:14px;">' +
                '<i class="fas fa-info-circle" style="color:var(--yellow);"></i> ' +
                '<span style="font-size:12px;color:var(--text-secondary);">' + esc(zbx.nota || zbx.erro || 'Host nao encontrado no Zabbix.') + '</span>' +
                '</div></div>';
        }

        // Indisponiveis (apenas metricas realmente indisponiveis — exclui as que o Zabbix fornece)
        const indisps = (mon && mon.indisponiveis) || [];
        // Filtra mensagens stale quando Zabbix fornece a metrica
        const indispsFiltradas = indisps.filter(function(i) {
            const txt = (i || '').toLowerCase();
            if (zbx && zbx.encontrado && zbx.metricas) {
                if (txt.includes('cpu') && zbx.metricas.cpu && zbx.metricas.cpu.valor) return false;
                if (txt.includes('ram') && zbx.metricas.memoria && zbx.metricas.memoria.valor) return false;
                if (txt.includes('memoria') && zbx.metricas.memoria && zbx.metricas.memoria.valor) return false;
            }
            return true;
        });
        if (indispsFiltradas.length > 0) {
            html += '<div class="glass-panel"><div class="glass-panel-header"><h3><i class="fas fa-ban"></i> Dados Indisponiveis</h3></div><div style="padding:14px;font-size:11px;color:var(--text-muted);line-height:2;">';
            for (const i of indispsFiltradas) html += '<div><i class="fas fa-ban" style="color:var(--red);width:14px;"></i> ' + esc(i) + '</div>';
            html += '</div></div>';
        } else if (zbx && zbx.encontrado) {
            html += '<div class="glass-panel" style="border-left:3px solid var(--green);"><div style="padding:14px;font-size:11px;color:var(--green);"><i class="fas fa-check-circle"></i> Todas as metricas disponiveis via Zabbix (CPU, RAM, Disco, Uptime, GPU).</div></div>';
        }

        html += '</div>';

        if (typeof openModal === 'function') {
            openModal('Detalhes: ' + ip, html, '<button class="btn btn-primary btn-sm" onclick="monAbrirRelatorioHost(\'' + esc(ip) + '\')"><i class="fas fa-file-lines"></i> Relatorio completo (nova aba)</button><button class="btn btn-ghost btn-sm" onclick="closeModal()">Fechar</button>');
        } else {
            alert('Modal nao disponivel. IP: ' + ip);
        }
    } catch (e) {
        if (typeof showToast === 'function') showToast('Erro: ' + e.message, 'error');
    }
}

function monDetailItem(label, valor) {
    return '<div style="padding:8px;background:rgba(255,255,255,0.02);border-radius:8px;">' +
        '<div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">' + label + '</div>' +
        '<div style="font-size:13px;color:var(--text-primary);font-weight:600;margin-top:2px;">' + valor + '</div>' +
        '</div>';
}

function monVerZabbix(ip) {
    const cfg = _monZabbix;
    window.open('http://192.168.0.186:8081', '_blank');
}

// ==================== EXPORT CSV ====================
function monExportarCSV() {
    if (!_monDados || !_monDados.linhas) { alert('Sem dados para exportar.'); return; }
    const linhas = _monDados.linhas;
    const header = ['Nome', 'IP', 'Setor', 'Estado', 'LatenciaMs', 'FalhasConsecutivas', 'CPU', 'GPU', 'RAM', 'Disco', 'Alertas', 'Fonte'];
    const rows = linhas.map(l => [
        l.nome || '', l.ip, l.setor || '', l.estado,
        l.latenciaMediaMs != null ? l.latenciaMediaMs : '',
        l.falhasConsecutivas || 0,
        l.cpu || 'INDISPONIVEL', l.gpu || 'INDISPONIVEL',
        l.ram || 'INDISPONIVEL', l.disco || 'INDISPONIVEL',
        l.alertasAtivos || 0, l.fonte || ''
    ]);
    const csv = [header.join(';')].concat(rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(';'))).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'monitoramento_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
}

// ==================== FILTROS ====================
if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', function() {
        const busca = document.getElementById('mon-busca-input');
        if (busca) {
            let t = null;
            busca.addEventListener('input', function() {
                clearTimeout(t);
                t = setTimeout(function() { _monBusca = busca.value; monRenderTabela(_monDados); }, 300);
            });
        }
        const filtroEstado = document.getElementById('mon-filtro-estado');
        if (filtroEstado) {
            filtroEstado.addEventListener('change', function() { _monFiltroEstado = this.value; monRenderTabela(_monDados); });
        }
    });
}

// ==================== GRAFICOS DENTRO DO KPI ====================
function monKpiChartBlock(key) {
    let titulo = '', dados = null, opts = {};
    if (key === 'mon-kpi-coletor') {
        titulo = 'CPU do PC Local (%)';
        dados = _monCpuHist;
        opts = { cor: '#00d4ff', minForcado: 0, maxForcado: 100, altura: 200 };
    } else if (['mon-kpi-total','mon-kpi-acessiveis','mon-kpi-semresposta','mon-kpi-instaveis','mon-kpi-semdados','mon-kpi-alertas','mon-kpi-incidentes'].indexOf(key) >= 0) {
        const linhas = (_monDados && _monDados.linhas) || [];
        if (linhas.length) {
            titulo = 'Latencia dos Hosts (ms)';
            dados = linhas.map(l => l.latenciaMediaMs != null ? l.latenciaMediaMs : 0);
            opts = { cor: '#2962FF', altura: 200 };
        }
    } else if (key === 'mon-kpi-medicoes') {
        // sem serie temporal direta — usa contagem por dia se disponivel
        const dm = _monArmKPIs || {};
        if (dm.arquivos && dm.arquivos.length) {
            titulo = 'Medicoes por Dia';
            dados = dm.arquivos.map(a => a.medicoes);
            opts = { cor: '#a855f7', altura: 180 };
        }
    } else if (key === 'mon-kpi-disco') {
        const discos = (_monArmKPIs && _monArmKPIs.discos) || [];
        if (discos.length) {
            titulo = 'Uso de Disco por Volume (%)';
            dados = discos.map(d => d.usoPct != null ? d.usoPct : 0);
            opts = { cor: '#22c55e', altura: 180, minForcado: 0, maxForcado: 100 };
        }
    }
    if (!dados || (Array.isArray(dados) && dados.length < 2)) return '';
    const chartOpts = Object.assign({ titulo: titulo, altura: 200 }, opts);
    const chartHtml = monCartesianChart(dados, chartOpts);
    _monKpiCharts[key] = { titulo: titulo, html: chartHtml };
    const extraBtn = key === 'mon-kpi-coletor'
        ? '<div style="margin-top:8px;"><button class="btn btn-primary btn-sm" onclick="monAbrirRelatorioPC()"><i class="fas fa-file-lines"></i> Relatorio completo (nova aba)</button></div>'
        : '';
    return '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--divider);">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px;flex-wrap:wrap;">' +
        '<h4 style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin:0;"><i class="fas fa-chart-line" style="color:var(--cyan);"></i> ' + esc(titulo) + '</h4>' +
        '<div style="display:flex;gap:6px;">' +
        '<button class="btn btn-ghost btn-sm" onclick="monAbrirGraficoKpi(\'' + key + '\')" title="Expandir grafico"><i class="fas fa-expand"></i> Expandir</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="monAbrirGraficoKpiNovaAba(\'' + key + '\')" title="Abrir em nova aba"><i class="fas fa-external-link-alt"></i> Nova aba</button>' +
        '</div></div>' +
        '<div>' + chartHtml + '</div>' +
        extraBtn +
        '</div>';
}

function monAbrirGraficoKpi(key) {
    const c = _monKpiCharts[key];
    if (!c) return;
    monAbrirGrafico(c.titulo, c.html);
}

function monAbrirGraficoKpiNovaAba(key) {
    const c = _monKpiCharts[key];
    if (!c) return;
    monAbrirGraficoNovaAba(c.titulo, c.html);
}

// ==================== MODAL DE GRAFICO ====================
function monAbrirGrafico(titulo, htmlConteudo) {
    _monChartAtual = { titulo: titulo, html: htmlConteudo };
    _monChartExpandido = false;
    const ov = document.getElementById('mon-chart-overlay');
    const modal = document.getElementById('mon-chart-modal');
    const titleEl = document.getElementById('mon-chart-title');
    const body = document.getElementById('mon-chart-body');
    if (titleEl) titleEl.innerHTML = '<i class="fas fa-chart-line"></i> ' + esc(titulo);
    if (body) body.innerHTML = htmlConteudo;
    if (modal) modal.classList.remove('mon-chart-expanded');
    if (ov) ov.classList.add('active');
}

function monFecharGrafico() {
    const ov = document.getElementById('mon-chart-overlay');
    if (ov) ov.classList.remove('active');
    _monChartExpandido = false;
}

function monExpandirGrafico() {
    const modal = document.getElementById('mon-chart-modal');
    if (!modal) return;
    _monChartExpandido = !_monChartExpandido;
    if (_monChartExpandido) {
        modal.style.maxWidth = '98vw';
        modal.style.width = '98vw';
        modal.style.maxHeight = '95vh';
        const body = document.getElementById('mon-chart-body');
        if (body) body.style.maxHeight = '80vh';
    } else {
        modal.style.maxWidth = '900px';
        modal.style.width = '95vw';
        modal.style.maxHeight = '';
        const body = document.getElementById('mon-chart-body');
        if (body) body.style.maxHeight = '';
    }
}

function monAbrirGraficoNovaAba(titulo, htmlConteudo) {
    // pode ser chamado com (titulo, html) ou com key
    if (typeof htmlConteudo === 'undefined' && typeof titulo === 'string' && _monKpiCharts[titulo]) {
        const c = _monKpiCharts[titulo];
        titulo = c.titulo; htmlConteudo = c.html;
    }
    const w = window.open('', '_blank');
    if (!w) { alert('Pop-up bloqueado. Permita pop-ups para este site.'); return; }
    const doc = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">' +
        '<title>' + esc(titulo) + '</title>' +
        '<style>body{margin:0;padding:24px;background:#0f1117;color:#e6e6e6;font-family:Segoe UI,Arial,sans-serif;}' +
        'h1{font-size:18px;margin:0 0 16px;color:#2962FF;} .wrap{max-width:1100px;margin:0 auto;} ' +
        'button{background:#2962FF;color:#fff;border:none;padding:8px 14px;border-radius:6px;cursor:pointer;margin-right:8px;} ' +
        '.chart{background:rgba(255,255,255,0.03);border-radius:8px;padding:12px;margin-top:12px;overflow:auto;}</style></head><body>' +
        '<div class="wrap"><h1>' + esc(titulo) + '</h1>' +
        '<p style="color:#888;font-size:12px;">Inventario TI — Monitoramento | Gerado em ' + new Date().toLocaleString('pt-BR') + '</p>' +
        '<button onclick="window.print()">Imprimir / Salvar PDF</button>' +
        '<button onclick="window.close()">Fechar</button>' +
        '<div class="chart">' + htmlConteudo + '</div>' +
        '</div></body></html>';
    w.document.write(doc);
    w.document.close();
}

// ==================== RELATORIO DETALHADO DO PC ====================
function monGerarRelatorioPC() {
    const s = _monSistema || {};
    const cpu = s.cpu || {};
    const mem = s.memoria || {};
    const up = s.uptime || {};
    const gpuInfo = s.gpu || {};
    const disco = (s.disco && s.disco.discos) ? s.disco.discos : [];
    const rede = (s.rede || [])[0] || {};
    const info = s.info || {};
    const alertas = (_monDados && _monDados.alertas) || [];
    const linhas = (_monDados && _monDados.linhas) || [];
    const dm = _monArmKPIs || {};

    let html = '';
    html += '<section><h2>Identificacao</h2>';
    html += '<table class="tbl"><tr><td>Hostname</td><td>' + esc(s.hostname || '?') + '</td></tr>';
    html += '<tr><td>IP local</td><td>' + esc(rede.ip || '?') + '</td></tr>';
    html += '<tr><td>MAC</td><td>' + esc(rede.mac || '?') + '</td></tr>';
    html += '<tr><td>Plataforma</td><td>' + esc(info.plataforma || '?') + ' ' + esc(info.arquitetura || '') + '</td></tr>';
    html += '<tr><td>Kernel</td><td>' + esc(info.release || '?') + '</td></tr>';
    html += '<tr><td>Node.js</td><td>' + esc(info.node || '?') + '</td></tr>';
    html += '<tr><td>Nucleos CPU</td><td>' + (cpu.nucleos || '?') + ' — ' + esc(cpu.modelo || '') + '</td></tr>';
    html += '<tr><td>Coletado em</td><td>' + (s.quando ? new Date(s.quando).toLocaleString('pt-BR') : '?') + '</td></tr></table></section>';

    html += '<section><h2>CPU</h2>';
    html += '<p>Uso atual: <b>' + (cpu.usoPct != null ? cpu.usoPct + '%' : 'Indisponivel') + '</b></p>';
    if (_monKpiCharts['sys-cpu']) html += '<div class="chart">' + _monKpiCharts['sys-cpu'].html + '</div>';
    html += '</section>';

    html += '<section><h2>Memoria (RAM)</h2>';
    html += '<p>Uso: <b>' + (mem.usoPct != null ? mem.usoPct + '%' : '?') + '</b> (' + (mem.usadoGb || '?') + '/' + (mem.totalGb || '?') + ' GB, livre ' + (mem.livreGb || '?') + ' GB)</p>';
    if (_monKpiCharts['sys-ram']) html += '<div class="chart">' + _monKpiCharts['sys-ram'].html + '</div>';
    html += '</section>';

    html += '<section><h2>GPU</h2>';
    if (gpuInfo.gpus && gpuInfo.gpus.length) {
        for (const g of gpuInfo.gpus) {
            html += '<p>' + esc(g.nome || '?') + ': ' + (g.usoPct != null ? g.usoPct + '%' : '?') +
                (g.memoriaTotalMb ? ' | Mem: ' + g.memoriaUsadaMb + '/' + g.memoriaTotalMb + ' MB' : '') +
                (g.temperaturaC ? ' | Temp: ' + g.temperaturaC + '°C' : '') + '</p>';
        }
    } else {
        html += '<p>' + esc(gpuInfo.indisponivel || 'Indisponivel') + '</p>';
    }
    html += '</section>';

    html += '<section><h2>Discos</h2><table class="tbl"><thead><tr><th>Letra</th><th>Total GB</th><th>Usado GB</th><th>Livre GB</th><th>Uso %</th></tr></thead><tbody>';
    for (const d of disco) {
        html += '<tr><td>' + esc(d.letra) + '</td><td>' + d.totalGb + '</td><td>' + d.usadoGb + '</td><td>' + d.livreGb + '</td><td>' + d.usoPct + '%</td></tr>';
    }
    if (!disco.length) html += '<tr><td colspan="5">Indisponivel</td></tr>';
    html += '</tbody></table></section>';

    html += '<section><h2>Uptime / Sistema</h2>';
    html += '<p>Uptime: <b>' + esc(up.uptimeHumano || '?') + '</b> (boot: ' + (up.bootTime ? new Date(up.bootTime).toLocaleString('pt-BR') : '?') + ')</p>';
    html += '<p>Reinicio detectado: ' + (up.reiniciadoDesdeUltimaColeta ? '<b style="color:#ff4444;">SIM</b>' : 'Nao') + '</p>';
    html += '</section>';

    html += '<section><h2>Rede</h2>';
    html += '<p>' + esc(rede.nome || '?') + ' — ' + esc(rede.ip || '?') + ' (MAC: ' + esc(rede.mac || '?') + ')</p>';
    html += '</section>';

    html += '<section><h2>Hosts Monitorados (' + linhas.length + ')</h2><table class="tbl"><thead><tr><th>Nome</th><th>IP</th><th>Estado</th><th>Latencia</th><th>Falhas</th></tr></thead><tbody>';
    for (const l of linhas) {
        html += '<tr><td>' + esc(l.nome || l.ip) + '</td><td>' + esc(l.ip) + '</td><td>' + esc(l.estado) + '</td><td>' + (l.latenciaMediaMs != null ? l.latenciaMediaMs + 'ms' : '—') + '</td><td>' + (l.falhasConsecutivas || 0) + '</td></tr>';
    }
    html += '</tbody></table></section>';

    html += '<section><h2>Alertas Ativos (' + alertas.length + ')</h2>';
    if (alertas.length) {
        html += '<table class="tbl"><thead><tr><th>Gravidade</th><th>Titulo</th><th>Host</th><th>Confianca</th></tr></thead><tbody>';
        for (const a of alertas) {
            html += '<tr><td>' + esc(a.gravidade) + '</td><td>' + esc(a.titulo) + '</td><td>' + esc(a.host) + '</td><td>' + esc(a.confianca) + '</td></tr>';
        }
        html += '</tbody></table>';
    } else {
        html += '<p>Nenhum alerta ativo.</p>';
    }
    html += '</section>';

    html += '<section><h2>Armazenamento</h2>';
    html += '<p>Medicoes hoje: ' + (dm.medicoesHoje != null ? dm.medicoesHoje : '?') + ' | Total: ' + (dm.totalMedicoes != null ? dm.totalMedicoes : '?') + ' (' + (dm.diasComDados || 0) + ' dias) | Espaco: ' + (dm.tamanhoTotalMB || 0) + ' MB</p>';
    html += '</section>';

    return html;
}

function monAbrirRelatorioPC() {
    const body = monGerarRelatorioPC();
    const w = window.open('', '_blank');
    if (!w) { alert('Pop-up bloqueado. Permita pop-ups para este site.'); return; }
    const doc = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">' +
        '<title>Relatorio — PC Local</title>' +
        '<style>body{margin:0;padding:24px;background:#0f1117;color:#e6e6e6;font-family:Segoe UI,Arial,sans-serif;line-height:1.5;}' +
        'h1{font-size:22px;margin:0 0 4px;color:#2962FF;} h2{font-size:15px;margin:20px 0 8px;color:#00d4ff;border-bottom:1px solid #333;padding-bottom:4px;}' +
        '.meta{color:#888;font-size:12px;margin-bottom:16px;} .chart{background:rgba(255,255,255,0.03);border-radius:8px;padding:12px;margin:8px 0;overflow:auto;}' +
        'table.tbl{width:100%;border-collapse:collapse;font-size:12px;margin:8px 0;} table.tbl th,table.tbl td{padding:6px 8px;border:1px solid #333;} table.tbl th{background:#1a1a2e;color:#aaa;text-align:left;} ' +
        'button{background:#2962FF;color:#fff;border:none;padding:8px 14px;border-radius:6px;cursor:pointer;margin-right:8px;margin-top:8px;} section{margin-bottom:12px;}' +
        '</style></head><body><div style="max-width:1100px;margin:0 auto;">' +
        '<h1>Relatorio Detalhado — PC Local</h1>' +
        '<p class="meta">Inventario TI — Monitoramento | Gerado em ' + new Date().toLocaleString('pt-BR') + '</p>' +
        '<button onclick="window.print()">Imprimir / Salvar PDF</button>' +
        '<button onclick="window.close()">Fechar</button>' +
        body +
        '</div></body></html>';
    w.document.write(doc);
    w.document.close();
}

function monAbrirRelatorioHost(ip) {
    Promise.all([
        fetch('/api/monitor/host/' + encodeURIComponent(ip)).then(r => r.json()).catch(() => null),
        fetch('/api/zabbix/host/' + encodeURIComponent(ip)).then(r => r.json()).catch(() => null)
    ]).then(function(res) {
        const mon = res[0], zbx = res[1];
        let body = '';
        // Estado
        body += '<section><h2>Coletor Proprio (ICMP)</h2>';
        if (mon && mon.estadoAtual) {
            const st = mon.estadoAtual;
            body += '<table class="tbl"><tr><td>Estado</td><td>' + esc(st.ultimoResultado) + '</td></tr>';
            body += '<tr><td>Latencia</td><td>' + (st.latenciaMediaMs != null ? st.latenciaMediaMs + 'ms' : 'Indisponivel') + '</td></tr>';
            body += '<tr><td>Falhas consecutivas</td><td>' + (st.falhasConsecutivas || 0) + '</td></tr>';
            body += '<tr><td>Desde</td><td>' + (st.downSince ? new Date(st.downSince).toLocaleString('pt-BR') : '—') + '</td></tr>';
            body += '<tr><td>Ultima coleta</td><td>' + (st.ultimoHorario ? new Date(st.ultimoHorario).toLocaleString('pt-BR') : '—') + '</td></tr></table>';
            if (st.janelaRecente && st.janelaRecente.length) {
                body += '<h3>Janela recente (' + st.janelaRecente.length + ')</h3><table class="tbl"><thead><tr><th>Horario</th><th>OK</th><th>Latencia</th></tr></thead><tbody>';
                for (const j of st.janelaRecente.slice().reverse()) {
                    body += '<tr><td>' + (j.timestamp ? new Date(j.timestamp).toLocaleTimeString('pt-BR') : '?') + '</td><td>' + (j.ok ? '✓' : '✗') + '</td><td>' + (j.latenciaMediaMs != null ? j.latenciaMediaMs + 'ms' : '—') + '</td></tr>';
                }
                body += '</tbody></table>';
            }
        } else {
            body += '<p>Sem dados do coletor.</p>';
        }
        if (mon && mon.serieDiaria && mon.serieDiaria.length) {
            body += '<h3>Serie diaria (7 dias)</h3><table class="tbl"><thead><tr><th>Dia</th><th>Medicoes</th><th>Perda</th><th>Lat Media</th><th>P95</th></tr></thead><tbody>';
            for (const s of mon.serieDiaria) {
                body += '<tr><td>' + s.dia + '</td><td>' + s.total + '</td><td>' + s.perdaPct + '%</td><td>' + (s.latenciaMediaMs != null ? s.latenciaMediaMs + 'ms' : '—') + '</td><td>' + (s.latenciaP95Ms != null ? s.latenciaP95Ms + 'ms' : '—') + '</td></tr>';
            }
            body += '</tbody></table>';
        }
        body += '</section>';

        // Zabbix
        body += '<section><h2>Zabbix</h2>';
        if (zbx && zbx.encontrado) {
            const h = zbx.host;
            body += '<table class="tbl"><tr><td>Hostname</td><td>' + esc(h.hostname) + '</td></tr>';
            body += '<tr><td>Disponivel</td><td>' + (h.disponivel === null ? 'Desconhecido' : (h.disponivel ? 'Sim' : 'Nao')) + '</td></tr></table>';
            if (zbx.triggers && zbx.triggers.length) {
                body += '<h3>Triggers (' + zbx.triggers.length + ')</h3><table class="tbl"><thead><tr><th>Estado</th><th>Descricao</th></tr></thead><tbody>';
                for (const t of zbx.triggers) {
                    body += '<tr><td>' + (t.estado === '1' ? 'PROBLEM' : 'OK') + '</td><td>' + esc(t.descricao) + '</td></tr>';
                }
                body += '</tbody></table>';
            }
        } else {
            body += '<p>' + esc((zbx && (zbx.nota || zbx.erro)) || 'Host nao encontrado no Zabbix.') + '</p>';
        }
        body += '</section>';

        // Metricas locais (se for o PC local)
        if (mon && mon.metricasLocais) {
            const ml = mon.metricasLocais;
            const cpu = ml.cpu || {}; const mem = ml.memoria || {}; const up = ml.uptime || {};
            body += '<section><h2>Metricas REAIS deste PC</h2><table class="tbl">';
            body += '<tr><td>CPU</td><td>' + (cpu.usoPct != null ? cpu.usoPct + '% (' + cpu.nucleos + ' nucleos)' : 'Aguardando') + '</td></tr>';
            body += '<tr><td>RAM</td><td>' + (mem.usoPct != null ? mem.usoPct + '% (' + mem.usadoGb + '/' + mem.totalGb + ' GB)' : '?') + '</td></tr>';
            body += '<tr><td>Uptime</td><td>' + (up.uptimeHumano || '?') + '</td></tr>';
            body += '<tr><td>IP local</td><td>' + esc((ml.rede && ml.rede[0] && ml.rede[0].ip) || '?') + '</td></tr>';
            body += '</table></section>';
        }

        // Indisponiveis
        body += '<section><h2>Dados Indisponiveis</h2>';
        const indisps = (mon && mon.indisponiveis) || [];
        if (indisps.length) {
            body += '<ul>' + indisps.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul>';
        } else {
            body += '<p>Nenhum.</p>';
        }
        body += '</section>';

        // Alertas do host
        const alertasHost = (mon && mon.alertas) || [];
        body += '<section><h2>Alertas (' + alertasHost.length + ')</h2>';
        if (alertasHost.length) {
            body += '<table class="tbl"><thead><tr><th>Gravidade</th><th>Titulo</th><th>Confianca</th></tr></thead><tbody>';
            for (const a of alertasHost) {
                body += '<tr><td>' + esc(a.gravidade) + '</td><td>' + esc(a.titulo) + '</td><td>' + esc(a.confianca) + '</td></tr>';
            }
            body += '</tbody></table>';
        } else {
            body += '<p>Nenhum alerta.</p>';
        }
        body += '</section>';

        const w = window.open('', '_blank');
        if (!w) { alert('Pop-up bloqueado. Permita pop-ups para este site.'); return; }
        const doc = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">' +
            '<title>Relatorio — ' + esc(ip) + '</title>' +
            '<style>body{margin:0;padding:24px;background:#0f1117;color:#e6e6e6;font-family:Segoe UI,Arial,sans-serif;line-height:1.5;}' +
            'h1{font-size:22px;margin:0 0 4px;color:#2962FF;} h2{font-size:15px;margin:20px 0 8px;color:#00d4ff;border-bottom:1px solid #333;padding-bottom:4px;} h3{font-size:13px;margin:12px 0 6px;color:#aaa;}' +
            '.meta{color:#888;font-size:12px;margin-bottom:16px;} table.tbl{width:100%;border-collapse:collapse;font-size:12px;margin:8px 0;} table.tbl th,table.tbl td{padding:6px 8px;border:1px solid #333;} table.tbl th{background:#1a1a2e;color:#aaa;text-align:left;} ' +
            'button{background:#2962FF;color:#fff;border:none;padding:8px 14px;border-radius:6px;cursor:pointer;margin-right:8px;margin-top:8px;} section{margin-bottom:12px;} ul{margin:6px 0;padding-left:20px;}' +
            '</style></head><body><div style="max-width:1100px;margin:0 auto;">' +
            '<h1>Relatorio Detalhado — ' + esc(ip) + '</h1>' +
            '<p class="meta">Inventario TI — Monitoramento | Gerado em ' + new Date().toLocaleString('pt-BR') + '</p>' +
            '<button onclick="window.print()">Imprimir / Salvar PDF</button>' +
            '<button onclick="window.close()">Fechar</button>' +
            body +
            '</div></body></html>';
        w.document.write(doc);
        w.document.close();
    }).catch(function(e) {
        alert('Erro ao gerar relatorio: ' + (e && e.message));
    });
}

function monAbrirRelatorioPC() {
    // Busca dados atuais via API
    fetch('/api/monitor/sistema')
        .then(r => r.json())
        .then(s => {
            const cpu = s.cpu || {};
            const mem = s.memoria || {};
            const up = s.uptime || {};
            const gpuInfo = s.gpu || {};
            const disco = (s.disco && s.disco.discos) ? s.disco.discos[0] : null;
            const rede = (s.rede || [])[0] || {};
            const info = s.info || {};
            const alertas = s.alertas || [];

            // Dados dos ultimos 30 dias (historico do coletor)
            return fetch('/api/monitor/historico?host=192.168.0.186&dias=30')
                .then(r => r.json())
                .then(dados => {
                    // Gera grafico de latencia e perda a partir das ultimas medicoes brutas
                    const lats = (dados.ultimasMedicoes || []).map(function(m) {
                        return { t: m.timestamp ? new Date(m.timestamp).getTime() : 0, v: m.latenciaMediaMs, ok: m.ok };
                    }).filter(function(p) { return p.t > 0; });
                    const perdas = (dados.ultimasMedicoes || []).map(function(m) {
                        return { t: m.timestamp ? new Date(m.timestamp).getTime() : 0, v: m.perdaPct, ok: m.ok };
                    }).filter(function(p) { return p.t > 0; });

                    const latChart = monCartesianChart(lats, { titulo: 'Latencia (ms)', unidade: 'ms', cor: '#2962FF', altura: 200, formatarY: function(v){return Math.round(v);} });
                    const perdaChart = monCartesianChart(perdas, { titulo: 'Perda (%)', unidade: '%', cor: '#FF6D00', altura: 180, minForcado: 0, maxForcado: 100, formatarY: function(v){return Math.round(v);} });

                    // Monta HTML completo do relatorio
                    let html = '';
                    html += '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/>' +
                        '<title>Relatorio — PC Local</title>' +
                        '<style>body{margin:0;padding:24px;background:#0f1117;color:#e6e6e6;font-family:Segoe UI,Arial,sans-serif;line-height:1.5;}' +
                        'h1{font-size:22px;margin:0 0 4px;color:#2962FF;} h2{font-size:15px;margin:20px 0 8px;color:#00d4ff;border-bottom:1px solid #333;padding-bottom:4px;}' +
                        'h3{font-size:13px;margin:12px 0 6px;color:#aaa;} .meta{color:#888;font-size:12px;margin-bottom:16px;}' +
                        'table.tbl{width:100%;border-collapse:collapse;font-size:12px;margin:8px 0;} table.tbl th,table.tbl td{padding:6px 8px;border:1px solid #333;} table.tbl th{background:#1a1a2e;color:#aaa;text-align:left;} ' +
                        'button{background:#2962FF;color:#fff;border:none;padding:8px 14px;border-radius:6px;cursor:pointer;margin-right:8px;margin-top:8px;} ' +
                        '.chart{background:rgba(255,255,255,0.03);border-radius:8px;padding:10px;margin:8px 0;overflow:auto;} .ull{margin-top:8px;}' +
                        'ul{margin:6px 0;padding-left:20px;} .tag{display:inline-block;padding:2px 6px;border-radius:4px;background:#2962FF;color:#fff;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;}' +
                        '</style></head><body>' +
                        '<div style="max-width:1100px;margin:0 auto;">' +
                        '<h1>Relatorio Detalhado — PC Local</h1>' +
                        '<p class="meta">Inventario TI — Monitoramento | Gerado em ' + new Date().toLocaleString('pt-BR') + '</p>' +
                        '<button onclick="window.print()">Imprimir / Salvar PDF</button>' +
                        '<button onclick="window.close()">Fechar</button>' +
                        // CPU + RAM
                        '<section><h2>CPU e Memoria</h2>' +
                        '<div class="ull"><div style="display:flex;align-items:center;justify-content:center;padding:8px;background:#1a1a2e;border-radius:8px;margin-bottom:12px;">' +
                        '<span style="font-size:24px;color:#00d4ff;">' + (cpu.usoPct != null ? Math.round(cpu.usoPct) : '—') + '%</span>' +
                        '</div><div style="font-size:12px;color:#aaa;margin-top:4px;">' + (cpu.nucleos || '?') + ' nucleos — ' + (cpu.modelo || '') + '</div>' +
                        '</div>' +
                        '<div class="chart">' + latChart + '</div>' +
                        '<div class="chart">' + perdaChart + '</div>' +
                        '</section>' +
                        // RAM
                        '<section><h2>Memoria (RAM)</h2>' +
                        '<p>Uso: <b>' + (mem.usoPct != null ? Math.round(mem.usoPct) + '%' : '?') + '</b> (' + (mem.usadoGb || '?') + '/' + (mem.totalGb || '?') + ' GB, livre ' + (mem.livreGb || '?') + ' GB)</p>' +
                        '<div class="chart">' + (mem.usoPct != null ? monCartesianChart([mem.usoPct], { titulo: 'RAM', unidade: '%', cor: '#a855f7', altura: 150, minForcado: 0, maxForcado: 100 }) : '') + '</div>' +
                        '</section>' +
                        // GPU
                        '<section><h2>GPU</h2>' +
                        (gpuInfo.gpus && gpuInfo.gpus.length ?
                            gpuInfo.gpus.map(function(g) {
                                return '<p>' + g.nome + ': ' + (g.usoPct != null ? Math.round(g.usoPct) + '%' : '?') +
                                    (g.memoriaTotalMb ? ' | Mem: ' + g.memoriaUsadaMb + '/' + g.memoriaTotalMb + ' MB' : '') +
                                    (g.temperaturaC ? ' | Temp: ' + g.temperaturaC + '°C' : '') + '</p>';
                            }).join('') :
                            '<p>Indisponivel</p>') +
                        '</section>' +
// Disco — todos os discos locais
            '<section class="card"><h2>Disco</h2>' +
            (disco && disco.discos && disco.discos.length ?
                '<table class="tbl"><thead><tr><th>Disco</th><th>Total</th><th>Usado</th><th>Livre</th><th>Uso %</th></tr></thead><tbody>' +
                disco.discos.map(function(d) {
                    return '<tr><td>' + d.letra + '</td><td>' + d.totalGb + ' GB</td><td>' + d.usadoGb + ' GB</td><td>' + d.livreGb + ' GB</td><td>' + d.usoPct + '%</td></tr>';
                }).join('') +
                '</tbody></table>'
            : '<p>Nenhum disco localizado (PowerShell nâo disponível ou sem discos locais).</p>') +
            '</section>' +
                        // Uptime / Sistema
                        '<section><h2>Uptime / Sistema</h2>' +
                        '<p>Uptime: <b>' + (up.uptimeHumano || '?') + '</b> (boot: ' + (up.bootTime ? new Date(up.bootTime).toLocaleString('pt-BR') : '?') + ')</p>' +
                        '<p>Reinicio detectado: ' + (up.reiniciadoDesdeUltimaColeta ? '<span style="color:#ff4444;">SIM</span>' : 'Nao') + '</p>' +
                        '<p>Plataforma: ' + (info.plataforma || '?') + ' ' + (info.arquitetura || '') + '</p>' +
                        '<p>Kernel: ' + (info.release || '?') + ' | Node ' + (info.node || '?') + '</p>' +
                        '</section>' +
                        // Rede
                        '<section><h2>Rede</h2>' +
                        '<p>' + rede.nome + ' — ' + rede.ip + ' (MAC: ' + rede.mac + ')</p>' +
                        '</section>' +
                        // Hosts monitorados
                        '<section><h2>Hosts Monitorados (' + (linhas ? linhas.length : 0) + ')</h2>' +
                        '<table class="tbl"><thead><tr><th>Nome</th><th>IP</th><th>Estado</th><th>Latencia</th><th>Falhas</th></tr></thead><tbody>' +
                        (linhas ? linhas.map(function(l) {
                            return '<tr><td>' + (l.nome || l.ip) + '</td><td>' + l.ip + '</td><td>' + l.estado + '</td><td>' + (l.latenciaMediaMs != null ? l.latenciaMediaMs + 'ms' : '—') + '</td><td>' + (l.falhasConsecutivas || 0) + '</td></tr>';
                        }).join('') : '<tr><td colspan="5">Sem dados</td></tr>') +
                        '</tbody></table>' +
                        '</section>' +
                        // Alertas
                        '<section><h2>Alertas (' + (alertas ? alertas.length : 0) + ')</h2>' +
                        (alertas ? (
                            '<table class="tbl"><thead><tr><th>Gravidade</th><th>Titulo</th><th>Confianca</th></tr></thead><tbody>' +
                            alertas.map(function(a) {
                                return '<tr><td>' + a.gravidade + '</td><td>' + a.titulo + '</td><td>' + a.confianca + '</td></tr>';
                            }).join('') +
                            '</tbody></table>'
                        ) : '<p>Nenhum alerta.</p>') +
                        '</section>' +
                        // Armazenamento
                        '<section><h2>Armazenamento</h2>' +
                        '<p>Medicoes hoje: ' + (dados && dados.medicoesHoje != null ? dados.medicoesHoje : '?') + ' | Total: ' + (dados && dados.totalMedicoes != null ? dados.totalMedicoes : '?') +
                        ' (' + (dados && dados.diasComDados != null ? dados.diasComDados : '?') + ' dias) | Espaco: ' + (dados && dados.tamanhoTotalMB != null ? dados.tamanhoTotalMB + ' MB' : '?') + '</p>' +
                        '</section>' +
                        '</div>' +
                        // Footer buttons
                        '<div style="margin-top:24px;display:flex;justify-content:flex-end;">' +
                        '<button onclick="window.print()">Imprimir / Salvar PDF</button>' +
                        '<button onclick="window.close()">Fechar</button>' +
                        '</div>' +
                        '</body></html>';

const w = window.open('', '_blank');
        if (!w) { alert('Pop-up bloqueado. Permita pop-ups para este site.'); return; }
        // Small delay to ensure window is ready (some browsers need user gesture)
        setTimeout(function() {
            try {
                w.document.write(html);
                w.document.close();
            } catch(e) {
                // Fallback: try to set content via innerHTML on the body
                try { w.document.body.innerHTML = html; w.document.close(); } catch(e2) {
                    w.alert('Erro ao carregar relatório: ' + (e2 && e2.message));
                }
            }
        }, 100);
                });
        })
        .catch(function(e) {
            alert('Erro ao gerar relatorio: ' + (e && e.message));
        });
}

// ==================== RELATORIO DETALHADO DO PC ====================
function monAbrirRelatorioPC() {
    // Busca dados atuais via API (sistema + storage + Zabbix resumo)
    Promise.all([
        fetch('/api/monitor/sistema').then(r => r.json()).catch(() => null),
        fetch('/api/monitor/historico?host=192.168.0.186&dias=30').then(r => r.json()).catch(() => null),
        fetch('/api/zabbix/resumo').then(r => r.json()).catch(() => null),
        fetch('/api/zabbix/host/192.168.0.186').then(r => r.json()).catch(() => null)
    ]).then(function([sistema, hist, resumo, host]) {
        // --- Dados do Coletor ---
        const cpu = (sistema && sistema.cpu) || {};
        const mem = (sistema && sistema.memoria) || {};
        const up = (sistema && sistema.uptime) || {};
        const gpu = (sistema && sistema.gpu) || {};
        const disco = (sistema && sistema.disco && sistema.disco.discos) ? sistema.disco.discos[0] : null;
        const rede = (sistema && sistema.rede) ? sistema.rede[0] : null;
        const info = (sistema && sistema.info) || {};
        const alertas = (sistema && sistema.alertas) || [];

        // --- Dados do Historico (ultimas 30 dias) ---
        const serie = (hist && hist.serie) || [];
        const ultimas = (hist && hist.ultimasMedicoes) || [];

        // --- Dados do Zabbix ---
        const zStatus = (resumo && resumo.zabbix) || {};
        const zHost = (host && host.hostname) ? host.hostname : '?';
        const zDisponivel = zStatus.disponiveis || 0;
        const zIndisponiveis = zStatus.indisponiveis || 0;
        const zProblemas = (resumo && resumo.problemas) || {};
        const zTriggers = (zProblemas.total || 0);

        // --- Montar graficos (Chart.js dados embutidos como base64 simples ou usar monCartesianChart) ---
        // Vamos gerar dados de chart a partir do historico coletado
        function geraDadosChart(lados) {
            if (!lados || lados.length < 2) return '';
            // Simples gera��o de dados para o chart canvas
            const ctx = document.createElement('canvas');
            ctx.width = 400;
            ctx.height = 200;
            const chart = ctx.getContext('2d');
            // Desenhar eixo e grid simples
            chart.strokeStyle = '#555';
            chart.lineWidth = 1;
            // Desenhar linha de exemplo baseada nos dados
            const dados = lados.map(function(p) { return p.v || 0; });
            const max = Math.max(...dados.filter(v => !isNaN(v)) || [0]);
            const min = Math.min(...dados.filter(v => !isNaN(v)) || [0]);
            const passo = ctx.width / (dados.length - 1);
            chart.beginPath();
            for (let i = 0; i < dados.length; i++) {
                const y = ctx.height - ( (dados[i] - min) / (max - min || 1) * ctx.height );
                if (i === 0) chart.moveTo(i * passo, y);
                else chart.lineTo(i * passo, y);
            }
            chart.stroke();
            return ctx.canvas.toDataURL('image/png');
        }

        // Dados para graficos de latencia/perda - removidos para evitar erro de sintaxe
        // const chartLat = geraDadosChart(...); const chartPerda = geraDadosChart(...);

        // --- Montar HTML do Relatorio ---
        let html = '';
        html += '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/>' +
            '<title>Relatorio — PC Local</title>' +
            '<style>body{margin:0;padding:28px;background:#0f1117;color:#e6e6e6;font-family:"Segoe UI",Arial,sans-serif;}' +
            'h1{font-size:24px;margin:0 0 2px;color:#2962FF;} h2{font-size:15px;margin:20px 0 6px;color:#00d4ff;border-bottom:1px solid #333;padding-bottom:2px;} ' +
            '.meta{color:#888;font-size:12px;margin-bottom:10px;} .card{background:#1a1a2e;border:1px solid #2a2a3e;border-radius:8px;padding:20px;margin:12px 0;} ' +
            '.chart{background:#0d1117;padding:12px;margin:8px 0;border-radius:6px;position:relative;} .chart canvas{width:100%;height:150px;} ' +
            'table.tbl{width:100%;border-collapse:collapse;font-size:12px;margin:6px 0;} table.tbl th,table.tbl td{padding:6px 8px;border:1px solid #333;} table.tbl th{background:#1a1a2e;color:#aaa;text-align:left;} ' +
            'button{background:#2962FF;color:#fff;border:none;padding:8px 14px;border-radius:6px;cursor:pointer;margin-right:6px;margin-top:6px;} ' +
            '.tag{display:inline-block;padding:2px 6px;border-radius:4px;background:#2962FF;color:#fff;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;}' +
            'ul{margin:4px 0;padding-left:20px;} .ok{color:#0f0;} .bad{color:#f44;}' +
            '</style></head><body>' +
            '<div style="max-width:1100px;margin:0 auto;">' +
            '<h1>Relatorio Detalhado — PC Local</h1>' +
            '<p class="meta">Inventario TI — Monitoramento | Gerado em ' + new Date().toLocaleString('pt-BR') + '</p>' +
            '<button onclick="window.print()">Imprimir / Salvar PDF</button>' +
            '<button onclick="window.close()">Fechar</button>' +
            // Se��o 1: Identificacao
            '<section class="card"><h2>Identificacao</h2>' +
            '<table class="tbl"><tr><td>Hostname</td><td>192.168.0.186</td></tr>' +
            '<tr><td>IP Local</td><td>' + (rede ? rede.ip : '?') + '</td></tr>' +
            '<tr><td>MAC</td><td>' + (rede ? rede.mac : '?') + '</td></tr>' +
            '<tr><td>Plataforma</td><td>' + (info.plataforma || '?') + ' ' + (info.arquitetura || '') + '</td></tr>' +
            '<tr><td>Kernel</td><td>' + (info.release || '?') + '</td></tr>' +
            '<tr><td>Node.js</td><td>' + (info.node || '?') + '</td></tr></table></section>' +
            // Se��o 2: CPU e RAM
            '<section class="card"><h2>CPU e Memoria</h2>' +
            '<div style="display:flex;align-items:center;justify-content:center;padding:8px;background:#1a1a2e;border-radius:8px;margin-bottom:12px;">' +
            '<span style="font-size:32px;color:#00d4ff;">' + (cpu.usoPct != null ? Math.round(cpu.usoPct) : '—') + '%</span>' +
            '</div>' +
            '<div style="font-size:12px;color:#aaa;margin-top:4px;">' + (cpu.nucleos || '?') + ' nucleos — ' + (cpu.modelo || '') + '</div>' +
            '</div>' +
            '<div class="chart"><canvas id="cLat"></canvas></div>' +
            '<div class="chart"><canvas id="cPerda"></canvas></div>' +
            '</section>' +
            // Se��o 3: GPU
            '<section class="card"><h2>GPU</h2>' +
            (gpu.gpus && gpu.gpus.length ?
                gpu.gpus.map(function(g) {
                    return '<p>' + g.nome + ': ' + (g.usoPct != null ? Math.round(g.usoPct) + '%' : '?') +
                        (g.memoriaTotalMb ? ' | Mem: ' + g.memoriaUsadaMb + '/' + g.memoriaTotalMb + ' MB' : '') +
                        (g.temperaturaC ? ' | Temp: ' + g.temperaturaC + '°C' : '') + '</p>';
                }).join('') :
                '<p>Indisponivel</p>') +
            '</section>' +
            // Se��o 4: Disco
            '<section class="card"><h2>Disco ' + (disco ? disco.letra : 'C:') + '</h2>' +
            '<p>Total: ' + (disco ? disco.totalGb + ' GB' : '?') + ', Usado: ' + (disco ? disco.usadoGb + ' GB' : '?') +
            ', Livre: ' + (disco ? disco.livreGb + ' GB' : '?') + ', Uso: ' + (disco ? disco.usoPct + '%' : '?') + '</p>' +
            '</section>' +
            // Se��o 5: Uptime / Sistema
            '<section class="card"><h2>Uptime / Sistema</h2>' +
            '<p>Uptime: <b>' + (up.uptimeHumano || '?') + '</b> (boot: ' + (up.bootTime ? new Date(up.bootTime).toLocaleString('pt-BR') : '?') + ')</p>' +
            '<p>Reinicio detectado: ' + (up.reiniciadoDesdeUltimaColeta ? '<span style="color:#f44;">SIM</span>' : 'Nao') + '</p>' +
            '<p>Plataforma: ' + (info.plataforma || '?') + ' ' + (info.arquitetura || '') + '</p>' +
            '<p>Kernel: ' + (info.release || '?') + ' | Node ' + (info.node || '?') + '</p>' +
            '</section>' +
            // Se��o 6: Rede
            '<section class="card"><h2>Rede</h2>' +
            '<p>' + (rede ? rede.nome + ' — ' + rede.ip : '?') + ' (MAC: ' + (rede ? rede.mac : '?') + ')</p>' +
            '</section>' +
            // Se��o 7: Hosts Monitorados
            '<section class="card"><h2>Hosts Monitorados (' + (hist && hist.linhas ? hist.linhas.length : 0) + ')</h2>' +
            '<table class="tbl"><thead><tr><th>Nome</th><th>IP</th><th>Estado</th><th>Latencia</th><th>Falhas</th></tr></thead><tbody>' +
            (hist && hist.linhas ?
                hist.linhas.map(function(l) {
                    return '<tr><td>' + (l.nome || l.ip) + '</td><td>' + l.ip + '</td><td>' + l.estado + '</td><td>' + (l.latenciaMediaMs != null ? l.latenciaMediaMs + 'ms' : '—') + '</td><td>' + (l.falhasConsecutivas || 0) + '</td></tr>';
                }).join('') :
                '<tr><td colspan="5">Sem dados</td></tr>') +
            '</tbody></table>' +
            '</section>' +
            // Se��o 8: Alertas
            '<section class="card"><h2>Alertas (' + (alertas ? alertas.length : 0) + ')</h2>' +
            (alertas ?
                '<table class="tbl"><thead><tr><th>Gravidade</th><th>Titulo</th><th>Confianca</th></tr></thead><tbody>' +
                alertas.map(function(a) {
                    return '<tr><td>' + a.gravidade + '</td><td>' + a.titulo + '</td><td>' + a.confianca + '</td></tr>';
                }).join('') +
                '</tbody></table>'
            : '<p>Nenhum alerta.</p>') +
            '</section>' +
            // Se��o 9: Armazenamento
            '<section class="card"><h2>Armazenamento</h2>' +
            '<p>Medicoes hoje: ' + (hist && hist.medicoesHoje != null ? hist.medicoesHoje : '?') + ' | Total: ' + (hist && hist.totalMedicoes != null ? hist.totalMedicoes : '?') +
            ' (' + (hist && hist.diasComDados != null ? hist.diasComDados : '?') + ' dias) | Espaco: ' + (hist && hist.tamanhoTotalMB != null ? hist.tamanhoTotalMB + ' MB' : '?') + '</p>' +
            '</section>' +
            // Rodape de botoes
            '<div style="display:flex;justify-content:flex-end;margin-top:20px;">' +
            '<button onclick="window.print()">Imprimir / Salvar PDF</button>' +
            '<button onclick="window.close()">Fechar</button>' +
            '</div>' +
            '</div>';

        const w = window.open('', '_blank');
        if (!w) { alert('Pop-up bloqueado. Permita pop-ups para este site.'); return; }
        w.document.write(html);
        w.document.close();
    }).catch(function(e) {
        alert('Erro ao gerar relatorio: ' + (e && e.message));
    });
}

// ==================== RELATORIO DETALHADO DO PC ====================
function monAbrirRelatorioPC() {
    // Busca dados via API
    Promise.all([
        fetch('/api/monitor/sistema').then(r => r.json()).catch(() => null),
        fetch('/api/monitor/historico?host=192.168.0.186&dias=30').then(r => r.json()).catch(() => null)
    ]).then(function(dados) {
        const s = dados[0] || {};
        const hist = dados[1] || {};
        const cpu = s.cpu || {};
        const mem = s.memoria || {};
        const up = s.uptime || {};
        const gpu = s.gpu || {};
        const disco = (s.disco && s.disco.discos) ? s.disco.discos : [];
        const rede = (s.rede || [])[0] || {};
        const info = s.info || {};
        const alertas = s.alertas || [];
        const linhas = (s.linhas) ? s.linhas : [];

        // --- Extrair dados para graficos (arrays de valores) ---
        function extrairValores(registros, propriedade) {
            if (!registros) return [];
            return registros.map(function(m) { return m[propriedade]; }).filter(function(v) { return v != null; });
        }
        const latencias = extrairValores(ultimas || [], 'latenciaMediaMs');
        const perdas = extrairValores(ultimas || [], 'perdaPct');

        // --- Gerar graficos com monCartesianChart ---
        const chartLat = (latencias && latencias.length >= 2) ?
            monCartesianChart(latencias, { titulo: 'Latencia (ms)', unidade: 'ms', cor: '#2962FF', altura: 180, minForcado: 0, maxForcado: 100 }) :
            '<div style="font-size:10px;color:var(--text-muted);padding:4px;">Dados insuficientes</div>';
        const chartPerda = (perdas && perdas.length >= 2) ?
            monCartesianChart(perdas, { titulo: 'Perda (%)', unidade: '%', cor: '#FF6D00', altura: 150, minForcado: 0, maxForcado: 100 }) :
            '<div style="font-size:10px;color:var(--text-muted);padding:4px;">Dados insuficientes</div>';

        // --- Montar HTML do Relatorio ---
        let html = '';
        html += '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/>' +
            '<title>Relatorio — PC Local</title>' +
            '<style>body{margin:0;padding:24px;background:#0f1117;color:#e6e6e6;font-family:"Segoe UI",Arial,sans-serif;line-height:1.5;}' +
            'h1{font-size:22px;margin:0 0 4px;color:#2962FF;} h2{font-size:15px;margin:20px 0 6px;color:#00d4ff;border-bottom:1px solid #333;padding-bottom:4px;}' +
            'h3{font-size:13px;margin:12px 0 6px;color:#aaa;} .meta{color:#888;font-size:12px;margin-bottom:8px;} ' +
            'table.tbl{width:100%;border-collapse:collapse;font-size:12px;margin:6px 0;} table.tbl th,table.tbl td{padding:6px 8px;border:1px solid #333;} table.tbl th{background:#1a1a2e;color:#aaa;text-align:left;} ' +
            'button{background:#2962FF;color:#fff;border:none;padding:8px 14px;border-radius:6px;cursor:pointer;margin-right:6px;margin-top:6px;} ' +
            '.chart{background:#0d1117;padding:8px;margin:6px 0;border-radius:6px;overflow:auto;} .ull{margin-top:8px;}' +
            'ul{margin:4px 0;padding-left:20px;} .ok{color:#0f0;} .bad{color:#f44;}' +
            '</style></head><body>' +
            '<div style="max-width:1100px;margin:0 auto;">' +
            '<h1>Relatorio Detalhado — PC Local</h1>' +
            '<p class="meta">Inventario TI — Monitoramento | Gerado em ' + new Date().toLocaleString('pt-BR') + '</p>' +
            '<button onclick="window.print()">Imprimir / Salvar PDF</button>' +
            '<button onclick="window.close()">Fechar</button>' +
            // CPU e RAM
            '<section class="card"><h2>CPU e Memoria</h2>' +
            '<p>Uso CPU: <b>' + (cpu.usoPct != null ? cpu.usoPct + '%' : '—') + '</b> (' + (cpu.nucleos || '?') + ' nucleos)</p>' +
            '<p>Uso Memoria: <b>' + (mem.usoPct != null ? mem.usoPct + '%' : '—') + '</b> (' + (mem.usadoGb || '?') + '/' + (mem.totalGb || '?') + ' GB, livre: ' + (mem.livreGb || '?') + ' GB)</p>' +
            '<div class="chart">' + chartLat + '</div>' +
            '<div class="chart">' + chartPerda + '</div>' +
            '</section>' +
            // GPU
            '<section class="card"><h2>GPU</h2>' +
            (gpu.gpus && gpu.gpus.length ?
                gpu.gpus.map(function(g) {
                    return '<p>' + g.nome + ': ' + (g.usoPct != null ? Math.round(g.usoPct) + '%' : '?') +
                        (g.memoriaTotalMb ? ' | Mem: ' + g.memoriaUsadaMb + '/' + g.memoriaTotalMb + ' MB' : '') +
                        (g.temperaturaC ? ' | Temp: ' + g.temperaturaC + '°C' : '') + '</p>';
                }).join('') :
                '<p>Indisponivel</p>') +
            '</section>' +
            // Disco
            '<section class="card"><h2>Disco ' + (disco ? disco.letra : 'C:') + '</h2>' +
            '<p>Total: ' + (disco ? disco.totalGb + ' GB' : '?') + ', Usado: ' + (disco ? disco.usadoGb + ' GB' : '?') +
            ', Livre: ' + (disco ? disco.livreGb + ' GB' : '?') + ', Uso: ' + (disco ? disco.usoPct + '%' : '?') + '</p>' +
            '</section>' +
            // Uptime
            '<section class="card"><h2>Uptime / Sistema</h2>' +
            '<p>Uptime: <b>' + (up.uptimeHumano || '?') + '</b> (boot: ' + (up.bootTime ? new Date(up.bootTime).toLocaleString('pt-BR') : '?') + ')</p>' +
            '<p>Reinicio detectado: ' + (up.reiniciadoDesdeUltimaColeta ? '<span style="color:#f44;">SIM</span>' : 'Nao') + '</p>' +
            '<p>Plataforma: ' + (info.plataforma || '?') + ' ' + (info.arquitetura || '') + '</p>' +
            '<p>Kernel: ' + (info.release || '?') + ' | Node ' + (info.node || '?') + '</p>' +
            '</section>' +
            // Rede
            '<section class="card"><h2>Rede</h2>' +
            '<p>' + (rede ? rede.nome + ' — ' + rede.ip : '?') + ' (MAC: ' + (rede ? rede.mac : '?') + ')</p>' +
            '</section>' +
            // Hosts
            '<section class="card"><h2>Hosts Monitorados (' + (linhas ? linhas.length : 0) + ')</h2>' +
            '<table class="tbl"><thead><tr><th>Nome</th><th>IP</th><th>Estado</th><th>Latencia</th><th>Falhas</th></tr></thead><tbody>' +
            (linhas ? linhas.map(function(l) {
                return '<tr><td>' + (l.nome || l.ip) + '</td><td>' + l.ip + '</td><td>' + l.estado + '</td><td>' + (l.latenciaMediaMs != null ? l.latenciaMediaMs + 'ms' : '—') + '</td><td>' + (l.falhasConsecutivas || 0) + '</td></tr>';
            }).join('') :
                '<tr><td colspan="5">Sem dados</td></tr>') +
            '</tbody></table>' +
            '</section>' +
            // Alertas
            '<section class="card"><h2>Alertas (' + (alertas ? alertas.length : 0) + ')</h2>' +
            (alertas ?
                '<table class="tbl"><thead><tr><th>Gravidade</th><th>Titulo</th><th>Confianca</th></tr></thead><tbody>' +
                alertas.map(function(a) {
                    return '<tr><td>' + a.gravidade + '</td><td>' + a.titulo + '</td><td>' + a.confianca + '</td></tr>';
                }).join('') +
                '</tbody></table>'
            : '<p>Nenhum alerta.</p>') +
            '</section>' +
            // Armazenamento
            '<section class="card"><h2>Armazenamento</h2>' +
            '<p>Medicoes hoje: ' + (hist && hist.medicoesHoje != null ? hist.medicoesHoje : '?') + ' | Total: ' + (hist && hist.totalMedicoes != null ? hist.totalMedicoes : '?') +
            ' (' + (hist && hist.diasComDados != null ? hist.diasComDados : '?') + ' dias) | Espaco: ' + (hist && hist.tamanhoTotalMB != null ? hist.tamanhoTotalMB + ' MB' : '?') + '</p>' +
            '</section>' +
            // Rodape
            '<div style="display:flex;justify-content:flex-end;margin-top:20px;">' +
            '<button onclick="window.print()">Imprimir / Salvar PDF</button>' +
            '<button onclick="window.close()">Fechar</button>' +
            '</div>' +
            '</div>';

        const w = window.open('', '_blank');
        if (!w) { alert('Pop-up bloqueado. Permita pop-ups para este site.'); return; }
        w.document.write(html);
        w.document.close();
    }).catch(function(e) {
        alert('Erro ao gerar relatorio: ' + (e && e.message));
    });
}

// ==================== RELATORIO DETALHADO DO PC ====================
function monAbrirRelatorioPC() {
    // Busca dados via API
    Promise.all([
        fetch('/api/monitor/sistema').then(r => r.json()).catch(() => null),
        fetch('/api/monitor/historico?host=192.168.0.186&dias=30').then(r => r.json()).catch(() => null)
    ]).then(function(dados) {
        const s = dados[0] || {};
        const hist = dados[1] || {};
        const cpu = s.cpu || {};
        const mem = s.memoria || {};
        const up = s.uptime || {};
        const gpu = s.gpu || {};
        const disco = (s.disco && s.disco.discos) ? s.disco.discos : [];
        const rede = (s.rede || [])[0] || {};
        const info = s.info || {};
        const alertas = s.alertas || [];
        const linhas = (s.linhas) ? s.linhas : [];

        // Extrair valores de latencia e perda do historico
        const latValues = [];
        const lossValues = [];
        if (hist && hist.ultimasMedicoes) {
            hist.ultimasMedicoes.forEach(function(m) {
                if (m.latenciaMediaMs != null) latValues.push(m.latenciaMediaMs);
                if (m.perdaPct != null) lossValues.push(m.perdaPct);
            });
        }

        // Montar HTML do Relatorio
        let html = '';
        html += '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/>' +
            '<title>Relatorio — PC Local</title>' +
            '<style>body{margin:0;padding:24px;background:#0f1117;color:#e6e6e6;font-family:"Segoe UI",Arial,sans-serif;line-height:1.5;}' +
            'h1{font-size:22px;margin:0 0 4px;color:#2962FF;} h2{font-size:15px;margin:20px 0 6px;color:#00d4ff;border-bottom:1px solid #333;padding-bottom:4px;}' +
            'h3{font-size:13px;margin:12px 0 6px;color:#aaa;} .meta{color:#888;font-size:12px;margin-bottom:8px;} ' +
            'table.tbl{width:100%;border-collapse:collapse;font-size:12px;margin:6px 0;} table.tbl th,table.tbl td{padding:6px 8px;border:1px solid #333;} table.tbl th{background:#1a1a2e;color:#aaa;text-align:left;} ' +
            'button{background:#2962FF;color:#fff;border:none;padding:8px 14px;border-radius:6px;cursor:pointer;margin-right:6px;margin-top:6px;} ' +
            '.chart{background:#0d1117;padding:8px;margin:6px 0;border-radius:6px;overflow:auto;}' +
            '</style></head><body>' +
            '<div style="max-width:1100px;margin:0 auto;">' +
            '<h1>Relatorio Detalhado — PC Local</h1>' +
            '<p class="meta">Inventario TI — Monitoramento | Gerado em ' + new Date().toLocaleString('pt-BR') + '</p>' +
            '<button onclick="window.print()">Imprimir / Salvar PDF</button>' +
            '<button onclick="window.close()">Fechar</button>' +
            // CPU e RAM
            '<section class="card"><h2>CPU e Memoria</h2>' +
            '<p>Uso CPU: <b>' + (cpu.usoPct != null ? cpu.usoPct + '%' : '—') + '</b> (' + (cpu.nucleos || '?') + ' nucleos)</p>' +
            '<p>Uso Memoria: <b>' + (mem.usoPct != null ? mem.usoPct + '%' : '—') + '</b> (' + (mem.usadoGb || '?') + '/' + (mem.totalGb || '?') + ' GB, livre ' + (mem.livreGb || '?') + ' GB)</p>' +
            '</section>' +
            // GPU
            '<section class="card"><h2>GPU</h2>' +
            (gpu.gpus && gpu.gpus.length ?
                gpu.gpus.map(function(g) {
                    return '<p>' + g.nome + ': ' + (g.usoPct != null ? Math.round(g.usoPct) + '%' : '?') +
                        (g.memoriaTotalMb ? ' | Mem: ' + g.memoriaUsadaMb + '/' + g.memoriaTotalMb + ' MB' : '') +
                        (g.temperaturaC ? ' | Temp: ' + g.temperaturaC + '°C' : '') + '</p>';
                }).join('') :
                '<p>Indisponivel</p>') +
            '</section>' +
            // Disco
            '<section class="card"><h2>Disco ' + (disco ? disco.letra : 'C:') + '</h2>' +
            '<p>Total: ' + (disco ? disco.totalGb + ' GB' : '?') + ', Usado: ' + (disco ? disco.usadoGb + ' GB' : '?') +
            ', Livre: ' + (disco ? disco.livreGb + ' GB' : '?') + ', Uso: ' + (disco ? disco.usoPct + '%' : '?') + '</p>' +
            '</section>' +
            // Uptime
            '<section class="card"><h2>Uptime / Sistema</h2>' +
            '<p>Uptime: <b>' + (up.uptimeHumano || '?') + '</b> (boot: ' + (up.bootTime ? new Date(up.bootTime).toLocaleString('pt-BR') : '?') + ')</p>' +
            '<p>Reinicio detectado: ' + (up.reiniciadoDesdeUltimaColeta ? '<span style="color:#f44;">SIM</span>' : 'Nao') + '</p>' +
            '<p>Plataforma: ' + (info.plataforma || '?') + ' ' + (info.arquitetura || '') + '</p>' +
            '<p>Kernel: ' + (info.release || '?') + ' | Node ' + (info.node || '?') + '</p>' +
            '</section>' +
            // Rede
            '<section class="card"><h2>Rede</h2>' +
            '<p>' + (rede ? rede.nome + ' — ' + rede.ip : '?') + ' (MAC: ' + (rede ? rede.mac : '?') + ')</p>' +
            '</section>' +
            // Hosts
            '<section class="card"><h2>Hosts Monitorados (' + (linhas ? linhas.length : 0) + ')</h2>' +
            '<table class="tbl"><thead><tr><th>Nome</th><th>IP</th><th>Estado</th><th>Latencia</th><th>Falhas</th></tr></thead><tbody>' +
            (linhas ? linhas.map(function(l) {
                return '<tr><td>' + (l.nome || l.ip) + '</td><td>' + l.ip + '</td><td>' + l.estado + '</td><td>' + (l.latenciaMediaMs != null ? l.latenciaMediaMs + 'ms' : '—') + '</td><td>' + (l.falhasConsecutivas || 0) + '</td></tr>';
            }).join('') :
                '<tr><td colspan="5">Sem dados</td></tr>') +
            '</tbody></table>' +
            '</section>' +
            // Alertas
            '<section class="card"><h2>Alertas (' + (alertas ? alertas.length : 0) + ')</h2>' +
            (alertas ?
                '<table class="tbl"><thead><tr><th>Gravidade</th><th>Titulo</th><th>Confianca</th></tr></thead><tbody>' +
                alertas.map(function(a) {
                    return '<tr><td>' + a.gravidade + '</td><td>' + a.titulo + '</td><td>' + a.confianca + '</td></tr>';
                }).join('') +
                '</tbody></table>'
            : '<p>Nenhum alerta.</p>') +
            '</section>' +
            // Armazenamento
            '<section class="card"><h2>Armazenamento</h2>' +
            '<p>Medicoes hoje: ' + (hist && hist.medicoesHoje != null ? hist.medicoesHoje : '?') + ' | Total: ' + (hist && hist.totalMedicoes != null ? hist.totalMedicoes : '?') +
            ' (' + (hist && hist.diasComDados != null ? hist.diasComDados : '?') + ' dias) | Espaco: ' + (hist && hist.tamanhoTotalMB != null ? hist.tamanhoTotalMB + ' MB' : '?') + '</p>' +
            '</section>' +
            // Rodape
            '<div style="display:flex;justify-content:flex-end;margin-top:20px;">' +
            '<button onclick="window.print()">Imprimir / Salvar PDF</button>' +
            '<button onclick="window.close()">Fechar</button>' +
            '</div>' +
            '</div>';

        const w = window.open('', '_blank');
        if (!w) { alert('Pop-up bloqueado. Permita pop-ups para este site.'); return; }
        w.document.write(html);
        w.document.close();
    }).catch(function(e) {
        alert('Erro ao gerar relatorio: ' + (e && e.message));
    });
}

// ==================== UTIL ====================
function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
