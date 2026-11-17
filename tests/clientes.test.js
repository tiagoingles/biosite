// Carteira de clientes: regras (CPF, datas, retorno no ritmo de cada cliente, aniversário), aba Clientes
// do dono e do barbeiro, cadastro, importação da planilha, convite de cadastro pelo celular do cliente,
// WhatsApp opcional no agendamento do site, vínculo com o atendimento, campanhas e LGPD.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const A = require("./ajuda");
const C = require("../lib/clientes");
const equipe = require("../api/equipe");
const pedido = require("../api/pedido");
const G = require("../lib/gerador");

const { UUIDS } = A;
const CL1 = "dddddddd-0000-4000-8000-000000000001";
const CL2 = "dddddddd-0000-4000-8000-000000000002";
const CL3 = "dddddddd-0000-4000-8000-000000000003";
const CL4 = "dddddddd-0000-4000-8000-000000000004";
const CL5 = "dddddddd-0000-4000-8000-000000000005";
const CAMP = "eeeeeeee-0000-4000-8000-000000000001";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWx";
const ler = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const d = A.daquiA;

// ---------- regras ----------
test("CPF: confere os dígitos verificadores e mascara nas listas", () => {
  assert.equal(C.cpfValido("529.982.247-25"), true);
  assert.equal(C.cpfValido("52998224725"), true);
  assert.equal(C.cpfValido("529.982.247-24"), false, "dígito errado");
  assert.equal(C.cpfValido("111.111.111-11"), false, "todos iguais");
  assert.equal(C.cpfValido("123"), false);
  assert.equal(C.mascararCpf("52998224725"), "***.982.247-**");
});

test("datas como a pessoa digita ou a planilha traz", () => {
  const hoje = "2026-11-15";
  assert.equal(C.lerData("20/05/1990", { hoje }), "1990-05-20");
  assert.equal(C.lerData("20/5/90", { hoje }), "1990-05-20");
  assert.equal(C.lerData("05/03/05", { hoje }), "2005-03-05");
  assert.equal(C.lerData("1990-05-20", { hoje }), "1990-05-20");
  assert.equal(C.lerData("20.05.1990", { hoje }), "1990-05-20");
  assert.equal(C.lerData("29/02/2024", { hoje }), "2024-02-29");
  assert.equal(C.lerData("31/02/1990", { hoje }), null, "dia que não existe");
  assert.equal(C.lerData("ontem", { hoje }), null);
  assert.equal(C.lerData("", { hoje }), "");
  assert.equal(C.lerData("20/05", { hoje }), null, "sem ano só vale para aniversário");
  assert.equal(C.lerData("20/05", { hoje, semAno: true }), "1904-05-20", "aniversário sem ano guarda 1904");
});

test("retorno no ritmo de cada cliente", () => {
  const hoje = "2026-11-15";
  const r = (dias, extra = {}) => C.retorno({ dias, ...extra }, hoje);
  // A cada 20 dias: atrasado depois de 30 (1,5 ciclo), sumido depois de 60, perdido depois de 180
  const vinte = (ultima) => [-60, -40, -20].map((n) => addDias(ultima, n)).concat([ultima]);
  function addDias(iso, n) { const x = new Date(iso + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  assert.equal(r(vinte("2026-10-26")).status, "em_dia", "20 dias");
  assert.equal(r(vinte("2026-10-26")).ciclo, 20);
  assert.equal(r(vinte("2026-10-26")).previsao, "2026-11-15");
  assert.equal(r(vinte("2026-10-10")).status, "atrasado", "36 dias");
  assert.equal(r(vinte("2026-09-01")).status, "sumido", "75 dias");
  assert.equal(r(vinte("2026-03-01")).status, "perdido", "259 dias");
  // Uma visita só: novo até 45 dias (ciclo padrão de 30)
  assert.equal(r(["2026-11-01"]).status, "novo");
  assert.equal(r(["2026-09-20"]).status, "atrasado");
  // Com horário marcado não é para chamar
  assert.equal(r(["2026-08-01"], { proximo: "2026-11-20" }).status, "agendado");
  assert.equal(r([]).status, "sem_visita");
  // Última visita da planilha (antes do Bio Site) conta
  const ext = r([], { externa: "2026-09-30" });
  assert.deepEqual([ext.status, ext.ultima, ext.visitas], ["atrasado", "2026-09-30", 0]);
  // Visitas no mesmo dia contam uma vez; ciclo limitado entre 7 e 120 dias
  assert.equal(r(["2026-11-10", "2026-11-10", "2026-11-12"]).visitas, 2);
  assert.equal(r(["2026-11-01", "2026-11-03", "2026-11-05"]).ciclo, 7);
});

test("aniversário: próximo dia e 29/02 em ano que não é bissexto", () => {
  assert.deepEqual(C.aniversario("1990-11-20", "2026-11-15"), { dia: "20/11", diasAte: 5, mes: 11 });
  assert.deepEqual(C.aniversario("1990-11-15", "2026-11-15"), { dia: "15/11", diasAte: 0, mes: 11 });
  assert.equal(C.aniversario("1990-01-10", "2026-11-15").diasAte, 56, "passou: conta o do ano que vem");
  assert.equal(C.aniversario("1904-02-29", "2026-11-15").diasAte, 105, "comemora em 28/02/2027");
  assert.equal(C.aniversario(null), null);
});

// ---------- aba Clientes ----------
function rotasDaCarteira(extra = []) {
  return [
    ...extra,
    ...A.rotasDeConta(),
    {
      padrao: /\/rest\/v1\/clientes\?barbearia_id=eq\./,
      resposta: {
        corpo: [
          { id: CL1, nome: "Ana Souza", telefone: "81999990001", cpf: "52998224725", nascimento: "1990-05-20", observacao: "", profissional_id: UUIDS.bruno, origem: "site", ultima_visita_externa: null, aceita_novidades: true, aceite_em: "2026-10-01T12:00:00Z", aceite_origem: "site", saiu_em: null, criado_em: "2026-08-01T12:00:00Z" },
          { id: CL2, nome: "Bia Lima", telefone: null, cpf: null, nascimento: null, observacao: "", profissional_id: null, origem: "painel", ultima_visita_externa: null, aceita_novidades: false, aceite_em: null, aceite_origem: null, saiu_em: null, criado_em: "2026-11-01T12:00:00Z" },
          { id: CL3, nome: "Caio Reis", telefone: "81999990003", cpf: null, nascimento: null, observacao: "", profissional_id: UUIDS.rafael, origem: "site", ultima_visita_externa: null, aceita_novidades: true, aceite_em: "2026-01-01T12:00:00Z", aceite_origem: "site", saiu_em: "2026-06-01T12:00:00Z", criado_em: "2026-01-01T12:00:00Z" },
          { id: CL4, nome: "Duda Melo", telefone: "81999990004", cpf: null, nascimento: null, observacao: "", profissional_id: null, origem: "convite", ultima_visita_externa: null, aceita_novidades: false, aceite_em: null, aceite_origem: null, saiu_em: null, criado_em: "2026-09-01T12:00:00Z" },
          { id: CL5, nome: "Edu Prado", telefone: "81999990005", cpf: null, nascimento: null, observacao: "", profissional_id: null, origem: "importacao", ultima_visita_externa: d(-50), aceita_novidades: false, aceite_em: null, aceite_origem: null, saiu_em: null, criado_em: "2026-10-01T12:00:00Z" },
        ],
      },
    },
    {
      padrao: /\/rest\/v1\/pedidos\?barbearia_id=eq\.[^&]+&cliente_id=not\.is\.null/,
      resposta: {
        corpo: [
          { cliente_id: CL1, dia: d(-80), status: "realizado", valor: "40", profissional_id: UUIDS.bruno },
          { cliente_id: CL1, dia: d(-60), status: "realizado", valor: "40", profissional_id: UUIDS.bruno },
          { cliente_id: CL1, dia: d(-40), status: "realizado", valor: "60", profissional_id: UUIDS.rafael },
          { cliente_id: CL2, dia: d(-10), status: "realizado", valor: "35", profissional_id: UUIDS.bruno },
          { cliente_id: CL3, dia: d(-200), status: "realizado", valor: "40", profissional_id: UUIDS.rafael },
          { cliente_id: CL4, dia: d(-35), status: "realizado", valor: "0", profissional_id: UUIDS.rafael },
          { cliente_id: CL4, dia: d(2), status: "confirmado", valor: "40", profissional_id: UUIDS.rafael },
        ],
      },
    },
    { padrao: /\/rest\/v1\/profissionais\?barbearia_id=eq\./, resposta: { corpo: [{ id: UUIDS.bruno, nome: "Bruno" }, { id: UUIDS.rafael, nome: "Rafael" }] } },
  ];
}

test("aba Clientes do dono: retorno, segmentos, números e CPF mascarado", async () => {
  const chamadas = A.instalarFetch(rotasDaCarteira());
  const r = await A.chamar(equipe, { query: { area: "clientes" }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const de = (id) => r.body.clientes.find((c) => c.id === id);
  assert.equal(de(CL1).status, "atrasado");
  assert.equal(de(CL1).ciclo, 20);
  assert.equal(de(CL1).cpfMascarado, "***.982.247-**");
  assert.equal(de(CL1).cpf, undefined, "a lista não leva o CPF inteiro");
  assert.equal(de(CL1).barbeiro, "Bruno", "quem mais atendeu");
  assert.equal(de(CL1).ticket, 46.67);
  assert.ok(de(CL1).segmentos.includes("chamar"));
  assert.equal(de(CL2).status, "novo");
  assert.equal(de(CL3).status, "perdido");
  assert.ok(de(CL3).segmentos.includes("sumidos"));
  assert.equal(de(CL3).aceita, false, "pediu para sair");
  assert.equal(de(CL3).saiu, true);
  assert.equal(de(CL4).status, "agendado");
  assert.equal(de(CL4).proximo, d(2));
  assert.equal(de(CL4).ticket, 0, "atendimento do clube (R$ 0) não entra no ticket");
  assert.equal(de(CL5).status, "atrasado");
  assert.equal(de(CL5).ultima, d(-50));
  assert.equal(r.body.kpis.total, 5);
  assert.equal(r.body.kpis.comWhats, 4);
  assert.equal(r.body.kpis.aceitam, 1);
  assert.equal(r.body.segmentos.chamar, 2);
  assert.ok(chamadas.every((c) => !c.url.includes("/rest/v1/clientes?") || c.url.includes(`barbearia_id=eq.${UUIDS.barbearia}`)), "só a barbearia do dono");
});

test("barbeiro vê a própria carteira, sem CPF nem ano de nascimento", async () => {
  A.instalarFetch(rotasDaCarteira());
  const r = await A.chamar(equipe, { query: { area: "clientes" }, token: "token-bruno" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.clientes.map((c) => c.nome), ["Ana Souza", "Bia Lima"], "cadastrou ou atendeu");
  assert.ok(r.body.clientes.every((c) => c.cpfMascarado === "" && c.nascimento === null));
  assert.equal(r.body.clientes[0].aniversario.dia, "20/05", "aniversário sem o ano");
  assert.equal(r.body.dono, false);
  const semLogin = await A.chamar(equipe, { query: { area: "clientes" } });
  assert.equal(semLogin.statusCode, 401);
});

// ---------- cadastro no painel ----------
test("cadastro: valida, normaliza, registra o aceite e liga o atendimento", async () => {
  const chamadas = A.instalarFetch([
    ...A.rotasDeConta(),
    { metodo: "POST", padrao: /\/rest\/v1\/clientes$/, resposta: (u, o, corpo) => ({ status: 201, corpo: [{ id: CL1, ...corpo }] }) },
    { metodo: "PATCH", padrao: /\/rest\/v1\/pedidos\?id=eq\./, resposta: { corpo: [{ id: UUIDS.pedido }] } },
  ]);
  const enviar = (corpo, token = "token-dono") => A.chamar(equipe, { metodo: "POST", query: { area: "clientes" }, token, corpo: { acao: "salvar", ...corpo } });
  assert.equal((await enviar({ nome: "A" })).statusCode, 400);
  assert.match((await enviar({ nome: "Ana", telefone: "123" })).body.message, /WhatsApp/);
  assert.match((await enviar({ nome: "Ana", cpf: "529.982.247-24" })).body.message, /CPF inválido/);
  assert.match((await enviar({ nome: "Ana", nascimento: "31/02/1990" })).body.message, /nascimento/);
  assert.equal(chamadas.filter((c) => c.metodo === "POST" && /\/clientes$/.test(c.url)).length, 0, "nada gravado com erro");

  const r = await enviar({ nome: "Ana Souza", telefone: "+55 (81) 9 9999-0001", cpf: "529.982.247-25", nascimento: "20/05/1990", aceita: true, pedidoId: UUIDS.pedido });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  const post = chamadas.find((c) => c.metodo === "POST" && /\/clientes$/.test(c.url)).corpo;
  assert.equal(post.telefone, "81999990001");
  assert.equal(post.cpf, "52998224725");
  assert.equal(post.nascimento, "1990-05-20");
  assert.equal(post.barbearia_id, UUIDS.barbearia);
  assert.equal(post.origem, "painel");
  assert.equal(post.aceita_novidades, true);
  assert.equal(post.aceite_origem, "painel");
  assert.ok(post.aceite_em);
  const liga = chamadas.find((c) => c.metodo === "PATCH");
  assert.match(liga.url, new RegExp(`id=eq\\.${UUIDS.pedido}&barbearia_id=eq\\.${UUIDS.barbearia}`));
  assert.deepEqual(liga.corpo, { cliente_id: CL1 });
});

test("cadastro: WhatsApp ou CPF repetido vira mensagem clara", async () => {
  A.instalarFetch([
    ...A.rotasDeConta(),
    { metodo: "POST", padrao: /\/rest\/v1\/clientes$/, resposta: (u, o, corpo) => ({ status: 409, corpo: { message: corpo.cpf ? 'duplicate key value violates unique constraint "clientes_cpf_unico"' : 'duplicate key value violates unique constraint "clientes_telefone_unico"' } }) },
  ]);
  const zap = await A.chamar(equipe, { metodo: "POST", query: { area: "clientes" }, token: "token-dono", corpo: { acao: "salvar", nome: "Ana", telefone: "81999990001" } });
  assert.deepEqual([zap.statusCode, zap.body.message], [409, "Já existe um cliente com este WhatsApp."]);
  const cpf = await A.chamar(equipe, { metodo: "POST", query: { area: "clientes" }, token: "token-dono", corpo: { acao: "salvar", nome: "Ana", cpf: "52998224725" } });
  assert.deepEqual([cpf.statusCode, cpf.body.message], [409, "Já existe um cliente com este CPF."]);
});

test("barbeiro: cadastra na própria carteira, sem CPF nem aceite, e não mexe em cliente de outro", async () => {
  const chamadas = A.instalarFetch([
    ...A.rotasDeConta(),
    { metodo: "POST", padrao: /\/rest\/v1\/clientes$/, resposta: (u, o, corpo) => ({ status: 201, corpo: [{ id: CL2, ...corpo }] }) },
    { metodo: "GET", padrao: /\/rest\/v1\/clientes\?id=eq\./, resposta: (url) => ({ corpo: url.includes(CL3) ? [{ id: CL3, profissional_id: UUIDS.rafael, aceita_novidades: false, saiu_em: null, nascimento: null }] : [{ id: CL1, profissional_id: UUIDS.bruno, aceita_novidades: false, saiu_em: null, nascimento: "1990-05-20" }] }) },
    { metodo: "GET", padrao: /\/rest\/v1\/pedidos\?cliente_id=eq\./, resposta: { corpo: [] } },
    { metodo: "PATCH", padrao: /\/rest\/v1\/clientes\?id=eq\./, resposta: (u, o, corpo) => ({ corpo: [{ id: CL1, ...corpo }] }) },
  ]);
  const novo = await A.chamar(equipe, { metodo: "POST", query: { area: "clientes" }, token: "token-bruno", corpo: { acao: "salvar", nome: "Bia Lima", cpf: "52998224725", aceita: true } });
  assert.equal(novo.statusCode, 201, JSON.stringify(novo.body));
  const post = chamadas.find((c) => c.metodo === "POST").corpo;
  assert.equal(post.profissional_id, UUIDS.bruno);
  assert.equal(post.cpf, undefined, "barbeiro não grava CPF");
  assert.equal(post.aceita_novidades, undefined, "aceite só pelo dono ou pelo próprio cliente");

  const alheio = await A.chamar(equipe, { metodo: "POST", query: { area: "clientes" }, token: "token-bruno", corpo: { acao: "salvar", id: CL3, nome: "Caio" } });
  assert.equal(alheio.statusCode, 403);
  const meu = await A.chamar(equipe, { metodo: "POST", query: { area: "clientes" }, token: "token-bruno", corpo: { acao: "salvar", id: CL1, nome: "Ana S.", nascimento: "" } });
  assert.equal(meu.statusCode, 200, JSON.stringify(meu.body));
  const patch = chamadas.find((c) => c.metodo === "PATCH").corpo;
  assert.equal("nascimento" in patch, false, "não apaga a data que o dono cadastrou");
});

// ---------- importação ----------
function rotasDaImportacao(existentes) {
  return [
    ...A.rotasDeConta(),
    { metodo: "GET", padrao: /\/rest\/v1\/clientes\?barbearia_id=eq\./, resposta: { corpo: existentes } },
    { metodo: "POST", padrao: /\/rest\/v1\/clientes$/, resposta: { status: 201 } },
    { metodo: "PATCH", padrao: /\/rest\/v1\/clientes\?id=eq\./, resposta: { status: 204 } },
  ];
}
const PLANILHA = [
  { nome: "Ana Souza", telefone: "(81) 98111-2233", cpf: "529.982.247-25", nascimento: "12/04/1988", ultima_visita: "01/10/2026" },
  { nome: "Bruno Costa", telefone: "81 9 8222-3344", nascimento: "1990-07-30" },
  { nome: "Sem Telefone Silva" },
  { nome: "X", telefone: "81999990000" },
  { nome: "Carla Dias", telefone: "(81) 98333" },
  { nome: "Daniel Rocha", cpf: "111.111.111-11" },
  { nome: "Já Existe", telefone: "(81) 99999-0001", cpf: "11144477735" },
  { nome: "Ana Repetida", telefone: "81981112233" },
];

test("importação: conferência antes de gravar não grava nada", async () => {
  const chamadas = A.instalarFetch(rotasDaImportacao([{ id: CL1, telefone: "81999990001", cpf: null, nascimento: null, observacao: "", ultima_visita_externa: null, aceita_novidades: false, saiu_em: null }]));
  const r = await A.chamar(equipe, { metodo: "POST", query: { area: "clientes" }, token: "token-dono", corpo: { acao: "importar", simular: true, linhas: PLANILHA } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.simulado, true);
  assert.equal(r.body.inseridos, 3);
  assert.equal(r.body.atualizados, 1, "completa o CPF de quem já existia");
  assert.deepEqual(r.body.ignorados.map((x) => [x.linha, x.motivo]), [[4, "sem nome"], [5, "WhatsApp inválido"], [6, "CPF inválido"], [8, "repetido na planilha"]]);
  assert.ok(!chamadas.some((c) => c.metodo === "POST" || c.metodo === "PATCH"));
});

test("importação: grava os novos de uma vez, só completa os vazios e registra o aceite", async () => {
  const chamadas = A.instalarFetch(rotasDaImportacao([{ id: CL1, telefone: "81999990001", cpf: null, nascimento: "1980-01-01", observacao: "", ultima_visita_externa: null, aceita_novidades: false, saiu_em: null }]));
  const r = await A.chamar(equipe, { metodo: "POST", query: { area: "clientes" }, token: "token-dono", corpo: { acao: "importar", aceitaram: true, linhas: PLANILHA } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.inseridos, r.body.atualizados, r.body.totalIgnorados], [3, 1, 4]);
  const lote = chamadas.find((c) => c.metodo === "POST").corpo;
  assert.equal(lote.length, 3);
  assert.deepEqual(lote[0], {
    barbearia_id: UUIDS.barbearia, nome: "Ana Souza", telefone: "81981112233", cpf: "52998224725", nascimento: "1988-04-12", observacao: "",
    ultima_visita_externa: "2026-10-01", origem: "importacao", aceita_novidades: true, aceite_em: lote[0].aceite_em, aceite_origem: "importacao",
  });
  const patch = chamadas.find((c) => c.metodo === "PATCH");
  assert.match(patch.url, new RegExp(`id=eq\\.${CL1}&barbearia_id=eq\\.${UUIDS.barbearia}`));
  assert.equal(patch.corpo.cpf, "11144477735");
  assert.equal("nascimento" in patch.corpo, false, "não troca o nascimento que já existia");
  assert.equal(patch.corpo.aceite_origem, "importacao");
});

test("importação: só o dono, até 2.000 linhas", async () => {
  A.instalarFetch(rotasDaImportacao([]));
  const barbeiro = await A.chamar(equipe, { metodo: "POST", query: { area: "clientes" }, token: "token-bruno", corpo: { acao: "importar", linhas: PLANILHA } });
  assert.equal(barbeiro.statusCode, 403);
  const demais = await A.chamar(equipe, { metodo: "POST", query: { area: "clientes" }, token: "token-dono", corpo: { acao: "importar", linhas: Array.from({ length: 2001 }, (_, i) => ({ nome: "Cliente " + i })) } });
  assert.equal(demais.statusCode, 400);
});

// ---------- convite de cadastro ----------
test("convite: link de uso único ligado ao atendimento; barbeiro só nos próprios atendimentos", async () => {
  const chamadas = A.instalarFetch([
    ...A.rotasDeConta(),
    { metodo: "GET", padrao: /\/rest\/v1\/pedidos\?id=eq\./, resposta: (url) => ({ corpo: url.includes("profissional_id=eq.") ? [] : [{ id: UUIDS.pedido, cliente: "Ana Souza", profissional_id: UUIDS.rafael, cliente_id: null }] }) },
    { metodo: "POST", padrao: /\/rest\/v1\/clientes_convites$/, resposta: { status: 201 } },
  ]);
  const r = await A.chamar(equipe, { metodo: "POST", query: { area: "clientes" }, token: "token-dono", corpo: { acao: "convite", pedidoId: UUIDS.pedido, telefone: "(81) 99999-0001" } });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.match(r.body.token, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(r.body.link, "https://biosite.teste/cadastro?c=" + r.body.token);
  const cv = chamadas.find((c) => c.metodo === "POST").corpo;
  assert.deepEqual([cv.barbearia_id, cv.pedido_id, cv.profissional_id, cv.nome, cv.telefone], [UUIDS.barbearia, UUIDS.pedido, UUIDS.rafael, "Ana Souza", "81999990001"]);
  const dias = (Date.parse(cv.expira_em) - Date.now()) / 864e5;
  assert.ok(dias > 2.9 && dias < 3.1, "vale 3 dias");
  const alheio = await A.chamar(equipe, { metodo: "POST", query: { area: "clientes" }, token: "token-bruno", corpo: { acao: "convite", pedidoId: UUIDS.pedido } });
  assert.equal(alheio.statusCode, 404, "atendimento de outro barbeiro");
});

test("página do convite: link inválido, usado ou vencido; senão mostra a barbearia", async () => {
  const linha = (extra) => ({ nome: "Ana", telefone: "81999990001", expira_em: new Date(Date.now() + 864e5).toISOString(), usado_em: null, barbearias: { nome: "GW Barbearia", slug: "gw-teste" }, ...extra });
  let atual = linha();
  A.instalarFetch([...A.rotasDeConta(), { padrao: /\/rest\/v1\/clientes_convites\?token=eq\./, resposta: () => ({ corpo: atual ? [atual] : [] }) }]);
  const abrir = (token = TOKEN) => A.chamar(pedido, { query: { convite: token } });
  assert.equal((await abrir("curto")).statusCode, 404);
  const ok = await abrir();
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body, { barbearia: "GW Barbearia", slug: "gw-teste", nome: "Ana", telefone: "81999990001" });
  atual = linha({ usado_em: new Date().toISOString() });
  assert.equal((await abrir()).statusCode, 410);
  atual = linha({ expira_em: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await abrir()).statusCode, 410);
  atual = null;
  assert.equal((await abrir()).statusCode, 404);
});

test("cadastro pelo convite: confere os campos, grava numa operação só e explica cada recusa", async () => {
  let resposta = { ok: true, cliente_id: CL1 };
  const chamadas = A.instalarFetch([...A.rotasDeConta(), { metodo: "POST", padrao: /\/rest\/v1\/rpc\/cliente_do_convite$/, resposta: () => ({ corpo: resposta }) }]);
  const enviar = (corpo) => A.chamar(pedido, { metodo: "POST", query: { convite: TOKEN }, corpo, headers: { "x-real-ip": "198.51.100.77" } });
  assert.equal((await enviar({ nome: "A", whatsapp: "81999990001" })).statusCode, 400);
  assert.equal((await enviar({ nome: "Ana", whatsapp: "123" })).statusCode, 400);
  assert.equal((await enviar({ nome: "Ana", whatsapp: "81999990001", cpf: "111.111.111-11" })).statusCode, 400);
  assert.equal((await enviar({ nome: "Ana", whatsapp: "81999990001", nascimento: "31/02/1990" })).statusCode, 400);
  assert.equal((await enviar({ nome: "Ana", whatsapp: "81999990001", website: "robo" })).statusCode, 201, "campo-isca: finge que deu certo");
  assert.equal(chamadas.filter((c) => c.url.includes("cliente_do_convite")).length, 0, "nada chega ao banco");

  const r = await enviar({ nome: "Ana Souza", whatsapp: "(81) 99999-0001", cpf: "529.982.247-25", nascimento: "20/05/1990", novidades: true });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.deepEqual(chamadas.find((c) => c.url.includes("cliente_do_convite")).corpo, { p_token: TOKEN, p_nome: "Ana Souza", p_telefone: "81999990001", p_cpf: "52998224725", p_nascimento: "1990-05-20", p_novidades: true });
  resposta = { erro: "cpf" };
  assert.deepEqual([(await enviar({ nome: "Ana", whatsapp: "81999990001", cpf: "52998224725" })).statusCode], [409]);
  resposta = { erro: "usado" };
  assert.equal((await enviar({ nome: "Ana", whatsapp: "81999990001" })).statusCode, 410);
  resposta = { erro: "expirado" };
  const venceu = await enviar({ nome: "Ana", whatsapp: "81999990001" });
  assert.deepEqual([venceu.statusCode, venceu.body.message], [410, "Este link venceu. Peça um novo na barbearia."]);
});

// ---------- agendamento pelo site ----------
function rotasDoSite(clienteRpc = () => ({ corpo: CL1 })) {
  return [
    { padrao: /\/rest\/v1\/rpc\/contar_tentativa/, resposta: { corpo: 0 } },
    ...A.rotasDeConta(),
    { padrao: /\/rest\/v1\/barbearias\?slug=eq\.gw-teste/, resposta: { corpo: [{ id: UUIDS.barbearia }] } },
    { padrao: /\/rest\/v1\/profissionais\?barbearia_id=eq\./, resposta: { corpo: [{ id: UUIDS.bruno, nome: "Bruno" }] } },
    { padrao: /\/rest\/v1\/agenda_dia\?profissional_id=eq\./, resposta: { corpo: [{ inicio: "09:00:00", fim: "18:00:00", almoco_inicio: null, almoco_fim: null, confirmada_em: "2026-11-01T10:00:00Z" }] } },
    { padrao: /\/rest\/v1\/bloqueios\?/, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/pedidos\?profissional_id=eq\./, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/servicos_precos\?barbearia_id=eq\./, resposta: { corpo: [{ preco: "40.00" }] } },
    { padrao: /\/rest\/v1\/rpc\/criar_pedido/, resposta: { corpo: { id: UUIDS.pedido } } },
    { padrao: /\/rest\/v1\/rpc\/cliente_do_agendamento/, resposta: (u, o, corpo) => clienteRpc(corpo) },
  ];
}
const agendamento = (extra = {}) => ({ slug: "gw-teste", servico: "Corte", profissionalId: UUIDS.bruno, profissional: "Bruno", dia: A.daquiA(1), horario: "10:00", cliente: "Ana Souza", duracao: 30, ...extra });
let ip = 40;
const novoIp = () => ({ "x-real-ip": "198.51.100." + ip++ });

test("agendamento com WhatsApp liga o pedido ao cadastro do cliente (com o aceite de novidades)", async () => {
  const chamadas = A.instalarFetch(rotasDoSite());
  const r = await A.chamar(pedido, { metodo: "POST", corpo: agendamento({ whatsapp: "(81) 98877-6655", novidades: true }), headers: novoIp() });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.deepEqual(chamadas.find((c) => c.url.includes("cliente_do_agendamento")).corpo, { p_barbearia: UUIDS.barbearia, p_pedido: UUIDS.pedido, p_nome: "Ana Souza", p_telefone: "81988776655", p_novidades: true });
});

test("agendamento: WhatsApp é opcional, mas tem que ser válido; falha do cadastro não derruba o pedido", async () => {
  let chamadas = A.instalarFetch(rotasDoSite());
  const sem = await A.chamar(pedido, { metodo: "POST", corpo: agendamento(), headers: novoIp() });
  assert.equal(sem.statusCode, 201);
  assert.ok(!chamadas.some((c) => c.url.includes("cliente_do_agendamento")), "sem número, sem cadastro");

  chamadas = A.instalarFetch(rotasDoSite());
  const errado = await A.chamar(pedido, { metodo: "POST", corpo: agendamento({ whatsapp: "12345" }), headers: novoIp() });
  assert.deepEqual([errado.statusCode, errado.body.message], [400, "Confira seu WhatsApp: DDD e número."]);
  assert.ok(!chamadas.some((c) => c.url.includes("criar_pedido")), "não grava o pedido");

  A.instalarFetch(rotasDoSite(() => ({ status: 500, corpo: { message: "falhou" } })));
  const falhou = await A.chamar(pedido, { metodo: "POST", corpo: agendamento({ whatsapp: "81988776655" }), headers: novoIp() });
  assert.equal(falhou.statusCode, 201, "o pedido já foi gravado");
});

// ---------- vínculo, campanhas e LGPD ----------
test("vincular: dono em qualquer atendimento; barbeiro só nos dele; cliente de outra barbearia não", async () => {
  const chamadas = A.instalarFetch([
    ...A.rotasDeConta(),
    { metodo: "GET", padrao: /\/rest\/v1\/clientes\?id=eq\./, resposta: (url) => ({ corpo: url.includes(CL1) ? [{ id: CL1 }] : [] }) },
    { metodo: "PATCH", padrao: /\/rest\/v1\/pedidos\?id=eq\./, resposta: { corpo: [{ id: UUIDS.pedido }] } },
  ]);
  const ligar = (token, clienteId = CL1) => A.chamar(equipe, { metodo: "POST", query: { area: "clientes" }, token, corpo: { acao: "vincular", pedidoId: UUIDS.pedido, clienteId } });
  assert.equal((await ligar("token-dono")).statusCode, 200);
  assert.ok(!chamadas.filter((c) => c.metodo === "PATCH")[0].url.includes("profissional_id"));
  assert.equal((await ligar("token-bruno")).statusCode, 200);
  assert.ok(chamadas.filter((c) => c.metodo === "PATCH")[1].url.includes(`profissional_id=eq.${UUIDS.bruno}`));
  assert.equal((await ligar("token-dono", CL2)).statusCode, 404);
});

test("campanhas: criar, anotar envio e contar quem voltou em até 30 dias", async () => {
  const enviado = new Date(Date.parse(A.daquiA(-20) + "T13:00:00Z")).toISOString();
  const chamadas = A.instalarFetch([
    ...A.rotasDeConta(),
    { metodo: "POST", padrao: /\/rest\/v1\/campanhas$/, resposta: { status: 201, corpo: [{ id: CAMP }] } },
    { metodo: "GET", padrao: /\/rest\/v1\/campanhas\?id=eq\./, resposta: { corpo: [{ id: CAMP }] } },
    { metodo: "GET", padrao: /\/rest\/v1\/clientes\?id=eq\./, resposta: { corpo: [{ id: CL1 }] } },
    { metodo: "POST", padrao: /\/rest\/v1\/campanha_envios/, resposta: { status: 201 } },
    { metodo: "GET", padrao: /\/rest\/v1\/campanhas\?barbearia_id=eq\./, resposta: { corpo: [{ id: CAMP, nome: "Chamar de volta", segmento: "chamar", mensagem: "Oi", criado_em: enviado }] } },
    { metodo: "GET", padrao: /\/rest\/v1\/campanha_envios\?campanha_id=in\./, resposta: { corpo: [{ campanha_id: CAMP, cliente_id: CL1, enviado_em: enviado }, { campanha_id: CAMP, cliente_id: CL2, enviado_em: enviado }] } },
    { metodo: "GET", padrao: /\/rest\/v1\/pedidos\?barbearia_id=eq\.[^&]+&cliente_id=in\./, resposta: { corpo: [{ cliente_id: CL1, dia: A.daquiA(-10), valor: "50" }, { cliente_id: CL2, dia: A.daquiA(-25), valor: "40" }] } },
  ]);
  const criar = (corpo, token = "token-dono") => A.chamar(equipe, { metodo: "POST", query: { area: "clientes" }, token, corpo: { acao: "campanha-criar", ...corpo } });
  assert.equal((await criar({ nome: "X", mensagem: "Oi" })).statusCode, 400);
  assert.equal((await criar({ nome: "Chamar de volta", mensagem: "Oi" }, "token-bruno")).statusCode, 403);
  const c = await criar({ nome: "Chamar de volta", mensagem: "Olá, {nome}!", segmento: "chamar" });
  assert.equal(c.statusCode, 201);
  const env = await A.chamar(equipe, { metodo: "POST", query: { area: "clientes" }, token: "token-dono", corpo: { acao: "campanha-envio", campanhaId: CAMP, clienteId: CL1 } });
  assert.equal(env.statusCode, 200);
  const ins = chamadas.find((x) => x.metodo === "POST" && x.url.includes("campanha_envios"));
  assert.match(ins.headers.Prefer, /ignore-duplicates/, "tocar duas vezes não conta dois envios");
  const lista = await A.chamar(equipe, { query: { area: "clientes", campanhas: "1" }, token: "token-dono" });
  assert.equal(lista.statusCode, 200, JSON.stringify(lista.body));
  assert.deepEqual([lista.body.campanhas[0].enviados, lista.body.campanhas[0].voltaram, lista.body.campanhas[0].faturou], [2, 1, 50], "só o atendimento depois da mensagem conta");
});

test("LGPD: só o dono apaga os dados do cliente, sempre da própria barbearia", async () => {
  const chamadas = A.instalarFetch([...A.rotasDeConta(), { metodo: "DELETE", padrao: /\/rest\/v1\/clientes\?id=eq\./, resposta: { corpo: [{ id: CL1 }] } }]);
  assert.equal((await A.chamar(equipe, { metodo: "POST", query: { area: "clientes" }, token: "token-bruno", corpo: { acao: "apagar", id: CL1 } })).statusCode, 403);
  const r = await A.chamar(equipe, { metodo: "POST", query: { area: "clientes" }, token: "token-dono", corpo: { acao: "apagar", id: CL1 } });
  assert.equal(r.statusCode, 200);
  assert.match(chamadas.find((c) => c.metodo === "DELETE").url, new RegExp(`id=eq\\.${CL1}&barbearia_id=eq\\.${UUIDS.barbearia}`));
});

// ---------- telas, site e banco ----------
test("telas: aba Clientes nos dois painéis, Cadastrar no atendimento e página de cadastro", () => {
  for (const p of ["painel-dono.html", "painel-barbeiro.html"]) {
    const html = ler(p);
    assert.match(html, /data-aba="clientes"/);
    assert.match(html, /<script src="\/qr\.js"><\/script>\s*<script src="\/painel-clientes\.js"><\/script>/);
  }
  assert.match(ler("painel-agenda.js"), /window\.Clientes\.cadastrarDoAtendimento\(p, ctx\)/);
  const cadastro = ler("cadastro.html");
  assert.match(cadastro, /<input type="checkbox" id="novidades">/, "aceite começa desmarcado");
  assert.match(cadastro, /CPF <small>\(opcional\)<\/small>/);
  assert.match(ler("vercel.json"), /criador\|cadastro\)/, "página de cadastro fora do Google");
  const painel = ler("painel-clientes.js");
  assert.match(painel, /Só quem aceitou receber novidades/, "campanha respeita o aceite");
  assert.match(painel, /acao: "importar", simular: true/, "importação confere antes de gravar");
});

test("site (gerador v6): WhatsApp opcional, aceite desmarcado e nada disso no site sem cadastro", () => {
  assert.ok(G.VERSAO >= 6, "recurso existe desde o gerador v6");
  const cfg = { modelo: "cartao", nome: "GW", slug: "gw-teste", tipo: "barbearia", whatsapp: "81999999999", cor: "#111111", fundo: "#ffffff", texto: "#111111", fonteTitulo: "Poppins", fonteTexto: "Poppins", agenda: { ativo: true, servicos: [{ id: "s1", nome: "Corte", duracao: "30 min", preco: "40,00" }], profissionais: [{ id: "p1", nome: "Bruno", servicos: ["s1"], dias: [1, 2, 3] }] } };
  const html = G.bioHTML(cfg, (u) => u);
  assert.ok(html.includes("Seu WhatsApp <small>(opcional"));
  assert.ok(html.includes('<input type="checkbox" id="agNovidades">'), "aceite desmarcado");
  assert.ok(html.includes('var blocoZap=semCadastro?"":'), "site sem cadastro não pergunta o número");
  assert.ok(html.includes("if(digitos){corpo.whatsapp=zap;corpo.novidades=novidades}"));
  assert.ok(html.includes('guardar("nome",nome)'), "lembra nome e WhatsApp no aparelho");
  for (const site of ["gw-barbearia.html", "jm-barbearia.html"]) assert.ok(ler(site).includes("agNovidades"), site + " publicado com o gerador novo");
});

test("migração da fase 14 só acrescenta", () => {
  const sql = ler("supabase/fase14-clientes.sql").toLowerCase().replace(/--.*$/gm, "");
  assert.match(sql, /create table if not exists public\.clientes \(/);
  assert.match(sql, /add column if not exists cliente_id uuid references public\.clientes\(id\) on delete set null/);
  assert.match(sql, /revoke all on public\.clientes from anon, authenticated/);
  assert.match(sql, /revoke execute on function public\.cliente_do_convite/);
  assert.ok(!/^\s*(drop|delete|truncate)\b/m.test(sql), "nenhum comando apaga dados");
  assert.ok(!/drop (table|column|index|function|constraint)|alter column|rename/.test(sql), "nada existente muda");
});
