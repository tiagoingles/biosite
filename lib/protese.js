// Prótese capilar (fase 20): ficha de cada cliente de prótese, próxima manutenção, lembrete e histórico.
// Rota: /api/equipe?area=protese (limite de funções da Vercel no plano gratuito). Só o dono (é carteira de clientes).
// GET -> fichas com a próxima manutenção e a situação, a equipe e se a aba está ligada.
// POST { acao, ... }
//   "criar" / "editar" { id?, nome, telefone, profissionalId, modelo, aplicadaEm, intervaloDias, observacao }
//   "manutencao" { id, dia, tipo, observacao }   registra a manutenção (ou troca) e conta o próximo prazo dela
//   "lembrar" { id }        anota que o lembrete foi mandado (o WhatsApp abre no navegador)
//   "historico" { id }      as manutenções da ficha, mais recentes primeiro
//   "desativar" { id }      cliente parou de usar (sai da lista, o histórico fica)
//   "aba" { ativa }         liga ou desliga a aba Prótese no painel
// Atendimento de prótese marcado como realizado na agenda conta como manutenção (registrarDoAtendimento).
const { rest } = require("./supabase");
const { usuarioDaRequisicao, perfilDoContexto, ehAdmin } = require("./conta");
const { texto } = require("./agenda");
const { hojeBr, somaDias, dataValida } = require("./horarios");
const { falha, corpoDe, UUID } = require("./seguranca");
const { normalizarWhats } = require("./clube");

const LEMBRAR_ANTES = 3; // dias antes do vencimento
const TIPOS = ["aplicacao", "manutencao", "troca"];
const CAMPOS = "id,cliente_id,nome,telefone,profissional_id,modelo,aplicada_em,intervalo_dias,ultima_manutencao,lembrete_em,observacao,ativo,criado_em";
const ehProtese = (servico) => /pr[óo]tese/i.test(String(servico || ""));

async function contexto(req) {
  const u = await usuarioDaRequisicao(req);
  if (!u) return { erro: [401, "Entre na sua conta para continuar."] };
  const perfil = await perfilDoContexto(u, req);
  if (!perfil || !perfil.barbearia_id) return { erro: [403, "Sua conta ainda não está ligada a uma barbearia."] };
  if (!ehAdmin(perfil)) return { erro: [403, "A ficha de prótese é só do dono."] };
  return { barbeariaId: perfil.barbearia_id };
}

function diasEntre(a, b) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
}

// Próxima manutenção = última manutenção (ou a aplicação) + intervalo. dias < 0 = atrasada.
function situacao(f, hoje) {
  const base = f.ultima_manutencao || f.aplicada_em;
  if (!base) return { proxima: null, dias: null, status: "sem_data" };
  const proxima = somaDias(base, f.intervalo_dias);
  const dias = diasEntre(hoje, proxima);
  const lembrado = !!f.lembrete_em && f.lembrete_em.slice(0, 10) >= somaDias(proxima, -LEMBRAR_ANTES - 7);
  const status = dias < 0 ? "atrasada" : dias <= LEMBRAR_ANTES ? "vence" : "em_dia";
  return { proxima, dias, status, lembrado };
}

async function listar(ctx) {
  const hoje = hojeBr();
  const [fichas, equipe, barb] = await Promise.all([
    rest(`protese_clientes?barbearia_id=eq.${ctx.barbeariaId}&ativo=eq.true&select=${CAMPOS}&order=nome.asc&limit=1000`),
    rest(`profissionais?barbearia_id=eq.${ctx.barbeariaId}&ativo=eq.true&select=id,nome&order=criado_em.asc`),
    rest(`barbearias?id=eq.${ctx.barbeariaId}&select=protese_ativa`),
  ]);
  const nomeDe = Object.fromEntries(equipe.map((e) => [e.id, e.nome]));
  const lista = fichas.map((f) => ({ ...f, profissional: nomeDe[f.profissional_id] || "", ...situacao(f, hoje) }));
  // Para lembrar primeiro (atrasadas e as que vencem logo), depois pela data
  const ordem = { atrasada: 0, vence: 1, em_dia: 2, sem_data: 3 };
  lista.sort((a, b) => ordem[a.status] - ordem[b.status] || String(a.proxima || "9").localeCompare(String(b.proxima || "9")));
  return {
    ativa: !!(barb[0] && barb[0].protese_ativa),
    fichas: lista,
    equipe,
    resumo: {
      total: lista.length,
      atrasadas: lista.filter((f) => f.status === "atrasada").length,
      vencem: lista.filter((f) => f.status === "vence").length,
      semana: lista.filter((f) => f.dias != null && f.dias >= 0 && f.dias <= 7).length,
    },
  };
}

function lerFicha(b) {
  const nome = texto(b.nome, 80);
  if (nome.length < 2) return { erro: "Informe o nome do cliente." };
  const dig = String(b.telefone || "").replace(/\D/g, "");
  const telefone = dig ? normalizarWhats(b.telefone) : "";
  if (dig && !telefone) return { erro: "Confira o WhatsApp: DDD e número." };
  const aplicadaEm = b.aplicadaEm ? String(b.aplicadaEm) : null;
  if (aplicadaEm && !dataValida(aplicadaEm)) return { erro: "Data da aplicação inválida." };
  if (aplicadaEm && aplicadaEm > hojeBr()) return { erro: "A data da aplicação não pode ser no futuro." };
  const intervalo = b.intervaloDias == null || b.intervaloDias === "" ? 21 : Number(b.intervaloDias);
  if (!Number.isInteger(intervalo) || intervalo < 7 || intervalo > 120) return { erro: "Intervalo entre manutenções: de 7 a 120 dias." };
  if (b.profissionalId && !UUID.test(String(b.profissionalId))) return { erro: "Barbeiro inválido." };
  return { corpo: { nome, telefone, profissional_id: b.profissionalId || null, modelo: texto(b.modelo, 120), aplicada_em: aplicadaEm, intervalo_dias: intervalo, observacao: String(b.observacao || "").trim().slice(0, 500) } };
}

async function fichaDaBarbearia(ctx, id) {
  if (!UUID.test(String(id || ""))) return null;
  return (await rest(`protese_clientes?id=eq.${id}&barbearia_id=eq.${ctx.barbeariaId}&select=${CAMPOS}`))[0] || null;
}

async function barbeiroDaBarbearia(ctx, id) {
  if (!id) return true;
  return (await rest(`profissionais?id=eq.${id}&barbearia_id=eq.${ctx.barbeariaId}&select=id`)).length > 0;
}

// Liga a ficha ao cadastro do cliente (mesmo WhatsApp), quando ele existe
async function clienteDoTelefone(ctx, telefone) {
  if (!telefone) return null;
  const c = await rest(`clientes?barbearia_id=eq.${ctx.barbeariaId}&telefone=eq.${telefone}&select=id`).catch(() => []);
  return c[0] ? c[0].id : null;
}

async function registrarManutencao(ctx, f, { dia, tipo, observacao, profissionalId, pedidoId }) {
  await rest("protese_manutencoes", {
    metodo: "POST",
    prefer: "return=minimal",
    corpo: { barbearia_id: ctx.barbeariaId, protese_cliente_id: f.id, dia, tipo, observacao: observacao || "", profissional_id: profissionalId || f.profissional_id || null, pedido_id: pedidoId || null },
  });
  // A próxima conta da manutenção mais recente (registrar uma antiga não volta o prazo)
  if (!f.ultima_manutencao || dia > f.ultima_manutencao) {
    await rest(`protese_clientes?id=eq.${f.id}`, { metodo: "PATCH", prefer: "return=minimal", corpo: { ultima_manutencao: dia, ...(tipo === "aplicacao" && !f.aplicada_em ? { aplicada_em: dia } : {}) } });
  }
}

async function area(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const ctx = await contexto(req);
    if (ctx.erro) return res.status(ctx.erro[0]).json({ message: ctx.erro[1] });
    if (req.method === "GET") return res.status(200).json(await listar(ctx));
    if (req.method !== "POST") return res.status(405).json({ message: "Método não permitido." });
    const b = corpoDe(req);

    if (b.acao === "aba") {
      if (typeof b.ativa !== "boolean") return res.status(400).json({ message: "Pedido inválido." });
      await rest(`barbearias?id=eq.${ctx.barbeariaId}`, { metodo: "PATCH", prefer: "return=minimal", corpo: { protese_ativa: b.ativa } });
      return res.status(200).json({ ativa: b.ativa });
    }

    if (b.acao === "criar" || b.acao === "editar") {
      const lido = lerFicha(b);
      if (lido.erro) return res.status(400).json({ message: lido.erro });
      if (!(await barbeiroDaBarbearia(ctx, lido.corpo.profissional_id))) return res.status(404).json({ message: "Barbeiro não encontrado." });
      if (b.acao === "criar") {
        const corpo = { ...lido.corpo, barbearia_id: ctx.barbeariaId, cliente_id: await clienteDoTelefone(ctx, lido.corpo.telefone) };
        const [nova] = await rest("protese_clientes", { metodo: "POST", prefer: "return=representation", corpo });
        // A aplicação entra no histórico
        if (nova.aplicada_em) await registrarManutencao(ctx, nova, { dia: nova.aplicada_em, tipo: "aplicacao" });
        // A primeira ficha liga a aba sozinha
        await rest(`barbearias?id=eq.${ctx.barbeariaId}&protese_ativa=eq.false`, { metodo: "PATCH", prefer: "return=minimal", corpo: { protese_ativa: true } }).catch(() => {});
        return res.status(201).json({ ficha: { id: nova.id } });
      }
      const f = await fichaDaBarbearia(ctx, b.id);
      if (!f) return res.status(404).json({ message: "Ficha não encontrada." });
      await rest(`protese_clientes?id=eq.${f.id}`, { metodo: "PATCH", prefer: "return=minimal", corpo: lido.corpo });
      return res.status(200).json({ ok: true });
    }

    const f = await fichaDaBarbearia(ctx, b.id);
    if (!f) return res.status(404).json({ message: "Ficha não encontrada." });

    if (b.acao === "manutencao") {
      const dia = String(b.dia || hojeBr());
      if (!dataValida(dia) || dia > hojeBr()) return res.status(400).json({ message: "Data inválida: use hoje ou um dia que já passou." });
      const tipo = TIPOS.includes(b.tipo) ? b.tipo : "manutencao";
      await registrarManutencao(ctx, f, { dia, tipo, observacao: String(b.observacao || "").trim().slice(0, 300) });
      return res.status(201).json({ proxima: somaDias(!f.ultima_manutencao || dia > f.ultima_manutencao ? dia : f.ultima_manutencao, f.intervalo_dias) });
    }
    if (b.acao === "lembrar") {
      await rest(`protese_clientes?id=eq.${f.id}`, { metodo: "PATCH", prefer: "return=minimal", corpo: { lembrete_em: new Date().toISOString() } });
      return res.status(200).json({ ok: true });
    }
    if (b.acao === "historico") {
      const h = await rest(`protese_manutencoes?protese_cliente_id=eq.${f.id}&select=dia,tipo,observacao,profissional_id&order=dia.desc&limit=100`);
      return res.status(200).json({ manutencoes: h });
    }
    if (b.acao === "desativar") {
      await rest(`protese_clientes?id=eq.${f.id}`, { metodo: "PATCH", prefer: "return=minimal", corpo: { ativo: false } });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ message: "Ação desconhecida." });
  } catch (e) {
    return falha(res, e, `${req.method} /api/equipe?area=protese`);
  }
}

// Atendimento de prótese realizado na agenda: vira manutenção na ficha do cliente (pelo cadastro ou pelo WhatsApp).
// Nunca derruba o encerramento do atendimento: qualquer falha aqui só fica no log.
async function registrarDoAtendimento(pedido) {
  try {
    if (!pedido || !ehProtese(pedido.servico)) return false;
    let telefone = "";
    if (pedido.cliente_id) {
      const c = await rest(`clientes?id=eq.${pedido.cliente_id}&select=telefone`);
      telefone = (c[0] && c[0].telefone) || "";
    }
    const filtros = [];
    if (pedido.cliente_id) filtros.push(`cliente_id.eq.${pedido.cliente_id}`);
    if (telefone) filtros.push(`telefone.eq.${telefone}`);
    if (!filtros.length) return false;
    const f = (await rest(`protese_clientes?barbearia_id=eq.${pedido.barbearia_id}&ativo=eq.true&or=(${filtros.join(",")})&select=${CAMPOS}&limit=1`))[0];
    if (!f) return false;
    await registrarManutencao({ barbeariaId: pedido.barbearia_id }, f, { dia: pedido.dia, tipo: "manutencao", profissionalId: pedido.profissional_id, pedidoId: pedido.id, observacao: "Pela agenda: " + pedido.servico });
    return true;
  } catch (e) {
    console.error("prótese pelo atendimento:", e.message);
    return false;
  }
}

// Para a tela Hoje do dono: quantas fichas vencem em até 3 dias ou estão atrasadas (sem lembrete)
async function paraLembrar(barbeariaId) {
  const hoje = hojeBr();
  const fichas = await rest(`protese_clientes?barbearia_id=eq.${barbeariaId}&ativo=eq.true&select=nome,aplicada_em,intervalo_dias,ultima_manutencao,lembrete_em&limit=1000`);
  return fichas.map((f) => ({ nome: f.nome, ...situacao(f, hoje) })).filter((f) => (f.status === "atrasada" || f.status === "vence") && !f.lembrado).map((f) => ({ nome: f.nome, dias: f.dias }));
}

module.exports = { area, situacao, registrarDoAtendimento, paraLembrar, ehProtese };
