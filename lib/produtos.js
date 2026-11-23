// Produtos vendidos na barbearia (fase 19): preço de compra e de venda, estoque fácil e alerta de estoque baixo.
// Rota: /api/equipe?area=produtos (limite de funções da Vercel no plano gratuito).
// GET  -> produtos, os que estão acabando e as vendas de hoje. O barbeiro não vê o preço de compra nem o lucro.
// POST { acao, ... }
//   "criar"   { nome, custo, preco, estoque, minimo }      só o dono; o estoque inicial entra como reposição
//   "editar"  { id, nome?, custo?, preco?, minimo?, ativo? } só o dono
//   "estoque" { id, quantidade, custo? }  +N repõe (com o preço de compra), -N tira sem venda (perda, uso). Só o dono
//   "vender"  { id, quantidade, profissionalId?, forma_pagamento? }  dono ou barbeiro (o barbeiro vende em nome dele)
//   "apagar"  { id }  só o dono e só produto que nunca foi vendido (venda fica no Financeiro: aí, desativar)
// Cada venda grava o preço e o custo do momento (função produto_movimentar): o Financeiro mostra bruto, custo e lucro.
const { rest } = require("./supabase");
const { FORMAS_PAGAMENTO } = require("./financeiro-calculo");
const { usuarioDaRequisicao, perfilDoContexto, ehAdmin, papelDemo, profissionalDemo } = require("./conta");
const { texto } = require("./agenda");
const { hojeBr } = require("./horarios");
const { falha, corpoDe, UUID } = require("./seguranca");
const { avisarEstoqueBaixo } = require("./avisos");

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function contexto(req) {
  const u = await usuarioDaRequisicao(req);
  if (!u) return { erro: [401, "Entre na sua conta para continuar."] };
  const perfil = await perfilDoContexto(u, req);
  if (!perfil || !perfil.barbearia_id) return { erro: [403, "Sua conta ainda não está ligada a uma barbearia."] };
  const prof = perfil.visaoAdmin ? [] : papelDemo(u.id) === "barbeiro" ? [await profissionalDemo("id")].filter(Boolean) : papelDemo(u.id) ? [] : await rest(`profissionais?perfil_user_id=eq.${u.id}&barbearia_id=eq.${perfil.barbearia_id}&select=id`);
  if (ehAdmin(perfil)) return { barbeariaId: perfil.barbearia_id, dono: true, meu: prof[0] ? prof[0].id : null };
  if (!prof.length) return { erro: [403, "Seu perfil não vende produtos."] };
  return { barbeariaId: perfil.barbearia_id, dono: false, meu: prof[0].id };
}

// "35", "35,5", "1.234,56" ou 35.5 -> número; vazio -> null; inválido -> NaN
function dinheiro(v) {
  if (v === "" || v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 && v <= 1e6 ? r2(v) : NaN;
  let t = String(v).trim().replace(/[^\d,.]/g, "");
  if (!t) return NaN;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 1e6 ? r2(n) : NaN;
}
function inteiro(v, min, max) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
}
const baixo = (p) => p.ativo && p.estoque <= Math.max(0, p.estoque_minimo);

async function listar(ctx) {
  const [produtos, vendas] = await Promise.all([
    rest(`produtos?barbearia_id=eq.${ctx.barbeariaId}&select=id,nome,custo,preco,estoque,estoque_minimo,foto,ativo&order=nome.asc`),
    rest(`produto_movimentos?barbearia_id=eq.${ctx.barbeariaId}&tipo=eq.venda&dia=eq.${hojeBr()}&select=produto_id,quantidade,preco_unit,custo_unit,profissional_id`),
  ]);
  const minhas = ctx.dono ? vendas : vendas.filter((v) => v.profissional_id === ctx.meu);
  const unidades = minhas.reduce((t, v) => t - v.quantidade, 0);
  const bruto = minhas.reduce((t, v) => t + -v.quantidade * Number(v.preco_unit || 0), 0);
  const custo = minhas.reduce((t, v) => t + -v.quantidade * Number(v.custo_unit || 0), 0);
  return {
    dono: ctx.dono,
    produtos: produtos.map((p) => {
      const item = { id: p.id, nome: p.nome, preco: Number(p.preco), estoque: p.estoque, minimo: p.estoque_minimo, foto: p.foto, ativo: p.ativo, baixo: baixo(p) };
      if (ctx.dono) {
        item.custo = p.custo == null ? null : Number(p.custo);
        item.lucro = p.custo == null ? null : r2(Number(p.preco) - Number(p.custo));
      }
      return item;
    }),
    baixos: produtos.filter(baixo).map((p) => ({ id: p.id, nome: p.nome, estoque: p.estoque })),
    hoje: ctx.dono ? { unidades, bruto: r2(bruto), custo: r2(custo), lucro: r2(bruto - custo) } : { unidades, bruto: r2(bruto) },
  };
}

async function movimentar(ctx, corpo) {
  const r = await rest("rpc/produto_movimentar", { metodo: "POST", corpo: { p: { barbearia_id: ctx.barbeariaId, ...corpo } } });
  return r || {};
}

async function produtoDaBarbearia(ctx, id) {
  if (!UUID.test(String(id || ""))) return null;
  return (await rest(`produtos?id=eq.${id}&barbearia_id=eq.${ctx.barbeariaId}&select=id,nome,ativo,estoque,estoque_minimo`))[0] || null;
}

async function criar(res, ctx, b) {
  const nome = texto(b.nome, 80);
  const custo = dinheiro(b.custo);
  const preco = dinheiro(b.preco);
  const estoque = inteiro(b.estoque == null || b.estoque === "" ? 0 : b.estoque, 0, 100000);
  const minimo = inteiro(b.minimo == null || b.minimo === "" ? 0 : b.minimo, 0, 100000);
  if (nome.length < 2) return res.status(400).json({ message: "Dê um nome ao produto." });
  if (preco == null || Number.isNaN(preco)) return res.status(400).json({ message: "Informe o preço de venda." });
  if (Number.isNaN(custo)) return res.status(400).json({ message: "Preço de compra inválido." });
  if (Number.isNaN(estoque) || Number.isNaN(minimo)) return res.status(400).json({ message: "Quantidade inválida: use números inteiros." });
  const existe = await rest(`produtos?barbearia_id=eq.${ctx.barbeariaId}&nome=eq.${encodeURIComponent(nome)}&select=id`);
  if (existe.length) return res.status(409).json({ message: "Já existe um produto com este nome." });
  const [p] = await rest("produtos", { metodo: "POST", prefer: "return=representation", corpo: { barbearia_id: ctx.barbeariaId, nome, custo, preco, estoque_minimo: minimo } });
  if (estoque > 0) await movimentar(ctx, { produto_id: p.id, tipo: "entrada", quantidade: estoque, custo_unit: custo });
  return res.status(201).json({ produto: { id: p.id, nome, estoque } });
}

async function editar(res, ctx, b) {
  const p = await produtoDaBarbearia(ctx, b.id);
  if (!p) return res.status(404).json({ message: "Produto não encontrado." });
  const corpo = {};
  if (b.nome !== undefined) {
    const nome = texto(b.nome, 80);
    if (nome.length < 2) return res.status(400).json({ message: "Dê um nome ao produto." });
    corpo.nome = nome;
  }
  if (b.custo !== undefined) {
    const c = dinheiro(b.custo);
    if (Number.isNaN(c)) return res.status(400).json({ message: "Preço de compra inválido." });
    corpo.custo = c;
  }
  if (b.preco !== undefined) {
    const v = dinheiro(b.preco);
    if (v == null || Number.isNaN(v)) return res.status(400).json({ message: "Preço de venda inválido." });
    corpo.preco = v;
  }
  if (b.minimo !== undefined) {
    const m = inteiro(b.minimo, 0, 100000);
    if (m == null || Number.isNaN(m)) return res.status(400).json({ message: "Mínimo inválido." });
    corpo.estoque_minimo = m;
  }
  if (b.ativo !== undefined) corpo.ativo = b.ativo === true;
  if (!Object.keys(corpo).length) return res.status(400).json({ message: "Nada para salvar." });
  try {
    await rest(`produtos?id=eq.${p.id}&barbearia_id=eq.${ctx.barbeariaId}`, { metodo: "PATCH", prefer: "return=minimal", corpo });
  } catch (e) {
    if (/duplicate|unique/i.test(e.message)) return res.status(409).json({ message: "Já existe um produto com este nome." });
    throw e;
  }
  return res.status(200).json({ ok: true });
}

async function estoque(res, ctx, b) {
  const p = await produtoDaBarbearia(ctx, b.id);
  if (!p) return res.status(404).json({ message: "Produto não encontrado." });
  const qtd = inteiro(b.quantidade, -100000, 100000);
  if (!qtd) return res.status(400).json({ message: "Informe a quantidade (ex.: 1, 6 ou -1)." });
  const custo = dinheiro(b.custo);
  if (Number.isNaN(custo)) return res.status(400).json({ message: "Preço de compra inválido." });
  const r = await movimentar(ctx, qtd > 0 ? { produto_id: p.id, tipo: "entrada", quantidade: qtd, custo_unit: custo } : { produto_id: p.id, tipo: "ajuste", quantidade: qtd });
  if (r.erro) return res.status(404).json({ message: "Produto não encontrado." });
  return res.status(200).json({ estoque: r.estoque, baixo: r.estoque <= Math.max(0, r.minimo) });
}

async function vender(res, ctx, b) {
  const p = await produtoDaBarbearia(ctx, b.id);
  if (!p) return res.status(404).json({ message: "Produto não encontrado." });
  if (!p.ativo) return res.status(409).json({ message: "Este produto está desativado." });
  const qtd = b.quantidade == null || b.quantidade === "" ? 1 : inteiro(b.quantidade, 1, 1000);
  if (!qtd) return res.status(400).json({ message: "Quantidade inválida." });
  const forma = b.forma_pagamento || null;
  if (forma && !FORMAS_PAGAMENTO.includes(forma)) return res.status(400).json({ message: "Forma de pagamento inválida." });
  // O barbeiro vende em nome dele; o dono pode dizer quem vendeu
  let prof = ctx.dono ? null : ctx.meu;
  if (ctx.dono && b.profissionalId) {
    if (!UUID.test(String(b.profissionalId))) return res.status(400).json({ message: "Barbeiro inválido." });
    const x = await rest(`profissionais?id=eq.${b.profissionalId}&barbearia_id=eq.${ctx.barbeariaId}&select=id`);
    if (!x.length) return res.status(404).json({ message: "Barbeiro não encontrado." });
    prof = x[0].id;
  } else if (ctx.dono) prof = ctx.meu;
  const r = await movimentar(ctx, { produto_id: p.id, tipo: "venda", quantidade: qtd, profissional_id: prof, ...(forma ? { forma_pagamento: forma } : {}) });
  if (r.erro) return res.status(404).json({ message: "Produto não encontrado." });
  if (r.cruzou) await avisarEstoqueBaixo({ barbearia_id: ctx.barbeariaId, nome: p.nome, estoque: r.estoque }).catch((e) => console.error("aviso de estoque:", e.message));
  return res.status(201).json({ estoque: r.estoque, baixo: r.estoque <= Math.max(0, r.minimo), semEstoque: r.estoque < 0 });
}

// Apagar: só produto que nunca foi vendido. Venda fica no histórico do Financeiro (bruto, custo, lucro):
// produto vendido só desativa. As reposições e ajustes do produto apagado saem junto (cascade no banco).
async function apagar(res, ctx, b) {
  const p = await produtoDaBarbearia(ctx, b.id);
  if (!p) return res.status(404).json({ message: "Produto não encontrado." });
  const vendas = await rest(`produto_movimentos?produto_id=eq.${p.id}&tipo=eq.venda&select=id&limit=1`);
  if (vendas.length) return res.status(409).json({ message: p.nome + " já foi vendido e fica no histórico do Financeiro. Use Desativar para tirar da venda." });
  await rest(`produtos?id=eq.${p.id}&barbearia_id=eq.${ctx.barbeariaId}`, { metodo: "DELETE", prefer: "return=minimal" });
  return res.status(200).json({ ok: true });
}

async function area(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const ctx = await contexto(req);
    if (ctx.erro) return res.status(ctx.erro[0]).json({ message: ctx.erro[1] });
    if (req.method === "GET") return res.status(200).json(await listar(ctx));
    if (req.method !== "POST") return res.status(405).json({ message: "Método não permitido." });
    const b = corpoDe(req);
    if (b.acao === "vender") return await vender(res, ctx, b);
    if (!ctx.dono) return res.status(403).json({ message: "Só o dono cadastra produtos e mexe no estoque." });
    if (b.acao === "criar") return await criar(res, ctx, b);
    if (b.acao === "editar") return await editar(res, ctx, b);
    if (b.acao === "estoque") return await estoque(res, ctx, b);
    if (b.acao === "apagar") return await apagar(res, ctx, b);
    return res.status(400).json({ message: "Ação desconhecida." });
  } catch (e) {
    return falha(res, e, `${req.method} /api/equipe?area=produtos`);
  }
}

module.exports = { area, listar, dinheiro };
