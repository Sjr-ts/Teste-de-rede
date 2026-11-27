'use strict';
/**
 * Monitoramento e Diagnostico — frontend
 * Consome /api/monitor/* e /api/zabbix/* do server.cjs
 * Nao inicia testes de rede pelo navegador — apenas consulta dados ja coletados.
 */

// ==================== ESTADO ====================
let _monTimer = null;
let _monCpuTimer = null;
let _monDados = null;
let _monZabbix = null;
let _monSistema = null;
let _monCpuHist = [];
let _monRamHist = [];
let _monFiltroEstado = '';
let _monFiltroSetor = '';
let _monBusca = '';
let _monLocalIp = '127.0.0.1'; // IP de "este PC" — resolvido em /api/monitor/local
function monLocalIp() { return _monLocalIp; }
let _monEventSource = null;
let _monAlertasZabbix = [];
let _monKpiCharts = {};
let _monChartAtual = null;
let _monChartExpandido = false;
let _monCpuTempoReal = null; // valor atual da CPU em tempo real
let _monGpuTempoReal = null; // valor atual da GPU em tempo real
let _monCpuTs = 0;           // epoch ms da ultima CPU
let _monGpuTs = 0;           // epoch ms da ultima GPU
let _monGpuNome = null;      // nome da GPU (Intel Iris Xe etc.)
let _monGpuHist = []; // histórico de GPU para gráficos

// ==================== FAIXAS E LIMITES (fonte unica) ====================
// Toda cor de uso (%), todo "crit/warn" e todo limiar de grafico do frontend
// leem DAQUI. Antes os numeros estavam soltos em ~10 lugares e DRIFTAVAM
// (CPU virava "amarelo" a 50% numa tela e a 60% em outra) — agora e
// impossivel duas telas darem cores diferentes para o MESMO numero.
const MON_FAIXAS = {
    uso: { alerta: 60, critico: 80 },              // CPU / GPU / RAM (%)
    disco: { alerta: 70, critico: 90 },            // volume (%)
    disponibilidade: { minimo: 70, alvo: 90 }      // % de hosts respondendo
};

// Limites de alerta REAIS do coletor. O servidor reenvia os valores vigentes
// no payload (`limites`, vindo de monitor/service.js -> monitor/config.json);
// este objeto e so o FALLBACK para quando o payload nao os traz — e e
// identico ao LIMITES_PADRAO do backend (test/limiares.test.js trava os dois).
const MON_LIMITES_FALLBACK = { latenciaMediaMs: 80, latenciaP95Ms: 200, perdaPacotesPct: 10 };
let _monLimites = Object.assign({}, MON_LIMITES_FALLBACK);

// Mergeia os limites recebidos do servidor e devolve os vigentes.
function monAplicarLimites(payload) {
    if (payload && payload.limites && typeof payload.limites === 'object') {
        _monLimites = Object.assign({}, _monLimites, payload.limites);
    }
    return _monLimites;
}

// ---- semantica UNICA de cor de uso percentual ----
// Retorna null quando nao ha dado ("sem dado" != "verde").
function monNivelUso(pct) {                       // ' crit' | ' warn' | ''
    return pct > MON_FAIXAS.uso.critico ? ' crit' : pct > MON_FAIXAS.uso.alerta ? ' warn' : '';
}
function monCorUso(pct, corOk) {                  // 'red' | 'yellow' | corOk | null
    if (pct == null || isNaN(pct)) return null;
    return pct > MON_FAIXAS.uso.critico ? 'red' : pct > MON_FAIXAS.uso.alerta ? 'yellow' : (corOk || 'green');
}
function monCorDisco(pct, corOk) {
    if (pct == null || isNaN(pct)) return null;
    return pct > MON_FAIXAS.disco.critico ? 'red' : pct > MON_FAIXAS.disco.alerta ? 'yellow' : (corOk || 'green');
}
function monCorDisponibilidade(pct) {            // >= alvo verde, >= minimo amarelo
    return pct >= MON_FAIXAS.disponibilidade.alvo ? 'green' : pct >= MON_FAIXAS.disponibilidade.minimo ? 'yellow' : 'red';
}
function monCorPerda(pct) {                      // limite vem do servidor (config)
    if (pct == null || isNaN(pct)) return null;
    const lim = Number(_monLimites.perdaPacotesPct);
    return pct > (isFinite(lim) ? lim : 10) ? 'red' : pct > 0 ? 'yellow' : 'green';
}

// ---- limiares dos graficos (linhas tracejadas — padrao Grafana "Thresholds") ----
// CPU/GPU/RAM usam as MESMAS faixas das cores; latencia/perda usam os
// limites vigentes enviados pelo servidor. Nada aqui e inventado: sao
// exatamente os valores que o sistema ja usa para decidir cor/alerta.
function monLimiaresUso() {
    return [
        { v: MON_FAIXAS.uso.alerta, cor: '#ffe600', rotulo: MON_FAIXAS.uso.alerta + '% atencao' },
        { v: MON_FAIXAS.uso.critico, cor: '#ff5252', rotulo: MON_FAIXAS.uso.critico + '% critico' }
    ];
}
function monLimiaresDisco() {
    return [
        { v: MON_FAIXAS.disco.alerta, cor: '#ffe600', rotulo: MON_FAIXAS.disco.alerta + '% atencao' },
        { v: MON_FAIXAS.disco.critico, cor: '#ff5252', rotulo: MON_FAIXAS.disco.critico + '% critico' }
    ];
}
function monLimiaresLatencia() {
    const v = Number(_monLimites.latenciaMediaMs);
    return isFinite(v) && v > 0 ? [{ v: v, cor: '#ff9f43', rotulo: 'limite ' + v + 'ms' }] : [];
}
function monLimiaresPerda() {
    const v = Number(_monLimites.perdaPacotesPct);
    return isFinite(v) && v > 0 ? [{ v: v, cor: '#ff9f43', rotulo: 'limite ' + v + '%' }] : [];
}

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
    // CPU em tempo real: poll a cada 3 segundos (apenas quando secao visivel)
    if (_monCpuTimer) clearInterval(_monCpuTimer);
    _monCpuTimer = setInterval(function() {
        if (typeof document !== 'undefined' && !document.hidden) {
            const secao = document.getElementById('monitoramento');
            if (secao && !secao.classList.contains('hidden')) {
                monPollCpuTempoReal();
            }
        }
    }, 3000);
}

// Busca CPU e GPU em tempo real (endpoints dedicados)
async function monPollCpuTempoReal() {
    try {
        const [cpuRes, gpuRes] = await Promise.all([
            fetch('/api/monitor/cpu-tempo-real').then(r => r.json()).catch(() => null),
            fetch('/api/monitor/gpu-tempo-real').then(r => r.json()).catch(() => null)
        ]);
        
        // CPU
        if (cpuRes && cpuRes.cpu != null) {
            _monCpuTempoReal = cpuRes.cpu;
            _monCpuTs = cpuRes.ts || Date.now();
            // Adiciona ao histórico (mantém últimos 60 pontos)
            _monCpuHist.push(cpuRes.cpu);
            if (_monCpuHist.length > 60) _monCpuHist.shift();
            monAtualizarCpuNaTabela(cpuRes.cpu, cpuRes.ts);
            monAtualizarKpiCpu(cpuRes.cpu, cpuRes.ts);
        }

        // GPU
        if (gpuRes && gpuRes.gpu != null) {
            _monGpuTempoReal = gpuRes.gpu;
            _monGpuTs = gpuRes.ts || Date.now();
            if (gpuRes.nome) _monGpuNome = gpuRes.nome;
            // Adiciona ao histórico (mantém últimos 60 pontos)
            _monGpuHist.push(gpuRes.gpu);
            if (_monGpuHist.length > 60) _monGpuHist.shift();
            monAtualizarGpuNaTabela(gpuRes.gpu, gpuRes.nome || _monGpuNome, gpuRes.ts);
            monAtualizarKpiGpu(gpuRes.gpu, gpuRes.nome || _monGpuNome, gpuRes.ts);
        }
        // A linha de status acompanha CPU/GPU em tempo real
        try { monRenderTopo(_monSistema, _monZabbix, _monDados); } catch (e) {}
    } catch (e) {}
}

// Barra minima de uso: cor muda com a carga e acompanha o valor em tempo real.
function monBarraHtml(val) {
    const m = String(val == null ? '' : val).match(/(\d+(?:\.\d+)?)\s*%/);
    if (!m) return null;
    const n = Math.max(0, Math.min(100, Number(m[1])));
    const cor = 'var(--' + (monCorUso(n) || 'green') + ')';
    return '<span class="mon-uso"><span class="mon-uso-bar"><i style="width:' + n + '%;background:' + cor + ';"></i></span>' +
        '<span style="color:var(--cyan);font-weight:700;font-size:11px;">' + esc(String(val).trim()) + '</span></span>';
}

// Linha do PC local (este servidor) na tabela — match robusto via data-local
function monLinhaLocalTabela(tabela) {
    return tabela.querySelector('tr[data-local="1"]');
}

// Rotulo de idade honesta: "agora" (<2s) | "ha Ns" — nunca mostra dado velho como novo
function monIdadeHtml(ts) {
    if (!ts) return '<span style="font-size:9px;color:var(--green);">TEMPO REAL</span>';
    const seg = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    const cor = seg <= 2 ? 'var(--green)' : seg <= 6 ? 'var(--yellow)' : 'var(--orange)';
    const txt = seg <= 2 ? 'agora' : 'ha ' + seg + 's';
    return '<span style="font-size:9px;color:' + cor + ';">' + txt + '</span>';
}

// Atualiza a celula de CPU do MEU-PC na tabela
function monAtualizarCpuNaTabela(cpu, ts) {
    const tabela = document.getElementById('monTable');
    if (!tabela) return;
    const tbody = tabela.querySelector('tbody');
    if (!tbody) return;
    const tr = monLinhaLocalTabela(tbody);
    if (!tr) return;
    const tds = tr.querySelectorAll('td');
    if (tds.length >= 8) {
        const cpuCell = tds[3];
        cpuCell.innerHTML = (monBarraHtml(cpu.toFixed(1) + '%') || '') +
            '<br><span style="font-size:9px;color:var(--text-muted);" title="Contador % Processor Utility — o mesmo do Gerenciador de Tarefas">TEMPO REAL</span>' +
            '<br>' + monIdadeHtml(ts);
    }
}

// Atualiza a celula de GPU do MEU-PC na tabela
function monAtualizarGpuNaTabela(gpu, nome, ts) {
    const tabela = document.getElementById('monTable');
    if (!tabela) return;
    const tbody = tabela.querySelector('tbody');
    if (!tbody) return;
    const tr = monLinhaLocalTabela(tbody);
    if (!tr) return;
    const tds = tr.querySelectorAll('td');
    if (tds.length >= 8) {
        const gpuCell = tds[4];
        gpuCell.innerHTML = (monBarraHtml(gpu.toFixed(1) + '%') || '') +
            '<br><span style="font-size:9px;color:var(--text-muted);">' + esc(nome || 'GPU') + '</span>' +
            '<br>' + monIdadeHtml(ts);
    }
}

// Atualiza metricas em tempo real (CPU/GPU). Nao ha mais cards duplicados na
// grade: os valores aparecem no DETALHE do Computadores. Atualiza so o texto
// das metricas, sem reconstruir o overlay (evita flicker/recriar graficos).
let _monUltimaAtualizacaoDetalhe = 0;
function monAtualizarMetricasNoDetalhe() {
    const ct = document.getElementById('sdContainer-mon');
    if (!ct) return;
    const agora = Date.now();
    if (agora - _monUltimaAtualizacaoDetalhe < 900) return; // no maximo ~1x/s
    _monUltimaAtualizacaoDetalhe = agora;
    const dados = [
        ['cpu', _monCpuTempoReal, 'cyan'],
        ['gpu', _monGpuTempoReal, 'purple']
    ];
    for (const [tipo, valor, cor] of dados) {
        if (valor == null) continue;
        const el = ct.querySelector('[data-metrica="' + tipo + '"]');
        if (el) {
            el.textContent = valor.toFixed(1) + '%';
            el.style.color = 'var(--' + (monCorUso(valor, cor) || cor) + ')';
        }
    }
}

function monAtualizarKpiCpu(cpu, ts) {
    monAtualizarMetricasNoDetalhe();
}

function monAtualizarKpiGpu(gpu, nome, ts) {
    // atualiza o nome da GPU no detalhe se mudou
    const ct = document.getElementById('sdContainer-mon');
    if (ct && nome) {
        const nel = ct.querySelector('[data-metrica="gpu-nome"]');
        if (nel && nel.textContent !== nome) nel.textContent = nome;
    }
    monAtualizarMetricasNoDetalhe();
}

// Aplica innerHTML apenas quando o conteudo realmente mudou (evita reflow/flicker)
function monSetHtmlSeMudou(el, html) {
    if (el._lastHtml === html) return false;
    el._lastHtml = html;
    el.innerHTML = html;
    return true;
}

// ==================== AGREGACAO DE RENDER (anti-travamento) ====================
let _monDirty = false;
let _monProblemas = [];
let _monProblemasInfo = null;
let _monProblemasTs = 0;
let _monMostrarSilenciados = false;
// Filtros dinamicos do painel de problemas (estilo Zabbix problem view)
let _monProbFiltro = { texto: '', host: '', ordem: 'sev', soNaoRec: false, sev: '' };
let _monFalhaNotifTs = {};
let _monArmKPIsTs = 0;

function monRenderTudo(d) {
    // Limites de alerta vigentes acompanham o servidor (fonte da verdade)
    monAplicarLimites(d);
    try { monRenderKPIs(d); } catch (e) { console.error('[mon] KPIs:', e); }
    try { monRenderFiltroSetores(d); } catch (e) {}
    try { monRenderTabela(d); } catch (e) {}
    try { monRenderAlertas(d); } catch (e) {}
    try { monRenderIncidentes(d); } catch (e) {}
    try { monRenderDashboardWidget(); } catch (e) {}
    try { monRenderZabbixProblemas(); } catch (e) {}
    // notificacoes de falha no PONTO COMUM (SSE, polling e fallback), para nao
    // depender apenas do evento SSE — se ele cair, os toasts paravam de funcionar
    try { monNotificarFalhas(d); } catch (e) {}
}

// Notificacoes de falha com throttle (1x a cada 10 min por host/contagem)
function monNotificarFalhas(d) {
    // Nao notificar desligamento esperado/parada coletiva/IP obsoleto — esses
    // estados tem classificacao.suprimeAlerta=true e NAO sao falhas.
    const falhas = (d && d.linhas || []).filter(function (l) {
        if (l.classificacao && l.classificacao.suprimeAlerta) return false;
        if (l.estado === 'DESLIGADO_ESPERADO' || l.estado === 'EMPRESA_PARADA' || l.estado === 'IP_OBSOLETO') return false;
        return (l.falhasConsecutivas || 0) > 2 || l.estado === 'SEM_RESPOSTA';
    });
    const agora = Date.now();
    for (const f of falhas) {
        const key = (f.ip || '?') + ':' + (f.falhasConsecutivas || 0) + ':' + (f.estado || '');
        if (_monFalhaNotifTs[key] && (agora - _monFalhaNotifTs[key]) < 10 * 60 * 1000) continue;
        _monFalhaNotifTs[key] = agora;
        if (typeof showFailureNotification === 'function') {
            const alvo = f.nome || f.ip || 'host';
            const detalhe = f.estado === 'SEM_RESPOSTA'
                ? 'Host nao responde a ping. Verifique se esta ligado, o cabo/portas do switch e o firewall (regra ICMP).'
                : (f.falhasConsecutivas || 0) + ' falha(s) consecutiva(s). Verifique cabos, energia e o agente de monitoramento.';
            showFailureNotification('Falha de rede: ' + alvo, detalhe);
        }
    }
}

// ==================== DASHBOARD (widget no Painel) ====================
function monRenderDashboardWidget() {
    const onEl = document.getElementById('dshMonOnline');
    if (!onEl) return;
    const d = _monDados;
    const probEl = document.getElementById('dshMonProblemas');
    const pctEl = document.getElementById('dshMonPct');
    const barEl = document.getElementById('dshMonBar');
    const ultEl = document.getElementById('dshMonUltima');
    if (!d || !d.resumo) { if (ultEl) ultEl.textContent = 'Aguardando primeira coleta...'; return; }
    const r = d.resumo;
    const total = r.totalAlvos || 0;
    const acess = r.acessiveis || 0;
    onEl.textContent = acess + '/' + total;
    onEl.title = 'Equipamentos cadastrados acessiveis; o % exclui desligamentos planejados';
    // usa a MESMA disponibilidade operacional do card da aba de monitoramento
    const pct = r.disponibilidadeOperacional != null ? r.disponibilidadeOperacional
        : (total > 0 ? Math.round((acess / total) * 100) : 0);
    if (pctEl) pctEl.textContent = pct + '%';
    if (barEl) { barEl.style.width = pct + '%'; barEl.style.background = 'var(--' + monCorDisponibilidade(pct) + ')'; }
    if (!_monProblemasInfo) { monRenderZabbixProblemas(); }
    if (probEl) {
        const info = _monProblemasInfo;
        const n = info ? (typeof info.naoSuprimidos === 'number' ? info.naoSuprimidos : (typeof info.total === 'number' ? info.total : null)) : null;
        probEl.textContent = n == null ? '—' : String(n);
        probEl.style.color = (n || 0) > 0 ? 'var(--yellow)' : 'var(--green)';
        probEl.title = (info && info.criticosNaoSuprimidos ? info.criticosNaoSuprimidos + ' critico(s)' : 'sem criticos');
    }
    if (ultEl) ultEl.textContent = 'Ultima coleta: ' + (r.coletadoEm ? new Date(r.coletadoEm).toLocaleString('pt-BR') : '—');
}

// Escapa valor para embutir em handler inline JS entre aspas simples
function monJsAttr(s) {
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/</g, '\\x3C').replace(/>/g, '\\x3E').replace(/"/g, '&quot;').replace(/&/g, (m) => m === '&quot;' ? m : '&amp;');
}

/**
 * Escape completo para valor interpolado DENTRO de um atributo HTML delimitado
 * por aspas duplas QUE CONTEM um handler JS (ex.: onclick="fn('VALOR')").
 * Cobre & " ' < > — impede quebrar o atributo ou a string JS (XSS).
 */
function monAttr(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Base do Zabbix Web — sempre dinamica pelo hostname de onde o usuario abriu o app
// (funciona em localhost, 10.0.0.169, 192.168.0.x — sem IP fixo no codigo)
function monZabbixBase() {
    return 'http://' + window.location.hostname + ':8081';
}
function monZabbixUrl(hostid) {
    return monZabbixBase() + '/zabbix.php?action=problem.view&hostids[]=' + encodeURIComponent(hostid || '');
}
// Deep-link para a lista de hosts do Zabbix (host.view) — filtro por nome/grupo, dinamico
function monZabbixHostViewUrl(opts) {
    const params = ['action=host.view'];
    if (opts && opts.nome) params.push('name=' + encodeURIComponent(opts.nome));
    if (opts && opts.grupo) params.push('groupids[]=' + encodeURIComponent(opts.grupo));
    if (opts && opts.status !== undefined && opts.status !== null && opts.status !== '') {
        params.push('status=' + encodeURIComponent(opts.status));
    }
    params.push('sort=name');
    params.push('sortorder=ASC');
    return monZabbixBase() + '/zabbix.php?' + params.join('&');
}
// ==================== PROBLEMAS ZABBIX (painel integrado) ====================
const MON_SEV_INFO = {
    '5': { label: 'Desastre', cor: '#ff4757', bg: 'rgba(255,71,87,0.14)' },
    '4': { label: 'Alto', cor: '#ff6b81', bg: 'rgba(255,107,129,0.12)' },
    '3': { label: 'Medio', cor: '#ffa502', bg: 'rgba(255,165,2,0.12)' },
    '2': { label: 'Aviso', cor: '#ffe600', bg: 'rgba(255,230,0,0.10)' },
    '1': { label: 'Informacao', cor: '#00d4ff', bg: 'rgba(0,212,255,0.10)' },
    '0': { label: 'N/D', cor: '#8892a8', bg: 'rgba(136,146,168,0.12)' }
};

// Diagnostico/contorno por padrao do trigger (baseado na doc do Zabbix)
function monConselhoFalha(trigger) {
    const t = (trigger || '').toLowerCase();
    if (t.indexOf('googleupdater') >= 0 || t.indexOf('googleupdate') >= 0) {
        return {
            causa: 'Servico de atualizacao do Google (GoogleUpdaterService/GoogleUpdaterInternalService) parado em host Windows. O trigger do template "Windows services" detectou servico Windows em inicializacao Automatica que nao esta Running.',
            contornoHtml: '<ol style="margin:6px 0 0 18px;"><li>Abra <code>services.msc</code> no host e verifique o servico: tente iniciar manualmente e confira dependencias e o tipo de inicializacao.</li><li>Reinstale/atualize o Google Chrome (ou Edge) — isso recria os servicos GoogleUpdater automaticamente.</li><li>Verifique se o antivirus, GPO ou o AppLocker bloquearam a inicializacao do servico; adicione excecao se necessario.</li><li>Se o servico estiver obsoleto para este host, remova-o com <code>sc.exe delete GoogleUpdaterService157.0.8089.0</code> (como Administrador) ou desabilite a checagem ajustando o trigger no Zabbix.</li><li>Se reincidir, abra chamados/O.S. e investigue com o Visualizador de Eventos (Aplicativo e Sistema) a falha na inicializacao.</li></ol>',
            contornoTexto: '1) services.msc: iniciar o servico e verificar dependencias; 2) Reinstalar o Google Chrome para recriar o servico; 3) Verificar antivirus/GPO/AppLocker; 4) Se obsoleto, remover com sc.exe delete <servico> (admin); 5) Revisar Visualizador de Eventos e abrir O.S. se reincidir.',
            notifica: 'Servico GoogleUpdater parado. Inicie em services.msc ou reinstale o Chrome; se for obsoleto, remova o servico.'
        };
    }
    if (t.indexOf('active checks are not available') >= 0) {
        return {
            causa: 'O agente Zabbix (modo ativo) nao consegue reportar dados ao servidor. Tipico de PC desligado, sem rede, ou agente parado no host remoto.',
            contornoHtml: '<ol style="margin:6px 0 0 18px;"><li>Confirme se o PC esta ligado e na rede (ping/endereco IP, porta do switch).</li><li>Verifique se o servico "Zabbix Agent 2" (ou "Zabbix Agent") esta rodando no host (services.msc) e se o config aponta para o servidor correto (Hostname e ServerActive).</li><li>Verifique o firewall do host remoto e/ou do Zabbix server (porta 10051/TCP de saida).</li><li>Se a rede foi migrada/alterou faixa, ajuste o parametro ServerActive/Hostname do agente e reinicie o servico.</li></ol>',
            contornoTexto: '1) PC ligado e na rede; 2) Servico Zabbix Agent rodando + Hostname/ServerActive corretos (services.msc); 3) Firewall liberando 10051/TCP; 4) Apos migracao de rede, ajustar ServerActive e reiniciar o agente.',
            notifica: 'Agente Zabbix sem dados. Verificar energia/rede/agente no host remoto.'
        };
    }
    if (t.indexOf('more than 100 items') >= 0 || t.indexOf('missing data') >= 0) {
        return {
            causa: 'Mais de 100 itens do Zabbix pararam de receber dados ha mais de 10 minutos — tipicamente causado por host(s) sem contato (rede/agente), afetando a coleta em massa.',
            contornoHtml: '<ol style="margin:6px 0 0 18px;"><li>Identifique os hosts afetados no problem view do Zabbix e verifique conectividade/agente deles.</li><li>Confirme se houve migracao/mudanca de rede do servidor de monitoramento (faixa de IP).</li><li>Verifique os agentes e reinicie-os se necessario; acompanhe este alerta ate normalizar (some quando os dados voltarem).</li></ol>',
            contornoTexto: '1) Identifique no painel quais hosts pararam; 2) Checar rede/agente deles; 3) Reiniciar agente se necessario; o alerta normaliza quando os dados voltarem.',
            notifica: 'Coleta Zabbix com muitos itens sem dados (host sem contato). Ver hosts afetados.'
        };
    }
    if (t.indexOf('is not running') >= 0 && t.indexOf('windows') >= 0) {
        return {
            causa: 'Servico Windows monitorado pelo Zabbix (template "Windows services") esta parado, embora configurado como Automatic.',
            contornoHtml: '<ol style="margin:6px 0 0 18px;"><li>Identifique o servico exato no <code>services.msc</code> e tente inicia-lo manualmente.</li><li>Confira dependencias (aba Dependencias) e logs de eventos no Visualizador de Eventos.</li><li>Verifique se o executavel foi removido/movido ou bloqueado por antivirus.</li><li>Corrija a causa raiz; se for esperado, ajuste o trigger ou remova o servico da checagem.</li></ol>',
            contornoTexto: '1) services.msc: iniciar servico e verificar dependencias; 2) Visualizador de Eventos para causa; 3) Antivirus/GPO; 4) Ajustar trigger se for esperado.',
            notifica: 'Servico Windows parado. Inicie em services.msc e verifique dependencias/antivirus.'
        };
    }
    if (t.indexOf('high icmp ping loss') >= 0) {
        return {
            causa: 'Perda de pacotes ICMP acima do limite configurado no trigger "ICMP Ping". Indica problema de rede fisica, enlace saturado ou host em sobrecarga.',
            contornoHtml: '<ol style="margin:6px 0 0 18px;"><li>Teste continuo: <code>ping -t 192.168.0.x</code> e anote a perda.</li><li>Verifique cabo de rede, porta do switch, LED de link, Wi-Fi instavel ou duplex mismatch.</li><li>Verifique saturacao de link (trafego, broadcast storm) e altere a porta do switch.</li><li>Confira CPU do host (perda por sobrecarga) e dos switches/roteadores.</li></ol>',
            contornoTexto: '1) ping continuo; 2) Cabo/porta de switch/LED/duplex; 3) Saturacao de link; 4) CPU do host e dos equipamentos de rede.',
            notifica: 'Perda de pacotes ICMP alta. Verificar cabo/switch/saturacao de link.'
        };
    }
    if (t.indexOf('unavailable by icmp ping') >= 0) {
        return {
            causa: 'Host nao responde a ping. Pode estar desligado, sem rede, com firewall bloqueando ICMP ou cabo desconectado.',
            contornoHtml: '<ol style="margin:6px 0 0 18px;"><li>Confirme se o PC esta ligado (energia, nobreak, tela) e se a rede esta ok (IP/gateway/VLAN).</li><li>Verifique cabo e porta do switch; teste outra porta/cabo.</li><li>Verifique a regra de firewall permitindo ICMP (echo request/reply).</li><li>Se houve manutencao, registre no Zabbix (reconhecer) para nao poluir alertas.</li></ol>',
            contornoTexto: '1) Host ligado?; 2) Cabo/porta/VLAN; 3) Firewall liberando ICMP; 4) Reconhecer no Zabbix se for manutencao.',
            notifica: 'Host incontactable por ICMP. Verificar energia/rede/firewall.'
        };
    }
    if (t.indexOf('high icmp ping response time') >= 0) {
        return {
            causa: 'Latencia ICMP acima do limite. Geralmente causada por rede congestionada, switch/porta com problema, cabo ruim ou host sobrecarregado.',
            contornoHtml: '<ol style="margin:6px 0 0 18px;"><li>Meca latencia com <code>ping -t</code> e compare com outros hosts da mesma VLAN.</li><li>Teste outro cabo/porta; verifique erros CRC na porta do switch (<code>show interfaces</code>).</li><li>Verifique saturacao de link/broadcast e CPU do host.</li><li>Se persistente, isole o segmento de rede e troque o cabo/porta.</li></ol>',
            contornoTexto: '1) ping -t comparativo; 2) Outro cabo/porta + erros CRC; 3) Saturacao/broadcast/CPU; 4) Isolar segmento de rede.',
            notifica: 'Latencia ICMP alta. Verificar cabo/porta/saturacao.'
        };
    }
    if (t.indexOf('not running') >= 0) {
        return {
            causa: 'Processo/servico monitorado pelo Zabbix nao esta Running (item "service state" do agente).',
            contornoHtml: '<ol style="margin:6px 0 0 18px;"><li>Localize o servico (services.msc) ou processo citado no trigger e inicie-o.</li><li>Verifique logs de eventos e dependencias do servico.</li><li>Se reincidir, investigue causa raiz (crashes, conflitos, atualizacoes) e abra O.S. de analise.</li></ol>',
            contornoTexto: '1) Iniciar o servico/processo citado; 2) Verificar eventos/dependencias; 3) Investigar recorrencia e abrir O.S.',
            notifica: 'Servico/processo parado. Iniciar e investigar causa raiz.'
        };
    }
    return {
        causa: 'Problema detectado pelo Zabbix (problem.get). Analise a expressao do trigger e o item associado no host.',
        contornoHtml: '<ol style="margin:6px 0 0 18px;"><li>Abra o problema no Zabbix (botao "Abrir no Zabbix") e veja o historico do item.</li><li>Identifique a causa raiz (servico, rede, espaco/disco, CPU/memoria).</li><li>Corrija e reconheca o problema no Zabbix para registrar o tratamento.</li><li>Se for falso positivo, ajuste o trigger ou remova a checagem.</li></ol>',
        contornoTexto: '1) Ver historico do item no Zabbix; 2) Identificar causa raiz; 3) Corrigir e reconhecer; 4) Ajustar trigger se falso positivo.',
        notifica: 'Problema detectado pelo Zabbix. Ver historico e reconhecer apos tratar.'
    };
}

function monSevInfo(sev) { return MON_SEV_INFO[String(sev)] || MON_SEV_INFO['0']; }

function monProblemaPorId(eventid) {
    return (_monProblemas || []).find(function (p) { return p.eventid === String(eventid); }) || null;
}

async function monRenderZabbixProblemas(forcar) {
    const el = document.getElementById('mon-zabbix-problemas');
    const agora = Date.now();
    if (!forcar && _monProblemasTs && (agora - _monProblemasTs) < 20000) { if (el) monRenderProblemasLista(el); return; }
    try {
        const r = await fetch('/api/zabbix/problemas');
        const d = await r.json();
        _monProblemasInfo = d || { conectado: false, erro: 'Resposta vazia', total: 0, problemas: [] };
        _monProblemas = (_monProblemasInfo && _monProblemasInfo.problemas) || [];
        _monProblemasTs = Date.now();
    } catch (e) {
        _monProblemasInfo = { conectado: false, erro: e.message, total: 0, criticos: 0, naoReconhecidos: 0, problemas: [] };
        _monProblemas = [];
    }
    if (el) monRenderProblemasLista(el);
    try { monAtualizarTemposRelativos(); } catch (e) {}
    monRenderDashboardWidget();
}

function monToggleSilenciados() {
    _monMostrarSilenciados = !_monMostrarSilenciados;
    const el = document.getElementById('mon-zabbix-problemas');
    if (el) monRenderProblemasLista(el);
}

// ==================== FILTROS DINAMICOS ====================
function monProbFiltroTexto(v) { _monProbFiltro.texto = (v || '').toLowerCase(); monReRenderProblemas(); }
function monProbFiltroHost(v) { _monProbFiltro.host = v || ''; monReRenderProblemas(); }
function monProbOrdem(v) { _monProbFiltro.ordem = v || 'sev'; monReRenderProblemas(); }
function monProbSoNaoRec(v) { _monProbFiltro.soNaoRec = !!v; monReRenderProblemas(); }
function monProbChipSev(sev) {
    _monProbFiltro.sev = (_monProbFiltro.sev === String(sev)) ? '' : String(sev);
    monReRenderProblemas();
}
function monReRenderProblemas() {
    const el = document.getElementById('mon-zabbix-problemas');
    if (el) monRenderProblemasLista(el);
}

// Aplica todos os filtros ativos e retorna a lista final de problemas
function monProbFiltrados() {
    const f = _monProbFiltro;
    let lista = (_monProblemas || []).slice();
    // Silenciados ficam de fora por padrao
    if (!_monMostrarSilenciados) lista = lista.filter(function (p) { return !p.suppressed; });
    if (f.soNaoRec) lista = lista.filter(function (p) { return !p.reconhecido; });
    if (f.sev !== '') lista = lista.filter(function (p) { return String(p.severidade) === f.sev; });
    if (f.host) lista = lista.filter(function (p) { return String(p.hostid || '') === f.host; });
    if (f.texto) {
        lista = lista.filter(function (p) {
            const alvo = ((p.trigger || '') + ' ' + (p.host || '') + ' ' + (p.hostTecnico || '') + ' ' +
                (p.tags || []).map(function (t) { return (t.tag || '') + '=' + (t.value || ''); }).join(' ')).toLowerCase();
            return alvo.indexOf(f.texto) >= 0;
        });
    }
    const rank = { '5': 5, '4': 4, '3': 3, '2': 2, '1': 1, '0': 0 };
    if (f.ordem === 'recente') {
        lista.sort(function (a, b) { return (new Date(b.inicio || 0)) - (new Date(a.inicio || 0)); });
    } else if (f.ordem === 'antigo') {
        lista.sort(function (a, b) { return (new Date(a.inicio || 0)) - (new Date(b.inicio || 0)); });
    } else {
        lista.sort(function (a, b) {
            const d = (rank[String(b.severidade)] || 0) - (rank[String(a.severidade)] || 0);
            if (d !== 0) return d;
            return (new Date(b.inicio || 0)) - (new Date(a.inicio || 0));
        });
    }
    return lista;
}

// ==================== TEMPO RELATIVO (PT-BR) ====================
function monTempoRelativo(dataIso) {
    if (!dataIso) return '—';
    const t = (dataIso instanceof Date) ? dataIso.getTime() : new Date(dataIso).getTime();
    if (isNaN(t)) return '—';
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 45) return 'agora';
    const m = Math.floor(s / 60);
    if (m < 60) return 'ha ' + m + ' min';
    const h = Math.floor(m / 60);
    if (h < 24) return 'ha ' + h + 'h' + (m % 60 ? ' ' + (m % 60) + 'min' : '');
    const d = Math.floor(h / 24);
    return 'ha ' + d + ' dia' + (d > 1 ? 's' : '');
}

// Atualiza APENAS os textos de tempo (sem re-render — anti-travamento)
function monAtualizarTemposRelativos() {
    const spans = document.querySelectorAll('[data-mon-tempo]');
    for (const sp of spans) {
        const novo = monTempoRelativo(sp.getAttribute('data-mon-tempo'));
        if (novo !== '—' && sp.textContent !== novo) sp.textContent = novo;
    }
    const age = document.getElementById('mon-zabbix-problemas-age');
    if (age && _monProblemasTs) age.textContent = 'auto ' + monTempoRelativo(new Date(_monProblemasTs).toISOString());
}
setInterval(function () {
    const secao = document.getElementById('monitoramento');
    if (secao && secao.classList.contains('hidden')) return;
    monAtualizarTemposRelativos();
}, 30000);

// ==================== CHIPS DE SEVERIDADE + DROPDOWN DE HOST ====================
function monRenderProbChips() {
    const chipsEl = document.getElementById('mon-prob-chips');
    if (!chipsEl) return;
    const info = _monProblemasInfo || {};
    const pSv = info.porSeveridade || {};
    const ordem = ['5', '4', '3', '2', '1', '0'];
    const totalVis = monProbFiltrados().length;
    let html = '';
    for (const s of ordem) {
        const n = pSv[s] || 0;
        if (n === 0 && _monProbFiltro.sev !== s) continue;
        const sev = monSevInfo(s);
        const ativo = _monProbFiltro.sev === s;
        html += '<button onclick="monProbChipSev(\'' + s + '\')" title="Filtrar por severidade ' + esc(sev.label) + '"' +
            ' style="display:inline-flex;align-items:center;gap:5px;border:1px solid ' + (ativo ? sev.cor : 'var(--border)') + ';' +
            'background:' + (ativo ? sev.bg : 'rgba(0,0,0,0.2)') + ';color:' + (ativo ? sev.cor : 'var(--text-secondary)') + ';' +
            'border-radius:20px;padding:3px 10px;font-size:10px;font-weight:700;cursor:pointer;' +
            (ativo ? 'box-shadow:0 0 0 1px ' + sev.cor + ' inset;' : '') + '">' +
            '<span style="width:8px;height:8px;border-radius:50%;background:' + sev.cor + ';display:inline-block;"></span>' +
            esc(sev.label) + ' <b>' + n + '</b></button>';
    }
    html += '<span style="font-size:10px;color:var(--text-muted);margin-left:auto;align-self:center;">' +
        totalVis + ' de ' + ((_monProblemas || []).filter(function (p) { return _monMostrarSilenciados || !p.suppressed; }).length) + ' exibido(s)</span>';
    chipsEl.innerHTML = html;

    // Popula dropdown de hosts (somente quando a lista muda)
    const hostSel = document.getElementById('mon-prob-host');
    if (hostSel) {
        const hosts = {};
        for (const p of (_monProblemas || [])) {
            const id = String(p.hostid || '');
            if (id && !hosts[id]) hosts[id] = p.host || id;
        }
        const atual = _monProbFiltro.host;
        const opcoes = Object.keys(hosts).sort(function (a, b) { return String(hosts[a]).localeCompare(String(hosts[b])); })
            .map(function (id) { return '<option value="' + esc(id) + '"' + (id === atual ? ' selected' : '') + '>' + esc(hosts[id]) + '</option>'; }).join('');
        const esperado = '<option value="">Todos os hosts</option>' + opcoes;
        if (hostSel.getAttribute('data-assinatura') !== esperado) {
            hostSel.innerHTML = esperado;
            hostSel.setAttribute('data-assinatura', esperado);
        }
    }
}

function monRenderProblemasLista(el) {
    const info = _monProblemasInfo || {};
    const todos = _monProblemas || [];
    const suprimidos = todos.filter(function (p) { return p.suppressed; }).length;
    const visiveis = monProbFiltrados();

    // Atualiza contador/botao de silenciados
    const btn = document.getElementById('mon-toggle-silenciados');
    if (btn) {
        btn.style.opacity = suprimidos > 0 ? '1' : '0.55';
        btn.innerHTML = (_monMostrarSilenciados ? '<i class="fas fa-eye"></i> Ocultar silenciados: ' : '<i class="fas fa-eye-slash"></i> Silenciados: ') + '<span id="mon-silenciados-count">' + suprimidos + '</span>';
    }
    const resumoEl = document.getElementById('mon-zabbix-problemas-resumo');
    if (resumoEl) {
        if (!info.conectado) resumoEl.innerHTML = '<span style="color:var(--red);"><i class="fas fa-plug-circle-xmark"></i> Zabbix desconectado</span>';
        else resumoEl.innerHTML = '<b style="color:var(--text-primary);">' + (info.naoSuprimidos != null ? info.naoSuprimidos : 0) + '</b> aberto(s) &middot; <b style="color:var(--red);">' + (info.criticosNaoSuprimidos || 0) + '</b> critico(s) &middot; <b style="color:var(--yellow);">' + (info.naoReconhecidos || 0) + '</b> sem reconhecer';
    }
    // Chips + dropdown de hosts
    try { monRenderProbChips(); } catch (e) {}

    // Footer com contagem + acao em massa
    const footer = document.getElementById('mon-prob-footer');
    const contEl = document.getElementById('mon-prob-contagem');
    const ackTodosBtn = document.getElementById('mon-btn-ack-todos');
    if (footer) footer.style.display = info.conectado ? 'flex' : 'none';
    if (contEl) contEl.textContent = 'Exibindo ' + visiveis.length + ' de ' + todos.length + ' problema(s)' +
        (_monProbFiltro.texto || _monProbFiltro.host || _monProbFiltro.sev !== '' || _monProbFiltro.soNaoRec ? ' (filtros ativos)' : '');
    if (ackTodosBtn) {
        const pendentes = visiveis.filter(function (p) { return !p.reconhecido; }).length;
        ackTodosBtn.style.display = pendentes > 0 ? 'inline-flex' : 'none';
        ackTodosBtn.innerHTML = '<i class="fas fa-check-double" style="color:var(--green);"></i> Reconhecer todos visiveis (' + pendentes + ')';
    }

    if (!info.conectado) {
        el.innerHTML = '<div style="padding:16px;"><p style="color:var(--red);font-size:13px;font-weight:600;"><i class="fas fa-plug-circle-xmark"></i> Nao foi possivel consultar o Zabbix.</p><p style="color:var(--text-muted);font-size:12px;margin-top:6px;">' + esc(info.erro || 'Erro desconhecido') + '</p><p style="color:var(--text-muted);font-size:11px;margin-top:8px;">Para restaurar: inicie o Docker Desktop e rode <code>docker compose -f docker-compose.zabbix.yml up -d</code>, depois clique em Atualizar.</p></div>';
        return;
    }
    if (!visiveis.length) {
        const filtrando = _monProbFiltro.texto || _monProbFiltro.host || _monProbFiltro.sev !== '' || _monProbFiltro.soNaoRec;
        if (filtrando) {
            el.innerHTML = '<div style="padding:22px;text-align:center;"><i class="fas fa-filter" style="font-size:26px;color:var(--cyan);opacity:0.55;"></i><p style="margin:10px 0 0;color:var(--text-secondary);font-size:13px;">Nenhum problema corresponde aos filtros.</p><p style="color:var(--text-muted);font-size:11px;">Ajuste a busca, host ou severidade — ou clique em "Limpar filtros".</p><button class="btn btn-ghost btn-sm" style="margin-top:10px;font-size:11px;" onclick="monProbLimparFiltros()"><i class="fas fa-eraser"></i> Limpar filtros</button></div>';
        } else {
            el.innerHTML = '<div style="padding:22px;text-align:center;"><i class="fas fa-circle-check" style="font-size:30px;color:var(--green);opacity:0.6;"></i><p style="margin:10px 0 0;color:var(--text-secondary);font-size:13px;">Nenhum problema aberto no Zabbix.</p><p style="color:var(--text-muted);font-size:11px;">' + (suprimidos > 0 ? suprimidos + ' problema(s) silenciado(s) ocultados — use "Silenciados" na barra.' : 'Todos os triggers estao em estado OK.') + '</p></div>';
        }
        return;
    }
    el.innerHTML = visiveis.map(monProblemaItemHtml).join('');
    try { monAtualizarTemposRelativos(); } catch (e) {}
}

function monProbLimparFiltros() {
    _monProbFiltro = { texto: '', host: '', ordem: 'sev', soNaoRec: false, sev: '' };
    const busca = document.getElementById('mon-prob-busca'); if (busca) busca.value = '';
    const hostSel = document.getElementById('mon-prob-host'); if (hostSel) hostSel.value = '';
    const ordem = document.getElementById('mon-prob-ordem'); if (ordem) ordem.value = 'sev';
    const chk = document.getElementById('mon-prob-so-nao-rec'); if (chk) chk.checked = false;
    monReRenderProblemas();
}

// Linha COMPACTA: uma linha por problema + clique abre detalhe completo
function monProblemaItemHtml(p) {
    const sev = monSevInfo(p.severidade);
    const inicio = p.inicio ? new Date(p.inicio) : null;
    const conselho = monConselhoFalha(p.trigger);
    const tags = (p.tags || []).slice(0, 4).map(function (t) {
        return '<span class="badge badge-inativo" style="font-size:9px;">' + esc(t.tag || '') + (t.value ? '=' + esc(t.value) : '') + '</span>';
    }).join(' ');
    const ackBadge = p.reconhecido
        ? '<span class="badge badge-ativo" title="Problema reconhecido no Zabbix"><i class="fas fa-check"></i> Rec.</span>'
        : '<span class="badge badge-cancelada" title="Ainda nao reconhecido"><i class="fas fa-triangle-exclamation"></i> Nao rec.</span>';
    const supBadge = p.suppressed
        ? '<span class="badge badge-inativo" title="Problema silenciado/suprimido no Zabbix"><i class="fas fa-eye-slash"></i> Silenciado</span>' : '';
    const truncado = p.trigger && p.trigger.length > 110 ? p.trigger.substring(0, 110) + '…' : (p.trigger || '');
    return '<div class="mon-prob-item" style="border:1px solid var(--border);border-left:4px solid ' + sev.cor + ';border-radius:10px;padding:8px 12px;margin-bottom:6px;background:' + sev.bg + ';cursor:pointer;transition:background 0.15s;"' +
        ' onclick="monAbrirDetalheProblema(\'' + monJsAttr(p.eventid) + '\')"' +
        ' onmouseover="this.style.background=\'' + sev.cor + '22\'" onmouseout="this.style.background=\'' + sev.bg + '\'">' +
        '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">' +
            '<span style="display:inline-flex;align-items:center;gap:5px;background:' + sev.cor + ';color:#0b1020;font-size:9px;font-weight:800;letter-spacing:0.5px;text-transform:uppercase;border-radius:5px;padding:3px 8px;white-space:nowrap;">' + esc(sev.label) + '</span>' +
            '<b style="font-size:12px;color:var(--text-primary);flex:1;min-width:220px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(p.trigger || '') + '">' + esc(truncado) + '</b>' +
            '<span style="font-size:10px;color:var(--text-secondary);white-space:nowrap;"><i class="fas fa-desktop"></i> ' + esc(p.host || '?') + '</span>' +
            '<span style="font-size:10px;color:var(--orange);white-space:nowrap;font-weight:600;" data-mon-tempo="' + esc(inicio ? inicio.toISOString() : '') + '" title="Inicio: ' + esc(inicio ? inicio.toLocaleString('pt-BR') : '—') + '">' + esc(monTempoRelativo(inicio)) + '</span>' +
            ackBadge + supBadge +
            '<span style="display:flex;gap:4px;margin-left:auto;">' +
                (p.reconhecido ? '' : '<button class="btn btn-ghost btn-sm" style="padding:3px 8px;font-size:10px;" onclick="event.stopPropagation();monAckProblema(\'' + monJsAttr(p.eventid) + '\')" title="Reconhecer"><i class="fas fa-check-double" style="color:var(--green);"></i></button>') +
                '<button class="btn btn-ghost btn-sm" style="padding:3px 8px;font-size:10px;" onclick="event.stopPropagation();monAbrirOSFalha(\'' + monJsAttr(p.eventid) + '\')" title="Criar Ordem de Servico"><i class="fas fa-clipboard-list" style="color:var(--purple);"></i></button>' +
            '</span>' +
        '</div>' +
        (tags ? '<div style="margin-top:5px;display:flex;gap:4px;flex-wrap:wrap;align-items:center;"><span style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Tags:</span>' + tags + '</div>' : '') +
    '</div>';
}

// ==================== DETALHE DO PROBLEMA (modal) ====================
function monAbrirDetalheProblema(eventid) {
    const p = monProblemaPorId(eventid);
    if (!p) { if (typeof showToast === 'function') showToast('Problema nao encontrado.', 'error'); return; }
    const sev = monSevInfo(p.severidade);
    const conselho = monConselhoFalha(p.trigger);
    const inicio = p.inicio ? new Date(p.inicio) : null;
    const tags = (p.tags || []).length ? (p.tags || []).map(function (t) {
        return '<span class="badge badge-inativo" style="font-size:10px;margin-right:4px;">' + esc(t.tag || '') + (t.value ? ' = ' + esc(t.value) : '') + '</span>';
    }).join('') : '<span style="color:var(--text-muted);font-size:11px;">Sem tags</span>';
    const ackMsgs = p.mensagensAck ? '<p style="margin-top:6px;font-size:11px;color:var(--text-muted);"><i class="fas fa-comment-dots"></i> ' + p.mensagensAck + ' mensagem(ns) de reconhecimento registrada(s).</p>' : '';
    const footer =
        '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">' +
        (p.reconhecido ? '' : '<button class="btn btn-ghost btn-sm" onclick="monAckProblema(\'' + monJsAttr(p.eventid) + '\');setTimeout(function(){if(typeof monFecharModalProblema===\'function\')monFecharModalProblema();},400);"><i class="fas fa-check-double" style="color:var(--green);"></i> Reconhecer</button>') +
        '<button class="btn btn-ghost btn-sm" onclick="monAbrirZabbixHost(\'' + monJsAttr(p.hostid || '') + '\')"><i class="fas fa-external-link-alt" style="color:var(--cyan);"></i> Abrir no Zabbix</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="monAbrirOSFalha(\'' + monJsAttr(p.eventid) + '\')"><i class="fas fa-clipboard-list" style="color:var(--purple);"></i> Abrir O.S.</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="monVerInventario(\'' + monJsAttr(p.hostTecnico || p.host || '') + '\')"><i class="fas fa-desktop" style="color:var(--green);"></i> Inventario</button>' +
        '</div>';
    const body =
        '<div style="padding:4px 2px;">' +
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">' +
            '<span style="display:inline-flex;align-items:center;gap:6px;background:' + sev.cor + ';color:#0b1020;font-size:10px;font-weight:800;text-transform:uppercase;border-radius:6px;padding:4px 10px;">' + esc(sev.label) + '</span>' +
            (p.reconhecido ? '<span class="badge badge-ativo"><i class="fas fa-check"></i> Reconhecido</span>' : '<span class="badge badge-cancelada"><i class="fas fa-triangle-exclamation"></i> Nao reconhecido</span>') +
            (p.suppressed ? '<span class="badge badge-inativo"><i class="fas fa-eye-slash"></i> Silenciado</span>' : '') +
        '</div>' +
        '<p style="font-size:13px;color:var(--text-primary);font-weight:700;line-height:1.5;margin:0 0 10px;">' + esc(p.trigger || '') + '</p>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:12px;">' +
            '<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;padding:8px 10px;"><div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Host</div><div style="font-size:12px;font-weight:600;margin-top:2px;">' + esc(p.host || '?') + '</div></div>' +
            '<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;padding:8px 10px;"><div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Inicio</div><div style="font-size:12px;font-weight:600;margin-top:2px;">' + esc(inicio ? inicio.toLocaleString('pt-BR') : '—') + '</div></div>' +
            '<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;padding:8px 10px;"><div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Duracao</div><div style="font-size:12px;font-weight:600;margin-top:2px;color:var(--orange);" data-mon-tempo="' + esc(inicio ? inicio.toISOString() : '') + '">' + esc(monTempoRelativo(inicio)) + '</div></div>' +
            '<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;padding:8px 10px;"><div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">EventID</div><div style="font-size:12px;font-weight:600;margin-top:2px;">' + esc(p.eventid) + '</div></div>' +
        '</div>' +
        '<div style="margin-bottom:10px;"><div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px;">Tags</div>' + tags + '</div>' +
        (p.opdata ? '<div style="margin-bottom:10px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;padding:8px 10px;"><div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Dados operacionais (opdata)</div><div style="font-size:12px;margin-top:3px;">' + esc(p.opdata) + '</div></div>' : '') +
        '<div style="background:rgba(0,0,0,0.18);border:1px solid var(--border);border-radius:8px;padding:10px 12px;">' +
            '<div style="font-size:11px;font-weight:700;color:var(--cyan);margin-bottom:6px;"><i class="fas fa-stethoscope"></i> Diagnostico e plano de acao</div>' +
            '<p style="font-size:11px;color:var(--text-secondary);line-height:1.7;margin:0;"><b style="color:var(--text-primary);">Causa provavel:</b> ' + esc(conselho.causa) + '</p>' +
            '<div style="font-size:11px;color:var(--text-secondary);line-height:1.7;margin-top:6px;"><b style="color:var(--text-primary);">Como contornar:</b>' + conselho.contornoHtml + '</div>' +
            ackMsgs +
        '</div>' +
        '</div>';
    if (typeof openModal === 'function') openModal('Problema #' + esc(p.eventid) + ' — ' + esc(p.host || ''), body, footer);
}

function monFecharModalProblema() {
    if (typeof closeModal === 'function') { closeModal(); return; }
    const m = document.getElementById('modal-overlay');
    if (m) m.classList.remove('active');
}

// ==================== ACAO EM MASSA + URL DINAMICA NO ZABBIX ====================
async function monAckTodosVisiveis() {
    const pendentes = monProbFiltrados().filter(function (p) { return !p.reconhecido; });
    if (!pendentes.length) { if (typeof showToast === 'function') showToast('Nenhum problema pendente de reconhecimento.', 'success'); return; }
    const msg = prompt('Mensagem de reconhecimento para os ' + pendentes.length + ' problema(s) visivel(is):', 'Em analise pelo time de TI — ' + new Date().toLocaleString('pt-BR'));
    if (msg === null) return;
    try {
        const r = await fetch('/api/zabbix/problemas/ack', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventids: pendentes.map(function (p) { return p.eventid; }), message: msg || 'Reconhecido via Inventario TI' })
        });
        const d = await r.json();
        if (!r.ok || d.ok === false) throw new Error((d && d.error) || ('HTTP ' + r.status));
        const falhas = (d.falhas || []).length;
        if (typeof showToast === 'function') showToast((falhas ? falhas + ' falha(s), ' : '') + (d.resultados || []).length + ' problema(s) reconhecido(s) no Zabbix.', falhas ? 'error' : 'success');
        if (typeof pushLog === 'function') pushLog('ALTERACAO', 'MONITORAMENTO', null, 'Zabbix ACK em massa: ' + pendentes.length + ' problema(s) reconhecido(s)');
        monRenderZabbixProblemas(true);
    } catch (e) {
        if (typeof showToast === 'function') showToast('Falha ao reconhecer em massa: ' + e.message, 'error');
    }
}

async function monAckProblema(eventid) {
    const p = monProblemaPorId(eventid);
    if (!p) { if (typeof showToast === 'function') showToast('Problema nao encontrado na lista local.', 'error'); return; }
    const msg = prompt('Mensagem de reconhecimento (sera registrada no Zabbix):', 'Em analise pelo time de TI — ' + new Date().toLocaleString('pt-BR'));
    if (msg === null) return; // usuario cancelou
    try {
        const r = await fetch('/api/zabbix/problemas/ack', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventid: p.eventid, message: msg || 'Reconhecido via Inventario TI' })
        });
        const d = await r.json();
        if (!r.ok || d.ok === false) throw new Error((d && d.error) || ('HTTP ' + r.status));
        if (typeof showToast === 'function') showToast('Problema reconhecido no Zabbix.', 'success');
        if (typeof pushLog === 'function') pushLog('ALTERACAO', 'MONITORAMENTO', p.eventid, 'Zabbix ACK: ' + p.trigger + ' @ ' + p.host);
        monRenderZabbixProblemas(true);
    } catch (e) {
        if (typeof showToast === 'function') showToast('Falha ao reconhecer: ' + e.message, 'error');
    }
}

function monAbrirZabbixHost(hostid) {
    const url = monZabbixUrl(hostid);
    window.open(url, '_blank', 'noopener');
}

function monAbrirOSFalha(eventid) {
    const p = monProblemaPorId(eventid);
    if (!p) { if (typeof showToast === 'function') showToast('Problema nao encontrado na lista local.', 'error'); return; }
    const sev = parseInt(p.severidade || '0', 10) || 0;
    const conselho = monConselhoFalha(p.trigger);
    const titulo = ('[Zabbix] ' + (p.trigger || 'Falha')).slice(0, 150);
    const descricao = 'Falha detectada pelo Zabbix e registrada pelo Inventario TI.\n\n' +
        'Host: ' + p.host + '\n' +
        'Trigger: ' + p.trigger + '\n' +
        'Severidade: ' + (p.severidadeLabel || p.severidade) + '\n' +
        'Inicio: ' + (p.inicio ? new Date(p.inicio).toLocaleString('pt-BR') : '?') + ' (ha ' + (p.duracaoTexto || '?') + ')\n' +
        'EventID: ' + p.eventid + '\n\n' +
        'Diagnostico: ' + conselho.causa + '\n\n' +
        'Como contornar:\n' + conselho.contornoTexto;
    if (typeof showSection === 'function') showSection('ordens-servico');
    setTimeout(function () {
        if (typeof showOrdemForm === 'function') {
            showOrdemForm(null, { titulo: titulo, descricao: descricao, prioridade: sev >= 4 ? 'ALTA' : 'MEDIA', computadorNome: p.host });
        } else if (typeof showToast === 'function') {
            showToast('Formulario de O.S. indisponivel nesta pagina.', 'error');
        }
    }, 120);
    if (typeof pushLog === 'function') pushLog('CRIACAO', 'ORDEM_SERVICO', null, 'O.S. aberta a partir de falha Zabbix: ' + p.trigger + ' @ ' + p.host);
}

function monVerInventario(termo) {
    if (typeof showSection === 'function') showSection('computadores');
    setTimeout(function () {
        const b = document.getElementById('busca-input');
        if (b) {
            b.value = termo || '';
            b.dispatchEvent(new Event('input', { bubbles: true }));
            if (typeof showToast === 'function') showToast('Inventario filtrado por: ' + (termo || ''), 'success');
        }
    }, 120);
}

// Relatorio profissional de falhas (nova aba, pronto para impressao/PDF)
async function monGerarRelatorioFalhas() {
    if (!_monProblemasTs || (Date.now() - _monProblemasTs) > 60000) {
        try { await monRenderZabbixProblemas(true); } catch (e) {}
    }
    const info = _monProblemasInfo || {};
    const totalSuprimidos = (_monProblemas || []).filter(function (p) { return p.suppressed; }).length;
    // Relatorio cobre apenas incidentes ativos (nao silenciados)
    let problemas = (_monProblemas || []).filter(function (p) { return !p.suppressed; }).slice();
    // Ordenar por severidade (desc) e depois por data (desc)
    const sevRank = { '5': 5, '4': 4, '3': 3, '2': 2, '1': 1, '0': 0 };
    problemas.sort(function (a, b) {
        const d = (sevRank[b.severidade] || 0) - (sevRank[a.severidade] || 0);
        if (d !== 0) return d;
        return new Date(b.inicio || 0) - new Date(a.inicio || 0);
    });
    const w = window.open('', '_blank');
    if (!w) { alert('Pop-up bloqueado. Permita pop-ups para este site.'); return; }
    const agora = new Date();
    const contagemSev = {};
    for (const p of problemas) contagemSev[p.severidade] = (contagemSev[p.severidade] || 0) + 1;
    const naoReconhecidos = problemas.filter(function (p) { return !p.reconhecido; }).length;
    const hostsAfetados = {};
    for (const p of problemas) hostsAfetados[p.host] = (hostsAfetados[p.host] || 0) + 1;
    const maisAntigo = problemas.reduce(function (min, p) { return (!min || new Date(p.inicio) < new Date(min.inicio)) ? p : min; }, null);
    const hostTop = Object.keys(hostsAfetados).sort(function (a, b) { return hostsAfetados[b] - hostsAfetados[a]; })[0] || '—';

    const linhasSev = ['5', '4', '3', '2', '1', '0'].map(function (s) {
        const infoSev = MON_SEV_INFO[s];
        return '<tr><td><span style="display:inline-block;min-width:96px;text-align:center;background:' + infoSev.cor + ';color:#0b1020;font-weight:800;font-size:11px;border-radius:4px;padding:3px 8px;">' + esc(infoSev.label.toUpperCase()) + '</span></td><td style="text-align:center;font-weight:700;">' + (contagemSev[s] || 0) + '</td></tr>';
    }).join('');

    const blocos = problemas.map(function (p, i) {
        const sev = monSevInfo(p.severidade);
        const conselho = monConselhoFalha(p.trigger);
        const inicio = p.inicio ? new Date(p.inicio).toLocaleString('pt-BR') : '—';
        const tags = (p.tags || []).map(function (t) { return (t.tag || '') + (t.value ? '=' + t.value : ''); }).join(', ');
        const zabbixUrl = monZabbixUrl(p.hostid);
        return '<section class="incident">' +
            '<div class="incident-head" style="border-left:6px solid ' + sev.cor + ';">' +
                '<div class="incident-num">' + String(i + 1).padStart(2, '0') + '</div>' +
                '<div class="incident-title"><h3>' + esc(p.trigger) + '</h3>' +
                    '<div class="incident-host"><i>&#9632;</i> ' + esc(p.host) + '</div>' +
                '</div>' +
                '<div class="incident-sev" style="background:' + sev.cor + ';">' + esc(sev.label.toUpperCase()) + '</div>' +
            '</div>' +
            '<table class="kv"><tbody>' +
                '<tr><th>Host</th><td>' + esc(p.host) + '</td></tr>' +
                '<tr><th>Severidade</th><td>' + esc(p.severidadeLabel || sev.label) + '</td></tr>' +
                '<tr><th>Inicio</th><td>' + esc(inicio) + '</td></tr>' +
                '<tr><th>Duracao</th><td>' + esc(p.duracaoTexto || '—') + '</td></tr>' +
                '<tr><th>Reconhecido</th><td>' + (p.reconhecido ? 'Sim' : '<b style="color:#c0392b;">Nao</b>') + '</td></tr>' +
                '<tr><th>EventID</th><td>' + esc(p.eventid) + '</td></tr>' +
                (tags ? '<tr><th>Tags</th><td>' + esc(tags) + '</td></tr>' : '') +
                (p.opdata ? '<tr><th>Dados operacionais</th><td>' + esc(p.opdata) + '</td></tr>' : '') +
            '</tbody></table>' +
            '<div class="block"><h4>Diagnostico</h4><p>' + esc(conselho.causa) + '</p></div>' +
            '<div class="block"><h4>Plano de acao recomendado</h4>' + conselho.contornoHtml + '</div>' +
            '<div class="block"><h4>Verificacao no Zabbix</h4><p><a class="zlink" href="' + zabbixUrl + '" target="_blank" rel="noopener">Abrir problem view deste host no Zabbix &rarr;</a></p></div>' +
        '</section>';
    }).join('');

    const resumoExec = problemas.length === 0
        ? '<p>Nao ha problemas abertos registrados no Zabbix. O ambiente encontra-se operacional neste momento.</p>'
        : '<ul><li><b>' + problemas.length + '</b> problema(s) aberto(s) no total, sendo <b>' + (info.criticosNaoSuprimidos != null ? info.criticosNaoSuprimidos : problemas.filter(function (p) { return p.severidade === '4' || p.severidade === '5'; }).length) + '</b> de severidade alta/desastre.</li>' +
          '<li><b>' + naoReconhecidos + '</b> problema(s) ainda nao reconhecido(s) pelos operadores.</li>' +
          '<li>Host mais afetado: <b>' + esc(hostTop) + '</b> (' + (hostsAfetados[hostTop] || 0) + ' problema(s)).</li>' +
          (maisAntigo ? '<li>Ocorrencia mais antiga: <b>' + esc(maisAntigo.trigger) + '</b> (desde ' + new Date(maisAntigo.inicio).toLocaleString('pt-BR') + ', ha ' + esc(maisAntigo.duracaoTexto || '') + ').</li>' : '') +
          '</ul>' +
          (totalSuprimidos > 0 ? '<p style="margin-top:8px;font-size:11px;color:var(--mut);">(' + totalSuprimidos + ' problema(s) silenciado(s) no Zabbix omitido(s) deste relatorio.)</p>' : '');

    const doc = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
        '<title>Relatorio de Falhas Zabbix — Inventario TI</title>' +
        '<link rel="stylesheet" href="/vendor/vendor.css">' +
        '<style>' +
        ':root{--navy:#0d1b2a;--teal:#0e8a7d;--teal2:#12b5a5;--ink:#1c2b3a;--mut:#5b6b7d;--line:#dfe6ee;--red:#c0392b;--amber:#b45309;}' +
        '*{margin:0;padding:0;box-sizing:border-box;}' +
        'body{font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:#eef2f7;font-size:13px;line-height:1.55;}' +
        '.page{max-width:1000px;margin:0 auto;background:#fff;box-shadow:0 10px 40px rgba(13,27,42,.18);}' +
        '.cover{background:linear-gradient(135deg,var(--navy) 0%,#13293f 60%,#0e3a45 100%);color:#fff;padding:44px 48px 36px;}' +
        '.brand{display:flex;align-items:center;gap:14px;border-bottom:1px solid rgba(255,255,255,.18);padding-bottom:18px;margin-bottom:26px;}' +
        '.brand-mark{width:52px;height:52px;border-radius:12px;background:linear-gradient(135deg,var(--teal2),#0e8a7d);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px;letter-spacing:1px;color:#04241f;}' +
        '.brand small{display:block;font-size:10px;letter-spacing:2.4px;text-transform:uppercase;color:#9fd8cf;}' +
        '.brand b{font-size:15px;letter-spacing:.4px;}' +
        'h1{font-size:30px;font-weight:800;letter-spacing:-.5px;line-height:1.2;}' +
        '.subtitle{margin-top:8px;color:#bcd3e0;font-size:14px;font-weight:500;}' +
        '.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-top:26px;border-top:1px solid rgba(255,255,255,.18);padding-top:20px;}' +
        '.meta div small{display:block;font-size:9px;letter-spacing:1.6px;text-transform:uppercase;color:#8fb8c9;margin-bottom:4px;}' +
        '.meta div span{font-size:13px;font-weight:600;color:#fff;}' +
        '.content{padding:36px 48px 48px;}' +
        'h2{font-size:17px;text-transform:uppercase;letter-spacing:1.6px;color:var(--navy);border-bottom:2px solid var(--teal2);display:inline-block;padding-bottom:6px;margin:30px 0 14px;}' +
        '.summary{background:#f3f7fb;border:1px solid var(--line);border-left:4px solid var(--teal);border-radius:10px;padding:16px 18px;}' +
        '.summary ul{margin-left:18px;}.summary li{margin:6px 0;}' +
        'table.sev{width:100%;border-collapse:collapse;margin-top:6px;}' +
        'table.sev th,table.sev td{border:1px solid var(--line);padding:8px 10px;font-size:12px;text-align:left;}' +
        'table.sev th{background:#f3f7fb;text-transform:uppercase;font-size:10px;letter-spacing:1.2px;color:var(--mut);}' +
        '.incident{break-inside:avoid;page-break-inside:avoid;border:1px solid var(--line);border-radius:12px;margin:16px 0;overflow:hidden;}' +
        '.incident-head{display:flex;align-items:center;gap:16px;background:#f8fafc;padding:14px 16px;}' +
        '.incident-num{font-family:JetBrains Mono,monospace;font-size:26px;font-weight:600;color:#c3cedb;}' +
        '.incident-title{flex:1;}.incident-title h3{font-size:15px;color:var(--navy);line-height:1.35;}' +
        '.incident-host{font-size:11px;color:var(--mut);margin-top:4px;font-family:JetBrains Mono,monospace;}' +
        '.incident-sev{color:#0b1020;font-size:10px;font-weight:800;letter-spacing:1.4px;border-radius:5px;padding:5px 10px;white-space:nowrap;}' +
        'table.kv{width:100%;border-collapse:collapse;}table.kv th,table.kv td{border-bottom:1px solid #eef1f6;padding:6px 16px;font-size:11px;text-align:left;vertical-align:top;}' +
        'table.kv th{width:170px;color:var(--mut);text-transform:uppercase;font-size:9px;letter-spacing:1.1px;}' +
        '.block{padding:12px 16px;border-top:1px solid #eef1f6;}' +
        '.block h4{font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:var(--teal);margin-bottom:6px;}' +
        '.block p{color:#2c3e50;}.block ol{margin-left:18px;}.block li{margin:4px 0;}' +
        '.zlink{color:var(--teal);font-weight:700;text-decoration:none;}.zlink:hover{text-decoration:underline;}' +
        '.footer{border-top:1px solid var(--line);padding:18px 48px;display:flex;justify-content:space-between;gap:20px;color:var(--mut);font-size:10px;}' +
        '.actions{display:flex;gap:10px;padding:0 48px 0;background:#fff;}' +
        '.btn{display:inline-flex;align-items:center;gap:8px;border:none;border-radius:8px;padding:11px 18px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;}' +
        '.btn-print{background:var(--teal);color:#fff;}.btn-close{background:#e5eaf1;color:var(--ink);}' +
        'code{background:#eef1f6;border-radius:4px;padding:1px 5px;font-family:JetBrains Mono,monospace;font-size:11px;}' +
        '@media print{body{background:#fff;font-size:11px;}.page{box-shadow:none;max-width:none;}.actions{display:none;}.cover{background:var(--navy) !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}.incident{margin:10px 0;}h2{margin-top:18px;}.footer{padding:12px 0;}}' +
        '@page{size:A4;margin:14mm 12mm;}' +
        '</style></head><body><div class="page">' +
        '<header class="cover">' +
            '<div class="brand"><div class="brand-mark">IT</div><div><small>Inventario TI</small><b>Suporte Tecnico e Infraestrutura</b></div></div>' +
            '<h1>Relatorio de Falhas e Diagnostico</h1>' +
            '<p class="subtitle">Incidentes abertos no Zabbix &mdash; analise tecnica, causa provavel e plano de acao</p>' +
            '<div class="meta">' +
                '<div><small>Gerado em</small><span>' + esc(agora.toLocaleString('pt-BR')) + '</span></div>' +
                '<div><small>Origem</small><span>Zabbix 7.0 &mdash; problem.view</span></div>' +
                '<div><small>Total de incidentes</small><span>' + problemas.length + '</span></div>' +
                '<div><small>Criticos (Alto/Desastre)</small><span>' + (info.criticosNaoSuprimidos != null ? info.criticosNaoSuprimidos : problemas.filter(function (p) { return p.severidade === '4' || p.severidade === '5'; }).length) + '</span></div>' +
                '<div><small>Nao reconhecidos</small><span>' + naoReconhecidos + '</span></div>' +
                '<div><small>Host mais afetado</small><span>' + esc(hostTop) + '</span></div>' +
            '</div>' +
        '</header>' +
        '<div class="actions" style="padding-top:18px;">' +
            '<button class="btn btn-print" onclick="window.print()">Imprimir / Salvar PDF</button>' +
            '<button class="btn btn-close" onclick="window.close()">Fechar</button>' +
        '</div>' +
        '<main class="content">' +
            '<h2>Sumario Executivo</h2><div class="summary">' + resumoExec + '</div>' +
            '<h2>Distribuicao por Severidade</h2><table class="sev"><thead><tr><th>Severidade</th><th>Incidentes</th></tr></thead><tbody>' + linhasSev + '</tbody></table>' +
            '<h2>Incidentes Detalhados</h2>' + (blocos || '<p>Nenhum incidente aberto.</p>') +
        '</main>' +
        '<footer class="footer"><div><b>Inventario TI</b> &mdash; Relatorio de Falhas e Diagnostico</div><div>Documento gerado automaticamente em ' + esc(agora.toLocaleString('pt-BR')) + ' &middot; Confidencial &mdash; uso interno</div></footer>' +
        '</div></body></html>';
    w.document.write(doc);
    w.document.close();
    if (typeof pushLog === 'function') pushLog('EXPORTACAO', 'MONITORAMENTO', null, 'Relatorio de falhas Zabbix gerado (' + problemas.length + ' incidente(s))');
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
                // Se a secao de monitoramento esta oculta, apenas guarda dados
                // (renderiza quando o usuario abrir a aba). Evita reflow inutil.
                const secao = document.getElementById('monitoramento');
                const oculta = secao && secao.classList.contains('hidden');
                // Notificacoes agora ficam em monRenderTudo (ponto comum SSE/polling);
                // quando a secao esta oculta, ainda notificamos antes de guardar.
                if (oculta) {
                    try { monNotificarFalhas(_monDados); } catch (n) {}
                    _monDirty = true; monRenderDashboardWidget(); return;
                }
                monRenderTudo(_monDados);
            } catch (err) {}
        });

        // Evento: painel mock (101 PCs inventario original) — a cada 15s
        _monEventSource.addEventListener('mock-painel', function(e) {
            try {
                const mock = JSON.parse(e.data);
                if (_monFonteMock && mock && mock.linhas && mock.linhas.length) {
                    _monDados = mock;
                    // Respeita aba oculta: guarda e renderiza no proximo acesso
                    const secao = document.getElementById('monitoramento');
                    if (secao && secao.classList.contains('hidden')) { _monDirty = true; return; }
                    monRenderTudo(mock);
                    console.log('[monitor] [MOCK] mock-painel atualizado com dados do inventario (', mock.linhas.length, ' PCs)');
                }
            } catch (err) {
                console.error('[monitor] [MOCK] Erro ao processar mock-painel:', err && err.message ? err.message : err);
            }
        });

        // Evento: metricas EM TEMPO REAL do PC local (push por amostra, ~1s)
        _monEventSource.addEventListener('metricas-tempo-real', function(e) {
            try {
                const d = JSON.parse(e.data);
                const secao = document.getElementById('monitoramento');
                if (secao && secao.classList.contains('hidden')) return; // oculto: nao atualiza DOM
                if (typeof d.cpu === 'number') {
                    _monCpuTempoReal = d.cpu;
                    _monCpuTs = d.ts || Date.now();
                    _monCpuHist.push(d.cpu);
                    if (_monCpuHist.length > 60) _monCpuHist.shift();
                    monAtualizarCpuNaTabela(d.cpu, d.ts);
                    monAtualizarKpiCpu(d.cpu, d.ts);
                }
                if (typeof d.gpu === 'number') {
                    _monGpuTempoReal = d.gpu;
                    _monGpuTs = d.gpuTs || Date.now();
                    _monGpuHist.push(d.gpu);
                    if (_monGpuHist.length > 60) _monGpuHist.shift();
                    monAtualizarGpuNaTabela(d.gpu, _monGpuNome || 'GPU', d.gpuTs);
                    monAtualizarKpiGpu(d.gpu, _monGpuNome || 'GPU', d.gpuTs);
                }
            } catch (err) {}
        });

        // Evento: metricas do PC local (RAM/CPU/Disco) — a cada 3s
        _monEventSource.addEventListener('sistema', function(e) {
            try {
                const s = JSON.parse(e.data);
                _monSistema = s;
                const secao = document.getElementById('monitoramento');
                if (secao && secao.classList.contains('hidden')) { _monDirty = true; return; }
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

        // Evento: problemas Zabbix mudaram (push do servidor quando ha diferenca real)
        _monEventSource.addEventListener('zabbix-problemas', function(e) {
            try {
                const d = JSON.parse(e.data);
                _monProblemasInfo = d || { conectado: false, erro: 'Resposta vazia', total: 0, problemas: [] };
                _monProblemas = (_monProblemasInfo && _monProblemasInfo.problemas) || [];
                _monProblemasTs = Date.now();
                const secao = document.getElementById('monitoramento');
                const oculta = secao && secao.classList.contains('hidden');
                if (oculta) { _monDirty = true; monRenderDashboardWidget(); return; }
                monRenderProblemasLista(document.getElementById('mon-zabbix-problemas'));
                monRenderDashboardWidget();
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
        window.monRenderZabbixProblemas = monRenderZabbixProblemas;
        window.monAckProblema = monAckProblema;
        window.monAbrirZabbixHost = monAbrirZabbixHost;
        window.monAbrirOSFalha = monAbrirOSFalha;
        window.monVerInventario = monVerInventario;
        window.monGerarRelatorioFalhas = monGerarRelatorioFalhas;
        window.monAbrirDetalheProblema = monAbrirDetalheProblema;
        window.monFecharModalProblema = monFecharModalProblema;
        window.monProbFiltroTexto = monProbFiltroTexto;
        window.monProbFiltroHost = monProbFiltroHost;
        window.monProbOrdem = monProbOrdem;
        window.monProbSoNaoRec = monProbSoNaoRec;
        window.monProbChipSev = monProbChipSev;
        window.monProbLimparFiltros = monProbLimparFiltros;
        window.monAckTodosVisiveis = monAckTodosVisiveis;
        window.monToggleSilenciados = monToggleSilenciados;
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
        // Somente dados reais: painel do coletor, resumo Zabbix e metricas do SO.
        const [painelReal, zabbix, sistema] = await Promise.all([
            fetch('/api/monitor/painel').then(r => r.json()).catch(() => null),
            fetch('/api/zabbix/resumo').then(r => r.json()).catch(() => null),
            fetch('/api/monitor/sistema').then(r => r.json()).catch(() => null)
        ]);
        _monZabbix = zabbix;
        _monSistema = sistema;
        _monDirty = false;
        monRenderTopo(sistema, zabbix, painelReal);

        _monDados = painelReal;
        monRenderTudo(_monDados);
    } catch (e) {
        console.error('Erro ao carregar monitoramento:', e);
    }
}

async function monExecutarCiclo() {
    try {
        const btn = document.querySelector('#monitoramento .toolbar-actions .btn-primary');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando...'; }
        await fetch('/api/monitor/ciclo', { method: 'POST' });
        if (typeof pushLog === 'function') pushLog('ALTERACAO', 'MONITORAMENTO', null, 'Verificacao manual de monitoramento executada');
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
        monSetHtmlSeMudou(el, '<div class="glass-panel" style="border-left:3px solid var(--yellow);margin-bottom:0;">' +
            '<div style="padding:14px 18px;display:flex;align-items:center;gap:12px;">' +
            '<i class="fas fa-plug-circle-xmark" style="color:var(--yellow);font-size:18px;"></i>' +
            '<div><b style="font-size:13px;color:var(--text-primary);">Zabbix: desabilitado</b>' +
            '<p style="font-size:11px;color:var(--text-muted);margin:2px 0 0;">' + esc(z.mensagem) + '</p></div>' +
            '</div></div>');
        return;
    }
    if (!z || z.erro) {
        monSetHtmlSeMudou(el, '<div class="glass-panel" style="border-left:3px solid var(--red);margin-bottom:0;">' +
            '<div style="padding:14px 18px;display:flex;align-items:center;gap:12px;">' +
            '<i class="fas fa-plug-circle-xmark" style="color:var(--red);font-size:18px;"></i>' +
            '<div><b style="font-size:13px;color:var(--text-primary);">Zabbix: desconectado</b>' +
            '<p style="font-size:11px;color:var(--text-muted);margin:2px 0 0;">' + esc(z && z.erro ? z.erro : 'Configure monitor/zabbix-config.json e reinicie o servidor.') + '</p>' +
            '<p style="font-size:10px;color:var(--text-muted);margin-top:4px;"><i class="fas fa-info-circle"></i> Para restaurar: inicie Docker Desktop e rode <code>docker compose -f docker-compose.zabbix.yml up -d</code></p></div>' +
            '</div></div>');
        return;
    }
    const zx = z.zabbix || {};
    const pr = z.problemas || {};
    const ok = z.conectado;
    monSetHtmlSeMudou(el, '<div class="glass-panel" style="border-left:3px solid ' + (ok ? 'var(--green)' : 'var(--red)') + ';margin-bottom:0;">' +
        '<div style="padding:14px 18px;display:flex;align-items:center;gap:18px;flex-wrap:wrap;">' +
        '<div style="display:flex;align-items:center;gap:10px;">' +
        '<i class="fas fa-' + (ok ? 'circle-check' : 'circle-xmark') + '" style="color:var(--' + (ok ? 'green' : 'red') + ');font-size:18px;"></i>' +
        '<div><b style="font-size:13px;color:var(--text-primary);">Zabbix ' + (ok ? 'Conectado' : 'Desconectado') + '</b>' +
        '<p style="font-size:11px;color:var(--text-muted);margin:0;">Hosts: ' + (zx.totalHosts || 0) + ' | Disponiveis: ' + (zx.disponiveis || 0) + ' | Indisponiveis: ' + (zx.indisponiveis || 0) + '</p></div></div>' +
        (pr.total ? '<div style="display:flex;align-items:center;gap:8px;margin-left:auto;">' +
            '<span style="font-size:11px;color:var(--text-muted);">Problemas:</span>' +
            '<span class="badge badge-' + (pr.criticos ? 'cancelada' : 'pendente') + '">' + pr.total + ' (' + (pr.criticos || 0) + ' criticos)</span>' +
            '</div>' : '') +
        '</div></div>');
}

// ==================== RENDER: SISTEMA LOCAL (in-place; sem innerHTML total) ====================
// O painel e desenhado uma vez (skeleton) e depois apenas textos/cores sao
// atualizados — elimina reflow e o "travamento" a cada ciclo SSE de 3s.
const MON_SYS_COR = { green: 'var(--green)', yellow: 'var(--yellow)', red: 'var(--red)', cyan: 'var(--cyan)', purple: 'var(--purple)', magenta: 'var(--magenta)', muted: 'var(--text-muted)' };

function monSistemaSkeleton() {
    const item = function (id, icon, label) {
        return '<div id="mon-sys-' + id + '" style="padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:10px;border-left:3px solid var(--text-muted);">' +
            '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">' +
            '<i class="fas ' + icon + ' mon-sys-icon" style="color:var(--text-muted);font-size:11px;"></i>' +
            '<span id="mon-sys-' + id + '-l" style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">' + label + '</span>' +
            '</div>' +
            '<div id="mon-sys-' + id + '-v" style="font-size:20px;font-weight:700;color:var(--text-primary);">—</div>' +
            '<div id="mon-sys-' + id + '-s" style="font-size:10px;color:var(--text-muted);margin-top:2px;"></div>' +
            '</div>';
    };
    return '<div class="glass-panel" style="border-left:3px solid var(--cyan);margin-bottom:0;">' +
        '<div style="padding:16px 20px;">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;">' +
        '<i class="fas fa-microchip" style="color:var(--cyan);font-size:16px;"></i>' +
        '<b id="mon-sys-titulo" style="font-size:13px;color:var(--text-primary);">PC Local</b>' +
        '<span id="mon-sys-quando" style="font-size:10px;color:var(--text-muted);margin-left:auto;"></span>' +
        '<button class="btn btn-ghost btn-sm" style="margin-left:8px;" onclick="monAbrirRelatorioPC()" title="Relatorio detalhado em nova aba"><i class="fas fa-file-lines"></i> Relatorio</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;">' +
        item('cpu', 'fa-microchip', 'CPU') +
        item('gpu', 'fa-microchip', 'GPU') +
        item('ram', 'fa-memory', 'RAM') +
        item('disco', 'fa-hard-drive', 'Disco') +
        item('uptime', 'fa-clock', 'Uptime') +
        item('rede', 'fa-network-wired', 'Rede') +
        item('sistema', 'fa-server', 'Sistema') +
        '</div></div></div>';
}

function monSetSysItem(id, label, valor, sub, cor) {
    const wrap = document.getElementById('mon-sys-' + id);
    if (!wrap) return;
    const c = MON_SYS_COR[cor] || 'var(--text-primary)';
    wrap.style.borderLeftColor = c;
    const icon = wrap.querySelector('.mon-sys-icon'); if (icon) icon.style.color = c;
    if (label != null) { const l = document.getElementById('mon-sys-' + id + '-l'); if (l && l.textContent !== label) l.textContent = label; }
    const v = document.getElementById('mon-sys-' + id + '-v');
    if (v) { const t = valor == null ? '—' : String(valor); if (v.textContent !== t) v.textContent = t; v.style.color = c; }
    const sb = document.getElementById('mon-sys-' + id + '-s');
    if (sb) { const t = sub || ''; if (sb.textContent !== t) sb.textContent = t; }
}

function monRenderSistema(s) {
    const el = document.getElementById('mon-sistema');
    if (!el) return;
    if (!s || s.error) {
        el._skeleton = 0;
        monSetHtmlSeMudou(el, '<div class="glass-panel" style="border-left:3px solid var(--yellow);margin-bottom:0;">' +
            '<div style="padding:14px 18px;display:flex;align-items:center;gap:12px;">' +
            '<i class="fas fa-microchip" style="color:var(--yellow);font-size:18px;"></i>' +
            '<div><b style="font-size:13px;color:var(--text-primary);">Metricas Locais</b>' +
            '<p style="font-size:11px;color:var(--text-muted);margin:2px 0 0;">' + (s && s.error ? esc(s.error) : 'Indisponivel') + '</p></div>' +
            '</div></div>');
        return;
    }
    if (el._skeleton !== 1) { el.innerHTML = monSistemaSkeleton(); el._skeleton = 1; }
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
        gpuCor = monCorUso(g0.usoPct) || 'muted';
    }

    const titulo = document.getElementById('mon-sys-titulo');
    if (titulo) titulo.textContent = 'PC Local — ' + (s.hostname || '?') + ' (' + ((s.rede && s.rede[0] && s.rede[0].ip) || '?') + ')';
    const quando = document.getElementById('mon-sys-quando');
    if (quando) quando.textContent = 'Coletado: ' + new Date(s.quando).toLocaleString('pt-BR');

    monSetSysItem('cpu', 'CPU', cpu.usoPct != null ? cpu.usoPct + '%' : 'Aguardando...',
        cpu.modelo ? cpu.nucleos + ' nucleos · ' + cpu.modelo : '',
        cpu.usoPct != null ? (monCorUso(cpu.usoPct) || 'green') : 'muted');
    monSetSysItem('gpu', 'GPU', gpuValor, gpuSub, gpuCor);
    monSetSysItem('ram', 'RAM', mem.usoPct != null ? mem.usoPct + '%' : '?',
        mem.usoPct != null ? mem.usadoGb + '/' + mem.totalGb + ' GB (livre: ' + mem.livreGb + ' GB)' : '',
        mem.usoPct != null ? (monCorUso(mem.usoPct) || 'green') : 'muted');
    monSetSysItem('disco', 'Disco ' + (disco ? disco.letra : '') + ' (espaco)', disco ? disco.usoPct + '%' : 'Indisp.',
        disco ? disco.usadoGb + '/' + disco.totalGb + ' GB (livre: ' + disco.livreGb + ' GB)' : '',
        disco ? (monCorDisco(disco.usoPct) || 'green') : 'muted');
    monSetSysItem('uptime', 'Uptime', up.uptimeHumano || '?',
        'Boot: ' + (up.bootTime ? new Date(up.bootTime).toLocaleString('pt-BR') : '?') + (up.reiniciadoDesdeUltimaColeta ? ' · REINICIADO!' : ''),
        up.reiniciadoDesdeUltimaColeta ? 'red' : 'cyan');
    monSetSysItem('rede', 'Rede', rede.ip || '?', rede.nome ? rede.nome + ' · MAC: ' + rede.mac : '', 'purple');
    monSetSysItem('sistema', 'Sistema', (info.plataforma || '?') + ' ' + (info.arquitetura || ''),
        'Kernel ' + (info.release || '?') + ' · Node ' + (info.node || '?'), 'magenta');

    // Acumula historico para grafico cardiaco (ultimos 60 pontos)
    if (cpu.usoPct != null) { _monCpuHist.push(cpu.usoPct); if (_monCpuHist.length > 60) _monCpuHist.shift(); }
    if (mem.usoPct != null) { _monRamHist.push(mem.usoPct); if (_monRamHist.length > 60) _monRamHist.shift(); }

    // Acumula graficos para uso no KPI detalhado / relatorio (sem renderizar inline)
    if (_monCpuHist.length >= 2) {
        const cpuHtml = monCartesianChart(_monCpuHist, { titulo: 'CPU', unidade: '%', cor: '#00d4ff', altura: 220, minForcado: 0, maxForcado: 100, limiares: monLimiaresUso() });
        const ramHtml = monCartesianChart(_monRamHist, { titulo: 'RAM', unidade: '%', cor: '#a855f7', altura: 220, minForcado: 0, maxForcado: 100, limiares: monLimiaresUso() });
        _monKpiCharts['sys-cpu'] = { titulo: 'CPU do PC Local (%)', html: cpuHtml };
        _monKpiCharts['sys-ram'] = { titulo: 'RAM do PC Local (%)', html: ramHtml };
    }
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
// Escala "bonita" (nice ticks), no estilo Grafana: limites e passo em
// numeros redondos (1/2/2.5/5 x 10^n) e ~5 rotulos legiveis no eixo Y.
// Evita rótulos quebrados como 0.30000000000000004 ou 46.66666.
function monNiceScale(min, max, alvoTicks) {
    alvoTicks = alvoTicks || 5;
    if (!isFinite(min) || !isFinite(max)) return { min: 0, max: 1, step: 0.2 };
    if (min === max) { min = min - 1; max = max + 1; }
    if (min > max) { const _t = min; min = max; max = _t; }
    const span = max - min;
    const bruto = span / Math.max(2, alvoTicks - 1);
    if (!(bruto > 0)) return { min: min, max: max, step: span };
    const exp = Math.floor(Math.log(bruto) / Math.LN10);
    const base = Math.pow(10, exp);
    const f = bruto / base;
    const passo = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * base;
    const nmin = Math.floor(min / passo) * passo;
    const nmax = Math.ceil(max / passo) * passo;
    const fator = Math.pow(10, Math.max(0, -exp + 1));
    const arred = v => Math.round(v * fator) / fator;
    return { min: arred(nmin), max: arred(nmax), step: arred(passo) };
}

// Corta rotulo longo do eixo X com reticencias (o tooltip guarda o completo).
function monCortaRotulo(txt, maxCar) {
    const s = String(txt == null ? '' : txt);
    maxCar = Math.max(3, maxCar || 14);
    return s.length > maxCar ? s.slice(0, maxCar - 1) + '…' : s;
}

function monCartesianChart(dados, opts) {
    opts = opts || {};
    if (!dados || dados.length < 2) return '<div style="font-size:10px;color:var(--text-muted);padding:8px;">Dados insuficientes</div>';

    // Normaliza para [{t,v,ok}]. Quando o chamador passa rotulosX, o eixo X
    // e categorico (hosts, volumes, dias) — NUNCA inventamos horarios falsos.
    let pts;
    const rotulosX = (Array.isArray(opts.rotulosX) && opts.rotulosX.length) ? opts.rotulosX : null;
    if (rotulosX && rotulosX.length === ((typeof dados.length === 'number') ? dados.length : 0)) {
        pts = dados.map((v, i) => {
            const val = (v !== null && typeof v === 'object' && !Array.isArray(v))
                ? (v.v != null ? v.v : v.valor) : v;
            return { t: i, v: val, ok: !(v && v.ok === false), r: rotulosX[i] };
        });
    } else if (typeof dados[0] === 'object' && dados[0] !== null) {
        pts = dados.map(d => ({ t: d.t || d.timestamp || 0, v: d.v != null ? d.v : d.valor, ok: d.ok !== false, r: d.r }));
    } else {
        const agora = Date.now();
        pts = dados.map((v, i) => ({ t: agora - (dados.length - 1 - i) * 60000, v: v, ok: v != null }));
    }
    const rotulos = rotulosX;
    const validos = pts.filter(p => p.v != null && !isNaN(p.v));
    if (validos.length < 2) return '<div style="font-size:10px;color:var(--text-muted);padding:8px;">Dados insuficientes</div>';

    const cor = opts.cor || '#2962FF';
    const corFundo = opts.corFundo || 'rgba(0,0,0,0.25)';
    const w = opts.largura || 1000;
    const h = opts.altura || 300;

    // --- limiares: [{v, cor, rotulo}] — linha de limite configurado no
    //     estilo Grafana "Thresholds". Aceita tambem um numero puro.
    const limiares = (Array.isArray(opts.limiares) ? opts.limiares : [])
        .map(l => (l && typeof l === 'object')
            ? { v: Number(l.v), cor: l.cor || '#ff5252', rotulo: l.rotulo != null ? String(l.rotulo) : null }
            : { v: Number(l), cor: '#ff5252', rotulo: null })
        .filter(l => isFinite(l.v));

    // --- limites do eixo Y: respeita minForcado/maxForcado; quando vem
    //     dos dados, adiciona 6% de folga e arredonda para nice ticks.
    const valores = validos.map(p => p.v);
    let lo = opts.minForcado != null ? opts.minForcado : Math.min(...valores);
    let hi = opts.maxForcado != null ? opts.maxForcado : Math.max(...valores);
    if (lo === hi) { lo = lo - 1; hi = hi + 1; }
    // Limiar fora da faixa dos dados? Abre o eixo ate ele: limite que nao
    // aparece nao protege nada (soft-max do Grafana). So quando o chamador
    // nao forcou o eixo.
    if (limiares.length) {
        if (opts.maxForcado == null) hi = Math.max(hi, ...limiares.map(l => l.v));
        if (opts.minForcado == null) lo = Math.min(lo, ...limiares.map(l => l.v));
    }
    if (opts.minForcado == null || opts.maxForcado == null) {
        const folga = (hi - lo) * 0.06;
        if (opts.minForcado == null) lo -= folga;
        if (opts.maxForcado == null) hi += folga;
    }
    // Uso de CPU/RAM, latencia e perda nunca sao negativos: escala descendo
    // de 0 (ex.: -50ms) e ruido visual, nao informacao.
    if (opts.minForcado == null && lo < 0 && Math.min(...valores) >= 0) lo = 0;
    const escala = monNiceScale(lo, hi, 5);
    const min = escala.min, max = escala.max, passo = escala.step;

    // --- espaco reservado para os rotulos dos eixos
    const rotuloY = opts.rotuloY != null ? opts.rotuloY : (opts.unidade || '');
    const rotuloX = opts.rotuloX != null ? opts.rotuloX : (rotulos ? '' : 'Horario');
    const padL = rotuloY ? 64 : 54, padR = 18, padT = 32, padB = rotuloX ? 50 : 34;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const range = max - min;

    const tMin = Math.min(...pts.map(p => p.t));
    const tMax = Math.max(...pts.map(p => p.t));
    const tRange = (tMax - tMin) || 1;

    const fmtY = opts.formatarY || (v => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10));
    // formato do tempo conforme a janela: segundos / HH:MM / data+HH:MM
    const fmtX = opts.formatarX || (rotulos
        ? (t => { const idx = Math.round(t); return (rotulos[idx] != null) ? String(rotulos[idx]) : ('#' + (idx + 1)); })
        : (t => {
            const d = new Date(t);
            if (tRange > 86400000 * 2) {
                return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' +
                       d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            }
            if (tRange > 7200000) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }));

    const xOf = t => padL + ((t - tMin) / tRange) * plotW;
    const yOf = v => padT + plotH - ((v - min) / range) * plotH;
    const yLabel = h - (rotuloX ? 30 : 12);
    const yRotX = h - 10;

    // Grid horizontal + rotulos Y no passo "bonito" (linhas extremas reforçadas)
    let gridH = '', lblY = '';
    const nY = Math.max(1, Math.min(14, Math.round((max - min) / passo)));
    for (let i = 0; i <= nY; i++) {
        const v = Math.min(max, min + passo * i);
        const y = yOf(v);
        const forte = (i === 0 || i === nY);
        gridH += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (w - padR) + '" y2="' + y.toFixed(1) + '" stroke="' + (forte ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)') + '" stroke-width="1"/>';
        lblY += '<text x="' + (padL - 8) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" fill="rgba(255,255,255,0.5)" font-size="10">' + fmtY(v) + '</text>';
    }

    // Grid vertical + rotulos X (janela de tempo regular, sem sobreposicao)
    let gridV = '', lblX = '';
    if (rotulos) {
        const n = rotulos.length;
        const cabem = Math.max(1, Math.floor(plotW / 62));
        const salto = Math.max(1, Math.ceil(n / cabem));
        const idxs = [];
        for (let i = 0; i < n; i += salto) idxs.push(i);
        if (idxs[idxs.length - 1] !== n - 1) {
            if (n - 1 - idxs[idxs.length - 1] < salto) idxs[idxs.length - 1] = n - 1;
            else idxs.push(n - 1);
        }
        // Espaco medio por rotulo desenhado: nomes longos (host/setor) sao
        // cortados com reticencias para nao invadir a vizinha; o <title> do
        // ponto mantem o nome COMPLETO no tooltip.
        const maxCarX = Math.max(6, Math.floor((plotW / Math.max(1, idxs.length)) / 6.2));
        for (let i = 0; i < n; i++) {
            const x = xOf(i);
            gridV += '<line x1="' + x.toFixed(1) + '" y1="' + padT + '" x2="' + x.toFixed(1) + '" y2="' + (padT + plotH) + '" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>';
            if (idxs.indexOf(i) === -1) continue;
            const anchor = i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle');
            const xx = i === 0 ? padL : (i === n - 1 ? (w - padR) : x);
            lblX += '<text x="' + xx.toFixed(1) + '" y="' + yLabel + '" text-anchor="' + anchor + '" fill="rgba(255,255,255,0.5)" font-size="10">' + esc(monCortaRotulo(rotulos[i], maxCarX)) + '</text>';
        }
    } else {
        const nX = Math.max(1, Math.min(6, Math.floor(plotW / 74), pts.length));
        for (let i = 0; i <= nX; i++) {
            const t = tMin + (tRange * i) / nX;
            const x = xOf(t);
            gridV += '<line x1="' + x.toFixed(1) + '" y1="' + padT + '" x2="' + x.toFixed(1) + '" y2="' + (padT + plotH) + '" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>';
            const anchor = i === 0 ? 'start' : (i === nX ? 'end' : 'middle');
            const xx = i === 0 ? padL : (i === nX ? (w - padR) : x);
            lblX += '<text x="' + xx.toFixed(1) + '" y="' + yLabel + '" text-anchor="' + anchor + '" fill="rgba(255,255,255,0.5)" font-size="10">' + fmtX(t) + '</text>';
        }
    }

    // Titulos dos eixos (o que transforma o grafico em plano cartesiano)
    const txtRotY = rotuloY
        ? '<text transform="translate(14,' + (padT + plotH / 2).toFixed(1) + ') rotate(-90)" text-anchor="middle" fill="rgba(255,255,255,0.55)" font-size="10" font-weight="600" letter-spacing="0.4">' + esc(rotuloY) + '</text>'
        : '';
    const txtRotX = rotuloX
        ? '<text x="' + (padL + plotW / 2).toFixed(1) + '" y="' + yRotX + '" text-anchor="middle" fill="rgba(255,255,255,0.55)" font-size="10" font-weight="600" letter-spacing="0.4">' + esc(rotuloX) + '</text>'
        : '';

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
        const rotuloPontos = rotulos ? (rotulos[Math.round(p.t)] != null ? rotulos[Math.round(p.t)] : ('#' + (Math.round(p.t) + 1))) : new Date(p.t).toLocaleString('pt-BR');
        const tip = rotuloPontos + ' — ' + fmtY(p.v) + (opts.unidade || '') + (p.ok === false ? ' (FALHA)' : '');
        hoverPts += '<circle class="mchov" cx="' + xOf(p.t).toFixed(1) + '" cy="' + yOf(p.v).toFixed(1) + '" r="7" fill="transparent">' +
            '<title>' + esc(tip) + '</title></circle>';
    }

    const titulo = opts.titulo ? '<text x="' + padL + '" y="16" fill="rgba(255,255,255,0.7)" font-size="11" font-weight="600">' + esc(opts.titulo) + '</text>' : '';
    const legendaValor = '<text x="' + (w - padR) + '" y="16" text-anchor="end" fill="' + cor + '" font-size="13" font-weight="700">' + fmtY(ultimo.v) + (opts.unidade || '') + '</text>';

    // --- linhas de limiar + rotulo (por baixo dos dados, por cima do grid)
    let svgLimiares = '';
    limiares.forEach(l => {
        if (l.v < min || l.v > max) return; // fora da faixa exibida (nao desenha)
        const y = yOf(l.v);
        const txt = l.rotulo != null ? l.rotulo : (fmtY(l.v) + (opts.unidade || ''));
        const ty = y > 30 ? y - 5 : y + 12; // nao deixa o rotulo colidir com o valor atual
        svgLimiares += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (w - padR) + '" y2="' + y.toFixed(1) + '" stroke="' + l.cor + '" stroke-width="1.5" stroke-dasharray="7 5" opacity="0.9"/>' +
            '<text x="' + (w - padR - 4) + '" y="' + ty.toFixed(1) + '" text-anchor="end" fill="' + l.cor + '" font-size="9" font-weight="700">' + esc(txt) + '</text>';
    });

    // Descricao para leitor de tela (grafico sem <title> fica mudo no NVDA)
    const aria = esc((opts.titulo || 'Grafico') + '. Valor atual ' + fmtY(ultimo.v) + (opts.unidade || '') +
        (limiares.length ? '. Limiares: ' + limiares.map(l => l.rotulo != null ? l.rotulo : fmtY(l.v)).join('; ') : ''));

    // SVG responsivo: viewBox + width 100% escala o grafico em qualquer container/aba
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" role="img" aria-label="' + aria + '" preserveAspectRatio="xMidYMid meet" style="display:block;background:' + corFundo + ';border-radius:8px;max-width:100%;height:auto;min-height:' + Math.min(h, 260) + 'px;">' +
        titulo + legendaValor +
        gridH + gridV + lblY + lblX + txtRotY + txtRotX +
        svgLimiares +
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

// ==================== RENDER: KPIs (atualizacao diferencial, sem innerHTML total) ====================
// Cada card tem data-key fixo; atualizamos apenas texto/classes, preservando os
// nos do DOM. Isso elimina o "travamento" a cada ciclo do coletor/SSE.
// Linha unica de status: coleta, agente e maquina local. Substitui os
// paineis antigos "Zabbix" + "PC Local" que repetiam as mesmas informacoes.
function monRenderTopo(sistema, zabbix, painel) {
    const el = document.getElementById('mon-topo');
    if (!el) return;
    const s = sistema || {};
    const z = zabbix || {};
    const servico = (painel && painel.servico) || {};
    const cpu = _monCpuTempoReal != null ? _monCpuTempoReal : (s.cpu && s.cpu.usoPct);
    const gpu = _monGpuTempoReal != null ? _monGpuTempoReal : null;
    const mem = s.memoria && s.memoria.usoPct;
    const dv = s.disco && s.disco.discos && s.disco.discos[0];
    const pct = v => (v != null && isFinite(v)) ? Math.round(v) + '%' : '—';
    const zb = z.zabbix || {};
    if (!zb.totalHosts) zb.totalHosts = 0;
    if (!zb.disponiveis) zb.disponiveis = 0;
    // ultimaExecucao pode vir como numero, ISO ou vazio — nunca "Invalid Date".
    let hora = new Date().toLocaleTimeString('pt-BR');
    if (servico.ultimaExecucao != null && servico.ultimaExecucao !== '') {
        const d = new Date(servico.ultimaExecucao);
        if (!isNaN(d.getTime())) hora = d.toLocaleTimeString('pt-BR');
    }
    const item = (ic, cor, label, valor) =>
        '<div class="mon-topo-item"><i class="fas ' + ic + '" style="color:var(--' + cor + ');"></i>' +
        '<span class="mon-topo-label">' + label + '</span><b style="color:var(--' + cor + ');">' + esc(valor) + '</b></div>';
    const seloVivo = '<span class="mon-live"><i></i> ' + (servico.rodando ? 'Ao vivo' : 'Parado') + '</span>';
    el.innerHTML = seloVivo +
        item('fa-bolt', servico.rodando ? 'green' : 'red', 'Coletor', servico.rodando ? 'ON' : 'OFF') +
        item('fa-server', z.conectado ? 'green' : 'red', 'Zabbix', z.conectado ? (zb.disponiveis + '/' + zb.totalHosts + ' hosts') : 'OFF') +
        item('fa-clock', 'cyan', 'Ultima coleta', hora) +
        '<div class="mon-topo-sep"></div>' +
        item('fa-microchip', 'cyan', 'CPU', pct(cpu)) +
        item('fa-tv', 'purple', 'GPU', pct(gpu)) +
        item('fa-memory', 'orange', 'RAM', pct(mem)) +
        item('fa-hard-drive', 'yellow', 'Disco', dv ? pct(dv.usoPct) : '—') +
        item('fa-desktop', 'green', 'PC', s.hostname || '—');
}

function monRenderKPIs(p) {
    const el = document.getElementById('mon-kpis');
    if (!el) return;
    // Sem dados agora: mantem o ultimo estado (evita os cards sumirem/piscarem
    // quando um poll falha). So reconstrui quando ha resumo valido.
    if (!p || !p.resumo) return;
    const defs = monKpiDefs(p);
    for (const d of defs) monAtualizarKpiCardDom(el, d);
    // Sem cards de armazenamento: o resumo vai na linha de status (mon-topo).
    // Cards antigos que ficaram no DOM (de outra versao) sao removidos.
    el.querySelectorAll('.kpi-card').forEach(function(card) {
        if (!defs.some(function(d) { return d.key === card.dataset.key; })) card.remove();
    });
}

function monKpiDefs(p) {
    const r = p.resumo;
    const servico = p.servico || {};
    // KPIs agora vem do backend (classificacao de contexto), mutuamente
    // exclusivos. Desligado esperado NAO conta como indisponibilidade.
    const pctDisponivel = r.disponibilidadeOperacional != null ? r.disponibilidadeOperacional
        : (r.totalAlvos > 0 ? Math.round((r.acessiveis / r.totalAlvos) * 100) : 0);
    const pctBruta = r.disponibilidadeBruta != null ? r.disponibilidadeBruta : pctDisponivel;
    const totalAlvos = r.totalAlvos || 0;
    const qtdDesligados = r.desligadosEsperados || 0;
    const respondiveis = r.respondiveis != null ? r.respondiveis : totalAlvos;
    const pctIndisponivel = respondiveis > 0 ? Math.round((r.semResposta || 0) / respondiveis * 100) : 0;
    const dispCor = monCorDisponibilidade(pctDisponivel);
    // CPU/GPU em tempo real NAO ficam mais na lista principal de KPIs —
    // agora aparecem no detalhe do "Computadores" (aba expandida do PC local),
    // onde fazem sentido. A lista principal mostra apenasMetricas de rede.
    // Seis KPIs que cabem numa leitura rapida: nenhum card que nunca muda
    // ( zerado) e nenhum dado duplicado em outro painel.
    const atencao = (r.semResposta || 0) + (r.instaveis || 0) + (r.semDados || 0);
    const lats = (p.linhas || []).map(l => l.latenciaMediaMs).filter(v => v != null && isFinite(v));
    const latMedia = lats.length ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : null;
    return [
        { icon: 'fa-chart-pie', cor: dispCor, valor: pctDisponivel + '%', label: 'Disponibilidade', sub: r.acessiveis + ' de ' + respondiveis + ' respondendo', key: 'mon-kpi-disponibilidade',
          extra: '<div style="width:60px;height:4px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden;"><div style="width:' + pctDisponivel + '%;height:100%;background:var(--' + dispCor + ');"></div></div>' },
        { icon: 'fa-desktop', cor: 'cyan', valor: totalAlvos, label: 'Equipamentos', sub: 'Com IP monitorado', key: 'mon-kpi-total' },
        { icon: 'fa-circle-check', cor: 'green', valor: r.acessiveis, label: 'Acessiveis', sub: 'Neste momento', key: 'mon-kpi-acessiveis' },
        { icon: 'fa-triangle-exclamation', cor: atencao > 0 ? 'orange' : 'green', valor: atencao, label: 'Em atencao', sub: 'Sem resposta, instaveis e sem dados', key: 'mon-kpi-semresposta' },
        { icon: 'fa-gauge-high', cor: 'cyan', valor: latMedia != null ? latMedia + ' ms' : '—', label: 'Latencia media', sub: 'Ultima coleta', key: 'mon-kpi-latencia' },
        { icon: 'fa-bell', cor: (r.alertasAbertos || 0) > 0 ? 'red' : 'green', valor: r.alertasAbertos || 0, label: 'Alertas', sub: (r.alertasAbertos || 0) > 0 ? 'Requer atencao' : 'Tudo normal', key: 'mon-kpi-alertas' }
    ];
}

function monAtualizarKpiCardDom(el, d) {
    let card = el.querySelector('[data-key="' + d.key + '"]');
    if (!card) { el.insertAdjacentHTML('beforeend', monKpiCard(d.icon, d.cor, d.valor, d.label, d.sub, d.key, d.extra)); return; }
    const ativo = card.classList.contains('active');
    card.className = 'kpi-card' + (ativo ? ' active' : '');
    const ic = card.querySelector('.kpi-ic');
    if (ic) { const want = 'fas ' + d.icon + ' kpi-ic kpi-ic-' + d.cor; if (ic.className !== want) ic.className = want; }
    const val = card.querySelector('.kpi-num');
    const valStr = String(d.valor);
    if (val && val.textContent !== valStr) val.textContent = valStr;
    const lab = card.querySelector('.kpi-name');
    if (lab && lab.textContent !== d.label) lab.textContent = d.label;
    const sub = card.querySelector('.kpi-sub');
    if (sub && sub._lastSet !== d.sub) { sub.innerHTML = d.sub; sub._lastSet = d.sub; }
    if (d.extra) {
        let ex = card.querySelector('.kpi-extra');
        if (ex) { if (ex._lastSet !== d.extra) { ex.innerHTML = d.extra; ex._lastSet = d.extra; } }
        else { const top = card.querySelector('.kpi-top'); if (top) top.insertAdjacentHTML('beforeend', '<span class="kpi-extra">' + d.extra + '</span>'); }
    }
}

let _monArmKPIs = null;
async function monRenderArmazenamentoKPIs() {
    const el = document.getElementById('mon-kpis');
    if (!el) return;
    const agora = Date.now();
    try {
        if (!_monArmKPIs || (agora - _monArmKPIsTs) > 60000) {
            const d = await fetch('/api/monitor/armazenamento').then(r => r.json()).catch(() => null);
            if (d) { _monArmKPIs = d; _monArmKPIsTs = Date.now(); }
        }
        if (!_monArmKPIs) return;
        const dm = _monArmKPIs || {};
        const discos = _monArmKPIs.discos || [];
        const disco0 = discos[0] || null;
        let discoSub = '';
        let discoCor = 'green';
        if (disco0) {
            discoSub = disco0.livreGb + ' GB livre';
            discoCor = monCorDisco(disco0.usoPct) || 'green';
        }
        const defs = [
            { icon: 'fa-hard-drive', cor: discoCor, valor: disco0 ? disco0.usadoGb + ' de ' + disco0.totalGb + ' GB' : '?', label: 'Disco ' + (disco0 ? disco0.letra : ''), sub: discoSub, key: 'mon-kpi-disco' },
            { icon: 'fa-database', cor: 'purple', valor: dm.totalMedicoes != null ? dm.totalMedicoes : '?', label: 'Medicoes', sub: (dm.diasComDados || 0) + ' dia(s) | ' + (dm.tamanhoTotalMB || 0) + ' MB', key: 'mon-kpi-medicoes' }
        ];
        for (const d of defs) monAtualizarKpiCardDom(el, d);
    } catch (e) {}
}

function monKpiCard(icon, cor, valor, label, sub, key, extra) {
    return '<div class="kpi-card" onclick="monToggleKpiDetail(\'' + key + '\')" data-key="' + key + '">' +
        '<div class="kpi-top"><i class="fas ' + icon + ' kpi-ic kpi-ic-' + cor + '"></i>' +
        '<span class="kpi-name">' + label + '</span>' +
        (extra ? '<span class="kpi-extra">' + extra + '</span>' : '') + '</div>' +
        '<div class="kpi-num">' + valor + '</div>' +
        '<div class="kpi-sub">' + sub + '</div>' +
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
        const fails = items.filter(i => {
            if (i.classificacao && i.classificacao.suprimeAlerta) return false;
            if (i.estado === 'DESLIGADO_ESPERADO' || i.estado === 'EMPRESA_PARADA' || i.estado === 'IP_OBSOLETO') return false;
            return i.ok === false || i.estado === 'SEM_RESPOSTA' || i.falhasConsecutivas > 0;
        });
        if (!fails.length) return '<div class="stat-detail-item"><div style="font-size:10px;color:var(--green);">✓ Nenhuma falha registrada</div></div>';
        return '<div class="stat-detail-item"><div style="font-size:10px;color:var(--red);">✗ ' + fails.length + ' falha(s) — ' + label + '</div></div>';
    }

    if (key === 'mon-kpi-cpu-tempo-real') {
        title = 'CPU em Tempo Real'; icon = 'fa-microchip'; color = 'cyan';
        const cpuAtual = _monCpuTempoReal;
        const cpuHist = _monCpuHist || [];
        const cpuMedia = cpuHist.length > 0 ? (cpuHist.reduce((a, b) => a + b, 0) / cpuHist.length).toFixed(1) : '—';
        const cpuMax = cpuHist.length > 0 ? Math.max(...cpuHist).toFixed(1) : '—';
        const cpuMin = cpuHist.length > 0 ? Math.min(...cpuHist).toFixed(1) : '—';
        itemsHtml =
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--cyan-bg);color:var(--cyan);"><i class="fas fa-bolt"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Valor Atual</div><div class="stat-detail-item-sub"><b style="font-size:18px;color:var(--cyan);">' + (cpuAtual != null ? cpuAtual.toFixed(1) + '%' : '—') + '</b></div></div></div>' +
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--green-bg);color:var(--green);"><i class="fas fa-chart-line"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Media (ultimos ' + cpuHist.length + ' pontos)</div><div class="stat-detail-item-sub">' + cpuMedia + '%</div></div></div>' +
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--yellow-bg);color:var(--yellow);"><i class="fas fa-arrow-up"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Maximo</div><div class="stat-detail-item-sub">' + cpuMax + '%</div></div></div>' +
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--purple-bg);color:var(--purple);"><i class="fas fa-arrow-down"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Minimo</div><div class="stat-detail-item-sub">' + cpuMin + '%</div></div></div>' +
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--cyan-bg);color:var(--cyan);"><i class="fas fa-info-circle"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Fonte</div><div class="stat-detail-item-sub">PerformanceCounter Windows (800ms amostra)</div></div></div>';
    } else if (key === 'mon-kpi-gpu-tempo-real') {
        title = 'GPU em Tempo Real'; icon = 'fa-tv'; color = 'purple';
        const gpuAtual = _monGpuTempoReal;
        const gpuHist = _monGpuHist || [];
        const gpuMedia = gpuHist.length > 0 ? (gpuHist.reduce((a, b) => a + b, 0) / gpuHist.length).toFixed(1) : '—';
        const gpuMax = gpuHist.length > 0 ? Math.max(...gpuHist).toFixed(1) : '—';
        const gpuMin = gpuHist.length > 0 ? Math.min(...gpuHist).toFixed(1) : '—';
        itemsHtml =
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--purple-bg);color:var(--purple);"><i class="fas fa-bolt"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Valor Atual</div><div class="stat-detail-item-sub"><b style="font-size:18px;color:var(--purple);">' + (gpuAtual != null ? gpuAtual.toFixed(1) + '%' : '—') + '</b></div></div></div>' +
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--green-bg);color:var(--green);"><i class="fas fa-chart-line"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Media (ultimos ' + gpuHist.length + ' pontos)</div><div class="stat-detail-item-sub">' + gpuMedia + '%</div></div></div>' +
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--yellow-bg);color:var(--yellow);"><i class="fas fa-arrow-up"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Maximo</div><div class="stat-detail-item-sub">' + gpuMax + '%</div></div></div>' +
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--purple-bg);color:var(--purple);"><i class="fas fa-arrow-down"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Minimo</div><div class="stat-detail-item-sub">' + gpuMin + '%</div></div></div>' +
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--cyan-bg);color:var(--cyan);"><i class="fas fa-info-circle"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Fonte</div><div class="stat-detail-item-sub">PerformanceCounter GPU Engine (3 amostras)</div></div></div>';
    } else if (key === 'mon-kpi-disponibilidade') {
        title = 'Disponibilidade da Rede'; icon = 'fa-chart-pie'; color = 'green';
        const linhas = p.linhas || [];
        const rs = p.resumo || {};
        //usa o RESUMO do backend (mesma fonte do card), nao recalcula
        const pct = rs.disponibilidadeOperacional != null ? rs.disponibilidadeOperacional : 0;
        const desligados = linhas.filter(l => l.estado === 'DESLIGADO_ESPERADO');
        const parada = linhas.filter(l => l.estado === 'EMPRESA_PARADA');
        const obsoletos = linhas.filter(l => l.estado === 'IP_OBSOLETO');
        const semDados = linhas.filter(l => l.estado === 'SEM_DADOS');
        const semResposta = linhas.filter(l => l.estado === 'SEM_RESPOSTA' && !(l.classificacao && l.classificacao.suprimeAlerta));
        itemsHtml =
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--green-bg);color:var(--green);"><i class="fas fa-percentage"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Disponibilidade Operacional</div><div class="stat-detail-item-sub"><b style="font-size:24px;color:var(--green);">' + pct + '%</b> · bruta ' + (rs.disponibilidadeBruta != null ? rs.disponibilidadeBruta : 0) + '%</div></div></div>' +
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--green-bg);color:var(--green);"><i class="fas fa-circle-check"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Acessiveis</div><div class="stat-detail-item-sub">' + (rs.acessiveis || 0) + ' de ' + (rs.respondiveis != null ? rs.respondiveis : rs.totalAlvos) + ' respondiveis</div></div></div>' +
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--cyan-bg);color:var(--cyan);"><i class="fas fa-moon"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Desligados (planejado, fora do calculo)</div><div class="stat-detail-item-sub">' + desligados.length + ' equipamentos' + (desligados.length ? ' · ' + desligados.map(l => esc(l.nome || l.ip)).join(', ') : '') + '</div></div></div>' +
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--red-bg);color:var(--red);"><i class="fas fa-circle-xmark"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Sem Resposta (falha real)</div><div class="stat-detail-item-sub">' + (rs.semResposta != null ? rs.semResposta : semResposta.length) + ' equipamentos</div></div></div>' +
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--yellow-bg);color:var(--yellow);"><i class="fas fa-wave-square"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Instaveis</div><div class="stat-detail-item-sub">' + (rs.instaveis || 0) + ' equipamentos</div></div></div>' +
            ((parada.length || obsoletos.length) ? '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--orange-bg);color:var(--orange);"><i class="fas fa-building-circle-xmark"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Parada coletiva / IP obsoleto</div><div class="stat-detail-item-sub">' + parada.length + ' parada(s), ' + obsoletos.length + ' IP(s) a revisar</div></div></div>' : '') +
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--magenta-bg);color:var(--magenta);"><i class="fas fa-circle-question"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Sem Dados</div><div class="stat-detail-item-sub">' + (rs.semDados != null ? rs.semDados : semDados.length) + ' equipamentos</div></div></div>';
    } else if (key === 'mon-kpi-total' || key === 'mon-kpi-computadores') {
        title = 'Equipamentos Monitorados'; icon = 'fa-desktop'; color = 'cyan';
        // Bloco de METRICAS EM TEMPO REAL do PC local (aqui antes ficavam os
        // cards duplicados de CPU/GPU na grade principal).
        const cpuAtual = _monCpuTempoReal;
        const gpuAtual = _monGpuTempoReal;
        const ramAtual = (_monDados && _monDados.sistema && _monDados.sistema.memoria) || null;
        const discoAtual = (_monDados && _monDados.sistema && _monDados.sistema.disco) || null;
        const hostNome = (_monDados && _monDados.sistema && (_monDados.sistema.nome || _monDados.sistema.hostname)) || 'PC local';
        const mini = (ic, cor, nome, valor, corValor, nota) =>
            '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--' + cor + '-bg);color:var(--' + cor + ');"><i class="fas ' + ic + '"></i></div>' +
            '<div class="stat-detail-item-info"><div class="stat-detail-item-name">' + esc(nome) + '</div>' +
            '<div class="stat-detail-item-sub"><b style="font-size:18px;color:var(--' + (corValor || cor) + ');">' + valor + '</b>' +
            (nota !== undefined ? ' <span ' + (nome === 'GPU' ? 'data-metrica="gpu-nome" ' : '') + 'style="font-size:10px;">' + nota + '</span>' : '') + '</div></div></div>';
        let html = '<div style="font-size:11px;color:var(--text-muted);margin:4px 0 8px;padding:8px;background:rgba(255,255,255,0.03);border-radius:8px;">' +
            '<i class="fas fa-circle" style="color:var(--green);font-size:7px;"></i> <b style="color:var(--text-primary);">' + esc(hostNome) + '</b> · metricas em tempo real (coletadas localmente)</div>';
        if (cpuAtual != null) html += mini('fa-microchip', 'cyan', 'CPU', '<span data-metrica="cpu">' + cpuAtual.toFixed(1) + '%</span>', monCorUso(cpuAtual, 'cyan'), 'ao vivo · 1s');
        if (gpuAtual != null) html += mini('fa-tv', 'purple', 'GPU', '<span data-metrica="gpu">' + gpuAtual.toFixed(1) + '%</span>', monCorUso(gpuAtual, 'purple'), esc(_monGpuNome || 'ao vivo · 2s'));
        if (ramAtual && ramAtual.usoPct != null) html += mini('fa-memory', 'orange', 'RAM', ramAtual.usoPct + '%', monCorUso(ramAtual.usoPct, 'orange'), 'em uso');
        html += '<div style="font-size:11px;color:var(--text-muted);margin:10px 0 6px;border-top:1px solid var(--divider);padding-top:8px;">Equipamentos cadastrados (' + p.resumo.totalAlvos + '):</div>';
        const agenteBadge = (l) => {
            if (l.local) return '<span style="color:var(--cyan);font-size:10px;">[agente local]</span>';
            if (l.agenteOk === false) return '<span style="color:var(--red);font-size:10px;" title="PC responde ping, mas o servico Zabbix Agent nao esta rodando nele">[agente OFFLINE]</span>';
            if (l.agenteOk === true) return '<span style="color:var(--green);font-size:10px;">[agente OK]</span>';
            return '';
        };
        itemsHtml = html + p.linhas.map(l => '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--cyan-bg);color:var(--cyan);"><i class="fas fa-desktop"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + esc(l.nome || l.ip) + '</div><div class="stat-detail-item-sub">' + esc(l.ip) + ' | Setor: ' + esc(l.setor || '-') + ' | Estado: ' + monEstadoBadge(l.estado) + ' | Lat: ' + (l.latenciaMediaMs != null ? Math.round(l.latenciaMediaMs) + 'ms' : '—') + ' ' + agenteBadge(l) + (l.local ? ' | <b style="color:var(--cyan)">PC local</b>' : '') + '</div><div class="stat-detail-item-badge">' + monEstadoBadge(l.estado) + '</div></div></div>').join('');
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
            const cor = monCorDisco(pct) || 'green';
            return '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--' + cor + '-bg);color:var(--' + cor + ');"><i class="fas fa-hard-drive"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">Disco ' + esc(d.letra) + '</div><div class="stat-detail-item-sub">Usado: ' + d.usadoGb + ' GB | Livre: ' + d.livreGb + ' GB | Total: ' + d.totalGb + ' GB</div></div><div class="stat-detail-item-badge"><span class="badge badge-' + (cor === 'red' ? 'cancelada' : cor === 'yellow' ? 'pendente' : 'ativo') + '">' + pct + '%</span></div></div>';
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

    // KPIs novos (sem handler especifico): mostra a lista de equipamentos.
    if (!itemsHtml && key && key.indexOf('mon-kpi-') === 0) {
        title = 'Equipamentos'; icon = 'fa-desktop'; color = 'cyan';
        itemsHtml = (p.linhas || []).map(function(l) {
            return monKpiDetailItem(l, 'fa-circle', 'green');
        }).join('') || failureSummary([], 'equipamentos');
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
    return '<div class="stat-detail-item" onclick="monVerDetalhe(\'' + monAttr(l.ip) + '\')">' +
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
    const html = '<option value="">Todos os Setores</option>' +
        setores.map(s => '<option value="' + esc(s) + '"' + (s === atual ? ' selected' : '') + '>' + esc(s) + '</option>').join('');
    // Nao reconstroi o combo se nada mudou (preserva foco/selecao do usuario)
    if (sel._lastHtml !== html) {
        sel._lastHtml = html;
        sel.innerHTML = html;
    }
    sel.onchange = function() { _monFiltroSetor = this.value; monRenderTabela(_monDados); };
}

// Assinatura estavel dos dados da tabela (quantiza metricas em inteiros e
// frescor em buckets de 2 minutos) para evitar rebuild do DOM a cada poll.
function monLinhaChave(l) {
    const q = function (v) {
        if (v == null) return -1;
        const m = String(v).match(/-?\d+(\.\d+)?/);
        return m ? Math.round(parseFloat(m[0])) : -1;
    };
    const zbx = l.zabbix || {};
    const ultimoTs = l.ultimoHorario ? new Date(l.ultimoHorario).getTime() : 0;
    const segBucket = ultimoTs ? Math.floor((Date.now() - ultimoTs) / 120000) : -1;
    return [
        l.ip, l.nome, l.setor, l.estado,
        q(l.latenciaMediaMs), l.falhasConsecutivas || 0,
        q(l.cpu), q(l.gpu), q(l.ram), q(l.disco),
        l.alertasAtivos || 0, l.fonte || '',
        zbx.indisponivelZb ? 'z' : '',
        (zbx.perdaPct != null ? Math.round(zbx.perdaPct) : ''),
        segBucket
    ].join('|');
}

function monAtualizarStamp(p) {
    const stamp = document.getElementById('mon-atualizado-em');
    if (!stamp) return;
    const quando = p.resumo && p.resumo.coletadoEm ? p.resumo.coletadoEm : (p.servico && p.servico.ultimaExecucao ? p.servico.ultimaExecucao.quando : null);
    stamp.textContent = 'Ultima coleta: ' + (quando ? new Date(quando).toLocaleString('pt-BR') : '—');
}

// ==================== RENDER: TABELA ====================
function monRenderTabela(p) {
    const tbody = document.querySelector('#monTable tbody');
    if (!tbody) return;
    if (!p || !p.linhas || !p.linhas.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-muted);">' +
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

    // ===== Atualizacao diferencial: so recria o DOM quando algo relevante mudou =====
    const assinatura = _monFiltroEstado + '|' + _monFiltroSetor + '|' + _monBusca + '|' + linhas.map(monLinhaChave).join('||');
    if (tbody._assinatura === assinatura) { monAtualizarStamp(p); return; }
    tbody._assinatura = assinatura;

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

        // Detecta se o valor vem do Zabbix, cache antigo, ou local
        function _fonteMetrica(val) {
            if (!val || val === 'INDISPONIVEL' || val === 'INDISP.') return null;
            const s = String(val);
            if (s.indexOf('(Zabbix)') >= 0) return 'ZABBIX';
            if (s.indexOf('ZABBIX_DADOS_ANTIGOS') >= 0) return 'ZABBIX_CACHE';
            return 'LOCAL';
        }
        function _cellMetrica(val, titulo) {
            const fonte = _fonteMetrica(val);
            if (!fonte) {
                const tituloEsc = esc(titulo || 'Indisp.');
                if (zbx.indisponivelZb) {
                    return '<span style="color:var(--red);font-size:10px;" title="Zabbix indisponível — sem dados do agente">' + tituloEsc + '</span>';
                }
                if (l.estado === 'SEM_DADOS' || l.stale) {
                    return '<span style="color:var(--text-muted);font-size:10px;" title="Dados expirados — sem coleta recente">' + tituloEsc + '</span>';
                }
                return '<span style="color:var(--text-muted);font-size:10px;" title="Sem agente instalado neste PC remoto">' + tituloEsc + '</span>';
            }
            const corFonte = fonte === 'ZABBIX' ? 'var(--purple)' : (fonte === 'ZABBIX_CACHE' ? 'var(--orange)' : 'var(--green)');
            const texto = String(val).replace(/\s*\(Zabbix\)\s*/g, '').replace(/\s*ZABBIX_DADOS_ANTIGOS\s*/g, '').trim();
            const fonteLabel = fonte === 'ZABBIX_CACHE' ? 'ZABBIX (cache antigo)' : fonte;
            const valorHtml = monBarraHtml(texto) || '<span style="color:var(--cyan);font-weight:600;">' + esc(texto) + '</span>';
            return valorHtml + '<br><span style="font-size:9px;color:' + corFonte + ';">' + fonteLabel + '</span>';
        }
        const cpuCell = _cellMetrica(l.cpu, 'Indisp.');
        const gpuCell = _cellMetrica(l.gpu, 'Indisp.');
        const ramCell = _cellMetrica(l.ram, 'Indisp.');
        const discoCell = _cellMetrica(l.disco, 'Indisp.');

        // Indicador de idade dos dados
        let idadeInfo = '';
        const agoraTs = Date.now();
        const ultimoTs = l.ultimoHorario ? new Date(l.ultimoHorario).getTime() : 0;
        const segundosDesdeUltima = ultimoTs ? Math.round((agoraTs - ultimoTs) / 1000) : null;
        if (segundosDesdeUltima != null && segundosDesdeUltima > 60) {
            idadeInfo = '<span style="font-size:9px;color:var(--orange);" title="Última coleta há ' + segundosDesdeUltima + 's">⚠ ' + segundosDesdeUltima + 's</span>';
        } else if (segundosDesdeUltima != null) {
            idadeInfo = '<span style="font-size:9px;color:var(--green);" title="Última coleta há ' + segundosDesdeUltima + 's">✓ ' + segundosDesdeUltima + 's</span>';
        }

        return '<tr data-local="' + (l.local ? '1' : '0') + '">' +
            '<td><b style="color:var(--text-primary);">' + esc(l.nome || '-') + '</b><br><span style="font-size:11px;color:var(--text-muted);font-family:monospace;">' + esc(l.ip) + '</span></td>' +
            '<td>' + estadoBadge + '</td>' +
            '<td>' + lat + idadeInfo + '</td>' +
            '<td>' + cpuCell + '</td>' +
            '<td>' + gpuCell + '</td>' +
            '<td>' + ramCell + '</td>' +
            '<td>' + discoCell + '</td>' +
            '<td><button class="action-btn action-btn-edit" onclick="monVerDetalhe(\'' + monAttr(l.ip) + '\')" title="Detalhes"><i class="fas fa-chart-line"></i></button></td>' +
            '</tr>';
    }).join('');

    monAtualizarStamp(p);

    // A tabela pode ter sido recriada agora (assinatura mudou) — reaplica as
    // celulas EM TEMPO REAL em cima dos valores-base (senao volta ao velho)
    if (_monCpuTempoReal != null) monAtualizarCpuNaTabela(_monCpuTempoReal, _monCpuTs);
    if (_monGpuTempoReal != null) monAtualizarGpuNaTabela(_monGpuTempoReal, _monGpuNome || 'GPU', _monGpuTs);
}

function monEstadoBadge(estado) {
    switch (estado) {
        case 'ACESSIVEL': return '<span class="badge badge-ativo">Acessivel</span>';
        case 'SEM_RESPOSTA': return '<span class="badge badge-cancelada">Sem Resposta</span>';
        case 'INSTAVEL': return '<span class="badge badge-pendente">Instavel</span>';
        case 'SEM_DADOS': return '<span class="badge badge-inativo">Sem Dados</span>';
        case 'DESLIGADO_ESPERADO': return '<span class="badge badge-inativo" title="Desligado em janela/esperado — nao e falha"><i class="fas fa-moon"></i> Desligado (esperado)</span>';
        case 'EMPRESA_PARADA': return '<span class="badge badge-pendente" title="Parada coletiva do setor"><i class="fas fa-building-circle-xmark"></i> Parada Coletiva</span>';
        case 'IP_OBSOLETO': return '<span class="badge badge-pendente" title="Revisar IP no cadastro"><i class="fas fa-map-pin"></i> IP Obsoleto</span>';
        default: return '<span class="badge badge-desconhecido">' + esc(estado || '?') + '</span>';
    }
}

// ==================== RENDER: ALERTAS ====================
function monRenderAlertas(p) {
    const el = document.getElementById('mon-alertas-list');
    if (!el) return;
    if (!p || !p.alertas || !p.alertas.length) {
        monSetHtmlSeMudou(el, '<p style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px;">Nenhum alerta ativo</p>');
        var badgeVazio = document.getElementById('nav-monitor-alerts');
        if (badgeVazio) badgeVazio.style.display = 'none';
        return;
    }
    monSetHtmlSeMudou(el, p.alertas.map(function(a) {
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
    }).join(''));

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
        monSetHtmlSeMudou(el, '<p style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px;">Nenhuma notificacao recebida</p>');
        return;
    }
    monSetHtmlSeMudou(el, lista.map(function(a) {
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
    }).join(''));
}

function monLimparAlertasZabbix() {
    _monAlertasZabbix = [];
    monRenderAlertasZabbix();
}

// ==================== RENDER: INCIDENTES ====================
function monRenderIncidentes(p) {
    const el = document.getElementById('mon-incidentes');
    if (!el) return;
    if (!p || !p.incidentes || !p.incidentes.length) { monSetHtmlSeMudou(el, ''); return; }
    monSetHtmlSeMudou(el, p.incidentes.map(function(inc) {
        return '<div class="glass-panel" style="border-left:3px solid var(--red);margin-bottom:8px;">' +
            '<div style="padding:14px 18px;display:flex;align-items:center;gap:12px;">' +
            '<i class="fas fa-share-nodes" style="color:var(--red);font-size:16px;"></i>' +
            '<div><b style="font-size:13px;color:var(--text-primary);">' + esc(inc.titulo) + '</b>' +
            '<p style="font-size:11px;color:var(--text-muted);margin:2px 0 0;">' +
            inc.afetados + ' de ' + inc.total + ' equipamentos afetados | Confianca: ' + inc.confianca + '</p>' +
            '<p style="font-size:11px;color:var(--text-secondary);margin:2px 0 0;">Hosts: ' + inc.hosts.map(h => '<code>' + esc(h) + '</code>').join(', ') + '</p>' +
            '</div></div></div>';
    }).join(''));
}

// ==================== RENDER: HOSTS ZABBIX ====================
let _monZbxHostsTs = 0;
async function monRenderZabbixHosts(forcar) {
    const el = document.getElementById('mon-zabbix-hosts');
    if (!el) return;
    if (!forcar && _monZbxHostsTs && (Date.now() - _monZbxHostsTs) < 30000) return; // throttle 30s
    _monZbxHostsTs = Date.now();
    try {
        const z = await fetch('/api/zabbix/hosts').then(r => r.json()).catch(() => null);
        const hosts = Array.isArray(z) ? z : (z && z.hosts) || [];
        if (!hosts.length) {
            monSetHtmlSeMudou(el, '<p style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px;">' +
                (z && z.erro ? 'Zabbix: ' + esc(z.erro) : 'Nenhum host cadastrado no Zabbix.') + '</p>');
            return;
        }
        monSetHtmlSeMudou(el, '<div style="overflow-x:auto;"><table class="data-table" style="font-size:11px;"><thead><tr>' +
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
            '</tbody></table></div>');
    } catch (e) {
        monSetHtmlSeMudou(el, '<p style="color:var(--red);font-size:12px;text-align:center;padding:20px;">Erro ao listar hosts Zabbix</p>');
    }
}

async function monSyncZabbix() {
    const btn = document.querySelector('[onclick*="monSyncZabbix"]');
    try {
        if (btn) { btn.disabled = true; btn.style.opacity = 0.6; }
        const r = await fetch('/api/zabbix/sincronizar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        }).then(x => x.json());
        if (!r.ok) throw new Error(r.error || 'erro desconhecido');

        const h = r.hosts || {};
        const m = r.manutencoes || null;
        const partes = [];
        partes.push((h.criados || 0) + ' host(s) criado(s)');
        partes.push((h.atualizados || 0) + ' atualizado(s)');
        if (h.ipsAtualizados) partes.push(h.ipsAtualizados + ' IP(s) atualizado(s)');
        partes.push((h.inalterados || 0) + ' inalterado(s)');
        if (h.semIp) partes.push(h.semIp + ' sem IP');
        if (h.semVinculo) partes.push(h.semVinculo + ' host(s) sem vinculo');
        if (m) {
            partes.push('manutencoes: ' + (m.criadas || 0) + ' criada(s), ' + (m.atualizadas || 0) + ' atualizada(s), ' + (m.removidas || 0) + ' vencida(s) limpa(s)');
            if (m.semVinculo) partes.push(m.semVinculo + ' manutencao(s) sem host vinculado');
        }
        // IP adaptativo: IPs lidos de volta do Zabbix (auto-registro) e aplicados no cadastro
        const ips = r.ips || null;
        if (ips) {
            if ((ips.aplicados || []).length) {
                partes.push('IP adaptativo: ' + ips.aplicados.map(a => a.nome + ' ' + (a.ipAntigo || '?') + '→' + a.ipNovo).join(', '));
            }
            if ((ips.semVinculo || []).length) partes.push(ips.semVinculo.length + ' host(s) sem vinculo ao cadastro');
        }
        const erros = [...(h.erros || []), ...((m && m.erros) || []), ...((ips && ips.erros) || [])];
        const msg = 'Sincronizado (' + (r.computadores || 0) + ' computadores): ' + partes.join(', ') + '.';
        if (typeof showToast === 'function') showToast(erros.length ? msg + ' ' + erros.length + ' erro(s): ' + erros[0] : msg, erros.length ? 'error' : 'success');
        if (typeof pushLog === 'function') pushLog('ALTERACAO', 'MONITORAMENTO', null, 'Sincronizacao Zabbix: ' + partes.join('; '));
        monRenderZabbixHosts(true);
    } catch (e) {
        if (typeof showToast === 'function') showToast('Erro ao sincronizar: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.style.opacity = 1; }
    }
}

// IP adaptativo: le os IPs dos agentes ativos no Zabbix (auto-registro) e
// atualiza o cadastro (data.json) — para o ping/monitoramento seguir o IP real.
async function monSyncIpsZabbix() {
    const btn = document.querySelector('[onclick*="monSyncIpsZabbix"]');
    try {
        if (btn) { btn.disabled = true; btn.style.opacity = 0.6; }
        const r = await fetch('/api/zabbix/sincronizar-ips', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        }).then(x => x.json());
        if (!r.ok) throw new Error(r.error || 'erro desconhecido');

        const ap = r.aplicados || [];
        const ig = r.ignorados || [];
        const sv = r.semVinculo || [];
        const erros = r.erros || [];
        let msg;
        if (ap.length) {
            msg = 'IP adaptativo: ' + ap.map(a => a.nome + ': ' + (a.ipAntigo || '?') + ' → ' + a.ipNovo).join(', ');
        } else {
            msg = 'IP adaptativo: cadastro já está com o IP atual de todos os hosts' +
                (ig.length ? ' (' + ig.length + ' sem mudança)' : '') +
                (sv.length ? '; ' + sv.length + ' host(s) sem vínculo' : '') + '.';
        }
        if (typeof showToast === 'function') showToast(erros.length ? msg + ' Erro(s): ' + erros[0] : msg, erros.length ? 'error' : 'success');
        if (typeof pushLog === 'function' && ap.length) {
            pushLog('ALTERACAO', 'MONITORAMENTO', null, 'IP adaptativo: ' + ap.map(a => a.nome + ' ' + (a.ipAntigo || '?') + '→' + a.ipNovo).join('; '));
        }
        if (ap.length) monRenderZabbixHosts(true);
    } catch (e) {
        if (typeof showToast === 'function') showToast('Erro ao atualizar IPs: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.style.opacity = 1; }
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
        monSetHtmlSeMudou(el, '<p style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px;">' + esc(d && d.error ? d.error : 'Indisponivel') + '</p>');
        return;
    }

    let html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;">';

    // --- DISCOS DO PC LOCAL ---
    html += '<div>';
    html += '<h4 style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin:0 0 10px;"><i class="fas fa-hard-drive" style="color:var(--cyan);"></i> Discos do PC Local</h4>';
    if (d.discos && d.discos.length) {
        for (const disco of d.discos) {
            const pct = disco.usoPct || 0;
            const corBarra = 'var(--' + (monCorDisco(disco.usoPct) || 'green') + ')';
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

    monSetHtmlSeMudou(el, html);
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
    monAplicarLimites(dados); // limites vigentes vêm junto com o histórico
    if (!dados || (!dados.serie || !dados.serie.length)) {
        return '<p style="color:var(--text-muted);text-align:center;padding:20px;">Sem dados historicos para este host.</p>';
    }
    let html = '<h4 style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin:0 0 10px;">Historico de ' + esc((dados && dados.host) || '?') + ' (' + (dados && dados.dias ? dados.dias + ' dias' : '?') + ')</h4>';

    // Tabela resumo
    html += '<table class="data-table" style="font-size:11px;"><thead><tr><th>Dia</th><th>Medicoes</th><th>Sucessos</th><th>Falhas</th><th>Perda</th><th>Lat Media</th><th>Lat Min</th><th>Lat Max</th><th>P95</th></tr></thead><tbody>';
    for (const s of dados.serie) {
        const perdaCor = 'var(--' + (monCorPerda(s.perdaPct) || 'green') + ')';
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
            const cor = 'var(--' + (monCorPerda(s.perdaPct) || 'green') + ')';
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
        const latHtml = monCartesianChart(lats, { titulo: 'Latencia (ms)', unidade: 'ms', cor: '#2962FF', altura: 320, largura: 1100, formatarY: function(v){return Math.round(v);}, limiares: monLimiaresLatencia() });
        const perdaHtml = monCartesianChart(perdas, { titulo: 'Perda (%)', unidade: '%', cor: '#FF6D00', altura: 300, largura: 1100, minForcado: 0, maxForcado: Math.max(Number(_monLimites.perdaPacotesPct) || 10, ...perdas.map(p=>p.v||0)), formatarY: function(v){return Math.round(v);}, limiares: monLimiaresPerda() });
        _monKpiCharts['hist-lat'] = { titulo: 'Latencia (ms)', html: latHtml };
        _monKpiCharts['hist-perda'] = { titulo: 'Perda (%)', html: perdaHtml };
        html += '<h4 style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin:16px 0 8px;">Latencia ao Longo do Tempo</h4>';
        html += '<div style="display:flex;gap:6px;justify-content:flex-end;margin-bottom:4px;"><button class="btn btn-ghost btn-sm" onclick="monAbrirGrafico(\'Latencia (ms)\', _monKpiCharts[\'hist-lat\'].html)"><i class="fas fa-expand"></i> Expandir</button><button class="btn btn-ghost btn-sm" onclick="monAbrirGraficoNovaAba(\'Latencia (ms)\', _monKpiCharts[\'hist-lat\'].html)"><i class="fas fa-external-link-alt"></i> Nova aba</button></div>';
        html += latHtml;
        html += '<h4 style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin:16px 0 8px;">Perda de Pacotes ao Longo do Tempo</h4>';
        html += '<div style="display:flex;gap:6px;justify-content:flex-end;margin-bottom:4px;"><button class="btn btn-ghost btn-sm" onclick="monAbrirGrafico(\'Perda (%)\', _monKpiCharts[\'hist-perda\'].html)"><i class="fas fa-expand"></i> Expandir</button><button class="btn btn-ghost btn-sm" onclick="monAbrirGraficoNovaAba(\'Perda (%)\', _monKpiCharts[\'hist-perda\'].html)"><i class="fas fa-external-link-alt"></i> Nova aba</button></div>';
        html += perdaHtml;
    }

    // ---- DETALHES DAS FALHAS (o que foi, por que, como agir) ----
    if (dados && dados.falhasDetalhadas && dados.falhasDetalhadas.porTipo && dados.falhasDetalhadas.porTipo.length) {
        html += '<h4 style="font-size:10px;color:var(--text-muted);text-transform:uppercase;margin:20px 0 8px;letter-spacing:0.5px;"><i class="fas fa-bug" style="color:var(--red);margin-right:6px;"></i>Analise das Falhas — ' + (dados.falhasDetalhadas.totalFalhas || 0) + ' ocorrencia(s) em ' + (dados.falhasDetalhadas.porTipo ? dados.falhasDetalhadas.porTipo.length : 0) + ' tipo(s) de erro</h4>';
        for (var fi = 0; fi < (dados.falhasDetalhadas.porTipo || []).length; fi++) {
            var f = dados.falhasDetalhadas.porTipo[fi];
            html += '<div style="padding:12px;background:rgba(255,60,60,0.06);border:1px solid rgba(255,60,60,0.15);border-radius:10px;margin-bottom:10px;">';
            html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">';
            html += '<span style="font-size:10px;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:0.5px;">' + (f.erro ? String(f.erro).replace(/</g, '&lt;') : '?') + '</span>';
            html += '<span style="font-size:10px;color:var(--text-muted);margin-left:auto;">' + (f.total || 0) + ' ocorrencia(s)' + (f.primeiro ? ' | Primeiro: ' + new Date(f.primeiro).toLocaleString('pt-BR') : '') + (f.ultimo ? ' | Ultimo: ' + new Date(f.ultimo).toLocaleString('pt-BR') : '') + '</span>';
            html += '</div>';
            html += '<div style="font-size:12px;color:var(--text-primary);font-weight:600;margin-bottom:2px;"><i class="fas fa-bullseye" style="color:var(--yellow);margin-right:6px;font-size:10px;"></i>' + (f.nome ? String(f.nome).replace(/</g, '&lt;') : (f.erro ? String(f.erro) : 'Erro desconhecido')) + '</div>';
            html += '<p style="font-size:11px;color:var(--text-muted);margin:2px 0 0;line-height:1.6;"><b style="color:var(--cyan);font-size:10px;">CAUSA PROVAVEL:</b> ' + (f.causa ? String(f.causa).replace(/</g, '&lt;') : 'Nao disponivel no catalogo.') + '</p>';
            html += '<p style="font-size:11px;color:var(--green);margin:2px 0 0;line-height:1.6;"><b style="color:var(--cyan);font-size:10px;">RECOMENDACAO:</b> ' + (f.recomendacao ? String(f.recomendacao).replace(/</g, '&lt;') : 'Analisar manualmente.') + '</p>';
            if (f.exemplos && f.exemplos.length) {
                html += '<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.06);">';
                html += '<span style="font-size:9px;color:var(--text-muted);text-transform:uppercase;">Ultimos registros brutos:</span>';
                for (var exi = 0; exi < f.exemplos.length && exi < 3; exi++) {
                    var ex = f.exemplos[exi];
                    html += '<div style="font-size:9px;color:var(--text-secondary);margin-top:2px;font-family:monospace;">' + (ex.timestamp ? new Date(ex.timestamp).toLocaleTimeString('pt-BR') : '?') + ' | perda ' + (ex.perdaPct != null ? ex.perdaPct + '%' : '?') + ' | enviado=' + (ex.enviado || 0) + ' recebido=' + (ex.recebido || 0) + ' | erro=' + (ex.erro ? String(ex.erro) : '?') + '</div>';
                }
                html += '</div>';
            }
            html += '</div>';
        }
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
            html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;">';
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
            html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;">';
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
            html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;">';
            html += monDetailItem('Hostname Zabbix', esc(h.hostname));
            html += monDetailItem('Disponivel', h.disponivel === null ? 'Desconhecido' : (h.disponivel ? '<span class="badge badge-ativo">Sim</span>' : '<span class="badge badge-cancelada">Nao</span>'));
            if (zbx.desativado) {
                html += '<div style="margin:8px 0;padding:10px;border-left:3px solid var(--yellow);background:rgba(255,255,255,0.03);border-radius:6px;font-size:11px;color:var(--yellow);"><i class="fas fa-pause-circle"></i> ' + esc(zbx.nota || 'Host DESATIVADO no Zabbix — a coleta de dados parou.') + '</div>';
            }
            // Dados antigos (>5min ou nunca coletados): nunca exibidos como validos
            function _semDados(item) {
                return item && item.stale
                    ? '<span style="color:var(--yellow);">SEM DADOS RECENTES' + (item.idadeSeg != null ? ' (ha ' + Math.max(1, Math.round(item.idadeSeg / 60)) + ' min)' : ' (nunca coletado)') + '</span>'
                    : null;
            }
            // CPU
            const cpu = zbx.metricas && zbx.metricas.cpu;
            if (cpu && cpu.valor) {
                const cpuVal = parseFloat(cpu.valor.valor);
                const cpuStr = isNaN(cpuVal) ? cpu.valor.valor : (Math.round(cpuVal * 10) / 10) + '%';
                html += monDetailItem('CPU', cpuStr + ' <span style="color:var(--text-muted);font-size:10px;">(' + (cpu.valor.nome || '') + ')</span>');
            } else if (cpu && cpu.stale) {
                html += monDetailItem('CPU', _semDados(cpu));
            } else if (cpu && cpu.indisponivel) {
                html += monDetailItem('CPU', '<span style="color:var(--text-muted);">' + esc(cpu.indisponivel) + '</span>');
            }
            // GPU
            const gpu = zbx.metricas && zbx.metricas.gpu;
            if (gpu && gpu.valor) {
                const gpuVal = parseFloat(gpu.valor.valor);
                const gpuStr = isNaN(gpuVal) ? gpu.valor.valor : (Math.round(gpuVal * 10) / 10) + '%';
                html += monDetailItem('GPU', gpuStr + ' <span style="color:var(--text-muted);font-size:10px;">(' + (gpu.valor.nome || '') + ')</span>');
            } else if (gpu && gpu.stale) {
                html += monDetailItem('GPU', _semDados(gpu));
            } else if (gpu && gpu.indisponivel) {
                html += monDetailItem('GPU', '<span style="color:var(--text-muted);">' + esc(gpu.indisponivel) + '</span>');
            }
            // RAM
            const ram = zbx.metricas && zbx.metricas.memoria;
            if (ram && ram.valor) {
                const ramVal = parseFloat(ram.valor.valor);
                const ramStr = isNaN(ramVal) ? ram.valor.valor : (Math.round(ramVal * 10) / 10) + '%';
                html += monDetailItem('RAM', ramStr + ' <span style="color:var(--text-muted);font-size:10px;">(' + (ram.valor.nome || '') + ')</span>');
            } else if (ram && ram.stale) {
                html += monDetailItem('RAM', _semDados(ram));
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
            } else if (uptime && uptime.stale) {
                html += monDetailItem('Uptime', _semDados(uptime));
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
    // Cartao grande e legivel: o valor e o dado principal, nao um rodape.
    return '<div style="padding:13px 16px;background:linear-gradient(145deg,rgba(255,255,255,0.06),rgba(255,255,255,0.015));' +
        'border:1px solid var(--border);border-radius:12px;min-width:175px;">' +
        '<div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.8px;font-weight:700;">' + label + '</div>' +
        '<div style="font-size:23px;line-height:1.2;color:var(--text-primary);font-weight:800;margin-top:6px;">' + valor + '</div>' +
        '</div>';
}

function monVerZabbix(ip) {
    window.open(monZabbixBase(), '_blank');
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
        opts = { cor: '#00d4ff', minForcado: 0, maxForcado: 100, altura: 200, unidade: '%', limiares: monLimiaresUso() };
    } else if (key === 'mon-kpi-cpu-tempo-real') {
        titulo = 'CPU em Tempo Real (%)';
        dados = _monCpuHist;
        opts = { cor: '#00e5c7', minForcado: 0, maxForcado: 100, altura: 200, unidade: '%', limiares: monLimiaresUso() };
    } else if (key === 'mon-kpi-gpu-tempo-real') {
        titulo = 'GPU em Tempo Real (%)';
        dados = _monGpuHist || [];
        opts = { cor: '#b24dff', minForcado: 0, maxForcado: 100, altura: 200, unidade: '%', limiares: monLimiaresUso() };
    } else if (key === 'mon-kpi-disponibilidade') {
        const linhas = (_monDados && _monDados.linhas) || [];
        if (linhas.length) {
            titulo = 'Disponibilidade por Host (%)';
            // null = SEM MEDICAO (nao inventa 0% para host instavel/sem dados)
            // null = sem medicao (nao inventa 0). Desligado esperado tambem
            // nao conta como 0%: ele fica fora do SLO (null), nao e falha.
            dados = linhas.map(l => {
                if (l.estado === 'ACESSIVEL') return 100;
                if (l.estado === 'SEM_DADOS' || l.estado === 'IP_OBSOLETO') return null;
                if (l.estado === 'DESLIGADO_ESPERADO' || l.estado === 'EMPRESA_PARADA') return null;
                // Instaveis: ainda nao e falha confirmada (esta dentro do limiar
                // de falhas consecutivas) — nao marcar como 0% definitivo.
                if (l.estado === 'INSTAVEL' || (l.falhasConsecutivas > 0 && l.falhasConsecutivas < (_monLimites.falhasConsecutivasParaAlerta || 3))) return null;
                return 0; // SEM_RESPOSTA = falha real confirmada
            });
            opts = { cor: '#00e676', minForcado: 0, maxForcado: 100, altura: 200, unidade: '%', rotulosX: linhas.map(l => l.nome || l.ip) };
        }
    } else if (['mon-kpi-total','mon-kpi-acessiveis','mon-kpi-semresposta','mon-kpi-instaveis','mon-kpi-semdados','mon-kpi-alertas','mon-kpi-incidentes'].indexOf(key) >= 0) {
        const linhas = (_monDados && _monDados.linhas) || [];
        if (linhas.length) {
            titulo = 'Latencia dos Hosts (ms)';
            // null = sem medicao (0 ms seria um valor otimo enganoso)
            dados = linhas.map(l => l.latenciaMediaMs != null ? l.latenciaMediaMs : null);
            opts = { cor: '#2962FF', altura: 200, unidade: 'ms', rotulosX: linhas.map(l => l.nome || l.ip), limiares: monLimiaresLatencia() };
        }
    } else if (key === 'mon-kpi-medicoes') {
        // sem serie temporal direta — usa contagem por dia se disponivel
        const dm = _monArmKPIs || {};
        if (dm.arquivos && dm.arquivos.length) {
            titulo = 'Medicoes por Dia';
            dados = dm.arquivos.map(a => a.medicoes);
            opts = { cor: '#a855f7', altura: 180, rotulosX: dm.arquivos.map(a => a.dia || 'Dia') };
        }
    } else if (key === 'mon-kpi-disco') {
        const discos = (_monArmKPIs && _monArmKPIs.discos) || [];
        if (discos.length) {
            titulo = 'Uso de Disco por Volume (%)';
            dados = discos.map(d => d.usoPct != null ? d.usoPct : null);
            opts = { cor: '#22c55e', altura: 180, minForcado: 0, maxForcado: 100, unidade: '%', rotulosX: discos.map(d => d.letra || '?'), limiares: monLimiaresDisco() };
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
    
    const agora = new Date().toLocaleString('pt-BR');
    const doc = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(titulo)} — Inventario TI</title>
    <link rel="stylesheet" href="/vendor/css/all.min.css">
    <link rel="stylesheet" href="/vendor/vendor.css">
    <style>
        :root {
            --primary: #00e5c7;
            --accent: #b24dff;
            --bg-deep: #070b14;
            --bg-base: #090e1a;
            --bg-surface: #0d1526;
            --bg-panel: rgba(13, 21, 38, 0.92);
            --border: rgba(255, 255, 255, 0.07);
            --text-primary: #e4e8f1;
            --text-secondary: #8892a8;
            --text-muted: #4e5a72;
            --green: #00e676;
            --yellow: #ffe600;
            --red: #ff4757;
            --cyan: #00e5c7;
            --purple: #b24dff;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg-deep);
            color: var(--text-primary);
            min-height: 100vh;
            line-height: 1.6;
        }
        .bg-orbs {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            pointer-events: none; z-index: 0; overflow: hidden;
        }
        .orb {
            position: absolute; border-radius: 50%;
            filter: blur(120px); opacity: 0.08;
        }
        .orb-1 {
            width: 700px; height: 700px;
            background: radial-gradient(circle, rgba(0,229,199,0.4) 0%, transparent 70%);
            top: -250px; right: -200px;
        }
        .orb-2 {
            width: 500px; height: 500px;
            background: radial-gradient(circle, rgba(178,77,255,0.3) 0%, transparent 70%);
            bottom: -150px; left: -100px;
        }
        .container {
            position: relative; z-index: 1;
            max-width: 1400px; margin: 0 auto;
            padding: 32px;
        }
        .header {
            background: var(--bg-panel);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 32px;
            margin-bottom: 32px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        }
        .header-top {
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: 24px; flex-wrap: wrap; gap: 16px;
        }
        .logo {
            display: flex; align-items: center; gap: 16px;
        }
        .logo-icon {
            width: 56px; height: 56px; border-radius: 14px;
            background: linear-gradient(135deg, rgba(0,229,199,0.15), rgba(178,77,255,0.1));
            display: flex; align-items: center; justify-content: center;
            border: 1px solid rgba(0,229,199,0.1);
        }
        .logo-icon i { font-size: 24px; color: var(--primary); }
        .logo-text h1 {
            font-size: 24px; font-weight: 800;
            background: linear-gradient(135deg, var(--primary), var(--accent));
            -webkit-background-clip: text; -webkit-text-fill-color: transparent;
            background-clip: text; letter-spacing: -0.5px;
        }
        .logo-text p {
            font-size: 13px; color: var(--text-muted); font-weight: 500;
        }
        .actions {
            display: flex; gap: 12px;
        }
        .btn {
            display: inline-flex; align-items: center; gap: 8px;
            padding: 12px 24px; border-radius: 10px;
            font-size: 13px; font-weight: 600;
            cursor: pointer; transition: all 0.2s;
            border: none; text-decoration: none;
        }
        .btn-primary {
            background: linear-gradient(135deg, var(--primary), var(--primary-dark, #00b89e));
            color: var(--bg-deep);
        }
        .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,229,199,0.3); }
        .btn-ghost {
            background: rgba(255,255,255,0.05);
            color: var(--text-primary);
            border: 1px solid var(--border);
        }
        .btn-ghost:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.15); }
        .meta {
            display: flex; gap: 32px; flex-wrap: wrap;
            padding-top: 24px; border-top: 1px solid var(--border);
        }
        .meta-item {
            display: flex; flex-direction: column; gap: 4px;
        }
        .meta-label {
            font-size: 11px; color: var(--text-muted);
            text-transform: uppercase; letter-spacing: 1px; font-weight: 600;
        }
        .meta-value {
            font-size: 15px; color: var(--text-primary); font-weight: 600;
        }
        .content {
            background: var(--bg-panel);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 32px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        }
        .chart-container {
            background: rgba(255,255,255,0.02);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 24px;
            overflow: auto;
        }
        .footer {
            margin-top: 32px; text-align: center;
            font-size: 12px; color: var(--text-muted);
            padding: 24px; border-top: 1px solid var(--border);
        }
        @media print {
            body { background: #fff; color: #000; }
            .bg-orbs, .actions { display: none; }
            .header, .content { box-shadow: none; border: 1px solid #ddd; background: #fff; }
            .logo-text h1 { -webkit-text-fill-color: #00897b; color: #00897b; }
        }
    </style>
</head>
<body>
    <div class="bg-orbs">
        <div class="orb orb-1"></div>
        <div class="orb orb-2"></div>
    </div>
    <div class="container">
        <div class="header">
            <div class="header-top">
                <div class="logo">
                    <div class="logo-icon"><i class="fas fa-chart-line"></i></div>
                    <div class="logo-text">
                        <h1>${esc(titulo)}</h1>
                        <p>Inventario TI — Relatorio de Monitoramento</p>
                    </div>
                </div>
                <div class="actions">
                    <button class="btn btn-ghost" onclick="window.print()">
                        <i class="fas fa-print"></i> Imprimir
                    </button>
                    <button class="btn btn-primary" onclick="window.close()">
                        <i class="fas fa-times"></i> Fechar
                    </button>
                </div>
            </div>
            <div class="meta">
                <div class="meta-item">
                    <span class="meta-label">Gerado em</span>
                    <span class="meta-value">${agora}</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">Sistema</span>
                    <span class="meta-value">Inventario TI v3.0</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">Tipo</span>
                    <span class="meta-value">Relatorio de Metricas</span>
                </div>
            </div>
        </div>
        <div class="content">
            <div class="chart-container">
                ${htmlConteudo}
            </div>
        </div>
        <div class="footer">
            <p>Inventario TI — Sistema de Gestao de Equipamentos</p>
            <p>Documento gerado automaticamente pelo sistema de monitoramento</p>
        </div>
    </div>
</body>
</html>`;
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


function monAbrirRelatorioHost(ip) {
    Promise.all([
        fetch('/api/monitor/host/' + encodeURIComponent(ip)).then(r => r.json()).catch(() => null),
        fetch('/api/zabbix/host/' + encodeURIComponent(ip)).then(r => r.json()).catch(() => null)
    ]).then(function(res) {
        const mon = res[0] || {}, zbx = res[1] || {};
        const st = mon.estadoAtual || {};
        const ml = mon.metricasLocais || null;
        const cpu = (ml && ml.cpu) || {}, mem = (ml && ml.memoria) || {};
        const gpu = (ml && ml.gpu && ml.gpu.gpus && ml.gpu.gpus[0]) || null;
        const dv = (ml && ml.disco && ml.disco.discos && ml.disco.discos[0]) || null;
        const up = (ml && ml.uptime) || {}, rede = (ml && ml.rede && ml.rede[0]) || {};
        const info = (ml && ml.info) || {};
        const alertas = mon.alertas || [], indisp = mon.indisponiveis || [];
        const serie = mon.serieDiaria || [], janela = st.janelaRecente || [];
        const ok = st.ultimoResultado === 'ACESSIVEL';
        const pct = v => (v != null && isFinite(v)) ? Math.round(v) + '%' : '—';
        const esc2 = s => String(s == null ? '—' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
        const kpi = (cor, label, valor, sub) =>
            '<div class="kpi" style="border-left-color:' + cor + '"><span class="kl">' + esc2(label) + '</span>' +
            '<b style="color:' + cor + '">' + esc2(valor) + '</b><span class="ks">' + esc2(sub) + '</span></div>';
        const linha = (a, b) => '<div class="ln"><span>' + esc2(a) + '</span><b>' + b + '</b></div>';

        let kpis = kpi(ok ? '#00e676' : '#ff4757', 'Estado', ok ? 'ACESSÍVEL' : esc2(st.ultimoResultado || 'SEM DADOS'), 'Coletor ICMP') +
            kpi('#00e5c7', 'Latência', st.latenciaMediaMs != null ? Math.round(st.latenciaMediaMs) + ' ms' : '—', 'Última coleta') +
            kpi('#b24dff', 'CPU', pct(cpu.usoPct), (cpu.nucleos || '?') + ' núcleos · real') +
            kpi('#ff9f43', 'RAM', pct(mem.usoPct), (mem.usadoGb || '?') + '/' + (mem.totalGb || '?') + ' GB');

        let sistema = '<div class="grid">' +
            linha('Hostname', esc2((ml && ml.hostname) || ip)) +
            linha('GPU', gpu ? esc2(gpu.nome || 'GPU') + ' · <span style="color:#00e5c7">' + pct(gpu.usoPct) + '</span>' : 'Indisponível') +
            linha('Disco', dv ? esc2(dv.letra) + ' · <span style="color:#00e5c7">' + pct(dv.usoPct) + '</span> (' + esc2(dv.livreGb) + ' GB livres)' : '—') +
            linha('Uptime', esc2(up.uptimeHumano || '—')) +
            linha('Boot', esc2(up.bootTime ? new Date(up.bootTime).toLocaleString('pt-BR') : '—')) +
            linha('Rede', esc2(rede.nome || '—') + ' · <span style="color:#00e5c7">' + esc2(rede.ip || ip) + '</span>') +
            linha('Kernel', esc2(info.release || '—')) + '</div>';
        if (!ml) sistema = '<p style="color:#8892a8">Métricas locais indisponíveis neste equipamento.</p>';

        let timeline = '';
        if (janela.length) {
            timeline = '<div class="timeline">' + janela.slice().reverse().map(function(j) {
                return '<span class="dot ' + (j.ok ? 'ok' : 'bad') + '" title="' + esc2(j.timestamp ? new Date(j.timestamp).toLocaleTimeString('pt-BR') : '') + ' · ' +
                    (j.latenciaMediaMs != null ? Math.round(j.latenciaMediaMs) + 'ms' : '—') + '"></span>';
            }).join('') + '</div><p class="leg">' + janela.filter(j => j.ok).length + '/' + janela.length + ' verificações OK nas últimas 20 coletas</p>';
        }

        let tabela = '';
        if (serie.length) {
            tabela = '<table class="tbl"><thead><tr><th>Dia</th><th>Coletas</th><th>Perda</th><th>Lat. média</th><th>P95</th><th>Disponibilidade</th></tr></thead><tbody>' +
                serie.map(function(s) {
                    const perda = parseFloat(s.perdaPct) || 0;
                    const largura = Math.max(3, Math.round(100 - perda));
                    return '<tr><td>' + esc2(s.dia) + '</td><td>' + esc2(s.total) + '</td><td>' + esc2(s.perdaPct) + '%</td><td>' +
                        esc2(s.latenciaMediaMs != null ? Math.round(s.latenciaMediaMs) + 'ms' : '—') + '</td><td>' +
                        esc2(s.latenciaP95Ms != null ? Math.round(s.latenciaP95Ms) + 'ms' : '—') + '</td>' +
                        '<td><div class="bar"><i style="width:' + largura + '%"></i></div><small>' + largura + '%</small></td></tr>';
                }).join('') + '</tbody></table>';
        }

        let zabbixHtml = '';
        if (zbx.encontrado) {
            const h = zbx.host || {};
            const disp = h.disponivel === null ? 'Desconhecido' : (h.disponivel ? '<span class="badge ok">Conectado</span>' : '<span class="badge bad">Sem agente</span>');
            zabbixHtml = '<div class="grid">' + linha('Hostname Zabbix', esc2(h.hostname || h.host || '—')) + linha('Agente', disp) +
                linha('Host ID', esc2(h.hostid || '—')) + linha('Triggers', String((zbx.triggers || []).length)) + '</div>';
            if ((zbx.triggers || []).length) {
                zabbixHtml += '<h3>Triggers</h3><table class="tbl"><thead><tr><th>Estado</th><th>Descrição</th></tr></thead><tbody>' +
                    zbx.triggers.slice(0, 8).map(t => '<tr><td><span class="badge ' + (String(t.estado) === '1' ? 'bad' : 'ok') + '">' +
                        (String(t.estado) === '1' ? 'PROBLEM' : 'OK') + '</span></td><td>' + esc2(t.descricao) + '</td></tr>').join('') + '</tbody></table>';
            }
        } else {
            zabbixHtml = '<p style="color:#8892a8">' + esc2(zbx.nota || zbx.erro || 'Host não encontrado no Zabbix.') + '</p>';
        }

        let alertasHtml = alertas.length
            ? '<table class="tbl"><thead><tr><th>Gravidade</th><th>Título</th><th>Confiança</th></tr></thead><tbody>' +
              alertas.map(a => '<tr><td>' + esc2(a.gravidade) + '</td><td>' + esc2(a.titulo) + '</td><td>' + esc2(a.confianca) + '</td></tr>').join('') + '</tbody></table>'
            : '<p style="color:#00e676"><i class="fas fa-check-circle"></i> Nenhum alerta aberto.</p>';

        const doc = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">' +
            '<meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<title>Relatório Detalhado — ' + esc2(ip) + '</title><style>' +
            '* { box-sizing:border-box } body{margin:0;padding:32px 20px;background:#0b1020;color:#e4e8f1;font:14px/1.55 "Segoe UI",Arial,sans-serif;}' +
            '.wrap{max-width:1120px;margin:0 auto} .hero{background:linear-gradient(135deg,#12233d,#0d1526);border:1px solid rgba(0,229,199,.2);border-radius:18px;padding:26px 30px;margin-bottom:18px;}' +
            '.hero h1{margin:0;font-size:26px;color:#00e5c7;letter-spacing:-.5px} .hero p{margin:6px 0 0;color:#8892a8;font-size:13px}' +
            '.tag{display:inline-block;padding:4px 10px;border-radius:20px;background:rgba(0,229,199,.12);color:#00e5c7;font-size:11px;font-weight:700;margin-right:6px;}' +
            '.btn{background:#00b89e;color:#04140f;border:0;padding:9px 16px;border-radius:8px;font-weight:800;cursor:pointer;margin:14px 8px 0 0;font-size:12px;}' +
            '.btn.ghost{background:rgba(255,255,255,.08);color:#e4e8f1}' +
            '.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;}' +
            '.kpi{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-left:5px solid #00e5c7;border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:3px;}' +
            '.kpi .kl{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#8892a8;font-weight:700} .kpi b{font-size:30px;line-height:1.15} .kpi .ks{font-size:11px;color:#8892a8}' +
            '.card{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:18px 20px;margin-top:16px;}' +
            '.card h2{margin:0 0 12px;font-size:15px;color:#00d4ff;text-transform:uppercase;letter-spacing:.8px} .card h3{font-size:12px;color:#8892a8;margin:16px 0 6px;}' +
            '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px 24px} .ln{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:12px;} .ln span{color:#8892a8} .ln b{color:#e4e8f1;text-align:right}' +
            'table.tbl{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px} .tbl th,.tbl td{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06);text-align:left} .tbl th{color:#8892a8;font-size:10px;text-transform:uppercase;letter-spacing:.6px}' +
            '.timeline{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px} .dot{width:16px;height:16px;border-radius:4px} .dot.ok{background:#00e676} .dot.bad{background:#ff4757}' +
            '.leg{color:#8892a8;font-size:11px;margin:8px 0 0} .bar{height:7px;background:rgba(255,255,255,.08);border-radius:4px;overflow:hidden;width:100px;display:inline-block;vertical-align:middle} .bar i{display:block;height:100%;background:#00e676}' +
            '.badge{padding:2px 8px;border-radius:20px;font-size:10px;font-weight:800} .badge.ok{background:rgba(0,230,118,.15);color:#00e676} .badge.bad{background:rgba(255,71,87,.15);color:#ff4757}' +
            '@media print{body{background:#fff;color:#111}.hero,.card{background:#fff;border-color:#ccc}.btn{display:none}.kpi b{color:#111!important}.ln b,.tbl td{color:#111}}' +
            '</style></head><body><div class="wrap">' +
            '<div class="hero"><h1>Relatório Detalhado — ' + esc2(ip) + '</h1>' +
            '<p><span class="tag">Inventário TI</span><span class="tag">Monitoramento</span>Gerado em ' + new Date().toLocaleString('pt-BR') + '</p>' +
            '<button class="btn" onclick="window.print()">Imprimir / Salvar PDF</button><button class="btn ghost" onclick="window.close()">Fechar</button></div>' +
            '<div class="kpis">' + kpis + '</div>' +
            '<div class="card"><h2>Sistema — métricas reais</h2>' + sistema + '</div>' +
            '<div class="card"><h2>Disponibilidade — últimas 20 verificações</h2>' + (timeline || '<p style="color:#8892a8">Sem janela recente.</p>') +
            '<h3>Série diária (7 dias)</h3>' + (tabela || '<p style="color:#8892a8">Sem dados diários.</p>') + '</div>' +
            '<div class="card"><h2>Zabbix (agente)</h2>' + zabbixHtml + '</div>' +
            (indisp.length ? '<div class="card"><h2>Dados indisponíveis</h2><p style="color:#8892a8">' + indisp.map(esc2).join(' · ') + '</p></div>' : '') +
            '<div class="card"><h2>Alertas (' + alertas.length + ')</h2>' + alertasHtml + '</div>' +
            '</div></body></html>';

        const w = window.open('', '_blank');
        if (!w) { alert('Pop-up bloqueado. Permita pop-ups para este site.'); return; }
        w.document.write(doc);
        w.document.close();
        try { w.history.replaceState({ relatorio: true }, '', '/relatorio.html?host=' + encodeURIComponent(ip)); } catch (e) {}
    }).catch(function(e) {
        alert('Erro ao gerar relatório: ' + (e && e.message));
    });
}


// ==================== RELATORIO DETALHADO DO PC ====================

// ==================== RELATORIO DETALHADO DO PC ====================

// ==================== RELATORIO DETALHADO DO PC ====================
function monAbrirRelatorioPC() {
    // Busca dados via API
    Promise.all([
        fetch('/api/monitor/sistema').then(r => r.json()).catch(() => null),
        fetch('/api/monitor/historico?host=' + encodeURIComponent(_monLocalIp) + '&dias=30').then(r => r.json()).catch(() => null)
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

        monAplicarLimites(hist);

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
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ==================== BOOTSTRAP (widget do Painel) ====================
// Popula o widget "Monitoramento da Rede" no dashboard mesmo antes do usuario
// abrir a aba de monitoramento. Atualiza tambem quando a aba e aberta.
if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', function () {
        try {
            fetch('/api/monitor/local').then(function (r) { return r.json(); }).then(function (d) { if (d && d.ip) _monLocalIp = d.ip; }).catch(function () {});
            fetch('/api/monitor/painel').then(function (r) { return r.json(); }).then(function (d) {
                if (d && d.resumo) { monAplicarLimites(d); _monDados = d; monRenderDashboardWidget(); }
            }).catch(function () {});
            monRenderZabbixProblemas();
        } catch (e) {}
    });
}
