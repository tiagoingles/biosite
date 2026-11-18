// Aceite do cliente quando a barbearia muda o horário (fase 24): o pedido guarda o horário de antes, o painel recebe
// o link "Aceito o novo horário" / "Não posso" para a mensagem do WhatsApp, a resposta avisa o dono e o barbeiro,
// e o WhatsApp passa a ser obrigatório no agendamento do site.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const A = require("./ajuda");
const pedido = require("../api/pedido");
const config = require("../api/config");
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
  return { endpoint: "https://fcm.googleapis.com/fcm/send/cliente", p256dh: b64u(ua.getPublicKey()), auth_key: b64u(crypto.randomBytes(16)) };
}
function desligarPush() {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
}
function pedidoBase(extra) {
  return { id: UUIDS.pedido, codigo: "ABCD", slug: "gw-teste", barbearia_id: UUIDS.barbearia, servico: "Corte", profissional: "Bruno", profissional_id: UUIDS.bruno, dia: A.daquiA(1), horario: "10:00", duracao_min: 30, cliente: "Ana", cliente_id: CLIENTE, clientes: { nome: "Ana", telefone: "81999990001" }, status: "confirmado", cliente_resposta: null, remarcado_em: null, valor: 40, simulado: false, ...extra };
}
function rotasRemarcar(atual) {
  return [
    ...A.rotasDeConta(),
    { metodo: "GET", padrao: /\/rest\/v1\/pedidos\?id=eq\./, resposta: { corpo: [atual] } },
    { metodo: "PATCH", padrao: /\/rest\/v1\/pedidos\?id=eq\./, resposta: { status: 204 } },
    { padrao: /\/rest\/v1\/rpc\/remarcar_pedido/, resposta: (u, o, c) => ({ corpo: { pedido: { ...atual, ...c.p } } }) },
    { metodo: "DELETE", padrao: /\/rest\/v1\/avisos_pedido/, resposta: { status: 204 } },
    { padrao: /\/rest\/v1\/push_clientes\?pedido_id=eq\./, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/clientes_push\?cliente_id=eq\./, resposta: { corpo: [] } },
  ];
}

test("mudou com WhatsApp: guarda o horário de antes, pede o aceite e devolve o link para a mensagem", async () => {
  const chamadas = A.instalarFetch(rotasRemarcar(pedidoBase()));
  const r = await A.chamar(pedido, { metodo: "POST", corpo: { acao: "remarcar", id: UUIDS.pedido, dia: A.daquiA(1), horario: "10:15", whatsapp: true }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.avisados, 0);
  assert.match(r.body.link, /^\/gw-teste\?confirmar=[0-9a-f-]{36}\.[A-Za-z0-9_-]{16}$/);
  assert.equal(presenca.lerToken(r.body.link.split("=")[1]), UUIDS.pedido);
  const patch = chamadas.find((c) => c.metodo === "PATCH");
  assert.equal(patch.corpo.dia_anterior, A.daquiA(1));
  assert.equal(patch.corpo.horario_anterior, "10:00");
  assert.ok(patch.corpo.remarcado_em);
  assert.equal(patch.corpo.cliente_resposta, null);
});

test("mudou de novo sem resposta: o horário de antes continua o primeiro (o que o cliente tinha aceitado)", async () => {
  const jaMudado = pedidoBase({ horario: "10:15", remarcado_em: "2026-11-18T10:00:00Z", dia_anterior: A.daquiA(1), horario_anterior: "10:00" });
  const chamadas = A.instalarFetch(rotasRemarcar(jaMudado));
  const r = await A.chamar(pedido, { metodo: "POST", corpo: { acao: "remarcar", id: UUIDS.pedido, dia: A.daquiA(1), horario: "10:30", whatsapp: true }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(chamadas.find((c) => c.metodo === "PATCH").corpo.horario_anterior, "10:00");
});

test("mudou sem avisar ninguém: não pede aceite nem devolve link", async () => {
  const chamadas = A.instalarFetch(rotasRemarcar(pedidoBase()));
  const r = await A.chamar(pedido, { metodo: "POST", corpo: { acao: "remarcar", id: UUIDS.pedido, dia: A.daquiA(1), horario: "10:15" }, token: "token-dono" });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.link, "");
  assert.ok(!chamadas.some((c) => c.metodo === "PATCH" && c.corpo.remarcado_em), "sem aviso, nada de aguardando aceite");
});

test("atrasar com WhatsApp: a lista volta com o telefone, quem não recebeu no celular e o link de cada um", async () => {
  const dia = A.daquiA(1);
  const lista = [pedidoBase({ id: "d3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3", horario: "15:00:00", cliente: "Caio", clientes: { nome: "Caio", telefone: "81999990003" } }), pedidoBase({ id: "e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4", horario: "14:30:00", cliente: "Duda", clientes: null })];
  A.instalarFetch([
    ...A.rotasDeConta(),
    { padrao: /\/rest\/v1\/profissionais\?id=eq\./, resposta: { corpo: [{ id: UUIDS.bruno, nome: "Bruno" }] } },
    { metodo: "GET", padrao: /\/rest\/v1\/pedidos\?barbearia_id=eq\.[^&]+&profissional_id=eq\./, resposta: { corpo: lista } },
    { padrao: /\/rest\/v1\/rpc\/remarcar_pedido/, resposta: (u, o, c) => ({ corpo: { pedido: { ...c.p } } }) },
    { metodo: "PATCH", padrao: /\/rest\/v1\/pedidos\?id=eq\./, resposta: { status: 204 } },
    { metodo: "DELETE", padrao: /\/rest\/v1\/avisos_pedido/, resposta: { status: 204 } },
  ]);
  const r = await A.chamar(pedido, { metodo: "POST", corpo: { acao: "atrasar", profissionalId: UUIDS.bruno, dia, minutos: 10, whatsapp: true }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.lista.map((x) => [x.cliente, x.de, x.para, x.telefone, x.avisado]), [["Duda", "14:30", "14:40", "", false], ["Caio", "15:00", "15:10", "81999990003", false]]);
  assert.ok(r.body.lista.every((x) => /\?confirmar=/.test(x.link)));
});

function rotasResposta(o) {
  const p = { id: UUIDS.pedido, barbearia_id: UUIDS.barbearia, profissional_id: UUIDS.bruno, slug: "gw-teste", servico: "Corte", profissional: "Bruno", dia: A.daquiA(1), horario: "10:15:00", status: "confirmado", cliente: "Ana", cliente_resposta: null, sinal_status: null, remarcado_em: "2026-11-18T10:00:00Z", dia_anterior: A.daquiA(1), horario_anterior: "10:00", barbearias: { nome: "GW Teste", slug: "gw-teste" } };
  return [
    { padrao: /\/rest\/v1\/rpc\/contar_tentativa/, resposta: { corpo: 1 } },
    { metodo: "GET", padrao: /\/rest\/v1\/pedidos\?id=eq\./, resposta: { corpo: [p] } },
    { metodo: "PATCH", padrao: /\/rest\/v1\/pedidos\?id=eq\./, resposta: (u, op, corpo) => ({ corpo: [{ ...p, ...corpo }] }) },
    { padrao: /\/rest\/v1\/perfis\?barbearia_id=eq\./, resposta: { corpo: [{ user_id: UUIDS.donoUser, papel: "dono" }] } },
    { padrao: /\/rest\/v1\/profissionais\?id=eq\./, resposta: { corpo: [{ perfil_user_id: null }] } },
    { padrao: /\/rest\/v1\/push_inscricoes\?user_id=in\./, resposta: { corpo: o.inscricao ? [{ ...o.inscricao, user_id: UUIDS.donoUser }] : [] } },
    { metodo: "POST", padrao: /^https:\/\/fcm\.googleapis\.com\//, resposta: { status: 201 } },
  ];
}

test("link do horário mudado: mostra o de antes; aceitar avisa o dono, recusar cancela e avisa", async () => {
  const inscricao = ligarPush();
  try {
    const t = presenca.token(UUIDS.pedido);
    let chamadas = A.instalarFetch(rotasResposta({ inscricao }));
    let r = await A.chamar(config, { query: { presenca: t } });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.anterior, { dia: A.daquiA(1), horario: "10:00" });
    assert.equal(r.body.horario, "10:15");
    r = await A.chamar(config, { metodo: "POST", corpo: { tipo: "presenca", token: t, resposta: "sim" } });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.equal(chamadas.find((c) => c.metodo === "PATCH").corpo.cliente_resposta, "sim");
    assert.equal(chamadas.filter((c) => c.url.startsWith("https://fcm.googleapis.com/")).length, 1, "o dono fica sabendo que o cliente aceitou");
    chamadas = A.instalarFetch(rotasResposta({ inscricao }));
    r = await A.chamar(config, { metodo: "POST", corpo: { tipo: "presenca", token: t, resposta: "nao" } });
    assert.equal(r.statusCode, 200);
    assert.deepEqual([chamadas.find((c) => c.metodo === "PATCH").corpo.status, r.body.status], ["cancelado", "cancelado"]);
    assert.equal(chamadas.filter((c) => c.url.startsWith("https://fcm.googleapis.com/")).length, 1, "e que não aceitou");
  } finally {
    desligarPush();
  }
});

test("painel e site: WhatsApp quando não há aviso no celular, link de aceite na mensagem, WhatsApp obrigatório", () => {
  const comum = ler("painel-comum.js");
  assert.match(comum, /Você pode no novo horário\? Toque no link para aceitar ou recusar:/);
  assert.match(comum, /P\.horarioAnterior = function/);
  const quadro = ler("painel-quadro.js");
  assert.match(quadro, /whatsapp: zap\.checked/);
  assert.match(quadro, /P\.oferecerWhats\("remarcado", novoPedido, ctx, "Mandar a mudança no WhatsApp", extra\)/);
  assert.match(quadro, /function whatsDosAtrasados\(lista, ctx\)/);
  const agenda = ler("painel-agenda.js");
  assert.match(agenda, /aguardando o cliente aceitar o novo horário/);
  assert.match(agenda, /whatsapp: zap\.checked/);
  const site = ler("gw-barbearia.html");
  // Obrigatório em toda barbearia; só a vitrine da página de vendas (gerador v15) deixa em branco
  assert.match(site, /maxlength="20"'\+\(demo\?'':' required'\)\+' value=/, "o campo do WhatsApp é obrigatório");
  assert.match(site, /Obrigatório: a barbearia usa para confirmar o horário e avisar você se ele precisar mudar\./);
  assert.match(site, /if\(!semCadastro&&!demo&&\(digitos\.length<10\|\|digitos\.length>13\)\)/);
  assert.match(site, /Aceito o novo horário/);
  assert.match(site, /Não posso nesse horário/);
  assert.ok(require("../lib/gerador").VERSAO >= 14);
});
