#!/usr/bin/env node
/**
 * criar-token.cjs — cria tokens de API (automacao) para o Inventario TI.
 *
 * Uso:
 *   node scripts/criar-token.cjs <nome> [perfil]
 *   node scripts/criar-token.cjs "Agente OpenCode" ADMIN
 *
 * O token e exibido UMA VEZ e gravado em monitor/api-tokens.json (fora do git).
 * Para revogar: apague a entrada do arquivo (ou o arquivo inteiro).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const TOKENS_FILE = path.join(__dirname, '..', 'monitor', 'api-tokens.json');
const [, , nome, perfil] = process.argv;
if (!nome) {
    console.error('Uso: node scripts/criar-token.cjs <nome> [perfil]');
    process.exit(1);
}
const perfilValido = ['ADMIN', 'TECNICO', 'USUARIO'].includes(String(perfil || 'ADMIN').toUpperCase())
    ? String(perfil || 'ADMIN').toUpperCase()
    : 'ADMIN';
const token = 'agt_' + crypto.randomBytes(24).toString('hex');
let tokens = [];
try { tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')); if (!Array.isArray(tokens)) tokens = []; } catch (e) { tokens = []; }
// nome existente -> substitui (revoga o anterior)
tokens = tokens.filter(t => String(t.nome) !== nome);
tokens.push({ id: Date.now(), nome, perfil: perfilValido, token, criadoEm: new Date().toISOString() });
fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2), 'utf8');
console.log('Token criado para "' + nome + '" (perfil ' + perfilValido + '):');
console.log('  ' + token);
console.log('Gravado em monitor/api-tokens.json (fora do git). Use no header:');
console.log('  Authorization: Bearer ' + token);
