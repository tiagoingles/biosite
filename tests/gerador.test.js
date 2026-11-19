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
  // O código do agendamento vem do próprio lib/gerador.js: no Windows ele pode estar com CRLF
  assert.equal(G.bioHTML(cfg, (u) => u).replace(/\r\n/g, "\n"), html, "regenerar com lib/gerador.js");
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

test("botão de enviar fica escondido fora da etapa de dados (o CSS não pode vencer o hidden)", () => {
  const html = G.bioHTML(siteBarbearia(), (u) => u);
  assert.ok(html.includes(".enviar[hidden]{display:none!important}"));
});

test("serviço sem foto nunca aparece como quadro vazio; com a maioria sem foto, a seção vira lista de preços", () => {
  const video = [{ tipo: "video", url: "https://x.supabase.co/v.mp4" }];
  const comServicos = (fotos) => {
    const servicos = fotos.map((tem, i) => ({ id: "s" + i, nome: "Serviço " + i, duracao: "30 min", preco: "35,00", midia: tem ? video : [] }));
    const base = siteBarbearia();
    return G.bioHTML({ ...base, agenda: { ...base.agenda, servicos, profissionais: [{ id: "p1", nome: "Bruno", servicos: servicos.map((s) => s.id), dias: [1, 2, 3] }] } }, (u) => u);
  };
  const vazios = (h) => (h.match(/<div class="svc-midia"><\/div>/g) || []).length;
  const icones = (h) => (h.match(/class="svc-midia svc-vazio"/g) || []).length;

  const todas = comServicos([true, true, true]);
  assert.equal(icones(todas), 0);
  assert.ok(!todas.includes("svc-lista compacta"), "todos com foto: grade de fotos");

  const metade = comServicos([true, true, false, false]);
  assert.equal(vazios(metade), 0, "nenhum quadro vazio");
  assert.equal(icones(metade), 2, "quem não tem foto ganha o ícone");
  assert.ok(!metade.includes("svc-lista compacta"), "metade com foto: continua em grade");

  const poucas = comServicos([true, false, false, false, false]);
  assert.equal(vazios(poucas), 0);
  assert.ok(poucas.includes('<div class="svc-lista compacta">'), "maioria sem foto: lista de preços");
  assert.equal((poucas.match(/data-agendar="s\d"/g) || []).length, 5, "todos os serviços continuam clicáveis para agendar");
  assert.ok(poucas.includes("v.mp4"), "o vídeo que existe continua aparecendo (miniatura)");
});

test("destaque legível: cor da marca que some no fundo dá lugar à cor do texto", () => {
  const acento = (cor, fundo, texto) => (G.bioHTML(siteBarbearia({ cor, fundo, texto }), (u) => u).match(/--acento:([^;]+);/) || [])[1];
  assert.equal(acento("#b08d57", "#121212", "#f2efe9"), "#b08d57", "dourado no fundo escuro continua dourado");
  assert.equal(acento("#0d0d0d", "#111111", "#f5f5f5"), "#f5f5f5", "preto no preto vira a cor do texto");
  assert.equal(acento("#ffe14d", "#ffffff", "#111111"), "#111111", "amarelo claro no branco vira a cor do texto");
  assert.equal(acento("#111111", "#ffffff", "#222222"), "#111111", "preto no branco continua preto");
});

test("sites publicados não têm quadro de serviço vazio", () => {
  for (const f of ["gw-barbearia.html", "jm-barbearia.html"]) {
    assert.ok(!ler(f).includes('<div class="svc-midia"></div>'), f);
  }
});

test("cartão de serviço: o nome nunca passa por cima do \"Agendar\" (gerador v16)", () => {
  assert.ok(G.VERSAO >= 16);
  for (const f of ["barbearia-modelo.html", "barbearia-exemplo.html", "gw-barbearia.html", "dom-manolo-barbearia.html"]) {
    const t = ler(f);
    assert.ok(t.includes(".svc-t b{overflow-wrap:break-word}"), f + ": palavra longa quebra em vez de vazar");
    assert.ok(t.includes(".compacta .svc{display:flex;align-items:center;gap:12px;padding:8px;container-type:inline-size}"), f);
    assert.ok(t.includes("@container (min-width:280px){"), f + ": o Agendar só vai para o lado quando o cartão é largo");
    assert.ok(!/\.compacta \.svc-ag\{grid-column:2;grid-row:1\/span 2;margin:0\}\n/.test(t), f + ": fora da regra de largura, o Agendar fica embaixo");
  }
});

test("preço \"a partir de\" (o \"R$ 28,00+\" do Booksy): cartão, lista do agendamento e preço do painel mantêm o prefixo (gerador v18)", () => {
  assert.ok(G.VERSAO >= 18);
  assert.equal(G.precoTxt("A partir de 28,00"), "a partir de " + G.brl(28));
  assert.equal(G.precoTxt("33,00"), G.brl(33));
  assert.equal(G.precoTxt("Sob consulta"), "Sob consulta");
  assert.equal(G.precoTxt(""), "");
  const cfg = siteBarbearia();
  cfg.agenda.servicos = [
    { id: "s1", nome: "Barba com design", duracao: "30 min", preco: "A partir de 28,00", midia: [] },
    { id: "s2", nome: "Manutenção de prótese", duracao: "60 min", preco: "Sob consulta", midia: [], protese: true },
  ];
  cfg.agenda.profissionais[0].servicos = ["s1", "s2"];
  const html = G.bioHTML(cfg, (u) => u);
  assert.ok(html.includes("<small>30 min · a partir de " + G.brl(28) + "</small>"), "cartão do serviço");
  assert.ok(html.includes("<small>60 min · Sob consulta</small>"), "texto sem número fica como está");
  // No navegador: a mesma função formata a lista do agendamento e o preço que vem do painel mantém o "a partir de"
  const linha = (re) => (html.match(re) || [""])[0];
  const codigo = [/ {2}function num\(v\)\{var t=[^\n]*/, / {2}function brl\(n\)\{[^\n]*/, / {2}function precoTxt\(p\)\{[^\n]*/].map(linha).join("\n");
  const ctx = {};
  vm.runInNewContext(codigo + "\nthis.r=[precoTxt('A partir de 28,00'),precoTxt('15,00'),precoTxt('Grátis')];", ctx);
  assert.deepEqual(Array.from(ctx.r), ["a partir de " + G.brl(28), G.brl(15), "Grátis"]); // array de outro contexto do vm
  assert.ok(html.includes("var preco=precoTxt(s.preco);"), "lista do agendamento");
  assert.ok(html.includes('s.preco=(/^\\s*a partir de/i.test(String(s.preco||""))?"A partir de ":"")+v.toFixed(2)'), "preço do painel guarda o prefixo");
  assert.ok(!html.includes("(/^s*a partir de/i"), "a barra do \\s não pode sumir");
  assert.ok(html.includes("card.textContent=[s.duracao,precoTxt(s.preco)]"), "cartão atualizado com o preço do painel");
});

test("site da Dom Manolo: os 33 serviços do Booksy, na ordem de lá, com a prótese no bloco próprio", () => {
  const cfg = extrairConfig(ler("dom-manolo-barbearia.html"));
  const svcs = cfg.agenda.servicos;
  assert.equal(svcs.length, 33);
  assert.equal(svcs[0].nome, "Corte de cabelo na tesoura", "começa pela categoria Cortes de cabelo");
  assert.equal(svcs.find((s) => s.nome === "Barba com design").preco, "A partir de 28,00");
  assert.equal(svcs.find((s) => s.nome === "Sobrancelha").preco, "15,00");
  assert.deepEqual(svcs.filter((s) => s.protese).map((s) => [s.nome, s.preco]), [
    ["Avaliação para Prótese Capilar", "Grátis"], ["Manutenção de Prótese Capilar", "Sob consulta"], ["Colocação de Prótese Capilar", "Sob consulta"],
  ]);
  assert.ok(svcs.find((s) => s.nome === "Corte de cabelo degradê").midia.length, "o vídeo do corte foi junto");
  assert.ok(svcs.find((s) => s.nome === "Barba simples").midia.length, "o vídeo da barba foi junto");
  assert.ok(!svcs.some((s) => s.nome === "Corte social"), "os serviços do modelo saíram");
  assert.ok(svcs.every((s) => /^bk-\d+$/.test(s.id)), "id ligado ao serviço do Booksy");
  for (const p of cfg.agenda.profissionais) assert.equal(p.servicos.length, 33);
  assert.ok(ler("dom-manolo-barbearia.html").includes('<section class="bloco svcs protese" id="protese">'));
});
