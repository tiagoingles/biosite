// Lista de espera (fase 39, pedido do Manolo): quem não acha horário no site entra na lista com o dia e de que horas
// até que horas pode; o dono também coloca quem pede pelo telefone. Quando um horário vaga (cancelamento), o dono vê
// quem da lista cabe nele, na ordem de chegada, com o WhatsApp pronto para chamar.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const A = require("./ajuda");
const equipe = require("../api/equipe");
const pedido = require("../api/pedido");
const { lerEntrada, cabeNaVaga } = require("../lib/espera");
const { agoraMinBr } = require("../lib/horarios");

const { UUIDS } = A;
const ler = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const AMANHA = A.daquiA(1);
const E1 = "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1";
const E2 = "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2";
const E3 = "e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3";
const E4 = "e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4";
const E5 = "e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5";
const entrada = (extra = {}) => ({ dia: AMANHA, de: "10:00", ate: "12:00", nome: "Pedro Henrique", servico: "Corte", whatsapp: "(81) 99999-0021", duracao: 40, ...extra });
const naLista = (id, extra) => ({ id, barbearia_id: UUIDS.barbearia, dia: AMANHA, nome: "Cliente", telefone: "81900000000", servico: "Corte", duracao_min: 30, de: "10:00", ate: "12:00", profissional_id: null, status: "esperando", criado_em: "2026-01-01T10:00:00Z", ...extra });

// Banco falso: filtra como o PostgREST (eq, gte, lte, in) e devolve na ordem do dia e da chegada
function filtrar(url, linhas) {
  const q = new URL(url).searchParams;
  return linhas
    .filter((l) => {
      for (const [k, v] of q) {
        if (["select", "order", "limit"].includes(k)) continue;
        const i = v.indexOf(".");
        const op = v.slice(0, i);
        const val = v.slice(i + 1);
        const atual = String(l[k]);
        if (op === "eq" && atual !== val) return false;
        if (op === "gte" && atual < val) return false;
        if (op === "lte" && atual > val) return false;
        if (op === "in" && !val.slice(1, -1).split(",").includes(atual)) return false;
      }
      return true;
    })
    .sort((a, z) => String(a.dia || "").localeCompare(String(z.dia || "")) || String(a.criado_em || "").localeCompare(String(z.criado_em || "")));
}

function banco({ lista = [], pedidos = [], demonstracao = null, recentes = 0 } = {}) {
  let seq = 0;
  const rotas = [
    ...A.rotasDeConta(),
    { metodo: "GET", padrao: /rest[/]v1[/]barbearias[?]slug=eq[.]gw-teste&/, resposta: () => ({ corpo: [{ id: UUIDS.barbearia, demonstracao }] }) },
    { metodo: "GET", padrao: /rest[/]v1[/]barbearias[?]/, resposta: { corpo: [] } },
    { metodo: "GET", padrao: /rest[/]v1[/]lista_espera[?]origem=eq[.]/, resposta: () => ({ corpo: Array.from({ length: recentes }, (_, i) => ({ id: "r" + i })) }) },
    { metodo: "GET", padrao: /rest[/]v1[/]lista_espera[?]/, resposta: (u) => ({ corpo: filtrar(u, lista) }) },
    {
      metodo: "PATCH",
      padrao: /rest[/]v1[/]lista_espera[?]/,
      resposta: (u, o, corpo) => {
        const alvo = filtrar(u, lista);
        alvo.forEach((l) => Object.assign(l, corpo));
        return { corpo: alvo };
      },
    },
    {
      metodo: "POST",
      padrao: /rest[/]v1[/]lista_espera$/,
      resposta: (u, o, corpo) => {
        seq += 1;
        const l = { id: "nova-" + seq, status: "esperando", contatado_em: null, criado_em: new Date(Date.now() + seq).toISOString(), ...corpo };
        lista.push(l);
        return { status: 201, corpo: [l] };
      },
    },
    { metodo: "GET", padrao: /rest[/]v1[/]profissionais[?]id=eq[.]/, resposta: (u) => ({ corpo: u.includes(UUIDS.bruno) && u.includes(UUIDS.barbearia) ? [{ id: UUIDS.bruno }] : [] }) },
    {
      metodo: "GET",
      padrao: /rest[/]v1[/]profissionais[?]barbearia_id=eq[.]/,
      resposta: { corpo: [{ id: UUIDS.bruno, nome: "Bruno", ativo: true }, { id: UUIDS.rafael, nome: "Rafael", ativo: true }, { id: UUIDS.estranho, nome: "Saiu", ativo: false }] },
    },
    { metodo: "GET", padrao: /rest[/]v1[/]clientes[?]/, resposta: (u) => ({ corpo: u.includes("telefone=eq.81999990021") ? [{ id: "cliente-pedro" }] : [] }) },
    { metodo: "GET", padrao: /rest[/]v1[/]pedidos[?]/, resposta: (u) => ({ corpo: filtrar(u, pedidos) }) },
    {
      metodo: "PATCH",
      padrao: /rest[/]v1[/]pedidos[?]id=eq[.]/,
      resposta: (u, o, corpo) => {
        const alvo = filtrar(u, pedidos);
        alvo.forEach((p) => Object.assign(p, corpo));
        return { corpo: alvo };
      },
    },
  ];
  return { rotas, lista, pedidos };
}

test("lista de espera: confere o dia, de que horas até que horas, o nome, o serviço e o WhatsApp", () => {
  const ok = lerEntrada(entrada({ whatsapp: "+55 (81) 99999-0021", profissionalId: UUIDS.bruno, observacao: "  prefiro o Bruno  " }));
  assert.equal(ok.erro, undefined);
  assert.deepEqual(ok.dados, { dia: AMANHA, de: "10:00", ate: "12:00", nome: "Pedro Henrique", servico: "Corte", telefone: "81999990021", duracao_min: 40, profissional_id: UUIDS.bruno, observacao: "prefiro o Bruno" });
  assert.equal(lerEntrada(entrada({ whatsapp: "" })).dados.telefone, "", "pelo painel o WhatsApp é opcional");
  assert.equal(lerEntrada(entrada({ duracao: "abc" })).dados.duracao_min, 30);
  assert.equal(lerEntrada(entrada({ duracao: 500 })).dados.duracao_min, 30);
  const erros = [
    [{ dia: "" }, "Escolha o dia."],
    [{ dia: A.daquiA(-1) }, "Escolha um dia de hoje até 60 dias à frente."],
    [{ dia: A.daquiA(61) }, "Escolha um dia de hoje até 60 dias à frente."],
    [{ de: "12:00", ate: "10:00" }, "Diga de que horas até que horas pode."],
    [{ de: "10:00", ate: "10:00" }, "Diga de que horas até que horas pode."],
    [{ de: "25:00" }, "Diga de que horas até que horas pode."],
    [{ nome: " P " }, "Informe o nome."],
    [{ servico: "" }, "Escolha o serviço."],
    [{ whatsapp: "12345" }, "Confira o WhatsApp: DDD e número."],
    [{ profissionalId: "bruno" }, "Profissional inválido."],
  ];
  for (const [mudar, msg] of erros) assert.equal(lerEntrada(entrada(mudar)).erro, msg, JSON.stringify(mudar));
});

test("lista de espera: quem cabe no horário que vagou (mesmo dia, horário que cruza, o barbeiro que pediu)", () => {
  const vaga = { dia: AMANHA, horario: "10:40:00", duracao_min: 40, profissional_id: UUIDS.bruno };
  const e = naLista(E1);
  assert.equal(cabeNaVaga(e, vaga), true, "qualquer barbeiro, das 10 às 12");
  assert.equal(cabeNaVaga({ ...e, status: "contatado" }, vaga), true, "já chamado continua na fila");
  assert.equal(cabeNaVaga({ ...e, status: "marcado" }, vaga), false);
  assert.equal(cabeNaVaga({ ...e, status: "saiu" }, vaga), false);
  assert.equal(cabeNaVaga({ ...e, dia: A.daquiA(2) }, vaga), false, "outro dia");
  assert.equal(cabeNaVaga({ ...e, profissional_id: UUIDS.rafael }, vaga), false, "pediu outro barbeiro");
  assert.equal(cabeNaVaga({ ...e, profissional_id: UUIDS.bruno }, vaga), true, "pediu o barbeiro da vaga");
  assert.equal(cabeNaVaga({ ...e, de: "08:00", ate: "10:40" }, vaga), false, "o que ele pode acaba quando a vaga começa");
  assert.equal(cabeNaVaga({ ...e, de: "11:20", ate: "13:00" }, vaga), false, "começa quando a vaga acaba");
  assert.equal(cabeNaVaga({ ...e, de: "11:00", ate: "13:00" }, vaga), true, "pode a partir das 11, ainda dentro da vaga");
});

const doSite = (extra = {}) => A.chamar(pedido, { metodo: "POST", query: { espera: "1" }, corpo: { slug: "gw-teste", ...entrada(), ...extra } });

test("site: entra na lista com a posição do dia; de novo com o mesmo WhatsApp só atualiza, sem perder a vez", async () => {
  const b = banco({ lista: [naLista(E1, { nome: "Marcos", telefone: "81988887777", de: "09:00", ate: "11:00" })] });
  const chamadas = A.instalarFetch(b.rotas);
  let r = await doSite();
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true, posicao: 2, atualizado: false });
  const nova = b.lista[1];
  assert.equal(nova.pelo_site, true);
  assert.equal(nova.barbearia_id, UUIDS.barbearia);
  assert.equal(nova.cliente_id, "cliente-pedro", "ligada ao cadastro pelo WhatsApp");
  assert.equal(nova.telefone, "81999990021");
  assert.equal(nova.duracao_min, 40);
  assert.match(nova.origem, /^[0-9a-f]{32}$/, "a origem é guardada sem o IP");
  // De novo, com outro horário: atualiza a mesma linha e continua 2º
  r = await doSite({ de: "14:00", ate: "16:00" });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true, posicao: 2, atualizado: true });
  assert.equal(b.lista.length, 2);
  assert.equal(b.lista[1].de, "14:00");
  assert.equal(b.lista[1].criado_em, nova.criado_em, "a ordem de chegada não muda");
  assert.ok(chamadas.some((c) => c.metodo === "PATCH" && c.url.includes("lista_espera?id=eq.nova-1")));
  // Barbeiro de outra barbearia vira "qualquer barbeiro"
  r = await doSite({ whatsapp: "81977776666", profissionalId: UUIDS.estranho });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.equal(r.body.posicao, 3);
  assert.equal(b.lista[2].profissional_id, null);
});

test("site: sem WhatsApp, robô, demonstração e excesso de pedidos não entram na lista", async () => {
  let b = banco();
  A.instalarFetch(b.rotas);
  let r = await doSite({ whatsapp: "" });
  assert.equal(r.statusCode, 400);
  assert.match(r.body.message, /WhatsApp/);
  r = await doSite({ website: "http://spam.exemplo" });
  assert.equal(r.statusCode, 201, "o robô acha que entrou");
  assert.equal(b.lista.length, 0);
  r = await doSite({ slug: "x" });
  assert.equal(r.statusCode, 400);
  r = await doSite({ slug: "nao-existe" });
  assert.equal(r.statusCode, 404);
  r = await A.chamar(pedido, { metodo: "GET", query: { espera: "1" } });
  assert.equal(r.statusCode, 405);
  b = banco({ demonstracao: "vitrine" });
  A.instalarFetch(b.rotas);
  r = await doSite();
  assert.equal(r.statusCode, 403);
  assert.equal(r.body.demonstracao, true);
  assert.equal(b.lista.length, 0);
  b = banco({ recentes: 6 });
  A.instalarFetch(b.rotas);
  r = await doSite();
  assert.equal(r.statusCode, 429);
  assert.equal(b.lista.length, 0);
});

test("painel: a aba Espera mostra a lista e os horários que vagaram com quem cabe neles, na ordem", async () => {
  const hoje = A.hoje();
  const pd = (id, extra) => ({ id, barbearia_id: UUIDS.barbearia, simulado: false, profissional: "Bruno", profissional_id: UUIDS.bruno, servico: "Corte", duracao_min: 40, dia: AMANHA, status: "cancelado", ...extra });
  const b = banco({
    lista: [
      naLista(E2, { nome: "Marcos", de: "09:00", ate: "11:30", profissional_id: UUIDS.bruno, status: "contatado", criado_em: "2026-01-01T11:00:00Z" }),
      naLista(E1, { nome: "Pedro", de: "10:00", ate: "16:00", criado_em: "2026-01-01T10:00:00Z" }),
      naLista(E3, { nome: "Saiu", status: "saiu", criado_em: "2026-01-01T09:00:00Z" }),
      naLista(E4, { nome: "Rafa", dia: A.daquiA(2), de: "15:00", ate: "18:00", profissional_id: UUIDS.rafael, criado_em: "2026-01-01T08:00:00Z" }),
      naLista(E5, { nome: "Hoje", dia: hoje, de: "00:00", ate: "23:30", criado_em: "2026-01-01T07:00:00Z" }),
    ],
    pedidos: [
      pd("vaga", { horario: "10:40:00" }),
      pd("vaga-repetida", { horario: "10:40:00" }),
      pd("ocupada", { horario: "15:00:00" }),
      pd("quem-ocupou", { horario: "15:20:00", status: "confirmado" }),
      pd("sem-fila", { horario: "17:00:00" }),
      pd("passou", { dia: hoje, horario: "00:00:00" }),
      pd("simulado", { horario: "11:30:00", simulado: true }),
      pd("outro-dia", { dia: A.daquiA(2), horario: "16:00:00", duracao_min: 30, profissional: "Rafael", profissional_id: UUIDS.rafael }),
    ],
  });
  A.instalarFetch(b.rotas);
  let r = await A.chamar(equipe, { query: { area: "espera" }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.hoje, hoje);
  assert.deepEqual(r.body.lista.map((e) => e.id), [E5, E1, E2, E4], "por dia e na ordem de chegada; quem saiu não aparece");
  assert.deepEqual(r.body.lista.map((e) => e.profissional), ["", "", "Bruno", "Rafael"]);
  // Repetido, ocupado de novo, sem ninguém que caiba, simulado e o que já passou ficam de fora
  const vagas = r.body.vagas.map((v) => [v.id, v.fila]);
  if (agoraMinBr() > 0) assert.deepEqual(vagas, [["vaga", [E1, E2]], ["outro-dia", [E4]]]);
  assert.deepEqual(r.body.vagas.find((v) => v.id === "vaga"), { id: "vaga", dia: AMANHA, horario: "10:40", duracao_min: 40, profissional_id: UUIDS.bruno, profissional: "Bruno", servico: "Corte", fila: [E1, E2] });
  assert.deepEqual(r.body.profissionais, [{ id: UUIDS.bruno, nome: "Bruno" }, { id: UUIDS.rafael, nome: "Rafael" }], "só quem está ativo");
  r = await A.chamar(equipe, { query: { area: "espera" }, token: "token-bruno" });
  assert.equal(r.statusCode, 403, "a lista é do dono");
  r = await A.chamar(equipe, { query: { area: "espera" } });
  assert.equal(r.statusCode, 401);
});

test("painel: o dono coloca quem pediu pelo telefone e marca chamado, marcado ou saiu", async () => {
  const b = banco({ lista: [naLista(E1, { nome: "Pedro", telefone: "81999990021" })] });
  const chamadas = A.instalarFetch(b.rotas);
  const post = (corpo, token = "token-dono") => A.chamar(equipe, { metodo: "POST", query: { area: "espera" }, token, corpo });
  let r = await post({ acao: "nova", nome: "Pedro Henrique", telefone: "(81) 99999-0021", servico: "Corte", duracao: 40, dia: AMANHA, de: "14:00", ate: "16:00", profissionalId: UUIDS.bruno });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.equal(r.body.entrada.pelo_site, false);
  assert.equal(r.body.entrada.cliente_id, "cliente-pedro");
  assert.equal(r.body.entrada.barbearia_id, UUIDS.barbearia);
  assert.equal(r.body.entrada.profissional_id, UUIDS.bruno);
  r = await post({ acao: "nova", nome: "Sem Zap", servico: "Corte", dia: AMANHA, de: "14:00", ate: "16:00" });
  assert.equal(r.statusCode, 201, "pelo telefone, o WhatsApp é opcional");
  assert.equal(r.body.entrada.cliente_id, null);
  r = await post({ acao: "nova", nome: "Pedro", servico: "Corte", dia: AMANHA, de: "14:00", ate: "16:00", profissionalId: UUIDS.estranho });
  assert.equal(r.statusCode, 400, "barbeiro que não é da barbearia");
  r = await post({ acao: "nova", nome: "Pedro", servico: "Corte", dia: AMANHA, de: "16:00", ate: "14:00" });
  assert.equal(r.statusCode, 400);
  // Chamado: guarda a hora; só mexe na lista da própria barbearia
  r = await post({ acao: "status", id: E1, status: "contatado" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(b.lista[0].status, "contatado");
  assert.ok(b.lista[0].contatado_em);
  const patch = chamadas.filter((c) => c.metodo === "PATCH").pop();
  assert.ok(patch.url.includes(`id=eq.${E1}&barbearia_id=eq.${UUIDS.barbearia}`), patch.url);
  r = await post({ acao: "status", id: E1, status: "marcado" });
  assert.equal(r.statusCode, 200);
  assert.equal(b.lista[0].status, "marcado");
  const recusas = [
    [{ acao: "status", id: "x", status: "saiu" }, 400],
    [{ acao: "status", id: E1, status: "sumiu" }, 400],
    [{ acao: "status", id: E2, status: "saiu" }, 404],
    [{ acao: "apagar", id: E1 }, 400],
  ];
  for (const [corpo, st] of recusas) {
    r = await post(corpo);
    assert.equal(r.statusCode, st, JSON.stringify(corpo));
  }
  r = await post({ acao: "status", id: E1, status: "saiu" }, "token-bruno");
  assert.equal(r.statusCode, 403, "a lista é do dono");
  assert.equal(b.lista[0].status, "marcado");
});

test("cancelar: o dono recebe quem da lista cabe no horário, na ordem de chegada; o barbeiro não", async () => {
  const atual = () => ({ id: UUIDS.pedido, barbearia_id: UUIDS.barbearia, codigo: "ABCD", servico: "Corte", profissional: "Bruno", profissional_id: UUIDS.bruno, dia: AMANHA, horario: "10:40:00", duracao_min: 40, cliente: "Ana", status: "confirmado", valor: 40, simulado: false });
  const lista = [
    naLista(E2, { nome: "Marcos", telefone: "81988887777", de: "09:00", ate: "11:30", profissional_id: UUIDS.bruno, criado_em: "2026-01-01T11:00:00Z" }),
    naLista(E1, { nome: "Pedro", telefone: "81999990021", criado_em: "2026-01-01T10:00:00Z" }),
    naLista(E3, { nome: "Rafa", profissional_id: UUIDS.rafael, criado_em: "2026-01-01T09:00:00Z" }),
  ];
  let b = banco({ lista, pedidos: [atual()] });
  A.instalarFetch(b.rotas);
  let r = await A.chamar(pedido, { metodo: "POST", corpo: { acao: "cancelar", id: UUIDS.pedido }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.pedido.status, "cancelado");
  assert.deepEqual(r.body.espera.map((e) => e.id), [E1, E2], "na ordem de chegada; quem pediu o Rafael fica de fora");
  assert.equal(r.body.espera[0].telefone, "81999990021", "o WhatsApp vai junto para chamar");
  // O barbeiro cancela o dele e não recebe a lista
  b = banco({ lista, pedidos: [atual()] });
  const chamadas = A.instalarFetch(b.rotas);
  r = await A.chamar(pedido, { metodo: "POST", corpo: { acao: "cancelar", id: UUIDS.pedido }, token: "token-bruno" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.espera, []);
  assert.ok(!chamadas.some((c) => c.url.includes("lista_espera")), "nem consulta a lista");
  // Horário de hoje que já passou: não adianta chamar ninguém
  if (agoraMinBr() > 0) {
    b = banco({ lista: [naLista(E1, { dia: A.hoje(), de: "00:00", ate: "23:30" })], pedidos: [{ ...atual(), dia: A.hoje(), horario: "00:00:00" }] });
    A.instalarFetch(b.rotas);
    r = await A.chamar(pedido, { metodo: "POST", corpo: { acao: "cancelar", id: UUIDS.pedido }, token: "token-dono" });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.espera, []);
  }
});

test("painel: a mensagem oferece o horário que o cliente pode (vagou 09:30 e ele pode das 10:00: 10:00)", () => {
  const janela = { Painel: { h: () => ({}), primeiroNome: (n) => String(n).split(" ")[0], dataLonga: () => "Quinta-feira, 26 de novembro" } };
  vm.runInNewContext(ler("painel-espera.js"), { window: janela });
  const { textoVaga, textoLista, horaPara } = janela.Espera._;
  const vaga = { dia: AMANHA, horario: "09:30", profissional: "Bruno" };
  assert.equal(horaPara({ de: "10:00" }, vaga), "10:00");
  assert.equal(horaPara({ de: "08:00" }, vaga), "09:30");
  const t = textoVaga({ nome: "Pedro Henrique", de: "10:00" }, vaga);
  assert.match(t, /^Olá, Pedro! /);
  assert.ok(t.includes("quinta-feira, 26 de novembro às 10:00 com Bruno"), t);
  assert.ok(t.includes("lista de espera"), t);
  assert.ok(textoLista({ nome: "Pedro", dia: AMANHA, de: "10:00", ate: "12:00" }).includes("das 10:00 às 12:00"));
});

test("site e painel: o botão da lista de espera, a aba Espera e o aviso depois de cancelar estão ligados", () => {
  const runtime = ler("lib/gerador-agenda.js");
  assert.ok(runtime.includes('data-ag="espera"') && runtime.includes("Entre na lista de espera"), "botão no passo do dia");
  assert.ok(runtime.includes('fetch("/api/pedido?espera=1"'), "grava pela rota pública");
  assert.ok(/if\(demo\)\{[^}]*etapa="espera-ok"/.test(runtime), "na demonstração não grava nada");
  for (const site of ["dom-manolo-barbearia.html", "gw-barbearia.html"]) assert.ok(ler(site).includes('data-ag="espera"'), site);
  const dono = ler("painel-dono.html");
  assert.ok(dono.includes('<a href="#espera" data-aba="espera"'));
  assert.ok(dono.includes('<script src="/painel-espera.js"></script>'));
  assert.ok(dono.includes("window.Espera.configurar("));
  assert.ok(ler("painel-agenda.js").includes("window.Espera.oferecerVaga(p, res.espera, ctx)"), "depois de cancelar, oferece a vaga");
  const aba = ler("painel-espera.js");
  assert.ok(aba.includes('"/api/equipe?area=espera"'));
  for (const st of ["contatado", "marcado", "saiu"]) assert.ok(aba.includes('status: "' + st + '"'), st);
  assert.ok(ler("api/pedido.js").includes("espera.entrar(req, res)"));
  assert.ok(ler("api/equipe.js").includes('req.query.area === "espera"'));
  const sql = ler("supabase/fase39-lista-espera.sql");
  assert.ok(/create table if not exists public\.lista_espera/i.test(sql));
  assert.ok(/enable row level security/i.test(sql));
});
