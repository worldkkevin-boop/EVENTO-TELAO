// Envio de WhatsApp OFICIAL — ESTRUTURA PRONTA, falta só plugar o endpoint/credenciais
// da Comtele quando o WhatsApp Business for ativado (precisa MEI + Meta Business verificado).
//
// Enquanto COMTELE_WHATSAPP_URL nao estiver no .env, o canal fica DESATIVADO:
//   ativo() === false  -> a tela mostra "WhatsApp em ativacao" e nada quebra no SMS.
//
// Quando a Comtele liberar, coloque no .env:
//   COMTELE_WHATSAPP_URL=...        (URL do endpoint de envio de WhatsApp deles)
//   COMTELE_WA_API_KEY=...          (se for uma chave diferente; senao usa COMTELE_API_KEY)
// e confira o formato do "body" abaixo com a doc do WhatsApp da Comtele (template/params).
const comtele = require('./comtele');

// O canal so liga quando tem URL + chave configuradas.
function ativo() {
  return !!(process.env.COMTELE_WHATSAPP_URL && (process.env.COMTELE_WA_API_KEY || process.env.COMTELE_API_KEY));
}

// Mesma assinatura do comtele.enviarSMS: retorna { ok, msg, semSaldo }.
// semSaldo = a conta do DONO ficou sem credito (problema do dono -> pausa pro admin, igual ao SMS).
async function enviarWhatsApp(numero, conteudo, custom = '') {
  const url = process.env.COMTELE_WHATSAPP_URL || '';
  const apiKey = process.env.COMTELE_WA_API_KEY || process.env.COMTELE_API_KEY || '';
  if (!url || !apiKey) return { ok: false, msg: 'WhatsApp ainda nao configurado' };
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      // OBS: o formato exato (message vs template + parametros) sai da doc da Comtele.
      // Deixei no mesmo padrao do SMS pra ser facil de ajustar quando ativar.
      body: JSON.stringify({
        receivers: [comtele.foneComtele(numero)],
        message: conteudo,
        tag: 'disparaja',
        custom: String(custom || ''),
      }),
    });
  } catch (e) { return { ok: false, msg: 'conexao: ' + e.message }; }
  let data = {};
  try { data = await resp.json(); } catch (e) { data = {}; }
  const ok = resp.ok && data.hasError === false;
  const msg = ok ? 'ok' : (data.message || (Array.isArray(data.errors) && data.errors.join('; ')) || ('HTTP ' + resp.status));
  const semSaldo = !ok && /insuficiente|cr[eé]dito|sem saldo/i.test(msg);
  return { ok, msg, semSaldo };
}

module.exports = { ativo, enviarWhatsApp };
