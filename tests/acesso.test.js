// Controle de acesso: toda rota privada exige login, e cada perfil só vê e mexe no que é dele
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("./ajuda");
const { UUIDS } = A;

const eu = require("../api/eu");
const equipe = require("../api/equipe");
const pedido = require("../api/pedido");
const barbearia = require("../api/barbearia");
const convite = require("../api/convite");
const config = require("../api/config");

test("rotas privadas sem login respondem 401", async () => {
  A.instalarFetch(A.rotasDeConta());
  const casos = [
    [eu, { metodo: "GET" }],
    [eu, { metodo: "GET", query: { agenda: "1" } }],
    [eu, { metodo: "POST", corpo: { acao: "agenda-semana-salvar", dias: [] } }],
    [equipe, { metodo: "GET" }],
    [equipe, { metodo: "POST", corpo: { acao: "convidar", email: "x@y.com" } }],
    [equipe, { metodo: "GET", query: { area: "financeiro" } }],
    [pedido, { metodo: "GET", query: { painel: "1" } }],
    [pedido, { metodo: "GET", query: { dia: A.hoje() } }],
    [pedido, { metodo: "PATCH", corpo: { id: UUIDS.pedido, status: "confirmado" } }],
    [pedido, { metodo: "POST", corpo: { acao: "cancelar", id: UUIDS.pedido } }],
    [pedido, { metodo: "POST", corpo: { acao: "remarcar", id: UUIDS.pedido } }],
    [barbearia, { metodo: "POST", corpo: { acao: "publicar" } }],
    [convite, { metodo: "POST", corpo: { token: "a".repeat(48) } }],
  ];
  for (const [h, o] of casos) {
    for (const token of [undefined, "token-invalido"]) {
      const r = await A.chamar(h, { ...o, token });
      assert.equal(r.statusCode, 401, `${o.metodo} ${JSON.stringify(o.query || o.corpo || {})} token=${token}`);
    }
  }
});

test("barbeiro não administra equipe, financeiro nem publica sites", async () => {
  A.instalarFetch(A.rotasDeConta());
  for (const [h, o] of [
    [equipe, { metodo: "GET" }],
    [equipe, { metodo: "POST", corpo: { acao: "convidar", email: "x@y.com" } }],
    [equipe, { metodo: "GET", query: { area: "financeiro" } }],
    [equipe, { metodo: "POST", corpo: { acao: "agenda-semana-salvar", profissionalId: UUIDS.rafael, dias: [] } }],
    [barbearia, { metodo: "POST", corpo: { acao: "publicar" } }],
  ]) {
    const r = await A.chamar(h, { ...o, token: "token-bruno" });
    assert.equal(r.statusCode, 403, JSON.stringify(o));
  }
});

test("barbeiro não mexe em pedido de outro barbeiro", async () => {
  const pedidoDoRafael = { id: UUIDS.pedido, status: "pendente", profissional_id: UUIDS.rafael, dia: A.daquiA(1), servico: "Corte", valor: 40, duracao_min: 30 };
  A.instalarFetch([...A.rotasDeConta(), { padrao: /\/rest\/v1\/pedidos\?id=eq\./, resposta: { corpo: [pedidoDoRafael] } }]);
  for (const o of [
    { metodo: "PATCH", corpo: { id: UUIDS.pedido, status: "confirmado" } },
    { metodo: "PATCH", corpo: { id: UUIDS.pedido, valor: "10,00" } },
    { metodo: "POST", corpo: { acao: "cancelar", id: UUIDS.pedido } },
    { metodo: "POST", corpo: { acao: "remarcar", id: UUIDS.pedido, dia: A.daquiA(2), horario: "10:00" } },
  ]) {
    const r = await A.chamar(pedido, { ...o, token: "token-bruno" });
    assert.equal(r.statusCode, 403, JSON.stringify(o));
  }
});

test("barbeiro só lista os próprios pedidos (filtro no banco)", async () => {
  const chamadas = A.instalarFetch([...A.rotasDeConta(), { padrao: /\/rest\/v1\/pedidos\?barbearia_id=eq\./, resposta: { corpo: [] } }]);
  const r = await A.chamar(pedido, { metodo: "GET", query: { dia: A.hoje() }, token: "token-bruno" });
  assert.equal(r.statusCode, 200);
  const consulta = chamadas.find((c) => c.url.includes("/rest/v1/pedidos?barbearia_id="));
  assert.ok(consulta.url.includes(`profissional_id=eq.${UUIDS.bruno}`), consulta.url);
  assert.ok(consulta.url.includes(`barbearia_id=eq.${UUIDS.barbearia}`));
});

test("dono não acessa outra barbearia pelo parâmetro ?barbearia (só a conta da plataforma)", async () => {
  const chamadas = A.instalarFetch([...A.rotasDeConta(), { padrao: /\/rest\/v1\/pedidos\?barbearia_id=eq\./, resposta: { corpo: [] } }]);
  await A.chamar(pedido, { metodo: "GET", query: { dia: A.hoje(), barbearia: UUIDS.outraBarbearia }, token: "token-dono" });
  const consulta = chamadas.find((c) => c.url.includes("/rest/v1/pedidos?barbearia_id="));
  assert.ok(consulta.url.includes(UUIDS.barbearia) && !consulta.url.includes(UUIDS.outraBarbearia), consulta.url);
});

test("conta da plataforma escolhe a barbearia", async () => {
  const chamadas = A.instalarFetch([...A.rotasDeConta(), { padrao: /\/rest\/v1\/pedidos\?barbearia_id=eq\./, resposta: { corpo: [] } }]);
  const r = await A.chamar(pedido, { metodo: "GET", query: { dia: A.hoje(), barbearia: UUIDS.outraBarbearia }, token: "token-admin" });
  assert.equal(r.statusCode, 200);
  assert.ok(chamadas.some((c) => c.url.includes(`barbearia_id=eq.${UUIDS.outraBarbearia}`)));
});

test("datas inválidas nas consultas do painel são recusadas antes do banco", async () => {
  const chamadas = A.instalarFetch(A.rotasDeConta());
  for (const dia of ["2026-02-30", "ontem", "2026-11-05&status=eq.realizado"]) {
    const r = await A.chamar(pedido, { metodo: "GET", query: { dia }, token: "token-dono" });
    assert.equal(r.statusCode, 400, dia);
  }
  assert.ok(!chamadas.some((c) => c.url.includes("/rest/v1/pedidos")), "não consulta pedidos com data inválida");
});

test("avisos no celular: só serviços de push conhecidos", async () => {
  A.instalarFetch([...A.rotasDeConta(), { padrao: /\/rest\/v1\/push_inscricoes/, resposta: { status: 201 } }]);
  const chave = "B".repeat(87);
  const bons = ["https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/abc", "https://web.push.apple.com/abc", "https://db5p.notify.windows.com/w/?token=abc"];
  const ruins = ["http://fcm.googleapis.com/x", "https://evil.example.com/x", "https://fcm.googleapis.com.evil.com/x", "javascript:alert(1)", "https://169.254.169.254/latest"];
  for (const endpoint of bons) {
    const r = await A.chamar(eu, { metodo: "POST", token: "token-dono", corpo: { acao: "inscrever-push", subscription: { endpoint, keys: { p256dh: chave, auth: "abcdefghijklmnop" } } } });
    assert.equal(r.statusCode, 200, endpoint);
  }
  for (const endpoint of ruins) {
    const r = await A.chamar(eu, { metodo: "POST", token: "token-dono", corpo: { acao: "inscrever-push", subscription: { endpoint, keys: { p256dh: chave, auth: "abcdefghijklmnop" } } } });
    assert.equal(r.statusCode, 400, endpoint);
  }
});

test("foto do barbeiro: só o arquivo que o servidor preparou para ele", async () => {
  const chamadas = A.instalarFetch([...A.rotasDeConta(), { padrao: /\/rest\/v1\/profissionais\?id=eq\./, metodo: "PATCH", resposta: { status: 204 } }]);
  const prefixo = `https://teste.supabase.co/storage/v1/object/public/midia/barbeiros/${UUIDS.barbearia}/${UUIDS.bruno}-`;
  const ruins = [prefixo + "../../outro.jpg", prefixo + "abc.jpg", "https://evil.example.com/a.jpg", prefixo + "0123456789ab.svg", prefixo + "0123456789ab.jpg?x=<script>"];
  for (const foto of ruins) {
    const r = await A.chamar(eu, { metodo: "POST", token: "token-bruno", corpo: { acao: "foto-propria-salvar", foto } });
    assert.equal(r.statusCode, 400, foto);
  }
  const ok = await A.chamar(eu, { metodo: "POST", token: "token-bruno", corpo: { acao: "foto-propria-salvar", foto: prefixo + "0123456789ab.jpg" } });
  assert.equal(ok.statusCode, 200);
  assert.ok(chamadas.some((c) => c.metodo === "PATCH" && c.url.includes(`profissionais?id=eq.${UUIDS.bruno}`)));
});

test("saúde: responde sem expor segredos; resumo só para a plataforma", async () => {
  A.instalarFetch([...A.rotasDeConta(), { padrao: /\/rest\/v1\/barbearias\?select=id&limit=1/, resposta: { corpo: [{ id: UUIDS.barbearia }] } }, { padrao: /rpc\/resumo_saude/, resposta: { corpo: { erros_servidor: 0 } } }]);
  let r = await A.chamar(config, { metodo: "GET", query: { saude: "1" } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.ok, true);
  const texto = JSON.stringify(r.body);
  for (const segredo of [process.env.SUPABASE_SERVICE_KEY, process.env.CRIADOR_SENHA, process.env.GITHUB_TOKEN]) assert.ok(!texto.includes(segredo));
  r = await A.chamar(config, { metodo: "GET", query: { saude: "1", resumo: "1" }, token: "token-dono" });
  assert.equal(r.statusCode, 403);
  r = await A.chamar(config, { metodo: "GET", query: { saude: "1", resumo: "1" }, token: "token-admin" });
  assert.equal(r.statusCode, 200);
  assert.ok(r.body.resumo);
});

test("saúde: banco fora do ar responde 503", async () => {
  A.instalarFetch([...A.rotasDeConta(), { padrao: /\/rest\/v1\/barbearias/, resposta: { status: 500, corpo: { message: "down" } } }]);
  const r = await A.chamar(config, { metodo: "GET", query: { saude: "1" } });
  assert.equal(r.statusCode, 503);
  assert.equal(r.body.ok, false);
});

test("telemetria do navegador: aceita só eventos conhecidos e corta tamanhos", async () => {
  const chamadas = A.instalarFetch(A.rotasDeConta());
  await A.chamar(config, { metodo: "POST", corpo: { tipo: "vital", nome: "LCP", valor: 1234, rota: "/gw-barbearia?x=1" } });
  await A.chamar(config, { metodo: "POST", corpo: { tipo: "vital", nome: "INVENTADO", valor: 1 } });
  await A.chamar(config, { metodo: "POST", corpo: { tipo: "erro", nome: "TypeError", detalhe: "x".repeat(5000), rota: "/painel-dono" } });
  const gravados = chamadas.filter((c) => c.url.endsWith("/rest/v1/telemetria") && c.metodo === "POST").map((c) => c.corpo);
  assert.equal(gravados.length, 2);
  assert.equal(gravados[0].nome, "LCP");
  assert.equal(gravados[0].rota, "/gw-barbearia", "tira a query string");
  assert.ok(gravados[1].detalhe.length <= 2000);
});
