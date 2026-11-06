// Assinatura do Bio Site com o Stripe: oferta de lançamento (10 vagas), implantação na hora,
// primeira mensalidade 60 dias depois, avisos do Stripe conferidos pela assinatura e tratados uma vez só.
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("./ajuda");
const { UUIDS } = A;
const equipe = require("../api/equipe");
const config = require("../api/config");
const S = require("../lib/stripe");

const SEGREDO = "whsec_teste_123";

function ligarStripe() {
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  process.env.STRIPE_WEBHOOK_SECRET = SEGREDO;
  S._cachePrecos.clear();
}
function desligarStripe() {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
}
const form = (corpo) => Object.fromEntries(new URLSearchParams(String(corpo || "")));

// Banco e Stripe falsos. vagas = assinaturas de lançamento já usadas; atual = assinatura desta barbearia
function rotas({ vagas = 0, atual = null, gravados = [], stripe = [], eventoNovo = true } = {}) {
  return [
    ...A.rotasDeConta(),
    { metodo: "GET", padrao: /\/rest\/v1\/assinaturas\?barbearia_id=eq\./, resposta: { corpo: atual ? [atual] : [] } },
    { metodo: "GET", padrao: /\/rest\/v1\/assinaturas\?plano=eq\.lancamento/, resposta: { corpo: Array.from({ length: vagas }, (_, i) => ({ barbearia_id: "b" + i })) } },
    { metodo: "POST", padrao: /\/rest\/v1\/assinaturas\?on_conflict=barbearia_id/, resposta: (url, op, corpo) => { gravados.push(corpo); return { status: 201 }; } },
    { metodo: "POST", padrao: /\/rest\/v1\/stripe_eventos/, resposta: (url, op, corpo) => ({ status: 201, corpo: eventoNovo ? [corpo] : [] }) },
    { padrao: /api\.stripe\.com\/v1\/prices\?/, resposta: (url) => { stripe.push({ url, metodo: "GET" }); return { corpo: { data: [] } }; } },
    { metodo: "POST", padrao: /api\.stripe\.com\/v1\/prices$/, resposta: (url, op) => { const f = form(op.body); stripe.push({ url, metodo: "POST", f }); return { corpo: { id: "price_" + f.lookup_key } }; } },
    { metodo: "POST", padrao: /api\.stripe\.com\/v1\/checkout\/sessions$/, resposta: (url, op) => { stripe.push({ url, metodo: "POST", f: form(op.body) }); return { corpo: { id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" } }; } },
    { metodo: "POST", padrao: /api\.stripe\.com\/v1\/billing_portal\/sessions$/, resposta: (url, op) => { stripe.push({ url, metodo: "POST", f: form(op.body) }); return { corpo: { url: "https://billing.stripe.com/p/session/x" } }; } },
    { metodo: "GET", padrao: /api\.stripe\.com\/v1\/subscriptions\/sub_1/, resposta: { corpo: assinaturaStripe() } },
  ];
}

function assinaturaStripe(extra) {
  const trial = Math.floor(Date.now() / 1000) + 60 * 86400;
  return {
    id: "sub_1", object: "subscription", customer: "cus_1", status: "trialing", trial_end: trial, cancel_at_period_end: false,
    metadata: { barbearia_id: UUIDS.barbearia },
    items: { data: [{ current_period_end: trial, price: { lookup_key: "bio_mensal_lancamento_3990", unit_amount: 3990 } }] },
    ...extra,
  };
}

test("stripe: parâmetros no formato da API e assinatura dos avisos conferida", () => {
  assert.deepEqual(S.campos({ mode: "subscription", line_items: [{ price: "p1", quantity: 1 }], subscription_data: { trial_end: 10, metadata: { barbearia_id: "x" } } }), [
    ["mode", "subscription"], ["line_items[0][price]", "p1"], ["line_items[0][quantity]", "1"], ["subscription_data[trial_end]", "10"], ["subscription_data[metadata][barbearia_id]", "x"],
  ]);
  const corpo = JSON.stringify({ id: "evt_1", type: "x" });
  assert.equal(S.eventoVerificado(corpo, S.assinarParaTeste(corpo, SEGREDO), SEGREDO).id, "evt_1");
  assert.equal(S.eventoVerificado(corpo + " ", S.assinarParaTeste(corpo, SEGREDO), SEGREDO), null, "corpo alterado");
  assert.equal(S.eventoVerificado(corpo, S.assinarParaTeste(corpo, "outro"), SEGREDO), null, "segredo errado");
  assert.equal(S.eventoVerificado(corpo, S.assinarParaTeste(corpo, SEGREDO, Math.floor(Date.now() / 1000) - 3600), SEGREDO), null, "aviso antigo");
  assert.equal(S.eventoVerificado(corpo, "", SEGREDO), null, "sem cabeçalho");
});

test("assinatura: sem Stripe configurado o painel não mostra nada; barbeiro não acessa", async () => {
  desligarStripe();
  A.instalarFetch(rotas());
  let r = await A.chamar(equipe, { metodo: "GET", query: { area: "assinatura" }, token: "token-dono" });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body, { configurado: false });
  r = await A.chamar(equipe, { metodo: "GET", query: { area: "assinatura" }, token: "token-bruno" });
  assert.equal(r.statusCode, 403);
  r = await A.chamar(equipe, { metodo: "GET", query: { area: "assinatura" } });
  assert.equal(r.statusCode, 401);
});

test("assinatura: preço de lançamento enquanto houver vaga, depois o preço normal", async () => {
  ligarStripe();
  const chamadas = A.instalarFetch(rotas({ vagas: 3 }));
  let r = await A.chamar(equipe, { metodo: "GET", query: { area: "assinatura" }, token: "token-dono" });
  assert.equal(r.body.oferta.promocao, true);
  assert.equal(r.body.oferta.vagasRestantes, 7);
  assert.equal(r.body.oferta.mensal, 39.9);
  assert.equal(r.body.oferta.implantacao, 120);
  assert.equal(r.body.oferta.diasAtePrimeiraCobranca, 60);
  // As 10 primeiras: conta quem pagou a implantação, mesmo que tenha cancelado (a vaga não volta)
  const contagem = decodeURIComponent(chamadas.find((c) => c.url.includes("assinaturas?plano=eq.lancamento")).url);
  assert.ok(contagem.includes("or=(implantacao_paga_em.not.is.null,status.in.(em_teste,ativa,atrasada,pausada))"), contagem);
  A.instalarFetch(rotas({ vagas: 10 }));
  r = await A.chamar(equipe, { metodo: "GET", query: { area: "assinatura" }, token: "token-dono" });
  assert.equal(r.body.oferta.promocao, false);
  assert.equal(r.body.oferta.vagasRestantes, 0);
  assert.equal(r.body.oferta.mensal, 89.9);
  desligarStripe();
});

test("assinatura: pagamento abre no Stripe com implantação agora e mensalidade em 60 dias", async () => {
  ligarStripe();
  const stripe = [];
  A.instalarFetch(rotas({ vagas: 2, stripe }));
  const r = await A.chamar(equipe, { metodo: "POST", query: { area: "assinatura" }, corpo: { acao: "checkout" }, token: "token-dono" });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.url, "https://checkout.stripe.com/c/pay/cs_1");
  // Preços criados uma vez, com o valor na chave
  const precos = stripe.filter((c) => c.metodo === "POST" && /prices$/.test(c.url)).map((c) => c.f);
  const mensal = precos.find((p) => p.lookup_key === "bio_mensal_lancamento_3990");
  assert.equal(mensal.unit_amount, "3990");
  assert.equal(mensal["recurring[interval]"], "month");
  const impl = precos.find((p) => p.lookup_key === "bio_implantacao_12000");
  assert.equal(impl.unit_amount, "12000");
  assert.ok(!("recurring[interval]" in impl), "implantação é cobrança avulsa");
  // Sessão de pagamento
  const s = stripe.find((c) => /checkout\/sessions$/.test(c.url)).f;
  assert.equal(s.mode, "subscription");
  assert.equal(s["line_items[0][price]"], "price_bio_mensal_lancamento_3990");
  assert.equal(s["line_items[1][price]"], "price_bio_implantacao_12000");
  const dias = (Number(s["subscription_data[trial_end]"]) - Date.now() / 1000) / 86400;
  assert.ok(dias > 59.9 && dias <= 60, `primeira mensalidade em 60 dias (${dias})`);
  assert.equal(s["subscription_data[metadata][barbearia_id]"], UUIDS.barbearia);
  assert.equal(s.client_reference_id, UUIDS.barbearia);
  assert.equal(s.customer_email, "dono@exemplo.com");
  assert.equal(s.success_url, "https://biosite.teste/painel-dono.html?assinatura=ok#mais");
  // Preço guardado: a segunda vez não cria de novo
  const antes = stripe.length;
  await A.chamar(equipe, { metodo: "POST", query: { area: "assinatura" }, corpo: { acao: "checkout" }, token: "token-dono" });
  assert.equal(stripe.filter((c, i) => i >= antes && /prices/.test(c.url)).length, 0);
  desligarStripe();
});

test("assinatura: não abre segundo pagamento; troca de cartão só com assinatura", async () => {
  ligarStripe();
  const stripe = [];
  A.instalarFetch(rotas({ atual: { barbearia_id: UUIDS.barbearia, status: "ativa", stripe_customer_id: "cus_1" }, stripe }));
  let r = await A.chamar(equipe, { metodo: "POST", query: { area: "assinatura" }, corpo: { acao: "checkout" }, token: "token-dono" });
  assert.equal(r.statusCode, 409);
  r = await A.chamar(equipe, { metodo: "POST", query: { area: "assinatura" }, corpo: { acao: "portal" }, token: "token-dono" });
  assert.equal(r.statusCode, 200);
  assert.equal(stripe.find((c) => /billing_portal/.test(c.url)).f.customer, "cus_1");
  A.instalarFetch(rotas());
  r = await A.chamar(equipe, { metodo: "POST", query: { area: "assinatura" }, corpo: { acao: "portal" }, token: "token-dono" });
  assert.equal(r.statusCode, 400);
  desligarStripe();
});

// Aviso do Stripe como chega na rota: corpo bruto + cabeçalho de assinatura
async function aviso(evento, { segredo = SEGREDO, assinatura } = {}) {
  const corpo = JSON.stringify(evento);
  const r = A.res();
  await config({ method: "POST", query: { stripe: "webhook" }, headers: { host: "biosite.teste", "stripe-signature": assinatura || S.assinarParaTeste(corpo, segredo) }, rawBody: corpo }, r);
  return r;
}

test("avisos do Stripe: assinatura inválida é recusada e nada é gravado", async () => {
  ligarStripe();
  const gravados = [];
  A.instalarFetch(rotas({ gravados }));
  const r = await aviso({ id: "evt_1", type: "customer.subscription.updated", data: { object: assinaturaStripe() } }, { segredo: "whsec_de_outro" });
  assert.equal(r.statusCode, 400);
  assert.equal(gravados.length, 0);
  desligarStripe();
});

test("avisos do Stripe: situação, plano, valor e datas gravados; aviso repetido é ignorado", async () => {
  ligarStripe();
  const gravados = [];
  A.instalarFetch(rotas({ gravados }));
  let r = await aviso({ id: "evt_2", type: "customer.subscription.updated", data: { object: assinaturaStripe() } });
  assert.equal(r.statusCode, 200);
  const g = gravados[0];
  assert.equal(g.barbearia_id, UUIDS.barbearia);
  assert.equal(g.status, "em_teste");
  assert.equal(g.plano, "lancamento");
  assert.equal(g.valor_mensal, 39.9);
  assert.equal(g.stripe_customer_id, "cus_1");
  assert.ok(g.primeira_cobranca_em && g.proxima_cobranca_em);
  // atraso de pagamento
  await aviso({ id: "evt_3", type: "customer.subscription.updated", data: { object: assinaturaStripe({ status: "past_due" }) } });
  assert.equal(gravados[1].status, "atrasada");
  // o mesmo aviso de novo
  A.instalarFetch(rotas({ gravados, eventoNovo: false }));
  r = await aviso({ id: "evt_3", type: "customer.subscription.updated", data: { object: assinaturaStripe({ status: "past_due" }) } });
  assert.equal(r.body.repetido, true);
  assert.equal(gravados.length, 2);
  desligarStripe();
});

test("avisos do Stripe: pagamento concluído grava a assinatura e a implantação paga", async () => {
  ligarStripe();
  const gravados = [];
  A.instalarFetch(rotas({ gravados }));
  const r = await aviso({ id: "evt_4", type: "checkout.session.completed", data: { object: { id: "cs_1", subscription: "sub_1", payment_status: "paid", metadata: { barbearia_id: UUIDS.barbearia } } } });
  assert.equal(r.statusCode, 200);
  assert.equal(gravados[0].status, "em_teste");
  assert.ok(gravados[0].implantacao_paga_em, "implantação marcada como paga");
  desligarStripe();
});
