// DisparaJa - plataforma de disparo de SMS com saldo pre-pago (revenda com margem).
// Base: contas (cadastro/login), painel com saldo e tela de planos.
// Pagamento (Mercado Pago) e disparo (Comtele) entram nos proximos passos.
const express = require('express');
const session = require('express-session');
const path = require('node:path');
const dao = require('./db');
const comtele = require('./comtele');

// Jobs de disparo em andamento (em memoria): jobId -> progresso
const disparoJobs = new Map();

// Carrega segredos do .env (se existir): MP_ACCESS_TOKEN, SESSION_SECRET, etc.
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch (e) { /* sem .env: usa defaults */ }

const app = express();
app.set('trust proxy', 1); // roda atras do Nginx (HTTPS) no VPS
const PORT = process.env.PORT || 4000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const MP_TOKEN = process.env.MP_ACCESS_TOKEN || '';

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
const SqliteStore = require('./sessionStore')(session, dao.db);
app.use(session({
  store: new SqliteStore(),
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
function ehAdmin(user) {
  if (!user) return false;
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  return user.is_admin === 1 || (adminEmail && user.email === adminEmail);
}
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  req.user = dao.buscarPorId(req.session.userId);
  if (!req.user) { req.session.destroy(() => {}); return res.redirect('/login'); }
  next();
}
function requireAdmin(req, res, next) {
  requireLogin(req, res, () => {
    if (!ehAdmin(req.user)) return res.status(403).send('Acesso restrito.');
    next();
  });
}

// --- layout base (HTML compartilhado) ---
function layout(title, body, user) {
  const nav = user
    ? `<a href="/">Painel</a><a href="/planos">Comprar créditos</a>${ehAdmin(user) ? '<a href="/admin">👑 Admin</a>' : ''}<a href="/sair">Sair</a>`
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

// --- PAGAMENTO (Mercado Pago Checkout Pro: Pix + cartao) ---

// Credita o saldo a partir de um pagamento. Idempotente: usa o id como ref (nao credita 2x).
async function creditarPagamentoMP(paymentId) {
  if (!MP_TOKEN || !paymentId) return { ok: false, motivo: 'sem token/id' };
  let pay;
  try {
    const r = await fetch('https://api.mercadopago.com/v1/payments/' + paymentId, {
      headers: { Authorization: 'Bearer ' + MP_TOKEN }
    });
    pay = await r.json();
  } catch (e) { return { ok: false, motivo: e.message }; }
  if (!pay || pay.status !== 'approved') return { ok: false, motivo: 'nao aprovado', status: pay && pay.status };
  const [userId, planoId] = String(pay.external_reference || '').split(':');
  const plano = PLANOS.find(p => p.id === planoId);
  if (!userId || !plano) return { ok: false, motivo: 'referencia invalida' };
  return dao.recarregar(Number(userId), plano.valor, `Recarga ${plano.nome}`, 'mp:' + paymentId);
}

// Escolheu um plano -> cria a cobranca no Mercado Pago e manda pro checkout
app.post('/pagar', requireLogin, async (req, res) => {
  const plano = PLANOS.find(p => p.id === req.body.plano);
  if (!plano) return res.redirect('/planos');
  if (!MP_TOKEN) {
    return res.send(layout('Pagamento', `<h1>Pagamento</h1>
      <p class="sub erro">⚙️ O pagamento ainda não foi configurado no servidor (falta o token do Mercado Pago).</p>
      <a class="btn cinza" href="/planos">Voltar</a>`, req.user));
  }
  const body = {
    items: [{ title: 'DisparaJá — ' + plano.nome, quantity: 1, unit_price: plano.valor / 100, currency_id: 'BRL' }],
    external_reference: req.user.id + ':' + plano.id,
    payer: { email: req.user.email },
    back_urls: {
      success: BASE_URL + '/pagamento/retorno',
      pending: BASE_URL + '/pagamento/retorno',
      failure: BASE_URL + '/pagamento/retorno',
    },
  };
  // auto_return e webhook so funcionam com URL publica (https). Local: confirma na volta.
  if (BASE_URL.startsWith('https')) {
    body.auto_return = 'approved';
    body.notification_url = BASE_URL + '/webhook/mp';
  }
  try {
    const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + MP_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const pref = await r.json();
    if (pref && pref.init_point) return res.redirect(pref.init_point);
    return res.send(layout('Pagamento', `<h1>Ops</h1>
      <p class="sub erro">Não consegui gerar o pagamento: ${(pref && pref.message) || 'erro'}</p>
      <a class="btn cinza" href="/planos">Voltar</a>`, req.user));
  } catch (e) {
    return res.send(layout('Pagamento', `<h1>Ops</h1><p class="sub erro">Erro: ${e.message}</p>
      <a class="btn cinza" href="/planos">Voltar</a>`, req.user));
  }
});

// Volta do checkout: confere o pagamento e credita (se aprovado). Funciona ate sem webhook.
app.get('/pagamento/retorno', requireLogin, async (req, res) => {
  const paymentId = req.query.payment_id || req.query.collection_id;
  let msg = 'Voltando do checkout...', ok = false;
  if (paymentId) {
    const r = await creditarPagamentoMP(paymentId);
    ok = r.ok;
    msg = r.ok ? 'Pagamento confirmado e saldo creditado! 🎉'
        : r.motivo === 'pagamento ja creditado' ? 'Esse pagamento já tinha sido creditado. ✅'
        : 'Pagamento ainda não confirmado (status: ' + (r.status || r.motivo) + '). Se pagou via Pix, espere alguns segundos e atualize esta página.';
  }
  const user = dao.buscarPorId(req.session.userId);
  res.send(layout('Pagamento', `<h1>${ok ? '✅ Tudo certo!' : 'Pagamento'}</h1>
    <p class="sub">${msg}</p>
    <p>Seu saldo agora: <b>${reais(user.saldo)}</b></p>
    <a class="btn azul" href="/">Ir pro painel</a> <a class="btn cinza" href="/planos">Comprar mais</a>`, user));
});

// Webhook do Mercado Pago (producao): credita assim que o pagamento e aprovado.
app.post('/webhook/mp', async (req, res) => {
  res.sendStatus(200); // sempre responde rapido
  try {
    const tipo = req.body && (req.body.type || req.body.topic);
    const id = req.body && ((req.body.data && req.body.data.id) || req.body.id);
    if (tipo === 'payment' && id) await creditarPagamentoMP(id);
  } catch (e) { /* ignora */ }
});

// --- DISPARO DE SMS ---
app.get('/disparar', requireLogin, (req, res) => {
  res.send(layout('Disparar', `
    <h1>Disparar SMS</h1>
    <p class="sub">Saldo: <b>${reais(req.user.saldo)}</b> • Cada SMS custa <b>${reais(req.user.preco_sms)}</b> do seu saldo.</p>
    <div class="card" style="display:block">
      <label>1. Lista de contatos</label>
      <input type="file" id="arquivo" accept=".csv">
      <p class="hint">CSV com coluna <b>Numero</b> (e <b>Nome</b> se quiser personalizar). Ou cole abaixo:</p>
      <textarea id="colar" rows="3" placeholder="Cole números separados por vírgula ou um por linha (ex: 96991767788, 96988887777)"></textarea>
      <p id="resumoLista" class="hint"></p>

      <label style="margin-top:14px">2. Mensagem (use {nome} pra personalizar)</label>
      <textarea id="msg" rows="4" oninput="contar()" placeholder="Olá {nome}! ... Responda SAIR para não receber."></textarea>
      <p class="hint"><span id="cChars">0</span> caracteres • <span id="cCusto">R$ 0,00</span> estimado</p>

      <button class="btn azul" id="btnEnviar" onclick="disparar()" style="margin-top:8px">🚀 Disparar agora</button>
      <div id="prog" style="display:none;margin-top:14px">
        <div class="barra"><div id="barraFill"></div></div>
        <p class="hint"><span id="pInfo">0 / 0</span> • <span id="pOk">0</span> enviados • <span id="pFail">0</span> falhas</p>
      </div>
      <p id="resultado" class="hint"></p>
    </div>
    <a class="btn cinza" href="/" style="margin-top:14px">Voltar ao painel</a>
    <style>
      textarea{width:100%;padding:10px;border:1px solid #475569;border-radius:8px;background:var(--bg);color:var(--txt);font-family:inherit;font-size:.95rem;resize:vertical}
      .barra{height:14px;background:#0b1220;border-radius:8px;overflow:hidden;border:1px solid var(--linha)}
      .barra>div{height:100%;width:0;background:var(--ok);transition:width .3s}
    </style>
    <script>
      const PRECO = ${req.user.preco_sms};
      let contatos = [];
      function fmt(c){return 'R$ '+(c/100).toFixed(2).replace('.',',');}
      function parseCSV(t){t=t.replace(/^﻿/,'');return t.split(/\\r?\\n/).map(l=>l.split(',').map(x=>x.replace(/^"|"$/g,'').trim())).filter(r=>r.some(x=>x!==''));}
      function montar(){
        document.getElementById('resumoLista').innerHTML = contatos.length
          ? '✅ <b>'+contatos.length+'</b> contatos carregados' : '';
        contar();
      }
      document.getElementById('arquivo').onchange = ev => {
        const f = ev.target.files[0]; if(!f) return;
        const r = new FileReader();
        r.onload = () => {
          const linhas = parseCSV(r.result); if(!linhas.length) return;
          const head = linhas[0].map(h=>h.toLowerCase());
          let iN = head.findIndex(h=>h.includes('nome'));
          let iT = head.findIndex(h=>h.includes('numero')||h.includes('telefone')||h.includes('whats')||h.includes('fone'));
          if(iT<0) iT = head.length-1; if(iN<0) iN = -1;
          const vistos = new Set(); contatos = [];
          for(let k=1;k<linhas.length;k++){
            const tel=(linhas[k][iT]||'').replace(/\\D/g,''); if(tel.length<10) continue;
            if(vistos.has(tel)) continue; vistos.add(tel);
            contatos.push({nome: iN>=0?(linhas[k][iN]||''):'', telefone: tel});
          }
          montar();
        };
        r.readAsText(f,'UTF-8');
      };
      document.getElementById('colar').oninput = ev => {
        const vistos = new Set(); contatos = [];
        ev.target.value.split(/[,;\\n]/).forEach(x=>{const t=x.replace(/\\D/g,''); if(t.length>=10&&!vistos.has(t)){vistos.add(t);contatos.push({nome:'',telefone:t});}});
        montar();
      };
      function contar(){
        const n = document.getElementById('msg').value.length;
        document.getElementById('cChars').innerText = n;
        document.getElementById('cCusto').innerText = fmt(contatos.length*PRECO);
      }
      let timer;
      async function disparar(){
        const msg = document.getElementById('msg').value.trim();
        if(!contatos.length) return alert('Carregue ou cole a lista de contatos.');
        if(!msg) return alert('Escreva a mensagem.');
        if(!confirm('Disparar para '+contatos.length+' contatos?\\nCusto: '+fmt(contatos.length*PRECO)+' do seu saldo.')) return;
        document.getElementById('btnEnviar').disabled = true;
        document.getElementById('prog').style.display = 'block';
        document.getElementById('resultado').innerText = '';
        const r = await fetch('/api/disparar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contatos,mensagem:msg})});
        const j = await r.json();
        if(!j.ok){ document.getElementById('resultado').innerHTML='❌ '+j.erro; document.getElementById('btnEnviar').disabled=false; return; }
        timer = setInterval(async ()=>{
          const s = await (await fetch('/api/disparo-status?id='+j.jobId)).json();
          document.getElementById('barraFill').style.width = (s.total?Math.round((s.enviados+s.fail)/s.total*100):0)+'%';
          document.getElementById('pInfo').innerText = (s.enviados+s.fail)+' / '+s.total;
          document.getElementById('pOk').innerText = s.enviados;
          document.getElementById('pFail').innerText = s.fail;
          if(s.terminado){
            clearInterval(timer);
            document.getElementById('btnEnviar').disabled=false;
            document.getElementById('resultado').innerHTML = '✅ Concluído! '+s.enviados+' enviados, '+s.fail+' falhas.'+(s.parou?' (parou: '+s.parou+')':'');
          }
        },1500);
      }
      contar();
    </script>
  `, req.user));
});

// Inicia o disparo (em background) e devolve um jobId pra acompanhar o progresso
app.post('/api/disparar', requireLogin, (req, res) => {
  const contatos = Array.isArray(req.body.contatos) ? req.body.contatos : [];
  const mensagem = String(req.body.mensagem || '').trim();
  if (!contatos.length) return res.json({ ok: false, erro: 'Lista vazia.' });
  if (!mensagem) return res.json({ ok: false, erro: 'Mensagem vazia.' });
  const preco = req.user.preco_sms;
  if (req.user.saldo < preco) return res.json({ ok: false, erro: 'Saldo insuficiente. Compre créditos.' });

  const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const job = { userId: req.user.id, total: contatos.length, enviados: 0, fail: 0, terminado: false, parou: null };
  disparoJobs.set(jobId, job);
  res.json({ ok: true, jobId });

  (async () => {
    for (let i = 0; i < contatos.length; i++) {
      const c = contatos[i];
      const u = dao.buscarPorId(job.userId);
      if (!u || u.saldo < preco) { job.parou = 'saldo acabou'; break; }
      const r = await comtele.enviarSMS(c.telefone, comtele.personaliza(mensagem, c.nome));
      if (r.ok) {
        dao.debitar(job.userId, preco, 'SMS para ' + c.telefone);
        job.enviados++;
      } else {
        job.fail++; // falhou na Comtele: NAO desconta saldo
      }
      if (i < contatos.length - 1) await new Promise(r => setTimeout(r, 500)); // throttle
    }
    job.terminado = true;
    setTimeout(() => disparoJobs.delete(jobId), 5 * 60 * 1000); // limpa depois de 5 min
  })();
});

app.get('/api/disparo-status', requireLogin, (req, res) => {
  const job = disparoJobs.get(req.query.id);
  if (!job || job.userId !== req.user.id) return res.json({ terminado: true, total: 0, enviados: 0, fail: 0 });
  res.json({ total: job.total, enviados: job.enviados, fail: job.fail, terminado: job.terminado, parou: job.parou });
});

// --- ADMIN (você): clientes, saldo, preço ---
const centavosDe = s => Math.round(parseFloat(String(s).replace(',', '.')) * 100) || 0;

app.get('/admin', requireAdmin, async (req, res) => {
  const users = dao.listarUsuarios();
  const comteleSaldo = await comtele.consultarSaldo();
  const estoqueSms = comteleSaldo.ok ? Math.floor(comteleSaldo.saldo / 0.10) : null;
  const linhas = users.map(u => `<tr>
    <td>${u.id}</td>
    <td>${u.nome}<br><span class="hint">${u.email}</span>${ehAdmin(u) ? ' 👑' : ''}</td>
    <td><b>${reais(u.saldo)}</b></td>
    <td>${reais(dao.totalGasto(u.id))}</td>
    <td>${reais(u.preco_sms)}</td>
    <td>
      <form method="POST" action="/admin/creditar" class="inline">
        <input type="hidden" name="userId" value="${u.id}">
        <input name="valor" placeholder="R$" style="width:70px">
        <button class="btn azul mini">+ saldo</button>
      </form>
      <form method="POST" action="/admin/preco" class="inline">
        <input type="hidden" name="userId" value="${u.id}">
        <input name="preco" placeholder="${(u.preco_sms/100).toFixed(2)}" style="width:60px">
        <button class="btn cinza mini">preço</button>
      </form>
      ${ehAdmin(u) ? '' : `<form method="POST" action="/admin/apagar" class="inline" onsubmit="return confirm('Apagar ${u.nome.replace(/[^a-zA-Z0-9 ]/g, '')} e todo o histórico? Não dá pra desfazer.')">
        <input type="hidden" name="userId" value="${u.id}">
        <button class="btn mini" style="background:#ef4444">🗑️</button>
      </form>`}
    </td></tr>`).join('');
  res.send(layout('Admin', `
    <h1>👑 Admin</h1>
    <p class="sub">Seu custo na Comtele: R$ 0,10/SMS. Cada cliente paga o "preço por SMS" abaixo — a diferença é sua margem.</p>
    <div class="cards">
      <div class="card"><div class="l">Estoque Comtele</div>
        <div class="n">${comteleSaldo.ok ? ('R$ ' + comteleSaldo.saldo.toFixed(2).replace('.', ',')) : '—'}</div>
        <span class="hint">${estoqueSms != null ? ('~' + estoqueSms + ' SMS pra enviar') : 'não consegui consultar a Comtele'}</span></div>
      <div class="card"><div class="l">Clientes</div><div class="n">${users.length}</div></div>
    </div>
    ${req.query.ok ? `<p class="hint" style="color:#4ade80">✅ ${req.query.ok}</p>` : ''}
    <table><thead><tr><th>#</th><th>Cliente</th><th>Saldo</th><th>Gasto</th><th>Preço/SMS</th><th>Ações</th></tr></thead>
    <tbody>${linhas}</tbody></table>
    <style>.inline{display:inline-block;margin:2px}.btn.mini{padding:6px 10px;font-size:.8rem}
    .inline input{padding:6px;border:1px solid #475569;border-radius:6px;background:var(--bg);color:var(--txt)}</style>
  `, req.user));
});

app.post('/admin/creditar', requireAdmin, (req, res) => {
  const userId = Number(req.body.userId);
  const centavos = centavosDe(req.body.valor);
  if (userId && centavos > 0) dao.recarregar(userId, centavos, 'Crédito manual (admin)');
  res.redirect('/admin?ok=' + encodeURIComponent('Saldo de ' + reais(centavos) + ' adicionado.'));
});

app.post('/admin/preco', requireAdmin, (req, res) => {
  const userId = Number(req.body.userId);
  const centavos = centavosDe(req.body.preco);
  if (userId && centavos > 0) dao.definirPreco(userId, centavos);
  res.redirect('/admin?ok=' + encodeURIComponent('Preço por SMS atualizado.'));
});

app.post('/admin/apagar', requireAdmin, (req, res) => {
  const userId = Number(req.body.userId);
  const alvo = dao.buscarPorId(userId);
  // Nao deixa apagar admin nem a propria conta
  if (userId && alvo && !ehAdmin(alvo) && userId !== req.user.id) dao.apagarUsuario(userId);
  res.redirect('/admin?ok=' + encodeURIComponent('Cliente apagado.'));
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
