// Lista de espera (fase 39, pedido do Manolo): quem não acha horário no site entra na lista com o dia e de que horas
// até que horas pode; o dono também coloca quem pede pelo telefone. A ordem de chegada é a prioridade.
// Quando um horário vaga (cancelamento ou desistência), o painel mostra quem da lista cabe nele, na ordem, com o
// WhatsApp pronto para chamar.
// Rotas (limite de funções da Vercel no plano gratuito):
//   POST /api/pedido?espera=1 (público, o site)  { slug, dia, de, ate, servico, duracao, profissionalId?, nome, whatsapp, observacao? }
//   GET  /api/equipe?area=espera (dono)          -> { hoje, lista, vagas, profissionais }
//   POST /api/equipe?area=espera (dono)          { acao: "nova", ... }  coloca alguém na lista (pedido pelo telefone)
//                                                { acao: "status", id, status: esperando|contatado|marcado|saiu }
const { rest } = require("./supabase");
const { usuarioDaRequisicao, perfilDoContexto, ehAdmin } = require("./conta");
const { texto } = require("./agenda");
const { dataValida, horaValida, hojeBr, somaDias, minutos, agoraMinBr, sobrepoe } = require("./horarios");
const { falha, corpoDe, UUID, origemDe } = require("./seguranca");
const { normalizarWhats } = require("./clube");
const { avisarListaDeEspera } = require("./avisos");

const STATUS = ["esperando", "contatado", "marcado", "saiu"];
const ATIVOS = "esperando,contatado";
const DIAS_A_FRENTE = 60;
const DIAS_DE_VAGAS = 14; // horários que vagaram: de hoje até 14 dias à frente
const LIMITE_ORIGEM_DIA = 6; // contra abuso: entradas pelo site por aparelho/rede em 24 h
const CAMPOS = "id,cliente_id,nome,telefone,servico,duracao_min,profissional_id,dia,de,ate,observacao,status,contatado_em,pelo_site,criado_em";
const duracaoOk = (v) => (Number.isInteger(Number(v)) && Number(v) >= 5 && Number(v) <= 240 ? Number(v) : 30);

// Campos comuns do site e do painel. Devolve { erro } ou { dados }.
function lerEntrada(b) {
  const dia = String(b.dia || "");
  const de = String(b.de || "");
  const ate = String(b.ate || "");
  const nome = texto(b.nome, 80);
  const servico = texto(b.servico, 200);
  const bruto = String(b.whatsapp || b.telefone || "");
  const telefone = normalizarWhats(bruto);
  if (!dataValida(dia)) return { erro: "Escolha o dia." };
  const hoje = hojeBr();
  if (dia < hoje || dia > somaDias(hoje, DIAS_A_FRENTE)) return { erro: `Escolha um dia de hoje até ${DIAS_A_FRENTE} dias à frente.` };
  if (!horaValida(de) || !horaValida(ate) || minutos(ate) <= minutos(de)) return { erro: "Diga de que horas até que horas pode." };
  if (nome.length < 2) return { erro: "Informe o nome." };
  if (!servico) return { erro: "Escolha o serviço." };
  if (bruto.replace(/\D/g, "") && !telefone) return { erro: "Confira o WhatsApp: DDD e número." };
  const profissionalId = b.profissionalId ? String(b.profissionalId) : null;
  if (profissionalId && !UUID.test(profissionalId)) return { erro: "Profissional inválido." };
  return { dados: { dia, de, ate, nome, servico, telefone, duracao_min: duracaoOk(b.duracao), profissional_id: profissionalId, observacao: texto(b.observacao, 200) } };
}

// Quem da lista cabe numa vaga: o mesmo dia, o horário que pode cruza o da vaga e, se pediu um barbeiro, é ele.
// A lista já vem na ordem de chegada (a prioridade).
function cabeNaVaga(e, vaga) {
  if (e.dia !== vaga.dia || !["esperando", "contatado"].includes(e.status)) return false;
  if (e.profissional_id && vaga.profissional_id && e.profissional_id !== vaga.profissional_id) return false;
  const ini = minutos(String(vaga.horario).slice(0, 5));
  return sobrepoe(ini, ini + (Number(vaga.duracao_min) || 30), minutos(e.de), minutos(e.ate));
}

// Para o cancelamento no painel: quem chamar, na ordem (até 6)
async function candidatosDaVaga(barbeariaId, vaga) {
  const lista = await rest(`lista_espera?barbearia_id=eq.${barbeariaId}&dia=eq.${vaga.dia}&status=in.(${ATIVOS})&select=${CAMPOS}&order=criado_em.asc&limit=100`).catch(() => []);
  return lista.filter((e) => cabeNaVaga(e, vaga)).slice(0, 6);
}

// ---------- o site: entrar na lista ----------
async function entrar(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ message: "Método não permitido." });
  try {
    const b = corpoDe(req);
    // Campo escondido no formulário: robô costuma preencher, pessoa não
    if (b.website) return res.status(201).json({ ok: true });
    const slug = texto(b.slug, 60).toLowerCase();
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) return res.status(400).json({ message: "Barbearia inválida." });
    const r = lerEntrada(b);
    if (r.erro) return res.status(400).json({ message: r.erro });
    if (!r.dados.telefone) return res.status(400).json({ message: "Informe seu WhatsApp com DDD: é por ele que a barbearia chama você." });
    const barb = (await rest(`barbearias?slug=eq.${slug}&select=id,demonstracao`))[0];
    if (!barb) return res.status(404).json({ message: "Barbearia não encontrada." });
    if (barb.demonstracao === "vitrine") return res.status(403).json({ message: "Esta é uma barbearia de demonstração: a lista de espera não é gravada.", demonstracao: true });
    const origem = origemDe(req);
    const desde = new Date(Date.now() - 864e5).toISOString();
    const recentes = await rest(`lista_espera?origem=eq.${origem}&criado_em=gte.${desde}&select=id`);
    if (recentes.length >= LIMITE_ORIGEM_DIA) return res.status(429).json({ message: "Você já entrou na lista várias vezes hoje. Fale com a barbearia pelo WhatsApp." });
    if (r.dados.profissional_id && !(await rest(`profissionais?id=eq.${r.dados.profissional_id}&barbearia_id=eq.${barb.id}&ativo=eq.true&select=id`)).length) r.dados.profissional_id = null;
    const cliente = (await rest(`clientes?barbearia_id=eq.${barb.id}&telefone=eq.${r.dados.telefone}&select=id`).catch(() => []))[0];
    const corpo = { ...r.dados, cliente_id: cliente ? cliente.id : null };
    // Já está na lista para esse dia (mesmo WhatsApp): atualiza o horário e o serviço, sem perder a vez
    const ja = (await rest(`lista_espera?barbearia_id=eq.${barb.id}&dia=eq.${r.dados.dia}&telefone=eq.${r.dados.telefone}&status=in.(${ATIVOS})&select=id`))[0];
    if (ja) await rest(`lista_espera?id=eq.${ja.id}`, { metodo: "PATCH", prefer: "return=minimal", corpo });
    else await rest("lista_espera", { metodo: "POST", prefer: "return=minimal", corpo: { ...corpo, barbearia_id: barb.id, origem, pelo_site: true } });
    const fila = await rest(`lista_espera?barbearia_id=eq.${barb.id}&dia=eq.${r.dados.dia}&status=in.(${ATIVOS})&select=telefone&order=criado_em.asc&limit=200`);
    const posicao = fila.findIndex((x) => x.telefone === r.dados.telefone) + 1;
    if (!ja) await avisarListaDeEspera({ barbearia_id: barb.id, nome: r.dados.nome, dia: r.dados.dia, de: r.dados.de, ate: r.dados.ate }).catch((e) => console.error("aviso da lista de espera:", e.message));
    return res.status(201).json({ ok: true, posicao, atualizado: !!ja });
  } catch (e) {
    return falha(res, e, "POST /api/pedido?espera");
  }
}

// ---------- o painel do dono: a aba Espera ----------
async function contexto(req) {
  const u = await usuarioDaRequisicao(req);
  if (!u) return { erro: [401, "Entre na sua conta para continuar."] };
  const perfil = await perfilDoContexto(u, req);
  if (!perfil || !perfil.barbearia_id) return { erro: [403, "Sua conta ainda não está ligada a uma barbearia."] };
  if (!ehAdmin(perfil)) return { erro: [403, "A lista de espera é do dono."] };
  return { barbeariaId: perfil.barbearia_id };
}

async function ler(ctx) {
  const b = ctx.barbeariaId;
  const hoje = hojeBr();
  const ate = somaDias(hoje, DIAS_DE_VAGAS);
  const [lista, cancelados, ativos, equipe] = await Promise.all([
    rest(`lista_espera?barbearia_id=eq.${b}&dia=gte.${hoje}&status=in.(${ATIVOS})&select=${CAMPOS}&order=dia.asc,criado_em.asc&limit=300`),
    rest(`pedidos?barbearia_id=eq.${b}&status=eq.cancelado&dia=gte.${hoje}&dia=lte.${ate}&simulado=eq.false&select=id,dia,horario,duracao_min,profissional_id,profissional,servico&order=dia.asc,horario.asc&limit=200`),
    rest(`pedidos?barbearia_id=eq.${b}&status=in.(pendente,confirmado,avulso,realizado)&dia=gte.${hoje}&dia=lte.${ate}&simulado=eq.false&select=dia,horario,duracao_min,profissional_id&limit=3000`),
    rest(`profissionais?barbearia_id=eq.${b}&select=id,nome,ativo&order=criado_em.asc`),
  ]);
  const nomes = {};
  equipe.forEach((p) => (nomes[p.id] = p.nome));
  const agora = agoraMinBr();
  const vistos = new Set();
  // Horários que vagaram: cancelados que ainda não passaram e que ninguém ocupou de novo, com quem da lista cabe
  const vagas = cancelados
    .filter((c) => !(c.dia === hoje && minutos(String(c.horario).slice(0, 5)) < agora))
    .filter((c) => {
      const ini = minutos(String(c.horario).slice(0, 5));
      const fim = ini + (Number(c.duracao_min) || 30);
      const chave = `${c.profissional_id}|${c.dia}|${ini}`;
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return !ativos.some((a) => a.profissional_id === c.profissional_id && a.dia === c.dia && sobrepoe(ini, fim, minutos(String(a.horario).slice(0, 5)), minutos(String(a.horario).slice(0, 5)) + (Number(a.duracao_min) || 30)));
    })
    .map((c) => ({ id: c.id, dia: c.dia, horario: String(c.horario).slice(0, 5), duracao_min: Number(c.duracao_min) || 30, profissional_id: c.profissional_id, profissional: c.profissional, servico: c.servico, fila: lista.filter((e) => cabeNaVaga(e, c)).map((e) => e.id) }))
    .filter((v) => v.fila.length);
  return {
    hoje,
    lista: lista.map((e) => ({ ...e, profissional: e.profissional_id ? nomes[e.profissional_id] || "" : "" })),
    vagas,
    profissionais: equipe.filter((p) => p.ativo).map((p) => ({ id: p.id, nome: p.nome })),
  };
}

// O dono coloca alguém na lista. Cliente escolhido na busca da carteira (clienteId): o nome e o WhatsApp vêm do
// cadastro (o painel só vê o final do número). Quem já está na lista desse dia é atualizado, sem perder a vez.
async function nova(res, ctx, b) {
  let cliente = null;
  if (b.clienteId) {
    if (!UUID.test(String(b.clienteId))) return res.status(400).json({ message: "Cliente inválido." });
    cliente = (await rest(`clientes?id=eq.${b.clienteId}&barbearia_id=eq.${ctx.barbeariaId}&select=id,nome,telefone`))[0];
    if (!cliente) return res.status(400).json({ message: "Cliente não encontrado na carteira." });
  }
  const r = lerEntrada(cliente ? { ...b, whatsapp: "", nome: b.nome || cliente.nome, telefone: b.telefone || normalizarWhats(cliente.telefone) } : b);
  if (r.erro) return res.status(400).json({ message: r.erro });
  if (r.dados.profissional_id && !(await rest(`profissionais?id=eq.${r.dados.profissional_id}&barbearia_id=eq.${ctx.barbeariaId}&select=id`)).length) {
    return res.status(400).json({ message: "Profissional não encontrado." });
  }
  if (!cliente && r.dados.telefone) cliente = (await rest(`clientes?barbearia_id=eq.${ctx.barbeariaId}&telefone=eq.${r.dados.telefone}&select=id`).catch(() => []))[0] || null;
  const corpo = { ...r.dados, cliente_id: cliente ? cliente.id : null };
  const quem = r.dados.telefone ? `telefone=eq.${r.dados.telefone}` : cliente ? `cliente_id=eq.${cliente.id}` : "";
  const ja = quem ? (await rest(`lista_espera?barbearia_id=eq.${ctx.barbeariaId}&dia=eq.${r.dados.dia}&status=in.(${ATIVOS})&${quem}&select=id`))[0] : null;
  if (ja) {
    const mudar = { ...corpo };
    if (!mudar.telefone) delete mudar.telefone; // sem número agora: mantém o que já estava na lista
    const [e] = await rest(`lista_espera?id=eq.${ja.id}&barbearia_id=eq.${ctx.barbeariaId}`, { metodo: "PATCH", prefer: "return=representation", corpo: mudar });
    return res.status(200).json({ entrada: e, atualizado: true });
  }
  const [e] = await rest("lista_espera", { metodo: "POST", prefer: "return=representation", corpo: { ...corpo, barbearia_id: ctx.barbeariaId, pelo_site: false } });
  return res.status(201).json({ entrada: e });
}

async function mudarStatus(res, ctx, b) {
  const id = String(b.id || "");
  if (!UUID.test(id)) return res.status(400).json({ message: "Registro inválido." });
  if (!STATUS.includes(b.status)) return res.status(400).json({ message: "Situação inválida." });
  const corpo = { status: b.status, ...(b.status === "contatado" ? { contatado_em: new Date().toISOString() } : {}) };
  const [e] = await rest(`lista_espera?id=eq.${id}&barbearia_id=eq.${ctx.barbeariaId}`, { metodo: "PATCH", prefer: "return=representation", corpo });
  if (!e) return res.status(404).json({ message: "Registro não encontrado." });
  return res.status(200).json({ entrada: e });
}

async function area(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const ctx = await contexto(req);
    if (ctx.erro) return res.status(ctx.erro[0]).json({ message: ctx.erro[1] });
    if (req.method === "GET") return res.status(200).json(await ler(ctx));
    if (req.method !== "POST") return res.status(405).json({ message: "Método não permitido." });
    const b = corpoDe(req);
    if (b.acao === "nova") return await nova(res, ctx, b);
    if (b.acao === "status") return await mudarStatus(res, ctx, b);
    return res.status(400).json({ message: "Ação desconhecida." });
  } catch (e) {
    return falha(res, e, `${req.method} /api/equipe?area=espera`);
  }
}

module.exports = { area, entrar, candidatosDaVaga, cabeNaVaga, lerEntrada };
