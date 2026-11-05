// Segurança e respostas padronizadas das rotas da API:
// - origem do pedido sem guardar o IP (HMAC);
// - limite de tentativas (senha do Criador, código do painel) guardado no banco;
// - erros inesperados viram mensagem genérica com um código, e ficam no log e na telemetria.
const crypto = require("crypto");
const { rest } = require("./supabase");

// IP do cliente como a Vercel informa (a Vercel reescreve estes cabeçalhos; o cliente não consegue forjar)
function ipDe(req) {
  const h = (req && req.headers) || {};
  const v = h["x-vercel-forwarded-for"] || h["x-real-ip"] || h["x-forwarded-for"] || (req && req.socket && req.socket.remoteAddress) || "";
  return String(v).split(",")[0].trim().slice(0, 64);
}

// Identificador estável da origem, sem guardar o IP (LGPD): HMAC com uma chave do servidor
function origemDe(req) {
  const ip = ipDe(req);
  if (!ip) return null;
  const segredo = process.env.ORIGEM_SEGREDO || process.env.SUPABASE_SERVICE_KEY || "biosite";
  return crypto.createHmac("sha256", segredo).update("origem:" + ip).digest("hex").slice(0, 32);
}

// Erro com mensagem que pode ir para a tela (4xx)
function erroPublico(status, message) {
  return Object.assign(new Error(message), { status, publico: true });
}

// Grava um evento de monitoramento. Nunca derruba a rota: falha aqui é ignorada.
async function registrar({ tipo, rota = "", nome = "", valor = null, detalhe = "", ref = "" }) {
  try {
    await rest("telemetria", {
      metodo: "POST",
      prefer: "return=minimal",
      corpo: {
        tipo,
        rota: String(rota).slice(0, 200),
        nome: String(nome).slice(0, 80),
        valor: Number.isFinite(Number(valor)) && valor !== null ? Number(valor) : null,
        detalhe: String(detalhe).slice(0, 2000),
        ref: String(ref).slice(0, 40),
      },
    });
    // Limpeza ocasional: guarda 30 dias
    if (Math.random() < 0.01) {
      const limite = new Date(Date.now() - 30 * 864e5).toISOString();
      await rest(`telemetria?criado_em=lt.${limite}`, { metodo: "DELETE", prefer: "return=minimal" });
    }
  } catch (e) {
    console.error("telemetria falhou:", e.message);
  }
}

// Responde um erro. Os previstos (status 4xx) vão como estão. Os inesperados viram uma mensagem
// genérica com um código, para achar no log da Vercel e no monitoramento.
async function falha(res, e, rota) {
  const status = Number(e && e.status);
  if (status >= 400 && status < 500) return res.status(status).json({ message: String((e && e.message) || "Pedido inválido.") });
  const ref = crypto.randomBytes(4).toString("hex");
  const mensagem = String((e && e.message) || e);
  console.error(JSON.stringify({ nivel: "erro", ref, rota, mensagem, pilha: String((e && e.stack) || "").split("\n").slice(1, 4).join(" | ") }));
  await registrar({ tipo: "erro_servidor", rota, nome: String((e && e.name) || "Error"), detalhe: mensagem, ref });
  return res.status(500).json({ message: `Não foi possível concluir agora. Tente de novo em instantes. (código ${ref})`, ref });
}

// Limite de tentativas por chave e janela. registrarAgora soma uma tentativa antes de contar.
// Devolve a quantidade na janela.
async function contarTentativas(chave, janelaSeg, registrarAgora) {
  const n = await rest("rpc/contar_tentativa", {
    metodo: "POST",
    corpo: { p_chave: String(chave).slice(0, 120), p_janela_seg: janelaSeg, p_registrar: !!registrarAgora },
  });
  return Number(n) || 0;
}

// Proteção de senha/código contra força bruta: até MAX erros por origem em 15 minutos.
// Cache curto em memória para não consultar o banco a cada chamada certa do Criador.
const JANELA_SENHA = 15 * 60;
const MAX_ERROS_SENHA = 10;
const livreAte = new Map();
async function bloqueadoPorTentativas(req, escopo) {
  const chave = `${escopo}:${origemDe(req) || "sem-origem"}`;
  const ate = livreAte.get(chave);
  if (ate && ate > Date.now()) return false;
  const n = await contarTentativas(chave, JANELA_SENHA, false);
  if (n >= MAX_ERROS_SENHA) return true;
  livreAte.set(chave, Date.now() + 30000);
  if (livreAte.size > 500) livreAte.clear();
  return false;
}
async function registrarErroDeSenha(req, escopo) {
  const chave = `${escopo}:${origemDe(req) || "sem-origem"}`;
  livreAte.delete(chave);
  await contarTentativas(chave, JANELA_SENHA, true).catch(() => 0);
}

// Comparação de segredo em tempo constante
function segredoIgual(enviado, esperado) {
  const a = Buffer.from(String(esperado || ""));
  const b = Buffer.from(String(enviado || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Corpo da requisição como objeto (a Vercel já entrega JSON; texto vira objeto vazio se inválido)
function corpoDe(req) {
  let b = req && req.body;
  if (typeof b === "string") {
    try { b = JSON.parse(b || "{}"); } catch (e) { b = {}; }
  }
  return b && typeof b === "object" && !Array.isArray(b) ? b : {};
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = {
  ipDe,
  origemDe,
  erroPublico,
  registrar,
  falha,
  contarTentativas,
  bloqueadoPorTentativas,
  registrarErroDeSenha,
  segredoIgual,
  corpoDe,
  UUID,
  MAX_ERROS_SENHA,
};
