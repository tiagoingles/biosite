// WhatsApp automático (Premium) em modo de teste: regras de quem recebe o quê e quando, prévia com custo,
// configuração por barbearia (liga/desliga, texto, oferta, link de avaliação) e a tela do dono.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const A = require("./ajuda");
const AUTO = require("../lib/automacoes");
const equipe = require("../api/equipe");

const { UUIDS } = A;
const HOJE = "2026-11-15";
const ler = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const comLink = (lista) => lista.map((a) => (a.tipo === "pos_atendimento" ? { ...a, config: { avaliacao: "https://g.page/r/teste" }, pendencia: "" } : a));
const todas = () => comLink(AUTO.configuracao([]));
const pedido = (extra) => ({ dia: "2026-11-17", horario: "10:00:00", duracao_min: 30, status: "confirmado", cliente: "Caio", servico: "Corte", profissional: "Bruno", clientes: { nome: "Caio Reis", telefone: "81999990003" }, ...extra });
const cliente = (extra) => ({ id: "c1", nome: "Ana Souza", telefone: "81999990001", aceita: true, status: "em_dia", ultima: "2026-11-10", ciclo: 20, aniversario: null, ...extra });
const tipos = (r) => r.mensagens.map((m) => m.tipo + "@" + m.dia + " " + m.horario);

test("lembretes: só horário confirmado de quem tem WhatsApp no cadastro, na véspera às 18h e 2 horas antes", () => {
  const r = AUTO.previa({ hoje: HOJE, agoraMin: 9 * 60, automacoes: todas(), pedidos: [pedido(), pedido({ status: "pendente" }), pedido({ clientes: null })] });
  assert.deepEqual(tipos(r), ["lembrete_vespera@2026-11-16 18:00", "lembrete_2h@2026-11-17 08:00", "pos_atendimento@2026-11-17 11:30"]);
  assert.equal(r.mensagens[0].texto, "Olá, Caio! Lembrete do seu horário amanhã, 17/11 às 10:00, na . Precisa remarcar? É só responder esta mensagem.");
  assert.equal(r.mensagens[0].telefone, "81999990003");
  // Hoje: véspera de amanhã depois das 18h não sai mais; horário de hoje a menos de 2 horas também não
  const tarde = AUTO.previa({ hoje: HOJE, agoraMin: 19 * 60, automacoes: todas(), pedidos: [pedido({ dia: "2026-11-16" }), pedido({ dia: HOJE, horario: "20:00:00" })] });
  assert.deepEqual(tipos(tarde).filter((t) => t.startsWith("lembrete")), ["lembrete_2h@2026-11-16 08:00"]);
});

test("obrigado e avaliação só liga com o link do Google", () => {
  const sem = AUTO.configuracao([]);
  assert.match(sem.find((a) => a.tipo === "pos_atendimento").pendencia, /link de avaliação/);
  const r = AUTO.previa({ hoje: HOJE, agoraMin: 0, automacoes: sem, pedidos: [pedido()] });
  assert.ok(!r.mensagens.some((m) => m.tipo === "pos_atendimento"));
  const com = AUTO.configuracao([{ tipo: "pos_atendimento", ativa: true, texto: "Obrigado, {nome}! Avalie: {avaliacao}", config: { avaliacao: "https://g.page/r/x" } }]);
  const r2 = AUTO.previa({ hoje: HOJE, agoraMin: 0, automacoes: com, pedidos: [pedido()] });
  assert.equal(r2.mensagens.find((m) => m.tipo === "pos_atendimento").texto, "Obrigado, Caio! Avalie: https://g.page/r/x");
});

test("promoções: só quem aceitou, sem horário marcado, uma por semana (aniversário primeiro)", () => {
  const clientes = [
    cliente({ id: "a", nome: "Ana Souza", status: "atrasado", ultima: "2026-10-01", ciclo: 20, aniversario: { dia: "17/11", diasAte: 2 } }),
    cliente({ id: "b", nome: "Bia Lima", status: "em_dia", ultima: "2026-11-01", ciclo: 10 }),
    cliente({ id: "c", nome: "Caio Reis", status: "atrasado", ultima: "2026-10-01", aceita: false }),
    cliente({ id: "d", nome: "Duda Melo", status: "agendado", ultima: "2026-10-01", proximo: "2026-11-20" }),
    cliente({ id: "e", nome: "Edu Prado", status: "sumido", ultima: "2026-08-01", ciclo: 20 }),
    cliente({ id: "f", nome: "Fábio Nunes", status: "perdido", ultima: "2026-01-01", ciclo: 20 }),
    cliente({ id: "g", nome: "Gil Rocha", status: "atrasado", ultima: "2026-10-01", ciclo: 20 }),
    cliente({ id: "h", nome: "Hugo Dias", status: "atrasado", ultima: "2026-10-01", telefone: "" }),
  ];
  const contatos = new Map([["g", "2026-11-10"]]); // recebeu campanha há 5 dias
  const r = AUTO.previa({ hoje: HOJE, agoraMin: 0, automacoes: todas(), clientes, contatos, barbearia: "GW", site: "https://x/gw" });
  const por = Object.fromEntries(r.mensagens.map((m) => [m.cliente, m.tipo + "@" + m.dia]));
  assert.equal(por["Ana Souza"], "aniversario@2026-11-17", "aniversário vence o retorno");
  assert.equal(por["Bia Lima"], "retorno@2026-11-17", "passa do ritmo (10 dias x 1,5) no dia 17");
  assert.equal(por["Edu Prado"], "reconquista@2026-11-15");
  assert.equal(por["Caio Reis"], undefined, "não aceitou novidades");
  assert.equal(por["Duda Melo"], undefined, "tem horário marcado");
  assert.equal(por["Fábio Nunes"], undefined, "perdido não recebe reconquista");
  assert.equal(por["Gil Rocha"], undefined, "recebeu campanha há pouco");
  assert.equal(por["Hugo Dias"], undefined, "sem WhatsApp");
  assert.equal(r.mensagens.filter((m) => m.cliente === "Ana Souza").length, 1);
  assert.match(r.mensagens.find((m) => m.cliente === "Bia Lima").texto, /^Olá, Bia! Já faz 16 dias do seu último corte na GW\. .* https:\/\/x\/gw$/);
  assert.match(r.mensagens.find((m) => m.cliente === "Edu Prado").texto, /Volte esta semana e ganhe 10% de desconto\./, "oferta padrão da reconquista");
});

test("clube: 3 dias antes do vencimento, direto para o assinante; desligada não entra; custo por categoria", () => {
  const assinantes = [{ nome: "Duda Melo", whatsapp: "81999990004", pago_ate: "2026-11-19", clube_planos: { nome: "Corte ilimitado" } }, { nome: "Longe", whatsapp: "81999990005", pago_ate: "2026-12-30" }];
  const r = AUTO.previa({ hoje: HOJE, agoraMin: 0, automacoes: todas(), assinantes, clientes: [cliente({ status: "atrasado", ultima: "2026-10-01" })], barbearia: "GW" });
  const clube = r.mensagens.find((m) => m.tipo === "clube_vencimento");
  assert.equal(clube.dia, "2026-11-16");
  assert.match(clube.texto, /plano Corte ilimitado da GW vence em 19\/11/);
  assert.equal(r.mensagens.filter((m) => m.tipo === "clube_vencimento").length, 1);
  assert.equal(r.custoSemana, 0.36, "1 utilidade (R$ 0,035) + 1 promoção (R$ 0,32)");
  assert.equal(r.custoMes, 1.52, "por mês: 0,355 x 30 / 7");
  const desligada = comLink(AUTO.configuracao([{ tipo: "clube_vencimento", ativa: false, texto: "x".repeat(20), config: {} }]));
  assert.ok(!AUTO.previa({ hoje: HOJE, agoraMin: 0, automacoes: desligada, assinantes }).mensagens.some((m) => m.tipo === "clube_vencimento"));
});

// ---------- servidor ----------
function rotasDoPremium(extra = []) {
  return [
    ...extra,
    ...A.rotasDeConta(),
    { padrao: /\/rest\/v1\/barbearias\?id=eq\./, resposta: { corpo: [{ id: UUIDS.barbearia, slug: "gw-teste", nome: "GW" }] } },
    { padrao: /\/rest\/v1\/clientes\?barbearia_id=eq\./, resposta: { corpo: [{ id: "dddddddd-0000-4000-8000-000000000001", nome: "Ana Souza", telefone: "81999990001", cpf: null, nascimento: null, observacao: "", profissional_id: null, origem: "site", ultima_visita_externa: null, aceita_novidades: true, aceite_em: "2026-10-01T12:00:00Z", aceite_origem: "site", saiu_em: null, criado_em: "2026-08-01T12:00:00Z" }] } },
    { padrao: /\/rest\/v1\/pedidos\?barbearia_id=eq\.[^&]+&cliente_id=not\.is\.null/, resposta: { corpo: [{ cliente_id: "dddddddd-0000-4000-8000-000000000001", dia: A.daquiA(-40), status: "realizado", valor: "40", profissional_id: UUIDS.bruno }] } },
    { padrao: /\/rest\/v1\/pedidos\?barbearia_id=eq\.[^&]+&dia=gte\./, resposta: { corpo: [{ id: UUIDS.pedido, dia: A.daquiA(2), horario: "10:00:00", duracao_min: 30, cliente: "Caio", servico: "Corte", profissional: "Bruno", status: "confirmado", cliente_id: "x", clientes: { nome: "Caio Reis", telefone: "81999990003" } }] } },
    { padrao: /\/rest\/v1\/profissionais\?barbearia_id=eq\./, resposta: { corpo: [{ id: UUIDS.bruno, nome: "Bruno" }] } },
    { padrao: /\/rest\/v1\/clube_assinantes\?barbearia_id=eq\./, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/campanha_envios\?enviado_em=gte\./, resposta: { corpo: [] } },
  ];
}

test("tela do dono: automações, prévia da semana com custo e link de agendamento; barbeiro não vê", async () => {
  const chamadas = A.instalarFetch(rotasDoPremium([{ metodo: "GET", padrao: /\/rest\/v1\/whatsapp_automacoes\?barbearia_id=eq\./, resposta: { corpo: [{ tipo: "aniversario", ativa: false, texto: "Parabéns, {nome}!", config: {} }] } }]));
  const r = await A.chamar(equipe, { query: { area: "clientes", premium: "1" }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.modo, "teste");
  assert.equal(r.body.automacoes.length, 7);
  const aniv = r.body.automacoes.find((a) => a.tipo === "aniversario");
  assert.deepEqual([aniv.ativa, aniv.texto], [false, "Parabéns, {nome}!"], "usa o que a barbearia salvou");
  assert.match(aniv.padrao, /Feliz aniversário/, "o texto padrão volta com um toque");
  const tiposPrevia = r.body.previa.mensagens.map((m) => m.tipo);
  assert.ok(tiposPrevia.includes("lembrete_vespera") && tiposPrevia.includes("lembrete_2h"));
  assert.ok(tiposPrevia.includes("retorno"), "Ana passou do ritmo (40 dias)");
  assert.match(r.body.previa.mensagens.find((m) => m.tipo === "retorno").texto, /https:\/\/biosite\.teste\/gw-teste$/);
  assert.ok(chamadas.some((c) => c.url.includes("campanhas!inner(barbearia_id)") && c.url.includes(`campanhas.barbearia_id=eq.${UUIDS.barbearia}`)), "contatos recentes só da própria barbearia");
  const barbeiro = await A.chamar(equipe, { query: { area: "clientes", premium: "1" }, token: "token-bruno" });
  assert.equal(barbeiro.statusCode, 403);
});

test("salvar automação: valida, guarda por barbearia e mantém o texto ao só ligar/desligar", async () => {
  const chamadas = A.instalarFetch(rotasDoPremium([
    { metodo: "GET", padrao: /\/rest\/v1\/whatsapp_automacoes\?barbearia_id=eq\./, resposta: { corpo: [{ ativa: true, texto: "Texto salvo antes, {nome}.", config: { oferta: "antiga" } }] } },
    { metodo: "POST", padrao: /\/rest\/v1\/whatsapp_automacoes\?on_conflict=barbearia_id,tipo$/, resposta: { status: 201 } },
  ]));
  const salvar = (corpo, token = "token-dono") => A.chamar(equipe, { metodo: "POST", query: { area: "clientes" }, token, corpo: { acao: "automacao-salvar", ...corpo } });
  assert.equal((await salvar({ tipo: "spam" })).statusCode, 400);
  assert.equal((await salvar({ tipo: "retorno", texto: "curto" })).statusCode, 400);
  assert.equal((await salvar({ tipo: "pos_atendimento", config: { avaliacao: "g.page/r/x" } })).statusCode, 400, "link sem https");
  assert.equal((await salvar({ tipo: "retorno", ativa: false }, "token-bruno")).statusCode, 403);
  assert.equal(chamadas.filter((c) => c.metodo === "POST" && c.url.includes("whatsapp_automacoes")).length, 0);

  const ok = await salvar({ tipo: "reconquista", ativa: false });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  let post = chamadas.filter((c) => c.metodo === "POST" && c.url.includes("whatsapp_automacoes")).pop();
  assert.match(post.headers.Prefer, /resolution=merge-duplicates/);
  assert.deepEqual([post.corpo.barbearia_id, post.corpo.tipo, post.corpo.ativa, post.corpo.texto], [UUIDS.barbearia, "reconquista", false, "Texto salvo antes, {nome}."]);
  await salvar({ tipo: "reconquista", texto: "Volte, {nome}! {oferta}", config: { oferta: "  Corte com 15% de desconto  " } });
  post = chamadas.filter((c) => c.metodo === "POST" && c.url.includes("whatsapp_automacoes")).pop();
  assert.deepEqual([post.corpo.texto, post.corpo.config.oferta], ["Volte, {nome}! {oferta}", "Corte com 15% de desconto"]);
  await salvar({ tipo: "pos_atendimento", config: { avaliacao: "https://g.page/r/abc123" } });
  post = chamadas.filter((c) => c.metodo === "POST" && c.url.includes("whatsapp_automacoes")).pop();
  assert.equal(post.corpo.config.avaliacao, "https://g.page/r/abc123");
});

test("tela do Premium no painel do dono e migração da fase 15 só acrescenta", () => {
  const dono = ler("painel-dono.html");
  assert.match(dono, /<script src="\/painel-premium\.js"><\/script>/);
  assert.match(dono, /extra: window\.Premium\.cartao\(\)/);
  assert.match(dono, /window\.Premium\.carregar\(\)/);
  const tela = ler("painel-premium.js");
  assert.match(tela, /Modo de teste: nada é enviado ainda/);
  assert.match(tela, /acao: "automacao-salvar", tipo: a\.tipo, ativa: chave\.checked/);
  assert.ok(!ler("painel-barbeiro.html").includes("painel-premium.js"), "barbeiro não tem a tela do Premium");
  const sql = ler("supabase/fase15-whatsapp-automacoes.sql").toLowerCase().replace(/--.*$/gm, "");
  assert.match(sql, /create table if not exists public\.whatsapp_automacoes/);
  assert.match(sql, /revoke all on public\.whatsapp_automacoes from anon, authenticated/);
  assert.ok(!/^\s*(drop|delete|truncate|update)\b/m.test(sql));
});
