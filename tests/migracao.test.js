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
    { metodo: "GET", padrao: /\/rest\/v1\/clientes\?barbearia_id=eq\.[^&]+&select=id,telefone/, resposta: { corpo: [{ id: "c-ana", telefone: "81999990000", cpf: null, externo: null, nascimento: null, observacao: null, ultima_visita_externa: null }] } },
    { metodo: "POST", padrao: /\/rest\/v1\/clientes/, resposta: { status: 201 } },
    { metodo: "PATCH", padrao: /\/rest\/v1\/clientes\?id=eq\./, resposta: { status: 204 } },
    { metodo: "GET", padrao: /\/rest\/v1\/clientes\?barbearia_id=eq\.[^&]+&externo=like\.booksy/, resposta: { corpo: [{ id: "c-bia", externo: "booksy:2", nome: "Bia Souza" }] } },
    { metodo: "GET", padrao: /\/rest\/v1\/pedidos\?barbearia_id=eq\.[^&]+&externo=like\.booksy/, resposta: { corpo: [{ externo: "booksy:900" }] } },
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
  assert.deepEqual(r.equipe, { novos: 1, ligados: 1 }, "Manolo ligado pelo nome, Cleyton novo, recepção fora");
  assert.deepEqual(r.servicos, { novos: 1, existentes: 1, semPreco: 1 });
  assert.equal(r.produtos.novos, 1);
  assert.deepEqual(r.clientes, { novos: 2, atualizados: 1, jaEstavam: 0, ignorados: 2 });
  assert.deepEqual(r.agendamentos, { novos: 2, jaEstavam: 1, semBarbeiro: 1, ignorados: 2 });
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
  const p902 = pedidos.find((p) => p.externo === "booksy:902");
  assert.equal(p902.status, "pendente");
  assert.equal(p902.cliente_id, null);
  assert.equal(p902.valor, null);
  const blq = post("bloqueios")[0];
  assert.deepEqual([blq.profissional_id, blq.tipo, blq.data, blq.inicio, blq.fim, blq.motivo], ["p-novo-Cleyton Santos", "pontual", amanha, "12:40", "14:30", "Bloqueio (Booksy)"]);
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

test("admin: só a conta da plataforma gera o coletor; o /app mostra o favorito e o resultado", async () => {
  const barbearia = require("../api/barbearia");
  A.instalarFetch([...A.rotasDeConta()]);
  const r = await A.chamar(barbearia, { metodo: "POST", token: "token-dono", corpo: { acao: "migracao-criar", barbeariaId: BARB } });
  assert.equal(r.statusCode, 403);
  const app = ler("app.html");
  assert.match(app, /id="secMigracao"/);
  assert.match(app, /acao: "migracao-criar", barbeariaId: id/);
  assert.match(app, /window\.__BIO_MIGRACAO=\{token:'/);
  assert.match(app, /\/coletor-booksy\.js\?v=1/);
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
  const sql = ler("supabase/fase26-migracao.sql").replace(/--.*$/gm, "").toLowerCase().replace(/on delete cascade/g, "");
  assert.doesNotMatch(sql, /\bdrop\b|\bdelete\b|\btruncate\b/);
  assert.match(sql, /token_hash text not null unique/);
});
