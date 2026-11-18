// Gestão de atrasos (fase 21): avisos perto da hora (cliente chegando, atrasado), "Chegou" no atendimento
// e o lembrete no celular do cliente que pediu pelo site.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const A = require("./ajuda");
const config = require("../api/config");
const pedido = require("../api/pedido");
const L = require("../lib/lembretes");

const { UUIDS } = A;
const b64u = (b) => Buffer.from(b).toString("base64url");
const ler = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

function ligarPush() {
  const vapid = crypto.createECDH("prime256v1");
  vapid.generateKeys();
  process.env.VAPID_PUBLIC_KEY = b64u(vapid.getPublicKey());
  process.env.VAPID_PRIVATE_KEY = b64u(vapid.getPrivateKey());
  const ua = crypto.createECDH("prime256v1");
  ua.generateKeys();
  return { endpoint: "https://fcm.googleapis.com/fcm/send/aparelho", p256dh: b64u(ua.getPublicKey()), auth_key: b64u(crypto.randomBytes(16)) };
}
function desligarPush() {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
}
// Relógio parado num instante (UTC); 13:00 UTC = 10:00 em Brasília
async function as(instante, fn) {
  const real = Date.now;
  Date.now = () => Date.parse(instante);
  try { return await fn(); } finally { Date.now = real; }
}

test("janelas: chegando (5 a 15 min antes), lembrete do cliente (20 a 30 min), atrasado (10 a 20 min depois, sem Chegou)", () => {
  const p = (horario, extra) => ({ horario, status: "confirmado", chegou_em: null, ...extra });
  const agora = 10 * 60; // 10:00
  assert.deepEqual(L.avisosDe(p("10:12"), agora).tipos, ["chega"]);
  assert.deepEqual(L.avisosDe(p("10:25"), agora).tipos, ["cliente30"]);
  assert.deepEqual(L.avisosDe(p("09:48"), agora).tipos, ["atraso", "cliente_atraso"]);
  assert.deepEqual(L.avisosDe(p("09:48", { chegou_em: "2026-11-17T12:50:00Z" }), agora).tipos, [], "já chegou: sem aviso de atraso");
  assert.deepEqual(L.avisosDe(p("09:48", { status: "avulso" }), agora).tipos, [], "encaixe é quem já está na cadeira");
  assert.deepEqual(L.avisosDe(p("10:40"), agora).tipos, []);
  assert.deepEqual(L.avisosDe(p("09:30"), agora).tipos, [], "atraso grande demais não avisa de novo");
});

function rotas(o = {}) {
  const reservados = o.reservados || new Set();
  const inscricao = o.inscricao;
  return [
    { padrao: /\/rest\/v1\/rpc\/contar_tentativa/, resposta: { corpo: o.tentativas || 1 } },
    { padrao: /\/rest\/v1\/pedidos\?dia=eq\./, resposta: { corpo: [
      { id: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1", barbearia_id: UUIDS.barbearia, slug: "gw-teste", profissional_id: UUIDS.bruno, servico: "Corte", horario: "10:12:00", cliente: "Ana", chegou_em: null, status: "confirmado" },
      { id: "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2", barbearia_id: UUIDS.barbearia, slug: "gw-teste", profissional_id: UUIDS.rafael, servico: "Barba", horario: "09:48:00", cliente: "Caio", chegou_em: null, status: "confirmado" },
    ] } },
    { padrao: /\/rest\/v1\/profissionais\?id=in\./, resposta: { corpo: [{ id: UUIDS.bruno, perfil_user_id: UUIDS.brunoUser, barbearia_id: UUIDS.barbearia }, { id: UUIDS.rafael, perfil_user_id: null, barbearia_id: UUIDS.barbearia }] } },
    { padrao: /\/rest\/v1\/perfis\?barbearia_id=eq\./, resposta: { corpo: [{ user_id: UUIDS.donoUser, papel: "dono" }] } },
    { metodo: "POST", padrao: /\/rest\/v1\/avisos_pedido\?on_conflict=pedido_id,tipo/, resposta: (u, op, corpo) => { const k = corpo.pedido_id + corpo.tipo; if (reservados.has(k)) return { status: 201, corpo: [] }; reservados.add(k); return { status: 201, corpo: [corpo] }; } },
    { padrao: /\/rest\/v1\/push_inscricoes\?user_id=in\./, resposta: (url) => ({ corpo: inscricao ? [{ ...inscricao, user_id: url.includes(UUIDS.brunoUser) ? UUIDS.brunoUser : UUIDS.donoUser }] : [] }) },
    { padrao: /\/rest\/v1\/push_clientes\?pedido_id=eq\./, resposta: { corpo: inscricao ? [{ endpoint: inscricao.endpoint, p256dh: inscricao.p256dh, auth_key: inscricao.auth_key }] : [] } },
    { metodo: "POST", padrao: /^https:\/\/fcm\.googleapis\.com\//, resposta: { status: 201 } },
    ...A.rotasDeConta(),
  ];
}

test("relógio dos avisos: barbeiro com login recebe 'chegando'; sem login, o dono recebe 'atrasado'; o cliente também", async () => {
  const inscricao = ligarPush();
  try {
    const reservados = new Set();
    const chamadas = A.instalarFetch(rotas({ inscricao, reservados }));
    const r = await as("2026-11-17T13:00:00Z", () => A.chamar(config, { query: { lembretes: "proximos" } }));
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    const pushes = chamadas.filter((c) => c.url.startsWith("https://fcm.googleapis.com/"));
    assert.equal(pushes.length, 3, "chegando (Bruno), atrasado (dono, pelo Rafael sem login) e 'estamos te esperando' (cliente)");
    assert.deepEqual([...reservados].map((k) => k.slice(36)).sort(), ["atraso", "chega", "cliente_atraso"]);
    // De novo no mesmo minuto: nada sai duas vezes
    const de = chamadas.length;
    await as("2026-11-17T13:00:00Z", () => A.chamar(config, { query: { lembretes: "proximos" } }));
    assert.equal(chamadas.slice(de).filter((c) => c.url.startsWith("https://fcm.googleapis.com/")).length, 0);
  } finally {
    desligarPush();
  }
});

test("relógio dos avisos: sem Web Push não procura os atendimentos do dia (só expira sinal vencido); chamadas demais são barradas", async () => {
  let chamadas = A.instalarFetch([{ padrao: /\/rest\/v1\/pedidos\?sinal_status=eq\.aguardando/, resposta: { corpo: [] } }, ...rotas()]);
  let r = await A.chamar(config, { query: { lembretes: "proximos" } });
  assert.equal(r.statusCode, 200);
  assert.ok(!chamadas.some((c) => c.url.includes("/rest/v1/pedidos?dia=eq.")), "sem push, nem lista os atendimentos");
  assert.ok(chamadas.some((c) => c.url.includes("sinal_status=eq.aguardando")), "o sinal vencido expira mesmo sem push");
  chamadas = A.instalarFetch(rotas({ tentativas: 7 }));
  r = await A.chamar(config, { query: { lembretes: "proximos" } });
  assert.equal(r.statusCode, 429);
});

test("lembrete do cliente: liga só para o pedido que acabou de ser feito e com assinatura de um serviço de push", async () => {
  const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } };
  const chamadas = A.instalarFetch([
    { padrao: /\/rest\/v1\/rpc\/contar_tentativa/, resposta: { corpo: 1 } },
    { metodo: "GET", padrao: /\/rest\/v1\/pedidos\?slug=eq\./, resposta: (url) => ({ corpo: url.includes("codigo=eq.AB23") ? [{ id: UUIDS.pedido }] : [] }) },
    { metodo: "POST", padrao: /\/rest\/v1\/push_clientes/, resposta: { status: 201 } },
  ]);
  let r = await A.chamar(config, { metodo: "POST", corpo: { tipo: "lembrete-cliente", slug: "gw-teste", codigo: "ab23", subscription: sub } });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  const busca = chamadas.find((c) => c.url.includes("/rest/v1/pedidos?slug=eq."));
  assert.match(busca.url, /criado_em=gte\./, "só logo depois do pedido");
  assert.equal(chamadas.find((c) => c.url.includes("push_clientes")).corpo.pedido_id, UUIDS.pedido);
  r = await A.chamar(config, { metodo: "POST", corpo: { tipo: "lembrete-cliente", slug: "gw-teste", codigo: "ZZ99", subscription: sub } });
  assert.equal(r.statusCode, 404);
  r = await A.chamar(config, { metodo: "POST", corpo: { tipo: "lembrete-cliente", slug: "gw-teste", codigo: "AB23", subscription: { ...sub, endpoint: "https://malicioso.exemplo/push" } } });
  assert.equal(r.statusCode, 400);
});

test("Chegou: o barbeiro marca a chegada do atendimento de hoje dele; outro dia ou de outro barbeiro, não", async () => {
  const hoje = A.hoje();
  const chamadas = A.instalarFetch([
    { metodo: "GET", padrao: /\/rest\/v1\/pedidos\?id=eq\./, resposta: (url) => ({ corpo: url.includes(UUIDS.pedido) ? [{ id: UUIDS.pedido, status: "confirmado", profissional_id: UUIDS.bruno, dia: hoje }] : url.includes("c3c3") ? [{ id: "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3", status: "confirmado", profissional_id: UUIDS.bruno, dia: A.daquiA(1) }] : [{ id: UUIDS.estranho, status: "confirmado", profissional_id: UUIDS.rafael, dia: hoje }] }) },
    { metodo: "PATCH", padrao: /\/rest\/v1\/pedidos\?id=eq\./, resposta: (u, op, corpo) => ({ corpo: [{ id: UUIDS.pedido, ...corpo }] }) },
    ...A.rotasDeConta(),
  ]);
  let r = await A.chamar(pedido, { metodo: "POST", token: "token-bruno", corpo: { acao: "chegou", id: UUIDS.pedido } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.ok(chamadas.find((c) => c.metodo === "PATCH").corpo.chegou_em);
  r = await A.chamar(pedido, { metodo: "POST", token: "token-bruno", corpo: { acao: "chegou", id: "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3" } });
  assert.equal(r.statusCode, 409, "só no dia do atendimento");
  r = await A.chamar(pedido, { metodo: "POST", token: "token-bruno", corpo: { acao: "chegou", id: UUIDS.estranho } });
  assert.equal(r.statusCode, 403, "atendimento de outro barbeiro");
});

test("telas: Chegou e Avisar atraso no atendimento de hoje; lembrete no celular no site; o banco chama a cada 5 min", () => {
  const ag = ler("painel-agenda.js");
  assert.match(ag, /"Chegou"/);
  assert.match(ag, /"Avisar atraso"/);
  assert.match(ag, /acao: "chegou"/);
  const site = ler("gw-barbearia.html");
  assert.match(site, /data-ag="lembrete"/);
  assert.match(site, /tipo:"lembrete-cliente"/);
  assert.match(site, /register\("\/sw\.js"\)/);
  assert.match(ler("supabase/fase21-atrasos.sql"), /'\*\/5 \* \* \* \*'/);
  assert.match(ler("lib/pedidos-painel.js"), /chegou_em/);
});
