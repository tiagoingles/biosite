// Produtos da barbearia (fase 19): preço de compra e de venda, estoque fácil, venda pelo barbeiro,
// alerta de estoque baixo e o Financeiro com bruto, custo e lucro.
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("./ajuda");
const equipe = require("../api/equipe");
const { calcularFinanceiro } = require("../lib/financeiro-calculo");
const { dinheiro } = require("../lib/produtos");

const { UUIDS } = A;
const POMADA = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const OLEO = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";

function rotas(o = {}) {
  return [
    {
      metodo: "GET",
      padrao: /\/rest\/v1\/produtos\?barbearia_id=eq\.[^&]+&select=/,
      resposta: { corpo: [
        { id: POMADA, nome: "Pomada", custo: "18.00", preco: "35.00", estoque: 2, estoque_minimo: 3, foto: "", ativo: true },
        { id: OLEO, nome: "Óleo para barba", custo: null, preco: "40.00", estoque: 10, estoque_minimo: 2, foto: "", ativo: true },
      ] },
    },
    { metodo: "GET", padrao: /\/rest\/v1\/produtos\?barbearia_id=eq\.[^&]+&nome=eq\./, resposta: (url) => ({ corpo: url.includes("Pomada") ? [{ id: POMADA }] : [] }) },
    { metodo: "GET", padrao: /\/rest\/v1\/produtos\?id=eq\./, resposta: (url) => ({ corpo: url.includes(POMADA) && url.includes(UUIDS.barbearia) ? [{ id: POMADA, nome: "Pomada", ativo: o.inativo ? false : true, estoque: 2, estoque_minimo: 3 }] : [] }) },
    { metodo: "POST", padrao: /\/rest\/v1\/produtos$/, resposta: (u, op, corpo) => ({ status: 201, corpo: [{ id: OLEO, ...corpo }] }) },
    { metodo: "PATCH", padrao: /\/rest\/v1\/produtos\?id=eq\./, resposta: { status: 204 } },
    { metodo: "GET", padrao: /\/rest\/v1\/produto_movimentos\?/, resposta: { corpo: [
      { produto_id: POMADA, quantidade: -2, preco_unit: "35.00", custo_unit: "18.00", profissional_id: UUIDS.bruno },
      { produto_id: OLEO, quantidade: -1, preco_unit: "40.00", custo_unit: null, profissional_id: UUIDS.rafael },
    ] } },
    { padrao: /\/rest\/v1\/rpc\/produto_movimentar/, resposta: (u, op, corpo) => ({ corpo: o.rpc ? o.rpc(corpo.p) : { estoque: 5, minimo: 3, cruzou: false } }) },
    { padrao: /\/rest\/v1\/profissionais\?id=eq\./, resposta: (url) => ({ corpo: url.includes(UUIDS.rafael) ? [{ id: UUIDS.rafael }] : [] }) },
    ...A.rotasDeConta(),
  ];
}
const post = (corpo, token = "token-dono") => A.chamar(equipe, { metodo: "POST", query: { area: "produtos" }, token, corpo });

test("valores em reais: vírgula, ponto de milhar e número", () => {
  assert.equal(dinheiro("35,5"), 35.5);
  assert.equal(dinheiro("1.234,56"), 1234.56);
  assert.equal(dinheiro(18), 18);
  assert.equal(dinheiro(""), null);
  assert.ok(Number.isNaN(dinheiro("abc")));
});

test("dono cadastra produto com preço de compra e de venda; o estoque inicial entra como reposição", async () => {
  const chamadas = A.instalarFetch(rotas());
  const r = await post({ acao: "criar", nome: "Óleo para barba", custo: "22,00", preco: "45", estoque: 12, minimo: 3 });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  const novo = chamadas.find((c) => c.metodo === "POST" && /\/rest\/v1\/produtos$/.test(c.url));
  assert.deepEqual([novo.corpo.custo, novo.corpo.preco, novo.corpo.estoque_minimo], [22, 45, 3]);
  const mov = chamadas.find((c) => c.url.includes("produto_movimentar"));
  assert.deepEqual([mov.corpo.p.tipo, mov.corpo.p.quantidade, mov.corpo.p.custo_unit], ["entrada", 12, 22]);
});

test("cadastro: nome repetido, sem preço de venda ou quantidade quebrada é recusado", async () => {
  A.instalarFetch(rotas());
  assert.equal((await post({ acao: "criar", nome: "Pomada", preco: "35" })).statusCode, 409);
  assert.equal((await post({ acao: "criar", nome: "Gel", preco: "" })).statusCode, 400);
  assert.equal((await post({ acao: "criar", nome: "Gel", preco: "20", estoque: "1,5" })).statusCode, 400);
  assert.equal((await post({ acao: "criar", nome: "Gel", preco: "20" }, "token-bruno")).statusCode, 403, "barbeiro não cadastra");
});

test("lista: o dono vê compra e lucro; o barbeiro só preço, estoque e as vendas dele", async () => {
  A.instalarFetch(rotas());
  let r = await A.chamar(equipe, { query: { area: "produtos" }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const pomada = r.body.produtos.find((p) => p.nome === "Pomada");
  assert.deepEqual([pomada.custo, pomada.lucro, pomada.baixo], [18, 17, true]);
  assert.deepEqual(r.body.baixos.map((b) => b.nome), ["Pomada"], "2 em estoque, mínimo 3");
  assert.deepEqual(r.body.hoje, { unidades: 3, bruto: 110, custo: 36, lucro: 74 });
  r = await A.chamar(equipe, { query: { area: "produtos" }, token: "token-bruno" });
  assert.equal(r.statusCode, 200);
  assert.ok(r.body.produtos.every((p) => p.custo === undefined && p.lucro === undefined), "barbeiro não vê o preço de compra");
  assert.deepEqual(r.body.hoje, { unidades: 2, bruto: 70 }, "só as vendas do Bruno");
});

test("estoque fácil: +1 repõe com o preço de compra, -1 tira sem venda; só o dono", async () => {
  const chamadas = A.instalarFetch(rotas());
  let r = await post({ acao: "estoque", id: POMADA, quantidade: 1 });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(chamadas.filter((c) => c.url.includes("produto_movimentar")).map((c) => [c.corpo.p.tipo, c.corpo.p.quantidade]), [["entrada", 1]]);
  r = await post({ acao: "estoque", id: POMADA, quantidade: -1 });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(chamadas.filter((c) => c.url.includes("produto_movimentar")).at(-1).corpo.p.tipo, "ajuste");
  assert.equal((await post({ acao: "estoque", id: POMADA, quantidade: 0 })).statusCode, 400);
  assert.equal((await post({ acao: "estoque", id: POMADA, quantidade: 1 }, "token-bruno")).statusCode, 403);
  assert.equal((await post({ acao: "estoque", id: OLEO.replace("b2", "c3"), quantidade: 1 })).statusCode, 404, "produto de outra barbearia");
});

test("venda: o barbeiro vende em nome dele; chegou ao mínimo, a resposta avisa", async () => {
  const chamadas = A.instalarFetch(rotas({ rpc: () => ({ estoque: 1, minimo: 3, cruzou: true }) }));
  let r = await post({ acao: "vender", id: POMADA, quantidade: 1 }, "token-bruno");
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.equal(r.body.baixo, true);
  const mov = chamadas.find((c) => c.url.includes("produto_movimentar"));
  assert.deepEqual([mov.corpo.p.tipo, mov.corpo.p.quantidade, mov.corpo.p.profissional_id], ["venda", 1, UUIDS.bruno]);
  r = await post({ acao: "vender", id: POMADA, quantidade: 2, profissionalId: UUIDS.rafael });
  assert.equal(r.statusCode, 201);
  assert.equal(chamadas.filter((c) => c.url.includes("produto_movimentar")).at(-1).corpo.p.profissional_id, UUIDS.rafael, "o dono diz quem vendeu");
  assert.equal((await post({ acao: "vender", id: POMADA, quantidade: 0 })).statusCode, 400);
});

test("produto desativado não é vendido", async () => {
  A.instalarFetch(rotas({ inativo: true }));
  assert.equal((await post({ acao: "vender", id: POMADA })).statusCode, 409);
});

test("financeiro: venda de produto entra com bruto, custo e lucro (o custo é o do dia da venda)", () => {
  const hoje = "2026-11-17";
  const f = calcularFinanceiro(hoje, {
    pedidos: [{ dia: hoje, status: "realizado", valor: 50, comissao_pct: 40, profissional_id: "p1" }],
    vendasProdutos: [
      { dia: hoje, quantidade: -2, preco_unit: "35.00", custo_unit: "18.00" },
      { dia: "2026-11-10", quantidade: -1, preco_unit: "40.00", custo_unit: null },
    ],
  });
  const d = f.resumo.dia;
  assert.deepEqual([d.produtos, d.custoProdutos, d.lucroProdutos, d.produtosVendidos], [70, 36, 34, 2]);
  assert.equal(d.entradas, 120, "atendimento + produtos");
  assert.equal(d.lucro, 50 - 20 - d.gastosFixos - 0 + 70 - 36, "lucro desconta comissão e o custo dos produtos");
  assert.equal(f.resumo.ultimos30.produtos, 110);
  assert.equal(f.temProdutos, true);
  assert.equal(f.serie.at(-1).produtos, 70);
});

test("telas: Produtos e estoque no Financeiro, Vender produto nos dois painéis e aviso de repor no Hoje do dono", () => {
  const fs = require("fs");
  const path = require("path");
  const ler = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const fin = ler("financeiro.html");
  assert.match(fin, /id="secProdutos"/);
  assert.match(fin, /area=produtos/);
  assert.match(fin, /Custo dos produtos/, "o cartão do período mostra o custo dos produtos");
  assert.match(fin, /Repor estoque/);
  assert.match(ler("painel-agenda.js"), /P\.venderProduto = venderProduto;/);
  for (const p of ["painel-dono.html", "painel-barbeiro.html"]) assert.match(ler(p), /P\.venderProduto\(ctx\)/, p);
  assert.match(ler("painel-dono.html"), /Hora de repor: /);
  assert.match(ler("lib/pedidos-painel.js"), /estoqueBaixo/);
});

// Fase 31 (pedido do Manolo): forma de pagamento na venda e apagar produto que nunca foi vendido
test("venda com forma de pagamento: vai para o movimento; forma desconhecida é recusada", async () => {
  const chamadas = A.instalarFetch(rotas());
  let r = await post({ acao: "vender", id: POMADA, quantidade: 1, forma_pagamento: "pix" }, "token-bruno");
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  const mov = chamadas.find((c) => c.url.includes("produto_movimentar"));
  assert.equal(mov.corpo.p.forma_pagamento, "pix");
  r = await post({ acao: "vender", id: POMADA, quantidade: 1, forma_pagamento: "cheque" });
  assert.equal(r.statusCode, 400);
});

test("apagar: só o dono e só produto que nunca foi vendido; vendido pede para desativar", async () => {
  let vendas = [{ id: "m1" }];
  const chamadas = A.instalarFetch([
    { metodo: "GET", padrao: /produto_movimentos[?]produto_id=eq[.]/, resposta: () => ({ corpo: vendas }) },
    { metodo: "DELETE", padrao: /rest[/]v1[/]produtos[?]id=eq[.]/, resposta: { status: 204 } },
    ...rotas(),
  ]);
  let r = await post({ acao: "apagar", id: POMADA });
  assert.equal(r.statusCode, 409, "já vendido: fica no histórico do Financeiro");
  assert.match(r.body.message, /Desativar/);
  assert.ok(!chamadas.some((c) => c.metodo === "DELETE"), "não apaga produto vendido");
  vendas = [];
  r = await post({ acao: "apagar", id: POMADA });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const del = chamadas.find((c) => c.metodo === "DELETE");
  assert.ok(del.url.includes(`produtos?id=eq.${POMADA}&barbearia_id=eq.${UUIDS.barbearia}`), "só o desta barbearia");
  assert.equal((await post({ acao: "apagar", id: POMADA }, "token-bruno")).statusCode, 403, "barbeiro não apaga");
  assert.equal((await post({ acao: "apagar", id: OLEO })).statusCode, 404, "produto que não é desta barbearia");
});

test("financeiro por forma de pagamento: atendimentos e produtos somados por forma; sem forma vai para 'sem'", () => {
  const hoje = "2026-11-14";
  const r = calcularFinanceiro(hoje, {
    pedidos: [
      { id: "a", dia: hoje, status: "realizado", valor: 40, forma_pagamento: "pix", comissao_pct: 0, servico: "Corte" },
      { id: "b", dia: hoje, status: "realizado", valor: 30, forma_pagamento: "dinheiro", comissao_pct: 0, servico: "Corte" },
      { id: "c", dia: hoje, status: "realizado", valor: 25, forma_pagamento: null, comissao_pct: 0, servico: "Corte" },
      { id: "d", dia: hoje, status: "nao_realizado", valor: 99, forma_pagamento: "credito", servico: "Corte" },
    ],
    vendasProdutos: [{ id: "v", quantidade: -2, preco_unit: "35.00", custo_unit: "18.00", forma_pagamento: "debito", dia: hoje }],
  });
  assert.deepEqual(r.resumo.dia.porForma, { dinheiro: 30, pix: 40, debito: 70, credito: 0, sem: 25 }, "não realizado não entra");
});
