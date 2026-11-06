// Assinatura do Bio Site paga pela barbearia, com o Stripe.
// Oferta: implantação de R$ 120 paga na hora; mensalidade de R$ 39,90 para sempre para as 10 primeiras
// barbearias (depois, R$ 89,90); o 1º mês é grátis e a primeira mensalidade vence 60 dias depois da implantação.
//
// GET  /api/equipe?area=assinatura                 situação da assinatura e a oferta para esta barbearia
// POST /api/equipe?area=assinatura { acao:"checkout" }  abre o pagamento no Stripe (devolve a url)
// POST /api/equipe?area=assinatura { acao:"portal" }    abre a área do Stripe para trocar cartão ou cancelar
// POST /api/config?stripe=webhook                   avisos do Stripe (assinatura criada, paga, atrasada, cancelada)
// (rotas dentro de funções que já existem: limite de 12 funções no plano gratuito da Vercel)
const { rest } = require("./supabase");
const { usuarioDaRequisicao, perfilDoContexto, ehAdmin } = require("./conta");
const { falha, corpoDe, UUID } = require("./seguranca");
const S = require("./stripe");

const OFERTA = {
  vagasPromocao: 10,
  mensalPromocao: 3990, // centavos
  mensalNormal: 8990,
  implantacao: 12000,
  diasAtePrimeiraCobranca: 60,
};
const PRECOS = {
  lancamento: { chave: `bio_mensal_lancamento_${OFERTA.mensalPromocao}`, nome: "Bio Site - mensalidade (lançamento)", centavos: OFERTA.mensalPromocao, mensal: true },
  normal: { chave: `bio_mensal_${OFERTA.mensalNormal}`, nome: "Bio Site - mensalidade", centavos: OFERTA.mensalNormal, mensal: true },
  implantacao: { chave: `bio_implantacao_${OFERTA.implantacao}`, nome: "Bio Site - implantação", centavos: OFERTA.implantacao, mensal: false },
};
// Situações em que a barbearia já tem assinatura (não abre outro pagamento)
const VIGENTES = ["em_teste", "ativa", "atrasada", "pausada"];
// Situações do Stripe -> situação guardada no banco
const SITUACAO = { trialing: "em_teste", active: "ativa", past_due: "atrasada", unpaid: "atrasada", canceled: "cancelada", incomplete: "incompleta", incomplete_expired: "cancelada", paused: "pausada" };

function origemDo(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${req.headers.host}`;
}

async function assinaturaDe(barbeariaId) {
  return (await rest(`assinaturas?barbearia_id=eq.${barbeariaId}&select=*`))[0] || null;
}

// Vagas do preço de lançamento já ocupadas: barbearias que contrataram o lançamento (pagaram a implantação)
// ou estão com ele em vigor. Quem cancela perde o preço e a vaga não volta: são "as 10 primeiras".
// O preço de quem fica nunca muda: a assinatura no Stripe mantém o preço com que foi criada.
async function vagasUsadas() {
  const linhas = await rest(`assinaturas?plano=eq.lancamento&or=(implantacao_paga_em.not.is.null,status.in.(${VIGENTES.join(",")}))&select=barbearia_id`);
  return linhas.length;
}

async function oferta() {
  const usadas = await vagasUsadas();
  const promocao = usadas < OFERTA.vagasPromocao;
  return {
    promocao,
    vagasRestantes: Math.max(0, OFERTA.vagasPromocao - usadas),
    mensal: (promocao ? OFERTA.mensalPromocao : OFERTA.mensalNormal) / 100,
    normal: OFERTA.mensalNormal / 100,
    implantacao: OFERTA.implantacao / 100,
    diasAtePrimeiraCobranca: OFERTA.diasAtePrimeiraCobranca,
  };
}

// Estado da assinatura do Stripe no formato do banco
function estadoDa(sub) {
  const item = sub.items && sub.items.data && sub.items.data[0];
  const fim = sub.current_period_end || (item && item.current_period_end) || null;
  const preco = item && item.price;
  return {
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer && sub.customer.id,
    stripe_subscription_id: sub.id,
    status: SITUACAO[sub.status] || "incompleta",
    plano: preco && String(preco.lookup_key || "").includes("lancamento") ? "lancamento" : "normal",
    valor_mensal: preco && preco.unit_amount != null ? preco.unit_amount / 100 : null,
    primeira_cobranca_em: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    proxima_cobranca_em: fim ? new Date(fim * 1000).toISOString() : null,
    cancelar_no_fim: !!sub.cancel_at_period_end,
    atualizado_em: new Date().toISOString(),
  };
}

async function gravar(barbeariaId, dados) {
  await rest("assinaturas?on_conflict=barbearia_id", {
    metodo: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    corpo: { barbearia_id: barbeariaId, ...dados },
  });
}

// ---------- painel do dono ----------
async function area(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const u = await usuarioDaRequisicao(req);
    if (!u) return res.status(401).json({ message: "Entre na sua conta para continuar." });
    const perfil = await perfilDoContexto(u, req);
    if (!ehAdmin(perfil)) return res.status(403).json({ message: "Só o dono cuida da assinatura." });
    if (!S.configurado()) return res.status(200).json({ configurado: false });
    const atual = await assinaturaDe(perfil.barbearia_id);

    if (req.method === "GET") return res.status(200).json({ configurado: true, assinatura: atual, oferta: await oferta() });
    if (req.method !== "POST") return res.status(405).json({ message: "Método não permitido." });
    const b = corpoDe(req);

    if (b.acao === "checkout") {
      if (perfil.visaoAdmin) return res.status(403).json({ message: "Só o dono da barbearia contrata a assinatura." });
      if (atual && VIGENTES.includes(atual.status)) return res.status(409).json({ message: "A assinatura desta barbearia já está ativa." });
      const of = await oferta();
      const [mensal, implantacao] = await Promise.all([
        S.precoPorChave(PRECOS[of.promocao ? "lancamento" : "normal"].chave, PRECOS[of.promocao ? "lancamento" : "normal"]),
        S.precoPorChave(PRECOS.implantacao.chave, PRECOS.implantacao),
      ]);
      const origem = origemDo(req);
      const sessao = await S.stripe("/checkout/sessions", {
        metodo: "POST",
        corpo: {
          mode: "subscription",
          locale: "pt-BR",
          // A implantação (preço avulso) é cobrada na hora; a mensalidade só depois do período grátis
          line_items: [{ price: mensal, quantity: 1 }, { price: implantacao, quantity: 1 }],
          subscription_data: {
            trial_end: Math.floor(Date.now() / 1000) + OFERTA.diasAtePrimeiraCobranca * 86400,
            metadata: { barbearia_id: perfil.barbearia_id },
          },
          metadata: { barbearia_id: perfil.barbearia_id },
          client_reference_id: perfil.barbearia_id,
          ...(atual && atual.stripe_customer_id ? { customer: atual.stripe_customer_id } : { customer_email: u.email }),
          success_url: `${origem}/painel-dono.html?assinatura=ok#mais`,
          cancel_url: `${origem}/painel-dono.html#mais`,
        },
      });
      return res.status(200).json({ url: sessao.url });
    }

    if (b.acao === "portal") {
      if (!atual || !atual.stripe_customer_id) return res.status(400).json({ message: "Esta barbearia ainda não tem assinatura." });
      const sessao = await S.stripe("/billing_portal/sessions", {
        metodo: "POST",
        corpo: { customer: atual.stripe_customer_id, return_url: `${origemDo(req)}/painel-dono.html#mais`, locale: "pt-BR" },
      });
      return res.status(200).json({ url: sessao.url });
    }

    return res.status(400).json({ message: "Ação desconhecida." });
  } catch (e) {
    return falha(res, e, `${req.method} /api/equipe?area=assinatura`);
  }
}

// ---------- avisos do Stripe ----------
// O corpo precisa chegar exatamente como o Stripe mandou (a assinatura é calculada sobre ele)
function corpoBruto(req) {
  if (typeof req.rawBody === "string") return Promise.resolve(req.rawBody);
  if (Buffer.isBuffer(req.rawBody)) return Promise.resolve(req.rawBody.toString("utf8"));
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body.toString("utf8"));
  if (req.readableEnded || typeof req.on !== "function") return Promise.resolve(null);
  return new Promise((ok) => {
    const partes = [];
    const fim = setTimeout(() => ok(null), 8000);
    req.on("data", (c) => partes.push(Buffer.from(c)));
    req.on("end", () => { clearTimeout(fim); ok(Buffer.concat(partes).toString("utf8")); });
    req.on("error", () => { clearTimeout(fim); ok(null); });
  });
}

async function webhook(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method !== "POST") return res.status(405).json({ message: "Método não permitido." });
    const corpo = await corpoBruto(req);
    const evento = S.eventoVerificado(corpo, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
    if (!evento || !evento.id || !evento.type) return res.status(400).json({ message: "Aviso inválido." });

    // Cada aviso é tratado uma vez só (o Stripe pode reenviar)
    const novo = await rest("stripe_eventos?on_conflict=id", {
      metodo: "POST",
      prefer: "resolution=ignore-duplicates,return=representation",
      corpo: { id: String(evento.id).slice(0, 80), tipo: String(evento.type).slice(0, 80) },
    });
    if (Array.isArray(novo) && !novo.length) return res.status(200).json({ ok: true, repetido: true });

    const obj = (evento.data && evento.data.object) || {};
    if (evento.type === "checkout.session.completed") {
      const id = String((obj.metadata && obj.metadata.barbearia_id) || obj.client_reference_id || "");
      if (UUID.test(id) && obj.subscription) {
        const sub = await S.stripe(`/subscriptions/${encodeURIComponent(obj.subscription)}`);
        await gravar(id, { ...estadoDa(sub), ...(obj.payment_status === "paid" ? { implantacao_paga_em: new Date().toISOString() } : {}) });
      }
    } else if (/^customer\.subscription\.(created|updated|deleted|paused|resumed)$/.test(evento.type)) {
      const id = String((obj.metadata && obj.metadata.barbearia_id) || "");
      if (UUID.test(id)) await gravar(id, estadoDa(obj));
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return falha(res, e, "POST /api/config?stripe=webhook");
  }
}

module.exports = { area, webhook, oferta, estadoDa, OFERTA, PRECOS, VIGENTES };
