// Migração do Booksy: código de uso da coleta (só o hash no banco), recebimento só com código válido e vindo do
// Booksy, e a importação de equipe, serviços, produtos, clientes, agendamentos futuros e bloqueios sem duplicar.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const A = require("./ajuda");
const migracao = require("../lib/migracao");
const { somaDias } = require("../lib/horarios");

const { UUIDS } = A;
const ler = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const BARB = UUIDS.barbearia;
const hash = (t) => crypto.createHash("sha256").update(t).digest("hex");

test("coletor: o código vale 2 horas, só o hash fica no banco, e a vitrine não recebe migração", async () => {
  const chamadas = A.instalarFetch([
    { padrao: /\/rest\/v1\/barbearias\?id=eq\./, resposta: (url) => ({ corpo: [{ id: BARB, nome: "Dom Manolo", slug: "dom-manolo", demonstracao: url.includes(UUIDS.outraBarbearia) ? "vitrine" : null }] }) },
    { metodo: "POST", padrao: /\/rest\/v1\/migracoes/, resposta: { status: 201 } },
  ]);
  const r = await migracao.criar({ barbeariaId: BARB, userId: UUIDS.adminUser });
  assert.match(r.token, /^[0-9a-f]{48}$/);
  const ins = chamadas.find((c) => c.metodo === "POST" && c.url.includes("/migracoes"));
  assert.equal(ins.corpo.token_hash, hash(r.token));
  assert.ok(!JSON.stringify(ins.corpo).includes(r.token), "o código em si não é guardado");
  const minutos = (Date.parse(ins.corpo.expira_em) - Date.now()) / 60000;
  assert.ok(minutos > 115 && minutos <= 120, String(minutos));
  await assert.rejects(migracao.criar({ barbeariaId: UUIDS.outraBarbearia, userId: UUIDS.adminUser }), /vitrine/);
});

test("recebimento: código errado ou vencido é recusado e contado; o Booksy recebe a liberação de CORS", async () => {
  const config = require("../api/config");
  const token = "a".repeat(48);
  const chamadas = A.instalarFetch([
    { padrao: /\/rest\/v1\/rpc\/contar_tentativa/, resposta: { corpo: 0 } },
    { padrao: /\/rest\/v1\/migracoes\?token_hash=eq\./, resposta: (url) => ({ corpo: url.includes(hash(token)) ? [{ id: "m1", barbearia_id: BARB, expira_em: new Date(Date.now() - 1000).toISOString() }] : [] }) },
  ]);
  let r = await A.chamar(config, { metodo: "POST", corpo: JSON.stringify({ tipo: "migracao", token: "b".repeat(48), dados: {} }), headers: { origin: "https://booksy.com" } });
  assert.equal(r.statusCode, 404);
  assert.equal(r.headers["access-control-allow-origin"], "https://booksy.com");
  r = await A.chamar(config, { metodo: "POST", corpo: JSON.stringify({ tipo: "migracao", token, dados: {} }), headers: { origin: "https://booksy.com" } });
  assert.equal(r.statusCode, 404, "vencido");
  assert.ok(chamadas.filter((c) => c.url.includes("contar_tentativa") && c.corpo && c.corpo.p_registrar === true).length >= 2, "cada erro conta");
  r = await A.chamar(config, { metodo: "OPTIONS", headers: { origin: "https://site-estranho.com" } });
  assert.equal(r.statusCode, 204);
  assert.equal(r.headers["access-control-allow-origin"], undefined, "outro site não é liberado");
});

// Banco falso da importação: a barbearia já tem um barbeiro com o mesmo nome, um serviço e um cliente (mesmo WhatsApp)
function rotasImportacao() {
  return [
    { padrao: /\/rest\/v1\/barbearias\?id=eq\./, resposta: { corpo: [{ id: BARB, slug: "dom-manolo" }] } },
    { metodo: "GET", padrao: /\/rest\/v1\/profissionais\?barbearia_id=eq\./, resposta: { corpo: [{ id: "p-manolo", nome: "Manolo", externo: null }] } },
    { metodo: "PATCH", padrao: /\/rest\/v1\/profissionais\?id=eq\./, resposta: { status: 204 } },
    { metodo: "POST", padrao: /\/rest\/v1\/profissionais/, resposta: (u, o, corpo) => ({ status: 201, corpo: [{ id: "p-novo-" + corpo.nome, nome: corpo.nome, externo: corpo.externo }] }) },
    { metodo: "GET", padrao: /\/rest\/v1\/servicos_precos\?barbearia_id=eq\./, resposta: { corpo: [{ nome: "Corte degradê" }] } },
    { metodo: "POST", padrao: /\/rest\/v1\/servicos_precos/, resposta: { status: 201 } },
    { metodo: "GET", padrao: /\/rest\/v1\/produtos\?barbearia_id=eq\./, resposta: { corpo: [] } },
    { metodo: "POST", padrao: /\/rest\/v1\/produtos/, resposta: { status: 201 } },
    { metodo: "GET", padrao: /\/rest\/v1\/clientes\?barbearia_id=eq\.[^&]+&select=id,nome,telefone/, resposta: { corpo: [{ id: "c-ana", nome: "Ana Lima", telefone: "81999990000", cpf: null, externo: null, nascimento: null, observacao: "", ultima_visita_externa: null }] } },
    { metodo: "POST", padrao: /\/rest\/v1\/clientes/, resposta: { status: 201 } },
    { metodo: "PATCH", padrao: /\/rest\/v1\/clientes\?id=eq\./, resposta: { status: 204 } },
    { metodo: "GET", padrao: /\/rest\/v1\/clientes\?barbearia_id=eq\.[^&]+&select=id,externo,nome/, resposta: { corpo: [{ id: "c-bia", externo: "booksy:2", nome: "Bia Souza" }, { id: "c-ana", externo: null, nome: "Ana Lima" }, { id: "c-carla", externo: "booksy:6", nome: "Carla Dias" }] } },
    { metodo: "GET", padrao: /\/rest\/v1\/pedidos\?barbearia_id=eq\.[^&]+&externo=like\.booksy/, resposta: { corpo: [{ id: "ped-900", externo: "booksy:900", cliente_id: "c-bia" }] } },
    { metodo: "PATCH", padrao: /\/rest\/v1\/pedidos\?id=eq\./, resposta: { status: 204 } },
    { metodo: "POST", padrao: /\/rest\/v1\/pedidos/, resposta: { status: 201 } },
    { metodo: "GET", padrao: /\/rest\/v1\/bloqueios\?profissional_id=in\./, resposta: { corpo: [] } },
    { metodo: "POST", padrao: /\/rest\/v1\/bloqueios/, resposta: { status: 201 } },
  ];
}

test("importação: equipe da agenda, serviços com preço, produtos, clientes sem duplicar, agendamentos futuros e bloqueios", async () => {
  const chamadas = A.instalarFetch(rotasImportacao());
  const amanha = A.daquiA(1), ontem = somaDias(A.hoje(), -1);
  const dados = {
    equipe: [{ id: 11, nome: "Manolo", visivel: true }, { id: 12, nome: "Cleyton Santos", visivel: true }, { id: 13, nome: "Recepção", visivel: false }],
    servicos: [{ id: 51, nome: "Corte degradê", duracao: 40, preco: "40.00" }, { id: 52, nome: "Barba + Cabelo", duracao: 60, preco: "R$ 50,00+" }, { id: 53, nome: "Avaliação", duracao: 30, preco: null }],
    produtos: [{ id: 71, nome: "Pomada", preco: "35.00", estoque: 4, ativo: true }],
    clientes: [
      { id: 1, nome: "Ana Lima", telefone: "(81) 99999-0000", aceita: true },
      { id: 2, nome: "Bia Souza", telefone: "+55 81 98888-7777", nascimento: "1990-05-20", aceita: true, ultimaVisita: "2026-10-02T10:00" },
      { id: 3, nome: "+55 81977776666", telefone: "81977776666" },
      { id: 4, nome: "", telefone: "" },
      { id: 5, nome: "Carla Dias", telefone: "81 98888-7777" },
    ],
    agendamentos: [
      { id: 900, inicio: amanha + "T10:00", fim: amanha + "T10:40", status: "A", clienteId: 2, servicoId: 51, equipeId: 11 },
      { id: 901, inicio: amanha + "T11:00", fim: amanha + "T12:00", status: "A", clienteId: 2, clienteNome: "Bia", servicoId: 52, equipeId: 12 },
      { id: 902, inicio: amanha + "T15:00", fim: amanha + "T15:30", status: "W", clienteNome: "Avulso", servicoId: 53, equipeId: 11 },
      { id: 903, inicio: amanha + "T16:00", fim: amanha + "T16:30", status: "C", servicoId: 51, equipeId: 11 },
      { id: 904, inicio: ontem + "T16:00", fim: ontem + "T16:30", status: "A", servicoId: 51, equipeId: 11 },
      { id: 905, inicio: amanha + "T17:00", fim: amanha + "T17:30", status: "A", servicoId: 51, equipeId: 13 },
    ],
    bloqueios: [{ id: 700, inicio: amanha + "T12:40", fim: amanha + "T14:30", equipeId: 12, motivo: "" }],
  };
  const r = await migracao.importar(BARB, dados);
  assert.deepEqual(r.equipe, { novos: 1, ligados: 1, jaEstavam: 0 }, "Manolo ligado pelo nome, Cleyton novo, recepção fora");
  assert.deepEqual(r.servicos, { novos: 1, existentes: 1, semPreco: 1 });
  assert.equal(r.produtos.novos, 1);
  assert.deepEqual(r.clientes, { novos: 2, atualizados: 1, jaEstavam: 0, ignorados: 2 });
  assert.deepEqual(r.agendamentos, { novos: 2, jaEstavam: 1, ligados: 0, semBarbeiro: 1, ignorados: 2 });
  assert.equal(r.bloqueios.novos, 1);
  assert.equal(r.erros, undefined);

  const post = (t) => chamadas.filter((c) => c.metodo === "POST" && c.url.includes("/rest/v1/" + t)).map((c) => c.corpo).flat();
  const svc = post("servicos_precos");
  assert.deepEqual(svc.map((s) => [s.nome, s.preco]), [["Barba + Cabelo", 50]]);
  const clientes = post("clientes");
  const bia = clientes.find((c) => c.externo === "booksy:2");
  assert.equal(bia.telefone, "81988887777");
  assert.equal(bia.nascimento, "1990-05-20");
  assert.equal(bia.ultima_visita_externa, "2026-10-02");
  assert.equal(bia.aceita_novidades, true);
  assert.equal(bia.aceite_origem, "importacao");
  assert.equal(bia.origem, "importacao");
  const fone = clientes.find((c) => c.externo === "booksy:3");
  assert.equal(fone.nome, "Cliente (81) 97777-6666", "telefone no lugar do nome vira um nome legível");
  assert.equal(fone.aceita_novidades, false, "sem aceite no Booksy, sem aceite aqui");
  // observação é NOT NULL no banco (padrão texto vazio): nulo derrubava a gravação de quem não tinha observação
  assert.ok(clientes.every((c) => typeof c.observacao === "string"), "observação do cliente nunca nula");
  assert.ok(!clientes.some((c) => c.externo === "booksy:5"), "mesmo WhatsApp de outro cliente da coleta: não duplica");
  const patchAna = chamadas.find((c) => c.metodo === "PATCH" && c.url.includes("clientes?id=eq.c-ana"));
  assert.equal(patchAna.corpo.externo, "booksy:1", "quem já existia (mesmo WhatsApp) só ganha o vínculo e os campos vazios");
  assert.ok(!("aceita_novidades" in patchAna.corpo), "o aceite de quem já existia não muda");

  const pedidos = post("pedidos");
  const p901 = pedidos.find((p) => p.externo === "booksy:901");
  assert.equal(p901.status, "confirmado");
  assert.equal(p901.profissional_id, "p-novo-Cleyton Santos");
  assert.equal(p901.cliente_id, "c-bia");
  assert.equal(p901.cliente, "Bia Souza");
  assert.equal(p901.valor, 50);
  assert.equal(p901.duracao_min, 60);
  assert.equal(p901.horario, "11:00");
  assert.equal(p901.horario_fim, "12:00");
  assert.equal(p901.slug, "dom-manolo");
  assert.equal(p901.codigo, "B" + (901).toString(36).toUpperCase());
  assert.equal(p901.simulado, false);
  assert.ok(pedidos.every((p) => typeof p.observacao === "string"), "observação do agendamento nunca nula");
  const p902 = pedidos.find((p) => p.externo === "booksy:902");
  assert.equal(p902.status, "pendente");
  assert.equal(p902.cliente_id, null);
  assert.equal(p902.valor, null);
  const blq = post("bloqueios")[0];
  // Bloqueio comum do barbeirotop: sem motivo no Booksy, fica sem motivo (o quadro mostra "Bloqueado")
  assert.deepEqual([blq.profissional_id, blq.tipo, blq.data, blq.inicio, blq.fim, blq.motivo], ["p-novo-Cleyton Santos", "pontual", amanha, "12:40", "14:30", ""]);
});

test("importação: um registro fora das regras do banco não derruba o lote inteiro", async () => {
  let tentativas = 0;
  A.instalarFetch([
    ...rotasImportacao().filter((r) => !(r.metodo === "POST" && String(r.padrao).includes("clientes"))),
    { metodo: "POST", padrao: /\/rest\/v1\/clientes/, resposta: (u, o, corpo) => { tentativas++; return Array.isArray(corpo) || corpo.nome === "Zé Ruim" ? { status: 400, corpo: { message: "check" } } : { status: 201 }; } },
  ]);
  const r = await migracao.importar(BARB, { clientes: [{ id: 21, nome: "Zé Bom", telefone: "81911112222" }, { id: 22, nome: "Zé Ruim", telefone: "81933334444" }] });
  assert.equal(r.clientes.novos, 1);
  assert.equal(r.clientes.ignorados, 1);
  assert.equal(tentativas, 3, "um lote e depois um por um");
});

test("importação: na coleta seguinte, o nome de verdade entra no lugar do provisório; nome dado pelo dono não muda", async () => {
  const chamadas = A.instalarFetch([
    ...rotasImportacao().filter((r) => !(r.metodo === "GET" && String(r.padrao).includes("select=id,nome,telefone"))),
    { metodo: "GET", padrao: /\/rest\/v1\/clientes\?barbearia_id=eq\.[^&]+&select=id,nome,telefone/, resposta: { corpo: [
      { id: "c-prov", nome: "Cliente (81) 97777-6666", telefone: "81977776666", externo: "booksy:3", observacao: "" },
      { id: "c-dono", nome: "Seu Zé da Esquina", telefone: "81966665555", externo: "booksy:4", observacao: "" },
    ] } },
  ]);
  const r = await migracao.importar(BARB, { clientes: [
    { id: 3, nome: "Paulo Lima", telefone: "81977776666" },
    { id: 4, nome: "José Carlos", telefone: "81966665555" },
  ] });
  assert.equal(r.clientes.atualizados, 1);
  assert.equal(r.clientes.jaEstavam, 1);
  const patch = chamadas.filter((c) => c.metodo === "PATCH" && c.url.includes("/clientes?id=eq."));
  assert.equal(patch.length, 1);
  assert.ok(patch[0].url.includes("c-prov"));
  assert.equal(patch[0].corpo.nome, "Paulo Lima");
});

test("importação: ficha repetida no Booksy (mesmo WhatsApp) não vira outro cliente, e o agendamento dela acha quem ficou", async () => {
  const chamadas = A.instalarFetch(rotasImportacao());
  const amanha = A.daquiA(1);
  const r = await migracao.importar(BARB, {
    equipe: [{ id: 11, nome: "Manolo", visivel: true }],
    clientes: [
      { id: 1, nome: "Ana L.", telefone: "81999990000" }, // mesma pessoa que já estava na barbearia (c-ana)
      { id: 6, nome: "Carla Dias", telefone: "81955554444" },
      { id: 7, nome: "Carla D. (app)", telefone: "+55 81 95555-4444" }, // segunda ficha da Carla no Booksy
    ],
    agendamentos: [
      { id: 950, inicio: amanha + "T10:00", fim: amanha + "T10:30", status: "A", clienteId: 7, equipeId: 11 },
      { id: 951, inicio: amanha + "T11:00", fim: amanha + "T11:30", status: "A", clienteId: 1, equipeId: 11 },
    ],
  });
  assert.equal(r.clientes.novos, 1, "só a primeira ficha da Carla");
  assert.equal(r.clientes.ignorados, 1);
  const pedidos = chamadas.filter((c) => c.metodo === "POST" && c.url.includes("/rest/v1/pedidos")).map((c) => c.corpo).flat();
  assert.equal(pedidos.find((p) => p.externo === "booksy:950").cliente_id, "c-carla", "agendamento da ficha repetida vai para a que ficou");
  assert.equal(pedidos.find((p) => p.externo === "booksy:951").cliente_id, "c-ana", "agendamento de quem já estava na barbearia");
});

test("importação: duas fichas do mesmo cliente completam um só cadastro, com a última visita mais recente", async () => {
  const chamadas = A.instalarFetch([
    ...rotasImportacao().filter((r) => !(r.metodo === "GET" && String(r.padrao).includes("select=id,nome,telefone"))),
    { metodo: "GET", padrao: /\/rest\/v1\/clientes\?barbearia_id=eq\.[^&]+&select=id,nome,telefone/, resposta: { corpo: [
      { id: "c-ana", nome: "Ana Lima", telefone: "81999990000", externo: "booksy:1", observacao: "", nascimento: null, ultima_visita_externa: "2026-01-10" },
    ] } },
  ]);
  const r = await migracao.importar(BARB, { clientes: [
    { id: 1, nome: "Ana Lima", telefone: "81999990000", ultimaVisita: "2026-10-05T10:00:00" },
    { id: 9, nome: "Ana (app)", telefone: "81999990000", ultimaVisita: "2026-08-01T10:00:00", nascimento: "1991-03-04" },
  ] });
  const patch = chamadas.filter((c) => c.metodo === "PATCH" && c.url.includes("/clientes?id=eq."));
  assert.equal(patch.length, 1, "um cadastro, uma atualização");
  assert.equal(patch[0].corpo.ultima_visita_externa, "2026-10-05", "a ficha com visita mais antiga não volta a data");
  assert.equal(patch[0].corpo.nascimento, "1991-03-04", "a outra ficha completa o que faltava");
  assert.equal(r.clientes.atualizados, 1);
});

test("importação: agendamento que veio antes sem cliente fica ligado a ele quando o cliente entra", async () => {
  const chamadas = A.instalarFetch([
    ...rotasImportacao().filter((r) => !(r.metodo === "GET" && String(r.padrao).includes("pedidos"))),
    { metodo: "GET", padrao: /\/rest\/v1\/pedidos\?barbearia_id=eq\.[^&]+&externo=like\.booksy/, resposta: { corpo: [{ id: "ped-900", externo: "booksy:900", cliente_id: null }, { id: "ped-901", externo: "booksy:901", cliente_id: "c-outro" }] } },
  ]);
  const amanha = A.daquiA(1);
  const r = await migracao.importar(BARB, { equipe: [{ id: 11, nome: "Manolo", visivel: true }], agendamentos: [
    { id: 900, inicio: amanha + "T10:00", fim: amanha + "T10:40", status: "A", clienteId: 2, equipeId: 11 },
    { id: 901, inicio: amanha + "T11:00", fim: amanha + "T11:40", status: "A", clienteId: 2, equipeId: 11 },
  ] });
  assert.equal(r.agendamentos.jaEstavam, 2);
  assert.equal(r.agendamentos.ligados, 1, "só o que estava sem cliente");
  const patch = chamadas.filter((c) => c.metodo === "PATCH" && c.url.includes("/pedidos?id=eq."));
  assert.equal(patch.length, 1);
  assert.match(patch[0].url, /id=eq\.ped-900&cliente_id=is\.null/, "não troca o cliente de quem já tem");
  assert.deepEqual(patch[0].corpo, { cliente_id: "c-bia", cliente: "Bia Souza" });
});

test("importação: erro que se repete para cedo, e sem tempo o resto fica para a próxima coleta (sem agendamento solto)", async () => {
  // Todo cliente recusado (como a observação nula): não pode virar 1.000 tentativas e estourar os 60 segundos
  let tentativas = 0;
  A.instalarFetch([
    ...rotasImportacao().filter((r) => !(r.metodo === "POST" && String(r.padrao).includes("clientes"))),
    { metodo: "POST", padrao: /\/rest\/v1\/clientes/, resposta: () => { tentativas++; return { status: 400, corpo: { message: "null value in column" } }; } },
  ]);
  const muitos = Array.from({ length: 1200 }, (_, i) => ({ id: 5000 + i, nome: "Cliente Teste", telefone: "8198" + String(1000000 + i) }));
  const r = await migracao.importar(BARB, { clientes: muitos });
  assert.equal(r.clientes.novos, 0);
  assert.equal(r.clientes.ignorados, 1200);
  assert.ok(tentativas < 120, "parou de dividir: " + tentativas);

  // Sem tempo: nada é gravado, a coleta avisa que é parcial e as etapas seguintes esperam a próxima vez
  const chamadas = A.instalarFetch(rotasImportacao());
  const r2 = await migracao.importar(BARB, { clientes: muitos.slice(0, 3), agendamentos: [{ id: 1, inicio: A.daquiA(1) + "T10:00", fim: A.daquiA(1) + "T10:30", status: "A", equipeId: 11 }] }, { prazo: Date.now() - 1 });
  assert.equal(r2.parcial, true);
  assert.equal(r2.agendamentos, undefined, "agendamento só entra depois dos clientes");
  assert.equal(chamadas.filter((c) => c.metodo === "POST").length, 0);
});

test("importação: número salvo sem DDD ganha o DDD da barbearia (do telefone dela no Booksy ou do WhatsApp do painel)", async () => {
  const clientes = [
    { id: 31, nome: "Davi Sem DDD", telefone: "98111-2233" },
    { id: 32, nome: "Edu Formato Antigo", telefone: "8122-3344" },
    { id: 33, nome: "Fábio de Fora", telefone: "+351 912 345 678" },
  ];
  const inseridos = (chamadas) => chamadas.filter((c) => c.metodo === "POST" && c.url.includes("/rest/v1/clientes")).map((c) => c.corpo).flat();
  const tel = (lista, id) => lista.find((c) => c.externo === "booksy:" + id).telefone;

  let chamadas = A.instalarFetch(rotasImportacao());
  await migracao.importar(BARB, { ddd: "81", clientes });
  let ins = inseridos(chamadas);
  assert.equal(tel(ins, 31), "81981112233");
  assert.equal(tel(ins, 32), "81981223344", "8 dígitos de celular antigo ganham o 9");
  assert.equal(tel(ins, 33), null, "número de outro país não vira DDD 81");

  // Sem o DDD do Booksy, vale o do WhatsApp que o dono cadastrou no painel
  chamadas = A.instalarFetch([
    { padrao: /\/rest\/v1\/barbearias\?id=eq\./, resposta: { corpo: [{ id: BARB, slug: "dom-manolo", whatsapp: "11999990000" }] } },
    ...rotasImportacao().filter((r) => !String(r.padrao).includes("barbearias")),
  ]);
  await migracao.importar(BARB, { clientes });
  assert.equal(tel(inseridos(chamadas), 31), "11981112233");

  // Sem nenhum DDD conhecido, o número sem DDD fica de fora (o cliente entra sem telefone)
  chamadas = A.instalarFetch(rotasImportacao());
  await migracao.importar(BARB, { clientes });
  assert.equal(tel(inseridos(chamadas), 31), null);

  const c = ler("coletor-booksy.js");
  assert.match(c, /ddd: ddd,/, "o coletor manda o DDD da barbearia");
  assert.ok(c.includes('.replace(/\\D/g, "").replace(/^55(?=\\d{10,11}$)/, "")'), "a barra do \\D não pode sumir");
  assert.ok(ler("lib/migracao.js").includes('.replace(/\\D/g, "")'));
});

test("admin: só a conta da plataforma gera o coletor; o /app mostra o favorito e o resultado", async () => {
  const barbearia = require("../api/barbearia");
  A.instalarFetch([...A.rotasDeConta()]);
  const r = await A.chamar(barbearia, { metodo: "POST", token: "token-dono", corpo: { acao: "migracao-criar", barbeariaId: BARB } });
  assert.equal(r.statusCode, 403);
  const app = ler("app.html");
  assert.match(app, /id="secMigracao"/);
  assert.match(app, /acao: "migracao-criar", barbeariaId: id/);
  assert.match(app, /window\.__BIO_MIGRACAO=\{token:'/);
  assert.match(app, /\/coletor-booksy\.js\?v=\d+/);
});

test("coletor: no Booksy só lê; manda para o barbeirotop como texto (sem pré-verificação) e devolve o XHR do site", () => {
  const c = ler("coletor-booksy.js");
  assert.doesNotMatch(c, /method:\s*"(PUT|PATCH|DELETE)"/, "nada é alterado no Booksy");
  const posts = c.match(/method:\s*"POST"/g) || [];
  assert.equal(posts.length, 1, "o único POST é o envio para o barbeirotop");
  assert.match(c, /fetch\(base \+ caminho, \{ headers: cab, credentials: "omit" \}\)/);
  assert.match(c, /"Content-Type": "text\/plain;charset=UTF-8"/);
  assert.match(c, /function devolver\(\) \{ XMLHttpRequest\.prototype\.open = abrir;/);
  assert.ok(!/email/.test(c.replace(/\/\/.*$/gm, "")), "o e-mail do cliente não é coletado");
  // Cliente do app do Booksy: nome e telefone ficam no perfil combinado; o id continua o da ficha da barbearia
  assert.match(c, /var b = c\.business_customer \|\| \{\}, m = c\.merged_data \|\| \{\};/);
  assert.match(c, /id: b\.id \|\| m\.id \|\| c\._id/);
  assert.match(c, /var tela = \/\\\/customers\(\\\/\|\$\)\/\.test\(location\.pathname\) \? "calendar" : "customers";/);
  const sql = ler("supabase/fase26-migracao.sql").replace(/--.*$/gm, "").toLowerCase().replace(/on delete cascade/g, "");
  assert.doesNotMatch(sql, /\bdrop\b|\bdelete\b|\btruncate\b/);
  assert.match(sql, /token_hash text not null unique/);
});

// ---------- histórico do aplicativo anterior (fase 28) ----------
test("histórico do Booksy: atendido e não compareceu entram como do app anterior, ligados ao cliente (pela ficha ou pelo WhatsApp), sem duplicar", async () => {
  const ontem = somaDias(A.hoje(), -1);
  const chamadas = A.instalarFetch([
    { padrao: /\/rest\/v1\/barbearias\?id=eq\./, resposta: { corpo: [{ id: BARB, whatsapp: null }] } },
    { metodo: "GET", padrao: /\/rest\/v1\/clientes\?barbearia_id=eq\.[^&]+&select=id,externo,telefone/, resposta: { corpo: [{ id: "c-ana", externo: "booksy:1", telefone: "81999990000" }, { id: "c-bia", externo: "booksy:2", telefone: "81988887777" }] } },
    { metodo: "GET", padrao: /\/rest\/v1\/profissionais\?barbearia_id=eq\.[^&]+&externo=like/, resposta: { corpo: [{ id: "p-manolo", nome: "Manolo", externo: "booksy:11" }] } },
    // O banco devolve só o que entrou: o 503 já estava de uma coleta anterior
    { metodo: "POST", padrao: /\/rest\/v1\/atendimentos_externos/, resposta: (u, o, corpo) => ({ status: 201, corpo: corpo.filter((x) => x.externo !== "booksy:503").map((x, i) => ({ id: "h" + i })) }) },
    { metodo: "POST", padrao: /\/rest\/v1\/rpc\/recalcular_ritmo_externo/, resposta: { corpo: 2 } },
  ]);
  const r = await migracao.importarHistorico(BARB, { ddd: "81", equipe: [{ id: 11, nome: "Manolo" }, { id: 99, nome: "Ex Barbeiro" }], historico: [
    { id: 500, inicio: "2024-03-10T10:00", status: "F", clienteId: 1, servicoNome: "Corte", equipeId: 11 },
    { id: 501, inicio: "2023-01-05T15:30", status: "N", clienteId: 7, clienteTelefone: "98888-7777", servicoNome: "Barba", equipeId: 99 },
    { id: 502, inicio: "2022-02-02T09:00", status: "F", clienteId: 8, servicoNome: "Corte", equipeId: 55 },
    { id: 503, inicio: ontem + "T11:00", status: "F", clienteId: 1, servicoNome: "Corte", equipeId: 11 },
    { id: 504, inicio: A.hoje() + "T11:00", status: "F", clienteId: 1 },
    { id: 505, inicio: "2024-03-10T10:00", status: "C", clienteId: 1 },
    { id: 500, inicio: "2024-03-10T10:00", status: "F", clienteId: 1 },
  ] });
  assert.deepEqual(r, { novos: 3, jaEstavam: 1, semCliente: 1, ignorados: 2, ritmos: 2 }, "hoje fica para a agenda; cancelado não entra; repetido conta uma vez");
  const ritmo = chamadas.find((c) => c.url.includes("/rpc/recalcular_ritmo_externo"));
  assert.deepEqual(ritmo.corpo, { p_barbearia_id: BARB }, "o ritmo de retorno de cada cliente é refeito com o histórico");
  const post = chamadas.find((c) => c.metodo === "POST" && c.url.includes("atendimentos_externos"));
  assert.match(post.url, /on_conflict=barbearia_id,externo/, "o que já veio antes não duplica");
  const linha = (id) => post.corpo.find((x) => x.externo === "booksy:" + id);
  const l500 = linha(500);
  assert.deepEqual([l500.cliente_id, l500.status, l500.dia, l500.horario, l500.servico, l500.profissional, l500.profissional_id, l500.origem], ["c-ana", "realizado", "2024-03-10", "10:00", "Corte", "Manolo", "p-manolo", "booksy"]);
  assert.equal(linha(501).cliente_id, "c-bia", "ficha repetida no Booksy: achado pelo WhatsApp (com o DDD da barbearia)");
  assert.equal(linha(501).status, "faltou");
  assert.equal(linha(501).profissional, "Ex Barbeiro", "quem não está no barbeirotop fica com o nome do Booksy");
  assert.equal(linha(501).profissional_id, null);
  assert.equal(linha(502).cliente_id, null);
  assert.equal(linha(502).profissional, null);
  assert.ok(!linha(504) && !linha(505));
  assert.equal(post.corpo.filter((x) => x.externo === "booksy:500").length, 1);
});

test("recebimento do histórico: parte a parte, e o resumo da coleta soma as partes (a primeira começa do zero)", async () => {
  const config = require("../api/config");
  const token = "c".repeat(48);
  let resumoSalvo = { clientes: { novos: 5 }, historico: { novos: 99 } };
  A.instalarFetch([
    { padrao: /\/rest\/v1\/rpc\/contar_tentativa/, resposta: { corpo: 0 } },
    { metodo: "GET", padrao: /\/rest\/v1\/migracoes\?token_hash=eq\./, resposta: () => ({ corpo: [{ id: "m1", barbearia_id: BARB, expira_em: new Date(Date.now() + 3600e3).toISOString(), resumo: resumoSalvo }] }) },
    { metodo: "PATCH", padrao: /\/rest\/v1\/migracoes\?id=eq\./, resposta: (u, o, corpo) => { resumoSalvo = corpo.resumo; return { status: 204 }; } },
    { padrao: /\/rest\/v1\/barbearias\?id=eq\./, resposta: { corpo: [{ id: BARB, whatsapp: null }] } },
    { metodo: "GET", padrao: /\/rest\/v1\/clientes\?barbearia_id=eq\./, resposta: { corpo: [{ id: "c-ana", externo: "booksy:1", telefone: null }] } },
    { metodo: "GET", padrao: /\/rest\/v1\/profissionais\?barbearia_id=eq\./, resposta: { corpo: [] } },
    { metodo: "POST", padrao: /\/rest\/v1\/atendimentos_externos/, resposta: (u, o, corpo) => ({ status: 201, corpo: corpo.map((x, i) => ({ id: "h" + i })) }) },
    { metodo: "POST", padrao: /\/rest\/v1\/rpc\/recalcular_ritmo_externo/, resposta: { corpo: 1 } },
  ]);
  const parte = (n, ids) => A.chamar(config, { metodo: "POST", headers: { origin: "https://booksy.com" }, corpo: JSON.stringify({ tipo: "migracao", token, dados: { historicoParte: n, historico: ids.map((id) => ({ id, inicio: "2024-01-0" + ((id % 8) + 1) + "T10:00", status: "F", clienteId: 1 })) } }) });
  let r = await parte(1, [1, 2]);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.resumo.historico.novos, 2);
  r = await parte(2, [3, 4, 5]);
  assert.equal(r.statusCode, 200);
  assert.equal(resumoSalvo.historico.novos, 5, "soma as partes; a parte 1 começou do zero");
  assert.equal(resumoSalvo.clientes.novos, 5, "o resto do resumo da coleta fica");
});

test("coletor do histórico: ano a ano, só atendido e não compareceu, depois de todos os clientes; dá para mandar só o histórico", () => {
  const c = ler("coletor-booksy.js");
  assert.match(c, /if \(b\.status !== "F" && b\.status !== "N"\) return;/);
  assert.match(c, /calendar\?start_date=" \+ ano \+ "-01-01&end_date=" \+ fim/);
  assert.match(c, /historicoParte: parte/);
  assert.match(c, /if \(s\.parcial\) \{ encerrar\(/, "com clientes faltando, o histórico espera a próxima coleta");
  assert.match(c, /if \(M\.so === "historico"\)/);
  assert.match(c, /clienteTelefone: c\.phone/, "o WhatsApp acha o cliente de ficha repetida");
  // Nenhuma função do coletor pode ter o nome de uma variável do mesmo escopo: a variável sobrescreve a função
  // (aconteceu com "enviar", que guarda o XMLHttpRequest.prototype.send, e o coletor parou com "Illegal invocation")
  const funcoes = [...c.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
  const variaveis = new Set([...c.matchAll(/\bvar\s+([^;]+);/g)].flatMap((m) => m[1].split(",").map((x) => x.trim().split(/\s*=/)[0])).filter(Boolean));
  assert.deepEqual(funcoes.filter((f) => variaveis.has(f)), [], "função com o nome de uma variável");
});

test("prótese do histórico: ficha na aba Prótese para quem fez colocação ou manutenção no último ano (ou tem horário), com as manutenções de lá", async () => {
  const hoje = A.hoje();
  const d = (n) => somaDias(hoje, -n);
  const hist = [
    // Ana: colocou, trocou e faz manutenção a cada 21 dias, quase sempre com o Manolo
    { id: "h1", externo: "booksy:1", cliente_id: "c-ana", dia: d(100), servico: "Colocação de Prótese Capilar", profissional_id: "p-manolo" },
    { id: "h2", externo: "booksy:2", cliente_id: "c-ana", dia: d(79), servico: "Manutenção de Prótese Capilar", profissional_id: "p-manolo" },
    { id: "h3", externo: "booksy:3", cliente_id: "c-ana", dia: d(58), servico: "Manutenção de Prótese Capilar", profissional_id: "p-joao" },
    { id: "h4", externo: "booksy:4", cliente_id: "c-ana", dia: d(37), servico: "Colocação de Prótese Capilar", profissional_id: "p-manolo" },
    { id: "h5", externo: "booksy:5", cliente_id: "c-ana", dia: d(16), servico: "Manutenção de Prótese Capilar", profissional_id: "p-manolo" },
    // Bia: só avaliação (não é cliente de prótese)
    { id: "h6", externo: "booksy:6", cliente_id: "c-bia", dia: d(30), servico: "Avaliação para Prótese Capilar", profissional_id: null },
    // Caio: parou há mais de 1 ano
    { id: "h7", externo: "booksy:7", cliente_id: "c-caio", dia: d(500), servico: "Manutenção de Prótese Capilar", profissional_id: "p-manolo" },
    // Duda: já tinha ficha no barbeirotop
    { id: "h8", externo: "booksy:8", cliente_id: "c-duda", dia: d(10), servico: "Manutenção de Prótese Capilar", profissional_id: "p-joao" },
  ];
  const chamadas = A.instalarFetch([
    { metodo: "GET", padrao: /\/rest\/v1\/atendimentos_externos\?/, resposta: { corpo: hist } },
    { metodo: "GET", padrao: /\/rest\/v1\/protese_clientes\?/, resposta: { corpo: [{ id: "f-duda", cliente_id: "c-duda", aplicada_em: null, ultima_manutencao: d(40) }] } },
    // Edu tem prótese marcada na agenda, sem histórico
    { metodo: "GET", padrao: /\/rest\/v1\/pedidos\?/, resposta: { corpo: [{ cliente_id: "c-edu" }] } },
    { metodo: "GET", padrao: /\/rest\/v1\/clientes\?id=in\./, resposta: { corpo: [{ id: "c-ana", nome: "Ana Lima", telefone: "81999990000" }, { id: "c-edu", nome: "Edu Prado", telefone: "81988880000" }, { id: "c-caio", nome: "Caio", telefone: "" }] } },
    { metodo: "POST", padrao: /\/rest\/v1\/protese_clientes$/, resposta: (u, o, corpo) => ({ status: 201, corpo: corpo.map((f) => ({ id: "f-" + f.cliente_id, ...f })) }) },
    { metodo: "PATCH", padrao: /\/rest\/v1\/protese_clientes\?id=eq\./, resposta: { status: 204 } },
    { metodo: "POST", padrao: /\/rest\/v1\/protese_manutencoes/, resposta: (u, o, corpo) => ({ status: 201, corpo: corpo.map((x, i) => ({ id: "m" + i })) }) },
  ]);
  const r = await migracao.proteseDoHistorico(BARB);
  assert.deepEqual(r, { fichas: 2, manutencoes: 6, jaTinham: 1, foraPorTempo: 1 }, "Ana e Edu ganham ficha; Bia (só avaliação) e Caio (mais de 1 ano) não");
  const fichas = chamadas.find((c) => c.metodo === "POST" && /protese_clientes$/.test(c.url)).corpo;
  const ana = fichas.find((f) => f.cliente_id === "c-ana");
  assert.deepEqual([ana.nome, ana.telefone, ana.profissional_id, ana.aplicada_em, ana.ultima_manutencao, ana.intervalo_dias, ana.ativo], ["Ana Lima", "81999990000", "p-manolo", d(37), d(16), 21, true]);
  assert.match(ana.observacao, /^Veio do Booksy \(aplicativo anterior\): 3 manutenções de /);
  const edu = fichas.find((f) => f.cliente_id === "c-edu");
  assert.deepEqual([edu.aplicada_em, edu.ultima_manutencao, edu.intervalo_dias], [null, null, 21]);
  const post = chamadas.find((c) => c.metodo === "POST" && c.url.includes("protese_manutencoes"));
  assert.match(post.url, /on_conflict=barbearia_id,externo/, "rodar de novo não duplica");
  const tipos = post.corpo.filter((m) => m.protese_cliente_id === "f-c-ana").map((m) => m.tipo);
  assert.deepEqual(tipos, ["aplicacao", "manutencao", "manutencao", "troca", "manutencao"], "a primeira colocação é a aplicação; a seguinte, troca");
  assert.ok(post.corpo.every((m) => m.observacao === "Booksy (aplicativo anterior)"));
  assert.ok(post.corpo.some((m) => m.protese_cliente_id === "f-duda" && m.externo === "booksy:8"), "a ficha que já existia recebe o histórico");
  const patch = chamadas.find((c) => c.metodo === "PATCH" && c.url.includes("protese_clientes?id=eq.f-duda"));
  assert.deepEqual(patch.corpo, { ultima_manutencao: d(10) }, "a última manutenção de lá vale se for mais nova");
  assert.ok(!post.corpo.some((m) => m.externo === "booksy:6" || m.externo === "booksy:7"));
});

test("fim do histórico: o recebimento monta as fichas de prótese e o coletor pede isso depois do último ano", async () => {
  const config = require("../api/config");
  const token = "d".repeat(48);
  let resumoSalvo = { clientes: { novos: 3 } };
  A.instalarFetch([
    { padrao: /\/rest\/v1\/rpc\/contar_tentativa/, resposta: { corpo: 0 } },
    { metodo: "GET", padrao: /\/rest\/v1\/migracoes\?token_hash=eq\./, resposta: () => ({ corpo: [{ id: "m1", barbearia_id: BARB, expira_em: new Date(Date.now() + 3600e3).toISOString(), resumo: resumoSalvo }] }) },
    { metodo: "PATCH", padrao: /\/rest\/v1\/migracoes\?id=eq\./, resposta: (u, o, corpo) => { resumoSalvo = corpo.resumo; return { status: 204 }; } },
    { metodo: "GET", padrao: /\/rest\/v1\/atendimentos_externos\?/, resposta: { corpo: [] } },
    { metodo: "GET", padrao: /\/rest\/v1\/protese_clientes\?/, resposta: { corpo: [] } },
    { metodo: "GET", padrao: /\/rest\/v1\/pedidos\?/, resposta: { corpo: [] } },
  ]);
  const r = await A.chamar(config, { metodo: "POST", headers: { origin: "https://booksy.com" }, corpo: JSON.stringify({ tipo: "migracao", token, dados: { historicoFim: true } }) });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.resumo.protese, { fichas: 0, manutencoes: 0, jaTinham: 0, foraPorTempo: 0 });
  assert.equal(resumoSalvo.clientes.novos, 3, "o resto do resumo fica");
  assert.ok(resumoSalvo.protese);
  const c = ler("coletor-booksy.js");
  assert.match(c, /historicoFim: true/);
  assert.match(c, /if \(!total\.pendentes\) \{/, "só depois que o histórico entrou todo");
  assert.match(ler("app.html"), /fichas novas na aba Prótese/);
});

test("ficha do cliente: o histórico do Booksy vem separado, marcado como do aplicativo anterior", async () => {
  const equipe = require("../api/equipe");
  const ID = "dddddddd-0000-4000-8000-000000000009";
  A.instalarFetch([
    { padrao: /\/rest\/v1\/clientes\?id=eq\./, resposta: { corpo: [{ id: ID, nome: "Edu Prado", telefone: "81999990005", cpf: null, nascimento: null, observacao: "", profissional_id: null, origem: "importacao", ultima_visita_externa: "2026-10-02", aceita_novidades: false, aceite_em: null, aceite_origem: null, saiu_em: null, criado_em: "2026-11-18T12:00:00Z", externo: "booksy:77" }] } },
    { padrao: /\/rest\/v1\/pedidos\?cliente_id=eq\./, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/campanha_envios\?/, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/atendimentos_externos\?cliente_id=eq\./, resposta: { corpo: [
      { dia: "2026-10-02", horario: "10:00", servico: "Corte americano", profissional: "Cleyton Santos", profissional_id: null, status: "realizado", origem: "booksy" },
      { dia: "2025-03-01", horario: "15:00", servico: "Barba simples", profissional: null, profissional_id: null, status: "faltou", origem: "booksy" },
    ] } },
    ...A.rotasDeConta(),
  ]);
  const r = await A.chamar(equipe, { query: { area: "clientes", id: ID }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.cliente.veioDe, "booksy");
  assert.equal(r.body.anteriores.length, 2);
  assert.deepEqual(r.body.anteriores[1], { dia: "2025-03-01", horario: "15:00", servico: "Barba simples", profissional: "", status: "faltou", origem: "booksy" });
  assert.deepEqual(r.body.visitas, [], "não se mistura com as visitas do barbeirotop");
  const tela = ler("painel-clientes.js");
  assert.match(tela, /\(aplicativo anterior\)/);
  assert.match(tela, /não entram no financeiro nem nas comissões/);
  assert.match(tela, /"veio do " \+ APP_ANTERIOR\[c\.veioDe\]/);
});
