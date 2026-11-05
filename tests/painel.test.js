// Painéis: tela inicial numa chamada só (indicadores), remarcar, cancelar, atendimento espontâneo
// e agenda publicada pelo barbeiro ou pelo dono.
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("./ajuda");
const { UUIDS } = A;
const pedido = require("../api/pedido");
const eu = require("../api/eu");
const equipe = require("../api/equipe");

const HOJE = A.hoje();

function pedidoBase(extra) {
  return { id: UUIDS.pedido, codigo: "ABCD", servico: "Corte", profissional: "Bruno", profissional_id: UUIDS.bruno, dia: A.daquiA(1), horario: "10:00", duracao_min: 30, cliente: "Ana", status: "confirmado", valor: 40, simulado: false, ...extra };
}

test("tela inicial do dono: pedidos, equipe com agenda publicada e indicadores", async () => {
  const doDia = [
    pedidoBase({ dia: HOJE, horario: "09:00", status: "realizado", valor: 50, duracao_min: 60 }),
    pedidoBase({ id: "p2", dia: HOJE, horario: "10:00", status: "confirmado", valor: 40, duracao_min: 30 }),
    pedidoBase({ id: "p3", dia: HOJE, horario: "11:00", status: "pendente", valor: 30, duracao_min: 30, profissional_id: UUIDS.rafael, profissional: "Rafael" }),
    pedidoBase({ id: "p4", dia: HOJE, horario: "12:00", status: "recusado", valor: 99 }),
  ];
  const historico = [
    { dia: HOJE, status: "realizado", motivo: null, valor: 50, comissao_pct: 40, profissional_id: UUIDS.bruno, simulado: false },
    { dia: A.daquiA(-3), status: "realizado", motivo: null, valor: 30, comissao_pct: 40, profissional_id: UUIDS.bruno, simulado: false },
    { dia: A.daquiA(-4), status: "nao_realizado", motivo: "cliente_nao_apareceu", valor: null, comissao_pct: 40, profissional_id: UUIDS.bruno, simulado: false },
    { dia: A.daquiA(-5), status: "nao_realizado", motivo: "reagendado", valor: null, comissao_pct: 40, profissional_id: UUIDS.bruno, simulado: false },
  ];
  const chamadas = A.instalarFetch([
    ...A.rotasDeConta(),
    { padrao: new RegExp(`/rest/v1/pedidos\\?barbearia_id=eq\\.${UUIDS.barbearia}&dia=eq\\.`), resposta: { corpo: doDia } },
    { padrao: /\/rest\/v1\/pedidos\?barbearia_id=eq\.[^&]+&status=eq\.pendente/, resposta: { corpo: [doDia[2]] } },
    { padrao: /\/rest\/v1\/pedidos\?barbearia_id=eq\.[^&]+&status=in\.\(confirmado,avulso\)/, resposta: { corpo: [doDia[1]] } },
    { padrao: /\/rest\/v1\/pedidos\?barbearia_id=eq\.[^&]+&dia=gte\./, resposta: { corpo: historico } },
    { padrao: /\/rest\/v1\/profissionais\?barbearia_id=eq\./, resposta: { corpo: [{ id: UUIDS.bruno, nome: "Bruno", foto_url: null, perfil_user_id: UUIDS.brunoUser, comissao_pct: 40 }, { id: UUIDS.rafael, nome: "Rafael", foto_url: null, perfil_user_id: null, comissao_pct: 50 }] } },
    { padrao: /\/rest\/v1\/agenda_dia\?dia=eq\./, resposta: { corpo: [{ profissional_id: UUIDS.bruno, inicio: "09:00:00", fim: "13:00:00", almoco_inicio: null, almoco_fim: null, confirmada_em: "2026-11-01T00:00:00Z" }] } },
    { padrao: /\/rest\/v1\/servicos_precos\?barbearia_id=eq\./, resposta: { corpo: [{ nome: "Corte", preco: "40.00" }] } },
  ]);
  const r = await A.chamar(pedido, { metodo: "GET", query: { painel: "1", dia: HOJE }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const b = r.body;
  assert.equal(b.pedidos.length, 4);
  assert.equal(b.pendentes.length, 1);
  assert.equal(b.kpis.dia.agendados, 3, "recusado não conta");
  assert.equal(b.kpis.dia.realizados, 1);
  assert.equal(b.kpis.dia.faturamentoPrevisto, 120);
  assert.equal(b.kpis.dia.faturamentoRealizado, 50);
  // Ocupação: só quem publicou a agenda (Bruno, 4 h = 240 min). Ocupado: 60 + 30 = 90 min -> 38%
  assert.equal(b.kpis.dia.ocupacao, 38);
  const bruno = b.equipe.find((e) => e.id === UUIDS.bruno);
  const rafael = b.equipe.find((e) => e.id === UUIDS.rafael);
  assert.equal(bruno.agenda.publicada, true);
  assert.equal(rafael.agenda, null, "Rafael não publicou a agenda");
  assert.equal(rafael.temLogin, false);
  assert.equal(b.kpis.ultimos30.atendimentos, 2);
  assert.equal(b.kpis.ultimos30.faltas, 1);
  assert.equal(b.kpis.ultimos30.taxaFaltas, 33.3);
  assert.equal(b.kpis.ultimos30.ticketMedio, 40);
  assert.ok(chamadas.some((c) => c.url.includes("profissionais!inner(barbearia_id)") && c.url.includes(`profissionais.barbearia_id=eq.${UUIDS.barbearia}`)), "agenda filtrada pela barbearia");
});

test("cancelar: dono cancela confirmado; encerrado não pode", async () => {
  let atual = pedidoBase({ status: "confirmado" });
  const chamadas = A.instalarFetch([
    ...A.rotasDeConta(),
    { metodo: "GET", padrao: /\/rest\/v1\/pedidos\?id=eq\./, resposta: () => ({ corpo: [atual] }) },
    { metodo: "PATCH", padrao: /\/rest\/v1\/pedidos\?id=eq\./, resposta: (u, o, corpo) => ({ corpo: [{ ...atual, ...corpo }] }) },
  ]);
  let r = await A.chamar(pedido, { metodo: "POST", corpo: { acao: "cancelar", id: UUIDS.pedido }, token: "token-dono" });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.pedido.status, "cancelado");
  const patch = chamadas.find((c) => c.metodo === "PATCH");
  assert.ok(patch.url.includes("status=in.(pendente,confirmado,avulso)"), "só cancela o que ainda está ativo (no banco)");
  atual = pedidoBase({ status: "realizado" });
  r = await A.chamar(pedido, { metodo: "POST", corpo: { acao: "cancelar", id: UUIDS.pedido }, token: "token-dono" });
  assert.equal(r.statusCode, 409);
});

test("remarcar: valida data, recusa passado, troca de barbeiro só pelo dono e respeita conflito", async () => {
  let rpc = () => ({ corpo: { pedido: pedidoBase({ dia: A.daquiA(2), horario: "15:00" }) } });
  const chamadas = A.instalarFetch([
    ...A.rotasDeConta(),
    { metodo: "GET", padrao: /\/rest\/v1\/pedidos\?id=eq\./, resposta: { corpo: [pedidoBase({ status: "confirmado" })] } },
    { padrao: /\/rest\/v1\/profissionais\?id=eq\./, resposta: (url) => ({ corpo: url.includes(UUIDS.rafael) ? [{ id: UUIDS.rafael, nome: "Rafael" }] : [] }) },
    { padrao: /\/rest\/v1\/rpc\/remarcar_pedido/, resposta: (u, o, c) => rpc(c) },
  ]);
  const base = { acao: "remarcar", id: UUIDS.pedido, dia: A.daquiA(2), horario: "15:00" };
  let r = await A.chamar(pedido, { metodo: "POST", corpo: { ...base, dia: "2026-02-31" }, token: "token-dono" });
  assert.equal(r.statusCode, 400);
  r = await A.chamar(pedido, { metodo: "POST", corpo: { ...base, dia: A.daquiA(-1) }, token: "token-dono" });
  assert.equal(r.statusCode, 400);
  r = await A.chamar(pedido, { metodo: "POST", corpo: { ...base, profissionalId: UUIDS.rafael }, token: "token-bruno" });
  assert.equal(r.statusCode, 403, "barbeiro não passa o cliente para outro");
  r = await A.chamar(pedido, { metodo: "POST", corpo: { ...base, profissionalId: UUIDS.rafael }, token: "token-dono" });
  assert.equal(r.statusCode, 200);
  const p = chamadas.filter((c) => c.url.includes("remarcar_pedido")).pop().corpo.p;
  assert.equal(p.profissional_id, UUIDS.rafael);
  assert.equal(p.barbearia_id, UUIDS.barbearia);
  rpc = () => ({ corpo: { erro: "conflito", horario: "15:00" } });
  r = await A.chamar(pedido, { metodo: "POST", corpo: base, token: "token-dono" });
  assert.equal(r.statusCode, 409);
});

test("atendimento espontâneo: só serviço cadastrado e grava de forma atômica como avulso", async () => {
  const chamadas = A.instalarFetch([
    ...A.rotasDeConta(),
    { padrao: /\/rest\/v1\/servicos_precos\?barbearia_id=eq\.[^&]+&nome=eq\.Corte&select=nome/, resposta: { corpo: [{ nome: "Corte" }] } },
    { padrao: /\/rest\/v1\/servicos_precos\?barbearia_id=eq\.[^&]+&nome=eq\.Inventado/, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/servicos_precos\?barbearia_id=eq\.[^&]+&nome=eq\.Corte&select=preco/, resposta: { corpo: [{ preco: "40" }] } },
    { padrao: /\/rest\/v1\/profissionais\?id=eq\./, resposta: { corpo: [{ id: UUIDS.bruno, nome: "Bruno" }] } },
    { padrao: /\/rest\/v1\/barbearias\?id=eq\./, resposta: { corpo: [{ slug: "gw-teste" }] } },
    { padrao: /\/rest\/v1\/bloqueios\?/, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/rpc\/criar_pedido/, resposta: { corpo: { id: UUIDS.pedido } } },
    { padrao: /\/rest\/v1\/pedidos\?id=eq\./, resposta: { corpo: [pedidoBase({ status: "avulso" })] } },
  ]);
  const corpo = { acao: "avulso", servico: "Corte", cliente: "João", dia: HOJE, horario: "10:00", duracao: 30 };
  let r = await A.chamar(pedido, { metodo: "POST", corpo: { ...corpo, servico: "Inventado" }, token: "token-bruno" });
  assert.equal(r.statusCode, 400);
  r = await A.chamar(pedido, { metodo: "POST", corpo: { ...corpo, dia: "2026-13-01" }, token: "token-bruno" });
  assert.equal(r.statusCode, 400);
  r = await A.chamar(pedido, { metodo: "POST", corpo: { ...corpo, profissionalId: UUIDS.rafael }, token: "token-bruno" });
  assert.equal(r.statusCode, 201);
  const p = chamadas.find((c) => c.url.includes("criar_pedido")).corpo.p;
  assert.equal(p.status, "avulso");
  assert.equal(p.profissional_id, UUIDS.bruno, "barbeiro registra só para si, mesmo pedindo outro");
});

test("agenda da semana: valida todos os dias antes de gravar qualquer um", async () => {
  const chamadas = A.instalarFetch([...A.rotasDeConta(), { padrao: /\/rest\/v1\/agenda_dia/, resposta: { status: 201 } }]);
  const dias = [
    { dia: A.daquiA(1), inicio: "09:00", fim: "18:00", almocoInicio: "12:00", almocoFim: "13:00" },
    { dia: A.daquiA(2), inicio: "09:00", fim: "18:00", almocoInicio: "19:00", almocoFim: "20:00" },
  ];
  const r = await A.chamar(eu, { metodo: "POST", corpo: { acao: "agenda-semana-salvar", dias, confirmar: true }, token: "token-bruno" });
  assert.equal(r.statusCode, 400);
  assert.match(r.body.message, /almoço/);
  assert.equal(chamadas.filter((c) => c.url.includes("/rest/v1/agenda_dia") && c.metodo === "POST").length, 0, "nada gravado");
});

test("agenda da semana: grava, publica e tira do site os dias de folga", async () => {
  const chamadas = A.instalarFetch([
    ...A.rotasDeConta(),
    { padrao: /\/rest\/v1\/agenda_dia/, resposta: (u, o) => ({ status: o.method === "GET" || !o.method ? 200 : 201, corpo: [] }) },
    { padrao: /\/rest\/v1\/disponibilidade\?/, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/bloqueios\?/, resposta: { corpo: [] } },
  ]);
  const dias = [
    { dia: A.daquiA(1), inicio: "09:00", fim: "18:00", almocoInicio: "", almocoFim: "" },
    { dia: A.daquiA(2), folga: true },
  ];
  const r = await A.chamar(eu, { metodo: "POST", corpo: { acao: "agenda-semana-salvar", dias, confirmar: true }, token: "token-bruno" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const gravou = chamadas.find((c) => c.metodo === "POST" && c.url.includes("agenda_dia?on_conflict"));
  assert.equal(gravou.corpo.profissional_id, UUIDS.bruno);
  assert.ok(gravou.corpo.confirmada_em, "publicado");
  const folga = chamadas.find((c) => c.metodo === "PATCH" && c.url.includes("agenda_dia"));
  assert.equal(folga.corpo.confirmada_em, null, "folga sai do site");
  assert.equal(r.body.dias.length, 2);
});

test("dono publica a agenda de barbeiro sem login; barbeiro de outra barbearia não", async () => {
  const chamadas = A.instalarFetch([
    ...A.rotasDeConta(),
    { padrao: /\/rest\/v1\/profissionais\?id=eq\./, resposta: (url) => ({ corpo: url.includes(UUIDS.rafael) ? [{ id: UUIDS.rafael, nome: "Rafael", perfil_user_id: null }] : [] }) },
    { padrao: /\/rest\/v1\/agenda_dia/, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/disponibilidade\?/, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/bloqueios\?/, resposta: { corpo: [] } },
  ]);
  const dias = [{ dia: A.daquiA(1), inicio: "10:00", fim: "16:00" }];
  let r = await A.chamar(equipe, { metodo: "POST", corpo: { acao: "agenda-semana-salvar", profissionalId: UUIDS.rafael, dias, confirmar: true }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.ok(chamadas.some((c) => c.metodo === "POST" && c.url.includes("agenda_dia?on_conflict") && c.corpo.profissional_id === UUIDS.rafael));
  r = await A.chamar(equipe, { metodo: "POST", corpo: { acao: "agenda-semana-salvar", profissionalId: UUIDS.estranho, dias, confirmar: true }, token: "token-dono" });
  assert.equal(r.statusCode, 404);
});

test("bloqueio pontual: valida horário e só apaga bloqueio do próprio barbeiro", async () => {
  const chamadas = A.instalarFetch([
    ...A.rotasDeConta(),
    { metodo: "POST", padrao: /\/rest\/v1\/bloqueios$/, resposta: (u, o, c) => ({ status: 201, corpo: [{ id: UUIDS.pedido, ...c }] }) },
    { metodo: "DELETE", padrao: /\/rest\/v1\/bloqueios\?/, resposta: { status: 204 } },
  ]);
  let r = await A.chamar(eu, { metodo: "POST", corpo: { acao: "bloqueio-criar", dia: A.daquiA(1), inicio: "15:00", fim: "14:00" }, token: "token-bruno" });
  assert.equal(r.statusCode, 400);
  r = await A.chamar(eu, { metodo: "POST", corpo: { acao: "bloqueio-criar", dia: A.daquiA(1), inicio: "14:00", fim: "15:00", motivo: "Médico" }, token: "token-bruno" });
  assert.equal(r.statusCode, 201);
  r = await A.chamar(eu, { metodo: "POST", corpo: { acao: "bloqueio-remover", id: UUIDS.pedido }, token: "token-bruno" });
  assert.equal(r.statusCode, 200);
  const del = chamadas.find((c) => c.metodo === "DELETE");
  assert.ok(del.url.includes(`profissional_id=eq.${UUIDS.bruno}`) && del.url.includes("tipo=eq.pontual"), del.url);
});
