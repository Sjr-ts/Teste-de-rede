#!/usr/bin/env node
/**
 * criar-usuario.cjs — cria/atualiza usuario do Inventario TI (auth real).
 *
 * Uso:
 *   node scripts/criar-usuario.cjs <usuario> <senha> <perfil> [nome]
 *   node scripts/criar-usuario.cjs ti.admin SenhaForte123 ADMIN "Ana Administradora"
 *
 * Perfis: ADMIN | TECNICO | USUARIO
 */
const auth = require('../monitor/auth');
const [ , , username, senha, perfil, ...resto] = process.argv;
const nome = resto.join(' ') || username;
if (!username || !senha) {
    console.error('Uso: node scripts/criar-usuario.cjs <usuario> <senha> <perfil> [nome]');
    process.exit(1);
}
const r = auth.criarUsuario({ username, senha, nome, perfil });
if (r.erro) { console.error('ERRO:', r.erro); process.exit(1); }
console.log('Usuario criado/atualizado:', JSON.stringify(r.user));
