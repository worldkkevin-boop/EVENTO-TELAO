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

// Conta as linhas (menos o cabeçalho)
function totalPresencas() {
  return Math.max(0, getSheet().getLastRow() - 1);
}

// Roteia: ?action=count devolve JSON; senão, serve o formulário
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'count') {
    return ContentService
      .createTextOutput(JSON.stringify({ total: totalPresencas() }))
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
