// Agendamento público (POST /api/pedido): validação, agenda publicada, gravação atômica e limites
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("./ajuda");
const pedido = require("../api/pedido");

const { UUIDS } = A;
const DIA = A.daquiA(1);

function rotasDoSite({ ocupados = [], publicada = true, rpc = () => ({ corpo: { id: UUIDS.pedido } }), pedidosDoRafael = 3 } = {}) {
  return [
    ...A.rotasDeConta(),
    { padrao: /\/rest\/v1\/barbearias\?slug=eq\.gw-teste/, resposta: { corpo: [{ id: UUIDS.barbearia }] } },
    { padrao: /\/rest\/v1\/barbearias\?slug=eq\./, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/profissionais\?barbearia_id=eq\./, resposta: { corpo: [{ id: UUIDS.bruno, nome: "Bruno" }, { id: UUIDS.rafael, nome: "Rafael" }] } },
    {
      padrao: /\/rest\/v1\/agenda_dia\?profissional_id=eq\./,
      resposta: { corpo: publicada ? [{ inicio: "09:00:00", fim: "18:00:00", almoco_inicio: "12:00:00", almoco_fim: "13:00:00", confirmada_em: "2026-11-01T10:00:00Z" }] : [] },
    },
    { padrao: /\/rest\/v1\/bloqueios\?/, resposta: { corpo: [] } },
    {
      padrao: /\/rest\/v1\/pedidos\?profissional_id=eq\./,
      resposta: (url) => {
        if (url.includes(UUIDS.rafael)) return { corpo: Array.from({ length: pedidosDoRafael }, (_, i) => ({ horario: `1${4 + i}:00`, duracao_min: 30 })) };
        return { corpo: ocupados };
      },
    },
    { padrao: /\/rest\/v1\/servicos_precos\?barbearia_id=eq\./, resposta: { corpo: [{ preco: "40.00" }] } },
    { padrao: /\/rest\/v1\/rpc\/criar_pedido/, resposta: (u, o, corpo) => rpc(corpo) },
  ];
}

const base = () => ({ slug: "gw-teste", servico: "Corte", profissionalId: UUIDS.bruno, profissional: "Bruno", dia: DIA, horario: "10:00", cliente: "Ana Paula", duracao: 30 });

test("recusa barbearia, data e horário inválidos", async () => {
  A.instalarFetch(rotasDoSite());
  const casos = [
    [{ slug: "X" }, 400, /Barbearia inválida/],
    [{ dia: "2026-02-30" }, 400, /Data ou horário inválido/],
    [{ horario: "25:00" }, 400, /Data ou horário inválido/],
    [{ dia: A.daquiA(-1) }, 400, /já passou/],
    [{ dia: A.daquiA(61) }, 400, /60 dias/],
    [{ cliente: "A" }, 400, /nome/],
    [{ servico: "" }, 400, /serviço/],
    [{ profissionalId: "nao-e-uuid" }, 400, /Profissional inválido/],
    [{ profissionalId: "", profissional: "", qualquer: false }, 400, /profissional/],
  ];
  for (const [mudanca, status, msg] of casos) {
    const r = await A.chamar(pedido, { metodo: "POST", corpo: { ...base(), ...mudanca } });
    assert.equal(r.statusCode, status, JSON.stringify(mudanca));
    assert.match(r.body.message, msg);
  }
});

test("robô que preenche o campo escondido não grava nada", async () => {
  const chamadas = A.instalarFetch(rotasDoSite());
  const r = await A.chamar(pedido, { metodo: "POST", corpo: { ...base(), website: "http://spam" } });
  assert.equal(r.statusCode, 201);
  assert.equal(r.body.codigo, "");
  assert.equal(chamadas.filter((c) => c.url.includes("criar_pedido")).length, 0);
});

test("barbeiro de outra barbearia é recusado", async () => {
  A.instalarFetch(rotasDoSite());
  const r = await A.chamar(pedido, { metodo: "POST", corpo: { ...base(), profissionalId: UUIDS.estranho } });
  assert.equal(r.statusCode, 400);
  assert.match(r.body.message, /não encontrado/);
});

test("horário fora da agenda publicada, no almoço ou ocupado não é aceito", async () => {
  for (const [opcoes, horario] of [
    [{}, "19:00"],
    [{}, "12:15"],
    [{ ocupados: [{ horario: "10:00", duracao_min: 40 }] }, "10:30"],
    [{ publicada: false }, "10:00"],
  ]) {
    const chamadas = A.instalarFetch(rotasDoSite(opcoes));
    const r = await A.chamar(pedido, { metodo: "POST", corpo: { ...base(), horario } });
    assert.equal(r.statusCode, 409, horario + " " + JSON.stringify(opcoes));
    assert.equal(chamadas.filter((c) => c.url.includes("criar_pedido")).length, 0, "não chega a gravar");
  }
});

test("pedido válido grava de forma atômica e devolve o código", async () => {
  const chamadas = A.instalarFetch(rotasDoSite());
  const r = await A.chamar(pedido, { metodo: "POST", corpo: base() });
  assert.equal(r.statusCode, 201);
  assert.match(r.body.codigo, /^[A-Z2-9]{4}$/);
  assert.equal(r.body.profissional, "Bruno");
  const rpc = chamadas.find((c) => c.url.includes("rpc/criar_pedido"));
  assert.ok(rpc, "usa a função atômica do banco");
  const p = rpc.corpo.p;
  assert.equal(p.status, "pendente");
  assert.equal(p.profissional_id, UUIDS.bruno);
  assert.equal(p.valor, 40, "preço cadastrado pelo dono vale mais que o do site");
  assert.equal(p.cliente, "Ana Paula");
  assert.ok(p.limite_hora_origem > 0 && p.limite_dia_origem > 0 && p.limite_dia_barbearia >= 40);
  assert.match(p.origem, /^[0-9a-f]{32}$/, "origem é um hash");
  assert.ok(!JSON.stringify(rpc.corpo).includes("203.0.113.7"), "o IP não é gravado");
  assert.equal(r.headers["cache-control"], "no-store");
});

test("sem preferência: escolhe o barbeiro livre com menos pedidos no dia", async () => {
  const chamadas = A.instalarFetch(rotasDoSite({ pedidosDoRafael: 3 }));
  const r = await A.chamar(pedido, { metodo: "POST", corpo: { ...base(), profissionalId: "", profissional: "", qualquer: true } });
  assert.equal(r.statusCode, 201);
  assert.equal(r.body.profissional, "Bruno");
  const p = chamadas.find((c) => c.url.includes("rpc/criar_pedido")).corpo.p;
  assert.equal(p.profissional_id, UUIDS.bruno);
});

test("conflito no banco (dois clientes ao mesmo tempo) vira 409", async () => {
  A.instalarFetch(rotasDoSite({ rpc: () => ({ corpo: { erro: "conflito", horario: "10:00" } }) }));
  const r = await A.chamar(pedido, { metodo: "POST", corpo: base() });
  assert.equal(r.statusCode, 409);
  assert.match(r.body.message, /acabou de ser reservado/);
});

test("limite por origem e por barbearia viram 429", async () => {
  A.instalarFetch(rotasDoSite({ rpc: () => ({ corpo: { erro: "limite_origem" } }) }));
  let r = await A.chamar(pedido, { metodo: "POST", corpo: base() });
  assert.equal(r.statusCode, 429);
  A.instalarFetch(rotasDoSite({ rpc: () => ({ corpo: { erro: "limite_barbearia" } }) }));
  r = await A.chamar(pedido, { metodo: "POST", corpo: base() });
  assert.equal(r.statusCode, 429);
});

test("código repetido: tenta outro e grava", async () => {
  let n = 0;
  const chamadas = A.instalarFetch(
    rotasDoSite({
      rpc: () => {
        n++;
        if (n === 1) return { status: 409, corpo: { message: 'duplicate key value violates unique constraint "pedidos_slug_codigo_key"' } };
        return { corpo: { id: UUIDS.pedido } };
      },
    })
  );
  const r = await A.chamar(pedido, { metodo: "POST", corpo: base() });
  assert.equal(r.statusCode, 201);
  const codigos = chamadas.filter((c) => c.url.includes("criar_pedido")).map((c) => c.corpo.p.codigo);
  assert.equal(codigos.length, 2);
});

test("erro inesperado do banco não vaza detalhes para o cliente", async () => {
  const chamadas = A.instalarFetch([
    ...A.rotasDeConta(),
    { padrao: /\/rest\/v1\/barbearias\?slug=eq\./, resposta: { status: 500, corpo: { message: 'relation "segredo_interno" does not exist' } } },
  ]);
  const r = await A.chamar(pedido, { metodo: "POST", corpo: base() });
  assert.equal(r.statusCode, 500);
  assert.ok(!/segredo_interno|Banco|relation/.test(r.body.message), r.body.message);
  assert.match(r.body.message, /código [0-9a-f]{8}/);
  assert.ok(chamadas.some((c) => c.url.includes("/rest/v1/telemetria") && c.corpo.tipo === "erro_servidor"), "registra no monitoramento");
});

test("site antigo (sem id do barbeiro) com nome da equipe confere a agenda", async () => {
  A.instalarFetch(rotasDoSite({ ocupados: [{ horario: "10:00", duracao_min: 30 }] }));
  const r = await A.chamar(pedido, { metodo: "POST", corpo: { ...base(), profissionalId: "" } });
  assert.equal(r.statusCode, 409);
});

test("métodos não permitidos e ações do painel sem login", async () => {
  A.instalarFetch(rotasDoSite());
  let r = await A.chamar(pedido, { metodo: "DELETE" });
  assert.equal(r.statusCode, 405);
  r = await A.chamar(pedido, { metodo: "POST", corpo: { acao: "avulso" } });
  assert.equal(r.statusCode, 401, "ação do painel exige login");
  r = await A.chamar(pedido, { metodo: "GET", query: { painel: "1" } });
  assert.equal(r.statusCode, 401);
});
