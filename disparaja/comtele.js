// Envio de SMS via Comtele (API nova). A chave é do DONO (env COMTELE_API_KEY);
// os clientes NUNCA veem isso — eles só têm saldo em R$.
function soDigitos(t) { return String(t == null ? '' : t).replace(/\D/g, ''); }
// A API nova quer o numero COM o 55 do pais (ex: 5596991767788)
function foneComtele(t) { let d = soDigitos(t); if (d.length >= 12 && d.startsWith('55')) return d; if (d.length >= 10) return '55' + d; return d; }
// Troca {nome} pelo primeiro nome
function personaliza(msg, nome) {
  const primeiro = String(nome || '').trim().split(/\s+/)[0] || '';
  return String(msg || '').replace(/\{nome\}/gi, primeiro);
}

async function enviarSMS(numero, conteudo) {
  const apiKey = process.env.COMTELE_API_KEY || '';
  const route = process.env.COMTELE_ROTA || '16'; // 16 = Marketing
  if (!apiKey) return { ok: false, msg: 'COMTELE_API_KEY nao configurada' };
  let resp;
  try {
    resp = await fetch('https://api.comtele.com.br/messages/sms/send', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receivers: [foneComtele(numero)], contactGroups: [], message: conteudo,
        route: String(route), tag: 'disparaja', custom: ''
      })
    });
  } catch (e) { return { ok: false, msg: 'conexao: ' + e.message }; }
  let data = {};
  try { data = await resp.json(); } catch (e) { data = {}; }
  const ok = resp.ok && data.hasError === false;
  const msg = ok ? 'ok' : (data.message || (Array.isArray(data.errors) && data.errors.join('; ')) || ('HTTP ' + resp.status));
  return { ok, msg };
}

module.exports = { enviarSMS, personaliza, foneComtele, soDigitos };
