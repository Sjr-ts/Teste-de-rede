'use strict';
/**
 * auth.js — autenticacao REAL do Inventario TI (sem dependencias externas).
 *
 * - Senhas: scrypt (node:crypto) com salt aleatorio por usuario.
 *   Formato: scrypt$N$r$p$salt$hash  (N=16384, r=8, p=1)
 * - Sessao: cookie HttpOnly assinado (HMAC-SHA256), SameSite=Lax, 8h de vida.
 *   O frontend nunca ve o token (HttpOnly) — imunidade a XSS para roubo de sessao.
 * - Usuarios em monitor/users.json       (FORA DO GIT)
 * - Segredo da sessao em monitor/auth-secret.json (FORA DO GIT, gerado no 1o boot)
 *
 * Nao existe login sem o servidor. Antes deste modulo (04/11/2026) o "login" era
 * 100% fingido no navegador (credenciais no JS publico) — removido.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, 'users.json');
const SECRET_FILE = path.join(__dirname, 'auth-secret.json');
const TOKENS_FILE = path.join(__dirname, 'api-tokens.json'); // tokens de automacao (FORA DO GIT)
const SESSAO_HORAS = 8;
const COOKIE_NOME = 'inventario_sessao';
const SCRYPT = { N: 16384, r: 8, p: 1 };

function carregarSecret() {
    try {
        const s = JSON.parse(fs.readFileSync(SECRET_FILE, 'utf8'));
        if (s && typeof s.secret === 'string' && s.secret.length >= 32) return s.secret;
    } catch (e) {}
    const secret = crypto.randomBytes(32).toString('hex');
    try {
        fs.writeFileSync(SECRET_FILE, JSON.stringify({ secret, criadoEm: new Date().toISOString() }, null, 2), 'utf8');
    } catch (e) {}
    return secret;
}
const SECRET = carregarSecret();

// ---------- senhas ----------
function hashSenha(senha, salt) {
    salt = salt || crypto.randomBytes(16).toString('hex');
    const dk = crypto.scryptSync(String(senha), salt, 64, SCRYPT);
    return 'scrypt$' + SCRYPT.N + '$' + SCRYPT.r + '$' + SCRYPT.p + '$' + salt + '$' + dk.toString('hex');
}

function verificarSenha(senha, hash) {
    const p = String(hash || '').split('$');
    if (p.length !== 6 || p[0] !== 'scrypt') return false;
    const esperado = Buffer.from(p[5], 'hex');
    const dk = crypto.scryptSync(String(senha), p[4], 64, { N: Number(p[1]), r: Number(p[2]), p: Number(p[3]) });
    return dk.length === esperado.length && crypto.timingSafeEqual(dk, esperado);
}

// ---------- armazenamento de usuarios ----------
function carregarUsuarios() {
    try {
        const u = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        return Array.isArray(u) ? u : [];
    } catch (e) { return []; }
}

function salvarUsuarios(users) {
    const tmp = USERS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(users, null, 2), 'utf8');
    fs.renameSync(tmp, USERS_FILE);
}

function buscarUsuario(username) {
    const alvo = String(username || '').trim().toLowerCase();
    return carregarUsuarios().find(u => String(u.username).toLowerCase() === alvo) || null;
}

function criarUsuario({ username, senha, nome, perfil }) {
    const users = carregarUsuarios();
    const alvo = String(username || '').trim();
    if (users.some(u => u.username.toLowerCase() === alvo.toLowerCase())) {
        return { erro: 'Usuario ja existe.' };
    }
    if (!alvo || alvo.length < 3) return { erro: 'Usuario deve ter no minimo 3 caracteres.' };
    if (!senha || String(senha).length < 6) return { erro: 'Senha deve ter no minimo 6 caracteres.' };
    const perfilValido = ['ADMIN', 'TECNICO', 'USUARIO'];
    const perfilFinal = perfilValido.includes(String(perfil || '').toUpperCase()) ? String(perfil).toUpperCase() : 'USUARIO';
    const novo = {
        id: Date.now(),
        username: alvo,
        nome: String(nome || alvo).slice(0, 120),
        perfil: perfilFinal,
        senhaHash: hashSenha(senha),
        criadoEm: new Date().toISOString()
    };
    users.push(novo);
    salvarUsuarios(users);
    return { ok: true, user: { username: novo.username, nome: novo.nome, perfil: novo.perfil } };
}

// ---------- sessao (cookie assinado, sem estado no servidor) ----------
function assinarSessao(u) {
    const payload = { u: u.username, n: u.nome, p: u.perfil, iat: Date.now(), exp: Date.now() + SESSAO_HORAS * 3600 * 1000 };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
    return body + '.' + sig;
}

function verificarSessao(token) {
    const partes = String(token || '').split('.');
    if (partes.length !== 2) return null;
    const [body, sig] = partes;
    const esperado = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
    const a = Buffer.from(sig); const b = Buffer.from(esperado);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
        const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (!p || !p.u || !p.exp || Date.now() > p.exp) return null;
        return { username: p.u, nome: p.n, perfil: p.p };
    } catch (e) { return null; }
}

// ---------- tokens de automacao (Bearer agt_...) ----------
// Alternativa a sessao de navegador para SCRIPTS/AGENTES (o estagiario de
// automacao). Revogavel: apague o token em monitor/api-tokens.json (ou o arquivo).
let _tokensCache = null;
function carregarTokens() {
    if (_tokensCache) return _tokensCache;
    try {
        const t = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
        _tokensCache = Array.isArray(t) ? t : [];
    } catch (e) { _tokensCache = []; }
    return _tokensCache;
}

function tokenDeReq(req) {
    const header = String((req.headers && req.headers['authorization']) || '');
    let tok = '';
    const m = header.match(/^Bearer\s+(.+)$/i);
    if (m) tok = m[1].trim();
    if (!tok) tok = String((req.headers && req.headers['x-api-token']) || '').trim();
    if (!tok) return null;
    for (const t of carregarTokens()) {
        const a = Buffer.from(String(t.token || ''));
        const b = Buffer.from(tok);
        if (a.length && a.length === b.length && crypto.timingSafeEqual(a, b)) {
            return {
                username: 'token:' + (t.nome || 'api'),
                nome: t.nome || 'Automacao',
                perfil: String(t.perfil || 'ADMIN').toUpperCase(),
                via: 'token'
            };
        }
    }
    return null;
}

function lerCookie(req, nome) {
    const raw = req.headers && req.headers.cookie ? String(req.headers.cookie) : '';
    for (const parte of raw.split(';')) {
        const [k, ...v] = parte.trim().split('=');
        if (k === nome) return decodeURIComponent(v.join('=') || '');
    }
    return null;
}

function sessaoDeReq(req) {
    // 1) token de automacao (Bearer agt_... ou X-Api-Token)
    const t = tokenDeReq(req);
    if (t) return t;
    // 2) sessao de navegador (cookie HttpOnly)
    return verificarSessao(lerCookie(req, COOKIE_NOME));
}

function setCookieSessao(res, token) {
    const partes = [
        COOKIE_NOME + '=' + encodeURIComponent(token),
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        'Max-Age=' + (SESSAO_HORAS * 3600)
    ];
    // Atras de HTTP simples (LAN). Se houver HTTPS no futuro, adicionar '; Secure'.
    res.setHeader('Set-Cookie', partes.join('; '));
}

function limparCookieSessao(res) {
    res.setHeader('Set-Cookie', COOKIE_NOME + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

module.exports = {
    COOKIE_NOME,
    SESSAO_HORAS,
    hashSenha,
    verificarSenha,
    carregarUsuarios,
    buscarUsuario,
    criarUsuario,
    assinarSessao,
    verificarSessao,
    sessaoDeReq,
    tokenDeReq,
    carregarTokens,
    setCookieSessao,
    limparCookieSessao
};
