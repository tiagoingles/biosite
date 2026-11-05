// Pedidos de horário da barbearia, para o painel.
// GET ?dia=2026-11-04 lista os pedidos do dia. O dono vê todos; o barbeiro vê só os dele.
// GET ?pendentes=1 lista os pedidos esperando confirmação, de hoje em diante.
// PATCH { id, status }:
//   "confirmado" | "recusado"  decide um pedido pendente;
//   "realizado"                marca que o atendimento aconteceu (pedido confirmado ou avulso, até hoje);
//   "nao_realizado" + motivo   não aconteceu: "reagendado" ou "cliente_nao_apareceu".
// POST { acao: "avulso", servico, cliente, dia, horario, duracao, profissionalId? }
//   registra um atendimento espontâneo. O barbeiro registra na própria agenda; o dono escolhe o profissional.
// Quem decide ou registra: o dono, o dono-barbeiro, ou o próprio barbeiro do pedido.
const { rest } = require("./supabase");
const { usuarioDaRequisicao, perfilDe, ehAdmin, ehAdminDaPlataforma } = require("./conta");
const { codigoNovo, texto } = require("./agenda");
const { precoDoServico, valorDoTexto } = require("./precos");
const { diaDaSemana } = require("./horarios");

const UUID = /^[0-9a-f-]{36}$/i;
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^\d{2}:\d{2}$/;
const DECISOES = ["confirmado", "recusado"];
const ENCERRAMENTOS = ["realizado", "nao_realizado"];
const MOTIVOS = ["reagendado", "cliente_nao_apareceu"];
// Pedidos que ocupam o horário na agenda (recusados, cancelados e não realizados liberam)
const OCUPAM = "pendente,confirmado,avulso,realizado";

// Id do profissional ligado ao usuário logado (só barbeiros têm)
async function profissionalDoUsuario(userId) {
  const linhas = await rest(`profissionais?perfil_user_id=eq.${userId}&select=id`);
  return linhas[0] ? linhas[0].id : null;
}

function hojeBrasilia() {
  return new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
}

function minutos(hora) {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

function paraHora(min) {
  return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
}

// Atendimento espontâneo: vai para a agenda como "avulso", sem passar pela confirmação
async function registrarAvulso({ req, res, barbeariaId, soDele, meuProfissional, b }) {
  const servico = texto(b.servico, 80);
  const cliente = texto(b.cliente, 80);
  const dia = String(b.dia || "");
  const horario = String(b.horario || "");
  const duracao = Number.isInteger(Number(b.duracao)) && Number(b.duracao) >= 5 && Number(b.duracao) <= 240 ? Number(b.duracao) : 30;
  if (!servico || !cliente) return res.status(400).json({ message: "Informe o serviço e o nome do cliente." });
  if (!DIA.test(dia) || !HORA.test(horario)) return res.status(400).json({ message: "Data ou horário inválido." });

  // Barbeiro registra para si; o dono escolhe o profissional
  const profissionalId = soDele ? meuProfissional : String(b.profissionalId || "");
  if (!UUID.test(profissionalId)) return res.status(400).json({ message: "Escolha o profissional." });
  const prof = (await rest(`profissionais?id=eq.${profissionalId}&barbearia_id=eq.${barbeariaId}&ativo=eq.true&select=id,nome`))[0];
  if (!prof) return res.status(404).json({ message: "Profissional não encontrado nesta barbearia." });
  const barbearia = (await rest(`barbearias?id=eq.${barbeariaId}&select=slug`))[0];

  // Não pode sobrepor outro atendimento do mesmo profissional
  const inicio = minutos(horario);
  const fim = inicio + duracao;
  const outros = await rest(`pedidos?profissional_id=eq.${prof.id}&dia=eq.${dia}&status=in.(${OCUPAM})&select=horario,duracao_min`);
  const conflito = outros.find((p) => {
    const i = minutos(String(p.horario).slice(0, 5));
    return inicio < i + (p.duracao_min || 30) && i < fim;
  });
  if (conflito) return res.status(409).json({ message: `Este horário já está ocupado (das ${String(conflito.horario).slice(0, 5)}).` });

  // Bloqueios do profissional (intervalos, folgas, bloqueio pontual) também valem para o avulso
  const dow = diaDaSemana(dia);
  const bloqueios = await rest(`bloqueios?profissional_id=eq.${prof.id}&or=(and(tipo.eq.recorrente,dia_semana.eq.${dow}),and(tipo.eq.pontual,data.eq.${dia}))&select=inicio,fim`);
  const bloqueado = bloqueios.find((b) => {
    const i = minutos(String(b.inicio).slice(0, 5));
    const f = minutos(String(b.fim).slice(0, 5));
    return inicio < f && i < fim;
  });
  if (bloqueado) return res.status(409).json({ message: `Este horário está bloqueado na agenda (${String(bloqueado.inicio).slice(0, 5)} às ${String(bloqueado.fim).slice(0, 5)}).` });

  const valor = await precoDoServico(barbeariaId, servico, null);
  const corpo = {
    slug: barbearia.slug,
    barbearia_id: barbeariaId,
    profissional_id: prof.id,
    profissional: prof.nome,
    servico,
    dia,
    horario,
    horario_fim: paraHora(fim),
    duracao_min: duracao,
    cliente,
    observacao: texto(b.observacao, 200),
    valor,
    status: "avulso",
  };
  // O código é único por site: tenta outro se coincidir
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try {
      const [criado] = await rest("pedidos", { metodo: "POST", prefer: "return=representation", corpo: { ...corpo, codigo: codigoNovo() } });
      return res.status(201).json({ pedido: criado });
    } catch (e) {
      if (!/duplicate|unique/i.test(e.message)) throw e;
    }
  }
  return res.status(500).json({ message: "Não foi possível gerar o código. Tente de novo." });
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const u = await usuarioDaRequisicao(req);
    if (!u) return res.status(401).json({ message: "Entre na sua conta para continuar." });
    const perfil = await perfilDe(u.id);
    const plataforma = await ehAdminDaPlataforma(u.id);
    // Administrador da plataforma escolhe o site (?barbearia=id); os outros usam a própria barbearia
    let barbeariaId = perfil ? perfil.barbearia_id : null;
    if (plataforma && UUID.test(String(req.query.barbearia || ""))) barbeariaId = req.query.barbearia;
    if (!barbeariaId) return res.status(403).json({ message: "Sua conta ainda não está ligada a uma barbearia." });

    // Barbeiro sem ser administrador só enxerga e decide os próprios pedidos
    const soDele = !plataforma && !ehAdmin(perfil);
    const meuProfissional = soDele ? await profissionalDoUsuario(u.id) : null;
    if (soDele && !meuProfissional) return res.status(403).json({ message: "Seu perfil não tem agenda de atendimento." });

    if (req.method === "GET") {
      const filtro = soDele ? `&profissional_id=eq.${meuProfissional}` : "";
      const campos = "id,codigo,servico,profissional,profissional_id,dia,horario,horario_fim,duracao_min,cliente,observacao,status,motivo,valor";
      // Pendentes de hoje em diante, de todos os dias (para as telas de confirmação)
      if (req.query.pendentes === "1") {
        const pendentes = await rest(
          `pedidos?barbearia_id=eq.${barbeariaId}&status=eq.pendente&dia=gte.${hojeBrasilia()}${filtro}&select=${campos}&order=dia.asc,horario.asc`
        );
        return res.status(200).json({ pedidos: pendentes });
      }
      // Atendimentos de dias passados (ou de hoje) que ainda precisam ser marcados como realizados ou não
      if (req.query.encerrar === "1") {
        const aEncerrar = await rest(
          `pedidos?barbearia_id=eq.${barbeariaId}&status=in.(confirmado,avulso)&dia=lte.${hojeBrasilia()}${filtro}&select=${campos}&order=dia.desc,horario.desc&limit=200`
        );
        return res.status(200).json({ pedidos: aEncerrar });
      }
      // Histórico: atendimentos já encerrados nos últimos 60 dias
      if (req.query.realizados === "1") {
        const desde = new Date(Date.now() - 3 * 36e5 - 59 * 864e5).toISOString().slice(0, 10);
        const feitos = await rest(
          `pedidos?barbearia_id=eq.${barbeariaId}&status=in.(realizado,nao_realizado)&dia=gte.${desde}${filtro}&select=${campos}&order=dia.desc,horario.desc&limit=300`
        );
        return res.status(200).json({ pedidos: feitos });
      }
      const dia = String(req.query.dia || "");
      if (!DIA.test(dia)) return res.status(400).json({ message: "Data inválida." });
      const pedidos = await rest(`pedidos?barbearia_id=eq.${barbeariaId}&dia=eq.${dia}${filtro}&select=${campos}&order=horario.asc`);
      return res.status(200).json({ pedidos });
    }

    if (req.method === "POST") {
      if ((req.body || {}).acao !== "avulso") return res.status(400).json({ message: "Ação desconhecida." });
      return registrarAvulso({ req, res, barbeariaId, soDele, meuProfissional, b: req.body || {} });
    }

    if (req.method === "PATCH") {
      const b = req.body || {};
      const id = String(b.id || "");
      if (!UUID.test(id)) return res.status(400).json({ message: "Pedido inválido." });
      const decide = DECISOES.includes(b.status);
      const encerra = ENCERRAMENTOS.includes(b.status);
      const editaValor = b.status === undefined && b.valor !== undefined;
      if (!decide && !encerra && !editaValor) return res.status(400).json({ message: "Status inválido." });
      if (b.status === "nao_realizado" && !MOTIVOS.includes(b.motivo)) return res.status(400).json({ message: "Informe o motivo: reagendado ou cliente não apareceu." });

      // O pedido precisa ser desta barbearia e, para barbeiro, ser dele
      const atual = await rest(`pedidos?id=eq.${id}&barbearia_id=eq.${barbeariaId}&select=id,status,profissional_id,dia,servico,valor`);
      if (!atual.length) return res.status(404).json({ message: "Pedido não encontrado." });
      if (soDele && atual[0].profissional_id !== meuProfissional) return res.status(403).json({ message: "Este pedido é de outro barbeiro." });

      // Editar o valor (ex.: desconto). Só quando o pedido é enviado com "valor" e sem status.
      if (editaValor) {
        const v = b.valor === null || b.valor === "" ? null : valorDoTexto(b.valor);
        if (b.valor !== null && b.valor !== "" && v === null) return res.status(400).json({ message: "Valor inválido." });
        const [novo] = await rest(`pedidos?id=eq.${id}&barbearia_id=eq.${barbeariaId}`, { metodo: "PATCH", prefer: "return=representation", corpo: { valor: v } });
        return res.status(200).json({ pedido: novo });
      }

      if (decide) {
        if (atual[0].status !== "pendente") return res.status(409).json({ message: "Este pedido já foi decidido." });
        const [novo] = await rest(`pedidos?id=eq.${id}&status=eq.pendente`, { metodo: "PATCH", prefer: "return=representation", corpo: { status: b.status } });
        if (!novo) return res.status(409).json({ message: "Este pedido já foi decidido." });
        return res.status(200).json({ pedido: novo });
      }

      // Encerramento: só depois de confirmado ou avulso, e só no dia do atendimento ou depois
      if (!["confirmado", "avulso"].includes(atual[0].status)) return res.status(409).json({ message: "Só dá para encerrar um atendimento confirmado ou avulso." });
      if (atual[0].dia > hojeBrasilia()) return res.status(409).json({ message: "Este atendimento ainda não aconteceu." });
      const corpo = { status: b.status, motivo: b.status === "nao_realizado" ? b.motivo : null };
      if (b.status === "realizado") {
        // O valor já veio gravado no agendamento (ou na edição do desconto); só busca o preço se faltar.
        // A comissão do momento fica gravada, para o histórico não mudar depois de um reajuste.
        if (atual[0].valor == null) {
          const preco = (await rest(`servicos_precos?barbearia_id=eq.${barbeariaId}&nome=eq.${encodeURIComponent(atual[0].servico)}&select=preco`))[0];
          corpo.valor = preco ? Number(preco.preco) : null;
        }
        const prof = atual[0].profissional_id ? (await rest(`profissionais?id=eq.${atual[0].profissional_id}&select=comissao_pct`))[0] : null;
        corpo.comissao_pct = prof ? Number(prof.comissao_pct) : null;
      }
      const [novo] = await rest(`pedidos?id=eq.${id}&status=in.(confirmado,avulso)`, { metodo: "PATCH", prefer: "return=representation", corpo });
      if (!novo) return res.status(409).json({ message: "Este atendimento já foi encerrado." });
      return res.status(200).json({ pedido: novo });
    }

    return res.status(405).json({ message: "Método não permitido." });
  } catch (e) {
    return res.status(e.status || 500).json({ message: e.message });
  }
};
