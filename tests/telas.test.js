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

test("login: o botão do Google só aparece quando o Google está ativado no Supabase", async () => {
  const entrar = ler("entrar.html");
  assert.match(entrar, /<button type="button" id="google" hidden>/, "o botão começa escondido");
  assert.match(entrar, /Conta\.provedores\(\)\.then\(function \(p\) \{ if \(p\.google === true\) \$\("google"\)\.hidden = false; \}\)/, "só aparece com o Google ativado");

  const vm = require("vm");
  async function provedoresCom(respostaDoSupabase) {
    const chamadas = [];
    const ctx = {
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      fetch: async (url, opcoes = {}) => {
        chamadas.push({ url, opcoes });
        if (url === "/api/config") return { ok: true, json: async () => ({ url: "https://exemplo.supabase.co", anon: "chave-anon" }) };
        return respostaDoSupabase(url);
      },
    };
    ctx.window = ctx;
    vm.runInNewContext(ler("conta.js"), ctx, { filename: "conta.js" });
    return { p: await ctx.Conta.provedores(), chamadas };
  }
  const responde = (corpo) => async () => ({ ok: true, json: async () => corpo });

  let r = await provedoresCom(responde({ external: { email: true, google: true } }));
  assert.equal(r.p.google, true, "Google ativado: botão aparece");
  const pedido = r.chamadas.find((c) => c.url.endsWith("/auth/v1/settings"));
  assert.equal(pedido.url, "https://exemplo.supabase.co/auth/v1/settings");
  assert.equal(pedido.opcoes.method, "GET");
  assert.equal(pedido.opcoes.headers.apikey, "chave-anon");

  r = await provedoresCom(responde({ external: { email: true, google: false } }));
  assert.equal(r.p.google, false, "Google desligado: botão fica escondido");

  r = await provedoresCom(async () => ({ ok: false, json: async () => ({ msg: "erro" }) }));
  assert.equal(Object.keys(r.p).length, 0, "erro do Supabase: nenhum login extra");

  r = await provedoresCom(async () => { throw new Error("sem rede"); });
  assert.equal(Object.keys(r.p).length, 0, "sem rede: nenhum login extra");
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
  assert.deepEqual([...barbeiro.matchAll(/data-aba="([a-z]+)"/g)].map((m) => m[1]), ["hoje", "agenda", "horarios", "mais"], "sem a carteira de clientes (só do dono)");
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

test("lojas (catálogos) fora do ar; barbearias e página de vendas continuam no ar", () => {
  const v = JSON.parse(ler("vercel.json"));
  const fora = v.redirects.filter((r) => r.destination === "/404").map((r) => new RegExp("^" + r.source.replace(/:\w+\*/g, ".*") + "$"));
  const bloqueado = (p) => fora.some((re) => re.test(p));
  for (const p of ["/aviv-graos", "/aviv-graos.html", "/central-descartaveis", "/central-descartaveis-avaliar", "/genesis-farma", "/img/genesis-farma/d-1.jpg"]) assert.ok(bloqueado(p), p + " fora do ar");
  for (const p of ["/", "/gw-barbearia", "/jm-barbearia", "/gw-barbearia-avaliar", "/img/gw-barbearia/logo.jpg", "/cadastro"]) assert.ok(!bloqueado(p), p + " continua no ar");
});

// Edições feitas pelo terminal já apagaram a barra invertida de expressões regulares (\D virou D).
// Este teste procura os sinais desse defeito nas páginas e scripts do navegador e do servidor.
test("nenhuma expressão regular perdeu a barra invertida", () => {
  const pastas = [".", "api", "lib"];
  const suspeitos = [/\.replace\(\/D\/g/, /\.replace\(\/d\/g/, /\.test\(\/d\//, /\/\^d\+\$\//, /\.split\(\/s\+\//];
  for (const pasta of pastas) {
    for (const f of fs.readdirSync(path.join(raiz, pasta)).filter((n) => /\.(js|html)$/.test(n))) {
      const t = fs.readFileSync(path.join(raiz, pasta, f), "utf8");
      for (const s of suspeitos) assert.ok(!s.test(t), `${pasta}/${f} tem ${s}`);
    }
  }
});

// Pedido dos donos (17/11): ao passar a agenda pelo WhatsApp, escolher quais horários mandar
test("mandar horários livres: botão nos dois painéis, escolha dos horários e sugestão ao recusar", () => {
  const agenda = ler("painel-agenda.js");
  assert.match(agenda, /P\.oferecerHorarios = oferecerHorarios;/);
  assert.match(agenda, /"\/api\/horarios" \+ q/, "busca os horários livres de verdade");
  assert.match(agenda, /Toque em pelo menos um horário\./, "não abre o WhatsApp sem horário escolhido");
  assert.match(agenda, /Sugerir outros horários/, "ao recusar, sugere outros horários");
  for (const p of ["painel-dono.html", "painel-barbeiro.html"]) {
    const html = ler(p);
    assert.match(html, /id="btnHorarios"/, p);
    assert.match(html, /P\.oferecerHorarios\(ctx/, p);
    assert.match(html, /ctx\.slug = d\.barbearia \? d\.barbearia\.slug : ""/, p);
  }
});

// Teste do dono (18/11): pelo link da mensagem, o cliente escolhe só entre os horários enviados
test("mandar horários livres: o link leva o dia e os horários, e o site mostra só esses", () => {
  const agenda = ler("painel-agenda.js");
  assert.match(agenda, /"\?barbeiro=" \+ encodeURIComponent\(est\.prof\) \+ "&dia=" \+ est\.dia \+ "&horas=" \+ hs\.map\(function \(x\) \{ return x\.replace\(":", ""\); \}\)\.join\("-"\)/);
  const G = require("../lib/gerador");
  assert.ok(G.VERSAO >= 13, "site com a oferta de horários desde o gerador v13");
  const site = ler("gw-barbearia.html");
  assert.match(site, /function lerOferta\(\)/);
  assert.match(site, /var of=lerOferta\(\);if\(of&&porId\(equipe\|\|\[\],of\.barbeiro\)\)\{abrirOferta\(of\);return\}/, "o link com horários abre a oferta antes do link do barbeiro");
  assert.match(site, /etapa==="dia"&&oferta&&sel\.prof/, "na oferta, a etapa do dia mostra só os horários enviados");
  assert.match(site, /var hs=oferta\.horas\.filter\(function\(x\)\{return livres\.indexOf\(x\)>-1\}\)/, "só os que ainda estão livres");
  assert.match(site, /if\(!profFixo\)\{/, "voltar não desfaz o barbeiro que veio do link");
});
