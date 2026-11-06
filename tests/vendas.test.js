// Página de vendas: formulário de interessados (público e protegido contra abuso),
// lista e andamento só para a conta da plataforma, e preços coerentes na página.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const A = require("./ajuda");
const { UUIDS } = A;
const config = require("../api/config");
const eu = require("../api/eu");

const LEAD = { tipo: "lead", nome: "  Marcos   Lima ", barbearia: "Barbearia <b>do</b> Marcos", whatsapp: "(81) 98888-7777", cidade: "Olinda", barbeiros: "2-3", plano: "Barbearia", pagina: "/?utm_source=instagram" };

function rotasLead(gravados, tentativas = 1) {
  return [
    { padrao: /\/rest\/v1\/rpc\/contar_tentativa/, resposta: { corpo: tentativas } },
    { metodo: "POST", padrao: /\/rest\/v1\/leads$/, resposta: (url, op, corpo) => { gravados.push(corpo); return { status: 201 }; } },
    { padrao: /\/rest\/v1\/telemetria/, resposta: { status: 201 } },
  ];
}

test("interessado: grava só campos limpos, sem guardar o IP", async () => {
  const gravados = [];
  A.instalarFetch(rotasLead(gravados));
  const r = await A.chamar(config, { metodo: "POST", corpo: LEAD });
  assert.equal(r.statusCode, 201);
  assert.equal(gravados.length, 1);
  const g = gravados[0];
  assert.equal(g.nome, "Marcos Lima");
  assert.equal(g.barbearia, "Barbearia  b do /b  Marcos".replace(/\s+/g, " "), "sem < e >");
  assert.equal(g.whatsapp, "81988887777");
  assert.equal(g.barbeiros, "2-3");
  assert.equal(g.plano, "Barbearia");
  assert.match(g.origem, /^[0-9a-f]{32}$/, "origem é um hash");
  assert.ok(!JSON.stringify(g).includes("203.0.113.7"), "o IP não é gravado");
  // valores fora da lista viram vazio
  gravados.length = 0;
  await A.chamar(config, { metodo: "POST", corpo: { ...LEAD, barbeiros: "99", plano: "Grátis para sempre" } });
  assert.equal(gravados[0].barbeiros, "");
  assert.equal(gravados[0].plano, "");
});

test("interessado: valida os campos e ignora robôs (campo-isca)", async () => {
  const gravados = [];
  A.instalarFetch(rotasLead(gravados));
  for (const [mud, msg] of [[{ nome: "M" }, /nome/], [{ barbearia: "" }, /barbearia/], [{ whatsapp: "9999" }, /WhatsApp/], [{ whatsapp: "12345678901234" }, /WhatsApp/]]) {
    const r = await A.chamar(config, { metodo: "POST", corpo: { ...LEAD, ...mud } });
    assert.equal(r.statusCode, 400, JSON.stringify(mud));
    assert.match(r.body.message, msg);
  }
  const robo = await A.chamar(config, { metodo: "POST", corpo: { ...LEAD, website: "http://spam" } });
  assert.equal(robo.statusCode, 201, "robô não percebe que foi ignorado");
  assert.equal(gravados.length, 0, "nada foi gravado");
});

test("interessado: no máximo 5 contatos por origem por hora", async () => {
  const gravados = [];
  A.instalarFetch(rotasLead(gravados, 6));
  const r = await A.chamar(config, { metodo: "POST", corpo: LEAD });
  assert.equal(r.statusCode, 429);
  assert.equal(gravados.length, 0);
});

test("interessados: só a conta da plataforma vê e muda a situação", async () => {
  const mudancas = [];
  A.instalarFetch([
    ...A.rotasDeConta(),
    { metodo: "GET", padrao: /\/rest\/v1\/barbearias\?select=/, resposta: { corpo: [] } },
    { metodo: "GET", padrao: /\/rest\/v1\/profissionais\?ativo=eq\.true/, resposta: { corpo: [] } },
    { metodo: "GET", padrao: /\/rest\/v1\/leads\?/, resposta: { corpo: [{ id: UUIDS.pedido, nome: "Marcos", barbearia: "Barbearia do Marcos", whatsapp: "81988887777", status: "novo" }] } },
    { metodo: "PATCH", padrao: /\/rest\/v1\/leads\?id=eq\./, resposta: (url, op, corpo) => { mudancas.push({ url, corpo }); return { status: 204 }; } },
    { padrao: /\/rest\/v1\/barbearias\?id=eq\./, resposta: { corpo: [{ id: UUIDS.barbearia, slug: "gw", nome: "GW" }] } },
    { padrao: /\/rest\/v1\/profissionais\?perfil_user_id=eq\./, resposta: { corpo: [] } },
  ]);
  const admin = await A.chamar(eu, { metodo: "GET", token: "token-admin" });
  assert.equal(admin.statusCode, 200);
  assert.equal(admin.body.leads.length, 1);
  const dono = await A.chamar(eu, { metodo: "GET", token: "token-dono" });
  assert.ok(!("leads" in dono.body), "o dono de barbearia não vê os interessados");

  let r = await A.chamar(eu, { metodo: "POST", corpo: { acao: "lead-status", id: UUIDS.pedido, status: "contatado" }, token: "token-dono" });
  assert.equal(r.statusCode, 403);
  r = await A.chamar(eu, { metodo: "POST", corpo: { acao: "lead-status", id: UUIDS.pedido, status: "apagado" }, token: "token-admin" });
  assert.equal(r.statusCode, 400);
  r = await A.chamar(eu, { metodo: "POST", corpo: { acao: "lead-status", id: "x&id=not.is.null", status: "contatado" }, token: "token-admin" });
  assert.equal(r.statusCode, 400, "id inválido não vira filtro");
  r = await A.chamar(eu, { metodo: "POST", corpo: { acao: "lead-status", id: UUIDS.pedido, status: "contatado" }, token: "token-admin" });
  assert.equal(r.statusCode, 200);
  assert.equal(mudancas.length, 1);
  assert.equal(mudancas[0].corpo.status, "contatado");
});

test("página de vendas: oferta de lançamento clara, formulário e aviso de privacidade", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /tipo: "lead"/, "o formulário grava pelo servidor");
  assert.match(html, /id="privacidade"/, "tem aviso de privacidade");
  assert.match(html, /name="website"/, "tem campo-isca contra robôs");
  // Promoção com as condições à vista: preço de lançamento, preço normal, vagas, implantação e primeira cobrança
  for (const trecho of ["R$ 39,90", "R$ 89,90", "10 primeiras barbearias", "para sempre", "R$ 120", "60 dias depois"]) assert.ok(html.includes(trecho), trecho);
  assert.doesNotMatch(html, /14 dias grátis|data-ciclo/, "sem a oferta antiga");
  // Todo plano que a página envia é aceito pelo servidor
  const { PLANOS } = require("../api/config");
  for (const [, p] of html.matchAll(/data-plano="([^"]+)"/g)) assert.ok(PLANOS.includes(p), p);
});
