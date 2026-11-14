// Lembrete de vencimento do clube: quem lembrar, anotação do lembrete, aviso na tela Hoje do dono
// e aviso diário no celular (agendado na Vercel).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const A = require("./ajuda");
const clube = require("../lib/clube");
const equipe = require("../api/equipe");
const pedido = require("../api/pedido");
const config = require("../api/config");

const { UUIDS } = A;
const PLANO = "aaaaaaaa-0000-4000-8000-000000000001";
const ASSINANTE = "bbbbbbbb-0000-4000-8000-000000000001";
const ASSINANTE2 = "bbbbbbbb-0000-4000-8000-000000000002";
const ASSINANTE3 = "bbbbbbbb-0000-4000-8000-000000000003";
const HOJE = "2026-11-14";
// Horário de Brasília -> instante como o banco devolve (UTC)
const br = (dia, hm) => new Date(Date.parse(`${dia}T${hm}:00Z`) + 3 * 36e5).toISOString();
const ler = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

// ---------- regra ----------
test("quem lembrar: 3 dias antes e depois de vencer, um lembrete em cada fase", () => {
  const a = (extra) => ({ status: "ativo", pago_ate: "2026-11-17", ...extra });
  assert.deepEqual(clube.vencimento(a(), HOJE), { dias: 3, lembrado: false, lembreteEm: null });
  assert.equal(clube.vencimento(a({ pago_ate: "2026-11-18" }), HOJE), null, "4 dias antes ainda não entra");
  assert.equal(clube.vencimento(a({ status: "pausado" }), HOJE), null);
  assert.equal(clube.vencimento(a({ status: "cancelado", pago_ate: "2026-11-10" }), HOJE), null);
  assert.equal(clube.vencimento(a({ pago_ate: null }), HOJE), null, "sem data de vencimento");
  assert.equal(clube.vencimento(a({ lembrete_em: br("2026-11-13", "10:00"), lembrete_pago_ate: "2026-11-17" }), HOJE).lembrado, true);
  // Lembrete do mês passado não vale: o "Recebi" mudou o vencimento
  assert.equal(clube.vencimento(a({ lembrete_em: br("2026-10-15", "10:00"), lembrete_pago_ate: "2026-10-17" }), HOJE).lembrado, false);
  // Venceu: o lembrete de antes não basta, mas continua aparecendo como último lembrete
  const venceu = clube.vencimento(a({ pago_ate: "2026-11-12", lembrete_em: br("2026-11-11", "18:00"), lembrete_pago_ate: "2026-11-12" }), HOJE);
  assert.deepEqual(venceu, { dias: -2, lembrado: false, lembreteEm: br("2026-11-11", "18:00") });
  // 23h30 do dia do vencimento (Brasília) ainda é o lembrete de antes; meia-noite e meia já é o de depois
  assert.equal(clube.vencimento(a({ pago_ate: "2026-11-12", lembrete_em: br("2026-11-12", "23:30"), lembrete_pago_ate: "2026-11-12" }), HOJE).lembrado, false);
  assert.equal(clube.vencimento(a({ pago_ate: "2026-11-12", lembrete_em: br("2026-11-13", "00:30"), lembrete_pago_ate: "2026-11-12" }), HOJE).lembrado, true);
  // Vencido há muito tempo continua na lista do painel
  assert.equal(clube.vencimento(a({ pago_ate: "2026-09-01" }), HOJE).dias, -74);
  // Horário do banco (microssegundos, +00:00) sai no formato que todo navegador lê; lixo é ignorado
  assert.equal(clube.vencimento(a({ lembrete_em: "2026-11-13T13:02:11.123456+00:00", lembrete_pago_ate: "2026-11-17" }), HOJE).lembreteEm, "2026-11-13T13:02:11.123Z");
  assert.deepEqual(clube.vencimento(a({ lembrete_em: "ontem", lembrete_pago_ate: "2026-11-17" }), HOJE), { dias: 3, lembrado: false, lembreteEm: null });
});

test("textos do lembrete: quando vence e aviso no celular", () => {
  assert.deepEqual([3, 1, 0, -1, -5].map(clube.quandoVence), ["vence em 3 dias", "vence amanhã", "vence hoje", "venceu ontem", "venceu há 5 dias"]);
  const aviso = clube.avisoDoClube([{ nome: "Felipe Andrade", dias: 2 }, { nome: "Thiago Moura", dias: -2 }, { nome: "Ana", dias: 0 }, { nome: "Bia Souza", dias: 1 }]);
  assert.equal(aviso.title, "Clube: 4 assinantes para lembrar");
  assert.equal(aviso.body, "Thiago venceu há 2 dias · Ana vence hoje · Bia vence amanhã · e mais 1. Toque para lembrar pelo WhatsApp.");
  assert.equal(aviso.url, "/painel-dono.html#clube");
  assert.equal(clube.avisoDoClube([{ nome: "Pedro", dias: 0 }]).title, "Clube: 1 assinante para lembrar");
});

// ---------- aba Clube ----------
function rotasDoDono(extra = []) {
  return [...extra, ...A.rotasDeConta(), { padrao: /\/rest\/v1\/barbearias\?id=eq\./, resposta: { corpo: [{ id: UUIDS.barbearia, slug: "gw-teste", nome: "GW" }] } }];
}

test("aba Clube: cada assinante traz o vencimento e o número de quem lembrar", async () => {
  A.instalarFetch(rotasDoDono([
    { padrao: /\/rest\/v1\/clube_planos\?barbearia_id=eq\./, resposta: { corpo: [{ id: PLANO, nome: "Corte", descricao: "", preco: "99.90", servicos: ["Corte"], intervalo_dias: 7, dias_semana: [1, 2, 3, 4, 5, 6], hora_limite: null, comissao_valor: "15.00", ativo: true }] } },
    { padrao: /\/rest\/v1\/clube_assinantes\?barbearia_id=eq\./, resposta: { corpo: [
      { id: ASSINANTE, plano_id: PLANO, nome: "Felipe", whatsapp: "81999990001", status: "ativo", pago_ate: A.daquiA(2), observacao: "" },
      { id: ASSINANTE2, plano_id: PLANO, nome: "Thiago", whatsapp: "81999990002", status: "ativo", pago_ate: A.daquiA(-1), observacao: "", lembrete_em: new Date().toISOString(), lembrete_pago_ate: A.daquiA(-1) },
      { id: ASSINANTE3, plano_id: PLANO, nome: "Pedro", whatsapp: "81999990003", status: "ativo", pago_ate: A.daquiA(20), observacao: "" },
    ] } },
    { padrao: /\/rest\/v1\/servicos_precos\?barbearia_id=eq\./, resposta: { corpo: [{ nome: "Corte" }] } },
    { padrao: /\/rest\/v1\/pedidos\?barbearia_id=eq\./, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/clube_pagamentos\?barbearia_id=eq\./, resposta: { corpo: [] } },
  ]));
  const r = await A.chamar(equipe, { query: { area: "clube" }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const de = (id) => r.body.assinantes.find((a) => a.id === id);
  assert.deepEqual(de(ASSINANTE).vencimento, { dias: 2, lembrado: false, lembreteEm: null });
  assert.equal(de(ASSINANTE2).vencimento.lembrado, true, "lembrado hoje, depois de vencer");
  assert.equal(de(ASSINANTE3).vencimento, null, "longe do vencimento");
  assert.equal(r.body.kpis.paraLembrar, 1);
});

test("Lembrar anota o lembrete para o vencimento atual, só na barbearia do dono", async () => {
  const chamadas = A.instalarFetch(rotasDoDono([
    { metodo: "GET", padrao: /\/rest\/v1\/clube_assinantes\?id=eq\./, resposta: (url) => ({ corpo: url.includes(ASSINANTE) ? [{ id: ASSINANTE, pago_ate: A.daquiA(2) }] : [] }) },
    { metodo: "PATCH", padrao: /\/rest\/v1\/clube_assinantes\?id=eq\./, resposta: { status: 204 } },
  ]));
  const antes = Date.now();
  const r = await A.chamar(equipe, { metodo: "POST", query: { area: "clube" }, token: "token-dono", corpo: { acao: "assinante-lembrete", id: ASSINANTE } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.lembrete_pago_ate, A.daquiA(2));
  assert.ok(Date.parse(r.body.lembrete_em) >= antes - 1000);
  const patch = chamadas.find((c) => c.metodo === "PATCH");
  assert.ok(patch.url.includes(`id=eq.${ASSINANTE}&barbearia_id=eq.${UUIDS.barbearia}`), patch.url);
  assert.deepEqual(Object.keys(patch.corpo).sort(), ["lembrete_em", "lembrete_pago_ate"], "só anota o lembrete");
  assert.ok(chamadas.filter((c) => c.metodo === "GET" && /clube_assinantes\?id=eq\./.test(c.url)).every((c) => c.url.includes("barbearia_id=eq." + UUIDS.barbearia)));

  const outro = await A.chamar(equipe, { metodo: "POST", query: { area: "clube" }, token: "token-dono", corpo: { acao: "assinante-lembrete", id: ASSINANTE2 } });
  assert.equal(outro.statusCode, 404, "assinante de outra barbearia");
  const invalido = await A.chamar(equipe, { metodo: "POST", query: { area: "clube" }, token: "token-dono", corpo: { acao: "assinante-lembrete", id: "x" } });
  assert.equal(invalido.statusCode, 400);
  const barbeiro = await A.chamar(equipe, { metodo: "POST", query: { area: "clube" }, token: "token-bruno", corpo: { acao: "assinante-lembrete", id: ASSINANTE } });
  assert.equal(barbeiro.statusCode, 403);
  assert.equal(chamadas.filter((c) => c.metodo === "PATCH").length, 1);
});

// ---------- tela Hoje ----------
function rotasDoPainel(extra = []) {
  return [
    ...extra,
    ...A.rotasDeConta(),
    { padrao: /\/rest\/v1\/pedidos\?/, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/profissionais\?barbearia_id=eq\./, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/agenda_dia\?/, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/servicos_precos\?/, resposta: { corpo: [] } },
  ];
}

test("tela Hoje do dono avisa quem lembrar; barbeiro não vê e a tela abre mesmo se a consulta falhar", async () => {
  const chamadas = A.instalarFetch(rotasDoPainel([
    { padrao: /\/rest\/v1\/clube_assinantes\?barbearia_id=eq\./, resposta: { corpo: [
      { nome: "Thiago Moura", status: "ativo", pago_ate: A.daquiA(-3), lembrete_em: null, lembrete_pago_ate: null },
      { nome: "Marcos", status: "ativo", pago_ate: A.hoje(), lembrete_em: new Date().toISOString(), lembrete_pago_ate: A.hoje() },
      { nome: "Felipe Andrade", status: "ativo", pago_ate: A.daquiA(2), lembrete_em: null, lembrete_pago_ate: null },
    ] } },
  ]));
  const r = await A.chamar(pedido, { query: { painel: "1", dia: A.hoje() }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.lembretesClube, [{ nome: "Thiago Moura", dias: -3 }, { nome: "Felipe Andrade", dias: 2 }], "Marcos já foi lembrado");
  const consulta = chamadas.find((c) => c.url.includes("/clube_assinantes?"));
  assert.ok(consulta.url.includes(`barbearia_id=eq.${UUIDS.barbearia}&status=eq.ativo&pago_ate=lte.${A.daquiA(3)}`), consulta.url);

  // Outro dia da agenda: não consulta o clube
  const c2 = A.instalarFetch(rotasDoPainel());
  const outroDia = await A.chamar(pedido, { query: { painel: "1", dia: A.daquiA(1) }, token: "token-dono" });
  assert.equal(outroDia.statusCode, 200);
  assert.equal(outroDia.body.lembretesClube, undefined);
  assert.ok(!c2.some((c) => c.url.includes("/clube_assinantes?")));

  // Barbeiro: nem consulta nem lista
  const c3 = A.instalarFetch(rotasDoPainel());
  const barbeiro = await A.chamar(pedido, { query: { painel: "1", dia: A.hoje() }, token: "token-bruno" });
  assert.equal(barbeiro.statusCode, 200, JSON.stringify(barbeiro.body));
  assert.equal(barbeiro.body.lembretesClube, undefined);
  assert.ok(!c3.some((c) => c.url.includes("/clube_assinantes?")));

  // Consulta do clube falhou: a tela inicial abre do mesmo jeito, só sem o aviso
  A.instalarFetch(rotasDoPainel([{ padrao: /\/rest\/v1\/clube_assinantes\?/, resposta: { status: 500, corpo: { message: "falhou" } } }]));
  const falhou = await A.chamar(pedido, { query: { painel: "1", dia: A.hoje() }, token: "token-dono" });
  assert.equal(falhou.statusCode, 200);
  assert.deepEqual(falhou.body.lembretesClube, []);
});

// ---------- aviso diário no celular ----------
const b64u = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// Chaves do servidor (VAPID) e do aparelho do dono
function ligarPush() {
  const vapid = crypto.createECDH("prime256v1");
  vapid.generateKeys();
  process.env.VAPID_PUBLIC_KEY = b64u(vapid.getPublicKey());
  process.env.VAPID_PRIVATE_KEY = b64u(vapid.getPrivateKey());
  const ua = crypto.createECDH("prime256v1");
  ua.generateKeys();
  return { endpoint: "https://fcm.googleapis.com/fcm/send/dono", p256dh: b64u(ua.getPublicKey()), auth_key: b64u(crypto.randomBytes(16)), user_id: UUIDS.donoUser };
}
function desligarPush() {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.CRON_SECRET;
}
// Relógio parado num instante (UTC)
async function as(instante, fn) {
  const real = Date.now;
  Date.now = () => Date.parse(instante);
  try { return await fn(); } finally { Date.now = real; }
}
const AGENDADOR = { "user-agent": "vercel-cron/1.0" };

test("aviso diário: só o agendador chama, nunca de madrugada e no máximo um por barbearia por dia", async () => {
  const inscricao = ligarPush();
  const reservas = new Set();
  const chamadas = A.instalarFetch([
    ...A.rotasDeConta(),
    { padrao: /\/rest\/v1\/clube_assinantes\?status=eq\.ativo/, resposta: { corpo: [
      { id: ASSINANTE, barbearia_id: UUIDS.barbearia, nome: "Thiago Moura", status: "ativo", pago_ate: "2026-11-12", lembrete_em: null, lembrete_pago_ate: null },
      { id: ASSINANTE2, barbearia_id: UUIDS.barbearia, nome: "Felipe Andrade", status: "ativo", pago_ate: "2026-11-16", lembrete_em: br("2026-11-13", "10:00"), lembrete_pago_ate: "2026-11-16" },
      { id: ASSINANTE3, barbearia_id: UUIDS.outraBarbearia, nome: "Ana", status: "ativo", pago_ate: "2026-11-20", lembrete_em: null, lembrete_pago_ate: null },
    ] } },
    // A trava do dia: a segunda reserva da mesma barbearia no mesmo dia não grava nada
    { metodo: "POST", padrao: /\/rest\/v1\/clube_avisos_diarios\?on_conflict=barbearia_id,dia$/, resposta: (u, o, corpo) => {
      const chave = corpo.barbearia_id + corpo.dia;
      if (reservas.has(chave)) return { status: 201, corpo: [] };
      reservas.add(chave);
      return { status: 201, corpo: [corpo] };
    } },
    { metodo: "DELETE", padrao: /\/rest\/v1\/clube_avisos_diarios\?dia=lt\./, resposta: { status: 204 } },
    { padrao: /\/rest\/v1\/perfis\?barbearia_id=eq\./, resposta: (url) => ({ corpo: url.includes(UUIDS.barbearia) ? [{ user_id: UUIDS.donoUser, papel: "dono" }] : [] }) },
    { padrao: /\/rest\/v1\/push_inscricoes\?user_id=in\./, resposta: (url) => ({ corpo: url.includes(UUIDS.donoUser) ? [inscricao] : [] }) },
    { metodo: "POST", padrao: /^https:\/\/fcm\.googleapis\.com\//, resposta: { status: 201 } },
  ]);
  const pushes = () => chamadas.filter((c) => c.url.startsWith("https://fcm.googleapis.com/")).length;
  try {
    const qualquer = await A.chamar(config, { query: { lembretes: "clube" } });
    assert.equal(qualquer.statusCode, 401);
    assert.equal(chamadas.length, 0, "sem o agendador, nem consulta o banco");

    // 3h da manhã em Brasília: não avisa
    const madrugada = await as("2026-11-14T06:00:00Z", () => A.chamar(config, { query: { lembretes: "clube" }, headers: AGENDADOR }));
    assert.equal(madrugada.statusCode, 200);
    assert.equal(madrugada.body.avisos, 0);
    assert.equal(chamadas.length, 0);

    // 9h30 em Brasília: avisa o dono da GW (Thiago venceu; Felipe já foi lembrado)
    const manha = await as("2026-11-14T12:30:00Z", () => A.chamar(config, { query: { lembretes: "clube" }, headers: AGENDADOR }));
    assert.equal(manha.statusCode, 200, JSON.stringify(manha.body));
    assert.equal(manha.body.avisos, 1);
    assert.equal(pushes(), 1);
    const busca = chamadas.find((c) => c.url.includes("/clube_assinantes?status=eq.ativo"));
    assert.ok(busca.url.includes("pago_ate=gte.2026-11-07&pago_ate=lte.2026-11-17"), busca.url);
    const reserva = chamadas.find((c) => c.metodo === "POST" && c.url.includes("clube_avisos_diarios") && c.corpo.barbearia_id === UUIDS.barbearia);
    assert.deepEqual(reserva.corpo, { barbearia_id: UUIDS.barbearia, dia: "2026-11-14", assinantes: 1 });
    assert.match(reserva.headers.Prefer, /resolution=ignore-duplicates/);

    // Chamado de novo no mesmo dia: não avisa outra vez
    const deNovo = await as("2026-11-14T12:45:00Z", () => A.chamar(config, { query: { lembretes: "clube" }, headers: AGENDADOR }));
    assert.equal(deNovo.statusCode, 200);
    assert.equal(deNovo.body.avisos, 0);
    assert.equal(pushes(), 1);

    // Com CRON_SECRET na Vercel, vale só o segredo que o agendador manda
    process.env.CRON_SECRET = "segredo-do-agendador-de-teste";
    const soAgente = await as("2026-11-15T12:30:00Z", () => A.chamar(config, { query: { lembretes: "clube" }, headers: AGENDADOR }));
    assert.equal(soAgente.statusCode, 401);
    const comSegredo = await as("2026-11-15T12:30:00Z", () => A.chamar(config, { query: { lembretes: "clube" }, headers: { ...AGENDADOR, authorization: "Bearer segredo-do-agendador-de-teste" } }));
    assert.equal(comSegredo.statusCode, 200, JSON.stringify(comSegredo.body));
    assert.equal(pushes(), 2, "dia seguinte, aviso novo");
  } finally {
    desligarPush();
  }
});

test("aviso diário sem push configurado não consulta nada", async () => {
  desligarPush();
  const chamadas = A.instalarFetch(A.rotasDeConta());
  const r = await as("2026-11-14T12:30:00Z", () => A.chamar(config, { query: { lembretes: "clube" }, headers: AGENDADOR }));
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.avisos, 0);
  assert.equal(chamadas.length, 0);
});

test("agendador chamando sem o ?lembretes também roda o aviso; o navegador continua recebendo a configuração", async () => {
  desligarPush();
  A.instalarFetch(A.rotasDeConta());
  const agendador = await as("2026-11-14T12:30:00Z", () => A.chamar(config, { query: {}, headers: AGENDADOR }));
  assert.equal(agendador.statusCode, 200);
  assert.equal(agendador.body.avisos, 0, "foi para o aviso diário");
  assert.equal(agendador.body.anon, undefined, "não devolve a configuração ao agendador");
  const navegador = await A.chamar(config, { query: {}, headers: { "user-agent": "Mozilla/5.0" } });
  assert.equal(navegador.statusCode, 200);
  assert.equal(navegador.body.anon, process.env.SUPABASE_ANON_KEY);
});

// ---------- configuração e telas ----------
test("vercel.json agenda o aviso diário às 9h de Brasília", () => {
  const v = JSON.parse(ler("vercel.json"));
  assert.deepEqual(v.crons, [{ path: "/api/config?lembretes=clube", schedule: "0 12 * * *" }]);
});

test("migração da fase 13 só acrescenta", () => {
  const sql = ler("supabase/fase13-clube-lembretes.sql").toLowerCase().replace(/--.*$/gm, "");
  assert.match(sql, /add column if not exists lembrete_em timestamptz/);
  assert.match(sql, /add column if not exists lembrete_pago_ate date/);
  assert.match(sql, /primary key \(barbearia_id, dia\)/);
  assert.match(sql, /revoke all on public\.clube_avisos_diarios from anon, authenticated/);
  // "on delete cascade" e "grant ... delete" podem; comando que apaga ou muda o que existe, não
  assert.ok(!/^\s*(drop|delete|truncate|update)\b/m.test(sql), "nenhum comando apaga ou muda dados");
  assert.ok(!/drop (table|column|index|function|constraint)|alter column|rename/.test(sql), "nada existente muda");
});

test("painel do dono: lista Para lembrar, aviso na tela Hoje e número na aba Clube", () => {
  const dono = ler("painel-dono.html");
  assert.match(dono, /id="secLembrar"/);
  assert.match(dono, /acao: "assinante-lembrete", id: a\.id/);
  assert.match(dono, /P\.bolinha\("clube", k\.paraLembrar/);
  assert.match(dono, /d\.lembretesClube/);
  // O WhatsApp abre no toque, antes da chamada ao servidor (senão o navegador bloqueia a janela)
  const lembrar = dono.slice(dono.indexOf("function lembrarAssinante"));
  assert.ok(lembrar.indexOf("abrirWhatsAssinante(a, false)") < lembrar.indexOf("assinante-lembrete"));
  // O WhatsApp do cartão do assinante também anota quando a mensagem é o lembrete
  assert.match(dono, /if \(a\.vencimento\) lembrarAssinante\(a\); else abrirWhatsAssinante\(a, false\)/);
});
