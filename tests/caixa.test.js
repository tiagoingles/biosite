// Caixa do dia (fase 32, pedido do Manolo): abrir com o troco, retirada e reforço, fechar contando a gaveta.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const A = require("./ajuda");
const equipe = require("../api/equipe");
const { calcularCaixa } = require("../lib/caixa");

const { UUIDS } = A;
const CAIXA = "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0";
const ler = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("conta do caixa: esperado = troco + dinheiro + reforços - retiradas; entradas por forma", () => {
  const r = calcularCaixa(
    { troco: "50.00" },
    [{ tipo: "retirada", valor: "30.00" }, { tipo: "reforco", valor: "20.00" }],
    [
      { status: "realizado", valor: "40", forma_pagamento: "dinheiro" },
      { status: "realizado", valor: "45", forma_pagamento: "pix" },
      { status: "realizado", valor: "30", forma_pagamento: "dinheiro" },
      { status: "confirmado", valor: "99", forma_pagamento: null },
    ],
    [{ quantidade: -1, preco_unit: "35.00", forma_pagamento: "credito" }]
  );
  assert.deepEqual(r.entradas, { dinheiro: 70, pix: 45, debito: 0, credito: 35, sem: 0 });
  assert.equal(r.total, 150);
  assert.equal(r.esperado, 110, "50 + 70 + 20 - 30");
});

function rotas(o = {}) {
  return [
    { metodo: "GET", padrao: /rest[/]v1[/]caixas[?]barbearia_id=eq[.][^&]+&dia=eq[.]/, resposta: () => ({ corpo: o.caixa ? [o.caixa()] : [] }) },
    { metodo: "GET", padrao: /rest[/]v1[/]caixas[?]/, resposta: { corpo: [] } },
    { metodo: "GET", padrao: /rest[/]v1[/]pedidos[?]/, resposta: { corpo: [{ status: "realizado", valor: "40", forma_pagamento: "dinheiro" }, { status: "confirmado", valor: "35", forma_pagamento: null }] } },
    { metodo: "GET", padrao: /rest[/]v1[/]produto_movimentos[?]/, resposta: { corpo: [] } },
    { metodo: "GET", padrao: /rest[/]v1[/]caixa_movimentos[?]/, resposta: { corpo: o.movimentos || [] } },
    { metodo: "POST", padrao: /rest[/]v1[/]caixas$/, resposta: o.criar || { status: 201 } },
    { metodo: "POST", padrao: /rest[/]v1[/]caixa_movimentos$/, resposta: { status: 201 } },
    { metodo: "PATCH", padrao: /rest[/]v1[/]caixas[?]/, resposta: (u, op, corpo) => ({ corpo: [{ id: CAIXA, ...corpo }] }) },
    ...A.rotasDeConta(),
  ];
}
const post = (corpo, token = "token-dono") => A.chamar(equipe, { metodo: "POST", query: { area: "caixa" }, token, corpo });

test("caixa: o dono abre com o troco; abrir de novo no mesmo dia é recusado; barbeiro não mexe", async () => {
  const chamadas = A.instalarFetch(rotas());
  let r = await post({ acao: "abrir", troco: "50,00" });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  const novo = chamadas.find((c) => c.metodo === "POST" && /caixas$/.test(c.url));
  assert.deepEqual([novo.corpo.barbearia_id, novo.corpo.troco, novo.corpo.dia], [UUIDS.barbearia, 50, A.hoje()]);
  A.instalarFetch(rotas({ criar: { status: 409, corpo: { message: "duplicate key value violates unique constraint" } } }));
  r = await post({ acao: "abrir", troco: "50" });
  assert.equal(r.statusCode, 409, JSON.stringify(r.body));
  assert.equal((await post({ acao: "abrir", troco: "50" }, "token-bruno")).statusCode, 403, "o caixa é só do dono");
  assert.equal((await post({ acao: "abrir", troco: "abc" })).statusCode, 400);
});

test("caixa: retirada e reforço só no caixa aberto; fechar grava o esperado, o contado e a foto", async () => {
  let estado = { id: CAIXA, dia: A.hoje(), troco: "50.00", aberto_em: new Date().toISOString(), fechado_em: null };
  const chamadas = A.instalarFetch(rotas({ caixa: () => estado, movimentos: [{ tipo: "retirada", valor: "30.00" }] }));
  let r = await post({ acao: "movimento", tipo: "retirada", valor: "30,00", motivo: "Depósito" });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  const mov = chamadas.find((c) => c.metodo === "POST" && /caixa_movimentos$/.test(c.url));
  assert.deepEqual([mov.corpo.caixa_id, mov.corpo.tipo, mov.corpo.valor, mov.corpo.motivo], [CAIXA, "retirada", 30, "Depósito"]);
  assert.equal((await post({ acao: "movimento", tipo: "saque", valor: "10" })).statusCode, 400);
  assert.equal((await post({ acao: "fechar", contado: "" })).statusCode, 400, "precisa contar a gaveta");
  r = await post({ acao: "fechar", contado: "55,00", observacao: "ok" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { esperado: 60, contado: 55, diferenca: -5 }, "50 de troco + 40 em dinheiro - 30 de retirada; faltaram 5");
  const fecha = chamadas.find((c) => c.metodo === "PATCH");
  assert.ok(fecha.url.includes(`id=eq.${CAIXA}&fechado_em=is.null`), "só fecha o que está aberto");
  assert.deepEqual(fecha.corpo.resumo.entradas, { dinheiro: 40, pix: 0, debito: 0, credito: 0, sem: 0 });
  estado = { ...estado, fechado_em: new Date().toISOString() };
  assert.equal((await post({ acao: "movimento", tipo: "reforco", valor: "10" })).statusCode, 409, "caixa fechado não recebe movimento");
  assert.equal((await post({ acao: "fechar", contado: "55" })).statusCode, 409);
});

test("caixa: a tela recebe as entradas do dia, o esperado e os atendimentos ainda sem encerrar", async () => {
  A.instalarFetch(rotas({ caixa: () => ({ id: CAIXA, dia: A.hoje(), troco: "50.00", aberto_em: new Date().toISOString(), fechado_em: null }) }));
  const r = await A.chamar(equipe, { query: { area: "caixa" }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.esperado, r.body.total, r.body.pendentes, r.body.abertoAntes], [90, 40, 1, null]);
  const fin = ler("financeiro.html");
  assert.ok(fin.includes('id="secCaixa"') && fin.includes('acao: "fechar"') && fin.includes('acao: "abrir"'), "o Financeiro tem o caixa do dia");
  assert.ok(ler("painel-dono.html").includes('"#caixa"'), "atalho no painel do dono");
});
