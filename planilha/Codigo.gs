/**
 * Catálogo do site — script da planilha do cliente.
 *
 * O dono edita a aba "Produtos" e sobe fotos na pasta do Drive.
 * Cerca de 1 minuto depois da última edição, o site é atualizado sozinho.
 * Marcando a caixa "Publicar agora" (célula F1), publica na hora.
 *
 * Administrador: menu Site > Configurar este cliente (uma vez por planilha).
 */

var API_PADRAO = 'https://biosite-dusky.vercel.app/api/sincronizar';
var ABA = 'Produtos';
var ABA_CONFIG = 'Configuração';
var LINHA_CAB = 2;               // linha dos títulos das colunas
var C = { nome: 1, preco: 2, cat: 3, desc: 4, foto: 5, esgotado: 6, id: 7 };

/* ---------- Menu ---------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Site')
    .addItem('Publicar agora', 'publicarAgora')
    .addSeparator()
    .addItem('Configurar este cliente (administrador)', 'configurar')
    .addItem('Trazer produtos atuais do site (administrador)', 'importarDoSite')
    .addToUi();
}

function publicarAgora() { sincronizar(); }

/* ---------- Configuração (feita uma vez pelo administrador) ---------- */
function configurar() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();

  var r1 = ui.prompt('Configurar cliente (1/3)', 'Endereço do site do cliente (ex.: dom-manolo-barbearia):', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  var site = r1.getResponseText().trim().toLowerCase().replace(/^.*\//, '');
  if (!/^[a-z0-9-]{1,60}$/.test(site)) { ui.alert('Endereço inválido. Use só letras minúsculas, números e hífen.'); return; }

  var r2 = ui.prompt('Configurar cliente (2/3)', 'Código de acesso do cliente (gerado no Criador e já publicado, ex.: k6ym-aed2-ze4s):', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  var codigo = r2.getResponseText().trim();

  props.setProperties({ site: site, codigo: codigo, api: props.getProperty('api') || API_PADRAO });
  try {
    chamar({ acao: 'status' });
  } catch (e) {
    ui.alert('Não consegui conectar ao site: ' + e.message + '\n\nConfira o endereço, o código e se o site foi publicado depois de gerar o código.');
    return;
  }

  var ss = SpreadsheetApp.getActive();
  var pasta = pastaFotos(true);

  // Publica sozinho quando alguém edita (roda com a conta do administrador)
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'aoEditar') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('aoEditar').forSpreadsheet(ss).onEdit().create();

  prepararAbas();
  var base = props.getProperty('api').replace(/\/api\/sincronizar$/, '');
  var cfg = ss.getSheetByName(ABA_CONFIG);
  cfg.getRange('B2').setValue(site);
  cfg.getRange('B3').setValue(base + '/' + site);
  cfg.getRange('B4').setValue(pasta.getUrl());
  cfg.getRange('B5').setValue(base + '/' + site + '-avaliar');

  var r3 = ui.prompt('Compartilhar com o dono (3/3)', 'E-mail Google do dono do negócio (deixe vazio para compartilhar depois):', ui.ButtonSet.OK_CANCEL);
  var email = r3.getSelectedButton() === ui.Button.OK ? r3.getResponseText().trim() : '';
  if (email) {
    try { ss.addEditor(email); pasta.addEditor(email); }
    catch (e) { ui.alert('Não consegui compartilhar com ' + email + ': ' + e.message); }
  }

  status('Planilha ligada ao site ' + base + '/' + site + '. Edite os produtos e o site atualiza sozinho.', false);
  ui.alert('Pronto!\n\nSite: ' + base + '/' + site + '\nPasta de fotos: ' + pasta.getName() +
    (email ? '\nCompartilhado com: ' + email : '') +
    '\n\nSe o site já tem produtos, use Site > Trazer produtos atuais do site.');
}

function prepararAbas() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(ABA);
  sh.getRange(1, C.esgotado).insertCheckboxes().setValue(false);
  var n = Math.max(sh.getMaxRows() - LINHA_CAB, 1);
  sh.getRange(LINHA_CAB + 1, C.esgotado, n, 1).insertCheckboxes();
  sh.getRange(LINHA_CAB + 1, C.preco, n, 1).setNumberFormat('"R$" #,##0.00');
}

/* ---------- Gatilhos ---------- */
function aoEditar(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== ABA) return;
  var lin = e.range.getRow(), col = e.range.getColumn();
  if (lin === 1 && col === C.esgotado) {
    if (String(e.value).toUpperCase() === 'TRUE') { e.range.setValue(false); sincronizar(); }
    return;
  }
  if (lin + e.range.getNumRows() - 1 <= LINHA_CAB) return;
  status('Alterações recebidas. O site atualiza em cerca de 1 minuto…', false, true);
  agendar();
}

function agendar() {
  limparAgendamentos();
  ScriptApp.newTrigger('sincronizarAgendado').timeBased().after(60 * 1000).create();
}

function limparAgendamentos() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sincronizarAgendado') ScriptApp.deleteTrigger(t);
  });
}

function sincronizarAgendado() {
  limparAgendamentos();
  sincronizar();
}

/* ---------- Publicação ---------- */
function sincronizar() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { agendar(); return; }
  try {
    var props = PropertiesService.getScriptProperties();
    if (!props.getProperty('site') || !props.getProperty('codigo')) {
      status('Esta planilha ainda não foi ligada a um site (menu Site > Configurar este cliente).', true);
      return;
    }
    status('Publicando…', false, true);
    var ss = SpreadsheetApp.getActive();
    var sh = ss.getSheetByName(ABA);
    var n = sh.getLastRow() - LINHA_CAB;
    if (n < 1) { status('Nenhum produto na planilha.', true); return; }

    var vals = sh.getRange(LINHA_CAB + 1, 1, n, C.id).getValues();

    // Código interno de cada produto (mantém carrinho e fotos ligados ao produto certo)
    var vistos = {}, mudou = false;
    vals.forEach(function (r) {
      if (!String(r[C.nome - 1]).trim()) return;
      var id = String(r[C.id - 1]).trim();
      if (!id || vistos[id]) { id = 'p' + Utilities.getUuid().replace(/-/g, '').slice(0, 10); r[C.id - 1] = id; mudou = true; }
      vistos[id] = true;
    });
    if (mudou) sh.getRange(LINHA_CAB + 1, C.id, n, 1).setValues(vals.map(function (r) { return [r[C.id - 1]]; }));

    var pasta = pastaFotos(false);
    var linhas = [], problemas = [], precisam = {};
    vals.forEach(function (r, i) {
      var nome = String(r[C.nome - 1]).trim();
      if (!nome) return;
      var linha = LINHA_CAB + 1 + i;
      var p = r[C.preco - 1];
      var preco = typeof p === 'number' ? p.toFixed(2).replace('.', ',') : String(p).replace(/^\s*R\$\s*/i, '').trim();
      var ref = String(r[C.foto - 1]).trim(), foto = '';
      if (/^(-|sem foto)$/i.test(ref)) foto = '-';
      else if (ref) {
        var f = acharFoto(ref, pasta);
        if (!f) problemas.push('Linha ' + linha + ': foto "' + ref + '" não encontrada na pasta.');
        else { foto = 'd-' + f.getId() + '-' + f.getLastUpdated().getTime().toString(36); precisam[foto] = f; }
      }
      var e = r[C.esgotado - 1];
      linhas.push({
        id: String(r[C.id - 1]), nome: nome, preco: preco,
        cat: String(r[C.cat - 1]).trim(), desc: String(r[C.desc - 1]).trim(),
        foto: foto, esgotado: e === true || /^(sim|s|x)$/i.test(String(e).trim())
      });
    });

    // Envia só as fotos novas ou trocadas
    var ja = {};
    (chamar({ acao: 'status' }).fotos || []).forEach(function (k) { ja[k] = true; });
    var novas = {};
    Object.keys(precisam).forEach(function (ch) {
      if (ja[ch]) return;
      try {
        var blob = miniatura(precisam[ch]);
        novas[ch] = chamar({ acao: 'foto', chave: ch, base64: Utilities.base64Encode(blob.getBytes()) }).sha;
      } catch (err) {
        problemas.push('Foto "' + precisam[ch].getName() + '": ' + err.message);
        linhas.forEach(function (l) { if (l.foto === ch) l.foto = ''; });
      }
    });

    var r = chamar({ acao: 'publicar', produtos: linhas, novasFotos: novas });
    var avisos = problemas.concat(r.avisos || []);
    var quando = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'dd/MM HH:mm');
    status((r.semMudancas ? 'Site já está atualizado' : 'Publicado') + ' em ' + quando + ' · ' + r.produtos + ' produtos' +
      (r.semMudancas ? '' : '. Aparece no site em cerca de 1 minuto.') +
      (avisos.length ? '\nAtenção: ' + avisos.join(' ') : ''), avisos.length > 0);
    var cfg = ss.getSheetByName(ABA_CONFIG);
    if (cfg) cfg.getRange('B6').setValue(new Date());
  } catch (e) {
    status('Não foi possível publicar: ' + e.message + ' Tente marcar "Publicar agora" de novo daqui a pouco.', true);
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Trazer os produtos que já estão no site ---------- */
function importarDoSite() {
  var ui = SpreadsheetApp.getUi();
  var sh = SpreadsheetApp.getActive().getSheetByName(ABA);
  var r;
  try { r = chamar({ acao: 'ler' }); } catch (e) { ui.alert('Não consegui ler o site: ' + e.message); return; }
  if (sh.getLastRow() > LINHA_CAB) {
    var ok = ui.alert('Trazer produtos do site', 'A aba Produtos já tem linhas. Elas serão substituídas pelos ' + r.produtos.length + ' produtos do site. Continuar?', ui.ButtonSet.YES_NO);
    if (ok !== ui.Button.YES) return;
    sh.getRange(LINHA_CAB + 1, 1, sh.getLastRow() - LINHA_CAB, C.id).clearContent();
  }
  if (!r.produtos.length) { ui.alert('O site ainda não tem produtos.'); return; }
  var linhas = r.produtos.map(function (p) {
    var n = parseFloat(String(p.preco).replace(/\./g, '').replace(',', '.'));
    return [p.nome, isNaN(n) ? p.preco : n, p.cat, p.desc, '', !!p.esgotado, p.id];
  });
  sh.getRange(LINHA_CAB + 1, 1, linhas.length, C.id).setValues(linhas);
  prepararAbas();
  status('Produtos trazidos do site. As fotos atuais continuam no site; para trocar uma foto, coloque o nome do arquivo na coluna Foto.', false);
  ui.alert(linhas.length + ' produtos trazidos do site.');
}

/* ---------- Fotos ---------- */
function pastaFotos(criar) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('pasta');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  if (!criar) throw new Error('Pasta de fotos não configurada (menu Site > Configurar este cliente).');
  var ss = SpreadsheetApp.getActive();
  var pais = DriveApp.getFileById(ss.getId()).getParents();
  var pai = pais.hasNext() ? pais.next() : DriveApp.getRootFolder();
  var pasta = pai.createFolder('Fotos - ' + ss.getName().replace(/^Catálogo\s*-\s*/i, ''));
  props.setProperty('pasta', pasta.getId());
  return pasta;
}

function acharFoto(ref, pasta) {
  var m = ref.match(/\/d\/([-\w]{20,})/) || ref.match(/[?&]id=([-\w]{20,})/);
  if (m) { try { return DriveApp.getFileById(m[1]); } catch (e) { return null; } }
  var nome = ref.split(/[\\\/]/).pop().trim();
  var it = pasta.getFilesByName(nome);
  if (it.hasNext()) return it.next();
  var base = nome.replace(/\.[^.]+$/, '').toLowerCase();
  it = pasta.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName().replace(/\.[^.]+$/, '').toLowerCase() === base) return f;
  }
  return null;
}

// Pede ao Drive uma versão reduzida da foto (funciona também com HEIC do iPhone)
function miniatura(f) {
  var tok = ScriptApp.getOAuthToken();
  var opt = { headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true };
  var meta = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + f.getId() + '?fields=thumbnailLink&supportsAllDrives=true', opt);
  if (meta.getResponseCode() === 200) {
    var link = JSON.parse(meta.getContentText()).thumbnailLink;
    if (link) {
      var img = UrlFetchApp.fetch(link.replace(/=s\d+$/, '=s900'), opt);
      if (img.getResponseCode() === 200 && /^image\/(jpeg|png|webp|gif)$/.test(img.getBlob().getContentType())) return img.getBlob();
    }
  }
  var b = f.getBlob();
  if (/^image\/(jpeg|png|webp|gif)$/.test(b.getContentType()) && b.getBytes().length <= 2500000) return b;
  throw new Error('o Drive ainda está processando a foto ou ela é grande demais. Tento de novo na próxima publicação.');
}

/* ---------- Apoio ---------- */
function chamar(dados) {
  var p = PropertiesService.getScriptProperties();
  var corpo = { site: p.getProperty('site'), codigo: p.getProperty('codigo') };
  for (var k in dados) corpo[k] = dados[k];
  var r = UrlFetchApp.fetch(p.getProperty('api') || API_PADRAO, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(corpo), muteHttpExceptions: true
  });
  var j = {};
  try { j = JSON.parse(r.getContentText()); } catch (e) {}
  if (r.getResponseCode() >= 300) throw new Error(j.erro || ('o servidor respondeu ' + r.getResponseCode() + '.'));
  return j;
}

function status(msg, erro, andamento) {
  var sh = SpreadsheetApp.getActive().getSheetByName(ABA);
  if (!sh) return;
  var cel = sh.getRange(1, 1);
  cel.setValue(msg).setBackground(erro ? '#fde7c8' : andamento ? '#fff7d6' : '#dcf2e4');
  SpreadsheetApp.flush();
}
