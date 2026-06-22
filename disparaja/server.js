// DisparaJa - plataforma de disparo de SMS com saldo pre-pago (revenda com margem).
// Base: contas (cadastro/login), painel com saldo e tela de planos.
// Pagamento (Mercado Pago) e disparo (Comtele) entram nos proximos passos.
const express = require('express');
const session = require('express-session');
const path = require('node:path');
const dao = require('./db');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'troque-isto-em-producao',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }, // 7 dias
}));
app.use('/static', express.static(path.join(__dirname, 'public')));

// --- Planos (pacotes de credito). Valores em CENTAVOS. ---
// custo da Comtele = 10 centavos/SMS. preco_sms = quanto vale cada SMS pro cliente.
const PLANOS = [
  { id: 'teste', nome: 'Teste',     valor: 5000,  sms: 250,  preco_sms: 20 },
  { id: 'p500',  nome: '500 SMS',   valor: 9500,  sms: 500,  preco_sms: 19 },
  { id: 'p2000', nome: '2.000 SMS', valor: 36000, sms: 2000, preco_sms: 18 },
  { id: 'p5000', nome: '5.000 SMS', valor: 85000, sms: 5000, preco_sms: 17 },
];

// --- helpers ---
const reais = c => 'R$ ' + (c / 100).toFixed(2).replace('.', ',');
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  req.user = dao.buscarPorId(req.session.userId);
  if (!req.user) { req.session.destroy(() => {}); return res.redirect('/login'); }
  next();
}

// --- layout base (HTML compartilhado) ---
function layout(title, body, user) {
  const nav = user
    ? `<a href="/">Painel</a><a href="/planos">Comprar créditos</a><a href="/sair">Sair</a>`
    : `<a href="/login">Entrar</a><a href="/cadastro">Criar conta</a>`;
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — DisparaJá</title>
<link rel="stylesheet" href="/static/style.css">
</head><body>
<header><div class="logo">📨 DisparaJá</div><nav>${nav}</nav>
${user ? `<div class="saldo">Saldo: <b>${reais(user.saldo)}</b></div>` : ''}</header>
<main>${body}</main>
</body></html>`;
}

// --- LANDING / PAINEL ---
app.get('/', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const user = dao.buscarPorId(req.session.userId);
  if (!user) { req.session.destroy(() => {}); return res.redirect('/login'); }
  const trans = dao.listarTransacoes(user.id, 20);
  const linhas = trans.length
    ? trans.map(t => `<tr><td>${t.criado_em}</td><td>${t.descricao || t.tipo}</td>
        <td class="${t.valor >= 0 ? 'pos' : 'neg'}">${t.valor >= 0 ? '+' : ''}${reais(t.valor)}</td></tr>`).join('')
    : `<tr><td colspan="3" class="vazio">Nenhuma movimentação ainda. Compre créditos pra começar.</td></tr>`;
  res.send(layout('Painel', `
    <h1>Olá, ${user.nome.split(' ')[0]}! 👋</h1>
    <div class="cards">
      <div class="card"><div class="l">Seu saldo</div><div class="n">${reais(user.saldo)}</div></div>
      <div class="card"><div class="l">Preço por SMS</div><div class="n">${reais(user.preco_sms)}</div></div>
      <div class="card"><div class="l">SMS disponíveis</div><div class="n">~${Math.floor(user.saldo / user.preco_sms)}</div></div>
    </div>
    <div class="acoes">
      <a class="btn azul" href="/planos">💳 Comprar créditos</a>
      <a class="btn cinza" href="/disparar">📨 Disparar SMS (em breve)</a>
    </div>
    <h2>Histórico</h2>
    <table><thead><tr><th>Quando</th><th>Descrição</th><th>Valor</th></tr></thead><tbody>${linhas}</tbody></table>
  `, user));
});

// --- PLANOS ---
app.get('/planos', requireLogin, (req, res) => {
  const cards = PLANOS.map(p => `
    <div class="plano">
      <h3>${p.nome}</h3>
      <div class="preco">${reais(p.valor)}</div>
      <div class="por">${reais(p.preco_sms)} por SMS • ${p.sms.toLocaleString('pt-BR')} mensagens</div>
      <form method="POST" action="/pagar"><input type="hidden" name="plano" value="${p.id}">
        <button class="btn azul">Comprar com Pix</button></form>
    </div>`).join('');
  res.send(layout('Planos', `
    <h1>Comprar créditos</h1>
    <p class="sub">Pague por Pix e o saldo entra na hora. Quanto maior o pacote, menor o preço por SMS.</p>
    <div class="planos">${cards}</div>
  `, req.user));
});

// --- PAGAMENTO (Mercado Pago) — proximo passo ---
app.post('/pagar', requireLogin, (req, res) => {
  res.send(layout('Pagamento', `
    <h1>Pagamento</h1>
    <p class="sub">⏳ A integração com o Mercado Pago (Pix/cartão) é o próximo passo. Em breve aqui aparece o QR do Pix.</p>
    <a class="btn cinza" href="/planos">Voltar aos planos</a>
  `, req.user));
});

// --- DISPARO — proximo passo ---
app.get('/disparar', requireLogin, (req, res) => {
  res.send(layout('Disparar', `
    <h1>Disparar SMS</h1>
    <p class="sub">⏳ Em breve: subir a lista, escrever a mensagem e disparar (desconta do seu saldo).</p>
    <a class="btn cinza" href="/">Voltar ao painel</a>
  `, req.user));
});

// --- CADASTRO ---
app.get('/cadastro', (req, res) => {
  res.send(layout('Criar conta', `
    <div class="auth">
      <h1>Criar conta</h1>
      ${req.query.erro ? `<p class="erro">${req.query.erro}</p>` : ''}
      <form method="POST" action="/cadastro">
        <label>Nome</label><input name="nome" required placeholder="Seu nome">
        <label>E-mail</label><input name="email" type="email" required placeholder="voce@email.com">
        <label>Senha</label><input name="senha" type="password" required minlength="6" placeholder="mínimo 6 caracteres">
        <button class="btn azul">Criar conta grátis</button>
      </form>
      <p class="link">Já tem conta? <a href="/login">Entrar</a></p>
    </div>`));
});
app.post('/cadastro', (req, res) => {
  const { nome, email, senha } = req.body;
  if (!nome || !email || !senha || senha.length < 6)
    return res.redirect('/cadastro?erro=' + encodeURIComponent('Preencha tudo (senha com 6+ caracteres).'));
  if (dao.buscarPorEmail(email))
    return res.redirect('/cadastro?erro=' + encodeURIComponent('Esse e-mail já tem conta. Faça login.'));
  try {
    const u = dao.criarUsuario({ nome, email, senha });
    req.session.userId = u.id;
    res.redirect('/');
  } catch (e) {
    res.redirect('/cadastro?erro=' + encodeURIComponent('Erro ao criar conta. Tente outro e-mail.'));
  }
});

// --- LOGIN ---
app.get('/login', (req, res) => {
  res.send(layout('Entrar', `
    <div class="auth">
      <h1>Entrar</h1>
      ${req.query.erro ? `<p class="erro">${req.query.erro}</p>` : ''}
      <form method="POST" action="/login">
        <label>E-mail</label><input name="email" type="email" required placeholder="voce@email.com">
        <label>Senha</label><input name="senha" type="password" required placeholder="sua senha">
        <button class="btn azul">Entrar</button>
      </form>
      <p class="link">Não tem conta? <a href="/cadastro">Criar grátis</a></p>
    </div>`));
});
app.post('/login', (req, res) => {
  const { email, senha } = req.body;
  const u = dao.buscarPorEmail(email);
  if (!u || !dao.conferirSenha(senha, u.senha_hash))
    return res.redirect('/login?erro=' + encodeURIComponent('E-mail ou senha incorretos.'));
  req.session.userId = u.id;
  res.redirect('/');
});

app.get('/sair', (req, res) => { req.session.destroy(() => res.redirect('/login')); });

app.listen(PORT, () => {
  console.log(`🚀 DisparaJá rodando em http://localhost:${PORT}`);
});
