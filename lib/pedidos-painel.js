// Pedidos de horário da barbearia, para os painéis do dono e do barbeiro.
// GET ?painel=1&dia=2026-11-04  tudo o que a tela inicial precisa, numa resposta só: pedidos do dia,
//                                pendentes, atendimentos a encerrar, equipe com a agenda publicada e indicadores.
// GET ?dia=2026-11-04           pedidos do dia. O dono vê todos; o barbeiro vê só os dele.
// GET ?pendentes=1              pedidos esperando confirmação, de hoje em diante.
// GET ?servicos=1               serviços cadastrados (os únicos aceitos no atendimento espontâneo).
// GET ?encerrar=1               confirmados e avulsos até hoje que ainda precisam ser encerrados.
// GET ?realizados=1             atendimentos encerrados nos últimos 60 dias.
// PATCH { id, status }:
//   "confirmado" | "recusado"  decide um pedido pendente;
//   "realizado"                marca que o atendimento aconteceu (pedido confirmado ou avulso, até hoje);
//   "nao_realizado" + motivo   não aconteceu: "reagendado" ou "cliente_nao_apareceu".
// PATCH { id, valor }          muda o valor (desconto).
// POST { acao: "avulso", servico, cliente, dia, horario, duracao, profissionalId? }  atendimento espontâneo.
// POST { acao: "remarcar", id, dia, horario, profissionalId?, duracao? }            muda dia, horário ou barbeiro.
// POST { acao: "cancelar", id }                                                       cancela (libera o horário).
// Quem decide ou registra: o dono, o dono-barbeiro, ou o próprio barbeiro do pedido.
const { rest, todas } = require("./supabase");
const { usuarioDaRequisicao, perfilDe, ehAdmin, ehAdminDaPlataforma } = require("./conta");
const { codigoNovo, texto } = require("./agenda");
const { precoDoServico, valorDoTexto } = require("./precos");
const { diaDaSemana, dataValida, horaValida, hojeBr, agoraMinBr, somaDias, minutos, hora, minutosDeTrabalho } = require("./horarios");
const { falha, corpoDe, UUID } = require("./seguranca");

const DECISOES = ["confirmado", "recusado"];
const ENCERRAMENTOS = ["realizado", "nao_realizado"];
const MOTIVOS = ["reagendado", "cliente_nao_apareceu"];
const ATIVOS = ["pendente", "confirmado", "avulso", "realizado"];
const CAMPOS = "id,codigo,servico,profissional,profissional_id,dia,horario,horario_fim,duracao_min,cliente,observacao,status,motivo,valor,comissao_pct,simulado,criado_em";

// Id do profissional ligado ao usuário logado (só barbeiros têm)
async function profissionalDoUsuario(userId) {
  const linhas = await rest(`profissionais?perfil_user_id=eq.${userId}&select=id`);
  return linhas[0] ? linhas[0].id : null;
}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const soma = (lista) => lista.reduce((t, n) => t + n, 0);

// ---------- tela inicial (uma chamada só) ----------
async function dadosDoPainel({ barbeariaId, soDele, meuProfissional, dia }) {
  const hoje = hojeBr();
  const desde30 = somaDias(hoje, -29);
  const inicioMes = hoje.slice(0, 8) + "01";
  const filtro = soDele ? `&profissional_id=eq.${meuProfissional}` : "";

  const [doDia, pendentes, aEncerrar, equipe, agendas, servicos, historico] = await Promise.all([
    rest(`pedidos?barbearia_id=eq.${barbeariaId}&dia=eq.${dia}${filtro}&select=${CAMPOS}&order=horario.asc&limit=500`),
    rest(`pedidos?barbearia_id=eq.${barbeariaId}&status=eq.pendente&dia=gte.${hoje}${filtro}&select=${CAMPOS}&order=dia.asc,horario.asc&limit=200`),
    rest(`pedidos?barbearia_id=eq.${barbeariaId}&status=in.(confirmado,avulso)&dia=lte.${hoje}${filtro}&select=${CAMPOS}&order=dia.desc,horario.desc&limit=200`),
    rest(`profissionais?barbearia_id=eq.${barbeariaId}&ativo=eq.true&select=id,nome,foto_url,perfil_user_id,comissao_pct&order=criado_em.asc`),
    rest(`agenda_dia?dia=eq.${dia}&select=profissional_id,inicio,fim,almoco_inicio,almoco_fim,confirmada_em,profissionais!inner(barbearia_id)&profissionais.barbearia_id=eq.${barbeariaId}`),
    rest(`servicos_precos?barbearia_id=eq.${barbeariaId}&select=nome,preco&order=nome.asc`),
    todas(`pedidos?barbearia_id=eq.${barbeariaId}&dia=gte.${[desde30, inicioMes].sort()[0]}&dia=lte.${hoje}&status=in.(realizado,nao_realizado)${filtro}&select=dia,status,motivo,valor,comissao_pct,profissional_id,simulado&order=id`),
  ]);

  const agendaDe = new Map(agendas.map((a) => [a.profissional_id, a]));
  const ativosDoDia = doDia.filter((p) => ATIVOS.includes(p.status));
  const visiveis = soDele ? equipe.filter((p) => p.id === meuProfissional) : equipe;

  const equipeDia = visiveis.map((p) => {
    const a = agendaDe.get(p.id);
    const meus = ativosDoDia.filter((x) => x.profissional_id === p.id);
    const ocupados = soma(meus.map((x) => Number(x.duracao_min) || 30));
    const trabalho = a && a.confirmada_em ? minutosDeTrabalho(a) : 0;
    return {
      id: p.id,
      nome: p.nome,
      foto_url: p.foto_url,
      temLogin: !!p.perfil_user_id,
      agenda: a
        ? { publicada: !!a.confirmada_em, inicio: String(a.inicio).slice(0, 5), fim: String(a.fim).slice(0, 5), almocoInicio: a.almoco_inicio ? String(a.almoco_inicio).slice(0, 5) : "", almocoFim: a.almoco_fim ? String(a.almoco_fim).slice(0, 5) : "" }
        : null,
      atendimentos: meus.length,
      ocupacao: trabalho ? Math.min(100, Math.round((ocupados / trabalho) * 100)) : null,
    };
  });

  // Próximo atendimento de hoje (a partir de agora)
  let proximo = null;
  if (dia === hoje) {
    const agora = agoraMinBr();
    proximo = ativosDoDia
      .filter((p) => p.status !== "realizado" && minutos(String(p.horario).slice(0, 5)) + (Number(p.duracao_min) || 30) > agora)
      .sort((a, b) => String(a.horario).localeCompare(String(b.horario)))[0] || null;
  }

  // Indicadores
  const trabalhoTotal = soma(equipeDia.map((e) => (e.agenda && e.agenda.publicada ? minutosDeTrabalho({ inicio: e.agenda.inicio, fim: e.agenda.fim, almoco_inicio: e.agenda.almocoInicio, almoco_fim: e.agenda.almocoFim }) : 0)));
  const ocupadoTotal = soma(ativosDoDia.filter((p) => equipeDia.some((e) => e.id === p.profissional_id && e.agenda && e.agenda.publicada)).map((p) => Number(p.duracao_min) || 30));
  const ult30 = historico.filter((p) => p.dia >= desde30);
  const feitos30 = ult30.filter((p) => p.status === "realizado");
  const faltas30 = ult30.filter((p) => p.status === "nao_realizado" && p.motivo === "cliente_nao_apareceu").length;
  const fat30 = soma(feitos30.map((p) => Number(p.valor) || 0));
  const doMes = historico.filter((p) => p.dia >= inicioMes && p.status === "realizado");
  const fatMes = soma(doMes.map((p) => Number(p.valor) || 0));
  const comissaoMes = soma(doMes.map((p) => ((Number(p.valor) || 0) * (Number(p.comissao_pct) || 0)) / 100));

  const kpis = {
    dia: {
      agendados: ativosDoDia.length,
      pendentes: doDia.filter((p) => p.status === "pendente").length,
      confirmados: doDia.filter((p) => p.status === "confirmado" || p.status === "avulso").length,
      realizados: doDia.filter((p) => p.status === "realizado").length,
      faturamentoPrevisto: r2(soma(ativosDoDia.map((p) => Number(p.valor) || 0))),
      faturamentoRealizado: r2(soma(doDia.filter((p) => p.status === "realizado").map((p) => Number(p.valor) || 0))),
      ocupacao: trabalhoTotal ? Math.min(100, Math.round((ocupadoTotal / trabalhoTotal) * 100)) : null,
    },
    ultimos30: {
      atendimentos: feitos30.length,
      faturamento: r2(fat30),
      ticketMedio: feitos30.length ? r2(fat30 / feitos30.length) : 0,
      faltas: faltas30,
      taxaFaltas: feitos30.length + faltas30 ? Math.round((faltas30 / (feitos30.length + faltas30)) * 1000) / 10 : 0,
    },
    mes: { atendimentos: doMes.length, faturamento: r2(fatMes), comissao: r2(comissaoMes) },
  };

  return {
    hoje,
    dia,
    pedidos: doDia,
    pendentes,
    aEncerrar,
    equipe: equipeDia,
    servicos: servicos.map((s) => ({ nome: s.nome, preco: Number(s.preco) })),
    proximo,
    kpis,
    temSimulacao: historico.some((p) => p.simulado) || doDia.some((p) => p.simulado),
  };
}

// ---------- atendimento espontâneo ----------
async function registrarAvulso({ res, barbeariaId, soDele, meuProfissional, b }) {
  const servico = texto(b.servico, 80);
  const cliente = texto(b.cliente, 80);
  const dia = String(b.dia || "");
  const horario = String(b.horario || "");
  const duracao = Number.isInteger(Number(b.duracao)) && Number(b.duracao) >= 5 && Number(b.duracao) <= 240 ? Number(b.duracao) : 30;
  if (!servico || !cliente) return res.status(400).json({ message: "Informe o serviço e o nome do cliente." });
  if (!dataValida(dia) || !horaValida(horario)) return res.status(400).json({ message: "Data ou horário inválido." });
  const hoje = hojeBr();
  if (dia < somaDias(hoje, -60) || dia > somaDias(hoje, 60)) return res.status(400).json({ message: "Escolha uma data até 60 dias antes ou depois de hoje." });
  // Só serviços cadastrados pelo dono
  const cadastrado = await rest(`servicos_precos?barbearia_id=eq.${barbeariaId}&nome=eq.${encodeURIComponent(servico)}&select=nome`);
  if (!cadastrado.length) return res.status(400).json({ message: "Escolha um serviço cadastrado. Os serviços são cadastrados pelo dono no financeiro." });

  // Barbeiro registra para si; o dono escolhe o profissional
  const profissionalId = soDele ? meuProfissional : String(b.profissionalId || "");
  if (!UUID.test(profissionalId)) return res.status(400).json({ message: "Escolha o profissional." });
  const prof = (await rest(`profissionais?id=eq.${profissionalId}&barbearia_id=eq.${barbeariaId}&ativo=eq.true&select=id,nome`))[0];
  if (!prof) return res.status(404).json({ message: "Profissional não encontrado nesta barbearia." });
  const barbearia = (await rest(`barbearias?id=eq.${barbeariaId}&select=slug`))[0];

  // Bloqueios do profissional (intervalos, folgas, bloqueio pontual) também valem para o avulso
  const inicio = minutos(horario);
  const fim = inicio + duracao;
  const dow = diaDaSemana(dia);
  const bloqueios = await rest(`bloqueios?profissional_id=eq.${prof.id}&or=(and(tipo.eq.recorrente,dia_semana.eq.${dow}),and(tipo.eq.pontual,data.eq.${dia}))&select=inicio,fim`);
  const bloqueado = bloqueios.find((x) => inicio < minutos(String(x.fim).slice(0, 5)) && minutos(String(x.inicio).slice(0, 5)) < fim);
  if (bloqueado) return res.status(409).json({ message: `Este horário está bloqueado na agenda (${String(bloqueado.inicio).slice(0, 5)} às ${String(bloqueado.fim).slice(0, 5)}).` });

  const valor = await precoDoServico(barbeariaId, servico, null);
  // Grava de forma atômica (não sobrepõe outro atendimento do mesmo profissional)
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    let r;
    try {
      r = await rest("rpc/criar_pedido", {
        metodo: "POST",
        corpo: {
          p: {
            slug: barbearia.slug, barbearia_id: barbeariaId, profissional_id: prof.id, profissional: prof.nome,
            codigo: codigoNovo(tentativa < 2 ? 4 : 5), servico, dia, horario, cliente, observacao: texto(b.observacao, 200),
            duracao_min: duracao, valor, status: "avulso",
          },
        },
      });
    } catch (e) {
      if (/duplicate|unique/i.test(e.message)) continue;
      throw e;
    }
    if (r && r.erro === "conflito") return res.status(409).json({ message: `Este horário já está ocupado (das ${r.horario}).` });
    const [criado] = await rest(`pedidos?id=eq.${r.id}&select=${CAMPOS}`);
    return res.status(201).json({ pedido: criado });
  }
  throw new Error("Não foi possível gerar um código livre para o atendimento.");
}

// ---------- remarcar e cancelar ----------
async function pedidoDaConta({ id, barbeariaId, soDele, meuProfissional }) {
  if (!UUID.test(String(id || ""))) return { status: 400, message: "Pedido inválido." };
  const [atual] = await rest(`pedidos?id=eq.${id}&barbearia_id=eq.${barbeariaId}&select=${CAMPOS}`);
  if (!atual) return { status: 404, message: "Pedido não encontrado." };
  if (soDele && atual.profissional_id !== meuProfissional) return { status: 403, message: "Este pedido é de outro barbeiro." };
  return { atual };
}

async function remarcar({ res, barbeariaId, soDele, meuProfissional, b }) {
  const r0 = await pedidoDaConta({ id: b.id, barbeariaId, soDele, meuProfissional });
  if (!r0.atual) return res.status(r0.status).json({ message: r0.message });
  const atual = r0.atual;
  if (!["pendente", "confirmado", "avulso"].includes(atual.status)) return res.status(409).json({ message: "Só dá para remarcar um pedido pendente, confirmado ou avulso." });
  const dia = String(b.dia || "");
  const horario = String(b.horario || "");
  if (!dataValida(dia) || !horaValida(horario)) return res.status(400).json({ message: "Data ou horário inválido." });
  const hoje = hojeBr();
  if (dia < hoje || (dia === hoje && minutos(horario) < agoraMinBr() - 5)) return res.status(400).json({ message: "Escolha um horário que ainda não passou." });
  if (dia > somaDias(hoje, 60)) return res.status(400).json({ message: "Escolha uma data até 60 dias à frente." });
  const duracao = Number.isInteger(Number(b.duracao)) && Number(b.duracao) >= 5 && Number(b.duracao) <= 240 ? Number(b.duracao) : Number(atual.duracao_min) || 30;

  // Barbeiro remarca só na própria agenda; o dono pode trocar de barbeiro
  let prof = { id: atual.profissional_id, nome: atual.profissional };
  const novoProf = String(b.profissionalId || "");
  if (novoProf && novoProf !== atual.profissional_id) {
    if (soDele) return res.status(403).json({ message: "Só o dono troca o barbeiro do pedido." });
    if (!UUID.test(novoProf)) return res.status(400).json({ message: "Profissional inválido." });
    const p = (await rest(`profissionais?id=eq.${novoProf}&barbearia_id=eq.${barbeariaId}&ativo=eq.true&select=id,nome`))[0];
    if (!p) return res.status(404).json({ message: "Profissional não encontrado nesta barbearia." });
    prof = p;
  }

  const r = await rest("rpc/remarcar_pedido", {
    metodo: "POST",
    corpo: { p: { id: atual.id, barbearia_id: barbeariaId, profissional_id: prof.id, profissional: prof.nome, dia, horario, duracao_min: duracao } },
  });
  if (r && r.erro === "conflito") return res.status(409).json({ message: `Conflito com outro atendimento (das ${r.horario}). Escolha outro horário.` });
  if (r && r.erro === "nao_encontrado") return res.status(409).json({ message: "Este pedido mudou enquanto você remarcava. Atualize a tela." });
  return res.status(200).json({ pedido: r.pedido });
}

async function cancelar({ res, barbeariaId, soDele, meuProfissional, b }) {
  const r0 = await pedidoDaConta({ id: b.id, barbeariaId, soDele, meuProfissional });
  if (!r0.atual) return res.status(r0.status).json({ message: r0.message });
  if (!["pendente", "confirmado", "avulso"].includes(r0.atual.status)) return res.status(409).json({ message: "Este pedido já foi encerrado." });
  const [novo] = await rest(`pedidos?id=eq.${r0.atual.id}&status=in.(pendente,confirmado,avulso)`, { metodo: "PATCH", prefer: "return=representation", corpo: { status: "cancelado" } });
  if (!novo) return res.status(409).json({ message: "Este pedido mudou enquanto você cancelava. Atualize a tela." });
  return res.status(200).json({ pedido: novo });
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const u = await usuarioDaRequisicao(req);
    if (!u) return res.status(401).json({ message: "Entre na sua conta para continuar." });
    const [perfil, plataforma] = await Promise.all([perfilDe(u.id), ehAdminDaPlataforma(u.id)]);
    // Administrador da plataforma escolhe o site (?barbearia=id); os outros usam a própria barbearia
    let barbeariaId = perfil ? perfil.barbearia_id : null;
    const pedida = String((req.query || {}).barbearia || "");
    if (plataforma && UUID.test(pedida)) barbeariaId = pedida;
    if (!barbeariaId) return res.status(403).json({ message: "Sua conta ainda não está ligada a uma barbearia." });

    // Barbeiro sem ser administrador só enxerga e decide os próprios pedidos
    const soDele = !plataforma && !ehAdmin(perfil);
    const meuProfissional = soDele ? await profissionalDoUsuario(u.id) : null;
    if (soDele && !meuProfissional) return res.status(403).json({ message: "Seu perfil não tem agenda de atendimento." });
    const q = req.query || {};

    if (req.method === "GET") {
      const filtro = soDele ? `&profissional_id=eq.${meuProfissional}` : "";
      const hoje = hojeBr();
      if (q.painel === "1") {
        const dia = String(q.dia || hoje);
        if (!dataValida(dia)) return res.status(400).json({ message: "Data inválida." });
        return res.status(200).json(await dadosDoPainel({ barbeariaId, soDele, meuProfissional, dia }));
      }
      // Pendentes de hoje em diante, de todos os dias (para as telas de confirmação)
      if (q.pendentes === "1") {
        const pendentes = await rest(`pedidos?barbearia_id=eq.${barbeariaId}&status=eq.pendente&dia=gte.${hoje}${filtro}&select=${CAMPOS}&order=dia.asc,horario.asc&limit=200`);
        return res.status(200).json({ pedidos: pendentes });
      }
      // Serviços cadastrados pelo dono (com preço): são os únicos aceitos no atendimento espontâneo
      if (q.servicos === "1") {
        const cadastrados = await rest(`servicos_precos?barbearia_id=eq.${barbeariaId}&select=nome,preco&order=nome.asc`);
        return res.status(200).json({ servicos: cadastrados.map((s) => ({ nome: s.nome, preco: s.preco })) });
      }
      // Atendimentos de dias passados (ou de hoje) que ainda precisam ser marcados como realizados ou não
      if (q.encerrar === "1") {
        const aEncerrar = await rest(`pedidos?barbearia_id=eq.${barbeariaId}&status=in.(confirmado,avulso)&dia=lte.${hoje}${filtro}&select=${CAMPOS}&order=dia.desc,horario.desc&limit=200`);
        return res.status(200).json({ pedidos: aEncerrar });
      }
      // Histórico: atendimentos já encerrados nos últimos 60 dias
      if (q.realizados === "1") {
        const desde = somaDias(hoje, -59);
        const feitos = await rest(`pedidos?barbearia_id=eq.${barbeariaId}&status=in.(realizado,nao_realizado)&dia=gte.${desde}${filtro}&select=${CAMPOS}&order=dia.desc,horario.desc&limit=300`);
        return res.status(200).json({ pedidos: feitos });
      }
      const dia = String(q.dia || "");
      if (!dataValida(dia)) return res.status(400).json({ message: "Data inválida." });
      const pedidos = await rest(`pedidos?barbearia_id=eq.${barbeariaId}&dia=eq.${dia}${filtro}&select=${CAMPOS}&order=horario.asc&limit=500`);
      return res.status(200).json({ pedidos });
    }

    if (req.method === "POST") {
      const b = corpoDe(req);
      const ctx = { res, barbeariaId, soDele, meuProfissional, b };
      if (b.acao === "avulso") return await registrarAvulso(ctx);
      if (b.acao === "remarcar") return await remarcar(ctx);
      if (b.acao === "cancelar") return await cancelar(ctx);
      return res.status(400).json({ message: "Ação desconhecida." });
    }

    if (req.method === "PATCH") {
      const b = corpoDe(req);
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
      if (atual[0].dia > hojeBr()) return res.status(409).json({ message: "Este atendimento ainda não aconteceu." });
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
    return falha(res, e, `${req.method} /api/pedido (painel)`);
  }
};

module.exports.dadosDoPainel = dadosDoPainel;
module.exports.hora = hora;
