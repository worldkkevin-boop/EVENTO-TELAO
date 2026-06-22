// Banco de dados do DisparaJa usando o SQLite nativo do Node (sem dependencia externa).
// Dinheiro e SEMPRE guardado em CENTAVOS (numero inteiro) pra nao ter erro de virgula.
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('node:path');

const db = new DatabaseSync(path.join(__dirname, 'data.db'));
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nome          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  senha_hash    TEXT NOT NULL,
  saldo         INTEGER NOT NULL DEFAULT 0,   -- centavos
  preco_sms     INTEGER NOT NULL DEFAULT 20,  -- centavos por SMS (preco de venda)
  is_admin      INTEGER NOT NULL DEFAULT 0,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS transacoes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  tipo          TEXT NOT NULL,                -- 'recarga' | 'envio' | 'ajuste'
  valor         INTEGER NOT NULL,             -- centavos (+entra / -sai)
  descricao     TEXT,
  ref           TEXT,                         -- id do pagamento (Mercado Pago) p/ evitar duplicar
  criado_em     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trans_user ON transacoes(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trans_ref ON transacoes(ref) WHERE ref IS NOT NULL;
`);

// --- senha (scrypt nativo, sem dependencia) ---
function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function conferirSenha(senha, armazenado) {
  const [salt, hash] = String(armazenado || '').split(':');
  if (!salt || !hash) return false;
  const novo = crypto.scryptSync(String(senha), salt, 64).toString('hex');
  // comparacao em tempo constante
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(novo, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- usuarios ---
function criarUsuario({ nome, email, senha }) {
  const stmt = db.prepare('INSERT INTO users (nome, email, senha_hash) VALUES (?, ?, ?)');
  const info = stmt.run(nome, email.toLowerCase().trim(), hashSenha(senha));
  return buscarPorId(info.lastInsertRowid);
}
function buscarPorEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase().trim());
}
function buscarPorId(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// --- saldo (com transacao atomica) ---
// Credita saldo e registra. ref evita creditar o mesmo pagamento 2x.
function recarregar(userId, valorCentavos, descricao, ref) {
  try {
    db.exec('BEGIN');
    if (ref) {
      const existe = db.prepare('SELECT 1 FROM transacoes WHERE ref = ?').get(ref);
      if (existe) { db.exec('ROLLBACK'); return { ok: false, motivo: 'pagamento ja creditado' }; }
    }
    db.prepare('UPDATE users SET saldo = saldo + ? WHERE id = ?').run(valorCentavos, userId);
    db.prepare('INSERT INTO transacoes (user_id, tipo, valor, descricao, ref) VALUES (?, ?, ?, ?, ?)')
      .run(userId, 'recarga', valorCentavos, descricao || 'Recarga', ref || null);
    db.exec('COMMIT');
    return { ok: true, saldo: buscarPorId(userId).saldo };
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    return { ok: false, motivo: e.message };
  }
}

// Debita saldo (ex: 1 SMS). Retorna false se nao tiver saldo.
function debitar(userId, valorCentavos, descricao) {
  try {
    db.exec('BEGIN');
    const u = buscarPorId(userId);
    if (!u || u.saldo < valorCentavos) { db.exec('ROLLBACK'); return { ok: false, motivo: 'saldo insuficiente' }; }
    db.prepare('UPDATE users SET saldo = saldo - ? WHERE id = ?').run(valorCentavos, userId);
    db.prepare('INSERT INTO transacoes (user_id, tipo, valor, descricao) VALUES (?, ?, ?, ?)')
      .run(userId, 'envio', -valorCentavos, descricao || 'Envio de SMS');
    db.exec('COMMIT');
    return { ok: true, saldo: buscarPorId(userId).saldo };
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    return { ok: false, motivo: e.message };
  }
}

function listarTransacoes(userId, limite = 50) {
  return db.prepare('SELECT * FROM transacoes WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limite);
}

module.exports = {
  db, hashSenha, conferirSenha,
  criarUsuario, buscarPorEmail, buscarPorId,
  recarregar, debitar, listarTransacoes,
};
