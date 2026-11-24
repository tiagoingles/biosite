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

test("bloqueio pontual: mudar o horário tocando no quadro (barbeiro nos dele, dono em qualquer um da equipe), só de hoje em diante", async () => {
  const chamadas = A.instalarFetch([
    ...A.rotasDeConta(),
    { padrao: /\/rest\/v1\/profissionais\?id=eq\./, resposta: (url) => ({ corpo: url.includes(UUIDS.rafael) ? [{ id: UUIDS.rafael, nome: "Rafael", perfil_user_id: null }] : [] }) },
    // Só o bloqueio UUIDS.pedido existe (de amanhã); outro id não volta nada (de outro barbeiro ou de dia que passou)
    { metodo: "PATCH", padrao: /\/rest\/v1\/bloqueios\?id=eq\./, resposta: (u, o, c) => ({ status: 200, corpo: u.includes("id=eq." + UUIDS.pedido) ? [{ id: UUIDS.pedido, data: A.daquiA(1), inicio: c.inicio + ":00", fim: c.fim + ":00", motivo: c.motivo == null ? "" : c.motivo }] : [] }) },
  ]);
  let r = await A.chamar(eu, { metodo: "POST", corpo: { acao: "bloqueio-editar", id: UUIDS.pedido, inicio: "13:00", fim: "12:00" }, token: "token-bruno" });
  assert.equal(r.statusCode, 400, "o fim antes do início é recusado");
  r = await A.chamar(eu, { metodo: "POST", corpo: { acao: "bloqueio-editar", id: UUIDS.pedido, inicio: "12:30", fim: "14:00", motivo: "Almoço" }, token: "token-bruno" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.bloqueio, { id: UUIDS.pedido, dia: A.daquiA(1), inicio: "12:30", fim: "14:00", motivo: "Almoço" });
  const patch = chamadas.find((c) => c.metodo === "PATCH" && c.url.includes("/bloqueios?"));
  assert.ok(patch.url.includes(`profissional_id=eq.${UUIDS.bruno}`) && patch.url.includes("tipo=eq.pontual") && patch.url.includes("data=gte."), patch.url);
  // O dono muda o bloqueio de um barbeiro da equipe (inclusive sem login); de fora da equipe, não
  r = await A.chamar(equipe, { metodo: "POST", corpo: { acao: "bloqueio-editar", profissionalId: UUIDS.rafael, id: UUIDS.pedido, inicio: "12:40", fim: "14:30" }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.ok(chamadas.some((c) => c.metodo === "PATCH" && c.url.includes(`profissional_id=eq.${UUIDS.rafael}`)));
  r = await A.chamar(equipe, { metodo: "POST", corpo: { acao: "bloqueio-editar", profissionalId: UUIDS.estranho, id: UUIDS.pedido, inicio: "12:40", fim: "14:30" }, token: "token-dono" });
  assert.equal(r.statusCode, 404);
  r = await A.chamar(eu, { metodo: "POST", corpo: { acao: "bloqueio-editar", id: UUIDS.estranho, inicio: "12:40", fim: "14:30" }, token: "token-bruno" });
  assert.equal(r.statusCode, 404, "bloqueio que não é dele ou de dia que já passou");
});

test("quadro: o bloqueio pontual traz id e tipo, e tocar nele abre mudar/remover em vez do encaixe", () => {
  const fs = require("fs");
  const path = require("path");
  const ler = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const servidor = ler("lib/pedidos-painel.js");
  assert.match(servidor, /bloqueios\?tipo=eq\.pontual&data=eq\.\$\{dia\}&select=id,tipo,profissional_id/);
  assert.match(servidor, /push\(\{ id: b\.id, tipo: b\.tipo, inicio:/);
  const q = ler("painel-quadro.js");
  assert.match(q, /function gerirBloqueio\(c, b, dia, ctx\)/);
  assert.match(q, /s\.bloqueio\.tipo === "pontual" && s\.bloqueio\.id/, "só o pontual (o recorrente é o padrão da semana)");
  assert.match(q, /P\.api\("\/api\/equipe", \{ corpo: Object\.assign\(\{ profissionalId: c\.id, id: b\.id \}, corpo\) \}\)/, "o dono usa a equipe");
  assert.match(q, /P\.api\("\/api\/eu", \{ corpo: Object\.assign\(\{ id: b\.id \}, corpo\) \}\)/, "o barbeiro, a própria agenda");
  assert.match(q, /acao: "bloqueio-editar"/);
  assert.match(q, /acao: "bloqueio-remover"/);
  assert.match(q, /e\.target\.closest\("\.q-trava"\)\) return;/, "tocar no bloqueio não abre o encaixe");
  assert.match(ler("painel.css"), /\.q-sombra\.q-trava \{ cursor: pointer; \}/);
});

test("dono liga e desliga a confirmação automática; barbeiro não muda", async () => {
  const eu = require("../api/eu");
  const chamadas = A.instalarFetch([{ metodo: "PATCH", padrao: /\/rest\/v1\/barbearias\?id=eq\./, resposta: { status: 204 } }, ...A.rotasDeConta()]);
  let r = await A.chamar(eu, { metodo: "POST", token: "token-dono", corpo: { acao: "config-barbearia", confirmacaoAutomatica: true } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const patch = chamadas.find((c) => c.metodo === "PATCH");
  assert.ok(patch.url.includes(A.UUIDS.barbearia));
  assert.deepEqual(patch.corpo, { confirmacao_automatica: true });
  r = await A.chamar(eu, { metodo: "POST", token: "token-dono", corpo: { acao: "config-barbearia", confirmacaoAutomatica: "sim" } });
  assert.equal(r.statusCode, 400);
  r = await A.chamar(eu, { metodo: "POST", token: "token-bruno", corpo: { acao: "config-barbearia", confirmacaoAutomatica: true } });
  assert.equal(r.statusCode, 403);
});

// Fase 31 (pedido do Manolo): forma de pagamento ao marcar realizado
test("forma de pagamento: realizado grava a forma; dá para corrigir depois; forma desconhecida é recusada", async () => {
  let atual = pedidoBase({ dia: HOJE, status: "confirmado" });
  const chamadas = A.instalarFetch([
    ...A.rotasDeConta(),
    { metodo: "GET", padrao: /rest[/]v1[/]pedidos[?]id=eq[.]/, resposta: () => ({ corpo: [atual] }) },
    { metodo: "GET", padrao: /rest[/]v1[/]profissionais[?]id=eq[.]/, resposta: { corpo: [{ comissao_pct: 40 }] } },
    { metodo: "PATCH", padrao: /rest[/]v1[/]pedidos[?]id=eq[.]/, resposta: (u, o, corpo) => ({ corpo: [{ ...atual, ...corpo }] }) },
  ]);
  let r = await A.chamar(pedido, { metodo: "PATCH", corpo: { id: UUIDS.pedido, status: "realizado", forma_pagamento: "pix" }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  let patch = chamadas.filter((c) => c.metodo === "PATCH").pop();
  assert.equal(patch.corpo.forma_pagamento, "pix");
  atual = pedidoBase({ dia: HOJE, status: "realizado", forma_pagamento: "pix" });
  r = await A.chamar(pedido, { metodo: "PATCH", corpo: { id: UUIDS.pedido, forma_pagamento: "debito" }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  patch = chamadas.filter((c) => c.metodo === "PATCH").pop();
  assert.deepEqual(patch.corpo, { forma_pagamento: "debito" }, "corrige só a forma, sem mexer no valor");
  r = await A.chamar(pedido, { metodo: "PATCH", corpo: { id: UUIDS.pedido, status: "realizado", forma_pagamento: "fiado" }, token: "token-dono" });
  assert.equal(r.statusCode, 400);
  const fs = require("node:fs");
  const agenda = fs.readFileSync(require("node:path").join(__dirname, "..", "painel-agenda.js"), "utf8");
  assert.ok(agenda.includes('function (b) { realizado(p, ctx, b); }'), "o botão Realizado passa pela pergunta da forma");
  assert.ok(agenda.includes('P.perguntarForma("Como o cliente pagou?"'));
  assert.ok(agenda.includes('forma_pagamento: forma.value'), "a venda no balcão manda a forma");
  const fin = fs.readFileSync(require("node:path").join(__dirname, "..", "financeiro.html"), "utf8");
  assert.ok(fin.includes('acao: "apagar"') && fin.includes("Como entrou"), "Financeiro: apagar produto e entradas por forma");
});

// Fase 34 (pedido do Manolo): o dono marca dois clientes no mesmo horário; o encaixe acha o cliente na carteira
test("encaixe e remarcar: no conflito, só o dono pode confirmar e marcar os dois no mesmo horário; o cliente da carteira fica ligado", async () => {
  let conflito = true;
  const chamadas = A.instalarFetch([
    ...A.rotasDeConta(),
    { padrao: /servicos_precos[?]barbearia_id=eq[.][^&]+&nome=eq[.]Corte&select=nome/, resposta: { corpo: [{ nome: "Corte" }] } },
    { padrao: /servicos_precos[?]barbearia_id=eq[.][^&]+&nome=eq[.]Corte&select=preco/, resposta: { corpo: [{ preco: "40" }] } },
    { padrao: /rest[/]v1[/]profissionais[?]id=eq[.]/, resposta: { corpo: [{ id: UUIDS.bruno, nome: "Bruno" }] } },
    { padrao: /rest[/]v1[/]barbearias[?]id=eq[.]/, resposta: { corpo: [{ slug: "gw-teste" }] } },
    { padrao: /rest[/]v1[/]clientes[?]id=eq[.]/, resposta: (url) => ({ corpo: url.includes(UUIDS.cliente || "c1c1c1c1") ? [{ id: "x" }] : [] }) },
    { padrao: /rest[/]v1[/]bloqueios[?]/, resposta: { corpo: [] } },
    { padrao: /rest[/]v1[/]rpc[/]criar_pedido/, resposta: (u, o, c) => ({ corpo: conflito && !c.p.permitir_sobreposicao ? { erro: "conflito", horario: "10:00" } : { id: UUIDS.pedido } }) },
    { padrao: /rest[/]v1[/]rpc[/]remarcar_pedido/, resposta: (u, o, c) => ({ corpo: !c.p.permitir_sobreposicao ? { erro: "conflito", horario: "15:00" } : { pedido: pedidoBase({ dia: A.daquiA(2), horario: "15:00" }) } }) },
    { metodo: "PATCH", padrao: /rest[/]v1[/]pedidos[?]id=eq[.]/, resposta: { status: 204 } },
    { padrao: /rest[/]v1[/]pedidos[?]id=eq[.]/, resposta: { corpo: [pedidoBase({ status: "confirmado" })] } },
  ]);
  const corpo = { acao: "avulso", servico: "Corte", cliente: "João", dia: HOJE, horario: "10:00", duracao: 40, profissionalId: UUIDS.bruno };
  let r = await A.chamar(pedido, { metodo: "POST", corpo, token: "token-dono" });
  assert.equal(r.statusCode, 409);
  assert.deepEqual([r.body.conflito, r.body.podeSobrepor], [true, true], "o painel do dono pergunta se marca mesmo assim");
  r = await A.chamar(pedido, { metodo: "POST", corpo: { ...corpo, sobrepor: true }, token: "token-bruno" });
  assert.equal(r.statusCode, 409, "barbeiro não sobrepõe");
  assert.equal(r.body.podeSobrepor, false);
  r = await A.chamar(pedido, { metodo: "POST", corpo: { ...corpo, sobrepor: true }, token: "token-dono" });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.equal(chamadas.filter((c) => c.url.includes("criar_pedido")).pop().corpo.p.permitir_sobreposicao, true);
  // Cliente escolhido na busca: precisa ser desta barbearia e fica ligado ao encaixe
  conflito = false;
  r = await A.chamar(pedido, { metodo: "POST", corpo: { ...corpo, clienteId: "d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4" }, token: "token-dono" });
  assert.equal(r.statusCode, 404, "cliente de outra barbearia");
  // Remarcar: o mesmo para o dono; o barbeiro continua barrado
  const base = { acao: "remarcar", id: UUIDS.pedido, dia: A.daquiA(2), horario: "15:00" };
  r = await A.chamar(pedido, { metodo: "POST", corpo: base, token: "token-dono" });
  assert.deepEqual([r.statusCode, r.body.conflito, r.body.podeSobrepor], [409, true, true]);
  r = await A.chamar(pedido, { metodo: "POST", corpo: { ...base, sobrepor: true }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(chamadas.filter((c) => c.url.includes("remarcar_pedido")).pop().corpo.p.permitir_sobreposicao, true);
  const sql = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "supabase", "fase34-dono-sobrepor.sql"), "utf8");
  assert.ok(sql.includes("permitir_sobreposicao") && sql.includes("remarcar_pedido") && sql.includes("criar_pedido"));
});

test("busca da carteira no encaixe: pelo nome ou pelo final do telefone, só para o dono", async () => {
  const equipe = require("../api/equipe");
  const chamadas = A.instalarFetch([
    ...A.rotasDeConta(),
    { padrao: /rest[/]v1[/]clientes[?]barbearia_id=eq[.]/, resposta: { corpo: [{ id: "c1", nome: "João Pedro", telefone: "81987871234" }] } },
  ]);
  let r = await A.chamar(equipe, { query: { area: "clientes", busca: "1234" }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.clientes, [{ id: "c1", nome: "João Pedro", final: "1234" }], "só o final do WhatsApp");
  assert.ok(chamadas.some((c) => c.url.includes("telefone=like.*1234")), "final do telefone");
  r = await A.chamar(equipe, { query: { area: "clientes", busca: "joão" }, token: "token-dono" });
  assert.ok(chamadas.some((c) => c.url.includes("nome=ilike.*" + encodeURIComponent("joão") + "*")), "nome");
  r = await A.chamar(equipe, { query: { area: "clientes", busca: "jo,(x)" }, token: "token-dono" });
  assert.ok(!chamadas.some((c) => c.url.includes("(x)")), "sem caracteres que quebram o filtro");
  r = await A.chamar(equipe, { query: { area: "clientes", busca: "joão" }, token: "token-bruno" });
  assert.equal(r.statusCode, 403, "a carteira é do dono");
  const js = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "painel-agenda.js"), "utf8");
  assert.ok(js.includes("area=clientes&busca=") && js.includes("corpo.clienteId = escolhido.id"), "o encaixe busca e liga o cliente");
});

test("encaixe: cliente que não está na carteira é cadastrado ali mesmo, com o WhatsApp, e o encaixe vai para a ficha dele", () => {
  const js = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "painel-agenda.js"), "utf8");
  assert.ok(js.includes("+ Cadastrar cliente novo"), "botão de cliente novo na busca");
  assert.ok(js.includes('acao: "salvar", nome: corpo.cliente, telefone: novoTel.value.trim()'), "cadastra na carteira antes");
  assert.ok(js.includes("corpo.clienteId = j.cliente.id; mandar();"), "e liga o encaixe ao cliente novo");
});

// ---------- fase 36: horário que se repete, tempo do serviço e "marcar outro junto" (pedidos do Manolo) ----------
const SERIE = "5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e5e";
const CLIENTE = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";

test("encaixe que se repete: só o dono; cria as datas, pula folga e horário ocupado, liga a série e o cliente", async () => {
  const [d0, d7, d14, d21, d28] = [1, 8, 15, 22, 29].map(A.daquiA);
  const chamadas = A.instalarFetch([
    ...A.rotasDeConta(),
    { padrao: /servicos_precos[?]barbearia_id=eq[.][^&]+&nome=eq[.]Corte&select=nome/, resposta: { corpo: [{ nome: "Corte" }] } },
    { padrao: /servicos_precos[?]barbearia_id=eq[.][^&]+&nome=eq[.]Corte&select=preco/, resposta: { corpo: [{ preco: "40" }] } },
    { padrao: /rest[/]v1[/]profissionais[?]id=eq[.]/, resposta: { corpo: [{ id: UUIDS.bruno, nome: "Bruno" }] } },
    { padrao: /rest[/]v1[/]barbearias[?]id=eq[.]/, resposta: { corpo: [{ slug: "gw-teste" }] } },
    { padrao: /rest[/]v1[/]clientes[?]id=eq[.]/, resposta: { corpo: [{ id: CLIENTE }] } },
    // Folga marcada no terceiro sábado
    { padrao: /rest[/]v1[/]bloqueios[?]/, resposta: { corpo: [{ tipo: "pontual", data: d14, inicio: "00:00", fim: "23:59" }] } },
    { padrao: /rest[/]v1[/]rpc[/]criar_pedido/, resposta: (u, o, c) => ({ corpo: c.p.dia === d21 ? { erro: "conflito", horario: "10:00" } : { id: "id-" + c.p.dia } }) },
    { metodo: "POST", padrao: /rest[/]v1[/]pedido_series$/, resposta: (u, o, c) => ({ status: 201, corpo: [{ id: SERIE, ...c }] }) },
    { metodo: "PATCH", padrao: /rest[/]v1[/]pedidos[?]id=/, resposta: { status: 204 } },
    { padrao: /rest[/]v1[/]pedidos[?]id=eq[.]/, resposta: { corpo: [pedidoBase({ status: "avulso" })] } },
  ]);
  const corpo = { acao: "avulso", servico: "Corte", cliente: "Claudio", clienteId: CLIENTE, dia: d0, horario: "10:00", duracao: 40, profissionalId: UUIDS.bruno, repetir: { cada: 7, ate: d28 } };
  let r = await A.chamar(pedido, { metodo: "POST", corpo, token: "token-dono" });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.serie.pulados, [{ dia: d14, motivo: "bloqueio" }, { dia: d21, motivo: "ocupado", horario: "10:00" }]);
  assert.deepEqual([r.body.serie.criados, r.body.serie.cada, r.body.serie.ate], [3, 7, d28]);
  assert.ok(chamadas.find((c) => /bloqueios[?]/.test(c.url)).url.includes(`data.in.(${[d0, d7, d14, d21, d28].join(",")})`), "folgas de todas as datas numa consulta");
  const serie = chamadas.find((c) => c.metodo === "POST" && /pedido_series$/.test(c.url)).corpo;
  assert.deepEqual([serie.barbearia_id, serie.cada_dias, serie.ate], [UUIDS.barbearia, 7, d28]);
  const ligar = chamadas.find((c) => c.metodo === "PATCH" && c.url.includes("id=in."));
  assert.ok(ligar.url.includes(`id=in.(id-${d0},id-${d7},id-${d28})`), ligar.url);
  assert.deepEqual(ligar.corpo, { cliente_id: CLIENTE, serie_id: SERIE }, "todas as datas na ficha do cliente e na série");
  // Só o dono repete; e as regras da repetição
  r = await A.chamar(pedido, { metodo: "POST", corpo: { ...corpo, profissionalId: undefined }, token: "token-bruno" });
  assert.equal(r.statusCode, 403, "barbeiro não marca horário que se repete");
  for (const repetir of [{ cada: 10, ate: d28 }, { cada: 7, ate: A.daquiA(400) }, { cada: 7, ate: A.daquiA(3) }]) {
    r = await A.chamar(pedido, { metodo: "POST", corpo: { ...corpo, repetir }, token: "token-dono" });
    assert.equal(r.statusCode, 400, JSON.stringify(repetir));
  }
  // Sem repetir: continua como antes (um atendimento, sem série)
  const antes = chamadas.length;
  r = await A.chamar(pedido, { metodo: "POST", corpo: { ...corpo, repetir: undefined }, token: "token-dono" });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.equal(r.body.serie, undefined);
  const depois = chamadas.slice(antes);
  assert.ok(!depois.some((c) => /pedido_series/.test(c.url)), "sem série");
  assert.deepEqual(depois.find((c) => c.metodo === "PATCH").corpo, { cliente_id: CLIENTE });
});

test("horário que se repete: cancelar e remarcar este e os próximos (só o dono)", async () => {
  const [d1, d2, d8, d9, d15, d16] = [1, 2, 8, 9, 15, 16].map(A.daquiA);
  const atual = pedidoBase({ dia: d1, horario: "10:00", serie_id: SERIE, status: "avulso" });
  const chamadas = A.instalarFetch([
    ...A.rotasDeConta(),
    { metodo: "PATCH", padrao: /rest[/]v1[/]pedidos[?]serie_id=eq[.]/, resposta: { corpo: [{ ...atual, status: "cancelado" }, { ...atual, id: "outro", dia: d8, status: "cancelado" }] } },
    { metodo: "GET", padrao: /rest[/]v1[/]pedidos[?]serie_id=eq[.]/, resposta: { corpo: [{ ...atual, id: "seg", dia: d8 }, { ...atual, id: "ter", dia: d15 }] } },
    { metodo: "GET", padrao: /rest[/]v1[/]pedidos[?]id=eq[.]/, resposta: { corpo: [atual] } },
    { metodo: "PATCH", padrao: /rest[/]v1[/]pedidos[?]id=eq[.]/, resposta: { corpo: [{ ...atual, status: "cancelado" }] } },
    { metodo: "DELETE", padrao: /rest[/]v1[/]avisos_pedido/, resposta: { status: 204 } },
    { padrao: /rest[/]v1[/]rpc[/]remarcar_pedido/, resposta: (u, o, c) => ({ corpo: c.p.dia === d16 ? { erro: "conflito", horario: "11:00" } : { pedido: { ...atual, id: c.p.id, dia: c.p.dia, horario: c.p.horario } } }) },
  ]);
  let r = await A.chamar(pedido, { metodo: "POST", corpo: { acao: "cancelar", id: UUIDS.pedido, serie: "proximos" }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.cancelados, 2);
  const cancela = chamadas.find((c) => c.metodo === "PATCH" && c.url.includes("serie_id="));
  assert.ok(cancela.url.includes(`serie_id=eq.${SERIE}&barbearia_id=eq.${UUIDS.barbearia}&dia=gte.${d1}&status=in.(pendente,confirmado,avulso)`), cancela.url);
  // O barbeiro cancela só o dele, um dia
  const antes = chamadas.length;
  r = await A.chamar(pedido, { metodo: "POST", corpo: { acao: "cancelar", id: UUIDS.pedido, serie: "proximos" }, token: "token-bruno" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.ok(!chamadas.slice(antes).some((c) => c.url.includes("serie_id=")), "barbeiro não mexe na série");
  // Remarcar: este vai para o dia seguinte às 11h, e os próximos andam junto (um deles já está ocupado)
  r = await A.chamar(pedido, { metodo: "POST", corpo: { acao: "remarcar", id: UUIDS.pedido, dia: d2, horario: "11:00", serie: "proximos" }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.serie, { mudados: 2, naoMudaram: [{ dia: d15, motivo: "ocupado" }] });
  const movidos = chamadas.filter((c) => c.url.includes("remarcar_pedido")).map((c) => [c.corpo.p.id, c.corpo.p.dia, c.corpo.p.horario]);
  assert.deepEqual(movidos.slice(1), [["seg", d9, "11:00"], ["ter", d16, "11:00"]], "mesmo deslocamento de dias e o novo horário");
  assert.deepEqual(movidos[0], [UUIDS.pedido, d2, "11:00"]);
  // Só este dia: a série não é lida
  const antes2 = chamadas.length;
  r = await A.chamar(pedido, { metodo: "POST", corpo: { acao: "remarcar", id: UUIDS.pedido, dia: d2, horario: "11:00" }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.ok(!chamadas.slice(antes2).some((c) => c.url.includes("serie_id=")), "só este dia");
});

test("encaixe: tempo do serviço vem do site, vários serviços com para quem é e repetir; remarcar e cancelar perguntam na série", () => {
  const js = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "painel-agenda.js"), "utf8");
  assert.ok(js.includes('getElementById("bio-config")') && js.includes("cfg.agenda.servicos"), "lê o tempo dos serviços do site");
  assert.ok(js.includes("tempoDoServico(l)") && js.includes("usarDuracao(l.dur"), "a duração segue o serviço de cada linha");
  assert.ok(js.includes('"Adicionar serviço"') && js.includes("corpo.itens = itens"), "vários serviços no mesmo encaixe");
  for (const t of ["O próprio cliente", "Filho ou filha", "Parente", "Outra pessoa"]) assert.ok(js.includes(t), t);
  assert.ok(js.includes("x.paraQuem = l.para.value") && js.includes("x.paraNome = l.nome.value.trim()"), "para quem é cada serviço");
  for (const t of ["Toda semana", "A cada 15 dias", "A cada 3 semanas", "A cada 4 semanas (1 vez por mês)"]) assert.ok(js.includes(t), t);
  assert.ok(js.includes("corpo.repetir = { cada: Number(repetir.value), ate: ate.value }"), "envia a repetição");
  assert.ok(js.includes('"Este e os próximos"') && js.includes('corpo.serie = "proximos"'), "cancelar e remarcar a série");
  assert.ok(js.includes("↻ Repete") && js.includes('class: "para-quem"'), "selos no cartão");
  const ler = (f) => require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "supabase", f), "utf8");
  assert.ok(ler("fase36-recorrente.sql").includes("create table if not exists public.pedido_series"), "fase 36 aditiva");
  assert.ok(/add column if not exists grupo_id[\s\S]*para_quem[\s\S]*para_nome/.test(ler("fase37-varios-servicos.sql")), "fase 37 aditiva");
});

test("encaixe com vários serviços: cada um com barbeiro, horário e para quem; confere tudo antes de gravar e liga o grupo", async () => {
  const d = A.daquiA(1);
  let ocupados = [{ profissional_id: UUIDS.rafael, horario: "10:40:00", duracao_min: 40 }];
  const chamadas = A.instalarFetch([
    ...A.rotasDeConta(),
    { padrao: /servicos_precos[?]barbearia_id=eq[.][^&]+&nome=eq[.][^&]+&select=nome/, resposta: { corpo: [{ nome: "x" }] } },
    { padrao: /servicos_precos[?]barbearia_id=eq[.][^&]+&nome=eq[.][^&]+&select=preco/, resposta: { corpo: [{ preco: "40" }] } },
    { padrao: /rest[/]v1[/]profissionais[?]id=eq[.]/, resposta: (u) => ({ corpo: [u.includes(UUIDS.rafael) ? { id: UUIDS.rafael, nome: "Rafael" } : { id: UUIDS.bruno, nome: "Bruno" }] }) },
    { padrao: /rest[/]v1[/]barbearias[?]id=eq[.]/, resposta: { corpo: [{ slug: "gw-teste" }] } },
    { padrao: /rest[/]v1[/]clientes[?]id=eq[.]/, resposta: { corpo: [{ id: CLIENTE }] } },
    { padrao: /rest[/]v1[/]bloqueios[?]/, resposta: { corpo: [] } },
    { metodo: "GET", padrao: /rest[/]v1[/]pedidos[?]barbearia_id=eq[.][^&]+&dia=eq[.]/, resposta: () => ({ corpo: ocupados }) },
    { padrao: /rest[/]v1[/]rpc[/]criar_pedido/, resposta: (u, o, c) => ({ corpo: { id: "id-" + c.p.profissional + "-" + c.p.horario.replace(":", "") } }) },
    { metodo: "PATCH", padrao: /rest[/]v1[/]pedidos[?]id=/, resposta: { status: 204 } },
    { padrao: /rest[/]v1[/]pedidos[?]id=eq[.]/, resposta: { corpo: [pedidoBase({ status: "avulso" })] } },
  ]);
  const corpo = {
    acao: "avulso", cliente: "Claudio Melo", clienteId: CLIENTE, dia: d,
    itens: [
      { servico: "Corte", profissionalId: UUIDS.bruno, horario: "10:40", duracao: 40 },
      { servico: "Barba", profissionalId: UUIDS.bruno, horario: "11:20", duracao: 30 },
      { servico: "Corte infantil", profissionalId: UUIDS.rafael, horario: "10:40", duracao: 40, paraQuem: "filho", paraNome: "Pedro" },
    ],
  };
  let r = await A.chamar(pedido, { metodo: "POST", corpo, token: "token-dono" });
  assert.equal(r.statusCode, 409, "o Rafael já tem cliente às 10:40");
  assert.deepEqual([r.body.conflito, r.body.podeSobrepor], [true, true]);
  assert.match(r.body.message, /^Rafael: este horário já está ocupado/);
  assert.ok(!chamadas.some((c) => c.url.includes("criar_pedido")), "nada gravado antes de conferir tudo");
  ocupados = [];
  r = await A.chamar(pedido, { metodo: "POST", corpo, token: "token-dono" });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.equal(r.body.criados, 3);
  const criados = chamadas.filter((c) => c.url.includes("criar_pedido")).map((c) => [c.corpo.p.servico, c.corpo.p.profissional, c.corpo.p.horario, c.corpo.p.duracao_min, c.corpo.p.cliente]);
  assert.deepEqual(criados, [["Corte", "Bruno", "10:40", 40, "Claudio Melo"], ["Barba", "Bruno", "11:20", 30, "Claudio Melo"], ["Corte infantil", "Rafael", "10:40", 40, "Claudio Melo"]]);
  const patches = chamadas.filter((c) => c.metodo === "PATCH");
  assert.deepEqual(patches.find((c) => c.corpo.para_quem).corpo, { cliente_id: CLIENTE, para_quem: "filho", para_nome: "Pedro" }, "o do filho fica na ficha do pai, com o nome dele");
  assert.ok(patches.some((c) => c.corpo.grupo_id && c.url.includes("id=in.(")), "os três no mesmo grupo");
  // Duas linhas com o mesmo barbeiro se sobrepondo também pedem confirmação
  r = await A.chamar(pedido, { metodo: "POST", corpo: { ...corpo, itens: [corpo.itens[0], { ...corpo.itens[1], horario: "11:00" }] }, token: "token-dono" });
  assert.equal(r.statusCode, 409);
  assert.match(r.body.message, /^Bruno: este horário já está ocupado \(das 10:40\)/);
  // No máximo 6 serviços por vez
  r = await A.chamar(pedido, { metodo: "POST", corpo: { ...corpo, itens: Array.from({ length: 7 }, () => corpo.itens[0]) }, token: "token-dono" });
  assert.equal(r.statusCode, 400);
});
