// Acesso à API do Stripe sem dependências (fetch + formulário), preços por "lookup_key"
// e conferência da assinatura dos avisos (webhooks).
// Variáveis na Vercel:
//   STRIPE_SECRET_KEY      chave secreta (sk_test_... no modo de teste, sk_live_... em produção)
//   STRIPE_WEBHOOK_SECRET  segredo do endpoint de avisos (whsec_...)
const crypto = require("crypto");

const API = "https://api.stripe.com/v1";
const TOLERANCIA_S = 300; // aviso com mais de 5 minutos é recusado (evita reenvio de aviso antigo)

function configurado() {
  return !!process.env.STRIPE_SECRET_KEY;
}

// { a: 1, b: { c: 2 }, d: [{ e: 3 }] } -> a=1&b[c]=2&d[0][e]=3 (o formato que a API do Stripe espera)
function campos(obj, prefixo, saida = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const chave = prefixo ? `${prefixo}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === "object") campos(item, `${chave}[${i}]`, saida);
        else saida.push([`${chave}[${i}]`, String(item)]);
      });
    } else if (typeof v === "object") campos(v, chave, saida);
    else saida.push([chave, String(v)]);
  }
  return saida;
}

async function stripe(caminho, { metodo = "GET", corpo } = {}) {
  const chave = process.env.STRIPE_SECRET_KEY;
  if (!chave) throw Object.assign(new Error("Pagamentos ainda não configurados."), { status: 503 });
  const form = corpo ? new URLSearchParams(campos(corpo)).toString() : "";
  const r = await fetch(API + caminho + (metodo === "GET" && form ? "?" + form : ""), {
    method: metodo,
    headers: { Authorization: "Bearer " + chave, "Content-Type": "application/x-www-form-urlencoded" },
    body: metodo === "GET" ? undefined : form,
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Stripe: " + ((j.error && j.error.message) || r.status));
  return j;
}

// Preço fixo identificado por uma chave (lookup_key). Se ainda não existe no Stripe, é criado.
// A chave leva o valor: mudar o valor cria um preço novo e os antigos continuam valendo para quem já assinou.
const cachePrecos = new Map();
async function precoPorChave(chave, { nome, centavos, mensal }) {
  if (cachePrecos.has(chave)) return cachePrecos.get(chave);
  const achados = await stripe("/prices", { corpo: { lookup_keys: [chave], active: "true", limit: 1 } });
  let id = achados.data && achados.data[0] && achados.data[0].id;
  if (!id) {
    const novo = await stripe("/prices", {
      metodo: "POST",
      corpo: { currency: "brl", unit_amount: centavos, lookup_key: chave, product_data: { name: nome }, ...(mensal ? { recurring: { interval: "month" } } : {}) },
    });
    id = novo.id;
  }
  cachePrecos.set(chave, id);
  return id;
}

// Confere o cabeçalho Stripe-Signature (t=...,v1=...) contra o corpo bruto do aviso.
// Devolve o evento (objeto) ou null se a assinatura não bater ou o aviso for antigo.
function eventoVerificado(corpo, cabecalho, segredo, agoraMs = Date.now()) {
  if (!segredo || typeof corpo !== "string") return null;
  const partes = String(cabecalho || "").split(",").map((p) => p.trim().split("="));
  const t = Number((partes.find(([k]) => k === "t") || [])[1]);
  const assinaturas = partes.filter(([k]) => k === "v1").map(([, v]) => String(v || ""));
  if (!t || !assinaturas.length || Math.abs(agoraMs / 1000 - t) > TOLERANCIA_S) return null;
  const esperado = crypto.createHmac("sha256", segredo).update(`${t}.${corpo}`).digest("hex");
  const ok = assinaturas.some((v) => v.length === esperado.length && crypto.timingSafeEqual(Buffer.from(v), Buffer.from(esperado)));
  if (!ok) return null;
  try { return JSON.parse(corpo); } catch (e) { return null; }
}

// Para os testes: monta o cabeçalho que o Stripe mandaria
function assinarParaTeste(corpo, segredo, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${crypto.createHmac("sha256", segredo).update(`${t}.${corpo}`).digest("hex")}`;
}

module.exports = { configurado, campos, stripe, precoPorChave, eventoVerificado, assinarParaTeste, _cachePrecos: cachePrecos };
