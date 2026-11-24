// Caixa do dia (fase 32; aba própria no painel do dono na fase 35): o dono abre o dia com o troco da gaveta,
// registra retirada e reforço e fecha contando o dinheiro. Entradas = atendimentos realizados + vendas de produto
// do dia, por forma de pagamento (fase 31). Dinheiro esperado na gaveta = troco + dinheiro que entrou + reforços − retiradas.
// Cada retirada diz para onde foi o dinheiro (despesa, vale de barbeiro, retirada do dono, guardar), e o Financeiro
// usa isso: despesa sai do lucro, vale aparece na comissão do barbeiro, a sobra ou a falta do fechamento entra no lucro.
// Ao fechar, o dono diz quanto fica na gaveta de troco; o próximo caixa já abre com esse valor sugerido.
// Rota: /api/equipe?area=caixa (limite de funções da Vercel no plano gratuito). Só o dono.
// GET ?dia=AAAA-MM-DD (padrão hoje) -> o caixa do dia, as entradas por forma, o esperado, as retiradas por categoria,
//   os atendimentos do dia ainda sem encerrar, um caixa de outro dia que ficou aberto, o troco sugerido,
//   os barbeiros (para o vale) e os últimos fechamentos.
// POST { acao, ... }
//   "abrir"            { troco }                                          abre o caixa de hoje
//   "movimento"        { dia?, tipo: retirada|reforco, valor, motivo, categoria?, profissionalId? }  no caixa aberto
//   "apagar-movimento" { id }                                             registro errado, com o caixa ainda aberto
//   "fechar"           { dia?, contado, ficaTroco?, observacao }          grava o esperado, o contado e a foto das entradas
//   "reabrir"          { dia? }                                           fechou por engano
const { rest } = require("./supabase");
const { usuarioDaRequisicao, perfilDoContexto, ehAdmin } = require("./conta");
const { texto } = require("./agenda");
const { hojeBr, dataValida } = require("./horarios");
const { falha, corpoDe } = require("./seguranca");
const { porForma, retiradasPorCategoria, CATEGORIAS_RETIRADA } = require("./financeiro-calculo");
const { dinheiro } = require("./produtos");

const UUID = /^[0-9a-f-]{36}$/i;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const soma = (l) => l.reduce((t, n) => t + n, 0);

async function contexto(req) {
  const u = await usuarioDaRequisicao(req);
  if (!u) return { erro: [401, "Entre na sua conta para continuar."] };
  const perfil = await perfilDoContexto(u, req);
  if (!perfil || !perfil.barbearia_id) return { erro: [403, "Sua conta ainda não está ligada a uma barbearia."] };
  if (!ehAdmin(perfil)) return { erro: [403, "O caixa é só do dono."] };
  return { barbeariaId: perfil.barbearia_id, usuarioId: u.id };
}

// Contas do caixa, sem banco
function calcularCaixa(caixa, movimentos, pedidos, vendas) {
  const entradas = porForma(pedidos.filter((p) => p.status === "realizado"), vendas);
  const saidas = movimentos.filter((m) => m.tipo === "retirada");
  const retiradas = soma(saidas.map((m) => Number(m.valor) || 0));
  const reforcos = soma(movimentos.filter((m) => m.tipo === "reforco").map((m) => Number(m.valor) || 0));
  const troco = caixa ? Number(caixa.troco) || 0 : 0;
  return {
    entradas,
    total: r2(entradas.dinheiro + entradas.pix + entradas.debito + entradas.credito + entradas.sem),
    troco: r2(troco),
    retiradas: r2(retiradas),
    retiradasPor: retiradasPorCategoria(saidas),
    reforcos: r2(reforcos),
    esperado: r2(troco + entradas.dinheiro + reforcos - retiradas),
  };
}

async function doDia(ctx, dia) {
  const b = ctx.barbeariaId;
  const [caixas, pedidos, vendas] = await Promise.all([
    rest(`caixas?barbearia_id=eq.${b}&dia=eq.${dia}&select=id,dia,troco,aberto_em,fechado_em,contado,esperado,fica_troco,resumo,observacao`),
    rest(`pedidos?barbearia_id=eq.${b}&dia=eq.${dia}&status=in.(realizado,confirmado,avulso)&select=status,valor,forma_pagamento&limit=1000`),
    rest(`produto_movimentos?barbearia_id=eq.${b}&tipo=eq.venda&dia=eq.${dia}&select=quantidade,preco_unit,forma_pagamento&limit=1000`),
  ]);
  const caixa = caixas[0] || null;
  const movimentos = caixa
    ? await rest(`caixa_movimentos?caixa_id=eq.${caixa.id}&select=id,tipo,valor,motivo,categoria,profissional_id,criado_em&order=criado_em.asc`)
    : [];
  return { caixa, movimentos, pedidos, ...calcularCaixa(caixa, movimentos, pedidos, vendas) };
}

async function ler(ctx, dia) {
  const hoje = hojeBr();
  const b = ctx.barbeariaId;
  const [d, esquecido, historico, equipe] = await Promise.all([
    doDia(ctx, dia),
    rest(`caixas?barbearia_id=eq.${b}&dia=lt.${hoje}&fechado_em=is.null&select=dia&order=dia.desc&limit=1`),
    rest(`caixas?barbearia_id=eq.${b}&fechado_em=not.is.null&select=dia,contado,esperado,fica_troco,resumo&order=dia.desc&limit=14`),
    rest(`profissionais?barbearia_id=eq.${b}&select=id,nome,ativo&order=criado_em.asc`),
  ]);
  const nomes = {};
  equipe.forEach((p) => (nomes[p.id] = p.nome));
  // O troco que ficou na gaveta no último fechamento antes deste dia: sugestão para abrir
  const anterior = historico.find((h) => h.dia < dia && h.fica_troco != null);
  return {
    dia,
    hoje,
    caixa: d.caixa,
    movimentos: d.movimentos.map((m) => ({ ...m, profissional: m.profissional_id ? nomes[m.profissional_id] || "Barbeiro" : null })),
    entradas: d.entradas,
    total: d.total,
    troco: d.troco,
    retiradas: d.retiradas,
    retiradasPor: d.retiradasPor,
    reforcos: d.reforcos,
    esperado: d.esperado,
    // Atendimentos do dia ainda sem "Realizado" ou "Não realizado": o dinheiro deles ainda não entrou na conta
    pendentes: d.pedidos.filter((p) => p.status !== "realizado").length,
    abertoAntes: esquecido[0] ? esquecido[0].dia : null,
    trocoSugerido: anterior ? Number(anterior.fica_troco) : null,
    profissionais: equipe.filter((p) => p.ativo).map((p) => ({ id: p.id, nome: p.nome })),
    historico: historico.map((h) => ({
      dia: h.dia,
      contado: Number(h.contado),
      esperado: Number(h.esperado),
      diferenca: r2(Number(h.contado) - Number(h.esperado)),
      ficaTroco: h.fica_troco == null ? null : Number(h.fica_troco),
      total: h.resumo && h.resumo.total != null ? Number(h.resumo.total) : null,
    })),
  };
}

// Dia do pedido: hoje ou um dia que já passou (caixa que ficou aberto)
function diaDo(b) {
  const dia = b.dia ? String(b.dia) : hojeBr();
  return dataValida(dia) && dia <= hojeBr() ? dia : null;
}

async function abrir(res, ctx, b) {
  const troco = b.troco == null || b.troco === "" ? 0 : dinheiro(b.troco);
  if (troco == null || Number.isNaN(troco)) return res.status(400).json({ message: "Troco inválido. Ex.: 50,00" });
  try {
    await rest("caixas", { metodo: "POST", prefer: "return=minimal", corpo: { barbearia_id: ctx.barbeariaId, dia: hojeBr(), troco, aberto_por: ctx.usuarioId } });
  } catch (e) {
    if (/duplicate|unique/i.test(e.message)) return res.status(409).json({ message: "O caixa de hoje já foi aberto." });
    throw e;
  }
  return res.status(201).json({ ok: true });
}

async function movimento(res, ctx, b) {
  const dia = diaDo(b);
  if (!dia) return res.status(400).json({ message: "Data inválida." });
  const tipo = b.tipo === "retirada" || b.tipo === "reforco" ? b.tipo : null;
  if (!tipo) return res.status(400).json({ message: "Escolha retirada ou reforço." });
  const valor = dinheiro(b.valor);
  if (valor == null || Number.isNaN(valor) || valor <= 0) return res.status(400).json({ message: "Informe o valor. Ex.: 100,00" });
  // Retirada: para onde foi o dinheiro (o Financeiro depende disso). Vale: de qual barbeiro.
  let categoria = null;
  let profissionalId = null;
  if (tipo === "retirada") {
    categoria = CATEGORIAS_RETIRADA.includes(b.categoria) ? b.categoria : null;
    if (!categoria) return res.status(400).json({ message: "Escolha para que é a retirada." });
    if (categoria === "vale") {
      profissionalId = String(b.profissionalId || "");
      if (!UUID.test(profissionalId)) return res.status(400).json({ message: "Escolha o barbeiro do vale." });
      const p = await rest(`profissionais?id=eq.${profissionalId}&barbearia_id=eq.${ctx.barbeariaId}&select=id`);
      if (!p.length) return res.status(400).json({ message: "Barbeiro não encontrado." });
    }
  }
  const c = (await rest(`caixas?barbearia_id=eq.${ctx.barbeariaId}&dia=eq.${dia}&select=id,fechado_em`))[0];
  if (!c) return res.status(409).json({ message: "Abra o caixa antes." });
  if (c.fechado_em) return res.status(409).json({ message: "Este caixa já foi fechado. Reabra para mexer." });
  await rest("caixa_movimentos", {
    metodo: "POST",
    prefer: "return=minimal",
    corpo: { caixa_id: c.id, barbearia_id: ctx.barbeariaId, dia, tipo, valor, motivo: texto(b.motivo, 80), categoria, profissional_id: profissionalId },
  });
  return res.status(201).json({ ok: true });
}

// Registro errado: apaga, mas só com o caixa ainda aberto (o fechado guarda a foto do dia)
async function apagarMovimento(res, ctx, b) {
  const id = String(b.id || "");
  if (!UUID.test(id)) return res.status(400).json({ message: "Registro inválido." });
  const m = (await rest(`caixa_movimentos?id=eq.${id}&barbearia_id=eq.${ctx.barbeariaId}&select=id,caixa_id`))[0];
  if (!m) return res.status(404).json({ message: "Registro não encontrado." });
  const c = (await rest(`caixas?id=eq.${m.caixa_id}&barbearia_id=eq.${ctx.barbeariaId}&select=fechado_em`))[0];
  if (!c || c.fechado_em) return res.status(409).json({ message: "Este caixa já foi fechado. Reabra para apagar." });
  await rest(`caixa_movimentos?id=eq.${id}&barbearia_id=eq.${ctx.barbeariaId}`, { metodo: "DELETE", prefer: "return=minimal" });
  return res.status(200).json({ ok: true });
}

async function fechar(res, ctx, b) {
  const dia = diaDo(b);
  if (!dia) return res.status(400).json({ message: "Data inválida." });
  const contado = dinheiro(b.contado);
  if (contado == null || Number.isNaN(contado)) return res.status(400).json({ message: "Informe o dinheiro contado na gaveta. Ex.: 230,00" });
  const d = await doDia(ctx, dia);
  if (!d.caixa) return res.status(409).json({ message: "O caixa deste dia não foi aberto." });
  if (d.caixa.fechado_em) return res.status(409).json({ message: "Este caixa já foi fechado." });
  // Quanto fica na gaveta de troco para o próximo dia. Sem resposta: o mesmo troco da abertura (ou tudo, se tiver menos).
  const fica = b.ficaTroco == null || b.ficaTroco === "" ? Math.min(contado, d.troco) : dinheiro(b.ficaTroco);
  if (fica == null || Number.isNaN(fica)) return res.status(400).json({ message: "Troco para o próximo dia inválido. Ex.: 100,00" });
  if (fica > contado) return res.status(400).json({ message: "O troco que fica na gaveta não pode ser maior que o dinheiro contado." });
  const recolhido = r2(contado - fica);
  const resumo = { entradas: d.entradas, total: d.total, troco: d.troco, retiradas: d.retiradas, retiradasPor: d.retiradasPor, reforcos: d.reforcos, recolhido };
  const corpo = { fechado_em: new Date().toISOString(), contado, esperado: d.esperado, fica_troco: fica, resumo, observacao: String(b.observacao || "").trim().slice(0, 300) };
  // Só fecha o que ainda está aberto (dois toques ao mesmo tempo não fecham duas vezes)
  const [f] = await rest(`caixas?id=eq.${d.caixa.id}&fechado_em=is.null`, { metodo: "PATCH", prefer: "return=representation", corpo });
  if (!f) return res.status(409).json({ message: "Este caixa já foi fechado." });
  return res.status(200).json({ esperado: d.esperado, contado, diferenca: r2(contado - d.esperado), ficaTroco: fica, recolhido });
}

async function reabrir(res, ctx, b) {
  const dia = diaDo(b);
  if (!dia) return res.status(400).json({ message: "Data inválida." });
  const corpo = { fechado_em: null, contado: null, esperado: null, fica_troco: null, resumo: null };
  const [f] = await rest(`caixas?barbearia_id=eq.${ctx.barbeariaId}&dia=eq.${dia}&fechado_em=not.is.null`, { metodo: "PATCH", prefer: "return=representation", corpo });
  if (!f) return res.status(409).json({ message: "Não há caixa fechado neste dia." });
  return res.status(200).json({ ok: true });
}

async function area(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const ctx = await contexto(req);
    if (ctx.erro) return res.status(ctx.erro[0]).json({ message: ctx.erro[1] });
    if (req.method === "GET") {
      const dia = String((req.query && req.query.dia) || hojeBr());
      if (!dataValida(dia)) return res.status(400).json({ message: "Data inválida." });
      return res.status(200).json(await ler(ctx, dia));
    }
    if (req.method !== "POST") return res.status(405).json({ message: "Método não permitido." });
    const b = corpoDe(req);
    if (b.acao === "abrir") return await abrir(res, ctx, b);
    if (b.acao === "movimento") return await movimento(res, ctx, b);
    if (b.acao === "apagar-movimento") return await apagarMovimento(res, ctx, b);
    if (b.acao === "fechar") return await fechar(res, ctx, b);
    if (b.acao === "reabrir") return await reabrir(res, ctx, b);
    return res.status(400).json({ message: "Ação desconhecida." });
  } catch (e) {
    return falha(res, e, `${req.method} /api/equipe?area=caixa`);
  }
}

module.exports = { area, calcularCaixa };
