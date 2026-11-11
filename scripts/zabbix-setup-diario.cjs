'use strict';
/**
 * Setup idempotente do Zabbix para o Inventario TI (via API).
 * Pode rodar quantas vezes quiser — nao duplica nada.
 *
 *   node scripts/zabbix-setup-diario.cjs           -> limpeza + action de autoregistro
 *   node scripts/zabbix-setup-diario.cjs --menu    -> + menu enxuto da role 3
 *
 * O que faz:
 * 1) Remove acoes padrao DESATIVADAS (nunca usadas) e discovery rules de exemplo;
 * 2) Garante a action "Inventario TI - Auto-registro de agentes (IP adaptativo)":
 *    condicao HostMetadata contem "inventario-ti" -> host novo entra no grupo
 *    "Inventario TI" com tag inventario_origem=autoreg; host existente com o
 *    mesmo nome tem a INTERFACE atualizada (IP adaptativo) pelo proprio servidor;
 * 3) --menu: aplica menu enxuto na role 3 (Super admin role). Como essa role e
 *    readonly na API, precisa abrir o flag no banco antes (a mensagem do proprio
 *    script mostra o comando) e devolver para 1 depois.
 */
const path = require('path');
const zb = require(path.join(__dirname, '..', 'monitor', 'zabbix-bridge'));

// Menus que ficam visiveis no dia a dia (o resto some da UI)
const UI_PERMITIDOS = [
    'monitoring.dashboard',
    'monitoring.problems',
    'monitoring.hosts',
    'monitoring.latest_data',
    'monitoring.maps',
    'inventory.overview',
    'inventory.hosts',
    'reports.availability_report'
];

// Elementos de UI desta instalacao que precisam ser zerados explicitamente
// (o role.update do Zabbix faz MERGE, nao substitui)
const UI_BLOQUEADOS = [
    'monitoring.discovery',
    'services.services', 'services.sla_report', 'services.sla',
    'reports.top_triggers', 'reports.scheduled_reports', 'reports.notifications',
    'reports.system_info', 'reports.audit', 'reports.action_log',
    'configuration.template_groups', 'configuration.host_groups', 'configuration.templates',
    'configuration.hosts', 'configuration.maintenance', 'configuration.discovery',
    'configuration.trigger_actions', 'configuration.service_actions',
    'configuration.discovery_actions', 'configuration.autoregistration_actions',
    'configuration.internal_actions', 'configuration.event_correlation',
    'administration.media_types', 'administration.scripts', 'administration.user_groups',
    'administration.user_roles', 'administration.users', 'administration.api_tokens',
    'administration.authentication', 'administration.general', 'administration.audit_log',
    'administration.housekeeping', 'administration.proxy_groups', 'administration.proxies',
    'administration.macros', 'administration.queue'
];

const REGRAS_MENU = {
    'ui.default_access': 0,
    ui: UI_PERMITIDOS.map(name => ({ name, status: 1 }))
        .concat(UI_BLOQUEADOS.map(name => ({ name, status: 0 }))),
    'modules.default_access': 0,
    'api.access': 1,            // painel/bridge usam a conta Admin via API
    'api.mode': 0,
    'actions.default_access': 1 // reconhecer/suprimir/fechar problemas, editar dashboards/mapas
};

async function limparLixo() {
    const acoes = await zb.authCall('action.get', { output: ['actionid', 'status'] });
    const desativadas = acoes.filter(a => String(a.status) === '1').map(a => a.actionid);
    if (desativadas.length) {
        await zb.authCall('action.delete', desativadas);
        console.log('ACOES removidas (desativadas):', desativadas.join(','));
    } else console.log('ACOES: nada a remover');

    const drules = await zb.authCall('drule.get', { output: ['druleid', 'status'] });
    const amostras = drules.filter(d => String(d.status) === '1').map(d => d.druleid);
    if (amostras.length) {
        await zb.authCall('drule.delete', amostras);
        console.log('DISCOVERY RULES de exemplo removidas:', amostras.join(','));
    } else console.log('DISCOVERY RULES: nada a remover');
}

async function garantirAcaoAutoreg() {
    const nome = 'Inventario TI - Auto-registro de agentes (IP adaptativo)';
    const existentes = await zb.authCall('action.get', { output: ['actionid', 'name'] });
    if (existentes.some(a => a.name === nome)) {
        console.log('ACAO AUTOREG: ja existe');
        return;
    }
    const grupos = await zb.authCall('hostgroup.get', { output: ['groupid'], filter: { name: 'Inventario TI' } });
    if (!grupos.length) throw new Error('Grupo "Inventario TI" nao encontrado');
    const r = await zb.authCall('action.create', {
        name: nome,
        eventsource: 2, // active agent autoregistration
        status: 0,
        filter: {
            evaltype: 0,
            conditions: [{ conditiontype: 24, operator: 2, value: 'inventario-ti' }]
        },
        operations: [
            { operationtype: 2 }, // add host (host novo)
            { operationtype: 4, opgroup: [{ groupid: grupos[0].groupid }] },
            { operationtype: 13, optag: [{ tag: 'inventario_origem', value: 'autoreg' }] }
        ]
    });
    console.log('ACAO AUTOREG criada:', r.actionids[0]);
}

async function aplicarMenuEnxuto() {
    try {
        await zb.authCall('role.update', { roleid: '3', rules: REGRAS_MENU });
        console.log('MENU enxuto aplicado na role 3 (Super admin role)');
    } catch (e) {
        if (/readonly/i.test(e.message)) {
            console.log('A role 3 e readonly. Abra o flag, rode de novo e feche:');
            console.log('  docker exec zbx-postgres psql -U zabbix -d zabbix -c "UPDATE role SET readonly = 0 WHERE roleid = 3"');
            console.log('  node scripts/zabbix-setup-diario.cjs --menu');
            console.log('  docker exec zbx-postgres psql -U zabbix -d zabbix -c "UPDATE role SET readonly = 1 WHERE roleid = 3"');
        } else throw e;
    }
}

(async () => {
    await limparLixo();
    await garantirAcaoAutoreg();
    if (process.argv.includes('--menu')) await aplicarMenuEnxuto();
    console.log('OK');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
