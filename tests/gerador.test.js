// Gerador dos sites: nada que o dono digita vira código na página, o Criador está igual ao servidor
// e o site da GW Barbearia está gerado com a versão atual.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const G = require("../lib/gerador");
const { extrairConfig } = require("../lib/servidor");
const { sincronizado } = require("../scripts/sincronizar-criador");

const raiz = path.join(__dirname, "..");
const ler = (p) => fs.readFileSync(path.join(raiz, p), "utf8").replace(/\r\n/g, "\n");
const XSS = '"><img src=x onerror=alert(1)><script>alert(2)</script>';

function siteBarbearia(extra = {}) {
  return {
    modelo: "vitrine", nome: "Barbearia " + XSS, cidade: "Cidade " + XSS, descricao: XSS, whatsapp: "11999999999", whatsMsg: XSS,
    instagram: "@perfil", review: "javascript:alert(1)", endereco: XSS, maps: "javascript:alert(3)", horario: XSS + "\nlinha 2",
    logo: "javascript:alert(4)", capa: "", nota: "4.9", totalAval: "10", mostrarNota: true,
    extras: [{ titulo: XSS, url: "javascript:alert(5)" }, { titulo: "Ok", url: "https://exemplo.com" }],
    catalogoTitulo: "", categorias: [], produtos: [], pedido: null,
    cor: "#111111", fundo: "#ffffff", texto: "#111111", fonteTitulo: "Poppins", fonteTexto: "Poppins",
    slug: "gw-teste", tipo: "barbearia",
    agenda: {
      ativo: true, botao: XSS,
      servicos: [{ id: "s1", nome: "Corte " + XSS, duracao: "30 min", preco: "35,00", midia: [{ tipo: "foto", url: "javascript:alert(6)" }, { tipo: "video", url: "https://x.supabase.co/v.mp4" }] }],
      profissionais: [{ id: "p1", nome: "Bruno " + XSS, servicos: ["s1"], dias: [1, 2, 3, 4, 5] }],
    },
    ...extra,
  };
}

test("texto do dono é escapado e links perigosos são descartados", () => {
  const html = G.bioHTML(siteBarbearia(), (u) => u);
  const semConfig = html.replace(/<script type="application\/json" id="bio-config">[\s\S]*?<\/script>/, "");
  assert.ok(!semConfig.includes("<img src=x onerror"), "tag injetada apareceu crua");
  assert.ok(!semConfig.includes("<script>alert(2)"), "script injetado apareceu cru");
  assert.ok(!/href="javascript:/i.test(html), "link javascript: na página");
  assert.ok(!/src="javascript:/i.test(html), "src javascript: na página");
  assert.ok(semConfig.includes("&lt;script&gt;alert(2)&lt;/script&gt;"));
});

test("dados do site embutidos não fecham a tag <script>", () => {
  const html = G.bioHTML(siteBarbearia(), (u) => u);
  const i = html.indexOf('<script type="application/json" id="bio-config">');
  const j = html.indexOf("</script>", i);
  const json = html.slice(i, j);
  assert.ok(!json.slice(10).includes("<"), "o JSON não pode ter '<' cru");
  const cfg = extrairConfig(html);
  assert.equal(cfg.nome, "Barbearia " + XSS, "o dado volta intacto ao ler");
});

test("scripts do site gerado compilam", () => {
  const html = G.bioHTML(siteBarbearia(), (u) => u);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 1);
  scripts.forEach((s, n) => new vm.Script(s, { filename: "site-" + n }));
});

test("agendamento do site: não abre o WhatsApp quando o pedido falha e mostra o código quando dá certo", () => {
  const fonte = G.bioHTML(siteBarbearia(), (u) => u);
  assert.match(fonte, /Seu pedido não foi registrado/);
  assert.match(fonte, /Código do pedido/);
  assert.match(fonte, /agendamento\.ics/);
  assert.match(fonte, /dias=1/, "busca os dias com agenda publicada");
});

test("Criador está igual ao gerador do servidor (evita publicar versão antiga)", () => {
  const atual = ler("criador.html");
  assert.equal(sincronizado(atual), atual, "rode: node scripts/sincronizar-criador.js");
  assert.match(atual, new RegExp(`const GERADOR_VERSAO = ${G.VERSAO};`));
  assert.match(atual, /srv\.gerador>GERADOR_VERSAO/, "o Criador confere a versão antes de publicar");
});

test("site da GW Barbearia gerado com a versão atual do gerador", () => {
  const html = ler("gw-barbearia.html");
  const cfg = extrairConfig(html);
  assert.equal(G.bioHTML(cfg, (u) => u), html, "regenerar com lib/gerador.js");
  assert.ok(html.includes("tem-pref"), "tem a escolha de preferência de barbeiro");
});

test("todos os sites publicados têm a configuração legível", () => {
  const sites = fs.readdirSync(raiz).filter((f) => f.endsWith(".html") && f !== "criador.html" && !f.endsWith("-avaliar.html") && fs.readFileSync(path.join(raiz, f), "utf8").includes('id="bio-config"'));
  assert.ok(sites.length >= 4, sites.join(","));
  for (const s of sites) {
    const cfg = extrairConfig(ler(s));
    assert.ok(cfg && cfg.nome, s);
  }
});
