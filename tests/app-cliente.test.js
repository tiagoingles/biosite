// App da barbearia no celular do cliente (fase 23): ícone e manifesto no site, aparelho do cliente com os
// avisos ligados, confirmação de presença antes do horário, "Seu horário mudou" e "atrasar os próximos".
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const A = require("./ajuda");
const config = require("../api/config");
const pedido = require("../api/pedido");
const G = require("../lib/gerador");
const L = require("../lib/lembretes");
const presenca = require("../lib/presenca");

const { UUIDS } = A;
const b64u = (b) => Buffer.from(b).toString("base64url");
const ler = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const CLIENTE = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";

function ligarPush() {
  const vapid = crypto.createECDH("prime256v1");
  vapid.generateKeys();
  process.env.VAPID_PUBLIC_KEY = b64u(vapid.getPublicKey());
  process.env.VAPID_PRIVATE_KEY = b64u(vapid.getPrivateKey());
  const ua = crypto.createECDH("prime256v1");
  ua.generateKeys();
  return { endpoint: "https://fcm.googleapis.com/fcm/send/celular-do-cliente", p256dh: b64u(ua.getPublicKey()), auth_key: b64u(crypto.randomBytes(16)) };
}
function desligarPush() {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
}
async function as(instante, fn) {
  const real = Date.now;
  Date.now = () => Date.parse(instante);
  try { return await fn(); } finally { Date.now = real; }
}
const inscricaoDoNavegador = (i) => ({ endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth_key } });

// ---------- site: ícone, manifesto e o app ----------
test("site com ícones: manifesto, ícone do iPhone, faixa de instalar e avisos; sem ícones, nada disso", () => {
  const html = ler("barbearia-modelo.html");
  const cfg = JSON.parse(html.match(/<script type="application\/json" id="bio-config">([\s\S]*?)<\/script>/)[1]);
  assert.ok(cfg.icones && /^\/img\/barbearia-modelo\/icone-512-/.test(cfg.icones.i512), "o site publicado guarda os ícones");
  assert.match(html, /<link rel="manifest" href="\/barbearia-modelo\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/img\/barbearia-modelo\/icone-180-[a-z0-9]+\.png">/);
  assert.match(html, /window\.BioApp=/);
  assert.match(html, /id="appInstalar"/);
  for (const t of ["180", "192", "512"]) assert.ok(fs.existsSync(path.join(__dirname, "..", cfg.icones["i" + t])), "ícone " + t + " existe");
  const m = JSON.parse(ler("barbearia-modelo.webmanifest"));
  assert.equal(m.id, "/barbearia-modelo");
  assert.equal(m.start_url, "/barbearia-modelo?app=1");
  assert.equal(m.scope, "/barbearia-modelo");
  assert.equal(m.display, "standalone");
  assert.ok(m.icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512"));
  assert.ok(m.icons.some((i) => i.sizes === "192x192"));
  assert.equal(m.shortcuts[0].url, "/barbearia-modelo?agendar=1");
  assert.equal(JSON.stringify(m) + "\n", JSON.stringify(JSON.parse(G.manifestJSON(cfg))) + "\n", "manifesto igual ao do gerador");
  delete cfg.icones;
  const sem = G.bioHTML(cfg, (u) => u);
  assert.doesNotMatch(sem, /rel="manifest"/);
  assert.doesNotMatch(sem, /window\.BioApp=/);
});

test("nome curto do ícone: tira 'Barbearia' e preposições soltas, cabe em 12 letras", () => {
  assert.equal(G.nomeCurto("GW Barbearia"), "GW Barbearia");
  assert.equal(G.nomeCurto("Dom Manolo Barbearia"), "Dom Manolo");
  assert.equal(G.nomeCurto("Barbearia do Zé Carlos"), "Zé Carlos");
  assert.equal(G.nomeCurto("Barbearia Navalha de Ouro"), "Navalha");
});

test("Criador: publica o manifesto e os ícones, gerados a partir do logo", () => {
  const c = ler("criador.html");
  assert.match(c, /gerarIcones\(d,s\.logo/);
  assert.match(c, /\$\{slug\}\.webmanifest/);
  assert.match(ler("api/criador-gh.js"), /\.webmanifest\$\/\.exec\(p\)/);
});

test("service worker: botões de confirmação só com o link assinado; 'Confirmo' responde sem abrir o site", () => {
  const sw = ler("sw.js");
  assert.match(sw, /tipo: "presenca", token: dados\.token, resposta: "sim"/);
  assert.match(sw, /ACOES\[a\.action\] && token/);
  assert.match(sw, /r=nao/);
});

// ---------- aparelho do cliente ----------
function rotasInscricao(o = {}) {
  return [
    { padrao: /\/rest\/v1\/rpc\/contar_tentativa/, resposta: { corpo: 1 } },
    { padrao: /\/rest\/v1\/pedidos\?slug=eq\.gw-teste&codigo=eq\.ABCD/, resposta: { corpo: o.semPedido ? [] : [{ id: UUIDS.pedido, barbearia_id: UUIDS.barbearia, cliente_id: o.cliente === undefined ? CLIENTE : o.cliente }] } },
    { padrao: /\/rest\/v1\/barbearias\?slug=eq\.gw-teste/, resposta: { corpo: [{ id: UUIDS.barbearia }] } },
    { metodo: "POST", padrao: /\/rest\/v1\/push_clientes\?on_conflict/, resposta: { status: 201 } },
    { metodo: "POST", padrao: /\/rest\/v1\/clientes_push\?on_conflict=barbearia_id,endpoint/, resposta: { status: 201 } },
  ];
}

test("avisos do cliente: com o pedido recém-feito liga ao pedido e ao cadastro; o aceite das novidades vai junto", async () => {
  const i = ligarPush();
  desligarPush();
  const chamadas = A.instalarFetch(rotasInscricao());
  const r = await A.chamar(config, { metodo: "POST", corpo: { tipo: "lembrete-cliente", slug: "gw-teste", codigo: "abcd", app: true, novidades: true, subscription: inscricaoDoNavegador(i) } });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.equal(r.body.ligadoAoPedido, true);
  const doPedido = chamadas.find((c) => c.url.includes("push_clientes?on_conflict"));
  assert.equal(doPedido.corpo.pedido_id, UUIDS.pedido);
  const app = chamadas.find((c) => c.url.includes("clientes_push?on_conflict"));
  assert.equal(app.corpo.barbearia_id, UUIDS.barbearia);
  assert.equal(app.corpo.cliente_id, CLIENTE);
  assert.equal(app.corpo.novidades, true);
  assert.match(String(app.headers.Prefer || app.headers.prefer || ""), /merge-duplicates/);
});

test("avisos do cliente: pelo app, sem pedido, guarda o aparelho na barbearia (sem cadastro e sem novidades)", async () => {
  const i = ligarPush();
  desligarPush();
  const chamadas = A.instalarFetch(rotasInscricao());
  const r = await A.chamar(config, { metodo: "POST", corpo: { tipo: "lembrete-cliente", slug: "gw-teste", app: true, subscription: inscricaoDoNavegador(i) } });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  const app = chamadas.find((c) => c.url.includes("clientes_push?on_conflict"));
  assert.equal(app.corpo.cliente_id, undefined, "não mexe no cadastro ligado antes");
  assert.equal(app.corpo.novidades, undefined, "o aceite nunca é desligado sozinho");
  assert.ok(!chamadas.some((c) => c.url.includes("push_clientes?on_conflict")));
  // Sem pedido e sem app (página antiga sem código): recusa
  let x = await A.chamar(config, { metodo: "POST", corpo: { tipo: "lembrete-cliente", slug: "gw-teste", subscription: inscricaoDoNavegador(i) } });
  assert.equal(x.statusCode, 400);
  // Endereço de push que não é de um navegador: recusa
  x = await A.chamar(config, { metodo: "POST", corpo: { tipo: "lembrete-cliente", slug: "gw-teste", app: true, subscription: { endpoint: "https://evil.example/push", keys: { p256dh: i.p256dh, auth: i.auth_key } } } });
  assert.equal(x.statusCode, 400);
});

test("página antiga (v11, só o código): continua ligando o lembrete ao pedido", async () => {
  const i = ligarPush();
  desligarPush();
  const chamadas = A.instalarFetch(rotasInscricao());
  const r = await A.chamar(config, { metodo: "POST", corpo: { tipo: "lembrete-cliente", slug: "gw-teste", codigo: "ABCD", subscription: inscricaoDoNavegador(i) } });
  assert.equal(r.statusCode, 201);
  assert.ok(chamadas.some((c) => c.url.includes("push_clientes?on_conflict")));
  assert.ok(!chamadas.some((c) => c.url.includes("clientes_push?on_conflict")), "sem o aceite do app, não vira aparelho da barbearia");
});

// ---------- confirmação de presença ----------
test("link de confirmação: assinatura do servidor; mexer no link invalida", () => {
  const t = presenca.token(UUIDS.pedido);
  assert.equal(presenca.lerToken(t), UUIDS.pedido);
  assert.equal(presenca.lerToken(t.slice(0, -1) + (t.endsWith("A") ? "B" : "A")), null);
  assert.equal(presenca.lerToken(presenca.token(UUIDS.pedido).replace(UUIDS.pedido, UUIDS.estranho)), null, "não serve para outro pedido");
  assert.equal(presenca.lerToken("qualquer-coisa"), null);
});

function pedidoPresenca(extra) {
  return { id: UUIDS.pedido, barbearia_id: UUIDS.barbearia, profissional_id: UUIDS.bruno, slug: "gw-teste", servico: "Corte", profissional: "Bruno", dia: A.daquiA(1), horario: "15:00:00", status: "confirmado", cliente: "Ana", cliente_resposta: null, sinal_status: null, barbearias: { nome: "GW Teste", slug: "gw-teste" }, ...extra };
}
function rotasPresenca(o = {}) {
  return [
    { padrao: /\/rest\/v1\/rpc\/contar_tentativa/, resposta: { corpo: 1 } },
    { metodo: "GET", padrao: /\/rest\/v1\/pedidos\?id=eq\./, resposta: { corpo: [pedidoPresenca(o.pedido)] } },
    { metodo: "PATCH", padrao: /\/rest\/v1\/pedidos\?id=eq\./, resposta: (u, op, corpo) => ({ corpo: [{ ...pedidoPresenca(o.pedido), ...corpo }] }) },
    { padrao: /\/rest\/v1\/perfis\?barbearia_id=eq\./, resposta: { corpo: [{ user_id: UUIDS.donoUser, papel: "dono" }] } },
    { padrao: /\/rest\/v1\/profissionais\?id=eq\./, resposta: { corpo: [{ perfil_user_id: UUIDS.brunoUser }] } },
    { padrao: /\/rest\/v1\/push_inscricoes\?user_id=in\./, resposta: (url) => ({ corpo: o.inscricao ? [{ ...o.inscricao, user_id: UUIDS.donoUser }] : [] }) },
    { metodo: "POST", padrao: /^https:\/\/fcm\.googleapis\.com\//, resposta: { status: 201 } },
  ];
}

test("confirmação: o link mostra o horário (sem o nome do cliente) e 'Confirmo' grava a resposta", async () => {
  const chamadas = A.instalarFetch(rotasPresenca());
  const t = presenca.token(UUIDS.pedido);
  let r = await A.chamar(config, { query: { presenca: t } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.servico, "Corte");
  assert.equal(r.body.horario, "15:00");
  assert.equal(r.body.barbearia, "GW Teste");
  assert.equal(r.body.cliente, undefined, "o link pode ser repassado: nada de nome");
  r = await A.chamar(config, { query: { presenca: t.slice(0, -2) + "xx" } });
  assert.equal(r.statusCode, 404);
  r = await A.chamar(config, { metodo: "POST", corpo: { tipo: "presenca", token: t, resposta: "sim" } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const patch = chamadas.find((c) => c.metodo === "PATCH");
  assert.equal(patch.corpo.cliente_resposta, "sim");
  assert.equal(patch.corpo.status, undefined, "confirmar não muda a situação");
  assert.match(patch.url, /status=in\.\(pendente,confirmado,avulso\)/);
});

test("confirmação: 'Não vou poder ir' cancela, libera o horário e avisa o dono e o barbeiro", async () => {
  const inscricao = ligarPush();
  try {
    const chamadas = A.instalarFetch(rotasPresenca({ inscricao, pedido: { sinal_status: "pago" } }));
    const r = await A.chamar(config, { metodo: "POST", corpo: { tipo: "presenca", token: presenca.token(UUIDS.pedido), resposta: "nao" } });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, "cancelado");
    const patch = chamadas.find((c) => c.metodo === "PATCH");
    assert.deepEqual([patch.corpo.status, patch.corpo.cliente_resposta], ["cancelado", "nao"]);
    await new Promise((ok) => setTimeout(ok, 30));
    const busca = chamadas.find((c) => c.url.includes("push_inscricoes?user_id=in."));
    assert.ok(busca && busca.url.includes(UUIDS.donoUser) && busca.url.includes(UUIDS.brunoUser), "dono e barbeiro");
    assert.ok(chamadas.some((c) => c.url.startsWith("https://fcm.googleapis.com/")), "aviso saiu");
  } finally {
    desligarPush();
  }
});

test("confirmação: horário que já passou, cancelado ou resposta inválida não muda nada", async () => {
  const t = presenca.token(UUIDS.pedido);
  let chamadas = A.instalarFetch(rotasPresenca({ pedido: { dia: A.daquiA(-1) } }));
  let r = await A.chamar(config, { metodo: "POST", corpo: { tipo: "presenca", token: t, resposta: "sim" } });
  assert.equal(r.statusCode, 410);
  chamadas = A.instalarFetch(rotasPresenca({ pedido: { status: "cancelado" } }));
  r = await A.chamar(config, { metodo: "POST", corpo: { tipo: "presenca", token: t, resposta: "sim" } });
  assert.equal(r.statusCode, 409);
  r = await A.chamar(config, { metodo: "POST", corpo: { tipo: "presenca", token: t, resposta: "talvez" } });
  assert.equal(r.statusCode, 400);
  assert.ok(!chamadas.some((c) => c.metodo === "PATCH"));
});

test("janela da confirmação: X minutos antes, só entre 7h e 22h, só confirmado e sem resposta; 24 h alcança amanhã", () => {
  const p = (horario, extra) => ({ horario, status: "confirmado", chegou_em: null, cliente_resposta: null, ...extra });
  assert.ok(L.avisosDe(p("12:00"), 10 * 60 + 30, { confirmarMin: 120 }).tipos.includes("confirmar"));
  assert.ok(!L.avisosDe(p("12:00"), 9 * 60, { confirmarMin: 120 }).tipos.includes("confirmar"), "ainda é cedo");
  assert.ok(!L.avisosDe(p("08:00"), 6 * 60 + 30, { confirmarMin: 120 }).tipos.includes("confirmar"), "antes das 7h, não");
  assert.ok(L.avisosDe(p("08:00"), 7 * 60, { confirmarMin: 120 }).tipos.includes("confirmar"), "às 7h sai");
  assert.ok(!L.avisosDe(p("12:00", { cliente_resposta: "sim" }), 11 * 60, { confirmarMin: 120 }).tipos.includes("confirmar"));
  assert.ok(!L.avisosDe(p("12:00", { status: "pendente" }), 11 * 60, { confirmarMin: 120 }).tipos.includes("confirmar"), "pendente ainda não foi aceito pela barbearia");
  assert.ok(!L.avisosDe(p("12:00"), 11 * 60 + 50, { confirmarMin: 120 }).tipos.includes("confirmar"), "em cima da hora (menos de 20 min), não");
  assert.ok(!L.avisosDe(p("12:00"), 11 * 60, {}).tipos.includes("confirmar"), "barbearia que não pede");
  assert.deepEqual(L.avisosDe(p("09:00"), 10 * 60, { amanha: true, confirmarMin: 1440 }).tipos, ["confirmar"]);
  assert.deepEqual(L.avisosDe(p("09:00"), 10 * 60, { amanha: true, confirmarMin: 120 }).tipos, [], "amanhã só com o de 24 horas");
});

test("relógio: pedido de confirmação vai para o celular do cliente (pelo cadastro), com os botões e o link assinado", async () => {
  const inscricao = ligarPush();
  try {
    const reservados = new Set();
    const pedidoHoje = { id: UUIDS.pedido, barbearia_id: UUIDS.barbearia, slug: "gw-teste", profissional_id: UUIDS.bruno, profissional: "Bruno", servico: "Corte", dia: "2026-11-17", horario: "12:00:00", cliente: "Ana", cliente_id: CLIENTE, chegou_em: null, status: "confirmado", cliente_resposta: null };
    const chamadas = A.instalarFetch([
      { padrao: /\/rest\/v1\/rpc\/contar_tentativa/, resposta: { corpo: 1 } },
      { padrao: /\/rest\/v1\/rpc\/expirar|sinal_status=eq\.aguardando/, resposta: { corpo: [] } },
      { padrao: /\/rest\/v1\/pedidos\?dia=eq\.2026-11-17/, resposta: { corpo: [pedidoHoje] } },
      { padrao: /\/rest\/v1\/pedidos\?dia=eq\.2026-11-18/, resposta: { corpo: [] } },
      { padrao: /\/rest\/v1\/barbearias\?id=in\./, resposta: { corpo: [{ id: UUIDS.barbearia, pedir_confirmacao_min: 120 }] } },
      { padrao: /\/rest\/v1\/profissionais\?id=in\./, resposta: { corpo: [{ id: UUIDS.bruno, perfil_user_id: UUIDS.brunoUser, barbearia_id: UUIDS.barbearia }] } },
      { metodo: "POST", padrao: /\/rest\/v1\/avisos_pedido\?on_conflict=pedido_id,tipo/, resposta: (u, op, corpo) => { const k = corpo.pedido_id + corpo.tipo; if (reservados.has(k)) return { status: 201, corpo: [] }; reservados.add(k); return { status: 201, corpo: [corpo] }; } },
      { padrao: /\/rest\/v1\/push_clientes\?pedido_id=eq\./, resposta: { corpo: [] } },
      { padrao: /\/rest\/v1\/clientes_push\?cliente_id=eq\./, resposta: { corpo: [{ id: "x", endpoint: inscricao.endpoint, p256dh: inscricao.p256dh, auth_key: inscricao.auth_key }] } },
      { padrao: /gw-teste\.webmanifest/, resposta: { corpo: { icons: [{ src: "/img/gw-teste/icone-192-abc.png" }] } } },
      { metodo: "POST", padrao: /^https:\/\/fcm\.googleapis\.com\//, resposta: { status: 201 } },
      ...A.rotasDeConta(),
    ]);
    // 13:30 UTC = 10:30 em Brasília: falta 1h30 para as 12:00 (a barbearia pede 2 h antes)
    const r = await as("2026-11-17T13:30:00Z", () => A.chamar(config, { query: { lembretes: "proximos" } }));
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.deepEqual([...reservados].map((k) => k.slice(36)), ["confirmar"]);
    assert.equal(chamadas.filter((c) => c.url.startsWith("https://fcm.googleapis.com/")).length, 1);
    assert.ok(chamadas.some((c) => c.url.includes(`clientes_push?cliente_id=eq.${CLIENTE}&barbearia_id=eq.${UUIDS.barbearia}`)), "só aparelhos desta barbearia");
    const aviso = L.avisoDeConfirmacao(pedidoHoje, "hoje");
    assert.equal(aviso.title, "Confirme seu horário");
    assert.match(aviso.body, /^Corte hoje às 12:00 com Bruno/);
    assert.deepEqual(aviso.acoes.map((a) => a.action), ["sim", "nao"]);
    assert.equal(presenca.lerToken(aviso.token), UUIDS.pedido);
    assert.equal(aviso.url, "/gw-teste?confirmar=" + aviso.token);
  } finally {
    desligarPush();
  }
});

// ---------- horário mudou e atrasar os próximos ----------
function pedidoPainel(extra) {
  return { id: UUIDS.pedido, codigo: "ABCD", slug: "gw-teste", barbearia_id: UUIDS.barbearia, servico: "Corte", profissional: "Bruno", profissional_id: UUIDS.bruno, dia: A.daquiA(1), horario: "10:00", duracao_min: 30, cliente: "Ana", cliente_id: CLIENTE, status: "confirmado", cliente_resposta: "sim", valor: 40, simulado: false, ...extra };
}

test("remarcar com 'avisar o cliente': manda 'Seu horário mudou', zera a confirmação e libera os avisos perto da hora", async () => {
  const inscricao = ligarPush();
  try {
    const chamadas = A.instalarFetch([
      ...A.rotasDeConta(),
      { metodo: "GET", padrao: /\/rest\/v1\/pedidos\?id=eq\./, resposta: { corpo: [pedidoPainel()] } },
      { metodo: "PATCH", padrao: /\/rest\/v1\/pedidos\?id=eq\./, resposta: { status: 204 } },
      { padrao: /\/rest\/v1\/rpc\/remarcar_pedido/, resposta: (u, o, c) => ({ corpo: { pedido: { ...pedidoPainel(), ...c.p, horario: c.p.horario + ":00" } } }) },
      { metodo: "DELETE", padrao: /\/rest\/v1\/avisos_pedido\?pedido_id=eq\./, resposta: { status: 204 } },
      { padrao: /\/rest\/v1\/push_clientes\?pedido_id=eq\./, resposta: { corpo: [] } },
      { padrao: /\/rest\/v1\/clientes_push\?cliente_id=eq\./, resposta: { corpo: [{ id: "x", endpoint: inscricao.endpoint, p256dh: inscricao.p256dh, auth_key: inscricao.auth_key }] } },
      { metodo: "POST", padrao: /^https:\/\/fcm\.googleapis\.com\//, resposta: { status: 201 } },
    ]);
    const r = await A.chamar(pedido, { metodo: "POST", corpo: { acao: "remarcar", id: UUIDS.pedido, dia: A.daquiA(1), horario: "10:15", avisar: true }, token: "token-dono" });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.equal(r.body.avisados, 1);
    const zera = chamadas.find((c) => c.metodo === "PATCH");
    assert.deepEqual([zera.corpo.cliente_resposta, zera.corpo.cliente_respondeu_em], [null, null]);
    assert.ok(chamadas.some((c) => c.metodo === "DELETE" && c.url.includes("tipo=in.(chega,cliente30,atraso,cliente_atraso,confirmar)")));
    // Sem "avisar": remarca, mas nenhum aviso sai para o cliente
    const antes = chamadas.filter((c) => c.url.startsWith("https://fcm")).length;
    const x = await A.chamar(pedido, { metodo: "POST", corpo: { acao: "remarcar", id: UUIDS.pedido, dia: A.daquiA(1), horario: "10:30" }, token: "token-dono" });
    assert.equal(x.statusCode, 200);
    assert.equal(x.body.avisados, 0);
    assert.equal(chamadas.filter((c) => c.url.startsWith("https://fcm")).length, antes);
  } finally {
    desligarPush();
  }
});

test("atrasar os próximos: empurra do último para o primeiro; quem não cabe fica e volta na lista", async () => {
  const dia = A.daquiA(1);
  const lista = [
    pedidoPainel({ id: "d3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3", horario: "15:00:00", cliente: "Caio", cliente_resposta: null }),
    pedidoPainel({ id: "e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4", horario: "14:30:00", cliente: "Duda", cliente_resposta: null }),
    pedidoPainel({ id: "f5f5f5f5-f5f5-4f5f-8f5f-f5f5f5f5f5f5", horario: "14:00:00", cliente: "Eli", cliente_resposta: null }),
  ];
  const ordem = [];
  const chamadas = A.instalarFetch([
    ...A.rotasDeConta(),
    { padrao: /\/rest\/v1\/profissionais\?id=eq\./, resposta: { corpo: [{ id: UUIDS.bruno, nome: "Bruno" }] } },
    { metodo: "GET", padrao: /\/rest\/v1\/pedidos\?barbearia_id=eq\.[^&]+&profissional_id=eq\./, resposta: { corpo: lista } },
    { padrao: /\/rest\/v1\/rpc\/remarcar_pedido/, resposta: (u, o, c) => { ordem.push(c.p.horario); return c.p.horario === "14:15" ? { corpo: { erro: "conflito", horario: "14:15" } } : { corpo: { pedido: { ...c.p } } }; } },
    { metodo: "DELETE", padrao: /\/rest\/v1\/avisos_pedido/, resposta: { status: 204 } },
  ]);
  const r = await A.chamar(pedido, { metodo: "POST", corpo: { acao: "atrasar", profissionalId: UUIDS.bruno, dia, minutos: 15 }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(ordem, ["15:15", "14:45", "14:15"], "do último para o primeiro");
  assert.equal(r.body.movidos, 2);
  assert.deepEqual(r.body.falhas.map((f) => f.cliente), ["Eli"]);
  assert.match(r.body.falhas[0].motivo, /conflito/);
  assert.ok(chamadas.some((c) => c.url.includes(`profissional_id=eq.${UUIDS.bruno}&dia=eq.${dia}`)));
  // Minutos fora da lista: recusa
  const x = await A.chamar(pedido, { metodo: "POST", corpo: { acao: "atrasar", profissionalId: UUIDS.bruno, dia, minutos: 7 }, token: "token-dono" });
  assert.equal(x.statusCode, 400);
});

test("atrasar: o barbeiro só empurra a própria agenda", async () => {
  const chamadas = A.instalarFetch([
    ...A.rotasDeConta(),
    { padrao: /\/rest\/v1\/profissionais\?id=eq\./, resposta: { corpo: [{ id: UUIDS.bruno, nome: "Bruno" }] } },
    { metodo: "GET", padrao: /\/rest\/v1\/pedidos\?barbearia_id=eq\./, resposta: { corpo: [] } },
  ]);
  const r = await A.chamar(pedido, { metodo: "POST", corpo: { acao: "atrasar", profissionalId: UUIDS.rafael, dia: A.daquiA(1), minutos: 10 }, token: "token-bruno" });
  assert.equal(r.statusCode, 200);
  assert.ok(chamadas.some((c) => c.url.includes(`profissional_id=eq.${UUIDS.bruno}`)), "usa o barbeiro logado, não o pedido");
  assert.ok(!chamadas.some((c) => c.url.includes(`profissional_id=eq.${UUIDS.rafael}`)));
});
