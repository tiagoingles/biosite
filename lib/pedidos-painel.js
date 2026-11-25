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
// POST { acao: "avulso", servico, cliente, dia, horario, duracao, profissionalId?, repetir? }  atendimento espontâneo.
//      repetir: { cada: 7|14|21|28, ate } (fase 36, só o dono): o mesmo horário toda semana, a cada 15 dias, 3 ou
//      4 semanas, até a data; cada data vira um atendimento ligado à série. Data com folga ou ocupada fica de fora
//      e volta em serie.pulados.
// POST { acao: "remarcar", id, dia, horario, profissionalId?, duracao?, avisar?, whatsapp? }   muda dia, horário
//      ou barbeiro. Com aviso (avisar: no celular do cliente; whatsapp: o painel manda a mensagem), o cliente
//      precisa aceitar: a resposta traz o link "Aceito o novo horário" / "Não posso" para a mensagem (fase 24).
// POST { acao: "atrasar", profissionalId?, dia, aPartirDe?, minutos, avisar? }       empurra os próximos atendimentos
//      do barbeiro (atraso, imprevisto) e avisa os clientes.
// POST { acao: "cancelar", id }                                                       cancela (libera o horário).
// remarcar e cancelar com serie: "proximos" (fase 36, só o dono): vale para este e para as próximas datas da série.
// Quem decide ou registra: o dono, o dono-barbeiro, ou o próprio barbeiro do pedido.
const { rest, todas } = require("./supabase");
const { comissaoDe } = require("./comissao");
const { usuarioDaRequisicao, perfilDe, ehAdmin, ehAdminDaPlataforma, papelDemo, profissionalDemo } = require("./conta");
const { codigoNovo, texto } = require("./agenda");
const { precoDoServico, valorDoTexto } = require("./precos");
const { diaDaSemana, dataValida, horaValida, hojeBr, agoraMinBr, somaDias, minutos, hora, minutosDeTrabalho } = require("./horarios");
const { falha, corpoDe, UUID } = require("./seguranca");
const { randomUUID } = require("crypto");
const { vencimento, LEMBRAR_ANTES } = require("./clube");
const appCliente = require("./app-cliente");
const presenca = require("./presenca");

const DECISOES = ["confirmado", "recusado"];
const ENCERRAMENTOS = ["realizado", "nao_realizado"];
const MOTIVOS = ["reagendado", "cliente_nao_apareceu"];
const ATIVOS = ["pendente", "confirmado", "avulso", "realizado"];
const { FORMAS_PAGAMENTO } = require("./financeiro-calculo"); // dinheiro, pix, debito, credito (fase 31)
// clube_assinantes(nome): nome cadastrado do assinante, quando o pedido veio pelo clube
// clientes(nome): cadastro do cliente ligado ao pedido (pelo WhatsApp do agendamento ou no painel)
const CAMPOS = "id,codigo,servico,profissional,profissional_id,dia,horario,horario_fim,duracao_min,cliente,observacao,status,motivo,valor,forma_pagamento,comissao_pct,comissao_valor,clube_assinante_id,clube_assinantes(nome),cliente_id,clientes(nome,telefone),simulado,criado_em,chegou_em,sinal_valor,sinal_status,cliente_resposta,cliente_respondeu_em,remarcado_em,dia_anterior,horario_anterior,serie_id,grupo_id,para_quem,para_nome";

// Id do profissional ligado ao usuário logado (só barbeiros têm)
async function profissionalDoUsuario(userId) {
  // Demonstração sem login (fase 25): o barbeiro de exemplo da vitrine
  if (papelDemo(userId) === "barbeiro") { const p = await profissionalDemo("id"); return p ? p.id : null; }
  const linhas = await rest(`profissionais?perfil_user_id=eq.${userId}&select=id`);
  return linhas[0] ? linhas[0].id : null;
}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const soma = (lista) => lista.reduce((t, n) => t + n, 0);

// ---------- chegada do cliente (gestão de atrasos, fase 21) ----------
// "Chegou" no atendimento de hoje: para o aviso de atraso e mostra a hora da chegada. desfazer: true limpa.
async function chegou({ res, barbeariaId, soDele, meuProfissional, b }) {
  const id = String(b.id || "");
  if (!UUID.test(id)) return res.status(400).json({ message: "Pedido inválido." });
  const atual = (await rest(`pedidos?id=eq.${id}&barbearia_id=eq.${barbeariaId}&select=id,status,profissional_id,dia`))[0];
  if (!atual) return res.status(404).json({ message: "Pedido não encontrado." });
  if (soDele && atual.profissional_id !== meuProfissional) return res.status(403).json({ message: "Este pedido é de outro barbeiro." });
  if (!["confirmado", "avulso"].includes(atual.status) || atual.dia !== hojeBr()) return res.status(409).json({ message: "Só dá para marcar a chegada de um atendimento de hoje." });
  const [novo] = await rest(`pedidos?id=eq.${id}`, { metodo: "PATCH", prefer: "return=representation", corpo: { chegou_em: b.desfazer === true ? null : new Date().toISOString() } });
  return res.status(200).json({ pedido: novo });
}

// ---------- sinal no Pix (fase 22) ----------
// "Recebi o sinal": o dono conferiu o Pix no banco. O pedido pendente fica confirmado.
async function sinalPago({ res, barbeariaId, soDele, b }) {
  if (soDele) return res.status(403).json({ message: "Só o dono confirma o sinal: o Pix cai na conta da barbearia." });
  const id = String(b.id || "");
  if (!UUID.test(id)) return res.status(400).json({ message: "Pedido inválido." });
  const atual = (await rest(`pedidos?id=eq.${id}&barbearia_id=eq.${barbeariaId}&select=id,status,sinal_status`))[0];
  if (!atual) return res.status(404).json({ message: "Pedido não encontrado." });
  if (atual.sinal_status !== "aguardando" || !["pendente", "confirmado"].includes(atual.status)) return res.status(409).json({ message: "Este pedido não está esperando sinal." });
  const corpo = { sinal_status: "pago", sinal_pago_em: new Date().toISOString() };
  if (atual.status === "pendente") corpo.status = "confirmado";
  const [novo] = await rest(`pedidos?id=eq.${id}&sinal_status=eq.aguardando`, { metodo: "PATCH", prefer: "return=representation", corpo });
  if (!novo) return res.status(409).json({ message: "Este pedido não está esperando sinal." });
  return res.status(200).json({ pedido: novo });
}

// ---------- tela inicial (uma chamada só) ----------
async function dadosDoPainel({ barbeariaId, soDele, meuProfissional, dia }) {
  const hoje = hojeBr();
  const desde30 = somaDias(hoje, -29);
  const inicioMes = hoje.slice(0, 8) + "01";
  const filtro = soDele ? `&profissional_id=eq.${meuProfissional}` : "";

  // Lembrete do clube na tela Hoje do dono: assinantes ativos perto do vencimento.
  // Falha aqui nunca derruba a tela inicial (sem a lista, o aviso só não aparece).
  const comLembrete = !soDele && dia === hoje;
  const [doDia, pendentes, aEncerrar, equipe, agendas, servicos, historico, pertoDeVencer, produtosAtivos, lembretesProtese, bloqueiosDia] = await Promise.all([
    rest(`pedidos?barbearia_id=eq.${barbeariaId}&dia=eq.${dia}${filtro}&select=${CAMPOS}&order=horario.asc&limit=500`),
    rest(`pedidos?barbearia_id=eq.${barbeariaId}&status=eq.pendente&dia=gte.${hoje}${filtro}&select=${CAMPOS}&order=dia.asc,horario.asc&limit=200`),
    rest(`pedidos?barbearia_id=eq.${barbeariaId}&status=in.(confirmado,avulso)&dia=lte.${hoje}${filtro}&select=${CAMPOS}&order=dia.desc,horario.desc&limit=200`),
    rest(`profissionais?barbearia_id=eq.${barbeariaId}&ativo=eq.true&select=id,nome,foto_url,perfil_user_id,comissao_pct&order=criado_em.asc`),
    rest(`agenda_dia?dia=eq.${dia}&select=profissional_id,inicio,fim,almoco_inicio,almoco_fim,confirmada_em,profissionais!inner(barbearia_id)&profissionais.barbearia_id=eq.${barbeariaId}`),
    rest(`servicos_precos?barbearia_id=eq.${barbeariaId}&select=nome,preco&order=nome.asc`),
    todas(`pedidos?barbearia_id=eq.${barbeariaId}&dia=gte.${[desde30, inicioMes].sort()[0]}&dia=lte.${hoje}&status=in.(realizado,nao_realizado)${filtro}&select=dia,status,motivo,valor,comissao_pct,comissao_valor,clube_assinante_id,profissional_id,simulado&order=id`),
    comLembrete
      ? rest(`clube_assinantes?barbearia_id=eq.${barbeariaId}&status=eq.ativo&pago_ate=lte.${somaDias(hoje, LEMBRAR_ANTES)}&select=nome,status,pago_ate,lembrete_em,lembrete_pago_ate&order=pago_ate.asc&limit=200`).catch((e) => {
          console.error("lembrete do clube na tela Hoje:", e.message);
          return [];
        })
      : [],
    // Produtos acabando (fase 19): aviso na tela Hoje do dono. Sem a tabela, o aviso só não aparece.
    comLembrete ? rest(`produtos?barbearia_id=eq.${barbeariaId}&ativo=eq.true&select=nome,estoque,estoque_minimo&order=nome.asc&limit=300`).catch(() => []) : [],
    // Prótese capilar (fase 20): manutenções vencendo ou atrasadas, sem lembrete
    comLembrete ? require("./protese").paraLembrar(barbeariaId).catch(() => []) : [],
    // Bloqueios do dia (horário travado), para o quadro da agenda mostrar. Sem eles, o quadro só não pinta.
    Promise.all([
      rest(`bloqueios?tipo=eq.pontual&data=eq.${dia}&select=id,tipo,profissional_id,inicio,fim,motivo,profissionais!inner(barbearia_id)&profissionais.barbearia_id=eq.${barbeariaId}`),
      rest(`bloqueios?tipo=eq.recorrente&dia_semana=eq.${diaDaSemana(dia)}&select=id,tipo,profissional_id,inicio,fim,motivo,profissionais!inner(barbearia_id)&profissionais.barbearia_id=eq.${barbeariaId}`),
    ]).then(([a, b]) => [...a, ...b]).catch(() => []),
  ]);
  const estoqueBaixo = (produtosAtivos || []).filter((p) => p.estoque <= Math.max(0, p.estoque_minimo)).map((p) => ({ nome: p.nome, estoque: p.estoque }));

  // Quem ainda precisa ser lembrado da mensalidade (os mais atrasados primeiro)
  const lembretesClube = (pertoDeVencer || [])
    .map((a) => ({ nome: a.nome, v: vencimento(a, hoje) }))
    .filter((x) => x.v && !x.v.lembrado)
    .map((x) => ({ nome: x.nome, dias: x.v.dias }))
    .sort((a, b) => a.dias - b.dias);

  const agendaDe = new Map(agendas.map((a) => [a.profissional_id, a]));
  const bloqueiosDe = new Map();
  for (const b of bloqueiosDia || []) {
    if (!bloqueiosDe.has(b.profissional_id)) bloqueiosDe.set(b.profissional_id, []);
    // id e tipo: o bloqueio pontual pode ser mudado ou removido tocando nele no quadro
    bloqueiosDe.get(b.profissional_id).push({ id: b.id, tipo: b.tipo, inicio: String(b.inicio).slice(0, 5), fim: String(b.fim).slice(0, 5), motivo: b.motivo || "" });
  }
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
      bloqueios: bloqueiosDe.get(p.id) || [],
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
  const comissaoMes = soma(doMes.map(comissaoDe));
  // Ticket médio só de quem pagou no balcão (assinante do clube não paga por atendimento)
  const pagos30 = feitos30.filter((p) => !p.clube_assinante_id);

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
      ticketMedio: pagos30.length ? r2(fat30 / pagos30.length) : 0,
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
    ...(comLembrete ? { lembretesClube, estoqueBaixo, lembretesProtese } : {}),
  };
}

// ---------- atendimento espontâneo ----------
// Agendamento recorrente (fase 36): de quantos em quantos dias repete (sempre no mesmo dia da semana)
const REPETICOES = [7, 14, 21, 28];
const LOTE = 6; // datas da série gravadas ao mesmo tempo
const filtroIds = (ids) => (ids.length === 1 ? `id=eq.${ids[0]}` : `id=in.(${ids.join(",")})`);

// Vários serviços no mesmo encaixe (fase 37): cada linha com o serviço, o barbeiro, o horário e para quem é
// (o próprio cliente, filho ou filha, parente ou outra pessoa). As linhas do mesmo dia ficam ligadas pelo grupo.
const MAX_LINHAS = 6;
const PARA_QUEM = ["filho", "parente", "outro"];
const duracaoValida = (v) => (Number.isInteger(Number(v)) && Number(v) >= 5 && Number(v) <= 240 ? Number(v) : 30);
const sobrepoe = (a, b) => a.inicio < b.fim && b.inicio < a.fim;

async function registrarAvulso({ res, barbeariaId, soDele, meuProfissional, b }) {
  const cliente = texto(b.cliente, 80);
  const dia = String(b.dia || "");
  // Dono pode marcar dois clientes no mesmo horário (fase 34), depois de confirmar no painel; o barbeiro não
  const sobrepor = !soDele && b.sobrepor === true;
  // Cliente escolhido na busca da carteira: o encaixe fica na ficha dele
  const clienteId = b.clienteId ? String(b.clienteId) : null;
  if (clienteId && !UUID.test(clienteId)) return res.status(400).json({ message: "Cliente inválido." });
  // Linhas (fase 37): b.itens; sem itens, o próprio corpo é a única linha (como antes)
  const brutas = Array.isArray(b.itens) && b.itens.length ? b.itens : [b];
  if (brutas.length > MAX_LINHAS) return res.status(400).json({ message: `Marque até ${MAX_LINHAS} serviços por vez.` });
  const linhas = brutas.map((x) => {
    const horario = String((x && x.horario) || "");
    const duracao = duracaoValida(x && x.duracao);
    const inicio = horaValida(horario) ? minutos(horario) : 0;
    return {
      servico: texto(x && x.servico, 80),
      horario,
      duracao,
      inicio,
      fim: inicio + duracao,
      profissionalId: soDele ? meuProfissional : String((x && x.profissionalId) || ""),
      paraQuem: PARA_QUEM.includes(x && x.paraQuem) ? x.paraQuem : null,
      paraNome: texto(x && x.paraNome, 60) || null,
      observacao: texto(x && x.observacao, 200),
    };
  });
  if (!cliente || linhas.some((l) => !l.servico)) return res.status(400).json({ message: "Informe o serviço e o nome do cliente." });
  if (!dataValida(dia) || linhas.some((l) => !horaValida(l.horario))) return res.status(400).json({ message: "Data ou horário inválido." });
  const hoje = hojeBr();
  if (dia < somaDias(hoje, -60) || dia > somaDias(hoje, 60)) return res.status(400).json({ message: "Escolha uma data até 60 dias antes ou depois de hoje." });
  // Repetir (fase 36): só o dono; o mesmo horário a cada 7, 14, 21 ou 28 dias, até a data (no máximo 1 ano)
  const datas = [dia];
  let cada = 0;
  let ate = null;
  if (b.repetir) {
    if (soDele) return res.status(403).json({ message: "Só o dono marca horário que se repete." });
    cada = Number(b.repetir.cada);
    ate = String(b.repetir.ate || "");
    if (!REPETICOES.includes(cada)) return res.status(400).json({ message: "Escolha de quanto em quanto tempo o horário se repete." });
    if (!dataValida(ate) || ate > somaDias(dia, 366)) return res.status(400).json({ message: "Escolha até quando repete: no máximo 1 ano depois do primeiro dia." });
    for (let d = somaDias(dia, cada); d <= ate; d = somaDias(d, cada)) datas.push(d);
    if (datas.length < 2) return res.status(400).json({ message: "Até quando? Com essa data o horário não chega a se repetir." });
  }
  // Só serviços cadastrados pelo dono
  const nomes = [...new Set(linhas.map((l) => l.servico))];
  const cadastrados = await Promise.all(nomes.map((n) => rest(`servicos_precos?barbearia_id=eq.${barbeariaId}&nome=eq.${encodeURIComponent(n)}&select=nome`)));
  if (cadastrados.some((c) => !c.length)) return res.status(400).json({ message: "Escolha um serviço cadastrado. Os serviços são cadastrados pelo dono no financeiro." });

  // Barbeiro registra para si; o dono escolhe o profissional de cada linha
  if (linhas.some((l) => !UUID.test(l.profissionalId))) return res.status(400).json({ message: "Escolha o profissional." });
  const profIds = [...new Set(linhas.map((l) => l.profissionalId))];
  const profs = {};
  for (const id of profIds) {
    const p = (await rest(`profissionais?id=eq.${id}&barbearia_id=eq.${barbeariaId}&ativo=eq.true&select=id,nome`))[0];
    if (!p) return res.status(404).json({ message: "Profissional não encontrado nesta barbearia." });
    profs[id] = p;
  }
  const barbearia = (await rest(`barbearias?id=eq.${barbeariaId}&select=slug`))[0];
  if (clienteId && !(await rest(`clientes?id=eq.${clienteId}&barbearia_id=eq.${barbeariaId}&select=id`)).length) return res.status(404).json({ message: "Cliente não encontrado nesta barbearia." });
  // Mais de uma linha: a mensagem diz de qual barbeiro é o problema
  const deQuem = (l, frase) => (linhas.length > 1 ? `${profs[l.profissionalId].nome}: ${frase.charAt(0).toLowerCase()}${frase.slice(1)}` : frase);

  // Bloqueios de cada barbeiro (intervalos, folgas, bloqueio pontual) também valem para o avulso e cada data da série
  // (a série cai sempre no mesmo dia da semana: os bloqueios recorrentes são os mesmos)
  const dow = diaDaSemana(dia);
  const pontual = datas.length > 1 ? `data.in.(${datas.join(",")})` : `data.eq.${dia}`;
  const bloqueiosDe = {};
  await Promise.all(
    profIds.map(async (id) => {
      bloqueiosDe[id] = await rest(`bloqueios?profissional_id=eq.${id}&or=(and(tipo.eq.recorrente,dia_semana.eq.${dow}),and(tipo.eq.pontual,${pontual}))&select=tipo,data,inicio,fim`);
    })
  );
  const bloqueioEm = (l, d) =>
    bloqueiosDe[l.profissionalId].find((x) => (x.tipo !== "pontual" || !x.data || x.data === d) && l.inicio < minutos(String(x.fim).slice(0, 5)) && minutos(String(x.inicio).slice(0, 5)) < l.fim);
  for (const l of linhas) {
    const bl = bloqueioEm(l, dia);
    if (bl) return res.status(409).json({ message: deQuem(l, `Este horário está bloqueado na agenda (${String(bl.inicio).slice(0, 5)} às ${String(bl.fim).slice(0, 5)}).`) });
  }
  // Mais de uma linha: confere o horário de todas antes de gravar (nada fica pela metade). Duas linhas com o
  // mesmo barbeiro também não podem se sobrepor, a não ser que o dono confirme "marcar mesmo assim".
  if (linhas.length > 1 && !sobrepor) {
    const ocupados = (
      await rest(`pedidos?barbearia_id=eq.${barbeariaId}&dia=eq.${dia}&simulado=eq.false&status=in.(pendente,confirmado,avulso,realizado)&profissional_id=in.(${profIds.join(",")})&select=profissional_id,horario,duracao_min`)
    ).map((o) => {
      const ini = minutos(String(o.horario).slice(0, 5));
      return { prof: o.profissional_id, inicio: ini, fim: ini + (Number(o.duracao_min) || 30), horario: String(o.horario).slice(0, 5) };
    });
    for (let i = 0; i < linhas.length; i++) {
      const l = linhas[i];
      const antes = linhas.slice(0, i).map((x) => ({ prof: x.profissionalId, inicio: x.inicio, fim: x.fim, horario: x.horario }));
      const outro = ocupados.concat(antes).find((o) => o.prof === l.profissionalId && sobrepoe(o, l));
      if (outro) return res.status(409).json({ message: deQuem(l, `Este horário já está ocupado (das ${outro.horario}).`), conflito: true, podeSobrepor: !soDele });
    }
  }

  const precos = {};
  await Promise.all(
    nomes.map(async (n) => {
      precos[n] = await precoDoServico(barbeariaId, n, null);
    })
  );
  // Grava de forma atômica (não sobrepõe outro atendimento do mesmo profissional)
  const criar = async (l, d) => {
    for (let tentativa = 0; tentativa < 4; tentativa++) {
      try {
        return await rest("rpc/criar_pedido", {
          metodo: "POST",
          corpo: {
            p: {
              slug: barbearia.slug, barbearia_id: barbeariaId, profissional_id: l.profissionalId, profissional: profs[l.profissionalId].nome,
              codigo: codigoNovo(tentativa < 2 ? 4 : 5), servico: l.servico, dia: d, horario: l.horario, cliente, observacao: l.observacao,
              duracao_min: l.duracao, valor: precos[l.servico], status: "avulso", ...(sobrepor ? { permitir_sobreposicao: true } : {}),
            },
          },
        });
      } catch (e) {
        if (!/duplicate|unique/i.test(e.message)) throw e;
      }
    }
    throw new Error("Não foi possível gerar um código livre para o atendimento.");
  };
  // Primeiro dia de cada linha
  const idsDaLinha = [];
  for (const l of linhas) {
    const r = await criar(l, dia);
    if (r && r.erro === "conflito") {
      // Ocupado entre a conferência e a gravação (raro): o que já foi gravado desta marcação é cancelado
      const feitos = idsDaLinha.map((ids) => ids[0]);
      if (feitos.length) await rest(`pedidos?${filtroIds(feitos)}`, { metodo: "PATCH", prefer: "return=minimal", corpo: { status: "cancelado" } });
      // conflito + podeSobrepor: o painel do dono pergunta se marca mesmo assim, no mesmo horário
      return res.status(409).json({ message: deQuem(l, `Este horário já está ocupado (das ${r.horario}).`), conflito: true, podeSobrepor: !soDele });
    }
    idsDaLinha.push([r.id]);
  }
  const grupos = { [dia]: idsDaLinha.map((ids) => ids[0]) };
  // Série: as outras datas de cada linha; a que cai em folga ou bloqueio, ou já tem cliente, fica de fora e volta na resposta
  const pulados = [];
  const tarefas = [];
  linhas.forEach((l, i) => datas.slice(1).forEach((d) => tarefas.push({ l, i, d })));
  for (let k = 0; k < tarefas.length; k += LOTE) {
    const lote = await Promise.all(
      tarefas.slice(k, k + LOTE).map(async ({ l, i, d }) => {
        if (bloqueioEm(l, d)) return { i, dia: d, motivo: "bloqueio" };
        const x = await criar(l, d);
        return x && x.erro === "conflito" ? { i, dia: d, motivo: "ocupado", horario: x.horario || null } : { i, dia: d, id: x.id };
      })
    );
    lote.forEach((x) => {
      if (x.id) {
        idsDaLinha[x.i].push(x.id);
        (grupos[x.dia] = grupos[x.dia] || []).push(x.id);
        return;
      }
      const l = linhas[x.i];
      pulados.push({ dia: x.dia, motivo: x.motivo, ...(x.horario ? { horario: x.horario } : {}), ...(linhas.length > 1 ? { servico: l.servico, profissional: profs[l.profissionalId].nome } : {}) });
    });
  }
  const series = [];
  if (datas.length > 1) {
    for (let i = 0; i < linhas.length; i++) {
      const [s] = await rest("pedido_series", { metodo: "POST", prefer: "return=representation", corpo: { barbearia_id: barbeariaId, cada_dias: cada, ate } });
      series.push(s);
    }
  }
  // Cliente da carteira, série e para quem: em todas as datas da linha de uma vez; o grupo, por data
  const ligacoes = [];
  linhas.forEach((l, i) => {
    const corpo = {
      ...(clienteId ? { cliente_id: clienteId } : {}),
      ...(series[i] ? { serie_id: series[i].id } : {}),
      ...(l.paraQuem ? { para_quem: l.paraQuem } : {}),
      ...(l.paraNome ? { para_nome: l.paraNome } : {}),
    };
    if (Object.keys(corpo).length) ligacoes.push(() => rest(`pedidos?${filtroIds(idsDaLinha[i])}`, { metodo: "PATCH", prefer: "return=minimal", corpo }));
  });
  if (linhas.length > 1) {
    Object.values(grupos).forEach((ids) => {
      if (ids.length > 1) ligacoes.push(() => rest(`pedidos?${filtroIds(ids)}`, { metodo: "PATCH", prefer: "return=minimal", corpo: { grupo_id: randomUUID() } }));
    });
  }
  for (let k = 0; k < ligacoes.length; k += LOTE) await Promise.all(ligacoes.slice(k, k + LOTE).map((f) => f()));
  const [criado] = await rest(`pedidos?id=eq.${idsDaLinha[0][0]}&select=${CAMPOS}`);
  const criados = idsDaLinha.reduce((t, ids) => t + ids.length, 0);
  return res.status(201).json({
    pedido: criado,
    ...(linhas.length > 1 ? { criados } : {}),
    ...(series.length ? { serie: { id: series[0].id, cada, ate, criados, pulados } } : {}),
  });
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

  // Dono pode deixar dois clientes no mesmo horário (fase 34), depois de confirmar no painel; o barbeiro não
  const sobrepor = !soDele && b.sobrepor === true;
  const r = await rest("rpc/remarcar_pedido", {
    metodo: "POST",
    corpo: { p: { id: atual.id, barbearia_id: barbeariaId, profissional_id: prof.id, profissional: prof.nome, dia, horario, duracao_min: duracao, ...(sobrepor ? { permitir_sobreposicao: true } : {}) } },
  });
  if (r && r.erro === "conflito") return res.status(409).json({ message: `Conflito com outro atendimento (das ${r.horario}).` + (soDele ? " Escolha outro horário." : ""), conflito: true, podeSobrepor: !soDele });
  if (r && r.erro === "nao_encontrado") return res.status(409).json({ message: "Este pedido mudou enquanto você remarcava. Atualize a tela." });
  const aviso = await depoisDeMudar(atual, r.pedido, { avisar: b.avisar === true, whatsapp: b.whatsapp === true });
  // Série (fase 36): "este e os próximos" leva a mesma mudança para as próximas datas (só o dono)
  const serie = b.serie === "proximos" && atual.serie_id && !soDele ? await remarcarProximos(atual, { barbeariaId, prof, dia, horario, duracao, sobrepor }) : null;
  return res.status(200).json({ pedido: r.pedido, avisados: aviso.avisados, link: aviso.link, ...(serie ? { serie } : {}) });
}

// As próximas datas da série andam junto: mesmo horário, barbeiro e duração, e o mesmo número de dias que esta
// andou. Data em que o novo horário já está ocupado (ou que cairia no passado) fica como estava e volta na lista.
async function remarcarProximos(atual, o) {
  const andou = Math.round((Date.parse(o.dia + "T12:00:00Z") - Date.parse(atual.dia + "T12:00:00Z")) / 864e5);
  const proximos = await rest(`pedidos?serie_id=eq.${atual.serie_id}&barbearia_id=eq.${o.barbeariaId}&dia=gt.${atual.dia}&status=in.(pendente,confirmado,avulso)&select=${CAMPOS}&order=dia.asc&limit=120`);
  const hoje = hojeBr();
  let mudados = 1; // este, já remarcado
  const naoMudaram = [];
  for (let i = 0; i < proximos.length; i += LOTE) {
    const lote = await Promise.all(
      proximos.slice(i, i + LOTE).map(async (s) => {
        const novoDia = somaDias(s.dia, andou);
        if (novoDia < hoje) return { dia: s.dia, motivo: "passado" };
        const p = { id: s.id, barbearia_id: o.barbeariaId, profissional_id: o.prof.id, profissional: o.prof.nome, dia: novoDia, horario: o.horario, duracao_min: o.duracao };
        const x = await rest("rpc/remarcar_pedido", { metodo: "POST", corpo: { p: { ...p, ...(o.sobrepor ? { permitir_sobreposicao: true } : {}) } } });
        if (!x || x.erro) return { dia: s.dia, motivo: x && x.erro === "conflito" ? "ocupado" : "mudou" };
        await depoisDeMudar(s, x.pedido);
        return { ok: true };
      })
    );
    lote.forEach((x) => (x.ok ? mudados++ : naoMudaram.push(x)));
  }
  return { mudados, naoMudaram };
}

const DIA_BR = (d) => `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}`;
// Horário mudou: a confirmação antiga não vale mais, os avisos perto da hora saem de novo no horário novo
// e, se pedido, o cliente recebe "Seu horário mudou" (com o link para confirmar ou cancelar).
async function depoisDeMudar(antes, depois, o = {}) {
  const vazio = { avisados: 0, link: "" };
  if (!depois) return vazio;
  const mudouHora = antes.dia !== depois.dia || String(antes.horario).slice(0, 5) !== String(depois.horario).slice(0, 5);
  if (!mudouHora) return vazio;
  // Pedir o aceite: o horário de antes é o último que o cliente aceitou (mudou duas vezes sem resposta: o primeiro)
  const pedirAceite = !!(o.avisar || o.whatsapp);
  const corpo = { cliente_resposta: null, cliente_respondeu_em: null };
  if (pedirAceite) {
    const semResposta = antes.remarcado_em && !antes.cliente_resposta;
    corpo.remarcado_em = new Date().toISOString();
    corpo.dia_anterior = semResposta && antes.dia_anterior ? antes.dia_anterior : antes.dia;
    corpo.horario_anterior = semResposta && antes.horario_anterior ? antes.horario_anterior : String(antes.horario).slice(0, 5);
  }
  await Promise.all([
    antes.cliente_resposta || pedirAceite ? rest(`pedidos?id=eq.${antes.id}`, { metodo: "PATCH", prefer: "return=minimal", corpo }).catch(() => {}) : null,
    rest(`avisos_pedido?pedido_id=eq.${antes.id}&tipo=in.(chega,cliente30,atraso,cliente_atraso,confirmar)`, { metodo: "DELETE", prefer: "return=minimal" }).catch(() => {}),
  ]);
  if (!pedirAceite) return vazio;
  const slug = antes.slug || depois.slug;
  const t = presenca.token(antes.id);
  const link = `/${slug}?confirmar=${t}`;
  if (!o.avisar) return { avisados: 0, link };
  const hoje = hojeBr();
  const quando = (d) => (d === hoje ? "hoje" : d === somaDias(hoje, 1) ? "amanhã" : DIA_BR(d));
  const novo = `${quando(depois.dia)} às ${String(depois.horario).slice(0, 5)}`;
  const diaEra = corpo.dia_anterior, horaEra = corpo.horario_anterior;
  const era = diaEra === depois.dia ? horaEra : `${quando(diaEra)} às ${horaEra}`;
  try {
    const avisados = await appCliente.enviarAoCliente({ ...antes, ...depois, barbearia_id: antes.barbearia_id || depois.barbearia_id, cliente_id: antes.cliente_id, slug }, {
      title: "Seu horário mudou",
      body: `${depois.servico || antes.servico}${depois.profissional ? " com " + depois.profissional : ""}: agora ${novo} (era ${era}). Você aceita?`,
      url: link,
      tag: "mudou-" + String(antes.id).slice(0, 8),
      token: t,
      acoes: [{ action: "sim", title: "Aceito o novo horário" }, { action: "nao", title: "Não posso" }],
    });
    return { avisados, link };
  } catch (e) {
    console.error("aviso de horário mudado:", e.message);
    return { avisados: 0, link };
  }
}

// Atraso ou imprevisto: empurra os próximos atendimentos do barbeiro naquele dia, do último para o primeiro
// (cada um vai para o espaço que o seguinte já deixou livre). Quem não cabe fica onde está e volta na lista.
const ATRASOS = [5, 10, 15, 20, 30, 45, 60];
async function atrasar({ res, barbeariaId, soDele, meuProfissional, b }) {
  const min = Number(b.minutos);
  if (!ATRASOS.includes(min)) return res.status(400).json({ message: "Escolha de quanto é o atraso." });
  const hoje = hojeBr();
  const dia = String(b.dia || hoje);
  if (!dataValida(dia) || dia < hoje) return res.status(400).json({ message: "Escolha hoje ou um dia à frente." });
  let profId = soDele ? meuProfissional : String(b.profissionalId || "");
  if (!UUID.test(profId)) return res.status(400).json({ message: "Escolha o barbeiro." });
  const prof = (await rest(`profissionais?id=eq.${profId}&barbearia_id=eq.${barbeariaId}&select=id,nome`))[0];
  if (!prof) return res.status(404).json({ message: "Profissional não encontrado nesta barbearia." });
  const agora = dia === hoje ? agoraMinBr() : 0;
  const desde = horaValida(String(b.aPartirDe || "")) ? Math.max(minutos(String(b.aPartirDe)), dia === hoje ? agora - 60 : 0) : Math.max(0, agora - 60);
  const lista = (await rest(`pedidos?barbearia_id=eq.${barbeariaId}&profissional_id=eq.${profId}&dia=eq.${dia}&status=in.(pendente,confirmado,avulso)&simulado=eq.false&select=${CAMPOS}&order=horario.desc&limit=100`))
    .filter((p) => minutos(String(p.horario).slice(0, 5)) >= desde);
  if (!lista.length) return res.status(200).json({ movidos: 0, falhas: [], avisados: 0 });
  const movidos = [];
  const falhas = [];
  for (const p of lista) {
    const dur = Number(p.duracao_min) || 30;
    const ini = minutos(String(p.horario).slice(0, 5)) + min;
    if (ini + dur > 24 * 60) { falhas.push({ cliente: p.cliente, horario: String(p.horario).slice(0, 5), motivo: "passa da meia-noite" }); continue; }
    const r = await rest("rpc/remarcar_pedido", { metodo: "POST", corpo: { p: { id: p.id, barbearia_id: barbeariaId, profissional_id: profId, profissional: prof.nome, dia, horario: hora(ini), duracao_min: dur } } });
    if (!r || r.erro) { falhas.push({ cliente: p.cliente, horario: String(p.horario).slice(0, 5), motivo: r && r.erro === "conflito" ? `conflito com o horário das ${r.horario}` : "mudou enquanto isso" }); continue; }
    movidos.push([p, r.pedido]);
  }
  const avisos = await Promise.all(movidos.map(([antes, depois]) => depoisDeMudar(antes, depois, { avisar: b.avisar === true, whatsapp: b.whatsapp === true })));
  // Para o painel mandar no WhatsApp de quem não recebeu no celular (com o link de aceite)
  const mudados = movidos.map(([antes, depois], i) => ({
    id: antes.id, cliente: antes.cliente, servico: antes.servico, profissional: depois.profissional || antes.profissional, codigo: antes.codigo,
    dia: depois.dia, de: String(antes.horario).slice(0, 5), para: String(depois.horario).slice(0, 5),
    telefone: (antes.clientes && antes.clientes.telefone) || "", avisado: avisos[i].avisados > 0, link: avisos[i].link,
  })).reverse();
  return res.status(200).json({ movidos: movidos.length, falhas, avisados: avisos.reduce((t, a) => t + a.avisados, 0), lista: mudados });
}

async function cancelar({ res, barbeariaId, soDele, meuProfissional, b }) {
  const r0 = await pedidoDaConta({ id: b.id, barbeariaId, soDele, meuProfissional });
  if (!r0.atual) return res.status(r0.status).json({ message: r0.message });
  if (!["pendente", "confirmado", "avulso"].includes(r0.atual.status)) return res.status(409).json({ message: "Este pedido já foi encerrado." });
  // Série (fase 36): "este e os próximos" cancela também as próximas datas (só o dono)
  if (b.serie === "proximos" && r0.atual.serie_id && !soDele) {
    const lista = await rest(`pedidos?serie_id=eq.${r0.atual.serie_id}&barbearia_id=eq.${barbeariaId}&dia=gte.${r0.atual.dia}&status=in.(pendente,confirmado,avulso)`, {
      metodo: "PATCH",
      prefer: "return=representation",
      corpo: { status: "cancelado" },
    });
    const este = lista.find((x) => x.id === r0.atual.id);
    if (!este) return res.status(409).json({ message: "Este pedido mudou enquanto você cancelava. Atualize a tela." });
    return res.status(200).json({ pedido: este, cancelados: lista.length, espera: await esperaDaVaga(barbeariaId, r0.atual, soDele) });
  }
  const [novo] = await rest(`pedidos?id=eq.${r0.atual.id}&status=in.(pendente,confirmado,avulso)`, { metodo: "PATCH", prefer: "return=representation", corpo: { status: "cancelado" } });
  if (!novo) return res.status(409).json({ message: "Este pedido mudou enquanto você cancelava. Atualize a tela." });
  return res.status(200).json({ pedido: novo, espera: await esperaDaVaga(barbeariaId, r0.atual, soDele) });
}

// Lista de espera (fase 39): quem cabe no horário que acabou de vagar, na ordem de chegada (para o dono chamar)
async function esperaDaVaga(barbeariaId, vaga, soDele) {
  const hoje = hojeBr();
  if (soDele || vaga.dia < hoje) return [];
  // Hoje, só se o horário ainda não passou (o mesmo critério da aba Espera)
  if (vaga.dia === hoje && minutos(String(vaga.horario).slice(0, 5)) < agoraMinBr()) return [];
  return require("./espera").candidatosDaVaga(barbeariaId, vaga).catch(() => []);
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
      if (b.acao === "atrasar") return await atrasar(ctx);
      if (b.acao === "cancelar") return await cancelar(ctx);
      if (b.acao === "chegou") return await chegou(ctx);
      if (b.acao === "sinal-pago") return await sinalPago(ctx);
      return res.status(400).json({ message: "Ação desconhecida." });
    }

    if (req.method === "PATCH") {
      const b = corpoDe(req);
      const id = String(b.id || "");
      if (!UUID.test(id)) return res.status(400).json({ message: "Pedido inválido." });
      const decide = DECISOES.includes(b.status);
      const encerra = ENCERRAMENTOS.includes(b.status);
      // Sem status: edita o valor (desconto) e/ou a forma de pagamento
      const editaValor = b.status === undefined && (b.valor !== undefined || b.forma_pagamento !== undefined);
      if (!decide && !encerra && !editaValor) return res.status(400).json({ message: "Status inválido." });
      if (b.forma_pagamento != null && b.forma_pagamento !== "" && !FORMAS_PAGAMENTO.includes(b.forma_pagamento)) return res.status(400).json({ message: "Forma de pagamento inválida." });
      if (b.status === "nao_realizado" && !MOTIVOS.includes(b.motivo)) return res.status(400).json({ message: "Informe o motivo: reagendado ou cliente não apareceu." });

      // O pedido precisa ser desta barbearia e, para barbeiro, ser dele
      const atual = await rest(`pedidos?id=eq.${id}&barbearia_id=eq.${barbeariaId}&select=id,status,profissional_id,dia,servico,valor`);
      if (!atual.length) return res.status(404).json({ message: "Pedido não encontrado." });
      if (soDele && atual[0].profissional_id !== meuProfissional) return res.status(403).json({ message: "Este pedido é de outro barbeiro." });

      // Editar o valor (ex.: desconto). Só quando o pedido é enviado com "valor" e sem status.
      if (editaValor) {
        const corpo = {};
        if (b.valor !== undefined) {
          const v = b.valor === null || b.valor === "" ? null : valorDoTexto(b.valor);
          if (b.valor !== null && b.valor !== "" && v === null) return res.status(400).json({ message: "Valor inválido." });
          corpo.valor = v;
        }
        if (b.forma_pagamento !== undefined) corpo.forma_pagamento = b.forma_pagamento || null;
        const [novo] = await rest(`pedidos?id=eq.${id}&barbearia_id=eq.${barbeariaId}`, { metodo: "PATCH", prefer: "return=representation", corpo });
        return res.status(200).json({ pedido: novo });
      }

      if (decide) {
        if (atual[0].status !== "pendente") return res.status(409).json({ message: "Este pedido já foi decidido." });
        const [novo] = await rest(`pedidos?id=eq.${id}&status=eq.pendente`, { metodo: "PATCH", prefer: "return=representation", corpo: { status: b.status } });
        if (!novo) return res.status(409).json({ message: "Este pedido já foi decidido." });
        // Marcação com vários serviços pelo site (fase 38): confirmar ou recusar vale para os outros pendentes do grupo
        let grupo = 0;
        if (novo.grupo_id && !soDele) {
          const outros = await rest(`pedidos?grupo_id=eq.${novo.grupo_id}&barbearia_id=eq.${barbeariaId}&status=eq.pendente&id=neq.${id}`, { metodo: "PATCH", prefer: "return=representation", corpo: { status: b.status } });
          grupo = outros.length;
        }
        return res.status(200).json({ pedido: novo, ...(grupo ? { grupo } : {}) });
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
        // Como o cliente pagou (o painel pergunta ao marcar realizado; o do clube já está pago na mensalidade)
        if (b.forma_pagamento) corpo.forma_pagamento = b.forma_pagamento;
      }
      const [novo] = await rest(`pedidos?id=eq.${id}&status=in.(confirmado,avulso)`, { metodo: "PATCH", prefer: "return=representation", corpo });
      if (!novo) return res.status(409).json({ message: "Este atendimento já foi encerrado." });
      // Prótese capilar: o atendimento realizado vira manutenção na ficha do cliente (falha aqui não derruba nada)
      if (b.status === "realizado") await require("./protese").registrarDoAtendimento(novo);
      return res.status(200).json({ pedido: novo });
    }

    return res.status(405).json({ message: "Método não permitido." });
  } catch (e) {
    return falha(res, e, `${req.method} /api/pedido (painel)`);
  }
};

module.exports.dadosDoPainel = dadosDoPainel;
module.exports.hora = hora;
