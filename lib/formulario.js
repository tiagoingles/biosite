// Formulário inicial da implantação (fase 17).
// O admin gera um link; o dono da barbearia preenche pelo celular (salva sozinho a cada mudança) e envia.
// No painel do admin: lista, respostas, "Abrir no Criador" (vira o rascunho do site) e "Aplicar no painel"
// (convites da equipe com a comissão combinada, convite do dono e insumos com o estoque inicial).
// Rotas: o público usa /api/config (?formulario= e POST tipo "formulario" / "formulario-midia");
// o admin usa /api/barbearia (ações "formulario-*") e a lista vem em /api/eu.
const crypto = require("crypto");
const { rest, cfg, linkDeEnvio } = require("./supabase");
const { contarTentativas, origemDe } = require("./seguranca");

const TOKEN = /^[0-9a-f]{48}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const DIAS_CONVITE = 7;
const MAX_MIDIAS = 80;
const MAX_BYTES = 150 * 1024;
const LIMITE = { servicos: 60, produtos: 150, insumos: 80, barbeiros: 30, ambiente: 12, midia: 4 };
const MB = 1024 * 1024;
// Serviços que o formulário já traz preenchidos (formulario.html); o dono só coloca o preço
const SUGESTOES = new Set(["Corte", "Barba", "Corte + barba", "Sobrancelha", "Pigmentação"]);
const TIPOS = {
  "image/jpeg": { ext: "jpg", tipo: "foto", max: 5 },
  "image/png": { ext: "png", tipo: "foto", max: 5 },
  "image/webp": { ext: "webp", tipo: "foto", max: 5 },
  "video/mp4": { ext: "mp4", tipo: "video", max: 25 },
  "video/webm": { ext: "webm", tipo: "video", max: 25 },
  "video/quicktime": { ext: "mov", tipo: "video", max: 25 },
};

function erro(status, message) {
  return Object.assign(new Error(message), { status });
}

// ---------- limpeza do que vem do navegador (nada de fora da lista abaixo é guardado) ----------
const txt = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const multi = (v, max) => String(v == null ? "" : v).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f]/g, " ").trim().slice(0, max);
const digitos = (v, max) => String(v == null ? "" : v).replace(/\D/g, "").slice(0, max);
const dinheiro = (v) => String(v == null ? "" : v).replace(/[^\d,.]/g, "").slice(0, 12);
const sim = (v) => v === true;
const lista = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
function inteiro(v, min, max) {
  if (v === "" || v == null) return null;
  const n = Math.round(Number(String(v).replace(",", ".")));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
function emailOk(v) {
  const e = txt(v, 120).toLowerCase();
  return EMAIL.test(e) ? e : txt(v, 120).toLowerCase();
}
// Só fotos e vídeos enviados pelo próprio formulário (Storage do Supabase, pasta formularios/)
function prefixoMidia() {
  return `${cfg().url}/storage/v1/object/public/midia/formularios/`;
}
function urlMidia(u) {
  const s = String(u || "");
  return s.startsWith(prefixoMidia()) && /^[A-Za-z0-9/._-]+$/.test(s.slice(prefixoMidia().length)) && !s.includes("..") ? s : "";
}
function midias(v) {
  return lista(v, LIMITE.midia)
    .map((m) => ({ tipo: m && m.tipo === "video" ? "video" : "foto", url: urlMidia(m && m.url) }))
    .filter((m) => m.url);
}

function limpar(d) {
  d = d && typeof d === "object" && !Array.isArray(d) ? d : {};
  const b = d.barbearia || {};
  const dono = d.dono || {};
  const fotos = d.fotos || {};
  const pref = d.preferencias || {};
  return {
    barbearia: {
      nome: txt(b.nome, 80), cidade: txt(b.cidade, 80), endereco: txt(b.endereco, 160),
      whatsapp: digitos(b.whatsapp, 13), instagram: txt(b.instagram, 120), horario: multi(b.horario, 400),
    },
    dono: { nome: txt(dono.nome, 80), email: emailOk(dono.email), whatsapp: digitos(dono.whatsapp, 13), atende: sim(dono.atende) },
    servicos: lista(d.servicos, LIMITE.servicos).map((s) => ({
      nome: txt(s && s.nome, 80), preco: dinheiro(s && s.preco), duracao: inteiro(s && s.duracao, 5, 480), protese: sim(s && s.protese), midia: midias(s && s.midia),
    })),
    produtos: lista(d.produtos, LIMITE.produtos).map((p) => ({
      nome: txt(p && p.nome, 80), custo: dinheiro(p && p.custo), preco: dinheiro(p && p.preco), estoque: inteiro(p && p.estoque, 0, 99999), midia: midias(p && p.midia),
    })),
    insumos: lista(d.insumos, LIMITE.insumos).map((i) => ({
      nome: txt(i && i.nome, 80), unidade: txt(i && i.unidade, 12), custo: dinheiro(i && i.custo), estoque: inteiro(i && i.estoque, 0, 99999),
    })),
    barbeiros: lista(d.barbeiros, LIMITE.barbeiros).map((x) => ({
      nome: txt(x && x.nome, 80), email: emailOk(x && x.email), whatsapp: digitos(x && x.whatsapp, 13), comissao: inteiro(x && x.comissao, 0, 100),
    })),
    fotos: { logo: urlMidia(fotos.logo), capa: urlMidia(fotos.capa), ambiente: lista(fotos.ambiente, LIMITE.ambiente).map(urlMidia).filter(Boolean) },
    preferencias: {
      confirmacao: pref.confirmacao === "automatica" ? "automatica" : pref.confirmacao === "manual" ? "manual" : "",
      sinal: sim(pref.sinal), pixChave: txt(pref.pixChave, 120), pixNome: txt(pref.pixNome, 80),
    },
    observacoes: multi(d.observacoes, 1000),
  };
}

// O que falta para enviar (o rascunho pode ficar incompleto; o envio, não)
function pendencias(d) {
  const p = [];
  if (!d.barbearia.nome) p.push("Nome da barbearia");
  if (!EMAIL.test(d.dono.email)) p.push("Seu e-mail (para criar o seu login)");
  if (!d.servicos.some((s) => s.nome && s.preco)) p.push("Pelo menos um serviço com preço");
  if (d.barbeiros.some((x) => x.email && !EMAIL.test(x.email))) p.push("E-mail de barbeiro inválido");
  if (d.preferencias.sinal && !d.preferencias.pixChave) p.push("Chave Pix para o sinal");
  return p;
}

function resumo(d) {
  d = d || {};
  const n = (k) => (Array.isArray(d[k]) ? d[k].filter((x) => x && x.nome).length : 0);
  const fotos = d.fotos || {};
  return {
    servicos: n("servicos"), produtos: n("produtos"), insumos: n("insumos"), barbeiros: n("barbeiros"),
    fotos: (fotos.logo ? 1 : 0) + (fotos.capa ? 1 : 0) + (Array.isArray(fotos.ambiente) ? fotos.ambiente.length : 0),
    email: (d.dono && d.dono.email) || "",
  };
}

function vale(f) {
  return f && (f.status === "aberto" || f.status === "enviado") && new Date(f.expira_em) > new Date();
}

async function porToken(token) {
  if (!TOKEN.test(String(token || ""))) return null;
  return (await rest(`formularios?token=eq.${token}&select=id,nome,status,dados,expira_em`))[0] || null;
}

// Link inválido conta tentativa por origem (30 por hora); passou disso, bloqueia
async function bloqueio(req) {
  const chave = `formulario:${origemDe(req) || "sem-origem"}`;
  return { chave, bloqueado: (await contarTentativas(chave, 3600, false)) >= 30 };
}

// ---------- público (quem recebeu o link) ----------
async function lerPublico(req, res, token) {
  const { chave, bloqueado } = await bloqueio(req);
  if (bloqueado) return res.status(429).json({ message: "Muitas tentativas. Tente de novo mais tarde." });
  const f = await porToken(token);
  if (!f || f.status === "arquivado") {
    await contarTentativas(chave, 3600, true).catch(() => 0);
    return res.status(404).json({ message: "Este link não vale mais. Peça um novo ao Bio Site." });
  }
  return res.status(200).json({ nome: f.nome, status: f.status, editavel: vale(f), dados: limpar(f.dados) });
}

async function salvarPublico(req, res, b) {
  const { chave, bloqueado } = await bloqueio(req);
  if (bloqueado) return res.status(429).json({ message: "Muitas tentativas. Tente de novo mais tarde." });
  const f = await porToken(b.token);
  if (!f) {
    await contarTentativas(chave, 3600, true).catch(() => 0);
    return res.status(404).json({ message: "Este link não vale mais. Peça um novo ao Bio Site." });
  }
  if (!vale(f)) return res.status(409).json({ message: "Este formulário já foi usado para montar o seu site. Fale com o Bio Site para mudar alguma coisa." });
  // Salvamento automático: no máximo 40 por minuto por formulário
  if ((await contarTentativas(`formulario-salvar:${f.id}`, 60, true)) > 40) return res.status(429).json({ message: "Salvando rápido demais. Espere alguns segundos." });
  const dados = limpar(b.dados);
  if (Buffer.byteLength(JSON.stringify(dados)) > MAX_BYTES) return res.status(413).json({ message: "Formulário grande demais. Tire alguns itens e tente de novo." });
  const enviar = b.enviar === true;
  if (enviar) {
    const falta = pendencias(dados);
    if (falta.length) return res.status(400).json({ message: "Falta preencher: " + falta.join(", ") + ".", falta });
  }
  const agora = new Date().toISOString();
  const corpo = { dados, atualizado_em: agora };
  if (dados.barbearia.nome) corpo.nome = dados.barbearia.nome;
  if (enviar) Object.assign(corpo, { status: "enviado", enviado_em: agora });
  await rest(`formularios?id=eq.${f.id}`, { metodo: "PATCH", prefer: "return=minimal", corpo });
  return res.status(200).json({ ok: true, status: enviar ? "enviado" : f.status, salvoEm: agora });
}

async function midiaPublica(req, res, b) {
  const { chave, bloqueado } = await bloqueio(req);
  if (bloqueado) return res.status(429).json({ message: "Muitas tentativas. Tente de novo mais tarde." });
  const t = TIPOS[b.tipoArquivo];
  const tamanho = Number(b.tamanho) || 0;
  if (!t) return res.status(400).json({ message: "Use foto (JPG, PNG ou WebP) ou vídeo (MP4, WebM ou MOV)." });
  if (tamanho <= 0 || tamanho > t.max * MB) return res.status(400).json({ message: `${t.tipo === "video" ? "Vídeo" : "Foto"} maior que ${t.max} MB. Envie um arquivo menor.` });
  if (!TOKEN.test(String(b.token || ""))) {
    await contarTentativas(chave, 3600, true).catch(() => 0);
    return res.status(404).json({ message: "Este link não vale mais." });
  }
  const r = await rest("rpc/formulario_midia", { metodo: "POST", corpo: { p_token: b.token, p_max: MAX_MIDIAS } });
  const id = Array.isArray(r) ? r[0] : r;
  if (!id || !UUID.test(String(id))) return res.status(409).json({ message: `Este formulário não aceita mais arquivos (limite de ${MAX_MIDIAS} ou link encerrado).` });
  const caminho = `formularios/${id}/${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}.${t.ext}`;
  const uploadUrl = await linkDeEnvio("midia", caminho);
  return res.status(200).json({ uploadUrl, publicUrl: `${cfg().url}/storage/v1/object/public/midia/${caminho}`, tipo: t.tipo });
}

// ---------- admin ----------
function linkDo(origem, token) {
  return `${origem}/formulario?f=${token}`;
}

async function listar() {
  const linhas = await rest("formularios?status=neq.arquivado&select=id,token,nome,whatsapp,status,dados,criado_em,atualizado_em,enviado_em,importado_em,barbearia_id,expira_em&order=criado_em.desc&limit=50").catch(() => []);
  return linhas.map((f) => ({
    id: f.id, token: f.token, nome: f.nome, whatsapp: f.whatsapp, status: f.status, criado_em: f.criado_em, atualizado_em: f.atualizado_em,
    enviado_em: f.enviado_em, importado_em: f.importado_em, barbearia_id: f.barbearia_id, vencido: new Date(f.expira_em) < new Date(), resumo: resumo(f.dados),
  }));
}

async function criar({ nome, whatsapp, leadId }, origem) {
  const token = crypto.randomBytes(24).toString("hex");
  const corpo = { token, nome: txt(nome, 120), whatsapp: digitos(whatsapp, 13) };
  if (UUID.test(String(leadId || ""))) corpo.lead_id = leadId;
  const [f] = await rest("formularios", { metodo: "POST", prefer: "return=representation", corpo });
  return { id: f.id, link: linkDo(origem, token) };
}

async function ler(id, origem) {
  if (!UUID.test(String(id || ""))) throw erro(400, "Formulário inválido.");
  const f = (await rest(`formularios?id=eq.${id}&select=*`))[0];
  if (!f) throw erro(404, "Formulário não encontrado.");
  return { ...f, dados: limpar(f.dados), link: linkDo(origem, f.token), pendencias: pendencias(limpar(f.dados)) };
}

async function arquivar(id) {
  if (!UUID.test(String(id || ""))) throw erro(400, "Formulário inválido.");
  await rest(`formularios?id=eq.${id}`, { metodo: "PATCH", prefer: "return=minimal", corpo: { status: "arquivado", atualizado_em: new Date().toISOString() } });
  return { ok: true };
}

// "35" -> "35,00"; "35,5" -> "35,50"; "1.234,56" -> "1234,56"
function precoBr(v) {
  let t = String(v || "").replace(/[^\d,.]/g, "");
  if (!t) return "";
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(t);
  return Number.isFinite(n) ? n.toFixed(2).replace(".", ",") : "";
}
function slugDe(t) {
  return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "barbearia";
}
function whatsSite(d) {
  const n = d.barbearia.whatsapp || d.dono.whatsapp;
  if (!n) return "";
  return n.length <= 11 ? "55" + n : n;
}

// Rascunho do Criador a partir das respostas: o visual padrão das barbearias e tudo o que o dono mandou
function paraCriador(f) {
  const d = limpar(f.dados);
  const novoId = () => "f" + crypto.randomBytes(5).toString("hex");
  // Sugestão do formulário que o dono deixou sem preço e sem foto: ele não oferece esse serviço
  const sugestaoIgnorada = (s) => !s.preco && !s.midia.length && SUGESTOES.has(s.nome);
  const servicos = d.servicos.filter((s) => s.nome && !sugestaoIgnorada(s)).map((s) => ({ id: novoId(), nome: s.nome, duracao: (s.duracao || 30) + " min", preco: precoBr(s.preco), midia: s.midia }));
  const nomes = [];
  if (d.dono.atende && d.dono.nome) nomes.push(d.dono.nome);
  d.barbeiros.filter((x) => x.nome).forEach((x) => { if (!nomes.includes(x.nome)) nomes.push(x.nome); });
  const profissionais = nomes.map((nome) => ({ id: novoId(), nome, servicos: servicos.map((s) => s.id), dias: [1, 2, 3, 4, 5, 6], inicio: "09:00", fim: "19:00" }));
  const produtos = d.produtos.filter((p) => p.nome).map((p) => ({ id: novoId(), nome: p.nome, preco: precoBr(p.preco), cat: "", desc: "", foto: (p.midia.find((m) => m.tipo === "foto") || {}).url || "", esgotado: false }));
  return {
    modelo: "vitrine",
    tipo: "barbearia",
    nome: d.barbearia.nome,
    cidade: d.barbearia.cidade,
    descricao: d.barbearia.cidade ? `Barbearia em ${d.barbearia.cidade}` : "",
    whatsapp: whatsSite(d),
    whatsMsg: "Olá! Vim pelo site.",
    instagram: d.barbearia.instagram,
    review: "",
    endereco: d.barbearia.endereco,
    maps: "",
    horario: d.barbearia.horario,
    logo: d.fotos.logo,
    capa: d.fotos.capa,
    nota: "",
    totalAval: "",
    mostrarNota: false,
    extras: [],
    catalogoTitulo: "Produtos",
    categorias: [],
    produtos,
    pedido: { entrega: false, retirada: false, agendamento: true, taxa: "", minimo: "", pag: ["Pix", "Cartão", "Dinheiro"], pix: d.preferencias.pixChave, bairros: [], botao: "Agendar pelo WhatsApp", obsDica: "Ex.: prefiro com o barbeiro João" },
    cor: "#b08d57",
    fundo: "#121212",
    texto: "#f2efe9",
    fonteTitulo: "Oswald",
    fonteTexto: "DM Sans",
    slug: slugDe(d.barbearia.nome),
    agenda: { ativo: true, termo: "Barbeiro", msg: "", servicos, profissionais },
    // O Criador tira daqui e coloca no campo "E-mail do dono" (gera o convite ao publicar)
    _emailDono: EMAIL.test(d.dono.email) ? d.dono.email : "",
  };
}

async function contaPorEmail(email) {
  const r = await rest("rpc/conta_por_email", { metodo: "POST", corpo: { p_email: email } }).catch(() => []);
  return (Array.isArray(r) ? r[0] : r) || null;
}

// Convite (reaproveita o que ainda vale para o mesmo e-mail e papel)
async function convite(barbeariaId, email, papel, comissao, origem) {
  const abertos = await rest(`convites?barbearia_id=eq.${barbeariaId}&email=eq.${encodeURIComponent(email)}&aceito_em=is.null&expira_em=gt.${new Date().toISOString()}&select=id,token,papel`);
  const igual = abertos.find((c) => (c.papel || "barbeiro") === papel);
  if (igual) {
    if (comissao != null) await rest(`convites?id=eq.${igual.id}`, { metodo: "PATCH", prefer: "return=minimal", corpo: { comissao_pct: comissao } });
    return `${origem}/entrar.html?convite=${igual.token}`;
  }
  const token = crypto.randomBytes(24).toString("hex");
  const corpo = { barbearia_id: barbeariaId, email, token, papel, expira_em: new Date(Date.now() + DIAS_CONVITE * 864e5).toISOString() };
  if (comissao != null) corpo.comissao_pct = comissao;
  await rest("convites", { metodo: "POST", prefer: "return=minimal", corpo });
  return `${origem}/entrar.html?convite=${token}`;
}

// Aplica as respostas na barbearia já publicada: convites (dono e equipe, com a comissão) e insumos
async function aplicar({ id, slug }, origem) {
  const f = await ler(id, origem);
  if (f.status === "aberto") throw erro(409, "O dono ainda não enviou o formulário.");
  const site = (await rest(`barbearias?slug=eq.${encodeURIComponent(String(slug || ""))}&select=id,nome,slug`))[0];
  if (!site) throw erro(404, "Site não encontrado. Publique o site pelo Criador antes de aplicar.");
  const d = f.dados;
  const convites = [];
  const pessoas = [];
  if (EMAIL.test(d.dono.email)) pessoas.push({ nome: d.dono.nome || "Dono", email: d.dono.email, whatsapp: d.dono.whatsapp, papel: "dono", comissao: null });
  d.barbeiros.filter((x) => x.nome && EMAIL.test(x.email)).forEach((x) => pessoas.push({ nome: x.nome, email: x.email, whatsapp: x.whatsapp, papel: "barbeiro", comissao: x.comissao }));
  for (const p of pessoas) {
    const conta = await contaPorEmail(p.email);
    if (conta) {
      const perfil = (await rest(`perfis?user_id=eq.${conta.id}&barbearia_id=eq.${site.id}&select=user_id`))[0];
      if (perfil) { convites.push({ ...p, jaEntrou: true, link: "" }); continue; }
    }
    convites.push({ ...p, jaEntrou: false, link: await convite(site.id, p.email, p.papel, p.comissao, origem) });
  }
  // Insumos: cria os que ainda não existem e lança o estoque inicial como entrada
  const existentes = new Set((await rest(`insumos?barbearia_id=eq.${site.id}&select=nome`)).map((i) => i.nome.toLowerCase()));
  let insumos = 0;
  for (const i of d.insumos.filter((x) => x.nome)) {
    if (existentes.has(i.nome.toLowerCase())) continue;
    const [novo] = await rest("insumos", { metodo: "POST", prefer: "return=representation", corpo: { barbearia_id: site.id, nome: i.nome, unidade: i.unidade || "un" } });
    existentes.add(i.nome.toLowerCase());
    insumos++;
    if (i.estoque > 0) {
      const custo = parseFloat(precoBr(i.custo).replace(",", "."));
      await rest("insumo_movimentos", {
        metodo: "POST",
        prefer: "return=minimal",
        corpo: { barbearia_id: site.id, insumo_id: novo.id, tipo: "entrada", quantidade: i.estoque, valor_total: Number.isFinite(custo) ? Math.round(custo * i.estoque * 100) / 100 : null, motivo: "Estoque inicial (formulário)" },
      });
    }
  }
  // Escolha do dono no formulário: agendamentos do site confirmados sozinhos (ou não)
  if (d.preferencias.confirmacao) {
    await rest(`barbearias?id=eq.${site.id}`, { metodo: "PATCH", prefer: "return=minimal", corpo: { confirmacao_automatica: d.preferencias.confirmacao === "automatica" } });
  }
  const agora = new Date().toISOString();
  await rest(`formularios?id=eq.${f.id}`, { metodo: "PATCH", prefer: "return=minimal", corpo: { status: "importado", importado_em: agora, barbearia_id: site.id, atualizado_em: agora } });
  return { barbearia: site.nome, convites, insumos, confirmacaoAutomatica: d.preferencias.confirmacao ? d.preferencias.confirmacao === "automatica" : null };
}

module.exports = { limpar, pendencias, resumo, paraCriador, precoBr, lerPublico, salvarPublico, midiaPublica, listar, criar, ler, arquivar, aplicar, MAX_MIDIAS };
