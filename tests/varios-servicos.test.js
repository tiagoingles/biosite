// Vários serviços de uma vez pelo site (fase 38, pedido do Manolo): no mesmo horário com barbeiros diferentes,
// ou um depois do outro (mesmo barbeiro ou outro, em horários próximos). O dono confirma a marcação inteira.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const A = require("./ajuda");
const { planosDoDia } = require("../lib/disponibilidade");
const horarios = require("../api/horarios");
const pedido = require("../api/pedido");

const { UUIDS } = A;
const DIA = A.daquiA(1);
const diaDe = (ocupados) => ({ publicada: true, agenda: { inicio: "09:00", fim: "12:00" }, bloqueios: [{ inicio: "11:30", fim: "12:00" }], ocupados, pedidos: ocupados.length });
const resumo = (planos) => planos.map((p) => p.horario + " " + p.itens.map((x) => x.nome + "@" + x.horario).join("+"));

test("planos: no mesmo horário, cada serviço com um barbeiro livre diferente", () => {
  const bruno = { id: "b", nome: "Bruno", dados: diaDe([{ inicio: "10:00", duracaoMin: 60 }]) };
  const rafael = { id: "r", nome: "Rafael", dados: diaDe([]) };
  const planos = planosDoDia({ barbeiros: [rafael, bruno], duracoes: [40, 30], modo: "junto" });
  // 09:45 em diante o Bruno está ocupado; às 11:00 o serviço de 40 min passaria do bloqueio das 11:30
  assert.deepEqual(resumo(planos), ["09:00 Rafael@09:00+Bruno@09:00", "09:15 Rafael@09:15+Bruno@09:15", "09:30 Rafael@09:30+Bruno@09:30"]);
  // Durações trocadas: às 11:00 o de 30 min fica com quem cabe e o de 40 não cabe em ninguém
  assert.ok(!resumo(planosDoDia({ barbeiros: [rafael, bruno], duracoes: [30, 40], modo: "junto" })).some((p) => p.startsWith("11:00")));
  assert.equal(planos[0].fim, "09:40");
  assert.deepEqual(planosDoDia({ barbeiros: [rafael], duracoes: [40, 30], modo: "junto" }), [], "um barbeiro só não faz dois ao mesmo tempo");
});

test("planos: um depois do outro, com o mesmo barbeiro ou com outro, esperando até 30 min", () => {
  const bruno = { id: "b", nome: "Bruno", dados: diaDe([{ inicio: "09:40", duracaoMin: 20 }, { inicio: "10:30", duracaoMin: 90 }]) };
  const rafael = { id: "r", nome: "Rafael", dados: diaDe([{ inicio: "09:00", duracaoMin: 150 }]) };
  // Só o Bruno: corte 09:00-09:40, ele está ocupado até 10:00 -> barba às 10:00 (20 min depois)
  let planos = planosDoDia({ barbeiros: [bruno], duracoes: [40, 30], modo: "seguido" });
  assert.deepEqual(resumo(planos), ["09:00 Bruno@09:00+Bruno@10:00"]);
  // Com o Rafael também: depois das 11:30 só há o bloqueio; ninguém consegue antes, então o mesmo resultado
  planos = planosDoDia({ barbeiros: [bruno, rafael], duracoes: [40, 30], modo: "seguido" });
  assert.deepEqual(resumo(planos), ["09:00 Bruno@09:00+Bruno@10:00"]);
  // Barbeiros livres: o mesmo barbeiro faz os dois, colado
  const livre = { id: "l", nome: "Luan", dados: diaDe([]) };
  assert.deepEqual(resumo(planosDoDia({ barbeiros: [livre], duracoes: [40, 30], modo: "seguido" })).slice(0, 2), ["09:00 Luan@09:00+Luan@09:40", "09:15 Luan@09:15+Luan@09:55"]);
  // Sem ninguém livre para o segundo em até 30 min, o horário não aparece
  const cheio = { id: "c", nome: "Caio", dados: diaDe([{ inicio: "09:40", duracaoMin: 80 }]) };
  assert.ok(!resumo(planosDoDia({ barbeiros: [cheio], duracoes: [40, 30], modo: "seguido" })).some((p) => p.startsWith("09:00")));
});

function rotasDoDia({ ocupadosBruno = [], ocupadosRafael = [], rpc } = {}) {
  return [
    ...A.rotasDeConta(),
    { padrao: /\/rest\/v1\/barbearias\?slug=eq\.gw-teste/, resposta: { corpo: [{ id: UUIDS.barbearia }] } },
    { padrao: /\/rest\/v1\/profissionais\?barbearia_id=eq\./, resposta: { corpo: [{ id: UUIDS.bruno, nome: "Bruno" }, { id: UUIDS.rafael, nome: "Rafael" }] } },
    { padrao: /\/rest\/v1\/agenda_dia\?profissional_id=eq\./, resposta: { corpo: [{ inicio: "09:00:00", fim: "18:00:00", almoco_inicio: "12:00:00", almoco_fim: "13:00:00", confirmada_em: "2026-11-01T10:00:00Z" }] } },
    { padrao: /\/rest\/v1\/bloqueios\?/, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/pedidos\?profissional_id=eq\./, resposta: (url) => ({ corpo: url.includes(UUIDS.rafael) ? ocupadosRafael : ocupadosBruno }) },
    { padrao: /\/rest\/v1\/servicos_precos\?barbearia_id=eq\./, resposta: (url) => ({ corpo: [{ preco: url.includes("Barba") ? "30.00" : "40.00" }] }) },
    { padrao: /\/rest\/v1\/rpc\/criar_pedido/, resposta: (u, o, corpo) => (rpc ? rpc(corpo) : { corpo: { id: "id-" + corpo.p.profissional + "-" + corpo.p.horario.replace(":", "") } }) },
    { metodo: "PATCH", padrao: /\/rest\/v1\/pedidos\?id=in\./, resposta: { status: 204 } },
  ];
}

test("site: a consulta de horários devolve os planos para vários serviços", async () => {
  A.instalarFetch(rotasDoDia({ ocupadosBruno: [{ horario: "09:00:00", duracao_min: 60 }] }));
  let r = await A.chamar(horarios, { query: { slug: "gw-teste", profissional: "qualquer", dia: DIA, duracoes: "40,30", modo: "junto" } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.planos[0].horario, "10:00", "antes das 10h o Bruno está ocupado");
  assert.deepEqual(new Set(r.body.planos[0].itens.map((x) => x.nome)), new Set(["Bruno", "Rafael"]));
  r = await A.chamar(horarios, { query: { slug: "gw-teste", profissional: UUIDS.bruno, dia: DIA, duracoes: "40,30", modo: "seguido" } });
  assert.deepEqual(r.body.planos[0].itens.map((x) => [x.nome, x.horario]), [["Bruno", "10:00"], ["Bruno", "10:40"]], "com o barbeiro escolhido, só ele");
  for (const duracoes of ["40", "40,30,30,30,30", "40,abc", "200,100"]) {
    r = await A.chamar(horarios, { query: { slug: "gw-teste", profissional: "qualquer", dia: DIA, duracoes, modo: "seguido" } });
    assert.equal(r.statusCode, 400, duracoes);
  }
});

const pedidoDoSite = (itens, extra = {}) => ({ slug: "gw-teste", servico: itens.map((x) => x.servico).join(" + "), profissionalId: itens[0].profissionalId, profissional: "Bruno", dia: DIA, horario: itens[0].horario, cliente: "Claudio Melo", whatsapp: "", duracao: 70, itens, ...extra });

test("site: no mesmo horário com barbeiros diferentes vira um atendimento por serviço, ligados pelo grupo", async () => {
  const chamadas = A.instalarFetch(rotasDoDia());
  const itens = [
    { servico: "Corte", preco: "40,00", duracao: 40, profissionalId: UUIDS.bruno, horario: "10:00" },
    { servico: "Barba", preco: "30,00", duracao: 30, profissionalId: UUIDS.rafael, horario: "10:00" },
  ];
  const r = await A.chamar(pedido, { metodo: "POST", corpo: pedidoDoSite(itens) });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  const criados = chamadas.filter((c) => c.url.includes("rpc/criar_pedido")).map((c) => [c.corpo.p.servico, c.corpo.p.profissional, c.corpo.p.horario, c.corpo.p.duracao_min, c.corpo.p.valor, c.corpo.p.status]);
  assert.deepEqual(criados, [["Corte", "Bruno", "10:00", 40, 40, "pendente"], ["Barba", "Rafael", "10:00", 30, 30, "pendente"]]);
  const grupo = chamadas.find((c) => c.metodo === "PATCH" && c.url.includes("id=in."));
  assert.ok(grupo && grupo.corpo.grupo_id, "os dois no mesmo grupo");
  assert.deepEqual([r.body.profissional, r.body.codigos.length], ["Bruno e Rafael", 2]);
});

test("site: um depois do outro com o mesmo barbeiro continua um atendimento só; horário ocupado é recusado antes de gravar", async () => {
  let chamadas = A.instalarFetch(rotasDoDia());
  const itens = [
    { servico: "Corte", preco: "40,00", duracao: 40, profissionalId: UUIDS.bruno, horario: "10:00" },
    { servico: "Barba", preco: "30,00", duracao: 30, profissionalId: UUIDS.bruno, horario: "10:40" },
  ];
  let r = await A.chamar(pedido, { metodo: "POST", corpo: pedidoDoSite(itens) });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  const rpc = chamadas.filter((c) => c.url.includes("rpc/criar_pedido"));
  assert.deepEqual(rpc.map((c) => [c.corpo.p.servico, c.corpo.p.horario, c.corpo.p.duracao_min, c.corpo.p.valor]), [["Corte + Barba", "10:00", 70, 70]]);
  assert.ok(!chamadas.some((c) => c.metodo === "PATCH"), "um só, sem grupo");
  // Com espera entre os dois (horário próximo), viram dois atendimentos do mesmo barbeiro
  chamadas = A.instalarFetch(rotasDoDia());
  r = await A.chamar(pedido, { metodo: "POST", corpo: pedidoDoSite([itens[0], { ...itens[1], horario: "11:00" }]) });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.equal(chamadas.filter((c) => c.url.includes("rpc/criar_pedido")).length, 2);
  // O Rafael já tem cliente às 10h: nada é gravado
  chamadas = A.instalarFetch(rotasDoDia({ ocupadosRafael: [{ horario: "10:00:00", duracao_min: 40 }] }));
  r = await A.chamar(pedido, { metodo: "POST", corpo: pedidoDoSite([itens[0], { ...itens[1], profissionalId: UUIDS.rafael, horario: "10:00" }]) });
  assert.equal(r.statusCode, 409);
  assert.ok(!chamadas.some((c) => c.url.includes("rpc/criar_pedido")));
  // Dois serviços do mesmo barbeiro se sobrepondo: recusado
  r = await A.chamar(pedido, { metodo: "POST", corpo: pedidoDoSite([itens[0], { ...itens[1], horario: "10:20" }]) });
  assert.equal(r.statusCode, 409);
  // Pelo clube, um serviço por vez
  r = await A.chamar(pedido, { metodo: "POST", corpo: pedidoDoSite(itens, { clube: true, clubeWhatsapp: "81999998888" }) });
  assert.deepEqual([r.statusCode, r.body.clube], [400, true]);
});

test("site: se um dos serviços não entrar, os outros da marcação são cancelados", async () => {
  let n = 0;
  const chamadas = A.instalarFetch(rotasDoDia({ rpc: (c) => ({ corpo: ++n === 1 ? { id: "primeiro" } : { erro: "conflito", horario: c.p.horario } }) }));
  const itens = [
    { servico: "Corte", preco: "40,00", duracao: 40, profissionalId: UUIDS.bruno, horario: "10:00" },
    { servico: "Barba", preco: "30,00", duracao: 30, profissionalId: UUIDS.rafael, horario: "10:00" },
  ];
  const r = await A.chamar(pedido, { metodo: "POST", corpo: pedidoDoSite(itens) });
  assert.equal(r.statusCode, 409);
  const cancela = chamadas.find((c) => c.metodo === "PATCH");
  assert.ok(cancela.url.includes("id=in.(primeiro)") && cancela.corpo.status === "cancelado", "o primeiro foi cancelado");
});

test("painel: confirmar um serviço da marcação confirma os outros pendentes do mesmo grupo", async () => {
  const GRUPO = "9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a";
  const chamadas = A.instalarFetch([
    ...A.rotasDeConta(),
    { metodo: "GET", padrao: /\/rest\/v1\/pedidos\?id=eq\./, resposta: { corpo: [{ id: UUIDS.pedido, status: "pendente", profissional_id: UUIDS.bruno, dia: DIA, servico: "Corte", valor: 40 }] } },
    { metodo: "PATCH", padrao: /\/rest\/v1\/pedidos\?id=eq\./, resposta: (u, o, corpo) => ({ corpo: [{ id: UUIDS.pedido, status: corpo.status, grupo_id: GRUPO }] }) },
    { metodo: "PATCH", padrao: /\/rest\/v1\/pedidos\?grupo_id=eq\./, resposta: (u, o, corpo) => ({ corpo: [{ id: "outro", status: corpo.status }] }) },
  ]);
  let r = await A.chamar(pedido, { metodo: "PATCH", corpo: { id: UUIDS.pedido, status: "confirmado" }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.grupo, 1);
  const grupo = chamadas.find((c) => c.url.includes("grupo_id=eq."));
  assert.ok(grupo.url.includes(`grupo_id=eq.${GRUPO}`) && grupo.url.includes("status=eq.pendente") && grupo.url.includes(`id=neq.${UUIDS.pedido}`), grupo.url);
  // O barbeiro decide só o dele
  const antes = chamadas.length;
  r = await A.chamar(pedido, { metodo: "PATCH", corpo: { id: UUIDS.pedido, status: "confirmado" }, token: "token-bruno" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.ok(!chamadas.slice(antes).some((c) => c.url.includes("grupo_id=eq.")));
});

test("site: escolha entre um depois do outro e no mesmo horário, horários dos planos e busca de serviço", () => {
  const fonte = fs.readFileSync(path.join(__dirname, "..", "lib", "gerador-agenda.js"), "utf8");
  for (const t of ["Um depois do outro", "No mesmo horário, com outro barbeiro", 'data-ag="plano"', "&duracoes=", "corpo.itens=escolhidos()", "linhasDoPlano(sel.plano)"]) assert.ok(fonte.includes(t), t);
  assert.ok(fonte.includes('id="agBusca"') && fonte.includes("filtrarServicos()") && fonte.includes("n>6"), "busca de serviço quando a lista é grande");
  assert.ok(fs.readFileSync(path.join(__dirname, "..", "lib", "gerador-estilos.js"), "utf8").includes(".ag-op[hidden]{display:none!important}"), "o serviço filtrado some de verdade");
  const site = fs.readFileSync(path.join(__dirname, "..", "dom-manolo-barbearia.html"), "utf8");
  assert.ok(site.includes("No mesmo horário, com outro barbeiro") && site.includes("Buscar serviço"), "o site da Dom Manolo já tem a versão nova");
});
