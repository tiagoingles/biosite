// WhatsApp automático (plano Premium), em modo de teste.
// A barbearia escolhe as mensagens automáticas e o texto de cada uma. Enquanto o WhatsApp oficial dela
// não estiver conectado (conta da Meta, fase 2), nada é enviado: o painel mostra a prévia do que sairia
// nos próximos 7 dias e quanto custaria na Meta.
// GET  /api/equipe?area=clientes&premium=1                 automações, prévia e custo (só o dono)
// POST /api/equipe?area=clientes { acao: "automacao-salvar", tipo, ativa, texto, config }
// Regras (como as dos melhores sistemas): lembrete só para quem tem horário confirmado; promoção só para
// quem aceitou receber novidades, nunca para quem tem horário marcado, no máximo uma por cliente por
// semana e nunca para quem recebeu campanha há pouco. Banco: whatsapp_automacoes (fase 15).
const { rest } = require("./supabase");
const { barbeariaDe } = require("./conta");
const { texto: limparTexto } = require("./agenda");
const { hojeBr, agoraMinBr, somaDias, minutos, hora } = require("./horarios");

// Preço por mensagem entregue no Brasil (Meta, outubro de 2026; estimativa para o painel)
const PRECO = { utilidade: 0.035, marketing: 0.32 };
const DIAS_PREVIA = 7;

const AUTOMACOES = [
  { tipo: "lembrete_vespera", nome: "Lembrete na véspera", categoria: "utilidade", quando: "Na véspera, às 18h",
    texto: "Olá, {nome}! Lembrete do seu horário amanhã, {dia} às {hora}, na {barbearia}. Precisa remarcar? É só responder esta mensagem." },
  { tipo: "lembrete_2h", nome: "Lembrete 2 horas antes", categoria: "utilidade", quando: "2 horas antes do horário",
    texto: "Olá, {nome}! Seu horário na {barbearia} é hoje às {hora}. Até já!" },
  { tipo: "pos_atendimento", nome: "Obrigado e avaliação", categoria: "utilidade", quando: "1 hora depois do atendimento",
    texto: "Obrigado pela visita, {nome}! Se curtiu o resultado, deixa sua avaliação no Google, ajuda muito a {barbearia}: {avaliacao}", config: { avaliacao: "" } },
  { tipo: "retorno", nome: "Hora de voltar", categoria: "marketing", quando: "Quando passa do ritmo do cliente",
    texto: "Olá, {nome}! Já faz {dias} dias do seu último corte na {barbearia}. Bora deixar o visual em dia? Agende pelo link: {site}" },
  { tipo: "reconquista", nome: "Reconquista", categoria: "marketing", quando: "Quando o cliente some (3 vezes o ritmo)",
    texto: "Olá, {nome}! Sentimos sua falta na {barbearia}. {oferta} Agende pelo link: {site}", config: { oferta: "Volte esta semana e ganhe 10% de desconto." } },
  { tipo: "aniversario", nome: "Aniversário", categoria: "marketing", quando: "No dia do aniversário, às 9h",
    texto: "Feliz aniversário, {nome}! 🎉 A {barbearia} preparou um mimo para você: {oferta} Agende pelo link: {site}", config: { oferta: "a barba desta semana é por nossa conta." } },
  { tipo: "clube_vencimento", nome: "Vencimento do clube", categoria: "utilidade", quando: "3 dias antes do vencimento",
    texto: "Olá, {nome}! A mensalidade do seu plano {plano} da {barbearia} vence em {vencimento}. Assim você continua marcando pelo clube sem parar." },
];
const DEF = Object.fromEntries(AUTOMACOES.map((a) => [a.tipo, a]));
// Uma promoção por cliente por semana: vale a mais importante
const PRIORIDADE = ["aniversario", "reconquista", "retorno"];

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const primeiroNome = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const dataBr = (iso) => `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}`;
const hm = (t) => String(t || "").slice(0, 5);
function preencher(texto, v) {
  return String(texto || "").replace(/\{(\w+)\}/g, (m, k) => (v[k] === undefined || v[k] === null ? "" : String(v[k]))).replace(/ {2,}/g, " ").trim();
}

// Configuração salva + padrão de cada automação
function configuracao(linhas) {
  const salvo = new Map((linhas || []).map((l) => [l.tipo, l]));
  return AUTOMACOES.map((a) => {
    const s = salvo.get(a.tipo) || {};
    const config = { ...(a.config || {}), ...(s.config || {}) };
    const pendencia = a.tipo === "pos_atendimento" && !config.avaliacao ? "Cole o link de avaliação do Google para ligar esta mensagem." : "";
    return { ...a, ativa: s.ativa !== false, texto: s.texto || a.texto, config, pendencia };
  });
}

// Prévia: o que o Premium mandaria de hoje até daqui a 6 dias.
// clientes: lista da carteira (lib/clientes.js), pedidos: horários confirmados com o cadastro do cliente,
// assinantes: clube, contatos: Map cliente_id -> última campanha recebida (ISO).
function previa({ hoje = hojeBr(), agoraMin = agoraMinBr(), automacoes, clientes = [], pedidos = [], assinantes = [], contatos = new Map(), barbearia = "", site = "" }) {
  const fim = somaDias(hoje, DIAS_PREVIA - 1);
  const cfg = new Map(automacoes.map((a) => [a.tipo, a]));
  const ligada = (t) => { const a = cfg.get(t); return !!a && a.ativa && !a.pendencia; };
  const msgs = [];
  function poe(tipo, dia, horario, alvo, vars) {
    const a = cfg.get(tipo);
    msgs.push({ tipo, nome: a.nome, categoria: a.categoria, dia, horario, cliente: alvo.nome, telefone: alvo.telefone, texto: preencher(a.texto, { barbearia, site, ...a.config, nome: primeiroNome(alvo.nome), ...vars }) });
  }

  // Lembretes e obrigado: horários confirmados de quem tem WhatsApp no cadastro
  for (const p of pedidos) {
    const tel = p.clientes && p.clientes.telefone;
    if (!tel || !["confirmado", "avulso"].includes(p.status)) continue;
    const alvo = { nome: (p.clientes && p.clientes.nome) || p.cliente, telefone: tel };
    const vars = { dia: dataBr(p.dia), hora: hm(p.horario), servico: p.servico, profissional: p.profissional };
    const ini = minutos(hm(p.horario));
    const vespera = somaDias(p.dia, -1);
    if (ligada("lembrete_vespera") && vespera >= hoje && vespera <= fim && (vespera > hoje || agoraMin < 18 * 60)) poe("lembrete_vespera", vespera, "18:00", alvo, vars);
    if (ligada("lembrete_2h") && p.dia >= hoje && p.dia <= fim && (p.dia > hoje || ini - 120 > agoraMin)) poe("lembrete_2h", p.dia, hora(Math.max(0, ini - 120)), alvo, vars);
    const depois = ini + (Number(p.duracao_min) || 30) + 60;
    if (ligada("pos_atendimento") && p.dia >= hoje && p.dia <= fim && (p.dia > hoje || depois > agoraMin) && depois < 24 * 60) poe("pos_atendimento", p.dia, hora(depois), alvo, vars);
  }

  // Promoções: só quem aceitou, tem WhatsApp, não saiu e não tem horário marcado; uma por cliente na semana
  const escolhida = new Map();
  function candidata(c, tipo, dia, vars) {
    const atual = escolhida.get(c.id);
    if (atual && PRIORIDADE.indexOf(atual.tipo) <= PRIORIDADE.indexOf(tipo)) return;
    escolhida.set(c.id, { c, tipo, dia, vars });
  }
  const contatadoDesde = (id, dias) => (contatos.get(id) || "") >= somaDias(hoje, -dias);
  for (const c of clientes) {
    if (!c.aceita || !c.telefone) continue;
    if (ligada("aniversario") && c.aniversario && c.aniversario.diasAte < DIAS_PREVIA) candidata(c, "aniversario", somaDias(hoje, c.aniversario.diasAte), {});
    if (c.status === "agendado" || !c.ultima) continue;
    const ref = c.ciclo || 30;
    // Mesmos limites da carteira: atrasado depois de 1,5 ciclo; sumido depois de 3 ciclos (mín. 60 dias)
    const atrasaEm = somaDias(c.ultima, Math.floor(ref * 1.5) + 1);
    const someEm = somaDias(c.ultima, Math.max(ref * 3, 60) + 1);
    const dias = (dia) => Math.round((Date.parse(dia + "T00:00:00Z") - Date.parse(c.ultima + "T00:00:00Z")) / 864e5);
    if (ligada("reconquista") && c.status !== "perdido" && someEm <= fim && !contatadoDesde(c.id, 30)) {
      const dia = someEm > hoje ? someEm : hoje;
      candidata(c, "reconquista", dia, { dias: dias(dia) });
    } else if (ligada("retorno") && ["novo", "em_dia", "atrasado"].includes(c.status) && atrasaEm <= fim && !contatadoDesde(c.id, 14)) {
      const dia = atrasaEm > hoje ? atrasaEm : hoje;
      candidata(c, "retorno", dia, { dias: dias(dia) });
    }
  }
  for (const { c, tipo, dia, vars } of escolhida.values()) poe(tipo, dia, "09:00", c, vars);

  // Clube: 3 dias antes do vencimento, direto para o assinante
  for (const a of assinantes) {
    if (!ligada("clube_vencimento") || !a.whatsapp || !a.pago_ate) continue;
    const dia = somaDias(String(a.pago_ate).slice(0, 10), -3);
    if (dia >= hoje && dia <= fim) poe("clube_vencimento", dia, "09:00", { nome: a.nome, telefone: a.whatsapp }, { plano: (a.clube_planos && a.clube_planos.nome) || "", vencimento: dataBr(a.pago_ate) });
  }

  msgs.sort((a, b) => (a.dia + a.horario).localeCompare(b.dia + b.horario) || a.cliente.localeCompare(b.cliente, "pt-BR"));
  const porTipo = {};
  for (const m of msgs) porTipo[m.tipo] = (porTipo[m.tipo] || 0) + 1;
  const custo = msgs.reduce((t, m) => t + PRECO[m.categoria], 0);
  return { de: hoje, ate: fim, mensagens: msgs, porTipo, custoSemana: r2(custo), custoMes: r2((custo * 30) / DIAS_PREVIA) };
}

function origemSite(req) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? `https://${host}` : "";
}

// carteira: a função dados() de lib/clientes.js (passada para não haver dependência circular)
// O WhatsApp automático é do plano Premium (fase 33): só na barbearia com whatsapp_premium. Por enquanto, só a
// Barbearia Modelo, para os testes da integração com a Meta; nas outras o cartão some e nada é salvo.
async function liberado(barbeariaId) {
  const b = await rest(`barbearias?id=eq.${barbeariaId}&select=whatsapp_premium`);
  return !!(b[0] && b[0].whatsapp_premium);
}

async function dados(ctx, req, carteira) {
  if (!(await liberado(ctx.barbeariaId))) return { disponivel: false };
  const hoje = hojeBr();
  const id = ctx.barbeariaId;
  const [lista, pedidos, assinantes, linhas, envios, barb] = await Promise.all([
    carteira(ctx),
    rest(`pedidos?barbearia_id=eq.${id}&dia=gte.${hoje}&dia=lte.${somaDias(hoje, DIAS_PREVIA)}&status=in.(confirmado,avulso)&select=id,dia,horario,duracao_min,cliente,servico,profissional,status,cliente_id,clientes(nome,telefone)&order=dia.asc,horario.asc&limit=1000`),
    rest(`clube_assinantes?barbearia_id=eq.${id}&status=eq.ativo&select=nome,whatsapp,pago_ate,clube_planos(nome)&limit=2000`),
    rest(`whatsapp_automacoes?barbearia_id=eq.${id}&select=tipo,ativa,texto,config`),
    rest(`campanha_envios?enviado_em=gte.${somaDias(hoje, -30)}T00:00:00Z&select=cliente_id,enviado_em,campanhas!inner(barbearia_id)&campanhas.barbearia_id=eq.${id}&limit=5000`),
    barbeariaDe(id),
  ]);
  const contatos = new Map();
  for (const e of envios) {
    const dia = new Date(Date.parse(e.enviado_em) - 3 * 36e5).toISOString().slice(0, 10);
    if (!contatos.has(e.cliente_id) || contatos.get(e.cliente_id) < dia) contatos.set(e.cliente_id, dia);
  }
  const automacoes = configuracao(linhas);
  const site = barb && barb.slug ? `${origemSite(req)}/${barb.slug}` : "";
  return {
    modo: "teste",
    precos: PRECO,
    automacoes: automacoes.map(({ tipo, nome, categoria, quando, ativa, texto, config, pendencia }) => ({ tipo, nome, categoria, quando, ativa, texto, config, pendencia, padrao: DEF[tipo].texto })),
    previa: previa({ hoje, automacoes, clientes: lista.clientes, pedidos, assinantes, contatos, barbearia: barb ? barb.nome : "", site }),
  };
}

// Salva uma automação (liga/desliga, texto e ajustes)
async function salvar(res, ctx, b) {
  if (!(await liberado(ctx.barbeariaId))) return res.status(403).json({ message: "O WhatsApp automático é do plano Premium." });
  const a = DEF[b.tipo];
  if (!a) return res.status(400).json({ message: "Automação desconhecida." });
  const corpo = { barbearia_id: ctx.barbeariaId, tipo: a.tipo, atualizado_em: new Date().toISOString() };
  const atual = (await rest(`whatsapp_automacoes?barbearia_id=eq.${ctx.barbeariaId}&tipo=eq.${a.tipo}&select=ativa,texto,config`))[0] || {};
  corpo.ativa = typeof b.ativa === "boolean" ? b.ativa : atual.ativa !== false;
  const texto = b.texto === undefined ? atual.texto || a.texto : String(b.texto || "").trim();
  if (texto.length < 10 || texto.length > 700) return res.status(400).json({ message: "A mensagem precisa ter de 10 a 700 caracteres." });
  corpo.texto = texto;
  const config = { ...(atual.config || {}) };
  if (b.config && typeof b.config === "object") {
    if ("oferta" in b.config && "oferta" in (a.config || {})) config.oferta = limparTexto(b.config.oferta, 160);
    if ("avaliacao" in b.config && a.tipo === "pos_atendimento") {
      const link = String(b.config.avaliacao || "").trim();
      if (link && !/^https:\/\/[^\s]{6,300}$/.test(link)) return res.status(400).json({ message: "Cole o link de avaliação completo, começando com https://" });
      config.avaliacao = link;
    }
  }
  corpo.config = config;
  await rest("whatsapp_automacoes?on_conflict=barbearia_id,tipo", { metodo: "POST", prefer: "resolution=merge-duplicates,return=minimal", corpo });
  return res.status(200).json({ ok: true });
}

module.exports = { AUTOMACOES, PRECO, previa, configuracao, preencher, dados, salvar, liberado };
