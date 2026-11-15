// QR code do link de cadastro (qr.js): valores de referência da norma ISO/IEC 18004 e leitura de volta.
// O leitor deste teste é escrito à parte (lê formato, tira a máscara, junta os blocos, confere o
// Reed-Solomon e decodifica o texto), para pegar erro de posição que um teste só do gerador não pegaria.
const test = require("node:test");
const assert = require("node:assert/strict");
const QR = require("../qr.js");
const _ = QR._;

test("Reed-Solomon: exemplo clássico HELLO WORLD (versão 1, nível M)", () => {
  const dados = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(_.resto(dados, _.divisor(10)), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test("formato, versão, alinhamento e capacidade batem com as tabelas da norma", () => {
  const formatoM = ["101010000010010", "101000100100101", "101111001111100", "101101101001011", "100010111111001", "100000011001110", "100111110010111", "100101010100000"];
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((m) => _.bitsDeFormato(m).toString(2).padStart(15, "0")), formatoM);
  assert.equal(_.bitsDeVersao(7).toString(2).padStart(18, "0"), "000111110010010100");
  assert.equal(_.bitsDeVersao(10).toString(2).padStart(18, "0"), "001010010011010011");
  assert.deepEqual(_.posicoesAlinhamento(1), []);
  assert.deepEqual(_.posicoesAlinhamento(2), [6, 18]);
  assert.deepEqual(_.posicoesAlinhamento(7), [6, 22, 38]);
  assert.deepEqual(_.posicoesAlinhamento(10), [6, 28, 50]);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(_.codewordsDeDados), [16, 28, 44, 64, 86, 108, 124, 154, 182, 216]);
});

// ---------- leitor independente ----------
const ECC = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCOS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

function areasFixas(ver) {
  const n = ver * 4 + 17;
  const f = Array.from({ length: n }, () => Array(n).fill(false));
  const marca = (x, y) => { if (x >= 0 && y >= 0 && x < n && y < n) f[y][x] = true; };
  for (let i = 0; i < n; i++) { marca(6, i); marca(i, 6); }
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) marca(cx + dx, cy + dy);
  const al = _.posicoesAlinhamento(ver);
  al.forEach((ay, a) => al.forEach((ax, b) => {
    if ((a === 0 && b === 0) || (a === 0 && b === al.length - 1) || (a === al.length - 1 && b === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) marca(ax + dx, ay + dy);
  }));
  for (let i = 0; i < 9; i++) { marca(8, i); marca(i, 8); }
  for (let i = 0; i < 8; i++) { marca(n - 1 - i, 8); marca(8, n - 1 - i); }
  if (ver >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { marca(n - 11 + j, i); marca(i, n - 11 + j); }
  return f;
}

function ler(m) {
  const n = m.modulos.length;
  const ver = (n - 17) / 4;
  const M = m.modulos;
  // Formato (primeira cópia) e conferência com a segunda
  const pos1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  const pos2 = [[n - 1, 8], [n - 2, 8], [n - 3, 8], [n - 4, 8], [n - 5, 8], [n - 6, 8], [n - 7, 8], [n - 8, 8], [8, n - 7], [8, n - 6], [8, n - 5], [8, n - 4], [8, n - 3], [8, n - 2], [8, n - 1]];
  const bits = (pos) => pos.reduce((v, [x, y], i) => v | ((M[y][x] ? 1 : 0) << i), 0);
  const formato = bits(pos1);
  assert.equal(formato, bits(pos2), "as duas cópias do formato são iguais");
  assert.equal(M[n - 8][8], true, "módulo escuro fixo");
  const dados = formato ^ 0x5412;
  const nivel = dados >>> 13, mascara = (dados >>> 10) & 7;
  assert.equal(nivel, 0, "nível M");
  assert.equal(formato, _.bitsDeFormato(mascara), "BCH do formato");
  // Lê os dados em zigue-zague tirando a máscara
  const fixo = areasFixas(ver);
  const masc = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0, (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0][mascara];
  const fluxo = [];
  for (let dir = n - 1; dir >= 1; dir -= 2) {
    if (dir === 6) dir = 5;
    const subindo = ((dir + 1) & 2) === 0;
    for (let v = 0; v < n; v++) for (let j = 0; j < 2; j++) {
      const x = dir - j, y = subindo ? n - 1 - v : v;
      if (!fixo[y][x]) fluxo.push((M[y][x] !== masc(x, y)) ? 1 : 0);
    }
  }
  const total = Math.floor(_.modulosDeDados(ver) / 8);
  const cw = [];
  for (let i = 0; i < total; i++) cw.push(fluxo.slice(i * 8, i * 8 + 8).reduce((a, b) => (a << 1) | b, 0));
  // Separa os blocos (curtos primeiro) e confere o Reed-Solomon de cada um
  const nb = BLOCOS[ver], ecc = ECC[ver], curtos = nb - (total % nb), tamCurto = Math.floor(total / nb);
  const blocos = Array.from({ length: nb }, (_x, i) => ({ dados: [], ecc: [], tam: tamCurto - ecc + (i < curtos ? 0 : 1) }));
  let k = 0;
  const maior = Math.max(...blocos.map((b) => b.tam));
  for (let i = 0; i < maior; i++) blocos.forEach((b) => { if (i < b.tam) b.dados.push(cw[k++]); });
  for (let i = 0; i < ecc; i++) blocos.forEach((b) => b.ecc.push(cw[k++]));
  for (const b of blocos) assert.deepEqual(_.resto(b.dados, _.divisor(ecc)), b.ecc, "Reed-Solomon do bloco");
  // Modo byte: 0100, tamanho e os bytes em UTF-8
  const todos = blocos.flatMap((b) => b.dados);
  const bitsDados = todos.flatMap((b) => [7, 6, 5, 4, 3, 2, 1, 0].map((i) => (b >>> i) & 1));
  let p = 0;
  const pega = (q) => { let v = 0; for (let i = 0; i < q; i++) v = (v << 1) | bitsDados[p++]; return v; };
  assert.equal(pega(4), 4, "modo byte");
  const len = pega(ver <= 9 ? 8 : 16);
  const bytes = [];
  for (let i = 0; i < len; i++) bytes.push(pega(8));
  return { texto: Buffer.from(bytes).toString("utf8"), ver, mascara };
}

test("o QR do link de cadastro lê de volta o mesmo link", () => {
  const link = "https://biosite-dusky.vercel.app/cadastro?c=AbCdEfGhIjKlMnOpQrStUvWx";
  const m = QR.matriz(link);
  assert.equal(m.tamanho, 37, "versão 5");
  const lido = ler(m);
  assert.equal(lido.texto, link);
  // Localizadores nos três cantos
  for (const [x, y] of [[0, 0], [m.tamanho - 7, 0], [0, m.tamanho - 7]]) {
    assert.equal(m.modulos[y][x], true);
    assert.equal(m.modulos[y + 1][x + 1], false);
    assert.equal(m.modulos[y + 3][x + 3], true);
  }
});

test("textos de vários tamanhos (versões 1 a 10, com acento) também leem de volta", () => {
  const textos = ["Oi", "https://exemplo.com/a", "Ação é ótima! 😀 " + "x".repeat(40), "y".repeat(120), "z".repeat(170), "w".repeat(210)];
  const versoes = new Set();
  for (const t of textos) {
    const m = QR.matriz(t);
    const lido = ler(m);
    assert.equal(lido.texto, t);
    versoes.add(lido.ver);
  }
  assert.ok(versoes.has(1) && versoes.has(10) && [...versoes].some((v) => v >= 7), "passa pelas versões com informação de versão");
  assert.throws(() => QR.matriz("v".repeat(300)), /longo demais/);
});

test("SVG tem a margem de 4 módulos e fundo branco", () => {
  const svg = QR.svg("https://exemplo.com");
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 33 33"/);
  assert.match(svg, /<rect width="100%" height="100%" fill="#fff"\/>/);
  assert.match(svg, /M4,4h1v1h-1z/, "primeiro módulo do localizador depois da margem");
});
