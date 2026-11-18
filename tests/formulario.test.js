// Formulário inicial da implantação: o dono preenche pelo link, as respostas chegam ao admin,
// viram o rascunho do Criador e os convites da equipe com a comissão combinada.
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("./ajuda");
const F = require("../lib/formulario");
const config = require("../api/config");
const barbearia = require("../api/barbearia");
const eu = require("../api/eu");
const convite = require("../api/convite");

const TOKEN = "cd".repeat(24);
const FORM_ID = "f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0";
const MIDIA = "https://teste.supabase.co/storage/v1/object/public/midia/formularios/" + FORM_ID + "/abc123.jpg";

function respostas(extra = {}) {
  return {
    barbearia: { nome: "Barbearia Modelo", cidade: "Recife - PE", endereco: "Rua A, 10", whatsapp: "(81) 99999-0000", instagram: "@modelo", horario: "Seg a Sáb: 9h às 19h" },
    dono: { nome: "Carlos Dono", email: "Carlos@Exemplo.com", whatsapp: "81988887777", atende: true },
    servicos: [{ nome: "Corte", preco: "35", duracao: "30", protese: false, midia: [{ tipo: "foto", url: MIDIA }] }, { nome: "Prótese capilar (manutenção)", preco: "180,5", duracao: 90, protese: true, midia: [] }],
    produtos: [{ nome: "Pomada", custo: "18,00", preco: "35,00", estoque: "12", midia: [{ tipo: "foto", url: MIDIA }] }],
    insumos: [{ nome: "Lâmina", unidade: "cx", custo: "0,50", estoque: 100 }],
    barbeiros: [{ nome: "Rafael", email: "rafael@exemplo.com", whatsapp: "81977776666", comissao: "45" }, { nome: "Sem Login", email: "", whatsapp: "", comissao: 40 }],
    fotos: { logo: MIDIA, capa: "https://malicioso.exemplo/x.jpg", ambiente: [MIDIA, "javascript:alert(1)"] },
    preferencias: { confirmacao: "automatica", sinal: true, pixChave: "carlos@exemplo.com", pixNome: "Carlos" },
    observacoes: "Fazemos prótese.",
    ...extra,
  };
}

// Banco falso: o formulário está em `estado` (status, dados); `chamadas` guarda tudo o que foi pedido
function rotasForm(o = {}) {
  const estado = { status: o.status || "aberto", dados: o.dados || {}, expira_em: o.vencido ? "2020-01-01T00:00:00Z" : new Date(Date.now() + 864e5).toISOString() };
  return {
    estado,
    rotas: [
      { padrao: /\/rest\/v1\/rpc\/contar_tentativa/, resposta: (u, op, corpo) => ({ corpo: String(corpo.p_chave).startsWith("formulario-salvar") ? (o.salvamentos || 0) + 1 : (o.tentativas || 0) + (corpo.p_registrar ? 1 : 0) }) },
      { metodo: "GET", padrao: /\/rest\/v1\/formularios\?token=eq\./, resposta: (url) => ({ corpo: url.includes(TOKEN) ? [{ id: FORM_ID, nome: "", ...estado }] : [] }) },
      { metodo: "GET", padrao: /\/rest\/v1\/formularios\?id=eq\./, resposta: () => ({ corpo: [{ id: FORM_ID, token: TOKEN, nome: "Barbearia Modelo", ...estado }] }) },
      { metodo: "GET", padrao: /\/rest\/v1\/formularios\?status=neq\.arquivado/, resposta: () => ({ corpo: [{ id: FORM_ID, token: TOKEN, nome: "Barbearia Modelo", whatsapp: "", criado_em: "2026-11-17T12:00:00Z", ...estado }] }) },
      { metodo: "PATCH", padrao: /\/rest\/v1\/formularios\?id=eq\./, resposta: (u, op, corpo) => { Object.assign(estado, corpo); return { status: 204 }; } },
      { metodo: "POST", padrao: /\/rest\/v1\/formularios$/, resposta: (u, op, corpo) => ({ status: 201, corpo: [{ id: FORM_ID, ...corpo }] }) },
      { padrao: /\/rest\/v1\/rpc\/formulario_midia/, resposta: { corpo: o.semMidia ? null : FORM_ID } },
      { padrao: /storage\/v1\/object\/upload\/sign\/midia\//, resposta: { corpo: { url: "/object/upload/sign/midia/x?token=t" } } },
      ...A.rotasDeConta(),
    ],
  };
}

test("limpeza: só os campos do formulário ficam, mídia só do próprio formulário, números e limites", () => {
  const d = F.limpar({ ...respostas(), invasor: "<script>", dono: { nome: "Carlos", email: " X@Y.COM ", atende: "sim", senha: "123" } });
  assert.equal(d.invasor, undefined);
  assert.equal(d.dono.senha, undefined);
  assert.equal(d.dono.email, "x@y.com");
  assert.equal(d.dono.atende, false, "só true de verdade marca a caixa");
  assert.equal(d.barbearia.whatsapp, "81999990000");
  assert.equal(d.fotos.logo, MIDIA);
  assert.equal(d.fotos.capa, "", "foto de fora do formulário não entra");
  assert.deepEqual(d.fotos.ambiente, [MIDIA]);
  assert.equal(d.servicos[0].duracao, 30);
  assert.equal(d.barbeiros[0].comissao, 45);
  assert.equal(F.limpar({ barbeiros: [{ comissao: 150 }] }).barbeiros[0].comissao, null, "comissão acima de 100% não vale");
  assert.equal(F.limpar({ servicos: Array.from({ length: 100 }, () => ({ nome: "x" })) }).servicos.length, 60);
});

test("envio exige nome, e-mail válido, um serviço com preço e a chave Pix quando há sinal", () => {
  assert.deepEqual(F.pendencias(F.limpar(respostas())), []);
  const falta = F.pendencias(F.limpar({ preferencias: { sinal: true } }));
  assert.ok(falta.includes("Nome da barbearia"));
  assert.ok(falta.some((f) => f.startsWith("Seu e-mail")));
  assert.ok(falta.includes("Pelo menos um serviço com preço"));
  assert.ok(falta.includes("Chave Pix para o sinal"));
});

test("formulário público: abre pelo link, e link errado conta tentativa e bloqueia depois de 30", async () => {
  let { rotas } = rotasForm({ dados: respostas() });
  A.instalarFetch(rotas);
  let r = await A.chamar(config, { query: { formulario: TOKEN } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.editavel, true);
  assert.equal(r.body.dados.fotos.capa, "");
  const chamadas = A.instalarFetch(rotasForm().rotas);
  r = await A.chamar(config, { query: { formulario: "ee".repeat(24) } });
  assert.equal(r.statusCode, 404);
  assert.ok(chamadas.some((c) => c.url.includes("contar_tentativa") && c.corpo.p_registrar === true));
  A.instalarFetch(rotasForm({ tentativas: 30 }).rotas);
  r = await A.chamar(config, { query: { formulario: TOKEN } });
  assert.equal(r.statusCode, 429);
  ({ rotas } = rotasForm({ status: "arquivado" }));
  A.instalarFetch(rotas);
  r = await A.chamar(config, { query: { formulario: TOKEN } });
  assert.equal(r.statusCode, 404, "arquivado não abre");
});

test("salvar sozinho grava só o que é do formulário; enviar incompleto diz o que falta; enviar completo marca respondido", async () => {
  let f = rotasForm();
  A.instalarFetch(f.rotas);
  let r = await A.chamar(config, { metodo: "POST", corpo: { tipo: "formulario", token: TOKEN, dados: { barbearia: { nome: "Barbearia Modelo" }, extra: 1 } } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(f.estado.dados.extra, undefined);
  assert.equal(f.estado.nome, "Barbearia Modelo", "o nome vira o rótulo na lista do admin");
  assert.equal(f.estado.status, "aberto");
  r = await A.chamar(config, { metodo: "POST", corpo: { tipo: "formulario", token: TOKEN, dados: { barbearia: { nome: "X" } }, enviar: true } });
  assert.equal(r.statusCode, 400);
  assert.ok(r.body.falta.length > 0);
  assert.equal(f.estado.status, "aberto");
  r = await A.chamar(config, { metodo: "POST", corpo: { tipo: "formulario", token: TOKEN, dados: respostas(), enviar: true } });
  assert.equal(r.statusCode, 200);
  assert.equal(f.estado.status, "enviado");
  assert.ok(f.estado.enviado_em);
});

test("depois de aplicado, o link não edita mais; salvar rápido demais é freado", async () => {
  A.instalarFetch(rotasForm({ status: "importado" }).rotas);
  let r = await A.chamar(config, { metodo: "POST", corpo: { tipo: "formulario", token: TOKEN, dados: respostas() } });
  assert.equal(r.statusCode, 409);
  A.instalarFetch(rotasForm({ salvamentos: 40 }).rotas);
  r = await A.chamar(config, { metodo: "POST", corpo: { tipo: "formulario", token: TOKEN, dados: respostas() } });
  assert.equal(r.statusCode, 429);
});

test("fotos e vídeos do formulário: tipo e tamanho conferidos, limite por formulário e caminho na pasta dele", async () => {
  A.instalarFetch(rotasForm().rotas);
  let r = await A.chamar(config, { metodo: "POST", corpo: { tipo: "formulario-midia", token: TOKEN, tipoArquivo: "application/pdf", tamanho: 100 } });
  assert.equal(r.statusCode, 400);
  r = await A.chamar(config, { metodo: "POST", corpo: { tipo: "formulario-midia", token: TOKEN, tipoArquivo: "image/jpeg", tamanho: 6 * 1024 * 1024 } });
  assert.equal(r.statusCode, 400, "foto acima de 5 MB");
  r = await A.chamar(config, { metodo: "POST", corpo: { tipo: "formulario-midia", token: TOKEN, tipoArquivo: "video/mp4", tamanho: 20 * 1024 * 1024 } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.ok(r.body.publicUrl.startsWith("https://teste.supabase.co/storage/v1/object/public/midia/formularios/" + FORM_ID + "/"));
  assert.equal(F.limpar({ fotos: { logo: r.body.publicUrl } }).fotos.logo, r.body.publicUrl, "o endereço devolvido é aceito pela limpeza");
  A.instalarFetch(rotasForm({ semMidia: true }).rotas);
  r = await A.chamar(config, { metodo: "POST", corpo: { tipo: "formulario-midia", token: TOKEN, tipoArquivo: "image/png", tamanho: 1000 } });
  assert.equal(r.statusCode, 409, "passou do limite ou link encerrado");
});

test("admin: cria o link, vê a lista com o resumo e lê as respostas; dono não usa", async () => {
  const f = rotasForm({ status: "enviado", dados: respostas() });
  const chamadas = A.instalarFetch(f.rotas);
  let r = await A.chamar(barbearia, { metodo: "POST", token: "token-admin", corpo: { acao: "formulario-criar", nome: "Barbearia Modelo", whatsapp: "(81) 98888-7777" } });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.match(r.body.link, /^https:\/\/biosite\.teste\/formulario\?f=[0-9a-f]{48}$/);
  const novo = chamadas.find((c) => c.metodo === "POST" && /\/rest\/v1\/formularios$/.test(c.url));
  assert.equal(novo.corpo.whatsapp, "81988887777");
  r = await A.chamar(barbearia, { metodo: "POST", token: "token-admin", corpo: { acao: "formulario-ler", id: FORM_ID } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.dados.dono.email, "carlos@exemplo.com");
  assert.deepEqual(r.body.pendencias, []);
  r = await A.chamar(barbearia, { metodo: "POST", token: "token-dono", corpo: { acao: "formulario-criar" } });
  assert.equal(r.statusCode, 403);
  const lista = await F.listar();
  assert.equal(lista[0].resumo.servicos, 2);
  assert.equal(lista[0].resumo.barbeiros, 2);
  assert.equal(lista[0].dados, undefined, "a lista não leva as respostas inteiras");
});

test("rascunho do Criador: preços em reais, duração, dono que atende entra na agenda, WhatsApp com 55 e e-mail do convite", () => {
  const c = F.paraCriador({ id: FORM_ID, dados: respostas() });
  assert.equal(c.nome, "Barbearia Modelo");
  assert.equal(c.slug, "barbearia-modelo");
  assert.equal(c.whatsapp, "5581999990000");
  assert.equal(c.agenda.ativo, true);
  assert.deepEqual(c.agenda.servicos.map((s) => [s.nome, s.preco, s.duracao]), [["Corte", "35,00", "30 min"], ["Prótese capilar (manutenção)", "180,50", "90 min"]]);
  assert.deepEqual(c.agenda.profissionais.map((p) => p.nome), ["Carlos Dono", "Rafael", "Sem Login"]);
  assert.equal(c.agenda.profissionais[0].servicos.length, 2, "cada barbeiro faz todos os serviços (ajusta no Criador)");
  assert.equal(c.produtos[0].preco, "35,00");
  assert.equal(c.produtos[0].foto, MIDIA);
  assert.equal(c.logo, MIDIA);
  assert.equal(c.capa, "");
  assert.equal(c.pedido.pix, "carlos@exemplo.com");
  assert.equal(c._emailDono, "carlos@exemplo.com");
  assert.equal(F.precoBr("1.234,5"), "1234,50");
  assert.equal(F.precoBr(""), "");
  const comSugestoes = F.paraCriador({ id: FORM_ID, dados: respostas({ servicos: [{ nome: "Corte", preco: "30" }, { nome: "Sobrancelha", preco: "" }, { nome: "Luzes", preco: "" }] }) });
  assert.deepEqual(comSugestoes.agenda.servicos.map((s) => s.nome), ["Corte", "Luzes"], "sugestão sem preço sai; serviço próprio sem preço fica");
});

test("o formulário traz as mesmas sugestões de serviço que o servidor reconhece", () => {
  const html = require("fs").readFileSync(require("path").join(__dirname, "..", "formulario.html"), "utf8");
  for (const nome of ["Corte", "Barba", "Corte + barba", "Sobrancelha", "Pigmentação"]) assert.ok(html.includes(`["${nome}",`), nome);
});

test("aplicar no painel: convites do dono e da equipe com a comissão, reaproveita convite aberto, pula quem já entrou e lança os insumos", async () => {
  const f = rotasForm({ status: "enviado", dados: respostas() });
  const SITE = A.UUIDS.barbearia;
  const chamadas = A.instalarFetch([
    { padrao: /\/rest\/v1\/barbearias\?slug=eq\.barbearia-modelo/, resposta: { corpo: [{ id: SITE, nome: "Barbearia Modelo", slug: "barbearia-modelo" }] } },
    { metodo: "PATCH", padrao: /\/rest\/v1\/barbearias\?id=eq\./, resposta: { status: 204 } },
    { padrao: /\/rest\/v1\/rpc\/conta_por_email/, resposta: (u, op, corpo) => ({ corpo: corpo.p_email === "carlos@exemplo.com" ? [{ id: A.UUIDS.donoUser, confirmado: true }] : [] }) },
    { padrao: /\/rest\/v1\/perfis\?user_id=eq\.[^&]+&barbearia_id=eq\./, resposta: (url) => ({ corpo: url.includes(A.UUIDS.donoUser) ? [{ user_id: A.UUIDS.donoUser }] : [] }) },
    { metodo: "GET", padrao: /\/rest\/v1\/convites\?barbearia_id=eq\./, resposta: (url) => ({ corpo: url.includes("rafael%40exemplo.com") ? [{ id: "c1", token: "aa".repeat(24), papel: "barbeiro" }] : [] }) },
    { metodo: "PATCH", padrao: /\/rest\/v1\/convites\?id=eq\.c1/, resposta: { status: 204 } },
    { metodo: "POST", padrao: /\/rest\/v1\/convites$/, resposta: { status: 201 } },
    { metodo: "GET", padrao: /\/rest\/v1\/insumos\?barbearia_id=eq\./, resposta: { corpo: [] } },
    { metodo: "POST", padrao: /\/rest\/v1\/insumos$/, resposta: { status: 201, corpo: [{ id: "i1" }] } },
    { metodo: "POST", padrao: /\/rest\/v1\/insumo_movimentos/, resposta: { status: 201 } },
    ...f.rotas,
  ]);
  const r = await A.chamar(barbearia, { metodo: "POST", token: "token-admin", corpo: { acao: "formulario-aplicar", id: FORM_ID, slug: "barbearia-modelo" } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const dono = r.body.convites.find((c) => c.papel === "dono");
  assert.equal(dono.jaEntrou, true, "o dono já tem conta ligada ao site");
  const rafael = r.body.convites.find((c) => c.nome === "Rafael");
  assert.equal(rafael.link, "https://biosite.teste/entrar.html?convite=" + "aa".repeat(24), "reaproveita o convite que ainda vale");
  assert.ok(chamadas.some((c) => c.metodo === "PATCH" && c.url.includes("convites?id=eq.c1") && c.corpo.comissao_pct === 45), "atualiza a comissão no convite");
  assert.ok(!r.body.convites.some((c) => c.nome === "Sem Login"), "sem e-mail não recebe convite");
  const mov = chamadas.find((c) => c.url.includes("insumo_movimentos"));
  assert.deepEqual([mov.corpo.tipo, mov.corpo.quantidade, mov.corpo.valor_total], ["entrada", 100, 50]);
  assert.equal(r.body.insumos, 1);
  assert.equal(f.estado.status, "importado");
  const conf = chamadas.find((c) => c.metodo === "PATCH" && c.url.includes("/rest/v1/barbearias?id=eq."));
  assert.deepEqual(conf.corpo, { confirmacao_automatica: true }, "o dono escolheu confirmação automática no formulário");
  assert.equal(r.body.confirmacaoAutomatica, true);
});

test("aplicar exige formulário respondido e site publicado", async () => {
  A.instalarFetch(rotasForm({ status: "aberto", dados: respostas() }).rotas);
  let r = await A.chamar(barbearia, { metodo: "POST", token: "token-admin", corpo: { acao: "formulario-aplicar", id: FORM_ID, slug: "barbearia-modelo" } });
  assert.equal(r.statusCode, 409);
  A.instalarFetch([{ padrao: /\/rest\/v1\/barbearias\?slug=eq\./, resposta: { corpo: [] } }, ...rotasForm({ status: "enviado", dados: respostas() }).rotas]);
  r = await A.chamar(barbearia, { metodo: "POST", token: "token-admin", corpo: { acao: "formulario-aplicar", id: FORM_ID, slug: "nao-existe" } });
  assert.equal(r.statusCode, 404);
});

test("convite com comissão do formulário: o barbeiro entra no cadastro com essa comissão", async () => {
  const chamadas = A.instalarFetch([
    { metodo: "GET", padrao: /\/rest\/v1\/convites\?token=eq\./, resposta: { corpo: [{ id: "c9", barbearia_id: A.UUIDS.barbearia, email: "novo@exemplo.com", expira_em: new Date(Date.now() + 864e5).toISOString(), papel: "barbeiro", comissao_pct: "45.00" }] } },
    { metodo: "PATCH", padrao: /\/rest\/v1\/convites\?id=eq\.c9&aceito_em=is\.null/, resposta: { corpo: [{ id: "c9" }] } },
    { padrao: /\/rest\/v1\/barbearias\?id=eq\./, resposta: { corpo: [{ id: A.UUIDS.barbearia, nome: "GW Barbearia" }] } },
    { padrao: /\/rest\/v1\/rpc\/conta_por_email/, resposta: { corpo: [] } },
    { metodo: "POST", padrao: /\/rest\/v1\/perfis/, resposta: { status: 201 } },
    { metodo: "POST", padrao: /\/rest\/v1\/profissionais/, resposta: { status: 201 } },
    { metodo: "POST", padrao: /\/auth\/v1\/admin\/users$/, resposta: { corpo: { id: "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1" } } },
    ...A.rotasDeConta(),
  ]);
  const r = await A.chamar(convite, { metodo: "POST", corpo: { token: "ab".repeat(24), nome: "Rafael", senha: "corte2026" } });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  const prof = chamadas.find((c) => c.metodo === "POST" && c.url.includes("/rest/v1/profissionais"));
  assert.equal(prof.corpo.comissao_pct, 45);
});

test("a visão do admin traz os formulários", async () => {
  const f = rotasForm({ status: "enviado", dados: respostas() });
  A.instalarFetch([
    { padrao: /\/rest\/v1\/barbearias\?select=/, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/profissionais\?ativo=eq\.true/, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/leads\?/, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/assinaturas\?/, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/perfis\?papel=eq\.dono/, resposta: { corpo: [] } },
    ...f.rotas,
  ]);
  const r = await A.chamar(eu, { token: "token-admin" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.formularios.length, 1);
  assert.equal(r.body.formularios[0].status, "enviado");
});
