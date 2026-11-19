// Convite que cria a conta já confirmada (sem o e-mail do Supabase) e link de nova senha pelo WhatsApp
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("./ajuda");
const convite = require("../api/convite");
const equipe = require("../api/equipe");
const barbearia = require("../api/barbearia");

const TOKEN = "ab".repeat(24);
const CONVITE_ID = "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0";
const NOVO_ID = "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1";
const ANTIGO_ID = "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2";
const FICHA_ID = "f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3";

// Banco falso do convite. opcoes: papel, conta (resposta de conta_por_email), reservado, falharPerfil, tentativas,
// ficha (o convite é para uma ficha que já está na equipe) e fichaTomada (essa ficha já ganhou login).
// As rotas do teste vêm antes das padrão (a primeira que casa responde).
function rotasConvite(o = {}) {
  return [
    { padrao: /\/rest\/v1\/rpc\/contar_tentativa/, resposta: (u, op, corpo) => ({ corpo: (o.tentativas || 0) + (corpo.p_registrar ? 1 : 0) }) },
    {
      metodo: "GET",
      padrao: /\/rest\/v1\/convites\?token=eq\./,
      resposta: (url) => ({ corpo: url.includes(TOKEN) ? [{ id: CONVITE_ID, barbearia_id: A.UUIDS.barbearia, email: "novo@exemplo.com", expira_em: new Date(Date.now() + 864e5).toISOString(), papel: o.papel || null, profissional_id: o.ficha || null }] : [] }),
    },
    { metodo: "PATCH", padrao: /\/rest\/v1\/profissionais\?id=eq\./, resposta: { corpo: o.fichaTomada ? [] : [{ id: FICHA_ID, nome: "Cleyton Santos" }] } },
    { metodo: "GET", padrao: /\/rest\/v1\/profissionais\?id=eq\./, resposta: { corpo: o.fichaTomada ? [] : [{ nome: "Cleyton Santos" }] } },
    { metodo: "PATCH", padrao: /\/rest\/v1\/convites\?id=eq\.[^&]+&aceito_em=is\.null/, resposta: { corpo: o.reservado ? [] : [{ id: CONVITE_ID }] } },
    { metodo: "PATCH", padrao: /\/rest\/v1\/convites\?id=eq\./, resposta: { status: 204 } },
    { padrao: /\/rest\/v1\/barbearias\?id=eq\./, resposta: { corpo: [{ id: A.UUIDS.barbearia, slug: "gw-barbearia", nome: "GW Barbearia" }] } },
    { padrao: /\/rest\/v1\/rpc\/conta_por_email/, resposta: { corpo: o.conta ? [o.conta] : [] } },
    { metodo: "POST", padrao: /\/rest\/v1\/perfis/, resposta: o.falharPerfil ? { status: 500, corpo: { message: "falhou" } } : { status: 201 } },
    { metodo: "DELETE", padrao: /\/rest\/v1\/perfis/, resposta: { status: 204 } },
    { metodo: "POST", padrao: /\/rest\/v1\/profissionais/, resposta: { status: 201 } },
    { metodo: "POST", padrao: /\/auth\/v1\/admin\/users$/, resposta: { corpo: { id: NOVO_ID, email: "novo@exemplo.com" } } },
    { metodo: "PUT", padrao: /\/auth\/v1\/admin\/users\//, resposta: { corpo: { id: ANTIGO_ID } } },
    { metodo: "DELETE", padrao: /\/auth\/v1\/admin\/users\//, resposta: { corpo: {} } },
    ...A.rotasDeConta(),
  ];
}
const criar = (corpo, headers) => A.chamar(convite, { metodo: "POST", corpo: { token: TOKEN, nome: "Rafael Souza", senha: "corte2026", ...corpo }, headers });
const admin = (chamadas) => chamadas.filter((c) => c.url.includes("/auth/v1/admin/"));

test("convite: a página sabe se o e-mail convidado já tem conta", async () => {
  A.instalarFetch(rotasConvite());
  let r = await A.chamar(convite, { query: { token: TOKEN } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body, { barbearia: "GW Barbearia", email: "novo@exemplo.com", papel: "barbeiro", temConta: false, ficha: null });
  A.instalarFetch(rotasConvite({ conta: { id: ANTIGO_ID, confirmado: true }, papel: "dono" }));
  r = await A.chamar(convite, { query: { token: TOKEN } });
  assert.equal(r.body.temConta, true);
  assert.equal(r.body.papel, "dono");
  A.instalarFetch(rotasConvite({ conta: { id: ANTIGO_ID, confirmado: false } }));
  r = await A.chamar(convite, { query: { token: TOKEN } });
  assert.equal(r.body.temConta, false, "cadastro nunca confirmado conta como sem conta");
});

test("convite sem login cria a conta já confirmada e coloca o barbeiro na equipe", async () => {
  const chamadas = A.instalarFetch(rotasConvite());
  const r = await criar();
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body, { barbearia: "GW Barbearia", email: "novo@exemplo.com" });
  const novo = chamadas.find((c) => c.metodo === "POST" && /\/auth\/v1\/admin\/users$/.test(c.url));
  assert.deepEqual(novo.corpo, { email: "novo@exemplo.com", password: "corte2026", email_confirm: true, user_metadata: { full_name: "Rafael Souza" } });
  const perfil = chamadas.find((c) => c.metodo === "POST" && c.url.includes("/rest/v1/perfis"));
  assert.deepEqual(perfil.corpo, { user_id: NOVO_ID, barbearia_id: A.UUIDS.barbearia, papel: "barbeiro", nome: "Rafael Souza" });
  assert.ok(chamadas.some((c) => c.metodo === "POST" && c.url.includes("/rest/v1/profissionais") && c.corpo.perfil_user_id === NOVO_ID));
  assert.ok(chamadas.some((c) => c.metodo === "PATCH" && /aceito_em=is\.null/.test(c.url)), "o convite é reservado antes");
});

test("convite de dono cria só o perfil de dono (sem entrar na agenda)", async () => {
  const chamadas = A.instalarFetch(rotasConvite({ papel: "dono" }));
  const r = await criar();
  assert.equal(r.statusCode, 201);
  assert.equal(chamadas.find((c) => c.metodo === "POST" && c.url.includes("/rest/v1/perfis")).corpo.papel, "dono");
  assert.ok(!chamadas.some((c) => c.metodo === "POST" && c.url.includes("/rest/v1/profissionais")));
});

test("conta confirmada que já existe nunca tem a senha trocada pelo convite", async () => {
  const chamadas = A.instalarFetch(rotasConvite({ conta: { id: ANTIGO_ID, confirmado: true } }));
  const r = await criar();
  assert.equal(r.statusCode, 409);
  assert.equal(r.body.temConta, true);
  assert.equal(admin(chamadas).length, 0, "nenhuma chamada de administração da autenticação");
  assert.ok(!chamadas.some((c) => c.metodo === "PATCH"), "o convite continua livre para ela entrar e aceitar");
});

test("cadastro antigo que nunca foi confirmado (o e-mail não chegou) é concluído com a senha nova", async () => {
  const chamadas = A.instalarFetch(rotasConvite({ conta: { id: ANTIGO_ID, confirmado: false } }));
  const r = await criar();
  assert.equal(r.statusCode, 201);
  const put = chamadas.find((c) => c.metodo === "PUT" && c.url.endsWith("/auth/v1/admin/users/" + ANTIGO_ID));
  assert.equal(put.corpo.email_confirm, true);
  assert.equal(put.corpo.password, "corte2026");
  assert.ok(!chamadas.some((c) => c.metodo === "POST" && /\/auth\/v1\/admin\/users$/.test(c.url)), "não cria outra conta");
});

test("sem nome ou com senha fraca não cria nada nem gasta o convite", async () => {
  for (const corpo of [{ nome: "" }, { senha: "curta1" }, { senha: "semnumeros" }, { senha: "12345678" }]) {
    const chamadas = A.instalarFetch(rotasConvite());
    const r = await criar(corpo);
    assert.equal(r.statusCode, 400, JSON.stringify(corpo));
    assert.equal(admin(chamadas).length, 0);
    assert.ok(!chamadas.some((c) => c.metodo === "PATCH"));
  }
});

test("convite inválido conta tentativa e, depois de 20 erros na hora, bloqueia", async () => {
  let chamadas = A.instalarFetch(rotasConvite());
  let r = await criar({ token: "ff".repeat(24) });
  assert.equal(r.statusCode, 404);
  assert.ok(chamadas.some((c) => c.url.includes("contar_tentativa") && c.corpo.p_registrar === true));
  chamadas = A.instalarFetch(rotasConvite({ tentativas: 20 }));
  r = await criar();
  assert.equal(r.statusCode, 429);
  assert.equal(admin(chamadas).length, 0);
});

test("dois toques ao mesmo tempo: quem chega depois não cria outra conta", async () => {
  const chamadas = A.instalarFetch(rotasConvite({ reservado: true }));
  const r = await criar();
  assert.equal(r.statusCode, 409);
  assert.equal(admin(chamadas).length, 0);
});

test("se der erro ao ligar a conta à barbearia, a conta nova é apagada e o convite volta a valer", async () => {
  const chamadas = A.instalarFetch(rotasConvite({ falharPerfil: true }));
  const r = await criar();
  assert.equal(r.statusCode, 500);
  assert.ok(chamadas.some((c) => c.metodo === "DELETE" && c.url.endsWith("/auth/v1/admin/users/" + NOVO_ID)), "apaga a conta criada");
  assert.ok(chamadas.some((c) => c.metodo === "PATCH" && !/aceito_em=is\.null/.test(c.url) && c.corpo.aceito_em === null), "libera o convite");
});

test("convite sem senha e sem login continua pedindo para entrar; logado, aceita como antes", async () => {
  A.instalarFetch(rotasConvite());
  let r = await A.chamar(convite, { metodo: "POST", corpo: { token: TOKEN } });
  assert.equal(r.statusCode, 401);
  const chamadas = A.instalarFetch(rotasConvite());
  r = await A.chamar(convite, { metodo: "POST", corpo: { token: TOKEN }, token: "token-sem-perfil" });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.ok(chamadas.some((c) => c.metodo === "POST" && c.url.includes("/rest/v1/perfis")));
  assert.equal(admin(chamadas).length, 0, "logado não mexe na conta");
});

// ---------- link de nova senha ----------
function rotasLink() {
  return [
    {
      padrao: /\/rest\/v1\/profissionais\?id=eq\./,
      resposta: (url) => {
        if (url.includes(A.UUIDS.bruno) && url.includes(A.UUIDS.barbearia)) return { corpo: [{ id: A.UUIDS.bruno, nome: "Bruno Lima", perfil_user_id: A.UUIDS.brunoUser }] };
        if (url.includes(A.UUIDS.rafael) && url.includes(A.UUIDS.barbearia)) return { corpo: [{ id: A.UUIDS.rafael, nome: "Rafael", perfil_user_id: null }] };
        return { corpo: [] };
      },
    },
    { padrao: /\/rest\/v1\/barbearias\?slug=eq\.gw-barbearia/, resposta: { corpo: [{ id: A.UUIDS.barbearia }] } },
    { padrao: /\/rest\/v1\/perfis\?user_id=eq\.[^&]+&barbearia_id=eq\./, resposta: (url) => ({ corpo: url.includes(A.UUIDS.donoUser) ? [{ nome: "Dono" }] : [] }) },
    { metodo: "GET", padrao: /\/auth\/v1\/admin\/users\//, resposta: (url) => ({ corpo: { id: url.split("/").pop(), email: "pessoa@exemplo.com" } }) },
    { metodo: "POST", padrao: /\/auth\/v1\/admin\/generate_link/, resposta: { corpo: { action_link: "https://teste.supabase.co/auth/v1/verify?token=abc&type=recovery" } } },
    ...A.rotasDeConta(),
  ];
}

test("dono gera o link de nova senha de um barbeiro da equipe (sem e-mail)", async () => {
  const chamadas = A.instalarFetch(rotasLink());
  const r = await A.chamar(equipe, { metodo: "POST", token: "token-dono", corpo: { acao: "link-senha", profissionalId: A.UUIDS.bruno } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.link, "https://teste.supabase.co/auth/v1/verify?token=abc&type=recovery");
  const g = chamadas.find((c) => c.url.includes("/auth/v1/admin/generate_link"));
  assert.deepEqual(g.corpo, { type: "recovery", email: "pessoa@exemplo.com", redirect_to: "https://biosite.teste/redefinir.html" });
});

test("link de nova senha: barbeiro não gera, barbeiro sem login e de outra barbearia não têm", async () => {
  A.instalarFetch(rotasLink());
  let r = await A.chamar(equipe, { metodo: "POST", token: "token-bruno", corpo: { acao: "link-senha", profissionalId: A.UUIDS.bruno } });
  assert.equal(r.statusCode, 403);
  r = await A.chamar(equipe, { metodo: "POST", token: "token-dono", corpo: { acao: "link-senha", profissionalId: A.UUIDS.rafael } });
  assert.equal(r.statusCode, 409);
  r = await A.chamar(equipe, { metodo: "POST", token: "token-dono", corpo: { acao: "link-senha", profissionalId: A.UUIDS.estranho } });
  assert.equal(r.statusCode, 404);
});

test("admin gera o link de nova senha do dono, só para conta ligada ao site", async () => {
  const chamadas = A.instalarFetch(rotasLink());
  let r = await A.chamar(barbearia, { metodo: "POST", token: "token-admin", corpo: { acao: "link-senha", slug: "gw-barbearia", userId: A.UUIDS.donoUser } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.ok(r.body.link.includes("type=recovery"));
  assert.ok(chamadas.some((c) => c.url.includes("generate_link")));
  r = await A.chamar(barbearia, { metodo: "POST", token: "token-admin", corpo: { acao: "link-senha", slug: "gw-barbearia", userId: A.UUIDS.estranho } });
  assert.equal(r.statusCode, 404);
  r = await A.chamar(barbearia, { metodo: "POST", token: "token-dono", corpo: { acao: "link-senha", slug: "gw-barbearia", userId: A.UUIDS.donoUser } });
  assert.equal(r.statusCode, 403, "dono não usa a ação do admin");
});

// ---------- convite ligado a uma ficha que já está na equipe (barbearia migrada, fase 27) ----------
test("convite com ficha: a página mostra a ficha, e a conta assume a ficha (com a agenda) em vez de criar outra", async () => {
  A.instalarFetch(rotasConvite({ ficha: FICHA_ID }));
  let r = await A.chamar(convite, { query: { token: TOKEN } });
  assert.equal(r.body.ficha, "Cleyton Santos");
  const chamadas = A.instalarFetch(rotasConvite({ ficha: FICHA_ID }));
  r = await criar();
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.equal(chamadas.find((c) => c.metodo === "POST" && c.url.includes("/rest/v1/perfis")).corpo.papel, "barbeiro");
  const assumiu = chamadas.find((c) => c.metodo === "PATCH" && c.url.includes("/rest/v1/profissionais?id=eq." + FICHA_ID));
  assert.ok(assumiu, "a ficha é assumida");
  assert.match(assumiu.url, /barbearia_id=eq\.[^&]+&perfil_user_id=is\.null/, "só ficha desta barbearia e ainda sem login");
  assert.deepEqual(assumiu.corpo, { perfil_user_id: NOVO_ID });
  assert.ok(!chamadas.some((c) => c.metodo === "POST" && c.url.includes("/rest/v1/profissionais")), "não cria outra ficha");
});

test("convite de dono com ficha: o dono que também atende entra como dono-barbeiro na ficha dele", async () => {
  const chamadas = A.instalarFetch(rotasConvite({ papel: "dono", ficha: FICHA_ID }));
  const r = await criar();
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.equal(chamadas.find((c) => c.metodo === "POST" && c.url.includes("/rest/v1/perfis")).corpo.papel, "dono_barbeiro");
  assert.ok(chamadas.some((c) => c.metodo === "PATCH" && c.url.includes("/rest/v1/profissionais?id=eq." + FICHA_ID)));
  assert.ok(!chamadas.some((c) => c.metodo === "POST" && c.url.includes("/rest/v1/profissionais")));
});

test("convite com ficha que já ganhou login: nada fica pela metade e a pessoa pede outro convite", async () => {
  const chamadas = A.instalarFetch(rotasConvite({ ficha: FICHA_ID, fichaTomada: true }));
  const r = await criar();
  assert.equal(r.statusCode, 409);
  assert.match(r.body.message, /já está ligada a outra conta/);
  assert.ok(chamadas.some((c) => c.metodo === "DELETE" && c.url.includes("/rest/v1/perfis")), "o perfil sai");
  assert.ok(chamadas.some((c) => c.metodo === "DELETE" && c.url.includes("/auth/v1/admin/users/" + NOVO_ID)), "a conta nova é apagada");
  assert.ok(chamadas.some((c) => c.metodo === "PATCH" && /convites\?id=eq\.[^&]+$/.test(c.url) && c.corpo.aceito_em === null), "o convite volta a valer");
});

test("dono convida pela ficha de quem está na equipe sem login; quem já tem login ou é de outra barbearia, não", async () => {
  const chamadas = A.instalarFetch([
    { metodo: "DELETE", padrao: /\/rest\/v1\/convites\?profissional_id=eq\./, resposta: { status: 204 } },
    { metodo: "POST", padrao: /\/rest\/v1\/convites$/, resposta: { status: 201 } },
    ...rotasLink(),
  ]);
  const postsConvite = () => chamadas.filter((c) => c.metodo === "POST" && /\/rest\/v1\/convites$/.test(c.url));
  let r = await A.chamar(equipe, { metodo: "POST", token: "token-dono", corpo: { acao: "convidar", email: "Rafa@Exemplo.com", profissionalId: A.UUIDS.rafael } });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.equal(r.body.ficha, "Rafael");
  assert.equal(postsConvite()[0].corpo.profissional_id, A.UUIDS.rafael);
  assert.equal(postsConvite()[0].corpo.email, "rafa@exemplo.com");
  assert.ok(chamadas.some((c) => c.metodo === "DELETE" && c.url.includes("convites?profissional_id=eq." + A.UUIDS.rafael) && c.url.includes("aceito_em=is.null")), "o convite novo substitui o anterior da ficha");
  r = await A.chamar(equipe, { metodo: "POST", token: "token-dono", corpo: { acao: "convidar", email: "bruno@exemplo.com", profissionalId: A.UUIDS.bruno } });
  assert.equal(r.statusCode, 409, "quem já tem login não recebe convite pela ficha");
  r = await A.chamar(equipe, { metodo: "POST", token: "token-dono", corpo: { acao: "convidar", email: "x@exemplo.com", profissionalId: A.UUIDS.estranho } });
  assert.equal(r.statusCode, 404);
  r = await A.chamar(equipe, { metodo: "POST", token: "token-dono", corpo: { acao: "convidar", email: "novo@exemplo.com" } });
  assert.equal(r.statusCode, 201, "sem ficha, como antes");
  assert.equal(postsConvite().pop().corpo.profissional_id, null);
});

test("admin convida o dono de um site no ar; se ele também atende, pela ficha dele", async () => {
  const chamadas = A.instalarFetch([
    { metodo: "DELETE", padrao: /\/rest\/v1\/convites\?profissional_id=eq\./, resposta: { status: 204 } },
    { metodo: "POST", padrao: /\/rest\/v1\/convites$/, resposta: { status: 201 } },
    { padrao: /\/rest\/v1\/barbearias\?slug=eq\.gw-barbearia&select=id,nome/, resposta: { corpo: [{ id: A.UUIDS.barbearia, nome: "GW Barbearia" }] } },
    ...rotasLink(),
  ]);
  let r = await A.chamar(barbearia, { metodo: "POST", token: "token-admin", corpo: { acao: "convite-dono", slug: "gw-barbearia", email: "Dono@Exemplo.com", profissionalId: A.UUIDS.rafael } });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.equal(r.body.ficha, "Rafael");
  assert.equal(r.body.email, "dono@exemplo.com");
  assert.match(r.body.link, /\/entrar\.html\?convite=[0-9a-f]{48}$/);
  const ins = chamadas.find((c) => c.metodo === "POST" && /\/rest\/v1\/convites$/.test(c.url));
  assert.equal(ins.corpo.papel, "dono");
  assert.equal(ins.corpo.profissional_id, A.UUIDS.rafael);
  r = await A.chamar(barbearia, { metodo: "POST", token: "token-admin", corpo: { acao: "convite-dono", slug: "gw-barbearia", email: "sem-arroba" } });
  assert.equal(r.statusCode, 400);
  r = await A.chamar(barbearia, { metodo: "POST", token: "token-admin", corpo: { acao: "convite-dono", slug: "gw-barbearia", email: "dono@exemplo.com", profissionalId: A.UUIDS.bruno } });
  assert.equal(r.statusCode, 409, "ficha que já tem login");
  r = await A.chamar(barbearia, { metodo: "POST", token: "token-dono", corpo: { acao: "convite-dono", slug: "gw-barbearia", email: "dono@exemplo.com" } });
  assert.equal(r.statusCode, 403, "só a conta da plataforma");
});

test("dono que também atende assume a ficha dele que já está na equipe, sem criar outra", async () => {
  const eu = require("../api/eu");
  const chamadas = A.instalarFetch([
    { metodo: "PATCH", padrao: /\/rest\/v1\/profissionais\?id=eq\./, resposta: (url) => ({ corpo: url.includes(A.UUIDS.rafael) ? [{ id: A.UUIDS.rafael, nome: "Rafael" }] : [] }) },
    { metodo: "PATCH", padrao: /\/rest\/v1\/perfis\?user_id=eq\./, resposta: { status: 204 } },
    ...A.rotasDeConta(),
  ]);
  let r = await A.chamar(eu, { metodo: "POST", token: "token-dono", corpo: { acao: "virar-barbeiro", profissionalId: A.UUIDS.rafael } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.ficha, "Rafael");
  const assumiu = chamadas.find((c) => c.metodo === "PATCH" && c.url.includes("/rest/v1/profissionais?id=eq." + A.UUIDS.rafael));
  assert.match(assumiu.url, /perfil_user_id=is\.null/);
  assert.ok(assumiu.corpo.perfil_user_id);
  assert.equal(chamadas.find((c) => c.metodo === "PATCH" && c.url.includes("/rest/v1/perfis?user_id=eq.")).corpo.papel, "dono_barbeiro");
  assert.ok(!chamadas.some((c) => c.metodo === "POST" && c.url.includes("/rest/v1/profissionais")));
  r = await A.chamar(eu, { metodo: "POST", token: "token-dono", corpo: { acao: "virar-barbeiro", profissionalId: A.UUIDS.estranho } });
  assert.equal(r.statusCode, 409, "ficha que já tem login ou de outra barbearia");
});

test("telas: convite pela ficha no perfil do barbeiro, dono escolhe a ficha ao atender, /app convida o dono e o convite mostra a ficha", () => {
  const fs = require("fs");
  const path = require("path");
  const ler = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const dono = ler("painel-dono.html");
  assert.match(dono, /!m\.temLogin && !m\.souEu \? acessoPainel\(m\) : null/);
  assert.match(dono, /acao: "convidar", email: e, profissionalId: m\.id/);
  assert.match(dono, /titulo: "Você já está na equipe\?"/);
  assert.match(dono, /corpo\.profissionalId = escolha/);
  const app = ler("app.html");
  assert.match(app, /if \(!\(b\.donos \|\| \[\]\)\.length\) acoes\.push/, "o botão aparece enquanto o site não tem dono com login");
  assert.match(app, /acao: "convite-dono", slug: b\.slug/);
  assert.match(ler("entrar.html"), /Você entra na ficha de/);
});
