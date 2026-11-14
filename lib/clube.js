// Clube de assinatura da barbearia (versão manual: a barbearia recebe por fora e cadastra o assinante).
// GET  /api/equipe?area=clube                planos, assinantes (com uso no mês e pagamentos), serviços e números
// POST /api/equipe?area=clube { acao, ... }  "plano-salvar", "plano-ativo", "assinante-salvar" (com "recebeu",
//                                             já registra a 1ª mensalidade), "assinante-pagou" (grava o pagamento
//                                             e soma 1 mês), "assinante-desfazer-pagamento", "assinante-status"
// O site mostra os planos (planosPublicos, em /api/profissionais) e o assinante marca horário informando o
// WhatsApp (assinantePorWhatsapp, em /api/pedido). As regras do plano são conferidas no banco, em criar_pedido.
// Cada pagamento fica em clube_pagamentos (funções clube_registrar_pagamento e clube_desfazer_pagamento, fase 12)
// e entra no Financeiro no dia em que foi registrado.
const { rest } = require("./supabase");
const { usuarioDaRequisicao, perfilDoContexto, ehAdmin, barbeariaDe } = require("./conta");
const { texto } = require("./agenda");
const { dataValida, hojeBr, somaDias } = require("./horarios");
const { falha, corpoDe, UUID, registrar } = require("./seguranca");

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const STATUS = ["ativo", "pausado", "cancelado"];

// WhatsApp como o cliente digitar -> só os números com DDD, no formato de 11 dígitos dos celulares.
// Tira o 55 do país e o 0 da operadora; celular antigo de 8 dígitos ganha o 9 na frente.
function normalizarWhats(v) {
  let n = String(v == null ? "" : v).replace(/\D/g, "");
  if (n.length >= 12 && n.startsWith("55")) n = n.slice(2);
  if ((n.length === 11 || n.length === 12) && n.startsWith("0")) n = n.slice(1);
  if (n.length === 10 && /[6-9]/.test(n[2])) n = n.slice(0, 2) + "9" + n.slice(2);
  return /^[1-9][0-9]\d{8,9}$/.test(n) ? n : "";
}

// Nome de serviço comparado sem acento e sem diferença de maiúsculas
function chave(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

// "1 vez a cada 7 dias · seg a sáb · até 17:00"
function regrasDe(pl) {
  const partes = [];
  partes.push(pl.intervalo_dias > 0 ? `1 vez a cada ${pl.intervalo_dias} ${pl.intervalo_dias === 1 ? "dia" : "dias"}` : "sem intervalo mínimo");
  const dias = [...(pl.dias_semana || [])].map(Number).sort((a, b) => a - b);
  if (dias.length && dias.length < 7) {
    const seguidos = dias.every((d, i) => i === 0 || d === dias[i - 1] + 1);
    partes.push(seguidos && dias.length > 2 ? `${DIAS[dias[0]]} a ${DIAS[dias[dias.length - 1]]}` : dias.map((d) => DIAS[d]).join(", "));
  }
  if (pl.hora_limite) partes.push(`até ${String(pl.hora_limite).slice(0, 5)}`);
  return partes.join(" · ");
}

// Um mês depois (mesmo dia; 31/01 -> 28 ou 29/02)
function maisUmMes(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
  const alvo = new Date(Date.UTC(a, m, Math.min(d, ultimo)));
  return alvo.toISOString().slice(0, 10);
}

function preco(v) {
  const n = Number(String(v == null ? "" : v).replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

// ---------- site público ----------
async function planosPublicos(barbeariaId) {
  const planos = await rest(`clube_planos?barbearia_id=eq.${barbeariaId}&ativo=eq.true&select=id,nome,descricao,preco,servicos,intervalo_dias,dias_semana,hora_limite&order=preco.asc`);
  if (!planos.length) return null;
  return {
    planos: planos.map((p) => ({ id: p.id, nome: p.nome, descricao: p.descricao, preco: Number(p.preco), servicos: p.servicos, regras: `Inclui ${p.servicos.join(", ")} · ${regrasDe(p)}` })),
  };
}

// Assinante desta barbearia pelo WhatsApp, com os serviços do plano (para casar o nome do serviço)
async function assinantePorWhatsapp(barbeariaId, whatsapp) {
  const n = normalizarWhats(whatsapp);
  if (!n) return { erro: "Informe o WhatsApp do clube com DDD." };
  const linhas = await rest(`clube_assinantes?barbearia_id=eq.${barbeariaId}&whatsapp=eq.${n}&select=id,nome,status,clube_planos(servicos)`);
  if (!linhas.length) return { erro: "Não encontramos assinatura do clube com este WhatsApp. Confira o número ou marque sem o clube." };
  const a = linhas[0];
  return { id: a.id, nome: a.nome, servicos: (a.clube_planos && a.clube_planos.servicos) || [] };
}

// O serviço escolhido no site, escrito como está no plano (sem diferença de acento ou maiúscula)
function servicoDoPlano(servicos, escolhido) {
  return servicos.find((s) => chave(s) === chave(escolhido)) || escolhido;
}

// Resposta do banco quando a regra do clube não deixa marcar -> mensagem para o cliente
function mensagemDoClube(r) {
  const data = r.data ? String(r.data).slice(8, 10) + "/" + String(r.data).slice(5, 7) : "";
  switch (r.motivo) {
    case "inativo": return "Sua assinatura do clube está pausada ou cancelada. Fale com a barbearia.";
    case "vencido": return `A mensalidade do clube venceu em ${data}. Fale com a barbearia para renovar.`;
    case "servico": return "Este serviço não faz parte do seu plano. Escolha outro serviço ou marque sem o clube.";
    case "dia": return "Seu plano não vale neste dia da semana. Escolha outro dia ou marque sem o clube.";
    case "horario": return `Seu plano vale só para horários antes das ${String(r.limite || "").slice(0, 5)}.`;
    case "aberto": return `Você já tem um horário pelo clube marcado para ${data}. Depois dele, marque o próximo.`;
    case "intervalo": return `Seu próximo horário pelo clube fica liberado a partir de ${data}.`;
    default: return "Não encontramos assinatura do clube com este WhatsApp. Confira o número ou marque sem o clube.";
  }
}

// ---------- painel do dono ----------
const CONTAM = ["pendente", "confirmado", "avulso", "realizado"];

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function dados(barbeariaId) {
  const hoje = hojeBr();
  const inicioMes = hoje.slice(0, 8) + "01";
  const [planos, assinantes, servicos, usos, pagamentos, barbearia] = await Promise.all([
    rest(`clube_planos?barbearia_id=eq.${barbeariaId}&select=*&order=criado_em.asc`),
    rest(`clube_assinantes?barbearia_id=eq.${barbeariaId}&select=*&order=nome.asc`),
    rest(`servicos_precos?barbearia_id=eq.${barbeariaId}&select=nome&order=nome.asc`),
    rest(`pedidos?barbearia_id=eq.${barbeariaId}&clube_assinante_id=not.is.null&dia=gte.${somaDias(hoje, -75)}&select=clube_assinante_id,dia,status,motivo,comissao_valor&order=dia.asc&limit=5000`),
    // Pagamentos do último ano, do mais novo para o mais antigo (o primeiro de cada assinante é o que dá para desfazer)
    rest(`clube_pagamentos?barbearia_id=eq.${barbeariaId}&data=gte.${somaDias(hoje, -400)}&select=id,assinante_id,valor,data,pago_ate_antes,pago_ate_depois&order=criado_em.desc,id.desc&limit=5000`),
    barbeariaDe(barbeariaId),
  ]);
  const planoDe = new Map(planos.map((p) => [p.id, p]));
  const lista = assinantes.map((a) => {
    const meus = usos.filter((u) => u.clube_assinante_id === a.id);
    const usados = meus.filter((u) => CONTAM.includes(u.status) || (u.status === "nao_realizado" && u.motivo !== "reagendado"));
    const ultimo = usados.filter((u) => u.dia <= hoje).map((u) => u.dia).pop() || null;
    const aberto = meus.find((u) => u.dia >= hoje && ["pendente", "confirmado", "avulso"].includes(u.status));
    const pl = planoDe.get(a.plano_id);
    return {
      ...a,
      plano: pl ? pl.nome : "",
      usosMes: meus.filter((u) => u.status === "realizado" && u.dia >= inicioMes).length,
      ultimoUso: ultimo,
      emAberto: aberto ? aberto.dia : null,
      liberaEm: ultimo && pl && pl.intervalo_dias ? somaDias(ultimo, pl.intervalo_dias) : null,
      vencido: !!(a.status === "ativo" && a.pago_ate && a.pago_ate < hoje),
      pagamentos: pagamentos
        .filter((pg) => pg.assinante_id === a.id)
        .slice(0, 12)
        .map((pg) => ({ id: pg.id, valor: Number(pg.valor), data: pg.data, pago_ate_antes: pg.pago_ate_antes, pago_ate_depois: pg.pago_ate_depois })),
    };
  });
  const ativos = lista.filter((a) => a.status === "ativo");
  const feitosMes = usos.filter((u) => u.status === "realizado" && u.dia >= inicioMes && u.dia <= hoje);
  const pagosMes = pagamentos.filter((pg) => pg.data >= inicioMes && pg.data <= hoje);
  const receita = ativos.reduce((t, a) => t + Number((planoDe.get(a.plano_id) || {}).preco || 0), 0);
  const recebido = pagosMes.reduce((t, pg) => t + Number(pg.valor || 0), 0);
  const comissoes = feitosMes.reduce((t, u) => t + Number(u.comissao_valor || 0), 0);
  return {
    hoje,
    slug: barbearia ? barbearia.slug : "",
    planos: planos.map((p) => ({ ...p, preco: Number(p.preco), comissao_valor: Number(p.comissao_valor), regras: regrasDe(p), assinantes: ativos.filter((a) => a.plano_id === p.id).length })),
    assinantes: lista,
    servicos: servicos.map((s) => s.nome),
    kpis: {
      ativos: ativos.length,
      vencidos: ativos.filter((a) => a.vencido).length,
      receitaMensal: r2(receita),
      recebidoMes: r2(recebido),
      pagamentosMes: pagosMes.length,
      usosMes: feitosMes.length,
      comissoesMes: r2(comissoes),
      // O mesmo critério do Financeiro: o que entrou no mês menos as comissões do clube no mês
      resultadoMes: r2(recebido - comissoes),
    },
  };
}

// Valor recebido digitado pelo dono (vazio = preço do plano). Devolve NaN se não for um valor aceito.
function valorRecebido(v, precoDoPlano) {
  if (v === undefined || v === null || String(v).trim() === "") return r2(precoDoPlano);
  const n = preco(v);
  return n >= 0 && n < 10000 ? n : NaN;
}

async function registrarPagamento(barbeariaId, assinanteId, valor) {
  return rest("rpc/clube_registrar_pagamento", { metodo: "POST", corpo: { p_barbearia: barbeariaId, p_assinante: assinanteId, p_valor: valor } });
}

function erro400(res, message) {
  return res.status(400).json({ message });
}

async function salvarPlano(res, barbeariaId, b) {
  const nome = texto(b.nome, 60);
  const descricao = texto(b.descricao, 160);
  const valor = preco(b.preco);
  const servicos = [...new Set((Array.isArray(b.servicos) ? b.servicos : []).map((s) => texto(s, 80)).filter(Boolean))].slice(0, 30);
  const intervalo = Number(b.intervalo_dias);
  const dias = [...new Set((Array.isArray(b.dias_semana) ? b.dias_semana : []).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  const hora = String(b.hora_limite || "").trim().slice(0, 5);
  const comissao = b.comissao_valor === "" || b.comissao_valor == null ? 0 : preco(b.comissao_valor);
  if (nome.length < 2) return erro400(res, "Dê um nome ao plano.");
  if (!(valor > 0 && valor < 10000)) return erro400(res, "Informe o preço do plano por mês.");
  if (!servicos.length) return erro400(res, "Escolha pelo menos um serviço incluído.");
  if (!Number.isInteger(intervalo) || intervalo < 0 || intervalo > 60) return erro400(res, "O intervalo deve ser de 0 a 60 dias.");
  if (!dias.length) return erro400(res, "Escolha pelo menos um dia da semana.");
  if (hora && !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return erro400(res, "Hora limite inválida.");
  if (!(comissao >= 0 && comissao < 1000)) return erro400(res, "Comissão inválida.");
  // Serviços do plano precisam existir no cadastro de preços (é o mesmo nome que o site usa)
  const cadastrados = (await rest(`servicos_precos?barbearia_id=eq.${barbeariaId}&select=nome`)).map((s) => s.nome);
  const fora = servicos.filter((s) => !cadastrados.some((c) => chave(c) === chave(s)));
  if (fora.length) return erro400(res, `Serviço não cadastrado no Financeiro: ${fora.join(", ")}.`);
  const corpo = {
    nome, descricao, preco: valor, servicos: servicos.map((s) => cadastrados.find((c) => chave(c) === chave(s))),
    intervalo_dias: intervalo, dias_semana: dias, hora_limite: hora || null, comissao_valor: comissao, atualizado_em: new Date().toISOString(),
  };
  if (b.id) {
    if (!UUID.test(String(b.id))) return erro400(res, "Plano inválido.");
    const r = await rest(`clube_planos?id=eq.${b.id}&barbearia_id=eq.${barbeariaId}`, { metodo: "PATCH", prefer: "return=representation", corpo });
    if (!r.length) return res.status(404).json({ message: "Plano não encontrado." });
    return res.status(200).json({ plano: r[0] });
  }
  const r = await rest("clube_planos", { metodo: "POST", prefer: "return=representation", corpo: { ...corpo, barbearia_id: barbeariaId } });
  return res.status(201).json({ plano: r[0] });
}

async function salvarAssinante(res, barbeariaId, b) {
  const nome = texto(b.nome, 80);
  const whatsapp = normalizarWhats(b.whatsapp);
  const pagoAte = String(b.pago_ate || "").trim();
  const observacao = texto(b.observacao, 200);
  if (nome.length < 2) return erro400(res, "Informe o nome do assinante.");
  if (!whatsapp) return erro400(res, "Informe o WhatsApp do assinante com DDD.");
  if (!UUID.test(String(b.plano_id || ""))) return erro400(res, "Escolha o plano.");
  if (pagoAte && !dataValida(pagoAte)) return erro400(res, "Data de pagamento inválida.");
  const plano = await rest(`clube_planos?id=eq.${b.plano_id}&barbearia_id=eq.${barbeariaId}&select=id,preco`);
  if (!plano.length) return erro400(res, "Plano não encontrado.");
  // Cadastro de quem acabou de pagar: a 1ª mensalidade já entra como pagamento (e o vencimento sai dele)
  const recebeu = !b.id && b.recebeu === true;
  const valor = recebeu ? valorRecebido(b.valor, plano[0].preco) : null;
  if (recebeu && !Number.isFinite(valor)) return erro400(res, "Informe o valor recebido.");
  const corpo = { nome, whatsapp, plano_id: b.plano_id, pago_ate: recebeu ? null : pagoAte || null, observacao, atualizado_em: new Date().toISOString() };
  const mesmo = await rest(`clube_assinantes?barbearia_id=eq.${barbeariaId}&whatsapp=eq.${whatsapp}&select=id`);
  if (b.id) {
    if (!UUID.test(String(b.id))) return erro400(res, "Assinante inválido.");
    if (mesmo.length && mesmo[0].id !== b.id) return res.status(409).json({ message: "Já existe um assinante com este WhatsApp." });
    const r = await rest(`clube_assinantes?id=eq.${b.id}&barbearia_id=eq.${barbeariaId}`, { metodo: "PATCH", prefer: "return=representation", corpo });
    if (!r.length) return res.status(404).json({ message: "Assinante não encontrado." });
    return res.status(200).json({ assinante: r[0] });
  }
  if (mesmo.length) return res.status(409).json({ message: "Já existe um assinante com este WhatsApp." });
  const r = await rest("clube_assinantes", { metodo: "POST", prefer: "return=representation", corpo: { ...corpo, barbearia_id: barbeariaId, status: "ativo" } });
  const assinante = r[0];
  if (!recebeu) return res.status(201).json({ assinante });
  try {
    const pg = await registrarPagamento(barbeariaId, assinante.id, valor);
    return res.status(201).json({ assinante: { ...assinante, pago_ate: pg.pago_ate }, pagamento: pg });
  } catch (e) {
    // O assinante já existe: avisa para registrar o pagamento pelo "Recebi" em vez de falhar o cadastro
    await registrar({ tipo: "erro_servidor", rota: "POST /api/equipe?area=clube", nome: "pagamento-no-cadastro", detalhe: String(e.message || e) });
    return res.status(201).json({ assinante, aviso: "Assinante cadastrado, mas o pagamento não foi registrado. Toque em \"Recebi\" para registrar." });
  }
}

async function area(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const u = await usuarioDaRequisicao(req);
    if (!u) return res.status(401).json({ message: "Entre na sua conta para continuar." });
    const perfil = await perfilDoContexto(u, req);
    if (!ehAdmin(perfil)) return res.status(403).json({ message: "Só o dono cuida do clube." });
    const barbeariaId = perfil.barbearia_id;
    if (req.method === "GET") return res.status(200).json(await dados(barbeariaId));
    if (req.method !== "POST") return res.status(405).json({ message: "Método não permitido." });
    const b = corpoDe(req);

    if (b.acao === "plano-salvar") return salvarPlano(res, barbeariaId, b);
    if (b.acao === "plano-ativo") {
      if (!UUID.test(String(b.id || ""))) return erro400(res, "Plano inválido.");
      await rest(`clube_planos?id=eq.${b.id}&barbearia_id=eq.${barbeariaId}`, { metodo: "PATCH", prefer: "return=minimal", corpo: { ativo: b.ativo === true, atualizado_em: new Date().toISOString() } });
      return res.status(200).json({ ok: true });
    }
    if (b.acao === "assinante-salvar") return salvarAssinante(res, barbeariaId, b);
    if (b.acao === "assinante-pagou") {
      if (!UUID.test(String(b.id || ""))) return erro400(res, "Assinante inválido.");
      const a = (await rest(`clube_assinantes?id=eq.${b.id}&barbearia_id=eq.${barbeariaId}&select=id,clube_planos(preco)`))[0];
      if (!a) return res.status(404).json({ message: "Assinante não encontrado." });
      const valor = valorRecebido(b.valor, (a.clube_planos || {}).preco);
      if (!Number.isFinite(valor)) return erro400(res, "Informe o valor recebido.");
      // Grava o pagamento e soma 1 mês ao vencimento numa só operação do banco
      const pg = await registrarPagamento(barbeariaId, b.id, valor);
      if (!pg || pg.erro) return res.status(404).json({ message: "Assinante não encontrado." });
      return res.status(200).json({ pago_ate: pg.pago_ate, pagamento: { id: pg.id, valor: Number(pg.valor), data: pg.data } });
    }
    if (b.acao === "assinante-desfazer-pagamento") {
      if (!UUID.test(String(b.id || "")) || !UUID.test(String(b.pagamento || ""))) return erro400(res, "Pedido inválido.");
      const r = await rest("rpc/clube_desfazer_pagamento", { metodo: "POST", corpo: { p_barbearia: barbeariaId, p_assinante: b.id, p_pagamento: b.pagamento } });
      if (!r || r.erro === "assinante") return res.status(404).json({ message: "Assinante não encontrado." });
      if (r.erro) return res.status(409).json({ message: "Este já não é o último pagamento do assinante. Abra os pagamentos de novo para conferir." });
      return res.status(200).json({ pago_ate: r.pago_ate || null, valor: Number(r.valor), manteve: !!r.manteve });
    }
    if (b.acao === "assinante-status") {
      if (!UUID.test(String(b.id || "")) || !STATUS.includes(b.status)) return erro400(res, "Pedido inválido.");
      await rest(`clube_assinantes?id=eq.${b.id}&barbearia_id=eq.${barbeariaId}`, { metodo: "PATCH", prefer: "return=minimal", corpo: { status: b.status, atualizado_em: new Date().toISOString() } });
      return res.status(200).json({ ok: true });
    }
    return erro400(res, "Ação desconhecida.");
  } catch (e) {
    return falha(res, e, `${req.method} /api/equipe?area=clube`);
  }
}

module.exports = { area, planosPublicos, assinantePorWhatsapp, servicoDoPlano, mensagemDoClube, normalizarWhats, regrasDe, maisUmMes };
