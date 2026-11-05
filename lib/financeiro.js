// Financeiro da barbearia: faturamento (dia, semana, mês, trimestre), comissões, gastos fixos,
// insumos, preços dos serviços e simulação de 30 dias.
// Acesso: o dono e o dono-barbeiro. A conta da plataforma também, escolhendo a barbearia (?barbearia=id).
// GET  -> tudo o que as telas precisam, em uma resposta.
// POST { acao, ... } -> grava. Ver as ações em ACOES abaixo.
const { rest } = require("./supabase");
const { usuarioDaRequisicao, perfilDe, ehAdmin, ehAdminDaPlataforma } = require("./conta");
const { codigoNovo, texto } = require("./agenda");
const { simularTrintaDias, zerarSimulacao } = require("./simulacao");

const UUID = /^[0-9a-f-]{36}$/i;
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORIAS = ["aluguel", "contas", "software", "servicos", "impostos", "outros"];
const PAGINA = 1000; // limite de linhas por consulta no Supabase

// ---------- datas (Brasília) ----------
function hojeBr() {
  return new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
}
function somaDias(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Quantidade de dias entre duas datas, contando as duas pontas
function diasEntre(a, b) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5) + 1;
}
function inicioMes(iso) {
  return iso.slice(0, 8) + "01";
}
function inicioTrimestre(iso) {
  const [y, m] = iso.split("-").map(Number);
  const mes = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(mes).padStart(2, "0")}-01`;
}
function diaSemanaSeg(iso) {
  return new Date(iso + "T12:00:00Z").getUTCDay(); // 0 = domingo
}

// Períodos do resumo. O gasto fixo (valor mensal) entra proporcional aos dias do período:
// valor ÷ 30 por dia. Assim, o dia, a semana e o mês parcial ficam comparáveis.
function periodosDe(hoje) {
  const mes = inicioMes(hoje);
  const tri = inicioTrimestre(hoje);
  return {
    dia: { rotulo: "Dia", de: hoje, ate: hoje, fator: 1 / 30 },
    semana: { rotulo: "Semana (7 dias)", de: somaDias(hoje, -6), ate: hoje, fator: 7 / 30 },
    ultimos30: { rotulo: "Últimos 30 dias", de: somaDias(hoje, -29), ate: hoje, fator: 1 },
    mes: { rotulo: "Mês até hoje", de: mes, ate: hoje, fator: diasEntre(mes, hoje) / 30 },
    trimestre: { rotulo: "Trimestre", de: tri, ate: hoje, fator: diasEntre(tri, hoje) / 30 },
  };
}

// ---------- números ----------
const soma = (lista) => lista.reduce((t, n) => t + n, 0);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Lê todas as linhas de uma consulta, em páginas (o Supabase devolve no máximo 1000 por vez)
async function todas(caminho) {
  let saida = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const lote = await rest(`${caminho}&limit=${PAGINA}&offset=${inicio}`);
    saida = saida.concat(lote);
    if (lote.length < PAGINA) return saida;
  }
}

function resumoDoPeriodo(p, pedidos, despesasAtivas, movimentos) {
  const no = pedidos.filter((x) => x.dia >= p.de && x.dia <= p.ate);
  const feitos = no.filter((x) => x.status === "realizado");
  const faturamento = soma(feitos.map((x) => Number(x.valor) || 0));
  const comissoes = soma(feitos.map((x) => ((Number(x.valor) || 0) * (Number(x.comissao_pct) || 0)) / 100));
  const fixos = soma(despesasAtivas.map((d) => Number(d.valor) * p.fator));
  const insumos = soma(
    movimentos.filter((m) => m.tipo === "entrada" && m.data >= p.de && m.data <= p.ate).map((m) => Number(m.valor_total) || 0)
  );
  return {
    rotulo: p.rotulo,
    de: p.de,
    ate: p.ate,
    faturamento: r2(faturamento),
    atendimentos: feitos.length,
    naoRealizados: no.filter((x) => x.status === "nao_realizado").length,
    semPreco: feitos.filter((x) => x.valor == null).length,
    comissoes: r2(comissoes),
    gastosFixos: r2(fixos),
    insumosComprados: r2(insumos),
    lucro: r2(faturamento - comissoes - fixos - insumos),
  };
}

// ---------- leitura ----------
async function lerFinanceiro(barbeariaId) {
  const hoje = hojeBr();
  const periodos = periodosDe(hoje);
  const inicioGeral = [periodos.trimestre.de, somaDias(hoje, -29)].sort()[0];

  const [pedidos, despesas, insumos, movimentos, precos, profissionais] = await Promise.all([
    todas(
      `pedidos?barbearia_id=eq.${barbeariaId}&dia=gte.${inicioGeral}&dia=lte.${hoje}&status=in.(realizado,nao_realizado)&select=id,dia,status,valor,comissao_pct,profissional_id,profissional,servico,simulado&order=id`
    ),
    todas(`despesas?barbearia_id=eq.${barbeariaId}&select=id,descricao,categoria,valor,ativo,simulado&order=criado_em.asc`),
    todas(`insumos?barbearia_id=eq.${barbeariaId}&select=id,nome,unidade,estoque_minimo,simulado&order=nome.asc`),
    todas(`insumo_movimentos?barbearia_id=eq.${barbeariaId}&select=id,insumo_id,tipo,quantidade,valor_total,data,simulado&order=id`),
    todas(`servicos_precos?barbearia_id=eq.${barbeariaId}&select=id,nome,preco,simulado&order=nome.asc`),
    todas(`profissionais?barbearia_id=eq.${barbeariaId}&ativo=eq.true&select=id,nome,comissao_pct&order=criado_em.asc`),
  ]);

  const despesasAtivas = despesas.filter((d) => d.ativo);
  const resumo = {};
  Object.keys(periodos).forEach((k) => (resumo[k] = resumoDoPeriodo(periodos[k], pedidos, despesasAtivas, movimentos)));

  // Faturamento dos últimos 30 dias, dia a dia (para o gráfico)
  const serie = [];
  for (let i = 29; i >= 0; i--) {
    const dia = somaDias(hoje, -i);
    const do_dia = pedidos.filter((x) => x.dia === dia && x.status === "realizado");
    serie.push({ dia, faturamento: r2(soma(do_dia.map((x) => Number(x.valor) || 0))), atendimentos: do_dia.length });
  }

  // Comissão de cada barbeiro no mês corrente
  const mes = periodos.mes;
  const comissoes = profissionais.map((p) => {
    const feitos = pedidos.filter((x) => x.profissional_id === p.id && x.status === "realizado" && x.dia >= mes.de && x.dia <= mes.ate);
    const faturamento = soma(feitos.map((x) => Number(x.valor) || 0));
    const valorComissao = soma(feitos.map((x) => ((Number(x.valor) || 0) * (Number(x.comissao_pct) || 0)) / 100));
    return { id: p.id, nome: p.nome, comissaoPct: Number(p.comissao_pct), atendimentos: feitos.length, faturamento: r2(faturamento), comissao: r2(valorComissao) };
  });

  // Estoque de cada insumo: entradas menos saídas
  const insumosComEstoque = insumos.map((i) => {
    const mov = movimentos.filter((m) => m.insumo_id === i.id);
    const estoque = soma(mov.map((m) => (m.tipo === "entrada" ? Number(m.quantidade) : -Number(m.quantidade))));
    return { id: i.id, nome: i.nome, unidade: i.unidade, estoqueMinimo: Number(i.estoque_minimo), estoque: r2(estoque), abaixoDoMinimo: estoque < Number(i.estoque_minimo), simulado: i.simulado };
  });

  // Serviços que já tiveram atendimento no período mas ainda não têm preço
  const nomesComPreco = new Set(precos.map((p) => p.nome));
  const servicosSemPreco = [...new Set(pedidos.filter((x) => x.status === "realizado").map((x) => x.servico))].filter((n) => !nomesComPreco.has(n));

  const temSimulacao = [...pedidos, ...despesas, ...insumos, ...precos].some((x) => x.simulado);

  return {
    hoje,
    resumo,
    serie,
    comissoes,
    despesas: despesas.map((d) => ({ id: d.id, descricao: d.descricao, categoria: d.categoria, valor: Number(d.valor), ativo: d.ativo, simulado: d.simulado })),
    insumos: insumosComEstoque,
    precos: precos.map((p) => ({ id: p.id, nome: p.nome, preco: Number(p.preco), simulado: p.simulado })),
    servicosSemPreco,
    temSimulacao,
  };
}

// ---------- escrita ----------
function numeroValido(v, min = 0, max = 1e7) {
  const n = Number(String(v == null ? "" : v).replace(",", "."));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

// Preço novo: grava e preenche o valor dos atendimentos realizados que ainda não tinham preço
async function salvarPreco(barbeariaId, b) {
  const nome = texto(b.nome, 80);
  const preco = numeroValido(b.preco);
  if (!nome) return { status: 400, corpo: { message: "Informe o nome do serviço." } };
  if (preco === null) return { status: 400, corpo: { message: "Preço inválido." } };
  await rest("servicos_precos?on_conflict=barbearia_id,nome", {
    metodo: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    corpo: { barbearia_id: barbeariaId, nome, preco, simulado: false },
  });
  // Atendimentos realizados sem valor passam a ter o preço (e a comissão de quem atendeu)
  const profissionais = await rest(`profissionais?barbearia_id=eq.${barbeariaId}&select=id,comissao_pct`);
  const nomeCodificado = encodeURIComponent(nome);
  for (const p of profissionais) {
    await rest(
      `pedidos?barbearia_id=eq.${barbeariaId}&servico=eq.${nomeCodificado}&status=eq.realizado&valor=is.null&profissional_id=eq.${p.id}`,
      { metodo: "PATCH", prefer: "return=minimal", corpo: { valor: preco, comissao_pct: Number(p.comissao_pct) } }
    );
  }
  await rest(`pedidos?barbearia_id=eq.${barbeariaId}&servico=eq.${nomeCodificado}&status=eq.realizado&valor=is.null&profissional_id=is.null`, {
    metodo: "PATCH",
    prefer: "return=minimal",
    corpo: { valor: preco },
  });
  return { status: 200, corpo: { ok: true } };
}

async function criarDespesa(barbeariaId, b) {
  const descricao = texto(b.descricao, 80);
  const valor = numeroValido(b.valor);
  const categoria = CATEGORIAS.includes(b.categoria) ? b.categoria : "outros";
  if (!descricao) return { status: 400, corpo: { message: "Informe a descrição do gasto." } };
  if (valor === null) return { status: 400, corpo: { message: "Valor mensal inválido." } };
  await rest("despesas", { metodo: "POST", prefer: "return=minimal", corpo: { barbearia_id: barbeariaId, descricao, categoria, valor } });
  return { status: 201, corpo: { ok: true } };
}

async function alterarDespesa(barbeariaId, b) {
  if (!UUID.test(String(b.id || ""))) return { status: 400, corpo: { message: "Gasto inválido." } };
  const filtro = `despesas?id=eq.${b.id}&barbearia_id=eq.${barbeariaId}`;
  if (b.acao === "remover-despesa") {
    await rest(filtro, { metodo: "DELETE", prefer: "return=minimal" });
  } else {
    await rest(filtro, { metodo: "PATCH", prefer: "return=minimal", corpo: { ativo: !!b.ativo } });
  }
  return { status: 200, corpo: { ok: true } };
}

async function criarInsumo(barbeariaId, b) {
  const nome = texto(b.nome, 80);
  const unidade = texto(b.unidade, 12) || "un";
  const minimo = numeroValido(b.minimo) ?? 0;
  if (!nome) return { status: 400, corpo: { message: "Informe o nome do insumo." } };
  try {
    await rest("insumos", { metodo: "POST", prefer: "return=minimal", corpo: { barbearia_id: barbeariaId, nome, unidade, estoque_minimo: minimo } });
  } catch (e) {
    if (/duplicate|unique/i.test(e.message)) return { status: 409, corpo: { message: "Já existe um insumo com este nome." } };
    throw e;
  }
  return { status: 201, corpo: { ok: true } };
}

async function registrarMovimento(barbeariaId, b) {
  const insumoId = String(b.insumoId || "");
  if (!UUID.test(insumoId)) return { status: 400, corpo: { message: "Insumo inválido." } };
  const tipo = b.tipo === "entrada" || b.tipo === "saida" ? b.tipo : null;
  const quantidade = numeroValido(b.quantidade, 0.01);
  if (!tipo) return { status: 400, corpo: { message: "Escolha entrada ou saída." } };
  if (quantidade === null) return { status: 400, corpo: { message: "Quantidade inválida." } };
  const data = DIA.test(String(b.data || "")) ? String(b.data) : hojeBr();
  const valorTotal = tipo === "entrada" ? numeroValido(b.valorTotal) ?? 0 : null;
  const dono = await rest(`insumos?id=eq.${insumoId}&barbearia_id=eq.${barbeariaId}&select=id`);
  if (!dono.length) return { status: 404, corpo: { message: "Insumo não encontrado." } };

  if (tipo === "saida") {
    const mov = await rest(`insumo_movimentos?insumo_id=eq.${insumoId}&select=tipo,quantidade`);
    const estoque = soma(mov.map((m) => (m.tipo === "entrada" ? Number(m.quantidade) : -Number(m.quantidade))));
    if (quantidade > estoque) return { status: 409, corpo: { message: `Estoque insuficiente: há ${r2(estoque)} no momento.` } };
  }
  await rest("insumo_movimentos", {
    metodo: "POST",
    prefer: "return=minimal",
    corpo: { barbearia_id: barbeariaId, insumo_id: insumoId, tipo, quantidade, valor_total: valorTotal, data, motivo: texto(b.motivo, 80) },
  });
  return { status: 201, corpo: { ok: true } };
}

async function removerInsumo(barbeariaId, b) {
  if (!UUID.test(String(b.id || ""))) return { status: 400, corpo: { message: "Insumo inválido." } };
  await rest(`insumos?id=eq.${b.id}&barbearia_id=eq.${barbeariaId}`, { metodo: "DELETE", prefer: "return=minimal" });
  return { status: 200, corpo: { ok: true } };
}

async function definirComissao(barbeariaId, b) {
  if (!UUID.test(String(b.profissionalId || ""))) return { status: 400, corpo: { message: "Barbeiro inválido." } };
  const pct = numeroValido(b.pct, 0, 100);
  if (pct === null) return { status: 400, corpo: { message: "Informe a comissão entre 0 e 100%." } };
  await rest(`profissionais?id=eq.${b.profissionalId}&barbearia_id=eq.${barbeariaId}`, {
    metodo: "PATCH",
    prefer: "return=minimal",
    corpo: { comissao_pct: pct },
  });
  return { status: 200, corpo: { ok: true } };
}

// Ações gravadas pelo dono (e pela conta da plataforma, na barbearia escolhida)
const ACOES = {
  "salvar-preco": salvarPreco,
  "criar-despesa": criarDespesa,
  "alterar-despesa": alterarDespesa,
  "remover-despesa": alterarDespesa,
  "criar-insumo": criarInsumo,
  "movimento": registrarMovimento,
  "remover-insumo": removerInsumo,
  "comissao": definirComissao,
};

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const u = await usuarioDaRequisicao(req);
    if (!u) return res.status(401).json({ message: "Entre na sua conta para continuar." });
    const perfil = await perfilDe(u.id);
    const plataforma = await ehAdminDaPlataforma(u.id);

    // A conta da plataforma escolhe a barbearia; o dono usa a própria
    const pedido = req.method === "POST" ? req.body || {} : {};
    const escolhida = String((req.query && req.query.barbearia) || pedido.barbearia || "");
    let barbeariaId = perfil ? perfil.barbearia_id : null;
    if (plataforma && UUID.test(escolhida)) barbeariaId = escolhida;
    if (!barbeariaId) return res.status(403).json({ message: plataforma ? "Escolha uma barbearia." : "Sua conta ainda não está ligada a uma barbearia." });
    if (!plataforma && !ehAdmin(perfil)) return res.status(403).json({ message: "Só o dono acessa o financeiro." });

    if (req.method === "GET") {
      const dados = await lerFinanceiro(barbeariaId);
      return res.status(200).json({ ...dados, plataforma });
    }

    if (req.method !== "POST") return res.status(405).json({ message: "Método não permitido." });

    // Simulação e zerar: só a conta da plataforma
    if (pedido.acao === "simular-30-dias") {
      if (!plataforma) return res.status(403).json({ message: "Só a conta da plataforma faz a simulação." });
      const r = await simularTrintaDias(barbeariaId);
      return res.status(r.status || 201).json(r);
    }
    if (pedido.acao === "zerar-simulacao") {
      if (!plataforma) return res.status(403).json({ message: "Só a conta da plataforma zera a simulação." });
      if (pedido.confirmar !== "ZERAR") return res.status(400).json({ message: "Confirme digitando ZERAR." });
      return res.status(200).json(await zerarSimulacao(barbeariaId));
    }

    const acao = ACOES[pedido.acao];
    if (!acao) return res.status(400).json({ message: "Ação desconhecida." });
    const r = await acao(barbeariaId, pedido);
    return res.status(r.status).json(r.corpo);
  } catch (e) {
    return res.status(e.status || 500).json({ message: e.message });
  }
};
