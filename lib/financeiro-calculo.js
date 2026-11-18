// Contas do Financeiro, sem acesso ao banco: recebe as linhas já lidas e monta o que as telas mostram.
// Faturamento = atendimentos realizados (valor gravado no atendimento).
// Mensalidades do clube = pagamentos registrados no "Recebi", no dia do registro.
// Produtos = vendas registradas (preço e custo do momento): entram no faturamento e o custo sai do lucro.
// Lucro = faturamento + mensalidades + produtos − comissões − gastos fixos (proporcionais) − compras de insumos − custo dos produtos.
const { comissaoDe } = require("./comissao");

// ---------- datas ----------
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

// Primeiro dia que o Financeiro precisa ler (o trimestre ou os últimos 30 dias, o que vier antes)
function inicioDaLeitura(hoje) {
  const p = periodosDe(hoje);
  return [p.trimestre.de, p.ultimos30.de].sort()[0];
}

// ---------- números ----------
const soma = (lista) => lista.reduce((t, n) => t + n, 0);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function resumoDoPeriodo(p, pedidos, despesasAtivas, movimentos, pagamentosClube, vendasProdutos) {
  const no = pedidos.filter((x) => x.dia >= p.de && x.dia <= p.ate);
  const feitos = no.filter((x) => x.status === "realizado");
  const faturamento = soma(feitos.map((x) => Number(x.valor) || 0));
  const comissoes = soma(feitos.map(comissaoDe));
  const fixos = soma(despesasAtivas.map((d) => Number(d.valor) * p.fator));
  const insumos = soma(
    movimentos.filter((m) => m.tipo === "entrada" && m.data >= p.de && m.data <= p.ate).map((m) => Number(m.valor_total) || 0)
  );
  const pagos = pagamentosClube.filter((m) => m.data >= p.de && m.data <= p.ate);
  const clube = soma(pagos.map((m) => Number(m.valor) || 0));
  // Venda de produto: quantidade negativa (saiu do estoque)
  const vendas = (vendasProdutos || []).filter((v) => v.dia >= p.de && v.dia <= p.ate);
  const produtos = soma(vendas.map((v) => -v.quantidade * (Number(v.preco_unit) || 0)));
  // Sinal no Pix de quem não veio: a barbearia fica com ele (fase 22)
  const sinaisFaltas = soma(no.filter((x) => x.status === "nao_realizado" && x.sinal_status === "pago").map((x) => Number(x.sinal_valor) || 0));
  const custoProdutos = soma(vendas.map((v) => -v.quantidade * (Number(v.custo_unit) || 0)));
  return {
    rotulo: p.rotulo,
    de: p.de,
    ate: p.ate,
    faturamento: r2(faturamento),
    clube: r2(clube),
    entradas: r2(faturamento + clube + produtos + sinaisFaltas),
    sinaisFaltas: r2(sinaisFaltas),
    produtos: r2(produtos),
    custoProdutos: r2(custoProdutos),
    lucroProdutos: r2(produtos - custoProdutos),
    produtosVendidos: soma(vendas.map((v) => -v.quantidade)),
    atendimentos: feitos.length,
    atendimentosClube: feitos.filter((x) => x.clube_assinante_id).length,
    pagamentosClube: pagos.length,
    naoRealizados: no.filter((x) => x.status === "nao_realizado").length,
    semPreco: feitos.filter((x) => x.valor == null).length,
    comissoes: r2(comissoes),
    gastosFixos: r2(fixos),
    insumosComprados: r2(insumos),
    lucro: r2(faturamento + clube + produtos + sinaisFaltas - comissoes - fixos - insumos - custoProdutos),
  };
}

// d: { pedidos, despesas, insumos, movimentos, precos, profissionais, pagamentosClube }
function calcularFinanceiro(hoje, d) {
  const periodos = periodosDe(hoje);
  const pedidos = d.pedidos || [];
  const despesas = d.despesas || [];
  const insumos = d.insumos || [];
  const movimentos = d.movimentos || [];
  const precos = d.precos || [];
  const profissionais = d.profissionais || [];
  const pagamentosClube = d.pagamentosClube || [];
  const vendasProdutos = d.vendasProdutos || [];

  const despesasAtivas = despesas.filter((x) => x.ativo);
  const resumo = {};
  Object.keys(periodos).forEach((k) => (resumo[k] = resumoDoPeriodo(periodos[k], pedidos, despesasAtivas, movimentos, pagamentosClube, vendasProdutos)));

  // Últimos 30 dias, dia a dia (para o gráfico): atendimentos e mensalidades do clube
  const serie = [];
  for (let i = 29; i >= 0; i--) {
    const dia = somaDias(hoje, -i);
    const doDia = pedidos.filter((x) => x.dia === dia && x.status === "realizado");
    const clube = soma(pagamentosClube.filter((m) => m.data === dia).map((m) => Number(m.valor) || 0));
    const produtosDia = soma(vendasProdutos.filter((v) => v.dia === dia).map((v) => -v.quantidade * (Number(v.preco_unit) || 0)));
    serie.push({ dia, faturamento: r2(soma(doDia.map((x) => Number(x.valor) || 0))), clube: r2(clube), produtos: r2(produtosDia), atendimentos: doDia.length });
  }

  // Comissão de cada barbeiro no mês corrente
  const mes = periodos.mes;
  const comissoes = profissionais.map((p) => {
    const feitos = pedidos.filter((x) => x.profissional_id === p.id && x.status === "realizado" && x.dia >= mes.de && x.dia <= mes.ate);
    const faturamento = soma(feitos.map((x) => Number(x.valor) || 0));
    const valorComissao = soma(feitos.map(comissaoDe));
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
  // A barbearia usa o clube: tem mensalidade registrada ou atendimento de assinante no período lido
  const temClube = pagamentosClube.length > 0 || pedidos.some((x) => x.clube_assinante_id);
  const temProdutos = vendasProdutos.length > 0;

  return {
    hoje,
    resumo,
    serie,
    comissoes,
    despesas: despesas.map((x) => ({ id: x.id, descricao: x.descricao, categoria: x.categoria, valor: Number(x.valor), ativo: x.ativo, simulado: x.simulado })),
    insumos: insumosComEstoque,
    precos: precos.map((p) => ({ id: p.id, nome: p.nome, preco: Number(p.preco), simulado: p.simulado })),
    servicosSemPreco,
    temSimulacao,
    temClube,
    temProdutos,
  };
}

module.exports = { calcularFinanceiro, periodosDe, inicioDaLeitura, somaDias };
