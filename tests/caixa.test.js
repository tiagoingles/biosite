// Caixa do dia (fase 32, pedido do Manolo): abrir com o troco, retirada e reforço, fechar contando a gaveta.
// Fase 35: aba própria no painel do dono, retirada com destino (despesa, vale, dono, guardar), troco para o próximo dia.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const A = require("./ajuda");
const equipe = require("../api/equipe");
const { calcularCaixa } = require("../lib/caixa");

const { UUIDS } = A;
const CAIXA = "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0";
const MOV = "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1";
const BRUNO = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";
const ler = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("conta do caixa: esperado = troco + dinheiro + reforços - retiradas; entradas por forma; retiradas por destino", () => {
  const r = calcularCaixa(
    { troco: "50.00" },
    [{ tipo: "retirada", valor: "30.00", categoria: "despesa" }, { tipo: "retirada", valor: "10.00" }, { tipo: "reforco", valor: "20.00" }],
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
  assert.equal(r.esperado, 100, "50 + 70 + 20 - 30 - 10");
  assert.deepEqual(r.retiradasPor, { despesa: 30, vale: 0, dono: 0, guardar: 10 }, "retirada antiga, sem destino, conta como guardar");
});

function rotas(o = {}) {
  return [
    { metodo: "GET", padrao: /rest[/]v1[/]caixas[?]barbearia_id=eq[.][^&]+&dia=eq[.]/, resposta: () => ({ corpo: o.caixa ? [o.caixa()] : [] }) },
    { metodo: "GET", padrao: /rest[/]v1[/]caixas[?]id=eq[.]/, resposta: () => ({ corpo: o.caixa ? [o.caixa()] : [] }) },
    { metodo: "GET", padrao: /rest[/]v1[/]caixas[?]barbearia_id=eq[.][^&]+&fechado_em=not[.]is[.]null/, resposta: { corpo: o.historico || [] } },
    { metodo: "GET", padrao: /rest[/]v1[/]caixas[?]/, resposta: { corpo: [] } },
    { metodo: "GET", padrao: /rest[/]v1[/]pedidos[?]/, resposta: { corpo: [{ status: "realizado", valor: "40", forma_pagamento: "dinheiro" }, { status: "confirmado", valor: "35", forma_pagamento: null }] } },
    { metodo: "GET", padrao: /rest[/]v1[/]produto_movimentos[?]/, resposta: { corpo: [] } },
    { metodo: "GET", padrao: /rest[/]v1[/]caixa_movimentos[?]id=eq[.]/, resposta: { corpo: o.movimento ? [o.movimento] : [] } },
    { metodo: "GET", padrao: /rest[/]v1[/]caixa_movimentos[?]/, resposta: { corpo: o.movimentos || [] } },
    { metodo: "GET", padrao: /rest[/]v1[/]profissionais[?]id=eq[.]/, resposta: (u) => ({ corpo: u.includes(BRUNO) && u.includes(UUIDS.barbearia) ? [{ id: BRUNO }] : [] }) },
    { metodo: "GET", padrao: /rest[/]v1[/]profissionais[?]barbearia_id=eq[.][^&]+&select=id,nome,ativo/, resposta: { corpo: [{ id: BRUNO, nome: "Bruno", ativo: true }, { id: "e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0", nome: "Saiu", ativo: false }] } },
    { metodo: "POST", padrao: /rest[/]v1[/]caixas$/, resposta: o.criar || { status: 201 } },
    { metodo: "POST", padrao: /rest[/]v1[/]caixa_movimentos$/, resposta: { status: 201 } },
    { metodo: "DELETE", padrao: /rest[/]v1[/]caixa_movimentos[?]/, resposta: { status: 204 } },
    { metodo: "PATCH", padrao: /rest[/]v1[/]caixas[?]/, resposta: (u, op, corpo) => ({ corpo: [{ id: CAIXA, ...corpo }] }) },
    ...A.rotasDeConta(),
  ];
}
const post = (corpo, token = "token-dono") => A.chamar(equipe, { metodo: "POST", query: { area: "caixa" }, token, corpo });
const aberto = () => ({ id: CAIXA, dia: A.hoje(), troco: "50.00", aberto_em: new Date().toISOString(), fechado_em: null });

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

test("caixa: retirada e reforço só no caixa aberto; fechar grava o esperado, o contado, o troco que fica e a foto", async () => {
  let estado = aberto();
  const chamadas = A.instalarFetch(rotas({ caixa: () => estado, movimentos: [{ tipo: "retirada", valor: "30.00", categoria: "guardar" }] }));
  let r = await post({ acao: "movimento", tipo: "retirada", valor: "30,00", motivo: "Depósito", categoria: "guardar" });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  const mov = chamadas.find((c) => c.metodo === "POST" && /caixa_movimentos$/.test(c.url));
  assert.deepEqual([mov.corpo.caixa_id, mov.corpo.tipo, mov.corpo.valor, mov.corpo.motivo, mov.corpo.categoria, mov.corpo.dia], [CAIXA, "retirada", 30, "Depósito", "guardar", A.hoje()]);
  assert.equal((await post({ acao: "movimento", tipo: "saque", valor: "10" })).statusCode, 400);
  assert.equal((await post({ acao: "fechar", contado: "" })).statusCode, 400, "precisa contar a gaveta");
  r = await post({ acao: "fechar", contado: "55,00", observacao: "ok" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { esperado: 60, contado: 55, diferenca: -5, ficaTroco: 50, recolhido: 5 }, "50 de troco + 40 em dinheiro - 30 de retirada; faltaram 5; sem resposta, fica o troco da abertura");
  const fecha = chamadas.find((c) => c.metodo === "PATCH");
  assert.ok(fecha.url.includes(`id=eq.${CAIXA}&fechado_em=is.null`), "só fecha o que está aberto");
  assert.deepEqual(fecha.corpo.resumo.entradas, { dinheiro: 40, pix: 0, debito: 0, credito: 0, sem: 0 });
  assert.deepEqual([fecha.corpo.fica_troco, fecha.corpo.resumo.recolhido, fecha.corpo.resumo.retiradasPor.guardar], [50, 5, 30]);
  estado = { ...estado, fechado_em: new Date().toISOString() };
  assert.equal((await post({ acao: "movimento", tipo: "reforco", valor: "10" })).statusCode, 409, "caixa fechado não recebe movimento");
  assert.equal((await post({ acao: "fechar", contado: "55" })).statusCode, 409);
});

test("caixa: retirada diz para onde foi o dinheiro; vale precisa de um barbeiro da barbearia; reforço não tem destino", async () => {
  const chamadas = A.instalarFetch(rotas({ caixa: aberto }));
  let r = await post({ acao: "movimento", tipo: "retirada", valor: "20" });
  assert.equal(r.statusCode, 400, "sem destino, a retirada não entra");
  assert.match(r.body.message, /para que é a retirada/);
  assert.equal((await post({ acao: "movimento", tipo: "retirada", valor: "20", categoria: "festa" })).statusCode, 400);
  assert.equal((await post({ acao: "movimento", tipo: "retirada", valor: "20", categoria: "vale" })).statusCode, 400, "vale sem barbeiro");
  r = await post({ acao: "movimento", tipo: "retirada", valor: "20", categoria: "vale", profissionalId: "f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0" });
  assert.equal(r.statusCode, 400, "barbeiro de outra barbearia");
  assert.equal(chamadas.filter((c) => c.metodo === "POST" && /caixa_movimentos$/.test(c.url)).length, 0, "nada gravado até aqui");
  r = await post({ acao: "movimento", tipo: "retirada", valor: "50,00", categoria: "vale", profissionalId: BRUNO, motivo: "Adiantamento" });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  r = await post({ acao: "movimento", tipo: "reforco", valor: "30", categoria: "despesa", profissionalId: BRUNO });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  const [vale, reforco] = chamadas.filter((c) => c.metodo === "POST" && /caixa_movimentos$/.test(c.url)).map((c) => c.corpo);
  assert.deepEqual([vale.categoria, vale.profissional_id, vale.valor], ["vale", BRUNO, 50]);
  assert.deepEqual([reforco.categoria, reforco.profissional_id], [null, null], "reforço não leva destino nem barbeiro");
});

test("caixa: o troco que fica não passa do contado; o dono escolhe quanto fica", async () => {
  const chamadas = A.instalarFetch(rotas({ caixa: aberto }));
  let r = await post({ acao: "fechar", contado: "90", ficaTroco: "120" });
  assert.equal(r.statusCode, 400);
  assert.match(r.body.message, /não pode ser maior/);
  assert.equal((await post({ acao: "fechar", contado: "90", ficaTroco: "abc" })).statusCode, 400);
  assert.equal(chamadas.filter((c) => c.metodo === "PATCH").length, 0, "nada fechado");
  r = await post({ acao: "fechar", contado: "90,00", ficaTroco: "20,00" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { esperado: 90, contado: 90, diferenca: 0, ficaTroco: 20, recolhido: 70 });
  // Contou menos que o troco da abertura: sem resposta, fica tudo
  A.instalarFetch(rotas({ caixa: aberto }));
  r = await post({ acao: "fechar", contado: "30" });
  assert.deepEqual([r.body.ficaTroco, r.body.recolhido], [30, 0]);
});

test("caixa: apagar registro errado só com o caixa aberto", async () => {
  let estado = aberto();
  const chamadas = A.instalarFetch(rotas({ caixa: () => estado, movimento: { id: MOV, caixa_id: CAIXA } }));
  assert.equal((await post({ acao: "apagar-movimento", id: "x" })).statusCode, 400);
  let r = await post({ acao: "apagar-movimento", id: MOV });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const apagou = chamadas.find((c) => c.metodo === "DELETE");
  assert.ok(apagou.url.includes(`id=eq.${MOV}`) && apagou.url.includes(`barbearia_id=eq.${UUIDS.barbearia}`), "só o registro desta barbearia");
  estado = { ...estado, fechado_em: new Date().toISOString() };
  r = await post({ acao: "apagar-movimento", id: MOV });
  assert.equal(r.statusCode, 409, "fechado guarda a foto do dia");
  A.instalarFetch(rotas({ caixa: () => estado }));
  assert.equal((await post({ acao: "apagar-movimento", id: MOV })).statusCode, 404);
});

test("caixa: a tela recebe as entradas, o esperado, o troco sugerido, os barbeiros e os atendimentos sem encerrar", async () => {
  const historico = [
    { dia: A.hoje(), contado: "100", esperado: "100", fica_troco: "40", resumo: { total: 300 } },
    { dia: "2026-01-10", contado: "200", esperado: "205", fica_troco: "80", resumo: { total: 410 } },
  ];
  A.instalarFetch(rotas({ caixa: aberto, historico, movimentos: [{ id: MOV, tipo: "retirada", valor: "10", categoria: "vale", profissional_id: BRUNO, criado_em: new Date().toISOString() }] }));
  const r = await A.chamar(equipe, { query: { area: "caixa" }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.esperado, r.body.total, r.body.pendentes, r.body.abertoAntes], [80, 40, 1, null], "50 + 40 - 10 do vale");
  assert.equal(r.body.trocoSugerido, 80, "o troco que ficou no último fechamento antes de hoje");
  assert.deepEqual(r.body.profissionais, [{ id: BRUNO, nome: "Bruno" }], "só barbeiro ativo no vale");
  assert.equal(r.body.movimentos[0].profissional, "Bruno");
  assert.deepEqual(r.body.historico[1], { dia: "2026-01-10", contado: 200, esperado: 205, diferenca: -5, ficaTroco: 80, total: 410 });
});

test("caixa: aba própria no painel do dono; o Financeiro mostra a situação e leva para a aba", () => {
  const dono = ler("painel-dono.html");
  assert.ok(dono.includes('data-aba="caixa"') && dono.includes('data-tela="caixa"') && dono.includes('src="/painel-caixa.js"'), "aba Caixa no menu");
  assert.ok(dono.includes("window.Caixa.montar"), "a aba monta a tela do caixa");
  const aba = ler("painel-caixa.js");
  for (const acao of ["abrir", "movimento", "apagar-movimento", "fechar", "reabrir"]) assert.ok(aba.includes(`acao: "${acao}"`), `a aba faz "${acao}"`);
  assert.ok(aba.includes("ficaTroco") && aba.includes("trocoSugerido"), "troco para o próximo dia");
  for (const k of ["despesa", "vale", "dono", "guardar"]) assert.ok(aba.includes(`${k}: [`), `destino ${k}`);
  const fin = ler("financeiro.html");
  assert.ok(fin.includes('id="secCaixa"') && fin.includes('id="linkCaixa"'), "o Financeiro mostra o caixa de hoje e o link da aba");
  assert.ok(!fin.includes('acao: "fechar"'), "abrir e fechar saíram do Financeiro");
  assert.ok(fin.includes('location.hash === "#caixa"'), "o endereço antigo leva para a aba");
});
