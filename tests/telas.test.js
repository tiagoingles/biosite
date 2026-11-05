// Telas e equipe: cada conta cai direto no seu painel, nada de "em breve" na tela,
// abas dos painéis completas, link pessoal do barbeiro e gestão da equipe pelo dono.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const A = require("./ajuda");
const { UUIDS } = A;
const equipe = require("../api/equipe");
const G = require("../lib/gerador");

const raiz = path.join(__dirname, "..");
const ler = (p) => fs.readFileSync(path.join(raiz, p), "utf8");

test("nenhuma tela mostra módulo 'em breve' ou fase de projeto", () => {
  const paginas = fs.readdirSync(raiz).filter((f) => f.endsWith(".html") && !f.includes("-avaliar"));
  for (const p of paginas) {
    const html = ler(p);
    assert.doesNotMatch(html, /Fase \d|em-breve|Em breve/i, `${p} mostra conteúdo provisório`);
  }
});

test("depois do login, cada conta vai direto para o seu painel", () => {
  const app = ler("app.html");
  assert.match(ler("entrar.html"), /return "app\.html"/, "o login passa pela porta de entrada");
  assert.match(app, /papel === "barbeiro" \? "painel-barbeiro\.html" : "painel-dono\.html"/, "barbeiro e dono vão para os seus painéis");
  assert.match(app, /if \(d\.perfil\) \{ location\.replace\(destino\(d\)\)/, "quem tem barbearia é redirecionado na hora");
  assert.doesNotMatch(app, /\/api\/pedido/, "a porta de entrada não tem mais a agenda antiga");
  assert.doesNotMatch(app, /formConvite|listaConvites/, "convites ficam no painel do dono");
});

test("painel do dono gerencia a equipe sem voltar para a página antiga", () => {
  const dono = ler("painel-dono.html");
  assert.doesNotMatch(dono, /href="app\.html"|link\("app\.html"\)/, "nenhum link do painel do dono leva para app.html");
  for (const acao of ["convidar", "cancelar-convite", "remover", "foto-link", "foto-salvar", "foto-remover", "virar-barbeiro"]) {
    assert.ok(dono.includes(`acao: "${acao}"`), `painel do dono faz "${acao}"`);
  }
});

test("painéis: toda aba tem a sua tela", () => {
  for (const p of ["painel-dono.html", "painel-barbeiro.html"]) {
    const html = ler(p);
    const abas = [...html.matchAll(/data-aba="([a-z]+)"/g)].map((m) => m[1]);
    const telas = [...html.matchAll(/data-tela="([a-z]+)"/g)].map((m) => m[1]);
    assert.ok(abas.length >= 4, `${p}: abas`);
    for (const a of abas) assert.ok(telas.includes(a), `${p}: aba ${a} sem tela`);
  }
  const barbeiro = ler("painel-barbeiro.html");
  assert.deepEqual([...barbeiro.matchAll(/data-aba="([a-z]+)"/g)].map((m) => m[1]), ["hoje", "agenda", "horarios", "mais"], "mesma estrutura do painel do dono");
  assert.match(barbeiro, /"\?barbeiro=" \+ encodeURIComponent\(d\.profissional\.id\)/, "barbeiro tem link pessoal de agendamento");
});

test("site gerado abre o agendamento com o barbeiro do link (?barbeiro=)", () => {
  const html = ler("gw-barbearia.html");
  assert.ok(G.VERSAO >= 4, "versão do gerador sobe quando o site muda");
  assert.match(html, /get\("barbeiro"\)/, "lê o barbeiro do endereço");
  assert.match(html, /if\(id&&porId\(equipe\|\|\[\],id\)\)abrirBarbeiro\(id\)/, "só abre se o barbeiro existir na equipe");
});

test("site sem cadastro no sistema (só o site) manda o pedido direto pelo WhatsApp", () => {
  for (const arq of ["gw-barbearia.html", "jm-barbearia.html"]) {
    const html = ler(arq);
    assert.match(html, /if\(r\.status===404\)semCadastro=true/, `${arq}: percebe barbearia sem cadastro`);
    assert.match(html, /if\(semCadastro\)\{concluir\(nome,obs,\{\}\);return\}/, `${arq}: não tenta registrar nem mostra erro`);
    assert.match(html, /Seu pedido não foi registrado/, `${arq}: com cadastro, falha continua avisando`);
  }
});

// ---------- API da equipe ----------
function rotasEquipe(gravados) {
  return [
    // Apagar perfil vem antes das rotas de conta (que respondem a leitura de perfis)
    { metodo: "DELETE", padrao: /\/rest\/v1\/perfis\?/, resposta: (url, op) => { gravados.push({ url, metodo: op.method }); return { status: 204 }; } },
    ...A.rotasDeConta(),
    { metodo: "GET", padrao: /\/rest\/v1\/profissionais\?barbearia_id=eq\./, resposta: { corpo: [
      { id: UUIDS.bruno, nome: "Bruno", ativo: true, perfil_user_id: UUIDS.brunoUser, foto_url: null, comissao_pct: 40 },
      { id: UUIDS.rafael, nome: "Rafael", ativo: true, perfil_user_id: null, foto_url: null, comissao_pct: null },
    ] } },
    { metodo: "GET", padrao: /\/rest\/v1\/convites\?barbearia_id=eq\./, resposta: { corpo: [{ id: "c1", email: "lucas@exemplo.com", token: "t".repeat(48), expira_em: new Date(Date.now() + 864e5).toISOString() }] } },
    { metodo: "GET", padrao: /\/rest\/v1\/pedidos\?barbearia_id=eq\..*status=eq\.realizado/, resposta: { corpo: [
      { profissional_id: UUIDS.bruno, servico: "Corte", dia: A.hoje() },
      { profissional_id: UUIDS.bruno, servico: "Corte", dia: A.daquiA(-10) },
      { profissional_id: UUIDS.bruno, servico: "Barba", dia: A.daquiA(-45) },
      { profissional_id: UUIDS.bruno, servico: "Corte", dia: A.daquiA(2) },
    ] } },
    {
      padrao: /\/rest\/v1\/profissionais\?id=eq\./,
      resposta: (url, op, corpo) => {
        if ((op.method || "GET") !== "GET") { gravados.push({ url, metodo: op.method, corpo }); return { status: 204 }; }
        if (url.includes(UUIDS.bruno) && url.includes(UUIDS.barbearia)) return { corpo: [{ id: UUIDS.bruno, nome: "Bruno", perfil_user_id: UUIDS.brunoUser }] };
        if (url.includes(UUIDS.rafael) && url.includes(UUIDS.barbearia)) return { corpo: [{ id: UUIDS.rafael, nome: "Rafael", perfil_user_id: null }] };
        return { corpo: [] };
      },
    },
    { padrao: /\/rest\/v1\/convites/, resposta: (url, op, corpo) => { gravados.push({ url, metodo: op.method, corpo }); return { status: 201 }; } },
  ];
}

test("equipe: lista com atendimentos de 30 dias por barbeiro e convites com link", async () => {
  A.instalarFetch(rotasEquipe([]));
  const r = await A.chamar(equipe, { metodo: "GET", token: "token-dono" });
  assert.equal(r.statusCode, 200);
  const bruno = r.body.profissionais.find((p) => p.id === UUIDS.bruno);
  assert.equal(bruno.atendimentos.total, 3, "não conta atendimento de dia futuro");
  assert.equal(bruno.atendimentos.ultimos30, 2);
  assert.deepEqual(bruno.atendimentos.servicos[0], { nome: "Corte", quantidade: 2 });
  assert.match(r.body.convites[0].link, /^https:\/\/biosite\.teste\/entrar\.html\?convite=t{48}$/);
  assert.ok(!("token" in r.body.convites[0]), "o token só sai dentro do link");
});

test("equipe: convite exige e-mail válido e fica preso à barbearia do dono", async () => {
  const gravados = [];
  A.instalarFetch(rotasEquipe(gravados));
  let r = await A.chamar(equipe, { metodo: "POST", corpo: { acao: "convidar", email: "sem-arroba" }, token: "token-dono" });
  assert.equal(r.statusCode, 400);
  r = await A.chamar(equipe, { metodo: "POST", corpo: { acao: "convidar", email: "  Lucas@Exemplo.com " }, token: "token-dono" });
  assert.equal(r.statusCode, 201);
  const conv = gravados.find((g) => g.url.includes("/rest/v1/convites") && g.metodo === "POST");
  assert.equal(conv.corpo.barbearia_id, UUIDS.barbearia);
  assert.equal(conv.corpo.email, "lucas@exemplo.com");
  assert.ok(new Date(conv.corpo.expira_em) > new Date(Date.now() + 6.9 * 864e5), "vale 7 dias");
  assert.ok(r.body.link.endsWith(conv.corpo.token));
  // cancelar só apaga convite desta barbearia
  r = await A.chamar(equipe, { metodo: "POST", corpo: { acao: "cancelar-convite", id: UUIDS.pedido }, token: "token-dono" });
  assert.equal(r.statusCode, 200);
  const del = gravados.find((g) => g.metodo === "DELETE" && g.url.includes("/rest/v1/convites"));
  assert.match(del.url, new RegExp(`id=eq\\.${UUIDS.pedido}&barbearia_id=eq\\.${UUIDS.barbearia}`));
  r = await A.chamar(equipe, { metodo: "POST", corpo: { acao: "cancelar-convite", id: "1 or 1=1" }, token: "token-dono" });
  assert.equal(r.statusCode, 400);
});

test("equipe: remover barbeiro tira o perfil de barbeiro, nunca o do dono", async () => {
  const gravados = [];
  A.instalarFetch(rotasEquipe(gravados));
  let r = await A.chamar(equipe, { metodo: "POST", corpo: { acao: "remover", profissionalId: UUIDS.bruno }, token: "token-dono" });
  assert.equal(r.statusCode, 200);
  assert.ok(gravados.some((g) => g.metodo === "DELETE" && g.url.includes(`profissionais?id=eq.${UUIDS.bruno}&barbearia_id=eq.${UUIDS.barbearia}`)));
  const perfil = gravados.find((g) => g.metodo === "DELETE" && g.url.includes("/rest/v1/perfis"));
  assert.match(perfil.url, /papel=eq\.barbeiro/, "só apaga perfil de barbeiro");
  // barbeiro de outra barbearia: não encontrado
  r = await A.chamar(equipe, { metodo: "POST", corpo: { acao: "remover", profissionalId: UUIDS.estranho }, token: "token-dono" });
  assert.equal(r.statusCode, 404);
});
