'use strict';
/**
 * Motor de Mock — gera monitoramento simulado para os 101 PCs
 * do inventario original (192.168.0.94:3030).
 * 
 * Cada PC recebe:
 * - IP ficticio (192.168.0.200+)
 * - Metricas realistas (CPU, RAM, Disco) com sequencias positivas/negativas
 * - Estado de conectividade que alterna (ACESSIVEL/SEM_RESPOSTA/INSTAVEL)
 * - Historico para graficos cardiacos
 * 
 * A sequencia e deterministica baseada no tempo, garantindo
 * que cada PC tenha seu proprio ciclo de saude/falha.
 */

const fs = require('fs');
const path = require('path');

const INVENTARIO_PATH = path.join(__dirname, 'data', 'inventario-original.json');

// Cache do inventario
let _inventario = null;
function carregarInventario() {
    if (_inventario) return _inventario;
    try {
        let raw = fs.readFileSync(INVENTARIO_PATH, 'utf8');
        if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
        _inventario = JSON.parse(raw);
    } catch (e) {
        _inventario = { computadores: [] };
    }
    return _inventario;
}

// Estado mock por PC — persistido em memoria durante a execucao do servidor
const mockEstado = {}; // { [pcId]: { t, fase, cpuBase, ramBase, ... historico } }
const IP_OFFSET = 200; // IPs comecam em 192.168.0.200

/**
 * Retorna a lista de alvos mock baseados no inventario original.
 * Cada PC real vira um alvo com IP ficticio.
 */
function obterAlvosMock() {
    const inv = carregarInventario();
    const pcs = inv.computadores || [];
    return pcs.map((pc, idx) => ({
        id: 'MOCK-' + pc.id,
        nome: pc.nomePc || ('PC-' + pc.id),
        ip: '192.168.0.' + (IP_OFFSET + idx),
        setor: pc.departamento || 'SEM SETOR',
        mock: true,
        inventario: {
            numeroSerie: pc.numeroSerie,
            modelo: pc.modeloMarca,
            processador: pc.processador,
            ram: pc.memoriaRam,
            disco: pc.armazenamento,
            usuario: pc.usuarioDesignado,
            status: pc.status,
            localizacao: pc.localizacao,
            sistemaOperacional: pc.sistemaOperacional
        }
    }));
}

/**
 * Gera uma sequencia realista de metricas para um PC mock.
 * Alterna entre fase POSITIVA (saudavel) e NEGATIVA (com falha).
 * Cada PC tem deslocamento (offset) baseado no seu ID para variar.
 */
function gerarMetricas(pcId, ip) {
    if (!mockEstado[pcId]) {
        // Offset deterministico baseado no ID para cada PC ter ciclo diferente
        const seed = typeof pcId === 'string' ? pcId.split('').reduce((a, c) => a + c.charCodeAt(0), 0) : pcId;
        mockEstado[pcId] = {
            t: seed % 30, // deslocamento inicial variado
            fase: 'POSITIVA',
            cpuBase: 10 + (seed % 20),       // 10-30%
            ramBase: 30 + (seed % 25),       // 30-55%
            discoBase: 35 + (seed % 30),     // 35-65%
            historico: [],
            cicloDuracao: 15 + (seed % 10),  // 15-25 ciclos por fase
            falhasConsecutivas: 0,
            ultimoEstado: 'ACESSIVEL'
        };
    }
    const s = mockEstado[pcId];
    s.t++;
    const dur = s.cicloDuracao;

    // Alterna fase
    if (s.t % dur === 1 && s.t > 1) {
        s.fase = s.fase === 'POSITIVA' ? 'NEGATIVA' : 'POSITIVA';
    }

    const fasePct = (s.t % dur) / dur;

    let cpu, ram, disco, latencia, ok, estado;

    if (s.fase === 'POSITIVA') {
        // Saudavel: CPU baixa, RAM moderada, disco estavel, ping OK
        const wave = Math.sin(fasePct * Math.PI * 2);
        cpu = Math.max(2, Math.min(40, s.cpuBase + wave * 8 + (Math.random() * 6 - 3)));
        ram = Math.max(20, Math.min(60, s.ramBase + wave * 6 + (Math.random() * 5 - 2.5)));
        disco = Math.min(85, s.discoBase + s.t * 0.03 + (Math.random() * 1 - 0.5));
        latencia = Math.max(1, Math.round(2 + Math.random() * 30 + wave * 5));

        // 95% de chance de estar acessivel na fase positiva
        ok = Math.random() > 0.05;
        if (ok) { estado = 'ACESSIVEL'; s.falhasConsecutivas = 0; }
        else { estado = 'SEM_RESPOSTA'; s.falhasConsecutivas++; }
    } else {
        // Negativa: metricas criticas, CPU alta, RAM alta, disco cheio
        const progressao = fasePct;
        const wave = Math.sin(fasePct * Math.PI * 3);
        cpu = Math.min(99, 55 + progressao * 40 + wave * 10 + (Math.random() * 8 - 4));
        ram = Math.min(98, 65 + progressao * 30 + wave * 8 + (Math.random() * 5 - 2.5));
        disco = Math.min(97, 75 + progressao * 18 + (Math.random() * 1 - 0.5));
        latencia = Math.round(15 + progressao * 100 + Math.random() * 40);

        // Chance de falha aumenta com o progresso da fase negativa
        const chanceFalha = 0.3 + progressao * 0.65; // 30% -> 95%
        ok = Math.random() > chanceFalha;
        if (ok) { estado = s.falhasConsecutivas > 2 ? 'INSTAVEL' : 'ACESSIVEL'; s.falhasConsecutivas = 0; }
        else { s.falhasConsecutivas++; estado = s.falhasConsecutivas >= 3 ? 'SEM_RESPOSTA' : 'INSTAVEL'; }
    }

    s.ultimoEstado = estado;
    const metricas = {
        cpu: Math.round(cpu * 10) / 10,
        ram: Math.round(ram * 10) / 10,
        disco: Math.round(disco * 10) / 10,
        latenciaMs: latencia,
        fase: s.fase,
        progressao: Math.round(fasePct * 100),
        estado: estado,
        falhasConsecutivas: s.falhasConsecutivas
    };

    // Historico para graficos (ultimas 150 amostras)
    s.historico.push({
        t: s.t,
        cpu: metricas.cpu,
        ram: metricas.ram,
        disco: metricas.disco,
        latencia: latencia,
        ok: ok,
        estado: estado,
        fase: s.fase,
        timestamp: new Date().toISOString()
    });
    if (s.historico.length > 150) s.historico.shift();

    return { ok, latenciaMs: latencia, perdaPct: ok ? Math.round(Math.random() * 3 * 100) / 100 : Math.round((60 + Math.random() * 40) * 100) / 100, metricas };
}

/**
 * Gera dados de monitoramento completos para todos os PCs mock.
 * Retorna no formato compativel com o painel do frontend.
 */
function gerarPainelMock() {
    const alvos = obterAlvosMock();
    const agora = new Date().toISOString();

    let acessiveis = 0, semResposta = 0, instaveis = 0, alertasAbertos = 0, incidentesSetor = 0;
    const linhas = [];
    const alertas = [];
    const incidentes = [];

    // Agrupa por setor para detectar falha em massa
    const porSetor = {};

    for (const alvo of alvos) {
        const r = gerarMetricas(alvo.id, alvo.ip);
        const m = r.metricas;

        if (m.estado === 'ACESSIVEL') acessiveis++;
        else if (m.estado === 'SEM_RESPOSTA') semResposta++;
        else if (m.estado === 'INSTAVEL') instaveis++;

        // Formata metricas como string para o frontend
        const ramGbTotal = parseFloat(alvo.inventario.ram) || 8;
        const ramUsadoGb = Math.round(ramGbTotal * m.ram / 100 * 10) / 10;
        const discoTotal = parseFloat(alvo.inventario.disco) || 256;
        const discoUsado = Math.round(discoTotal * m.disco / 100 * 10) / 10;

        linhas.push({
            id: alvo.id,
            nome: alvo.nome,
            ip: alvo.ip,
            setor: alvo.setor,
            local: false,
            estado: m.estado,
            latenciaMediaMs: m.latenciaMs,
            falhasConsecutivas: m.falhasConsecutivas,
            downSince: m.estado === 'SEM_RESPOSTA' ? agora : null,
            ultimoHorario: agora,
            alertasAtivos: 0,
            fonte: 'MOCK_SIMULACAO',
            cpu: m.cpu + '%',
            gpu: 'Indisp.',
            ram: m.ram + '% (' + ramUsadoGb + '/' + ramGbTotal + ' GB)',
            disco: m.disco + '% (' + discoUsado + '/' + discoTotal + ' GB)',
            uptime: m.fase === 'POSITIVA' ? '120h ' + (m.t % 60) + 'm' : '240h ' + (m.t % 60) + 'm',
            reinicioConfirmado: 'NAO',
            mock: true,
            inventario: alvo.inventario
        });

        // Gera alertas para hosts criticos
        if (m.fase === 'NEGATIVA' && m.progressao > 60) {
            alertasAbertos++;
            alertas.push({
                id: 'MOCK-ALR-' + alvo.id,
                categoria: m.estado === 'SEM_RESPOSTA' ? 'CONECTIVIDADE' : 'INSTABILIDADE',
                gravidade: m.progressao > 85 ? 'CRITICA' : m.progressao > 70 ? 'ALTA' : 'MEDIA',
                host: alvo.ip,
                titulo: m.estado === 'SEM_RESPOSTA'
                    ? alvo.nome + ' sem resposta — falha em ' + alvo.setor
                    : alvo.nome + ' instavel — CPU ' + m.cpu + '% RAM ' + m.ram + '%',
                evidencias: [
                    'Fase negativa: ' + m.progressao + '% concluida',
                    'CPU: ' + m.cpu + '% | RAM: ' + m.ram + '% | Disco: ' + m.disco + '%',
                    'Latencia: ' + m.latenciaMs + 'ms',
                    'Estado: ' + m.estado
                ],
                confianca: m.progressao > 80 ? 'CONFIRMADA' : m.progressao > 60 ? 'ALTA' : 'MODERADA',
                recomendacao: 'Verificar equipamento — PC ' + alvo.nome + ' em ' + alvo.setor + ' (usuario: ' + (alvo.inventario.usuario || 'nao definido') + ')',
                estado: 'ABERTO',
                inicio: agora,
                ocorrencias: m.progressao
            });
        }

        // Agrupa por setor
        if (!porSetor[alvo.setor]) porSetor[alvo.setor] = { total: 0, caidos: 0, hosts: [] };
        porSetor[alvo.setor].total++;
        if (m.estado === 'SEM_RESPOSTA') {
            porSetor[alvo.setor].caidos++;
            porSetor[alvo.setor].hosts.push(alvo.ip);
        }
    }

    // Detecta incidentes de setor (>=30% caidos)
    for (const [setor, info] of Object.entries(porSetor)) {
        if (info.total >= 3 && info.caidos / info.total >= 0.3) {
            incidentesSetor++;
            incidentes.push({
                setor: setor,
                afetados: info.caidos,
                total: info.total,
                hosts: info.hosts,
                titulo: 'Possivel falha de infraestrutura no setor ' + setor,
                confianca: info.caidos >= 5 ? 'ALTA' : 'MODERADA'
            });
        }
    }

    return {
        resumo: {
            totalAlvos: alvos.length,
            acessiveis: acessiveis,
            semResposta: semResposta,
            instaveis: instaveis,
            semDados: 0,
            alertasAbertos: alertasAbertos,
            incidentesSetor: incidentesSetor
        },
        linhas: linhas,
        alertas: alertas,
        incidentes: incidentes,
        servico: {
            rodando: true,
            intervaloSegundos: 60,
            zabbixHabilitado: false,
            ultimaExecucao: { quando: agora, alvos: alvos.length, medicoes: alvos.length },
            estatisticas: { ciclos: Math.floor(Date.now() / 60000), medicoes: alvos.length, erros: 0 }
        },
        fonte: 'MOCK_INVENTARIO_ORIGINAL'
    };
}

/**
 * Retorna o historico de metricas de um PC mock especifico.
 */
function obterHistoricoMock(pcId) {
    const s = mockEstado[pcId];
    if (!s) return { historico: [] };
    return { historico: s.historico, fase: s.fase, t: s.t };
}

module.exports = { obterAlvosMock, gerarMetricas, gerarPainelMock, obterHistoricoMock };
