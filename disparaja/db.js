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
CREATE TABLE IF NOT EXISTS envios (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL,
  nome      TEXT,
  numero    TEXT NOT NULL,                -- com 55 (ex: 5596991767788)
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_envios_user ON envios(user_id);
CREATE INDEX IF NOT EXISTS idx_envios_num ON envios(numero);
CREATE TABLE IF NOT EXISTS grupos (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL,
  nome      TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS contatos (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  grupo_id  INTEGER NOT NULL,
  nome      TEXT,
  numero    TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_grupos_user ON grupos(user_id);
CREATE INDEX IF NOT EXISTS idx_contatos_grupo ON contatos(grupo_id);
CREATE TABLE IF NOT EXISTS pendentes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  mensagem   TEXT NOT NULL,
  restantes  TEXT NOT NULL,            -- JSON [{nome,telefone}]
  qtd        INTEGER NOT NULL,
  enviados   INTEGER NOT NULL DEFAULT 0,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// --- Migracoes leves (colunas novas em bancos ja existentes). Ignora se ja existir. ---
function migrar(sql) { try { db.exec(sql); } catch (e) { /* coluna ja existe */ } }
migrar("ALTER TABLE users ADD COLUMN preco_wa INTEGER NOT NULL DEFAULT 35"); // centavos por WhatsApp
migrar("ALTER TABLE envios ADD COLUMN canal TEXT NOT NULL DEFAULT 'sms'");   // 'sms' | 'whatsapp'
migrar("ALTER TABLE pendentes ADD COLUMN canal TEXT NOT NULL DEFAULT 'sms'");

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

// --- admin ---
function listarUsuarios() {
  return db.prepare('SELECT id, nome, email, saldo, preco_sms, preco_wa, is_admin, criado_em FROM users ORDER BY id DESC').all();
}
function definirPreco(userId, centavos) {
  db.prepare('UPDATE users SET preco_sms = ? WHERE id = ?').run(centavos, userId);
}
function definirPrecoWa(userId, centavos) {
  db.prepare('UPDATE users SET preco_wa = ? WHERE id = ?').run(centavos, userId);
}
function tornarAdmin(email) {
  db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').run(String(email).toLowerCase().trim());
}
// Quanto o cliente JA gastou em SMS (centavos, numero positivo)
function totalGasto(userId) {
  const r = db.prepare("SELECT COALESCE(-SUM(valor), 0) AS gasto FROM transacoes WHERE user_id = ? AND tipo = 'envio'").get(userId);
  return r ? r.gasto : 0;
}
// --- envios (pra cruzar com as respostas/SAIR e mostrar o nome) ---
function registrarEnvio(userId, nome, numero, canal) {
  db.prepare('INSERT INTO envios (user_id, nome, numero, canal) VALUES (?, ?, ?, ?)')
    .run(userId, String(nome || ''), String(numero), String(canal || 'sms'));
}
// Mapa numero(so digitos) -> nome, dos contatos pra quem o cliente ja mandou
function numerosNomesDoUsuario(userId) {
  return db.prepare('SELECT DISTINCT numero, nome FROM envios WHERE user_id = ?').all(userId);
}
function todosNumerosNomes() {
  return db.prepare('SELECT DISTINCT numero, nome, user_id FROM envios').all();
}

// --- grupos de contatos (salvos pra reusar, com nome) ---
function criarGrupo(userId, nome) {
  const info = db.prepare('INSERT INTO grupos (user_id, nome) VALUES (?, ?)').run(userId, String(nome || 'Sem nome').trim());
  return info.lastInsertRowid;
}
function addContatos(grupoId, lista) {
  const stmt = db.prepare('INSERT INTO contatos (grupo_id, nome, numero) VALUES (?, ?, ?)');
  db.exec('BEGIN');
  try {
    for (const c of lista) stmt.run(grupoId, String(c.nome || ''), String(c.numero));
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
}
function listarGrupos(userId) {
  return db.prepare(`SELECT g.id, g.nome, g.criado_em,
    (SELECT COUNT(*) FROM contatos c WHERE c.grupo_id = g.id) AS total
    FROM grupos g WHERE g.user_id = ? ORDER BY g.id DESC`).all(userId);
}
function buscarGrupo(id) {
  return db.prepare('SELECT * FROM grupos WHERE id = ?').get(id);
}
function contatosDoGrupo(grupoId) {
  return db.prepare('SELECT nome, numero FROM contatos WHERE grupo_id = ?').all(grupoId);
}
function apagarGrupo(grupoId) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM contatos WHERE grupo_id = ?').run(grupoId);
    db.prepare('DELETE FROM grupos WHERE id = ?').run(grupoId);
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} }
}

// --- disparos pendentes (pausados por falta de credito na Comtele do DONO) ---
function criarPendente(userId, mensagem, enviados, restantes, canal) {
  db.prepare('INSERT INTO pendentes (user_id, mensagem, restantes, qtd, enviados, canal) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, String(mensagem || ''), JSON.stringify(restantes || []), (restantes || []).length, enviados || 0, String(canal || 'sms'));
}
function listarPendentes() {
  return db.prepare(`SELECT p.*, u.nome AS cliente, u.email FROM pendentes p
    JOIN users u ON u.id = p.user_id ORDER BY p.id DESC`).all();
}
function buscarPendente(id) {
  return db.prepare('SELECT * FROM pendentes WHERE id = ?').get(id);
}
function apagarPendente(id) {
  db.prepare('DELETE FROM pendentes WHERE id = ?').run(id);
}

// Apaga o cliente e o historico dele
function apagarUsuario(userId) {
  try {
    db.exec('BEGIN');
    db.prepare('DELETE FROM transacoes WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM envios WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM contatos WHERE grupo_id IN (SELECT id FROM grupos WHERE user_id = ?)').run(userId);
    db.prepare('DELETE FROM grupos WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM pendentes WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    db.exec('COMMIT');
    return { ok: true };
  } catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} return { ok: false, motivo: e.message }; }
}

module.exports = {
  db, hashSenha, conferirSenha,
  criarUsuario, buscarPorEmail, buscarPorId,
  recarregar, debitar, listarTransacoes,
  listarUsuarios, definirPreco, definirPrecoWa, tornarAdmin,
  totalGasto, apagarUsuario,
  registrarEnvio, numerosNomesDoUsuario, todosNumerosNomes,
  criarGrupo, addContatos, listarGrupos, buscarGrupo, contatosDoGrupo, apagarGrupo,
  criarPendente, listarPendentes, buscarPendente, apagarPendente,
};
