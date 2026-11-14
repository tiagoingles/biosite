// Clube de assinatura (versão manual): regras e textos, pedido do assinante pelo site,
// planos no site, área do dono (planos, assinantes, pagamento) e comissão fixa.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const A = require("./ajuda");
const clube = require("../lib/clube");
const { comissaoDe } = require("../lib/comissao");
const pedido = require("../api/pedido");
const profissionais = require("../api/profissionais");
const equipe = require("../api/equipe");
const G = require("../lib/gerador");

const { UUIDS } = A;
const DIA = A.daquiA(1);
const PLANO = "aaaaaaaa-0000-4000-8000-000000000001";
const PLANO2 = "aaaaaaaa-0000-4000-8000-000000000002";
const ASSINANTE = "bbbbbbbb-0000-4000-8000-000000000001";
const ASSINANTE2 = "bbbbbbbb-0000-4000-8000-000000000002";
const ASSINANTE3 = "bbbbbbbb-0000-4000-8000-000000000003";
const PAGAMENTO = "cccccccc-0000-4000-8000-000000000001";
const PAGAMENTO2 = "cccccccc-0000-4000-8000-000000000002";

// ---------- regras e textos ----------
test("WhatsApp do assinante fica só com DDD e número de celular", () => {
  assert.equal(clube.normalizarWhats("(81) 99918-6042"), "81999186042");
  assert.equal(clube.normalizarWhats("+55 81 99918-6042"), "81999186042");
  assert.equal(clube.normalizarWhats("081 99918-6042"), "81999186042");
  assert.equal(clube.normalizarWhats("81 9918-6042"), "81999186042", "celular antigo ganha o 9");
  assert.equal(clube.normalizarWhats("81 3333-4444"), "8133334444", "fixo continua com 10 dígitos");
  assert.equal(clube.normalizarWhats("123"), "");
  assert.equal(clube.normalizarWhats(null), "");
});

test("mês seguinte respeita o fim do mês e o ano bissexto", () => {
  assert.equal(clube.maisUmMes("2026-01-31"), "2026-02-28");
  assert.equal(clube.maisUmMes("2028-01-31"), "2028-02-29");
  assert.equal(clube.maisUmMes("2026-12-15"), "2027-01-15");
  assert.equal(clube.maisUmMes("2026-03-10"), "2026-04-10");
});

test("regras do plano em texto curto", () => {
  assert.equal(clube.regrasDe({ intervalo_dias: 7, dias_semana: [1, 2, 3, 4], hora_limite: "17:00" }), "1 vez a cada 7 dias · seg a qui · até 17:00");
  assert.equal(clube.regrasDe({ intervalo_dias: 0, dias_semana: [0, 1, 2, 3, 4, 5, 6], hora_limite: null }), "sem intervalo mínimo");
  assert.equal(clube.regrasDe({ intervalo_dias: 1, dias_semana: [2, 4], hora_limite: null }), "1 vez a cada 1 dia · ter, qui");
});

test("mensagens do banco viram texto para o cliente", () => {
  assert.match(clube.mensagemDoClube({ motivo: "intervalo", data: "2026-11-20" }), /liberado a partir de 20\/11/);
  assert.match(clube.mensagemDoClube({ motivo: "vencido", data: "2026-11-05" }), /venceu em 05\/11/);
  assert.match(clube.mensagemDoClube({ motivo: "aberto", data: "2026-11-18" }), /marcado para 18\/11/);
  assert.match(clube.mensagemDoClube({ motivo: "horario", limite: "17:00" }), /antes das 17:00/);
  assert.match(clube.mensagemDoClube({ motivo: "dia" }), /dia da semana/);
  assert.match(clube.mensagemDoClube({ motivo: "servico" }), /não faz parte do seu plano/);
  assert.match(clube.mensagemDoClube({ motivo: "inativo" }), /pausada ou cancelada/);
});

test("comissão: fixa no atendimento do clube, porcentagem nos outros", () => {
  assert.equal(comissaoDe({ valor: 0, comissao_pct: 40, comissao_valor: 15 }), 15);
  assert.equal(comissaoDe({ valor: 50, comissao_pct: 40, comissao_valor: null }), 20);
  assert.equal(comissaoDe({ valor: 50, comissao_pct: 40 }), 20);
  assert.equal(comissaoDe({ valor: null, comissao_pct: null }), 0);
  assert.equal(comissaoDe({ valor: 50, comissao_pct: 40, comissao_valor: 0 }), 0, "comissão fixa zero vale");
});

// ---------- pedido do assinante pelo site ----------
function rotasDoSite({ assinante = { id: ASSINANTE, nome: "Pedro Henrique", status: "ativo", clube_planos: { servicos: ["Corte Degradê", "Barba"] } }, rpc = () => ({ corpo: { id: UUIDS.pedido, clube: true } }), tentativas = 0 } = {}) {
  return [
    { padrao: /\/rest\/v1\/rpc\/contar_tentativa/, resposta: { corpo: tentativas } },
    ...A.rotasDeConta(),
    { padrao: /\/rest\/v1\/barbearias\?slug=eq\.gw-teste/, resposta: { corpo: [{ id: UUIDS.barbearia }] } },
    { padrao: /\/rest\/v1\/clube_assinantes\?barbearia_id=eq\./, resposta: (url) => ({ corpo: assinante && url.includes("whatsapp=eq.81999186042") ? [assinante] : [] }) },
    { padrao: /\/rest\/v1\/profissionais\?barbearia_id=eq\./, resposta: { corpo: [{ id: UUIDS.bruno, nome: "Bruno" }] } },
    { padrao: /\/rest\/v1\/agenda_dia\?profissional_id=eq\./, resposta: { corpo: [{ inicio: "09:00:00", fim: "18:00:00", almoco_inicio: null, almoco_fim: null, confirmada_em: "2026-11-01T10:00:00Z" }] } },
    { padrao: /\/rest\/v1\/bloqueios\?/, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/pedidos\?profissional_id=eq\./, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/servicos_precos\?barbearia_id=eq\./, resposta: { corpo: [{ preco: "40.00" }] } },
    { padrao: /\/rest\/v1\/rpc\/criar_pedido/, resposta: (u, o, corpo) => rpc(corpo) },
  ];
}
const pedidoDoClube = (extra = {}) => ({ slug: "gw-teste", servico: "corte degrade", profissionalId: UUIDS.bruno, profissional: "Bruno", dia: DIA, horario: "10:00", cliente: "Pedrinho", duracao: 30, clube: true, clubeWhatsapp: "(81) 99918-6042", ...extra });
let ip = 10;
const novoIp = () => ({ "x-real-ip": "198.51.100." + ip++ });

test("assinante marca pelo site: grava com o id da assinatura e o serviço escrito como no plano", async () => {
  const chamadas = A.instalarFetch(rotasDoSite());
  const r = await A.chamar(pedido, { metodo: "POST", corpo: pedidoDoClube(), headers: novoIp() });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.equal(r.body.clube, true);
  const rpc = chamadas.find((c) => c.url.includes("rpc/criar_pedido"));
  assert.equal(rpc.corpo.p.clube_assinante_id, ASSINANTE);
  assert.equal(rpc.corpo.p.servico, "Corte Degradê");
  assert.ok(chamadas.some((c) => c.url.includes("whatsapp=eq.81999186042")), "procura pelo número normalizado");
});

test("pedido normal não procura assinatura nem manda id do clube", async () => {
  const chamadas = A.instalarFetch(rotasDoSite());
  const r = await A.chamar(pedido, { metodo: "POST", corpo: pedidoDoClube({ clube: false, clubeWhatsapp: "" }), headers: novoIp() });
  assert.equal(r.statusCode, 201);
  assert.equal(r.body.clube, false);
  assert.equal(chamadas.filter((c) => c.url.includes("clube_assinantes")).length, 0);
  assert.equal(chamadas.find((c) => c.url.includes("rpc/criar_pedido")).corpo.p.clube_assinante_id, null);
});

test("WhatsApp do clube inválido é recusado antes de consultar o banco", async () => {
  const chamadas = A.instalarFetch(rotasDoSite());
  const r = await A.chamar(pedido, { metodo: "POST", corpo: pedidoDoClube({ clubeWhatsapp: "123" }), headers: novoIp() });
  assert.equal(r.statusCode, 400);
  assert.equal(r.body.clube, true);
  assert.equal(chamadas.filter((c) => c.url.includes("/rest/v1/")).length, 0);
});

test("número sem assinatura conta como tentativa errada e não grava pedido", async () => {
  const chamadas = A.instalarFetch(rotasDoSite({ assinante: null }));
  const r = await A.chamar(pedido, { metodo: "POST", corpo: pedidoDoClube(), headers: novoIp() });
  assert.equal(r.statusCode, 422);
  assert.equal(r.body.clube, true);
  assert.match(r.body.message, /Não encontramos assinatura/);
  const registro = chamadas.find((c) => c.url.includes("rpc/contar_tentativa") && c.corpo.p_registrar === true);
  assert.ok(registro, "registra a tentativa errada");
  assert.match(registro.corpo.p_chave, /^clube:/);
  assert.equal(chamadas.filter((c) => c.url.includes("criar_pedido")).length, 0);
});

test("muitas tentativas erradas bloqueiam a consulta por 15 minutos", async () => {
  const chamadas = A.instalarFetch(rotasDoSite({ tentativas: 10 }));
  const r = await A.chamar(pedido, { metodo: "POST", corpo: pedidoDoClube(), headers: novoIp() });
  assert.equal(r.statusCode, 429);
  assert.equal(r.body.clube, true);
  assert.equal(chamadas.filter((c) => c.url.includes("clube_assinantes")).length, 0);
});

test("regra do plano recusada pelo banco vira mensagem clara (422)", async () => {
  A.instalarFetch(rotasDoSite({ rpc: () => ({ corpo: { erro: "clube", motivo: "intervalo", data: "2026-11-20" } }) }));
  const r = await A.chamar(pedido, { metodo: "POST", corpo: pedidoDoClube(), headers: novoIp() });
  assert.equal(r.statusCode, 422);
  assert.equal(r.body.clube, true);
  assert.match(r.body.message, /liberado a partir de 20\/11/);
});

// ---------- planos no site ----------
test("site recebe os planos ativos com as regras em texto", async () => {
  A.instalarFetch([
    { padrao: /\/rest\/v1\/barbearias\?slug=eq\.gw-teste/, resposta: { corpo: [{ id: UUIDS.barbearia }] } },
    { padrao: /\/rest\/v1\/profissionais\?barbearia_id=eq\./, resposta: { corpo: [{ id: UUIDS.bruno, nome: "Bruno", foto_url: null }] } },
    { padrao: /\/rest\/v1\/servicos_precos\?barbearia_id=eq\./, resposta: { corpo: [{ nome: "Corte", preco: "40.00" }] } },
    { padrao: /\/rest\/v1\/clube_planos\?barbearia_id=eq\..*ativo=eq\.true/, resposta: { corpo: [{ id: PLANO, nome: "Corte ilimitado", descricao: "", preco: "99.90", servicos: ["Corte"], intervalo_dias: 7, dias_semana: [1, 2, 3, 4], hora_limite: "17:00" }] } },
  ]);
  const r = await A.chamar(profissionais, { query: { slug: "gw-teste" } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.clube.planos.length, 1);
  assert.equal(r.body.clube.planos[0].preco, 99.9);
  assert.equal(r.body.clube.planos[0].regras, "Inclui Corte · 1 vez a cada 7 dias · seg a qui · até 17:00");
  assert.equal(r.body.precos.Corte, 40);
});

test("site continua agendando se a consulta do clube falhar", async () => {
  A.instalarFetch([
    { padrao: /\/rest\/v1\/barbearias\?slug=eq\.gw-teste/, resposta: { corpo: [{ id: UUIDS.barbearia }] } },
    { padrao: /\/rest\/v1\/profissionais\?barbearia_id=eq\./, resposta: { corpo: [{ id: UUIDS.bruno, nome: "Bruno", foto_url: null }] } },
    { padrao: /\/rest\/v1\/servicos_precos\?barbearia_id=eq\./, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/clube_planos/, resposta: { status: 500, corpo: { message: "falhou" } } },
  ]);
  const original = console.error;
  console.error = () => {};
  try {
    const r = await A.chamar(profissionais, { query: { slug: "gw-teste" } });
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.clube, null);
    assert.equal(r.body.profissionais.length, 1);
  } finally {
    console.error = original;
  }
});

// ---------- área do dono ----------
function rotasDoDono(extra = []) {
  return [...extra, ...A.rotasDeConta(), { padrao: /\/rest\/v1\/barbearias\?id=eq\./, resposta: { corpo: [{ id: UUIDS.barbearia, slug: "gw-teste", nome: "GW" }] } }];
}

test("só o dono cuida do clube", async () => {
  A.instalarFetch(rotasDoDono());
  const semLogin = await A.chamar(equipe, { query: { area: "clube" } });
  assert.equal(semLogin.statusCode, 401);
  const barbeiro = await A.chamar(equipe, { query: { area: "clube" }, token: "token-bruno" });
  assert.equal(barbeiro.statusCode, 403);
});

test("painel do clube: vencidos, uso no mês, receita e resultado", async () => {
  const hoje = A.hoje();
  A.instalarFetch(rotasDoDono([
    { padrao: /\/rest\/v1\/clube_planos\?barbearia_id=eq\./, resposta: { corpo: [
      { id: PLANO, nome: "Corte ilimitado", descricao: "", preco: "99.90", servicos: ["Corte"], intervalo_dias: 7, dias_semana: [1, 2, 3, 4], hora_limite: null, comissao_valor: "15.00", ativo: true },
      { id: PLANO2, nome: "Corte + barba", descricao: "", preco: "149.90", servicos: ["Corte", "Barba"], intervalo_dias: 14, dias_semana: [0, 1, 2, 3, 4, 5, 6], hora_limite: null, comissao_valor: "25.00", ativo: true },
    ] } },
    { padrao: /\/rest\/v1\/clube_assinantes\?barbearia_id=eq\./, resposta: { corpo: [
      { id: ASSINANTE, plano_id: PLANO, nome: "Pedro", whatsapp: "81999990001", status: "ativo", pago_ate: A.daquiA(10), observacao: "" },
      { id: ASSINANTE2, plano_id: PLANO2, nome: "Thiago", whatsapp: "81999990002", status: "ativo", pago_ate: A.daquiA(-1), observacao: "" },
      { id: ASSINANTE3, plano_id: PLANO, nome: "Rodrigo", whatsapp: "81999990003", status: "pausado", pago_ate: A.daquiA(-30), observacao: "" },
    ] } },
    { padrao: /\/rest\/v1\/servicos_precos\?barbearia_id=eq\./, resposta: { corpo: [{ nome: "Barba" }, { nome: "Corte" }] } },
    { padrao: /\/rest\/v1\/pedidos\?barbearia_id=eq\..*clube_assinante_id=not\.is\.null/, resposta: { corpo: [
      { clube_assinante_id: ASSINANTE, dia: hoje, status: "realizado", motivo: null, comissao_valor: "15.00" },
      { clube_assinante_id: ASSINANTE, dia: A.daquiA(7), status: "confirmado", motivo: null, comissao_valor: "15.00" },
    ] } },
    // Do mais novo para o mais antigo: Pedro pagou hoje (com desconto); Thiago pagou há 40 dias (fora do mês)
    { padrao: /\/rest\/v1\/clube_pagamentos\?barbearia_id=eq\./, resposta: { corpo: [
      { id: PAGAMENTO, assinante_id: ASSINANTE, valor: "89.90", data: hoje, pago_ate_antes: hoje, pago_ate_depois: A.daquiA(10) },
      { id: PAGAMENTO2, assinante_id: ASSINANTE2, valor: "149.90", data: A.daquiA(-40), pago_ate_antes: null, pago_ate_depois: A.daquiA(-1) },
    ] } },
  ]));
  const r = await A.chamar(equipe, { query: { area: "clube" }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const k = r.body.kpis;
  assert.equal(k.ativos, 2);
  assert.equal(k.vencidos, 1);
  assert.equal(k.receitaMensal, 249.8, "o que os ativos pagam por mês");
  assert.equal(k.recebidoMes, 89.9, "o que entrou de fato no mês");
  assert.equal(k.pagamentosMes, 1);
  assert.equal(k.usosMes, 1);
  assert.equal(k.comissoesMes, 15);
  assert.equal(k.resultadoMes, 74.9, "recebido no mês menos as comissões do clube");
  const pedro = r.body.assinantes.find((a) => a.id === ASSINANTE);
  assert.equal(pedro.usosMes, 1);
  assert.equal(pedro.ultimoUso, hoje);
  assert.equal(pedro.emAberto, A.daquiA(7));
  assert.equal(pedro.liberaEm, A.daquiA(7));
  assert.deepEqual(pedro.pagamentos, [{ id: PAGAMENTO, valor: 89.9, data: hoje, pago_ate_antes: hoje, pago_ate_depois: A.daquiA(10) }]);
  assert.equal(r.body.assinantes.find((a) => a.id === ASSINANTE3).pagamentos.length, 0);
  assert.equal(r.body.assinantes.find((a) => a.id === ASSINANTE2).vencido, true);
  assert.equal(r.body.assinantes.find((a) => a.id === ASSINANTE3).vencido, false, "pausado não conta como vencido");
  assert.equal(r.body.planos[0].assinantes, 1);
  assert.equal(r.body.planos[0].regras, "1 vez a cada 7 dias · seg a qui");
  assert.equal(r.body.slug, "gw-teste");
});

test("plano usa só serviços cadastrados no Financeiro, com o nome de lá", async () => {
  const chamadas = A.instalarFetch(rotasDoDono([
    { padrao: /\/rest\/v1\/servicos_precos\?barbearia_id=eq\./, resposta: { corpo: [{ nome: "Corte Degradê" }, { nome: "Barba" }] } },
    { metodo: "POST", padrao: /\/rest\/v1\/clube_planos$/, resposta: (u, o, corpo) => ({ status: 201, corpo: [{ id: PLANO, ...corpo }] }) },
  ]));
  const plano = { acao: "plano-salvar", nome: "Corte livre", preco: "99,90", servicos: ["corte degrade"], intervalo_dias: 7, dias_semana: [1, 2, 3], hora_limite: "17:00", comissao_valor: "15" };
  const r = await A.chamar(equipe, { metodo: "POST", query: { area: "clube" }, token: "token-dono", corpo: plano });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  const gravado = chamadas.find((c) => c.metodo === "POST" && /clube_planos$/.test(c.url)).corpo;
  assert.deepEqual(gravado.servicos, ["Corte Degradê"]);
  assert.equal(gravado.preco, 99.9);
  assert.equal(gravado.comissao_valor, 15);
  assert.equal(gravado.barbearia_id, UUIDS.barbearia);
  assert.deepEqual(gravado.dias_semana, [1, 2, 3]);

  const fora = await A.chamar(equipe, { metodo: "POST", query: { area: "clube" }, token: "token-dono", corpo: { ...plano, servicos: ["Sobrancelha"] } });
  assert.equal(fora.statusCode, 400);
  assert.match(fora.body.message, /não cadastrado no Financeiro: Sobrancelha/);

  for (const [mudanca, msg] of [[{ nome: "X" }, /nome/], [{ preco: "0" }, /preço/], [{ servicos: [] }, /serviço/], [{ dias_semana: [] }, /dia da semana/], [{ hora_limite: "25:00" }, /Hora limite/], [{ intervalo_dias: 90 }, /intervalo/]]) {
    const r2 = await A.chamar(equipe, { metodo: "POST", query: { area: "clube" }, token: "token-dono", corpo: { ...plano, ...mudanca } });
    assert.equal(r2.statusCode, 400, JSON.stringify(mudanca));
    assert.match(r2.body.message, msg);
  }
});

test("assinante: WhatsApp normalizado e sem número repetido", async () => {
  let existentes = [];
  const chamadas = A.instalarFetch(rotasDoDono([
    { padrao: /\/rest\/v1\/clube_planos\?id=eq\./, resposta: { corpo: [{ id: PLANO }] } },
    { metodo: "GET", padrao: /\/rest\/v1\/clube_assinantes\?barbearia_id=eq\..*whatsapp=eq\./, resposta: () => ({ corpo: existentes }) },
    { metodo: "POST", padrao: /\/rest\/v1\/clube_assinantes$/, resposta: (u, o, corpo) => ({ status: 201, corpo: [{ id: ASSINANTE, ...corpo }] }) },
  ]));
  const novo = { acao: "assinante-salvar", nome: "Pedro Henrique", whatsapp: "+55 (81) 9918-6042", plano_id: PLANO, pago_ate: A.daquiA(30) };
  const r = await A.chamar(equipe, { metodo: "POST", query: { area: "clube" }, token: "token-dono", corpo: novo });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  const gravado = chamadas.find((c) => c.metodo === "POST" && /clube_assinantes$/.test(c.url)).corpo;
  assert.equal(gravado.whatsapp, "81999186042");
  assert.equal(gravado.status, "ativo");
  assert.equal(gravado.barbearia_id, UUIDS.barbearia);

  existentes = [{ id: ASSINANTE2 }];
  const repetido = await A.chamar(equipe, { metodo: "POST", query: { area: "clube" }, token: "token-dono", corpo: novo });
  assert.equal(repetido.statusCode, 409);

  const semNumero = await A.chamar(equipe, { metodo: "POST", query: { area: "clube" }, token: "token-dono", corpo: { ...novo, whatsapp: "999" } });
  assert.equal(semNumero.statusCode, 400);
});

// O banco (clube_registrar_pagamento) grava o pagamento e soma 1 mês ao vencimento na mesma operação
function rotasDoPagamento(extra = []) {
  return rotasDoDono([
    { metodo: "GET", padrao: /\/rest\/v1\/clube_assinantes\?id=eq\./, resposta: (url) => ({ corpo: url.includes(ASSINANTE) ? [{ id: ASSINANTE, clube_planos: { preco: "99.90" } }] : [] }) },
    ...extra,
  ]);
}

test("\"Recebi\" grava o pagamento com o preço do plano ou o valor digitado", async () => {
  const pagoAte = clube.maisUmMes(A.daquiA(10));
  for (const [valor, esperado] of [[undefined, 99.9], ["", 99.9], ["79,90", 79.9], ["1.299,90", 1299.9], ["0", 0]]) {
    const chamadas = A.instalarFetch(rotasDoPagamento([
      { metodo: "POST", padrao: /\/rest\/v1\/rpc\/clube_registrar_pagamento$/, resposta: (u, o, corpo) => ({ corpo: { id: PAGAMENTO, valor: corpo.p_valor, data: A.hoje(), pago_ate: pagoAte } }) },
    ]));
    const r = await A.chamar(equipe, { metodo: "POST", query: { area: "clube" }, token: "token-dono", corpo: { acao: "assinante-pagou", id: ASSINANTE, valor } });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    const rpc = chamadas.find((c) => /clube_registrar_pagamento/.test(c.url)).corpo;
    assert.deepEqual(rpc, { p_barbearia: UUIDS.barbearia, p_assinante: ASSINANTE, p_valor: esperado }, String(valor));
    assert.equal(r.body.pago_ate, pagoAte);
    assert.deepEqual(r.body.pagamento, { id: PAGAMENTO, valor: esperado, data: A.hoje() });
    assert.ok(!chamadas.some((c) => c.metodo === "PATCH"), "o vencimento muda só dentro da função do banco");
  }
});

test("\"Recebi\" recusa valor inválido e assinante de outra barbearia", async () => {
  const chamadas = A.instalarFetch(rotasDoPagamento([
    { metodo: "POST", padrao: /\/rest\/v1\/rpc\/clube_registrar_pagamento$/, resposta: { corpo: { erro: "assinante" } } },
  ]));
  for (const valor of ["abc", "-5", "10000"]) {
    const r = await A.chamar(equipe, { metodo: "POST", query: { area: "clube" }, token: "token-dono", corpo: { acao: "assinante-pagou", id: ASSINANTE, valor } });
    assert.equal(r.statusCode, 400, valor);
    assert.match(r.body.message, /valor recebido/);
  }
  const outro = await A.chamar(equipe, { metodo: "POST", query: { area: "clube" }, token: "token-dono", corpo: { acao: "assinante-pagou", id: ASSINANTE2 } });
  assert.equal(outro.statusCode, 404, "a busca do assinante já filtra pela barbearia do dono");
  assert.ok(chamadas.filter((c) => c.metodo === "GET" && /clube_assinantes\?id=eq\./.test(c.url)).every((c) => c.url.includes("barbearia_id=eq." + UUIDS.barbearia)));
  const sumiu = await A.chamar(equipe, { metodo: "POST", query: { area: "clube" }, token: "token-dono", corpo: { acao: "assinante-pagou", id: ASSINANTE } });
  assert.equal(sumiu.statusCode, 404, "o banco também confere a barbearia");
  const semId = await A.chamar(equipe, { metodo: "POST", query: { area: "clube" }, token: "token-dono", corpo: { acao: "assinante-pagou", id: "x" } });
  assert.equal(semId.statusCode, 400);
});

test("desfazer o último pagamento: só o que o dono está vendo", async () => {
  let resposta = { ok: true, valor: 89.9, pago_ate: A.daquiA(-2) };
  const chamadas = A.instalarFetch(rotasDoDono([
    { metodo: "POST", padrao: /\/rest\/v1\/rpc\/clube_desfazer_pagamento$/, resposta: () => ({ corpo: resposta }) },
  ]));
  const corpo = { acao: "assinante-desfazer-pagamento", id: ASSINANTE, pagamento: PAGAMENTO };
  let r = await A.chamar(equipe, { metodo: "POST", query: { area: "clube" }, token: "token-dono", corpo });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { pago_ate: A.daquiA(-2), valor: 89.9, manteve: false });
  assert.deepEqual(chamadas.find((c) => /clube_desfazer_pagamento/.test(c.url)).corpo, { p_barbearia: UUIDS.barbearia, p_assinante: ASSINANTE, p_pagamento: PAGAMENTO });

  resposta = { ok: true, valor: 89.9, pago_ate: A.daquiA(40), manteve: true };
  r = await A.chamar(equipe, { metodo: "POST", query: { area: "clube" }, token: "token-dono", corpo });
  assert.equal(r.body.manteve, true, "vencimento mudado à mão depois do pagamento fica como está");

  resposta = { erro: "ultimo" };
  r = await A.chamar(equipe, { metodo: "POST", query: { area: "clube" }, token: "token-dono", corpo });
  assert.equal(r.statusCode, 409);
  resposta = { erro: "assinante" };
  r = await A.chamar(equipe, { metodo: "POST", query: { area: "clube" }, token: "token-dono", corpo });
  assert.equal(r.statusCode, 404);
  r = await A.chamar(equipe, { metodo: "POST", query: { area: "clube" }, token: "token-dono", corpo: { ...corpo, pagamento: "1" } });
  assert.equal(r.statusCode, 400);
  const barbeiro = await A.chamar(equipe, { metodo: "POST", query: { area: "clube" }, token: "token-bruno", corpo });
  assert.equal(barbeiro.statusCode, 403);
});

test("cadastro de quem acabou de pagar já registra a 1ª mensalidade", async () => {
  let rpcFalha = false;
  const chamadas = A.instalarFetch(rotasDoDono([
    { padrao: /\/rest\/v1\/clube_planos\?id=eq\./, resposta: { corpo: [{ id: PLANO, preco: "99.90" }] } },
    { metodo: "GET", padrao: /\/rest\/v1\/clube_assinantes\?barbearia_id=eq\..*whatsapp=eq\./, resposta: { corpo: [] } },
    { metodo: "POST", padrao: /\/rest\/v1\/clube_assinantes$/, resposta: (u, o, corpo) => ({ status: 201, corpo: [{ id: ASSINANTE, ...corpo }] }) },
    { metodo: "POST", padrao: /\/rest\/v1\/rpc\/clube_registrar_pagamento$/, resposta: (u, o, corpo) => (rpcFalha ? { status: 500, corpo: { message: "falhou" } } : { corpo: { id: PAGAMENTO, valor: corpo.p_valor, data: A.hoje(), pago_ate: clube.maisUmMes(A.hoje()) } }) },
  ]));
  const novo = { acao: "assinante-salvar", nome: "Pedro Henrique", whatsapp: "81999186042", plano_id: PLANO, pago_ate: A.daquiA(90), recebeu: true, valor: "89,90" };
  const r = await A.chamar(equipe, { metodo: "POST", query: { area: "clube" }, token: "token-dono", corpo: novo });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  const gravado = chamadas.find((c) => c.metodo === "POST" && /clube_assinantes$/.test(c.url)).corpo;
  assert.equal(gravado.pago_ate, null, "o vencimento sai do pagamento, não da data digitada");
  assert.deepEqual(chamadas.find((c) => /clube_registrar_pagamento/.test(c.url)).corpo, { p_barbearia: UUIDS.barbearia, p_assinante: ASSINANTE, p_valor: 89.9 });
  assert.equal(r.body.assinante.pago_ate, clube.maisUmMes(A.hoje()));
  assert.ok(!r.body.aviso);

  // Sem valor: o preço do plano. Valor inválido: recusa antes de cadastrar.
  const semValor = await A.chamar(equipe, { metodo: "POST", query: { area: "clube" }, token: "token-dono", corpo: { ...novo, valor: "" } });
  assert.equal(semValor.statusCode, 201);
  assert.equal(chamadas.filter((c) => /clube_registrar_pagamento/.test(c.url)).pop().corpo.p_valor, 99.9);
  const antes = chamadas.length;
  const invalido = await A.chamar(equipe, { metodo: "POST", query: { area: "clube" }, token: "token-dono", corpo: { ...novo, valor: "abc" } });
  assert.equal(invalido.statusCode, 400);
  assert.ok(!chamadas.slice(antes).some((c) => c.metodo === "POST" && /clube_assinantes$/.test(c.url)), "não cadastra sem um valor válido");

  // Pagamento falhou depois do cadastro: o cadastro vale e o dono é avisado para usar o "Recebi"
  rpcFalha = true;
  const falhou = await A.chamar(equipe, { metodo: "POST", query: { area: "clube" }, token: "token-dono", corpo: novo });
  assert.equal(falhou.statusCode, 201);
  assert.match(falhou.body.aviso, /Recebi/);

  // Sem marcar "Recebi agora": vale a data digitada e nada vai para o pagamento
  const n = chamadas.length;
  const semPagar = await A.chamar(equipe, { metodo: "POST", query: { area: "clube" }, token: "token-dono", corpo: { ...novo, recebeu: false } });
  assert.equal(semPagar.statusCode, 201);
  const depois = chamadas.slice(n);
  assert.equal(depois.find((c) => c.metodo === "POST" && /clube_assinantes$/.test(c.url)).corpo.pago_ate, A.daquiA(90));
  assert.ok(!depois.some((c) => /clube_registrar_pagamento/.test(c.url)));
});

// ---------- site e painéis ----------
test("site gerado tem a seção do clube escondida e o \"Sou assinante\" no agendamento", () => {
  const cfg = { modelo: "cartao", nome: "GW", slug: "gw-teste", tipo: "barbearia", whatsapp: "81999999999", cor: "#111111", fundo: "#ffffff", texto: "#111111", fonteTitulo: "Poppins", fonteTexto: "Poppins", agenda: { ativo: true, servicos: [{ id: "s1", nome: "Corte", duracao: "30 min", preco: "40,00" }], profissionais: [{ id: "p1", nome: "Bruno", servicos: ["s1"], dias: [1, 2, 3] }] } };
  const html = G.bioHTML(cfg, (u) => u);
  assert.ok(html.includes('<section class="bloco clube" id="clube" hidden>'), "seção começa escondida");
  assert.ok(html.includes("Sou assinante do clube"));
  assert.ok(html.includes("corpo.clubeWhatsapp=zap"), "manda o WhatsApp do clube só quando marcado");
  assert.ok(html.includes("*Assinante do clube*"), "mensagem do WhatsApp avisa a barbearia");
  assert.equal(G.VERSAO, 5);
});

test("painéis mostram o selo do clube e usam a comissão fixa", () => {
  const ler = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
  assert.match(ler("painel-dono.html"), /data-aba="clube"/);
  assert.match(ler("painel-agenda.js"), /Clube · não cobrar/);
  const barbeiro = ler("painel-barbeiro.html");
  assert.ok(!/valor\) \|\| 0\) \* \(Number\(p\.comissao_pct\)/.test(barbeiro), "nada de comissão calculada só pela porcentagem");
  assert.match(barbeiro, /P\.comissao\(p/);
});

test("painel do dono: \"Recebi\" com o valor, 1ª mensalidade no cadastro e desfazer", () => {
  const ler = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
  const dono = ler("painel-dono.html");
  assert.match(dono, /acao: "assinante-pagou", id: a\.id, valor: valor\.value\.trim\(\)/);
  assert.match(dono, /Recebi agora a 1ª mensalidade/);
  assert.match(dono, /acao: "assinante-desfazer-pagamento", id: a\.id, pagamento: pg\.id/);
  assert.match(dono, /Desfazer o último/);
  assert.match(dono, /Recebido no mês/);
  // O aviso com "Desfazer" vem do P.toast com botão
  assert.match(ler("painel-comum.js"), /P\.toast = function \(msg, tipo, botao\)/);
});
