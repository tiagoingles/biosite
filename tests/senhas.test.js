// Senha do Criador e códigos de acesso: força bruta, caminhos permitidos e histórico do GitHub protegido
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("./ajuda");
const criadorGh = require("../api/criador-gh");
const midia = require("../api/midia");
const S = require("../lib/seguranca");

function rotasGithub(tentativas = 0) {
  return [
    { padrao: /\/rest\/v1\/rpc\/contar_tentativa/, resposta: (u, o, corpo) => ({ corpo: corpo.p_registrar ? tentativas + 1 : tentativas }) },
    { padrao: /\/rest\/v1\/telemetria/, resposta: { status: 201 } },
    { padrao: /api\.github\.com\/repos\/teste\/biosite/, resposta: { corpo: { default_branch: "main" } } },
  ];
}

test("Criador: senha errada responde 401 e conta a tentativa", async () => {
  const chamadas = A.instalarFetch(rotasGithub(0));
  const r = await A.chamar(criadorGh, { metodo: "POST", corpo: { senha: "errada", caminho: "" }, headers: { "x-real-ip": "198.51.100.1" } });
  assert.equal(r.statusCode, 401);
  assert.ok(chamadas.some((c) => c.url.includes("contar_tentativa") && c.corpo.p_registrar === true));
  assert.ok(!chamadas.some((c) => c.url.includes("api.github.com")), "não chega ao GitHub");
});

test("Criador: depois de 10 erros na janela, bloqueia (até com a senha certa)", async () => {
  A.instalarFetch(rotasGithub(S.MAX_ERROS_SENHA));
  const r = await A.chamar(criadorGh, { metodo: "POST", corpo: { senha: process.env.CRIADOR_SENHA, caminho: "" }, headers: { "x-real-ip": "198.51.100.2" } });
  assert.equal(r.statusCode, 429);
});

test("Criador: senha certa passa e só caminhos do Criador são aceitos", async () => {
  const chamadas = A.instalarFetch(rotasGithub(0));
  const ok = await A.chamar(criadorGh, { metodo: "POST", corpo: { senha: process.env.CRIADOR_SENHA, caminho: "", metodo: "GET" }, headers: { "x-real-ip": "198.51.100.3" } });
  assert.equal(ok.statusCode, 200);
  assert.ok(chamadas.some((c) => c.url === "https://api.github.com/repos/teste/biosite"));
  for (const caminho of ["/actions/secrets", "/../users", "/contents/../../x", "/collaborators/x", "/hooks", "//contents/a", "/contents/a b"]) {
    const r = await A.chamar(criadorGh, { metodo: "POST", corpo: { senha: process.env.CRIADOR_SENHA, caminho }, headers: { "x-real-ip": "198.51.100.3" } });
    assert.equal(r.statusCode, 400, caminho);
  }
  const del = await A.chamar(criadorGh, { metodo: "POST", corpo: { senha: process.env.CRIADOR_SENHA, caminho: "/contents/a.html", metodo: "DELETE" }, headers: { "x-real-ip": "198.51.100.3" } });
  assert.equal(del.statusCode, 400, "DELETE não é permitido");
});

test("Criador: atualização forçada da branch é recusada", async () => {
  A.instalarFetch(rotasGithub(0));
  const r = await A.chamar(criadorGh, {
    metodo: "POST",
    corpo: { senha: process.env.CRIADOR_SENHA, caminho: "/git/refs/heads/main", metodo: "PATCH", corpo: JSON.stringify({ sha: "a".repeat(40), force: true }) },
    headers: { "x-real-ip": "198.51.100.4" },
  });
  assert.equal(r.statusCode, 400);
  assert.match(r.body.message, /forçada/);
});

test("mídia: senha, tipo e tamanho conferidos", async () => {
  A.instalarFetch([...rotasGithub(0), { padrao: /storage\/v1\/object\/upload\/sign\/midia\//, resposta: { corpo: { url: "/object/upload/sign/midia/x?token=t" } } }]);
  let r = await A.chamar(midia, { metodo: "POST", corpo: { senha: "errada" }, headers: { "x-real-ip": "198.51.100.5" } });
  assert.equal(r.statusCode, 401);
  const base = { senha: process.env.CRIADOR_SENHA, slug: "gw-teste", servico: "corte", tipo: "image/jpeg", tamanho: 1000 };
  for (const [mud, status] of [[{ tipo: "image/svg+xml" }, 400], [{ tipo: "text/html" }, 400], [{ tamanho: 6 * 1024 * 1024 }, 400], [{ slug: "../x" }, 400], [{ servico: "a/b" }, 400], [{}, 200]]) {
    r = await A.chamar(midia, { metodo: "POST", corpo: { ...base, ...mud }, headers: { "x-real-ip": "198.51.100.5" } });
    assert.equal(r.statusCode, status, JSON.stringify(mud));
  }
  assert.match(r.body.publicUrl, /^https:\/\/teste\.supabase\.co\/storage\/v1\/object\/public\/midia\/gw-teste\/corte\/[a-z0-9]+\.jpg$/);
});

test("comparação de segredo em tempo constante e origem sem IP", () => {
  assert.equal(S.segredoIgual("abc", "abc"), true);
  assert.equal(S.segredoIgual("abd", "abc"), false);
  assert.equal(S.segredoIgual("", ""), false, "segredo vazio nunca libera");
  assert.equal(S.segredoIgual("abc", ""), false);
  const o1 = S.origemDe(A.req({ headers: { "x-real-ip": "203.0.113.9" } }));
  const o2 = S.origemDe(A.req({ headers: { "x-real-ip": "203.0.113.10" } }));
  assert.match(o1, /^[0-9a-f]{32}$/);
  assert.notEqual(o1, o2);
  assert.ok(!o1.includes("203"));
  assert.equal(S.ipDe(A.req({ headers: { "x-real-ip": "", "x-forwarded-for": "1.2.3.4, 5.6.7.8" } })), "1.2.3.4");
});

test("corpo inválido não derruba a rota", () => {
  assert.deepEqual(S.corpoDe({ body: "{nao é json" }), {});
  assert.deepEqual(S.corpoDe({ body: [1, 2] }), {});
  assert.deepEqual(S.corpoDe({ body: '{"a":1}' }), { a: 1 });
  assert.deepEqual(S.corpoDe({}), {});
});
