'use strict';
/**
 * Motor de correlacao e diagnosticos.
 * Regras explicitas, niveis de confianca, sem inventar causas.
 * Princípio: sempre distinguir medicao comprovada x suspeita x indisponivel.
 */

const NIVEIS = { CONFIRMADO: 5, ALTA: 4, MODERADA: 3, BAIXA: 2, INCONCLUSIVO: 1 };

function novoAlerta(categoria, gravidade, host, titulo, evidencias, confianca, recomendacao) {
    return {
        id: 'ALR-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        categoria,           // CONECTIVIDADE | LATENCIA | INSTABILIDADE | INFRA | SERVICO | IDENTIDADE
        gravidade,           // INFO | BAIXA | MEDIA | ALTA | CRITICA
        host,
        titulo,
        evidencias: Array.isArray(evidencias) ? evidencias : [evidencias],
        confianca,           // CONFIRMADO | ALTA | MODERADA | BAIXA | INCONCLUSIVO
        recomendacao,
        estado: 'ABERTO',    // ABERTO | ACK | RESOLVIDO | ENCERRADO
        inicio: new Date().toISOString(),
        ultimaOcorrencia: new Date().toISOString(),
        ocorrencias: 1,
        historico: [{ quando: new Date().toISOString(), evento: 'ABERTO', detalhe: titulo }]
    };
}

function atualizarAlertaExistente(alerta, detalhe) {
    alerta.ultimaOcorrencia = new Date().toISOString();
    alerta.ocorrencias += 1;
    alerta.historico.push({ quando: alerta.ultimaOcorrencia, evento: 'REPETICAO', detalhe });
}

/**
 * Avalia um host com base na janela de medicoes recentes + estado anterior.
 * Retorna { novosAlertas, atualizados, resolucoes, diagnostico }.
 */
function avaliarHost(host, medicoesRecentes, estadoAnterior, config, contextoRede) {
    const novos = [];
    const atualizados = [];
    const resolucoes = [];
    const diagnostico = {
        host,
        observado: {},
        hipoteses: [],
        indisponiveis: [
            'Uso de RAM: indisponivel — monitoramento interno do Windows nao disponivel (sem agente, sem WMI remoto autorizado).',
            'Uso de CPU: indisponivel — monitoramento interno do Windows nao disponivel.',
            'Reinicio confirmado do Windows: indisponivel — requer eventos internos (WEF/agent). Ciclos de ping sao apenas sinal indireto.'
        ],
        confiancaGeral: 'INCONCLUSIVO'
    };

    if (!medicoesRecentes || medicoesRecentes.length === 0) {
        diagnostico.confiancaGeral = 'INCONCLUSIVO';
        diagnostico.observado.semDados = true;
        return { novos, atualizados, resolucoes, diagnostico };
    }

    const total = medicoesRecentes.length;
    const sucessos = medicoesRecentes.filter(m => m.ok);
    const falhas = medicoesRecentes.filter(m => !m.ok);
    const perdaPct = (falhas.length / total) * 100;

    const latencias = sucessos
        .map(m => m.latenciaMediaMs)
        .filter(v => v != null && !isNaN(v))
        .sort((a, b) => a - b);

    const latMedia = latencias.length ? latencias.reduce((a, b) => a + b, 0) / latencias.length : null;
    const latP95 = latencias.length >= (config.limites.minimoAmostrasParaP95 || 20)
        ? latencias[Math.ceil(0.95 * latencias.length) - 1]
        : (latencias.length ? latencias[latencias.length - 1] : null);
    const latMax = latencias.length ? latencias[latencias.length - 1] : null;

    // Falhas consecutivas (baseado na ordem temporal)
    let falhasConsecutivas = 0;
    for (let i = medicoesRecentes.length - 1; i >= 0; i--) {
        if (!medicoesRecentes[i].ok) falhasConsecutivas++;
        else break;
    }

    diagnostico.observado = {
        totalMedicoes: total,
        sucessos: sucessos.length,
        falhas: falhas.length,
        perdaPct: Math.round(perdaPct * 100) / 100,
        latenciaMediaMs: latMedia !== null ? Math.round(latMedia * 100) / 100 : null,
        latenciaP95Ms: latP95,
        latenciaMaxMs: latMax,
        falhasConsecutivas,
        ultimoResultado: medicoesRecentes[medicoesRecentes.length - 1].ok ? 'ACESSIVEL' : 'SEM_RESPOSTA',
        ultimoHorario: medicoesRecentes[medicoesRecentes.length - 1].timestamp
    };

    // ---- Regra: totalmente inacessivel por varias tentativas ----
    const limFalhas = config.limites.falhasConsecutivasParaAlerta || 3;
    if (falhasConsecutivas >= limFalhas) {
        const setorAfetados = contextoRede && contextoRede.setor ? contextoRede.setorAfetadosMesmoSetor : 0;
        const conf = setorAfetados > 1 ? 'ALTA' : 'MODERADA';

        diagnostico.observado.semRespostaConfirmada = true;

        if (setorAfetados > 1) {
            diagnostico.hipoteses.push({
                titulo: 'Possivel falha de infraestrutura compartilhada',
                confianca: conf,
                base: `Alem deste equipamento, ${setorAfetados} outros do mesmo setor/segmento tambem apresentam falha.`
            });
            novos.push(novoAlerta(
                'INFRA',
                'ALTA',
                host,
                `Sem resposta com indicios de falha em massa no setor`,
                [
                    `${falhasConsecutivas} falhas consecutivas de ping`,
                    `${setorAfetados} equipamentos do mesmo setor afetados simultaneamente`,
                    'Investigar switch, roteador e cabos compartilhados do segmento'
                ],
                conf,
                'Priorizar investigacao da infraestrutura compartilhada (switch, porta uplink, roteador) antes do equipamento individual.'
            ));
        } else {
            diagnostico.hipoteses.push({
                titulo: 'Possivel falha local de conectividade',
                confianca: 'MODERADA',
                base: 'Apenas este equipamento esta sem resposta; outros do mesmo setor respondem.'
            });
            novos.push(novoAlerta(
                'CONECTIVIDADE',
                'MEDIA',
                host,
                'Equipamento sem resposta a verificacoes de rede',
                [
                    `${falhasConsecutivas} falhas consecutivas de ping`,
                    'Gateway e demais equipamentos do setor respondendo normalmente',
                    'Nao e possivel confirmar se o PC esta desligado, com firewall bloqueando ICMP ou com problema de rede'
                ],
                'MODERADA',
                'Verificar fisicamente o cabo, a porta do switch e o estado do equipamento. ICMP bloqueado tambem causa este sintoma.'
            ));
        }
    }

    // ---- Regra: instabilidade (oscilacao ok/falha) ----
    let transicoes = 0;
    for (let i = 1; i < medicoesRecentes.length; i++) {
        if (medicoesRecentes[i].ok !== medicoesRecentes[i - 1].ok) transicoes++;
    }
    const taxaTransicao = total > 1 ? transicoes / (total - 1) : 0;

    // ---- Regra: quedas FREQUENTES (mais de N quedas na janela) ----
    // Conta apenas transicoes OK->FALHA (quedas reais, nao recuperacoes)
    let quedas = 0;
    const horariosQueda = [];
    for (let i = 1; i < medicoesRecentes.length; i++) {
        if (medicoesRecentes[i - 1].ok && !medicoesRecentes[i].ok) {
            quedas++;
            if (medicoesRecentes[i].timestamp) horariosQueda.push(medicoesRecentes[i].timestamp);
        }
    }
    const limQuedas = (config.limites && config.limites.quedasFrequentesNaJanela) || 30;
    const janelaMinutos = (config.coletor && config.coletor.intervaloSegundos ? Math.round((config.coletor.intervaloSegundos * total) / 60) : 30);

    if (quedas >= limQuedas) {
        const setorAfetados = contextoRede && contextoRede.setor ? contextoRede.setorAfetadosMesmoSetor : 0;
        const conf = setorAfetados > 1 ? 'ALTA' : 'MODERADA';
        const ultimosHorarios = horariosQueda.slice(-5).map(h => new Date(h).toLocaleTimeString('pt-BR')).join(', ');

        diagnostico.observado.quedasFrequentes = true;
        diagnostico.observado.totalQuedas = quedas;

        diagnostico.hipoteses.push({
            titulo: 'PC com quedas frequentes de conexao',
            confianca: conf,
            base: `${quedas} quedas detectadas na janela de ~${janelaMinutos} minutos. ${setorAfetados > 1 ? setorAfetados + ' outros do mesmo setor tambem afetados.' : 'Apenas este equipamento afetado.'}`
        });

        novos.push(novoAlerta(
            'INSTABILIDADE',
            quedas >= limQuedas * 2 ? 'CRITICA' : 'ALTA',
            host,
            `PC com ${quedas} quedas de conexao (frequente)`,
            [
                `Total de quedas na janela: ${quedas} (limite configuravel: ${limQuedas})`,
                `Janela de tempo: ~${janelaMinutos} minutos`,
                `Ultimos horarios de queda: ${ultimosHorarios || 'indisponivel'}`,
                setorAfetados > 1
                    ? `${setorAfetados} equipamentos do mesmo setor tambem apresentam quedas — possivel problema de infraestrutura (switch, cabo, gateway)`
                    : 'Apenas este PC apresenta quedas — possivel problema local (cabo frouxo, porta de switch com erro, placa de rede, IP em conflito)',
                'A TI deve contatar o usuario para confirmar sintomas e combinar horario de atendimento'
            ],
            conf,
            setorAfetados > 1
                ? 'Investigar infraestrutura compartilhada do setor (switch, porta uplink, gateway) antes do equipamento individual.'
                : 'Verificar fisicamente: cabo, porta do switch, placa de rede do PC. Considerar substituicao de cabo ou troca de porta.'
        ));
    }

    if (taxaTransicao > 0.3 && falhasConsecutivas < limFalhas && quedas < limQuedas) {
        diagnostico.observado.instavel = true;
        diagnostico.hipoteses.push({
            titulo: 'Possivel instabilidade de comunicacao',
            confianca: 'MODERADA',
            base: `Taxa de alternancia entre sucesso e falha de ${Math.round(taxaTransicao * 100)}%`
        });
        novos.push(novoAlerta(
            'INSTABILIDADE',
            'MEDIA',
            host,
            'Comunicacao instavel (alternancia entre resposta e falha)',
            [
                `${transicoes} alternancias entre OK e falha em ${total} medicoes`,
                'Pode indicar cabo frouxo, porta de switch com erro, Wi-Fi instavel ou IP em conflito',
                'Nao e possivel confirmar a causa sem dados do switch/Wi-Fi'
            ],
            'MODERADA',
            'Correlacionar com contadores de erro da porta do switch (quando SNMP disponivel) e verificar se outros do mesmo segmento oscilam.'
        ));
    }

    // ---- Regra: latencia elevada ----
    const limLat = config.limites.latenciaMediaMs || 80;
    if (latMedia !== null && latMedia > limLat && sucessos.length >= 3) {
        // Comparar com mediana dos vizinhos do mesmo setor (baseline relativo)
        const baselineSetor = contextoRede && contextoRede.medianaSetorMs;
        const relativo = baselineSetor ? latMedia / baselineSetor : null;
        const critico = relativo ? relativo > 3 : latMedia > limLat * 3;

        diagnostico.observado.latenciaElevada = true;
        diagnostico.hipoteses.push({
            titulo: critico ? 'Possivel problema de rede ou congestionamento' : 'Latencia acima do limite configurado',
            confianca: critico ? 'ALTA' : 'MODERADA',
            base: `Media de ${Math.round(latMedia)}ms (limite ${limLat}ms)` +
                (relativo ? `; ${Math.round(relativo * 100)}% da mediana do setor` : '')
        });

        novos.push(novoAlerta(
            'LATENCIA',
            critico ? 'ALTA' : 'BAIXA',
            host,
            critico ? 'Latencia persistentemente elevada' : 'Latencia acima do limite',
            [
                `Latencia media: ${Math.round(latMedia)}ms`,
                `P95: ${latP95 != null ? Math.round(latP95) : 'indisponivel'}ms`,
                `Maxima: ${latMax != null ? Math.round(latMax) : 'indisponivel'}ms`,
                baselineSetor ? `Mediana do setor: ${Math.round(baselineSetor)}ms` : 'Baseline do setor indisponivel'
            ],
            critico ? 'ALTA' : 'MODERADA',
            'Investigar utilizacao da interface do switch, qualidade do cabo/Wi-Fi e possivel congestionamento no segmento.'
        ));
    }

    // ---- Regra: perda de pacotes parcial ----
    const limPerda = config.limites.perdaPacotesPct || 10;
    if (perdaPct >= limPerda && falhasConsecutivas < limFalhas && total >= 4) {
        novos.push(novoAlerta(
            'CONECTIVIDADE',
            perdaPct > 30 ? 'ALTA' : 'MEDIA',
            host,
            'Perda de pacotes na comunicacao',
            [
                `Perda de ${Math.round(perdaPct * 100) / 100}% em ${total} medicoes`,
                `Falhas intermitentes: ${falhas.length}`,
                'Nao confundir com ICMP limitado pelo firewall do host'
            ],
            'MODERADA',
            'Correlacionar com erros de interface no switch e verificar se outros hosts do mesmo segmento perdem pacotes.'
        ));
    }

    // ---- Resolucao: se vinha com alerta e agora esta saudavel ----
    if (falhasConsecutivas === 0 && perdaPct < limPerda && latMedia !== null && latMedia <= limLat && quedas < limQuedas) {
        diagnostico.confiancaGeral = 'ALTA';
        resolucoes.push({ host, tipos: ['CONECTIVIDADE', 'LATENCIA', 'INSTABILIDADE', 'INFRA'] });
    } else if (falhasConsecutivas >= limFalhas || quedas >= limQuedas) {
        diagnostico.confiancaGeral = 'MODERADA';
    } else if (perdaPct >= limFalhas || latMedia !== null && latMedia > limLat) {
        diagnostico.confiancaGeral = 'MODERADA';
    } else {
        diagnostico.confiancaGeral = 'ALTA';
    }

    return { novos, atualizados, resolucoes, diagnostico };
}

/**
 * Correlaciona hosts: se varios do mesmo setor caem juntos -> INFRA.
 */
function correlacionarSetor(hostsEstado, setorMap) {
    const porSetor = {};
    for (const [host, st] of Object.entries(hostsEstado)) {
        const setor = setorMap[host] || 'DESCONHECIDO';
        if (!porSetor[setor]) porSetor[setor] = { total: 0, caidos: 0, hosts: [] };
        porSetor[setor].total++;
        if (st.ultimoResultado === 'SEM_RESPOSTA' || (st.falhasConsecutivas || 0) >= 3) {
            porSetor[setor].caidos++;
            porSetor[setor].hosts.push(host);
        }
    }
    const incidentes = [];
    for (const [setor, info] of Object.entries(porSetor)) {
        if (info.caidos >= 2 && info.caidos / info.total > 0.4) {
            incidentes.push({
                setor,
                afetados: info.caidos,
                total: info.total,
                hosts: info.hosts,
                titulo: `Possivel falha de infraestrutura no setor ${setor}`,
                confianca: info.caidos >= 4 ? 'ALTA' : 'MODERADA'
            });
        }
    }
    return incidentes;
}

module.exports = { avaliarHost, correlacionarSetor, novoAlerta, NIVEIS };
