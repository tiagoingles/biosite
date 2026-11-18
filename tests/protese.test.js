// Prótese capilar (fase 20): seção em destaque no site, ficha do cliente, próxima manutenção,
// lembrete, atendimento realizado virando manutenção e a aba só para o dono.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const A = require("./ajuda");
const equipe = require("../api/equipe");
const G = require("../lib/gerador");
const { extrairConfig } = require("../lib/servidor");
const Pr = require("../lib/protese");
const { hojeBr, somaDias } = require("../lib/horarios");

const { UUIDS } = A;
const FICHA = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const ler = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("site: serviço marcado como prótese ganha seção própria em destaque, antes de Serviços", () => {
  const cfg = extrairConfig(ler("gw-barbearia.html"));
  const alvo = cfg.agenda.servicos[1];
  alvo.protese = true;
  const h = G.bioHTML(cfg, (u) => u);
  const ini = h.indexOf('id="protese"');
  const servicos = h.indexOf("<h2>Serviços</h2>");
  assert.ok(ini > 0 && ini < servicos, "seção de prótese antes dos serviços");
  assert.ok(h.slice(ini, h.indexOf("</section>", ini)).includes(`data-agendar="${alvo.id}"`), "o serviço abre o agendamento dele");
  assert.ok(!h.slice(servicos, h.indexOf("</section>", servicos)).includes(`data-agendar="${alvo.id}"`), "e sai da lista comum");
  assert.ok(!ler("gw-barbearia.html").includes('id="protese"'), "site sem prótese continua igual");
});

test("Criador marca o serviço como prótese (no cadastro e na tabela)", () => {
  const c = ler("criador.html");
  assert.match(c, /id="agSvcProt"/);
  assert.match(c, /data-agprot="\$\{i\}"/);
  assert.match(c, /if\(\$\("agSvcProt"\)\.checked\)svc\.protese=true;/);
});

test("próxima manutenção: última (ou a aplicação) + intervalo; atrasada, vence logo ou em dia", () => {
  const hoje = "2026-11-17";
  assert.deepEqual(Pr.situacao({ aplicada_em: "2026-11-01", ultima_manutencao: null, intervalo_dias: 21 }, hoje), { proxima: "2026-11-22", dias: 5, status: "em_dia", lembrado: false });
  assert.equal(Pr.situacao({ aplicada_em: "2026-10-01", ultima_manutencao: "2026-10-30", intervalo_dias: 21 }, hoje).status, "vence", "vence em 2 dias");
  const atrasada = Pr.situacao({ aplicada_em: "2026-09-01", ultima_manutencao: "2026-10-20", intervalo_dias: 21 }, hoje);
  assert.deepEqual([atrasada.proxima, atrasada.dias, atrasada.status], ["2026-11-10", -7, "atrasada"]);
  assert.equal(Pr.situacao({ aplicada_em: null, ultima_manutencao: null, intervalo_dias: 21 }, hoje).status, "sem_data");
  assert.equal(Pr.ehProtese("Prótese capilar (manutenção)"), true);
  assert.equal(Pr.ehProtese("Corte degradê"), false);
});

function rotas(o = {}) {
  const hoje = hojeBr();
  return [
    { metodo: "GET", padrao: /\/rest\/v1\/protese_clientes\?barbearia_id=eq\.[^&]+&ativo=eq\.true&select=id/, resposta: { corpo: [
      { id: FICHA, nome: "Marcos Lima", telefone: "81999990009", profissional_id: UUIDS.bruno, modelo: "Full lace", aplicada_em: somaDias(hoje, -40), intervalo_dias: 21, ultima_manutencao: somaDias(hoje, -25), lembrete_em: null, observacao: "", ativo: true },
      { id: "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2", nome: "Ana Prado", telefone: "", profissional_id: null, modelo: "", aplicada_em: somaDias(hoje, -5), intervalo_dias: 21, ultima_manutencao: null, lembrete_em: null, observacao: "", ativo: true },
    ] } },
    { metodo: "GET", padrao: /\/rest\/v1\/protese_clientes\?id=eq\./, resposta: (url) => ({ corpo: url.includes(FICHA) && url.includes(UUIDS.barbearia) ? [{ id: FICHA, nome: "Marcos Lima", telefone: "81999990009", profissional_id: UUIDS.bruno, aplicada_em: somaDias(hoje, -40), intervalo_dias: 21, ultima_manutencao: somaDias(hoje, -25), ativo: true }] : [] }) },
    { metodo: "GET", padrao: /\/rest\/v1\/protese_clientes\?barbearia_id=eq\.[^&]+&ativo=eq\.true&or=/, resposta: { corpo: o.semFicha ? [] : [{ id: FICHA, nome: "Marcos Lima", profissional_id: UUIDS.bruno, ultima_manutencao: somaDias(hoje, -25), aplicada_em: somaDias(hoje, -40), intervalo_dias: 21 }] } },
    { metodo: "POST", padrao: /\/rest\/v1\/protese_clientes$/, resposta: (u, op, corpo) => ({ status: 201, corpo: [{ id: FICHA, ...corpo, ultima_manutencao: null }] }) },
    { metodo: "PATCH", padrao: /\/rest\/v1\/protese_clientes\?id=eq\./, resposta: { status: 204 } },
    { metodo: "POST", padrao: /\/rest\/v1\/protese_manutencoes/, resposta: { status: 201 } },
    { metodo: "GET", padrao: /\/rest\/v1\/protese_manutencoes\?/, resposta: { corpo: [{ dia: somaDias(hoje, -25), tipo: "manutencao", observacao: "", profissional_id: UUIDS.bruno }] } },
    { metodo: "PATCH", padrao: /\/rest\/v1\/barbearias\?id=eq\./, resposta: { status: 204 } },
    { metodo: "GET", padrao: /\/rest\/v1\/barbearias\?id=eq\.[^&]+&select=protese_ativa/, resposta: { corpo: [{ protese_ativa: true }] } },
    { metodo: "GET", padrao: /\/rest\/v1\/profissionais\?barbearia_id=eq\./, resposta: { corpo: [{ id: UUIDS.bruno, nome: "Bruno" }, { id: UUIDS.rafael, nome: "Rafael" }] } },
    { metodo: "GET", padrao: /\/rest\/v1\/profissionais\?id=eq\./, resposta: (url) => ({ corpo: url.includes(UUIDS.bruno) ? [{ id: UUIDS.bruno }] : [] }) },
    { metodo: "GET", padrao: /\/rest\/v1\/clientes\?/, resposta: { corpo: [{ id: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1", telefone: "81999990009" }] } },
    ...A.rotasDeConta(),
  ];
}
const post = (corpo, token = "token-dono") => A.chamar(equipe, { metodo: "POST", query: { area: "protese" }, token, corpo });

test("aba Prótese: lista com a situação de cada ficha, atrasadas primeiro; barbeiro não acessa", async () => {
  A.instalarFetch(rotas());
  let r = await A.chamar(equipe, { query: { area: "protese" }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.ativa, true);
  assert.deepEqual(r.body.fichas.map((f) => [f.nome, f.status, f.dias]), [["Marcos Lima", "atrasada", -4], ["Ana Prado", "em_dia", 16]]);
  assert.equal(r.body.fichas[0].profissional, "Bruno");
  assert.deepEqual(r.body.resumo, { total: 2, atrasadas: 1, vencem: 0, semana: 0 });
  r = await A.chamar(equipe, { query: { area: "protese" }, token: "token-bruno" });
  assert.equal(r.statusCode, 403, "a ficha de prótese é carteira de clientes: só do dono");
});

test("nova ficha: WhatsApp conferido, liga ao cadastro do cliente, a aplicação entra no histórico e a aba liga", async () => {
  const chamadas = A.instalarFetch(rotas());
  let r = await post({ acao: "criar", nome: "Marcos Lima", telefone: "(81) 99999-0009", profissionalId: UUIDS.bruno, modelo: "Full lace", aplicadaEm: somaDias(hojeBr(), -3), intervaloDias: 21 });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  const nova = chamadas.find((c) => c.metodo === "POST" && /protese_clientes$/.test(c.url)).corpo;
  assert.deepEqual([nova.telefone, nova.cliente_id, nova.intervalo_dias], ["81999990009", "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1", 21]);
  assert.equal(chamadas.find((c) => c.url.includes("protese_manutencoes")).corpo.tipo, "aplicacao");
  assert.ok(chamadas.some((c) => c.metodo === "PATCH" && c.url.includes("protese_ativa=eq.false") && c.corpo.protese_ativa === true));
  for (const ruim of [{ nome: "M" }, { telefone: "123" }, { aplicadaEm: somaDias(hojeBr(), 2) }, { intervaloDias: 3 }, { profissionalId: UUIDS.estranho }]) {
    r = await post({ acao: "criar", nome: "Marcos", ...ruim });
    assert.ok(r.statusCode === 400 || r.statusCode === 404, JSON.stringify(ruim));
  }
});

test("manutenção feita conta o próximo prazo dela; data futura não vale; lembrete anotado", async () => {
  const chamadas = A.instalarFetch(rotas());
  const hoje = hojeBr();
  let r = await post({ acao: "manutencao", id: FICHA, dia: hoje, tipo: "manutencao" });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.equal(r.body.proxima, somaDias(hoje, 21));
  assert.ok(chamadas.some((c) => c.metodo === "PATCH" && c.url.includes("protese_clientes") && c.corpo.ultima_manutencao === hoje));
  assert.equal((await post({ acao: "manutencao", id: FICHA, dia: somaDias(hoje, 1) })).statusCode, 400);
  r = await post({ acao: "lembrar", id: FICHA });
  assert.equal(r.statusCode, 200);
  assert.ok(chamadas.some((c) => c.metodo === "PATCH" && c.corpo && c.corpo.lembrete_em));
  assert.equal((await post({ acao: "historico", id: FICHA })).body.manutencoes.length, 1);
  assert.equal((await post({ acao: "lembrar", id: UUIDS.estranho })).statusCode, 404);
});

test("atendimento de prótese realizado na agenda vira manutenção na ficha; outro serviço não", async () => {
  const chamadas = A.instalarFetch(rotas());
  const pedido = { id: UUIDS.pedido, barbearia_id: UUIDS.barbearia, servico: "Prótese capilar (manutenção)", dia: hojeBr(), cliente_id: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1", profissional_id: UUIDS.bruno };
  assert.equal(await Pr.registrarDoAtendimento(pedido), true);
  const m = chamadas.find((c) => c.url.includes("protese_manutencoes") && c.metodo === "POST").corpo;
  assert.deepEqual([m.pedido_id, m.tipo, m.dia], [UUIDS.pedido, "manutencao", hojeBr()]);
  assert.equal(await Pr.registrarDoAtendimento({ ...pedido, servico: "Corte" }), false);
  A.instalarFetch(rotas({ semFicha: true }));
  assert.equal(await Pr.registrarDoAtendimento(pedido), false, "cliente sem ficha: nada a registrar");
});

test("painel: aba Prótese no menu do dono (ligável em Mais), aviso no Hoje e o módulo da tela", () => {
  const dono = ler("painel-dono.html");
  assert.match(dono, /data-aba="protese" hidden/);
  assert.match(dono, /<script src="\/painel-protese\.js"><\/script>/);
  assert.match(dono, /id="proteseAtiva"/);
  assert.match(dono, /Prótese: manutenção de /);
  const mod = ler("painel-protese.js");
  assert.match(mod, /window\.Protese = /);
  assert.match(mod, /Manutenção feita/);
  assert.match(mod, /P\.oferecerHorarios\(op\.ctx/, "manda os horários livres para o cliente de prótese");
  assert.ok(!/data-aba="protese"/.test(ler("painel-barbeiro.html")), "barbeiro não tem a aba");
});
