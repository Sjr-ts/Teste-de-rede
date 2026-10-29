'use strict';
/**
 * Gera token de API para o usuario Admin (ambiente de teste).
 * Em producao: criar role de leitura minima e usuario dedicado.
 * Executar: node zabbix-deploy/gerar-token.cjs
 */
const path = require('path');
const zb = require(path.join(__dirname, '..', 'monitor', 'zabbix-bridge'));

async function main() {
    console.log('=== Geracao de token de API ===');

    const cfg = zb.loadConfig();
    const sess = await zb.apiCall('user.login', { username: cfg.usuario, password: cfg.senha });
    console.log('Login OK');

    // Busca userid do Admin
    const users = await zb.apiCall('user.get', {
        output: ['userid', 'username'],
        filter: { username: [cfg.usuario] }
    }, sess);
    const userid = users[0].userid;
    console.log('UserID:', userid, '(' + users[0].username + ')');

    // Remove tokens antigos com mesmo nome
    const tokens = await zb.apiCall('user.token.get', {
        output: ['tokenid', 'name'],
        userids: [userid]
    }, sess);
    for (const t of tokens) {
        if (t.name === 'inventario-api') {
            await zb.apiCall('user.token.delete', [t.tokenid], sess);
            console.log('Token antigo removido:', t.tokenid);
        }
    }

    // Cria novo token
    const result = await zb.apiCall('user.token.create', {
        name: 'inventario-api',
        userid: userid,
        interfaces: ['script'],
        ttl: '0'
    }, sess);

    const token = result.tokenids[0];
    console.log('\n=== TOKEN ===');
    console.log(token);

    // Salva no config
    cfg.apiToken = token;
    zb.saveConfig(cfg);
    console.log('\nSalvo em monitor/zabbix-config.json');

    await zb.apiCall('user.logout', [], sess);
    console.log('Logout OK. Pronto para uso.');
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
