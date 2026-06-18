/**
 * SERVIDOR DE PRESENÇA NA NUVEM — Google Apps Script
 * --------------------------------------------------
 * - Serve a página do QR Code (formulário) em doGet.
 * - Grava nome + WhatsApp no Google Sheets (registrarPresenca).
 * - Devolve o total em JSON em ?action=count (lido pelo seu notebook).
 *
 * Como usar: veja PASSO-A-PASSO.md (deploy como Web App, acesso "Qualquer pessoa").
 */

const SHEET_NAME = 'Presencas';

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['Nome', 'WhatsApp', 'Hora']);
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
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Confirme sua Presença - União Brasil')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

// Chamada pelo formulário (google.script.run). Grava e devolve o novo total.
function registrarPresenca(nome, whatsapp) {
  nome = String(nome || '').trim();
  whatsapp = String(whatsapp || '').trim();
  if (!nome || !whatsapp) {
    throw new Error('Preencha nome e WhatsApp.');
  }
  getSheet().appendRow([nome, whatsapp, new Date()]);
  return totalPresencas();
}
