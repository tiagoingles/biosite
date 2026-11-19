// Carteira de clientes da barbearia: cadastro, importação da planilha, retorno no ritmo de cada cliente
// (dias sem voltar), aniversariantes, convite de cadastro pelo celular do cliente e campanhas enviadas
// uma a uma pelo WhatsApp do dono, com o resultado (quantos voltaram).
// GET  /api/equipe?area=clientes                 lista com o retorno de cada cliente, números e segmentos
// GET  /api/equipe?area=clientes&id=<uuid>       ficha do cliente: visitas e campanhas recebidas
// GET  /api/equipe?area=clientes&campanhas=1     campanhas com o resultado
// GET  /api/equipe?area=clientes&premium=1       WhatsApp automático (Premium): automações e prévia (lib/automacoes.js)
// POST /api/equipe?area=clientes { acao, ... }   "salvar", "apagar", "importar", "convite", "vincular",
//                                                 "campanha-criar", "campanha-envio", "automacao-salvar",
//                                                 "aviso" (aviso no celular para um cliente ou um grupo: lib/avisos-clientes.js)
// Público, em /api/pedido: GET e POST ?convite=<token> (o cliente se cadastra pelo link, no próprio celular).
// O dono vê tudo. O barbeiro vê a própria carteira (quem ele cadastrou ou atendeu), sem CPF.
// Banco: fase 14 (clientes, clientes_convites, campanhas, campanha_envios, cliente_do_agendamento,
// cliente_do_convite). O agendamento continua sem conta: o cliente é reconhecido pelo WhatsApp.
const crypto = require("crypto");
const { rest, todas } = require("./supabase");
const { usuarioDaRequisicao, perfilDoContexto, ehAdmin, papelDemo, profissionalDemo } = require("./conta");
const { texto } = require("./agenda");
const { hojeBr, somaDias, dataValida } = require("./horarios");
const { falha, corpoDe, UUID, origemDe, contarTentativas } = require("./seguranca");
const { normalizarWhats } = require("./clube");
const automacoes = require("./automacoes");
const avisosClientes = require("./avisos-clientes");

const MAX_IMPORTACAO = 2000;
const VALIDADE_CONVITE_DIAS = 3;
const ANO_SEM_ANO = 1904; // aniversário sem ano (dd/mm): guardado com 1904, que tem 29/02
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

// ---------- dados do cliente ----------
const soDigitos = (v) => String(v == null ? "" : v).replace(/\D/g, "");

// CPF: 11 números com os dois dígitos verificadores certos (e não todos iguais)
function cpfValido(v) {
  const c = soDigitos(v);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (let t = 9; t < 11; t++) {
    let s = 0;
    for (let i = 0; i < t; i++) s += Number(c[i]) * (t + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(c[t])) return false;
  }
  return true;
}
const mascararCpf = (c) => (c && c.length === 11 ? `***.${c.slice(3, 6)}.${c.slice(6, 9)}-**` : "");

// Data como a pessoa digita ou a planilha traz: 20/05/1990, 20/5/90, 1990-05-20, 20-05-1990, 20.05.1990
// ou só dia e mês (20/05, para aniversário). Devolve "" se vazio e null se inválido.
function lerData(v, { semAno = false, hoje = hojeBr() } = {}) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  let a, m, d;
  let x = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (x) [a, m, d] = [Number(x[1]), Number(x[2]), Number(x[3])];
  else if ((x = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s))) {
    [d, m, a] = [Number(x[1]), Number(x[2]), Number(x[3])];
    if (x[3].length === 2) a += a > Number(hoje.slice(2, 4)) ? 1900 : 2000;
  } else if (semAno && (x = /^(\d{1,2})[/.-](\d{1,2})$/.exec(s))) [d, m, a] = [Number(x[1]), Number(x[2]), ANO_SEM_ANO];
  else return null;
  const iso = `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return dataValida(iso) && a >= 1900 ? iso : null;
}

const diasEntre = (de, ate) => Math.round((Date.parse(ate + "T00:00:00Z") - Date.parse(de + "T00:00:00Z")) / 864e5);

function mediana(lista) {
  const v = [...lista].sort((a, b) => a - b);
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio] : Math.round((v[meio - 1] + v[meio]) / 2);
}

// Retorno no ritmo do cliente. ciclo = intervalo mediano entre as visitas (sem histórico, 30 dias).
// em dia até 1,5 ciclo; atrasado até 3 ciclos (mín. 60 dias); sumido até 4 ciclos (mín. 180); depois, perdido.
// Quem tem horário marcado está "agendado": não é para chamar.
// Quem veio de outro aplicativo (migração) traz o ritmo de lá (cicloExterno, fase 29): ele vale até o cliente ter
// 3 intervalos aqui, em vez de supor 30 dias; e quem tem visitas lá não conta como "novo".
const INTERVALOS_PROPRIOS = 3;
function retorno({ dias = [], externa = null, proximo = null, cicloExterno = null, visitasExternas = 0 }, hoje = hojeBr()) {
  const visitas = [...new Set(dias.filter((d) => d <= hoje))].sort();
  const linha = externa && (!visitas.length || externa < visitas[0]) ? [externa, ...visitas] : visitas;
  const ultima = linha.length ? linha[linha.length - 1] : null;
  const intervalos = linha.slice(1).map((d, i) => diasEntre(linha[i], d)).filter((n) => n > 0);
  const daqui = intervalos.length ? mediana(intervalos) : null;
  const base = cicloExterno > 0 && intervalos.length < INTERVALOS_PROPRIOS ? cicloExterno : daqui;
  const ciclo = base ? Math.min(120, Math.max(7, base)) : null;
  const ref = ciclo || 30;
  const diasSem = ultima ? diasEntre(ultima, hoje) : null;
  let status;
  if (proximo) status = "agendado";
  else if (!ultima) status = "sem_visita";
  else if (diasSem <= ref * 1.5) status = linha.length <= 1 && !(visitasExternas > 1) ? "novo" : "em_dia";
  else if (diasSem <= Math.max(ref * 3, 60)) status = "atrasado";
  else if (diasSem <= Math.max(ref * 4, 180)) status = "sumido";
  else status = "perdido";
  return { visitas: visitas.length, ultima, ciclo, diasSem, previsao: ultima ? somaDias(ultima, ref) : null, status, proximo };
}

// Próximo aniversário: { dia: "20/05", diasAte }
function aniversario(nascimento, hoje = hojeBr()) {
  if (!nascimento) return null;
  const [, m, d] = String(nascimento).slice(0, 10).split("-");
  const ano = Number(hoje.slice(0, 4));
  const valido = (a) => dataValida(`${a}-${m}-${d}`);
  // 29/02 em ano que não é bissexto: comemora em 28/02
  const data = (a) => (valido(a) ? `${a}-${m}-${d}` : `${a}-02-28`);
  let prox = data(ano);
  if (prox < hoje) prox = data(ano + 1);
  return { dia: `${d}/${m}`, diasAte: diasEntre(hoje, prox), mes: Number(m) };
}

// Segmentos da lista (o painel mostra um botão para cada um)
function segmentosDe(c, mesAtual) {
  const s = [];
  if (c.status === "atrasado") s.push("chamar");
  if (c.visitas === 1 && c.status !== "agendado" && c.diasSem >= 21 && c.diasSem <= 90) s.push("segunda");
  if (c.status === "sumido" || c.status === "perdido") s.push("sumidos");
  if (c.aniversario && c.aniversario.mes === mesAtual) s.push("aniversario");
  return s;
}

// ---------- leitura ----------
async function contexto(req) {
  const u = await usuarioDaRequisicao(req);
  if (!u) return { erro: [401, "Entre na sua conta para continuar."] };
  const perfil = await perfilDoContexto(u, req);
  if (!perfil || !perfil.barbearia_id) return { erro: [403, "Sua conta ainda não está ligada a uma barbearia."] };
  if (ehAdmin(perfil)) return { u, perfil, barbeariaId: perfil.barbearia_id, dono: true, meu: null };
  const prof = papelDemo(u.id) ? [await profissionalDemo("id")].filter(Boolean) : await rest(`profissionais?perfil_user_id=eq.${u.id}&barbearia_id=eq.${perfil.barbearia_id}&select=id`);
  if (!prof.length) return { erro: [403, "Seu perfil não tem carteira de clientes."] };
  return { u, perfil, barbeariaId: perfil.barbearia_id, dono: false, meu: prof[0].id };
}

const CAMPOS_CLIENTE = "id,nome,telefone,cpf,nascimento,observacao,profissional_id,origem,ultima_visita_externa,aceita_novidades,aceite_em,aceite_origem,saiu_em,criado_em,externo,visitas_externas,ciclo_externo";

async function dados(ctx) {
  const hoje = hojeBr();
  const { barbeariaId } = ctx;
  const [clientes, pedidos, equipe, aparelhos] = await Promise.all([
    todas(`clientes?barbearia_id=eq.${barbeariaId}&select=${CAMPOS_CLIENTE}&order=id`),
    todas(`pedidos?barbearia_id=eq.${barbeariaId}&cliente_id=not.is.null&dia=gte.${somaDias(hoje, -730)}&status=in.(realizado,pendente,confirmado,avulso)&select=cliente_id,dia,status,valor,profissional_id&order=id`),
    rest(`profissionais?barbearia_id=eq.${barbeariaId}&select=id,nome`),
    // Quem ligou os avisos da barbearia no celular (o app): só o dono manda avisos
    ctx.dono ? avisosClientes.aparelhosDaCarteira(barbeariaId) : { app: new Map(), semCadastro: 0 },
  ]);
  const nomeDe = new Map(equipe.map((p) => [p.id, p.nome]));
  const porCliente = new Map();
  for (const p of pedidos) {
    if (!porCliente.has(p.cliente_id)) porCliente.set(p.cliente_id, []);
    porCliente.get(p.cliente_id).push(p);
  }
  const mesAtual = Number(hoje.slice(5, 7));
  let lista = clientes.map((c) => {
    const meus = porCliente.get(c.id) || [];
    const feitos = meus.filter((p) => p.status === "realizado" && p.dia <= hoje);
    const futuros = meus.filter((p) => p.status !== "realizado" && p.dia >= hoje).map((p) => p.dia).sort();
    const r = retorno({ dias: feitos.map((p) => p.dia), externa: c.ultima_visita_externa, proximo: futuros[0] || null, cicloExterno: c.ciclo_externo, visitasExternas: c.visitas_externas }, hoje);
    const pagos = feitos.filter((p) => Number(p.valor) > 0);
    const gasto = pagos.reduce((t, p) => t + Number(p.valor), 0);
    // Barbeiro que mais atendeu (ou o de referência do cadastro)
    const conta = new Map();
    for (const p of feitos) if (p.profissional_id) conta.set(p.profissional_id, (conta.get(p.profissional_id) || 0) + 1);
    const preferido = [...conta.entries()].sort((a, b) => b[1] - a[1])[0];
    const barbeiroId = preferido ? preferido[0] : c.profissional_id;
    const item = {
      id: c.id,
      nome: c.nome,
      telefone: c.telefone || "",
      cpfMascarado: ctx.dono ? mascararCpf(c.cpf) : "",
      nascimento: c.nascimento && ctx.dono ? c.nascimento : null,
      aniversario: aniversario(c.nascimento, hoje),
      observacao: c.observacao || "",
      origem: c.origem,
      aceita: !!c.aceita_novidades && !c.saiu_em,
      saiu: !!c.saiu_em,
      profissional_id: c.profissional_id,
      barbeiro: barbeiroId ? nomeDe.get(barbeiroId) || "" : "",
      atendidoPor: [...conta.keys()],
      ...r,
      gasto: Math.round(gasto * 100) / 100,
      ticket: pagos.length ? Math.round((gasto / pagos.length) * 100) / 100 : 0,
      // Atendimentos no aplicativo anterior (migração): o cartão mostra ao lado das visitas daqui
      visitasExternas: c.visitas_externas || 0,
      criado_em: c.criado_em,
      app: aparelhos.app.has(c.id),
      appNovidades: !!(aparelhos.app.get(c.id) || {}).novidades,
    };
    item.segmentos = segmentosDe(item, mesAtual);
    return item;
  });
  // Carteira do barbeiro: quem ele cadastrou ou já atendeu
  if (!ctx.dono) lista = lista.filter((c) => c.profissional_id === ctx.meu || c.atendidoPor.includes(ctx.meu));
  lista.forEach((c) => delete c.atendidoPor);
  lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  // Números: taxa de 2ª visita entre quem veio pela 1ª vez há 45 a 180 dias
  const inicioMes = hoje.slice(0, 8) + "01";
  const primeiras = new Map();
  for (const p of pedidos) if (p.status === "realizado" && p.dia <= hoje) {
    const atual = primeiras.get(p.cliente_id);
    if (!atual || p.dia < atual) primeiras.set(p.cliente_id, p.dia);
  }
  const daJanela = lista.filter((c) => {
    const pri = primeiras.get(c.id);
    return pri && !c.ultima_visita_externa && diasEntre(pri, hoje) >= 45 && diasEntre(pri, hoje) <= 180;
  });
  const voltaram = daJanela.filter((c) => c.visitas >= 2).length;
  const conta = (seg) => lista.filter((c) => c.segmentos.includes(seg)).length;
  return {
    hoje,
    dono: ctx.dono,
    clientes: lista,
    equipe: equipe.map((p) => ({ id: p.id, nome: p.nome })),
    kpis: {
      total: lista.length,
      comWhats: lista.filter((c) => c.telefone).length,
      aceitam: lista.filter((c) => c.aceita).length,
      comApp: lista.filter((c) => c.app).length,
      appSemCadastro: aparelhos.semCadastro,
      // Cartão "Avisos no celular" (só o dono): aparelhos, com e sem cadastro, novidades, iPhone e Android
      avisos: aparelhos.resumo || null,
      ativos: lista.filter((c) => ["novo", "em_dia", "agendado"].includes(c.status)).length,
      // Novos no mês: 1ª visita (ou cadastro, sem visita) neste mês; quem veio da planilha já era cliente
      novosMes: lista.filter((c) => c.origem !== "importacao" && (primeiras.get(c.id) || (c.visitas ? "" : String(c.criado_em).slice(0, 10))) >= inicioMes).length,
      taxaSegundaVisita: daJanela.length >= 5 ? Math.round((voltaram / daJanela.length) * 100) : null,
      baseSegundaVisita: daJanela.length,
    },
    segmentos: { chamar: conta("chamar"), segunda: conta("segunda"), sumidos: conta("sumidos"), aniversario: conta("aniversario") },
  };
}

// Ficha do cliente: dados completos (CPF só para o dono), visitas e campanhas recebidas
async function ficha(ctx, id) {
  const c = (await rest(`clientes?id=eq.${id}&barbearia_id=eq.${ctx.barbeariaId}&select=${CAMPOS_CLIENTE}`))[0];
  if (!c) return null;
  const [visitas, envios, externos] = await Promise.all([
    rest(`pedidos?cliente_id=eq.${id}&barbearia_id=eq.${ctx.barbeariaId}&select=id,dia,horario,servico,profissional,profissional_id,status,valor&order=dia.desc,horario.desc&limit=60`),
    ctx.dono ? rest(`campanha_envios?cliente_id=eq.${id}&select=enviado_em,campanhas(nome)&order=enviado_em.desc&limit=20`) : [],
    // Atendimentos do aplicativo anterior (fase 28, migração do Booksy): só para a ficha, fora do financeiro
    rest(`atendimentos_externos?cliente_id=eq.${id}&barbearia_id=eq.${ctx.barbeariaId}&select=dia,horario,servico,profissional,profissional_id,status,origem&order=dia.desc,horario.desc&limit=300`).catch(() => []),
  ]);
  // O barbeiro vê a ficha de quem ele cadastrou ou atendeu (aqui ou no aplicativo anterior)
  const atendeu = (lista) => lista.some((v) => v.profissional_id === ctx.meu && v.status === "realizado");
  if (!ctx.dono && c.profissional_id !== ctx.meu && !atendeu(visitas) && !atendeu(externos)) return null;
  return {
    cliente: {
      // O barbeiro vê só o dia e o mês do aniversário (o ano revela a idade e não serve para ele)
      id: c.id, nome: c.nome, telefone: c.telefone || "", nascimento: ctx.dono ? c.nascimento : null,
      aniversario: c.nascimento ? String(c.nascimento).slice(8, 10) + "/" + String(c.nascimento).slice(5, 7) : "", observacao: c.observacao || "",
      cpf: ctx.dono ? c.cpf || "" : "", cpfMascarado: ctx.dono ? mascararCpf(c.cpf) : "",
      origem: c.origem, profissional_id: c.profissional_id, ultima_visita_externa: c.ultima_visita_externa,
      // De qual aplicativo o cadastro veio numa migração (externo = "booksy:<id>"), para a ficha dizer
      veioDe: /^booksy:/.test(String(c.externo || "")) ? "booksy" : null,
      aceita: !!c.aceita_novidades && !c.saiu_em, aceite_em: c.aceite_em, aceite_origem: c.aceite_origem, saiu_em: c.saiu_em,
      criado_em: c.criado_em,
    },
    visitas: visitas.map((v) => ({ id: v.id, dia: v.dia, horario: v.horario, servico: v.servico, profissional: v.profissional, status: v.status, valor: v.valor == null ? null : Number(v.valor) })),
    campanhas: envios.map((e) => ({ nome: (e.campanhas || {}).nome || "", enviado_em: e.enviado_em })),
    // Histórico no aplicativo anterior: a tela mostra separado, com o nome do app (origem)
    anteriores: externos.map((v) => ({ dia: v.dia, horario: v.horario, servico: v.servico || "", profissional: v.profissional || "", status: v.status, origem: v.origem })),
  };
}

// Campanhas com o resultado: quem fez um atendimento até 30 dias depois da mensagem "voltou"
async function campanhas(ctx) {
  const lista = await rest(`campanhas?barbearia_id=eq.${ctx.barbeariaId}&select=id,nome,segmento,mensagem,criado_em&order=criado_em.desc&limit=30`);
  if (!lista.length) return { campanhas: [] };
  const ids = lista.map((c) => c.id);
  const envios = await todas(`campanha_envios?campanha_id=in.(${ids.join(",")})&select=campanha_id,cliente_id,enviado_em&order=campanha_id`);
  const clientes = [...new Set(envios.map((e) => e.cliente_id))];
  const desde = envios.reduce((m, e) => (e.enviado_em < m ? e.enviado_em : m), new Date().toISOString()).slice(0, 10);
  const feitos = clientes.length
    ? await todas(`pedidos?barbearia_id=eq.${ctx.barbeariaId}&cliente_id=in.(${clientes.join(",")})&status=eq.realizado&dia=gte.${desde}&select=cliente_id,dia,valor&order=id`)
    : [];
  return {
    campanhas: lista.map((c) => {
      const meus = envios.filter((e) => e.campanha_id === c.id);
      let voltaram = 0;
      let faturou = 0;
      for (const e of meus) {
        const dia = new Date(Date.parse(e.enviado_em) - 3 * 36e5).toISOString().slice(0, 10);
        const ate = somaDias(dia, 30);
        const depois = feitos.filter((p) => p.cliente_id === e.cliente_id && p.dia >= dia && p.dia <= ate);
        if (depois.length) voltaram++;
        faturou += depois.reduce((t, p) => t + Number(p.valor || 0), 0);
      }
      return { ...c, enviados: meus.length, voltaram, faturou: Math.round(faturou * 100) / 100 };
    }),
  };
}

// ---------- gravação ----------
function erro400(res, message) {
  return res.status(400).json({ message });
}

// Telefone ou CPF repetido na barbearia (restrição única do banco) -> mensagem clara
function repetido(e) {
  const m = String((e && e.message) || "");
  if (/clientes_telefone_unico/.test(m)) return "Já existe um cliente com este WhatsApp.";
  if (/clientes_cpf_unico/.test(m)) return "Já existe um cliente com este CPF.";
  return "";
}

// Campos do formulário do painel -> { corpo } ou { erro }
function lerCampos(b, { dono }) {
  const nome = texto(b.nome, 80);
  if (nome.length < 2) return { erro: "Informe o nome do cliente." };
  const temTel = soDigitos(b.telefone).length > 0;
  const telefone = temTel ? normalizarWhats(b.telefone) : "";
  if (temTel && !telefone) return { erro: "Confira o WhatsApp: DDD e número." };
  const corpo = { nome, telefone: telefone || null, observacao: texto(b.observacao, 300) };
  if (dono) {
    const temCpf = soDigitos(b.cpf).length > 0;
    if (temCpf && !cpfValido(b.cpf)) return { erro: "CPF inválido. Confira os números ou deixe em branco." };
    corpo.cpf = temCpf ? soDigitos(b.cpf) : null;
  }
  const nasc = lerData(b.nascimento, { semAno: true });
  if (nasc === null) return { erro: "Data de nascimento inválida. Use dia/mês/ano." };
  corpo.nascimento = nasc || null;
  return { corpo };
}

async function salvar(res, ctx, b) {
  const lido = lerCampos(b, ctx);
  if (lido.erro) return erro400(res, lido.erro);
  const corpo = { ...lido.corpo, atualizado_em: new Date().toISOString() };
  // Aceite de novidades dado no balcão: o dono registra; desmarcar conta como pedido para sair
  if (ctx.dono && typeof b.aceita === "boolean") corpo.aceita_novidades = b.aceita;
  if (ctx.dono && b.profissional_id !== undefined) {
    if (b.profissional_id && !UUID.test(String(b.profissional_id))) return erro400(res, "Barbeiro inválido.");
    corpo.profissional_id = b.profissional_id || null;
  }
  try {
    if (b.id) {
      if (!UUID.test(String(b.id))) return erro400(res, "Cliente inválido.");
      const atual = (await rest(`clientes?id=eq.${b.id}&barbearia_id=eq.${ctx.barbeariaId}&select=id,profissional_id,aceita_novidades,saiu_em,nascimento`))[0];
      if (!atual) return res.status(404).json({ message: "Cliente não encontrado." });
      if (!ctx.dono) {
        const atendeu = await rest(`pedidos?cliente_id=eq.${b.id}&profissional_id=eq.${ctx.meu}&status=eq.realizado&select=id&limit=1`);
        if (atual.profissional_id !== ctx.meu && !atendeu.length) return res.status(403).json({ message: "Este cliente não é da sua carteira." });
        // O barbeiro não vê o ano do nascimento: não troca uma data que já existe
        if (atual.nascimento) delete corpo.nascimento;
      }
      if ("aceita_novidades" in corpo) {
        if (corpo.aceita_novidades && !(atual.aceita_novidades && !atual.saiu_em)) Object.assign(corpo, { aceite_em: new Date().toISOString(), aceite_origem: "painel", saiu_em: null });
        if (!corpo.aceita_novidades && atual.aceita_novidades && !atual.saiu_em) corpo.saiu_em = new Date().toISOString();
      }
      const r = await rest(`clientes?id=eq.${b.id}&barbearia_id=eq.${ctx.barbeariaId}`, { metodo: "PATCH", prefer: "return=representation", corpo });
      return res.status(200).json({ cliente: { id: r[0].id } });
    }
    if (corpo.aceita_novidades) Object.assign(corpo, { aceite_em: new Date().toISOString(), aceite_origem: "painel" });
    if (!ctx.dono) corpo.profissional_id = ctx.meu;
    const r = await rest("clientes", { metodo: "POST", prefer: "return=representation", corpo: { ...corpo, barbearia_id: ctx.barbeariaId, origem: "painel" } });
    // Cadastro feito a partir de um atendimento: já liga o atendimento ao cliente
    if (b.pedidoId && UUID.test(String(b.pedidoId))) await vincularPedido(ctx, b.pedidoId, r[0].id).catch(() => null);
    return res.status(201).json({ cliente: { id: r[0].id } });
  } catch (e) {
    const m = repetido(e);
    if (m) return res.status(409).json({ message: m });
    throw e;
  }
}

// Liga o atendimento ao cliente (o barbeiro só os próprios atendimentos)
async function vincularPedido(ctx, pedidoId, clienteId) {
  const filtro = `id=eq.${pedidoId}&barbearia_id=eq.${ctx.barbeariaId}` + (ctx.dono ? "" : `&profissional_id=eq.${ctx.meu}`);
  return rest(`pedidos?${filtro}`, { metodo: "PATCH", prefer: "return=representation", corpo: { cliente_id: clienteId } });
}

// Uma linha da planilha -> { linha } normalizada ou { motivo } de recusa
function lerLinha(r) {
  const nome = texto(r.nome, 80);
  if (nome.length < 2) return { motivo: "sem nome" };
  const temTel = soDigitos(r.telefone).length > 0;
  const telefone = temTel ? normalizarWhats(r.telefone) : "";
  if (temTel && !telefone) return { motivo: "WhatsApp inválido" };
  const temCpf = soDigitos(r.cpf).length > 0;
  if (temCpf && !cpfValido(r.cpf)) return { motivo: "CPF inválido" };
  const nascimento = lerData(r.nascimento, { semAno: true });
  if (nascimento === null) return { motivo: "nascimento inválido" };
  const ultima = lerData(r.ultima_visita);
  if (ultima === null || (ultima && ultima > hojeBr())) return { motivo: "última visita inválida" };
  return {
    linha: { nome, telefone: telefone || null, cpf: temCpf ? soDigitos(r.cpf) : null, nascimento: nascimento || null, observacao: texto(r.observacao, 300), ultima_visita_externa: ultima || null },
  };
}

// Importação da planilha: confere cada linha, não repete quem já existe (mesmo WhatsApp ou CPF) e só
// completa os campos vazios de quem já estava cadastrado. Devolve o que entrou e o que ficou de fora.
async function importar(res, ctx, b) {
  const linhas = Array.isArray(b.linhas) ? b.linhas : [];
  if (!linhas.length) return erro400(res, "A planilha não tem nenhuma linha.");
  if (linhas.length > MAX_IMPORTACAO) return erro400(res, `Importe no máximo ${MAX_IMPORTACAO} clientes por vez.`);
  const aceitaram = b.aceitaram === true;
  const agora = new Date().toISOString();
  const ignorados = [];
  const validas = [];
  const vistosTel = new Set();
  const vistosCpf = new Set();
  linhas.forEach((r, i) => {
    const l = lerLinha(r || {});
    if (l.motivo) return ignorados.push({ linha: i + 1, nome: texto((r || {}).nome, 80), motivo: l.motivo });
    const x = l.linha;
    if ((x.telefone && vistosTel.has(x.telefone)) || (x.cpf && vistosCpf.has(x.cpf))) return ignorados.push({ linha: i + 1, nome: x.nome, motivo: "repetido na planilha" });
    if (x.telefone) vistosTel.add(x.telefone);
    if (x.cpf) vistosCpf.add(x.cpf);
    validas.push({ i: i + 1, ...x });
  });

  const existentes = await todas(`clientes?barbearia_id=eq.${ctx.barbeariaId}&select=id,telefone,cpf,nascimento,observacao,ultima_visita_externa,aceita_novidades,saiu_em&order=id`);
  const porTel = new Map(existentes.filter((c) => c.telefone).map((c) => [c.telefone, c]));
  const porCpf = new Map(existentes.filter((c) => c.cpf).map((c) => [c.cpf, c]));
  const novos = [];
  const atualizar = [];
  for (const x of validas) {
    const atual = (x.telefone && porTel.get(x.telefone)) || (x.cpf && porCpf.get(x.cpf));
    if (!atual) {
      novos.push(x);
      continue;
    }
    // Já cadastrado: completa só o que estava vazio
    const p = {};
    if (!atual.telefone && x.telefone && !porTel.has(x.telefone)) p.telefone = x.telefone;
    if (!atual.cpf && x.cpf && !porCpf.has(x.cpf)) p.cpf = x.cpf;
    if (!atual.nascimento && x.nascimento) p.nascimento = x.nascimento;
    if (!atual.observacao && x.observacao) p.observacao = x.observacao;
    if (x.ultima_visita_externa && (!atual.ultima_visita_externa || x.ultima_visita_externa > atual.ultima_visita_externa)) p.ultima_visita_externa = x.ultima_visita_externa;
    if (aceitaram && !(atual.aceita_novidades && !atual.saiu_em)) Object.assign(p, { aceita_novidades: true, aceite_em: agora, aceite_origem: "importacao", saiu_em: null });
    if (Object.keys(p).length) atualizar.push({ id: atual.id, i: x.i, nome: x.nome, corpo: { ...p, atualizado_em: agora } });
    else ignorados.push({ linha: x.i, nome: x.nome, motivo: "já cadastrado" });
  }

  // Conferência antes de gravar: o painel mostra o que vai entrar e o que fica de fora
  if (b.simular === true) {
    ignorados.sort((a, b2) => a.linha - b2.linha);
    return res.status(200).json({ simulado: true, inseridos: novos.length, atualizados: atualizar.length, ignorados: ignorados.slice(0, 300), totalIgnorados: ignorados.length });
  }

  const registro = (x) => ({
    barbearia_id: ctx.barbeariaId, nome: x.nome, telefone: x.telefone, cpf: x.cpf, nascimento: x.nascimento, observacao: x.observacao,
    ultima_visita_externa: x.ultima_visita_externa, origem: "importacao",
    aceita_novidades: aceitaram, aceite_em: aceitaram ? agora : null, aceite_origem: aceitaram ? "importacao" : null,
  });
  let inseridos = 0;
  for (let k = 0; k < novos.length; k += 500) {
    const lote = novos.slice(k, k + 500);
    try {
      await rest("clientes", { metodo: "POST", prefer: "return=minimal", corpo: lote.map(registro) });
      inseridos += lote.length;
    } catch (e) {
      if (!repetido(e)) throw e;
      // Alguém cadastrou o mesmo número ao mesmo tempo: grava um por um para saber qual
      for (const x of lote) {
        try {
          await rest("clientes", { metodo: "POST", prefer: "return=minimal", corpo: registro(x) });
          inseridos++;
        } catch (e2) {
          if (!repetido(e2)) throw e2;
          ignorados.push({ linha: x.i, nome: x.nome, motivo: "já cadastrado" });
        }
      }
    }
  }
  let atualizados = 0;
  for (const a of atualizar) {
    try {
      await rest(`clientes?id=eq.${a.id}&barbearia_id=eq.${ctx.barbeariaId}`, { metodo: "PATCH", prefer: "return=minimal", corpo: a.corpo });
      atualizados++;
    } catch (e) {
      if (!repetido(e)) throw e;
      ignorados.push({ linha: a.i, nome: a.nome, motivo: "CPF ou WhatsApp de outro cliente" });
    }
  }
  ignorados.sort((a, b) => a.linha - b.linha);
  return res.status(200).json({ inseridos, atualizados, ignorados: ignorados.slice(0, 300), totalIgnorados: ignorados.length });
}

function origemSite(req) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? `https://${host}` : "";
}

// Convite de cadastro: link de uso único que o cliente abre no próprio celular (pelo WhatsApp ou QR code)
async function convite(res, req, ctx, b) {
  let pedido = null;
  if (b.pedidoId) {
    if (!UUID.test(String(b.pedidoId))) return erro400(res, "Atendimento inválido.");
    const filtro = `id=eq.${b.pedidoId}&barbearia_id=eq.${ctx.barbeariaId}` + (ctx.dono ? "" : `&profissional_id=eq.${ctx.meu}`);
    pedido = (await rest(`pedidos?${filtro}&select=id,cliente,profissional_id,cliente_id`))[0];
    if (!pedido) return res.status(404).json({ message: "Atendimento não encontrado." });
  }
  const temTel = soDigitos(b.telefone).length > 0;
  const telefone = temTel ? normalizarWhats(b.telefone) : "";
  if (temTel && !telefone) return erro400(res, "Confira o WhatsApp: DDD e número.");
  const token = crypto.randomBytes(18).toString("base64url");
  const expira = new Date(Date.now() + VALIDADE_CONVITE_DIAS * 864e5).toISOString();
  await rest("clientes_convites", {
    metodo: "POST",
    prefer: "return=minimal",
    corpo: {
      token, barbearia_id: ctx.barbeariaId, pedido_id: pedido ? pedido.id : null,
      profissional_id: (pedido && pedido.profissional_id) || ctx.meu || null,
      nome: texto(b.nome || (pedido && pedido.cliente) || "", 80), telefone: telefone || null, expira_em: expira,
    },
  });
  return res.status(201).json({ token, link: `${origemSite(req)}/cadastro?c=${token}`, expiraEm: expira, telefone });
}

async function area(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const ctx = await contexto(req);
    if (ctx.erro) return res.status(ctx.erro[0]).json({ message: ctx.erro[1] });
    // A carteira de clientes é do dono: o barbeiro não vê a lista, o histórico, os gastos nem os aniversários.
    // No atendimento, ele só pode mandar ao cliente o convite de cadastro (QR code ou link).
    if (!ctx.dono && !(req.method === "POST" && corpoDe(req).acao === "convite")) {
      return res.status(403).json({ message: "A carteira de clientes é só do dono. No atendimento, use \"Cadastrar\" para mandar o QR code ou o link ao cliente." });
    }
    const q = req.query || {};
    if (req.method === "GET") {
      if (q.id) {
        if (!UUID.test(String(q.id))) return erro400(res, "Cliente inválido.");
        const f = await ficha(ctx, q.id);
        return f ? res.status(200).json(f) : res.status(404).json({ message: "Cliente não encontrado." });
      }
      if (q.campanhas === "1") {
        if (!ctx.dono) return res.status(403).json({ message: "Só o dono vê as campanhas." });
        return res.status(200).json(await campanhas(ctx));
      }
      if (q.premium === "1") {
        if (!ctx.dono) return res.status(403).json({ message: "Só o dono cuida do WhatsApp automático." });
        return res.status(200).json(await automacoes.dados(ctx, req, dados));
      }
      return res.status(200).json(await dados(ctx));
    }
    if (req.method !== "POST") return res.status(405).json({ message: "Método não permitido." });
    const b = corpoDe(req);
    const soDono = ["apagar", "importar", "campanha-criar", "campanha-envio", "automacao-salvar", "aviso"];
    if (soDono.includes(b.acao) && !ctx.dono) return res.status(403).json({ message: "Só o dono pode fazer isso." });

    if (b.acao === "salvar") return salvar(res, ctx, b);
    if (b.acao === "importar") return importar(res, ctx, b);
    if (b.acao === "convite") return convite(res, req, ctx, b);
    if (b.acao === "automacao-salvar") return automacoes.salvar(res, ctx, b);
    if (b.acao === "aviso") return avisosClientes.enviar(res, ctx, b, dados);
    if (b.acao === "apagar") {
      // LGPD: o cliente pediu para apagar os dados. Os atendimentos ficam no financeiro, sem o vínculo.
      if (!UUID.test(String(b.id || ""))) return erro400(res, "Cliente inválido.");
      const r = await rest(`clientes?id=eq.${b.id}&barbearia_id=eq.${ctx.barbeariaId}`, { metodo: "DELETE", prefer: "return=representation" });
      if (!r.length) return res.status(404).json({ message: "Cliente não encontrado." });
      return res.status(200).json({ ok: true });
    }
    if (b.acao === "vincular") {
      if (!UUID.test(String(b.pedidoId || "")) || !UUID.test(String(b.clienteId || ""))) return erro400(res, "Pedido inválido.");
      const c = await rest(`clientes?id=eq.${b.clienteId}&barbearia_id=eq.${ctx.barbeariaId}&select=id`);
      if (!c.length) return res.status(404).json({ message: "Cliente não encontrado." });
      const r = await vincularPedido(ctx, b.pedidoId, b.clienteId);
      if (!r.length) return res.status(404).json({ message: "Atendimento não encontrado." });
      return res.status(200).json({ ok: true });
    }
    if (b.acao === "campanha-criar") {
      const nome = texto(b.nome, 80);
      const mensagem = String(b.mensagem || "").trim().slice(0, 1000);
      if (nome.length < 2) return erro400(res, "Dê um nome à campanha.");
      if (mensagem.length < 2) return erro400(res, "Escreva a mensagem.");
      const r = await rest("campanhas", { metodo: "POST", prefer: "return=representation", corpo: { barbearia_id: ctx.barbeariaId, nome, mensagem, segmento: texto(b.segmento, 40) } });
      return res.status(201).json({ campanha: { id: r[0].id } });
    }
    if (b.acao === "campanha-envio") {
      if (!UUID.test(String(b.campanhaId || "")) || !UUID.test(String(b.clienteId || ""))) return erro400(res, "Pedido inválido.");
      const [cp, cl] = await Promise.all([
        rest(`campanhas?id=eq.${b.campanhaId}&barbearia_id=eq.${ctx.barbeariaId}&select=id`),
        rest(`clientes?id=eq.${b.clienteId}&barbearia_id=eq.${ctx.barbeariaId}&select=id`),
      ]);
      if (!cp.length || !cl.length) return res.status(404).json({ message: "Campanha ou cliente não encontrado." });
      await rest("campanha_envios?on_conflict=campanha_id,cliente_id", { metodo: "POST", prefer: "resolution=ignore-duplicates,return=minimal", corpo: { campanha_id: b.campanhaId, cliente_id: b.clienteId } });
      return res.status(200).json({ ok: true });
    }
    return erro400(res, "Ação desconhecida.");
  } catch (e) {
    return falha(res, e, `${req.method} /api/equipe?area=clientes`);
  }
}

// ---------- público: cadastro pelo convite ----------
const MENSAGEM_CONVITE = {
  convite: [404, "Link de cadastro inválido. Peça um novo na barbearia."],
  usado: [410, "Este link já foi usado. Seu cadastro está feito."],
  expirado: [410, "Este link venceu. Peça um novo na barbearia."],
  cpf: [409, "Este CPF já está em outro cadastro desta barbearia. Confira os números ou deixe em branco."],
};

async function conviteInfo(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const token = String((req.query || {}).convite || "");
  if (!TOKEN.test(token)) return res.status(404).json({ message: MENSAGEM_CONVITE.convite[1] });
  try {
    const c = (await rest(`clientes_convites?token=eq.${token}&select=nome,telefone,expira_em,usado_em,barbearias(nome,slug)`))[0];
    if (!c) return res.status(404).json({ message: MENSAGEM_CONVITE.convite[1] });
    if (c.usado_em) return res.status(410).json({ message: MENSAGEM_CONVITE.usado[1] });
    if (c.expira_em < new Date().toISOString()) return res.status(410).json({ message: MENSAGEM_CONVITE.expirado[1] });
    const b = c.barbearias || {};
    return res.status(200).json({ barbearia: b.nome || "", slug: b.slug || "", nome: c.nome || "", telefone: c.telefone || "" });
  } catch (e) {
    return falha(res, e, "GET /api/pedido?convite");
  }
}

async function conviteSalvar(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const token = String((req.query || {}).convite || "");
  if (!TOKEN.test(token)) return res.status(404).json({ message: MENSAGEM_CONVITE.convite[1] });
  const b = corpoDe(req);
  if (b.website) return res.status(201).json({ ok: true });
  const nome = texto(b.nome, 80);
  const telefone = normalizarWhats(b.whatsapp);
  const temCpf = soDigitos(b.cpf).length > 0;
  const nascimento = lerData(b.nascimento, { semAno: true });
  if (nome.length < 2) return res.status(400).json({ message: "Informe seu nome." });
  if (!telefone) return res.status(400).json({ message: "Informe seu WhatsApp com DDD." });
  if (temCpf && !cpfValido(b.cpf)) return res.status(400).json({ message: "CPF inválido. Confira os números ou deixe em branco." });
  if (nascimento === null) return res.status(400).json({ message: "Data de nascimento inválida. Use dia/mês/ano." });
  try {
    if ((await contarTentativas(`convite:${origemDe(req)}`, 3600, true)) > 20) return res.status(429).json({ message: "Muitas tentativas. Tente de novo mais tarde." });
    const r = await rest("rpc/cliente_do_convite", {
      metodo: "POST",
      corpo: { p_token: token, p_nome: nome, p_telefone: telefone, p_cpf: temCpf ? soDigitos(b.cpf) : null, p_nascimento: nascimento || null, p_novidades: b.novidades === true },
    });
    if (!r || r.erro) {
      const [status, message] = MENSAGEM_CONVITE[(r && r.erro) || "convite"] || MENSAGEM_CONVITE.convite;
      return res.status(status).json({ message });
    }
    return res.status(201).json({ ok: true });
  } catch (e) {
    return falha(res, e, "POST /api/pedido?convite");
  }
}

// Agendamento pelo site com WhatsApp: liga o pedido ao cliente (cria o cadastro se for a primeira vez).
// Falha aqui nunca derruba o agendamento.
async function clienteDoAgendamento({ barbeariaId, pedidoId, nome, telefone, novidades }) {
  if (!telefone) return null;
  return rest("rpc/cliente_do_agendamento", { metodo: "POST", corpo: { p_barbearia: barbeariaId, p_pedido: pedidoId, p_nome: nome, p_telefone: telefone, p_novidades: novidades === true } });
}

module.exports = {
  area, conviteInfo, conviteSalvar, clienteDoAgendamento,
  cpfValido, mascararCpf, lerData, retorno, aniversario, segmentosDe, lerLinha, mediana, MAX_IMPORTACAO,
};
