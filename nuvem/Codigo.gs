/**
 * SERVIDOR DE PRESENÇA NA NUVEM — Google Apps Script
 * --------------------------------------------------
 * - Serve a página do QR Code (formulário) em doGet.
 * - Grava Evento + Nome + WhatsApp no Google Sheets (registrarPresenca).
 * - Devolve o total em JSON em ?action=count (lido pelo seu notebook).
 *
 * NOME DO EVENTO:
 *   - Edite EVENTO_PADRAO abaixo (jeito mais simples), OU
 *   - Passe na URL do QR: .../exec?evento=Nome%20do%20Evento
 *   Cada presença é gravada com esse nome, pra identificar a lista depois.
 */

const SHEET_NAME = 'Presencas';
const EVENTO_PADRAO = 'Plenária União Brasil - Laranjal do Jari';

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['Evento', 'Nome', 'WhatsApp', 'Hora']);
  }
  return sheet;
}

// Conta as presenças. Se "evento" vier, conta SÓ as linhas daquele evento.
function totalPresencas(evento) {
  const sheet = getSheet();
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  if (!evento) return last - 1; // sem filtro = total geral
  const eventos = sheet.getRange(2, 1, last - 1, 1).getValues(); // coluna A = Evento
  let n = 0;
  const alvo = String(evento).trim();
  for (let i = 0; i < eventos.length; i++) {
    if (String(eventos[i][0]).trim() === alvo) n++;
  }
  return n;
}

// Roteia: ?action=count devolve JSON; senão, serve o formulário
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'count') {
    const ev = (e.parameter && e.parameter.evento) ? e.parameter.evento : '';
    return ContentService
      .createTextOutput(JSON.stringify({ total: totalPresencas(ev) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const tmpl = HtmlService.createTemplateFromFile('index');
  tmpl.evento = (e && e.parameter && e.parameter.evento) ? e.parameter.evento : EVENTO_PADRAO;
  return tmpl.evaluate()
    .setTitle('Confirme sua Presença - União Brasil')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

// Chamada pelo formulário (google.script.run). Grava e devolve o novo total.
function registrarPresenca(nome, whatsapp, evento) {
  nome = String(nome || '').trim();
  whatsapp = String(whatsapp || '').trim();
  evento = String(evento || EVENTO_PADRAO).trim();
  if (!nome || !whatsapp) {
    throw new Error('Preencha nome e WhatsApp.');
  }
  getSheet().appendRow([evento, nome, whatsapp, new Date()]);
  return totalPresencas();
}
