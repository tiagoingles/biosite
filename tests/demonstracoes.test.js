// As duas demonstrações: WhatsApp da barbearia no banco (a Modelo troca pelo do dono que assiste), a vitrine da
// página de vendas aberta sem login e só para olhar, e o site da vitrine que não grava agendamento.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const A = require("./ajuda");

const { UUIDS } = A;
const ler = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const VITRINE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const FELIPE = "f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0";

// Banco falso com a vitrine: o barbeiro da demonstração é o segundo da equipe (o primeiro é o dono)
function rotasVitrine(extra = []) {
  return [
    ...extra,
    { padrao: /\/rest\/v1\/barbearias\?demonstracao=eq\.vitrine/, resposta: { corpo: [{ id: VITRINE, nome: "Barbearia Exemplo" }] } },
    { padrao: /\/rest\/v1\/profissionais\?barbearia_id=eq\.[0-9a-f-]+&ativo=eq\.true&select=[^&]+&order=criado_em\.asc&offset=1&limit=1/, resposta: { corpo: [{ id: FELIPE, barbearia_id: VITRINE, nome: "Felipe", ativo: true, foto_url: null, comissao_pct: 45 }] } },
    { padrao: /\/rest\/v1\/barbearias\?id=eq\./, resposta: { corpo: [{ id: VITRINE, slug: "barbearia-exemplo", nome: "Barbearia Exemplo", demonstracao: "vitrine", whatsapp: null }] } },
    ...A.rotasDeConta(),
  ];
}

test("dono troca o WhatsApp que recebe os pedidos do site: normaliza, apaga e recusa número inválido", async () => {
  const eu = require("../api/eu");
  const chamadas = A.instalarFetch([{ metodo: "PATCH", padrao: /\/rest\/v1\/barbearias\?id=eq\./, resposta: { status: 204 } }, ...A.rotasDeConta()]);
  let r = await A.chamar(eu, { metodo: "POST", token: "token-dono", corpo: { acao: "config-barbearia", whatsapp: "+55 (81) 99797-7699" } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.whatsapp, "81997977699", "guarda DDD + número, sem o 55");
  const patches = () => chamadas.filter((c) => c.metodo === "PATCH");
  assert.ok(patches()[0].url.includes(UUIDS.barbearia));
  assert.deepEqual(patches()[0].corpo, { whatsapp: "81997977699" });

  r = await A.chamar(eu, { metodo: "POST", token: "token-dono", corpo: { acao: "config-barbearia", whatsapp: "" } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.whatsapp, null, "em branco volta a valer o número publicado no site");
  assert.deepEqual(patches()[1].corpo, { whatsapp: null });

  r = await A.chamar(eu, { metodo: "POST", token: "token-dono", corpo: { acao: "config-barbearia", whatsapp: "12345" } });
  assert.equal(r.statusCode, 400);
  r = await A.chamar(eu, { metodo: "POST", token: "token-bruno", corpo: { acao: "config-barbearia", whatsapp: "81997977699" } });
  assert.equal(r.statusCode, 403, "barbeiro não troca o WhatsApp da barbearia");
  assert.equal(patches().length, 2, "nada gravado nos casos recusados");
});

test("site: a lista pública da equipe traz o WhatsApp cadastrado no painel", async () => {
  const profissionais = require("../api/profissionais");
  A.instalarFetch([
    { padrao: /\/rest\/v1\/barbearias\?slug=eq\.barbearia-modelo/, resposta: { corpo: [{ id: UUIDS.barbearia, whatsapp: "81988887777" }] } },
    { padrao: /\/rest\/v1\/profissionais\?barbearia_id=eq\./, resposta: { corpo: [{ id: UUIDS.bruno, nome: "Bruno", foto_url: null }] } },
    { padrao: /\/rest\/v1\/servicos_precos\?/, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/clube_planos\?/, resposta: { corpo: [] } },
  ]);
  let r = await A.chamar(profissionais, { query: { slug: "barbearia-modelo" } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.whatsapp, "81988887777");

  A.instalarFetch([
    { padrao: /\/rest\/v1\/barbearias\?slug=eq\.gw-teste/, resposta: { corpo: [{ id: UUIDS.barbearia, whatsapp: null }] } },
    { padrao: /\/rest\/v1\/profissionais\?barbearia_id=eq\./, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/servicos_precos\?/, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/clube_planos\?/, resposta: { corpo: [] } },
  ]);
  r = await A.chamar(profissionais, { query: { slug: "gw-teste" } });
  assert.equal(r.body.whatsapp, null, "sem número no painel, vale o do site");
});

// Banco falso do agendamento público (mesma base de tests/pedido.test.js)
function rotasDoPedido(barbearia) {
  return [
    ...A.rotasDeConta(),
    { padrao: /\/rest\/v1\/barbearias\?slug=eq\./, resposta: { corpo: [barbearia] } },
    { padrao: /\/rest\/v1\/profissionais\?barbearia_id=eq\./, resposta: { corpo: [{ id: UUIDS.bruno, nome: "Bruno" }] } },
    { padrao: /\/rest\/v1\/agenda_dia\?profissional_id=eq\./, resposta: { corpo: [{ inicio: "09:00:00", fim: "18:00:00", almoco_inicio: "12:00:00", almoco_fim: "13:00:00", confirmada_em: "2026-11-01T10:00:00Z" }] } },
    { padrao: /\/rest\/v1\/bloqueios\?/, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/pedidos\?profissional_id=eq\./, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/servicos_precos\?barbearia_id=eq\./, resposta: { corpo: [{ preco: "40.00" }] } },
    { padrao: /\/rest\/v1\/rpc\/criar_pedido/, resposta: { corpo: { id: UUIDS.pedido } } },
  ];
}

test("vitrine: o site não grava agendamento; nas outras, o pedido devolve o WhatsApp atual da barbearia", async () => {
  const pedido = require("../api/pedido");
  const corpo = (slug) => ({ slug, servico: "Corte", profissionalId: UUIDS.bruno, profissional: "Bruno", dia: A.daquiA(1), horario: "10:00", cliente: "Visitante", duracao: 30 });

  let chamadas = A.instalarFetch(rotasDoPedido({ id: VITRINE, confirmacao_automatica: false, sinal: {}, whatsapp: null, demonstracao: "vitrine" }));
  let r = await A.chamar(pedido, { metodo: "POST", corpo: corpo("barbearia-exemplo") });
  assert.equal(r.statusCode, 403);
  assert.equal(r.body.demonstracao, true);
  assert.match(r.body.message, /demonstração/);
  assert.equal(chamadas.filter((c) => c.url.includes("criar_pedido")).length, 0, "nada é gravado na vitrine");

  chamadas = A.instalarFetch(rotasDoPedido({ id: UUIDS.barbearia, confirmacao_automatica: false, sinal: {}, whatsapp: "81988887777", demonstracao: "apresentacao" }));
  r = await A.chamar(pedido, { metodo: "POST", corpo: corpo("barbearia-modelo") });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.equal(r.body.whatsapp, "81988887777", "a mensagem do pedido vai para o número atual, mesmo com o site em cache");
  assert.equal(chamadas.filter((c) => c.url.includes("criar_pedido")).length, 1, "a Modelo agenda de verdade");

  A.instalarFetch(rotasDoPedido({ id: UUIDS.barbearia, confirmacao_automatica: false, sinal: {}, whatsapp: null, demonstracao: null }));
  r = await A.chamar(pedido, { metodo: "POST", corpo: corpo("gw-teste") });
  assert.equal(r.statusCode, 201);
  assert.equal(r.body.whatsapp, undefined, "sem número no painel, o site usa o dele");
});

test("demonstração sem login: o painel abre a vitrine como dono, sem perguntar nada ao Supabase", async () => {
  const eu = require("../api/eu");
  const chamadas = A.instalarFetch(rotasVitrine());
  const r = await A.chamar(eu, { token: "demo-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.perfil.papel, "dono");
  assert.equal(r.body.perfil.barbearia_id, VITRINE);
  assert.equal(r.body.barbearia.slug, "barbearia-exemplo");
  assert.equal(r.body.profissional, null);
  assert.ok(!chamadas.some((c) => c.url.includes("/auth/v1/user")), "a conta é de mentira: não vale como login");
});

test("demonstração: o barbeiro de exemplo vê só a agenda dele, e ?barbearia= não leva a outra barbearia", async () => {
  const eu = require("../api/eu");
  const pedido = require("../api/pedido");
  const chamadas = A.instalarFetch(rotasVitrine([{ padrao: /\/rest\/v1\/pedidos\?barbearia_id=eq\./, resposta: { corpo: [] } }]));
  let r = await A.chamar(eu, { token: "demo-barbeiro" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.perfil.papel, "barbeiro");
  assert.equal(r.body.profissional.id, FELIPE);

  r = await A.chamar(pedido, { token: "demo-barbeiro", query: { pendentes: "1" } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  let lida = chamadas.filter((c) => c.url.includes("/rest/v1/pedidos?barbearia_id=eq.")).pop();
  assert.ok(lida.url.includes(`barbearia_id=eq.${VITRINE}`) && lida.url.includes(`profissional_id=eq.${FELIPE}`), lida.url);

  r = await A.chamar(pedido, { token: "demo-dono", query: { pendentes: "1", barbearia: UUIDS.outraBarbearia } });
  assert.equal(r.statusCode, 200);
  lida = chamadas.filter((c) => c.url.includes("/rest/v1/pedidos?barbearia_id=eq.")).pop();
  assert.ok(lida.url.includes(`barbearia_id=eq.${VITRINE}`) && !lida.url.includes(UUIDS.outraBarbearia), lida.url);
});

test("demonstração: nada que grava passa, em nenhuma rota do painel", async () => {
  const chamadas = A.instalarFetch(rotasVitrine([
    { metodo: "PATCH", padrao: /\/rest\/v1\//, resposta: { status: 204 } },
    { metodo: "DELETE", padrao: /\/rest\/v1\//, resposta: { status: 204 } },
    { metodo: "POST", padrao: /\/rest\/v1\/(pedidos|clientes|produtos|clube_|protese_|convites|despesas|push_)/, resposta: { status: 201, corpo: [{}] } },
  ]));
  const casos = [
    ["POST", require("../api/eu"), { acao: "config-barbearia", whatsapp: "81999999999" }, {}],
    ["POST", require("../api/eu"), { acao: "inscrever-push", subscription: {} }, {}],
    ["POST", require("../api/pedido"), { acao: "remarcar", id: UUIDS.pedido, dia: A.daquiA(1), horario: "10:00" }, {}],
    ["PATCH", require("../api/pedido"), { id: UUIDS.pedido, status: "confirmado" }, {}],
    ["POST", require("../api/equipe"), { acao: "convidar", email: "alguem@exemplo.com" }, {}],
    ["POST", require("../api/equipe"), { acao: "salvar", nome: "Fulano" }, { area: "clientes" }],
    ["POST", require("../api/equipe"), { acao: "plano-salvar", nome: "Plano" }, { area: "clube" }],
    ["POST", require("../api/equipe"), { acao: "despesa-criar", descricao: "Aluguel", valor: 10 }, { area: "financeiro" }],
    ["POST", require("../api/equipe"), { acao: "venda", produtoId: UUIDS.pedido, quantidade: 1 }, { area: "produtos" }],
    ["POST", require("../api/equipe"), { acao: "salvar", nome: "Ficha" }, { area: "protese" }],
  ];
  for (const [metodo, rota, corpo, query] of casos) {
    for (const token of ["demo-dono", "demo-barbeiro"]) {
      const r = await A.chamar(rota, { metodo, token, corpo, query });
      assert.equal(r.statusCode, 403, JSON.stringify([metodo, corpo, query, token, r.body]));
      assert.match(r.body.message, /demonstração: aqui nada é salvo/);
    }
  }
  assert.equal(chamadas.filter((c) => c.metodo !== "GET").length, 0, "nenhuma escrita chegou ao banco");
});

test("conta.js: ?demo=dono abre a sessão de mentira só nesta aba, sem mexer no login de verdade", () => {
  const guardado = (mapa) => ({ getItem: (k) => (mapa.has(k) ? mapa.get(k) : null), setItem: (k, v) => mapa.set(k, String(v)), removeItem: (k) => mapa.delete(k) });
  const local = new Map([["bio_sessao", JSON.stringify({ access_token: "token-de-verdade", refresh_token: "r", expira: Date.now() + 1e6 })]]);
  const aba = new Map();
  const janela = { location: { search: "?demo=dono", hash: "", pathname: "/painel-dono" } };
  const ctx = { window: janela, localStorage: guardado(local), sessionStorage: guardado(aba), URLSearchParams, document: { body: null, getElementById: () => null }, fetch: async () => { throw new Error("sem rede no teste"); } };
  vm.createContext(ctx);
  vm.runInContext(ler("conta.js"), ctx);
  const Conta = janela.Conta;
  assert.equal(Conta.demo(), "dono");
  assert.equal(Conta.ler().access_token, "demo-dono", "o painel manda o token da demonstração");
  assert.equal(aba.get("bio_demo"), "dono", "fica só nesta aba (sessionStorage)");
  Conta.sair();
  assert.equal(Conta.demo(), null, "sair encerra a demonstração");
  assert.equal(JSON.parse(local.get("bio_sessao")).access_token, "token-de-verdade", "o login de verdade continua como estava");
  assert.equal(Conta.ler().access_token, "token-de-verdade");
});

test("telas: faixa da demonstração, avisos escondidos, WhatsApp no painel e a seção na página de vendas", () => {
  const conta = ler("conta.js");
  assert.match(conta, /function faixaDemo\(\)/);
  assert.match(conta, /Demonstração: os dados são de exemplo e nada é salvo\./);
  assert.match(ler("painel-comum.js"), /location\.href = demo \? "\/#demonstracao" : "entrar\.html"/);
  assert.match(ler("avisos.js"), /if \(window\.Conta && Conta\.demo && Conta\.demo\(\)\) return false;/, "sem conta, sem oferecer avisos");
  assert.match(ler("financeiro.html"), /Conta\.faixaDemo\(\);/);
  const dono = ler("painel-dono.html");
  assert.match(dono, /id="whatsBarbearia"/);
  assert.match(dono, /acao: "config-barbearia", whatsapp: valor/);
  const vendas = ler("index.html");
  assert.match(vendas, /id="demonstracao"/);
  for (const link of ['href="/barbearia-exemplo"', 'href="/painel-dono?demo=dono"', 'href="/painel-barbeiro?demo=barbeiro"', 'href="#demonstracao"']) assert.ok(vendas.includes(link), link);
});

test("site da vitrine (gerador v15): faixa de demonstração, WhatsApp de vendas e agendamento que não envia nada", () => {
  const G = require("../lib/gerador");
  assert.ok(G.VERSAO >= 15);
  const html = ler("barbearia-exemplo.html");
  const cfg = JSON.parse(html.match(/<script type="application\/json" id="bio-config">([\s\S]*?)<\/script>/)[1]);
  assert.equal(cfg.demonstracao, "vitrine");
  assert.equal(cfg.slug, "barbearia-exemplo");
  assert.equal(cfg.whatsapp, "5581999186042", "o WhatsApp da vitrine é o de vendas do Bio Site");
  assert.ok(cfg.icones && cfg.icones.i192, "tem o ícone do app");
  assert.match(html, /class="demo-faixa"/);
  assert.match(html, /if\(demo\)\{pilha=\[\];etapa="demo";render\(\);return\}/, "não chama a API de pedido");
  assert.match(html, /Esta é só uma demonstração: nada foi enviado\./);
  // Toda barbearia: o número cadastrado no painel troca os links do WhatsApp, sem republicar
  for (const site of ["barbearia-modelo.html", "gw-barbearia.html", "dom-manolo-barbearia.html"]) {
    const s = ler(site);
    assert.match(s, /function trocarWhats\(n\)/, site);
    assert.match(s, /if\(j&&j\.whatsapp\)trocarWhats\(j\.whatsapp\)/, site + ": ao carregar a equipe");
    assert.match(s, /if\(j\.whatsapp\)trocarWhats\(j\.whatsapp\)/, site + ": ao concluir o pedido");
    assert.ok(!s.includes('class="demo-faixa"'), site + " não é demonstração");
  }
  assert.ok(ler("barbearia-exemplo.webmanifest").includes('"start_url": "/barbearia-exemplo?app=1"'));
});

test("banco: a fase 25 só acrescenta e a renovação diária mexe só nas barbearias de demonstração", () => {
  const sql = ler("supabase/fase25-demonstracoes.sql").replace(/--.*$/gm, "").toLowerCase();
  assert.doesNotMatch(sql, /\bdrop\b|\btruncate\b|\bdelete from\b/, "nada é apagado");
  assert.match(sql, /add column if not exists whatsapp/);
  assert.match(sql, /add column if not exists demonstracao/);
  assert.match(sql, /security definer/);
  assert.match(sql, /revoke all on function public\.renovar_demonstracoes\(\) from public, anon, authenticated/);
  assert.match(sql, /for v_b in select id, slug from barbearias where demonstracao is not null loop/);
  for (const update of sql.match(/update [a-z_.]+ [^;]*;/g)) {
    if (update.startsWith("update set ")) continue; // "on conflict ... do update set" da própria tabela de controle
    if (/update public\.barbearias set demonstracao = 'apresentacao' where slug = 'barbearia-modelo'/.test(update)) continue;
    assert.match(update, /barbearia_id = v_b\.id/, "update fora de uma demonstração: " + update.slice(0, 80));
  }
  const seed = ler("supabase/demo-barbearia-exemplo.sql");
  assert.match(seed, /raise exception 'A Barbearia Exemplo já existe: nada foi feito\.'/);
  assert.match(seed, /'vitrine'\) returning id into v_b/);
});
