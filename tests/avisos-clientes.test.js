// Avisos do dono para um cliente e para grupos (fase 23) e a navegação nova dos painéis (5 abas, Mais em
// ícones com telas próprias e atalhos na tela Hoje).
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const A = require("./ajuda");
const equipe = require("../api/equipe");
const { personalizar } = require("../lib/avisos-clientes");

const { UUIDS } = A;
const b64u = (b) => Buffer.from(b).toString("base64url");
const ler = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const ANA = "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0";
const CAIO = "b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0";

function ligarPush() {
  const vapid = crypto.createECDH("prime256v1");
  vapid.generateKeys();
  process.env.VAPID_PUBLIC_KEY = b64u(vapid.getPublicKey());
  process.env.VAPID_PRIVATE_KEY = b64u(vapid.getPrivateKey());
  const ua = crypto.createECDH("prime256v1");
  ua.generateKeys();
  return { endpoint: "https://fcm.googleapis.com/fcm/send/cliente", p256dh: b64u(ua.getPublicKey()), auth_key: b64u(crypto.randomBytes(16)) };
}
function desligarPush() {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
}

function rotasAvisos(o = {}) {
  const i = o.inscricao;
  const aparelho = (id, cliente) => ({ id, endpoint: i.endpoint + "-" + id, p256dh: i.p256dh, auth_key: i.auth_key, cliente_id: cliente, novidades: true });
  return [
    ...A.rotasDeConta(),
    { padrao: /\/rest\/v1\/barbearias\?id=eq\.[^&]+&select=slug,nome/, resposta: { corpo: [{ slug: "gw-teste", nome: "GW Teste" }] } },
    { metodo: "GET", padrao: /\/rest\/v1\/avisos_clientes\?barbearia_id=eq\./, resposta: { corpo: o.jaHoje || [] } },
    { metodo: "POST", padrao: /\/rest\/v1\/avisos_clientes$/, resposta: { status: 201 } },
    { padrao: /\/rest\/v1\/clientes\?id=eq\./, resposta: (url) => ({ corpo: url.includes(ANA) ? [{ id: ANA, nome: "Ana Souza" }] : [] }) },
    { padrao: /\/rest\/v1\/clientes\?barbearia_id=eq\./, resposta: { corpo: [
      { id: ANA, nome: "Ana Souza", telefone: "81999990001", aceita_novidades: true, saiu_em: null, origem: "site", criado_em: "2025-01-01T00:00:00Z" },
      { id: CAIO, nome: "Caio Lima", telefone: "81999990002", aceita_novidades: true, saiu_em: null, origem: "site", criado_em: "2025-01-01T00:00:00Z" },
    ] } },
    // Ana veio há 200 dias (sumida); Caio, há 10 (em dia)
    { padrao: /\/rest\/v1\/pedidos\?barbearia_id=eq\.[^&]+&cliente_id=not\.is\.null/, resposta: { corpo: [
      { cliente_id: ANA, dia: A.daquiA(-200), status: "realizado", valor: 40, profissional_id: UUIDS.bruno },
      { cliente_id: CAIO, dia: A.daquiA(-10), status: "realizado", valor: 40, profissional_id: UUIDS.bruno },
    ] } },
    { padrao: /\/rest\/v1\/profissionais\?barbearia_id=eq\./, resposta: { corpo: [{ id: UUIDS.bruno, nome: "Bruno" }] } },
    { padrao: /\/rest\/v1\/clientes_push\?barbearia_id=eq\.[^&]+&select=cliente_id,novidades/, resposta: { corpo: [{ cliente_id: ANA, novidades: true }, { cliente_id: CAIO, novidades: true }, { cliente_id: null, novidades: true }] } },
    { padrao: /\/rest\/v1\/clientes_push\?barbearia_id=eq\.[^&]+&novidades=eq\.true/, resposta: { corpo: [aparelho("p1", ANA), aparelho("p2", CAIO), aparelho("p3", null)] } },
    { padrao: /\/rest\/v1\/clientes_push\?barbearia_id=eq\.[^&]+&cliente_id=eq\./, resposta: (url) => ({ corpo: url.includes(ANA) ? [aparelho("p1", ANA)] : [] }) },
    { metodo: "POST", padrao: /^https:\/\/fcm\.googleapis\.com\//, resposta: { status: 201 } },
  ];
}
const pushesDe = (chamadas) => chamadas.filter((c) => c.url.startsWith("https://fcm.googleapis.com/"));
const aviso = (corpo, token = "token-dono") => A.chamar(equipe, { metodo: "POST", query: { area: "clientes" }, token, corpo: { acao: "aviso", ...corpo } });

test("carteira: mostra quem tem o app (aparelho com os avisos ligados)", async () => {
  const inscricao = ligarPush();
  desligarPush();
  A.instalarFetch(rotasAvisos({ inscricao }));
  const r = await A.chamar(equipe, { query: { area: "clientes" }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const ana = r.body.clientes.find((c) => c.id === ANA);
  assert.equal(ana.app, true);
  assert.equal(ana.appNovidades, true);
  assert.equal(r.body.kpis.comApp, 2);
  assert.equal(r.body.kpis.appSemCadastro, 1);
  assert.ok(ana.segmentos.includes("sumidos"));
});

test("aviso para um cliente: vai para o celular dele, com o título da barbearia; no máximo 3 por dia", async () => {
  const inscricao = ligarPush();
  try {
    const chamadas = A.instalarFetch(rotasAvisos({ inscricao }));
    const r = await aviso({ clienteId: ANA, mensagem: "Olá, {nome}! Abriu um horário amanhã às 10h." });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.aparelhos, r.body.entregues], [1, 1]);
    assert.equal(pushesDe(chamadas).length, 1);
    const hist = chamadas.find((c) => c.metodo === "POST" && /avisos_clientes$/.test(c.url));
    assert.equal(hist.corpo.cliente_id, ANA);
    assert.equal(hist.corpo.segmento, null);
    A.instalarFetch(rotasAvisos({ inscricao, jaHoje: [{ id: 1 }, { id: 2 }, { id: 3 }] }));
    const x = await aviso({ clienteId: ANA, mensagem: "Outro aviso" });
    assert.equal(x.statusCode, 429);
  } finally {
    desligarPush();
  }
});

test("aviso para os Sumidos: só os clientes do grupo com o aceite; 'todos' inclui o app sem cadastro; 2 por dia", async () => {
  const inscricao = ligarPush();
  try {
    let chamadas = A.instalarFetch(rotasAvisos({ inscricao }));
    let r = await aviso({ segmento: "sumidos", mensagem: "Olá, {nome}! Sentimos sua falta." });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.equal(r.body.aparelhos, 1, "só a Ana está sumida");
    assert.ok(pushesDe(chamadas)[0].url.endsWith("-p1"));
    chamadas = A.instalarFetch(rotasAvisos({ inscricao }));
    r = await aviso({ segmento: "todos", mensagem: "Olá, {nome}! Promoção de terça." });
    assert.equal(r.body.aparelhos, 3);
    assert.equal(pushesDe(chamadas).length, 3);
    A.instalarFetch(rotasAvisos({ inscricao, jaHoje: [{ id: 1 }, { id: 2 }] }));
    r = await aviso({ segmento: "sumidos", mensagem: "De novo" });
    assert.equal(r.statusCode, 429);
  } finally {
    desligarPush();
  }
});

test("aviso: só o dono manda; mensagem vazia ou grupo inventado é recusado; {nome} sem nome não deixa vírgula solta", async () => {
  const inscricao = ligarPush();
  desligarPush();
  A.instalarFetch(rotasAvisos({ inscricao }));
  let r = await aviso({ segmento: "todos", mensagem: "Oi" }, "token-bruno");
  assert.equal(r.statusCode, 403);
  r = await aviso({ segmento: "todos", mensagem: " " });
  assert.equal(r.statusCode, 400);
  r = await aviso({ segmento: "vips", mensagem: "Olá!" });
  assert.equal(r.statusCode, 400);
  assert.equal(personalizar("Olá, {nome}! Sentimos sua falta.", ""), "Olá! Sentimos sua falta.");
  assert.equal(personalizar("Olá, {nome}! Sentimos sua falta.", "Ana"), "Olá, Ana! Sentimos sua falta.");
});

test("painel do dono: 5 abas, Mais em ícones com telas próprias e atalhos na tela Hoje", () => {
  const dono = ler("painel-dono.html");
  const abas = [...dono.matchAll(/<a href="#(\w+)" data-aba="\1"/g)].map((m) => m[1]);
  assert.deepEqual(abas, ["hoje", "agenda", "clientes", "protese", "mais"]);
  for (const t of ["equipe", "clube", "ajuste-agendamento", "ajuste-sinal", "ajuste-protese", "ajuste-avisos", "ajuste-assinatura", "ajuste-saude"]) {
    assert.match(dono, new RegExp('data-tela="' + t + '" data-pai="mais"'), t + " abre pelo Mais");
  }
  assert.match(dono, /id="atalhos"/);
  assert.match(dono, /function montarMais\(\)/);
  assert.match(dono, /P\.atalho\("mais_um", "Encaixe"/);
  const comum = ler("painel-comum.js");
  assert.match(comum, /P\.subtopos = function/);
  assert.match(comum, /tela\.dataset\.pai/);
  const barbeiro = ler("painel-barbeiro.html");
  assert.match(barbeiro, /id="maisGrade"/);
  assert.match(barbeiro, /data-tela="ganhos" data-pai="mais"/);
  assert.match(barbeiro, /id="atalhos"/);
  const clientes = require("./ajuda").lerAbaClientes();
  assert.match(clientes, /function avisoNoCelular\(alvo\)/);
  assert.match(clientes, /filtrar: filtrar/);
});
