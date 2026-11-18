// Financeiro: períodos, lucro, gráfico e as mensalidades do clube (pagamentos do "Recebi").
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const A = require("./ajuda");
const { calcularFinanceiro, inicioDaLeitura } = require("../lib/financeiro-calculo");
const equipe = require("../api/equipe");

const { UUIDS } = A;
const HOJE = "2026-11-14";

const pedidosBase = [
  { id: "p1", dia: "2026-11-14", status: "realizado", valor: 40, comissao_pct: 40, comissao_valor: null, clube_assinante_id: null, profissional_id: "b1", servico: "Corte" },
  { id: "p3", dia: "2026-11-10", status: "realizado", valor: 60, comissao_pct: 50, comissao_valor: null, clube_assinante_id: null, profissional_id: "b2", servico: "Corte + barba" },
  { id: "p4", dia: "2026-11-10", status: "nao_realizado", valor: 40, comissao_pct: 40, comissao_valor: null, clube_assinante_id: null, profissional_id: "b2", servico: "Corte" },
];
// Atendimento de assinante: não paga no balcão, comissão fixa do plano
const doClube = { id: "p2", dia: "2026-11-14", status: "realizado", valor: 0, comissao_pct: 40, comissao_valor: 15, clube_assinante_id: "a1", profissional_id: "b1", servico: "Corte" };
const pagamentos = [
  { id: "g1", valor: "99.90", data: "2026-11-14" },
  { id: "g2", valor: "89.90", data: "2026-11-03" },
  { id: "g3", valor: "149.90", data: "2026-10-05" }, // só no trimestre
];
const comum = {
  despesas: [{ id: "d1", descricao: "Aluguel", categoria: "aluguel", valor: "300", ativo: true }, { id: "d2", descricao: "Antigo", categoria: "outros", valor: "1000", ativo: false }],
  insumos: [],
  movimentos: [{ id: "m1", insumo_id: "i1", tipo: "entrada", quantidade: 2, valor_total: "50", data: "2026-11-12" }],
  precos: [{ id: "s1", nome: "Corte", preco: 40 }, { id: "s2", nome: "Corte + barba", preco: 60 }],
  profissionais: [{ id: "b1", nome: "Bruno", comissao_pct: 40 }, { id: "b2", nome: "Rafael", comissao_pct: 50 }],
};

test("mensalidades do clube entram no faturamento e no lucro, no dia do registro", () => {
  const f = calcularFinanceiro(HOJE, { ...comum, pedidos: [...pedidosBase, doClube], pagamentosClube: pagamentos });
  const { dia, semana, mes, trimestre, ultimos30 } = f.resumo;

  assert.equal(dia.faturamento, 40, "atendimentos: o do clube vale 0 no balcão");
  assert.equal(dia.clube, 99.9);
  assert.equal(dia.entradas, 139.9);
  assert.equal(dia.atendimentos, 2);
  assert.equal(dia.atendimentosClube, 1);
  assert.equal(dia.pagamentosClube, 1);
  assert.equal(dia.comissoes, 31, "16 da porcentagem + 15 fixos do clube");
  assert.equal(dia.gastosFixos, 10);
  assert.equal(dia.lucro, 98.9, "139,90 − 31 − 10");

  assert.equal(semana.faturamento, 100);
  assert.equal(semana.clube, 99.9);
  assert.equal(semana.naoRealizados, 1);
  assert.equal(semana.lucro, 18.9, "199,90 − 61 de comissões − 70 de fixos − 50 de insumos");

  assert.equal(mes.clube, 189.8);
  assert.equal(mes.pagamentosClube, 2);
  assert.equal(mes.entradas, 289.8);
  assert.equal(mes.lucro, 38.8, "289,80 − 61 − 140 − 50");
  assert.equal(ultimos30.clube, 189.8);
  assert.equal(trimestre.clube, 339.7);
  assert.equal(trimestre.pagamentosClube, 3);

  assert.equal(f.serie.length, 30);
  assert.deepEqual(f.serie[29], { dia: HOJE, faturamento: 40, clube: 99.9, produtos: 0, atendimentos: 2 });
  assert.equal(f.serie.find((s) => s.dia === "2026-11-03").clube, 89.9);
  assert.equal(f.temClube, true);

  // Comissão por barbeiro no mês: a fixa do clube entra para quem atendeu
  assert.deepEqual(f.comissoes.find((c) => c.id === "b1"), { id: "b1", nome: "Bruno", comissaoPct: 40, atendimentos: 2, faturamento: 40, comissao: 31 });
  assert.deepEqual(f.servicosSemPreco, []);
});

test("sem clube, o Financeiro continua como antes", () => {
  const f = calcularFinanceiro(HOJE, { ...comum, pedidos: pedidosBase, pagamentosClube: [] });
  assert.equal(f.temClube, false);
  for (const p of Object.values(f.resumo)) {
    assert.equal(p.clube, 0);
    assert.equal(p.entradas, p.faturamento);
    assert.equal(p.lucro, Math.round((p.faturamento - p.comissoes - p.gastosFixos - p.insumosComprados) * 100) / 100);
  }
  assert.equal(f.resumo.dia.lucro, 14, "40 − 16 − 10");
  // Atendimento de assinante sem mensalidade registrada também mostra a linha do clube (comissão sem receita)
  assert.equal(calcularFinanceiro(HOJE, { ...comum, pedidos: [doClube] }).temClube, true);
});

test("o trimestre e os últimos 30 dias definem desde quando ler", () => {
  assert.equal(inicioDaLeitura("2026-11-14"), "2026-10-01");
  assert.equal(inicioDaLeitura("2026-10-05"), "2026-09-06", "começo do trimestre: os últimos 30 dias vêm antes");
});

test("o financeiro lê as mensalidades do clube da própria barbearia", async () => {
  const hoje = A.hoje();
  const lista = (corpo) => ({ corpo });
  const chamadas = A.instalarFetch([
    ...A.rotasDeConta(),
    { padrao: /\/rest\/v1\/pedidos\?barbearia_id=eq\./, resposta: lista([{ id: "p1", dia: hoje, status: "realizado", valor: "40", comissao_pct: "40", comissao_valor: null, clube_assinante_id: null, profissional_id: UUIDS.bruno, servico: "Corte" }]) },
    { padrao: /\/rest\/v1\/despesas\?barbearia_id=eq\./, resposta: lista([]) },
    { padrao: /\/rest\/v1\/insumos\?barbearia_id=eq\./, resposta: lista([]) },
    { padrao: /\/rest\/v1\/insumo_movimentos\?barbearia_id=eq\./, resposta: lista([]) },
    { padrao: /\/rest\/v1\/servicos_precos\?barbearia_id=eq\./, resposta: lista([{ id: "s1", nome: "Corte", preco: "40" }]) },
    { padrao: /\/rest\/v1\/profissionais\?barbearia_id=eq\./, resposta: lista([{ id: UUIDS.bruno, nome: "Bruno", comissao_pct: "40" }]) },
    { padrao: /\/rest\/v1\/clube_pagamentos\?barbearia_id=eq\./, resposta: lista([{ id: "g1", valor: "99.90", data: hoje }]) },
  ]);
  const r = await A.chamar(equipe, { query: { area: "financeiro" }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.resumo.dia.faturamento, 40);
  assert.equal(r.body.resumo.dia.clube, 99.9);
  assert.equal(r.body.resumo.dia.entradas, 139.9);
  assert.equal(r.body.temClube, true);
  const consulta = chamadas.find((c) => /clube_pagamentos\?/.test(c.url)).url;
  assert.ok(consulta.includes(`barbearia_id=eq.${UUIDS.barbearia}&data=gte.${inicioDaLeitura(hoje)}&data=lte.${hoje}`), consulta);
});

test("tela do Financeiro mostra as mensalidades do clube e o gráfico com as duas partes", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "financeiro.html"), "utf8");
  assert.match(html, /Mensalidades do clube/);
  assert.match(html, /p\.entradas/);
  assert.match(html, /id="legendaGrafico"/);
  assert.match(html, /desenharGrafico\(j\.serie, j\.temClube\)/);
});
