// Dados públicos que o navegador precisa para falar com o Supabase (a chave anon é pública por desenho).
// Também concentra o monitoramento, para não passar do limite de funções da Vercel no plano gratuito:
//   GET  /api/config?saude=1          checagem de saúde (banco, configuração, tempo de resposta). Usada pelo
//                                      monitor do GitHub Actions e pelo painel. Não mostra segredos.
//   GET  /api/config?saude=1&resumo=1  resumo das últimas 24 h (erros, Web Vitals). Só a conta da plataforma.
//   POST /api/config { tipo: "vital" | "erro", ... }  eventos do navegador (Web Vitals e erros de JavaScript).
// Variáveis na Vercel: SUPABASE_URL e SUPABASE_ANON_KEY.
const { rest } = require("../lib/supabase");
const { registrar, origemDe, contarTentativas, corpoDe } = require("../lib/seguranca");
const { usuarioDaRequisicao, ehAdminDaPlataforma } = require("../lib/conta");

const { VERSAO: GERADOR_VERSAO } = require("../lib/gerador");

const VITAIS = ["LCP", "CLS", "INP", "FCP", "TTFB", "carregamento"];
const VERSAO = "2026-11-05";

async function saude(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const inicio = Date.now();
  const verificacoes = {
    configuracao: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_KEY),
    avisos: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
    criador: !!(process.env.CRIADOR_SENHA && process.env.GITHUB_TOKEN && process.env.GITHUB_REPO),
    banco: false,
  };
  let msBanco = null;
  try {
    const t = Date.now();
    await rest("barbearias?select=id&limit=1");
    msBanco = Date.now() - t;
    verificacoes.banco = true;
  } catch (e) {
    console.error("saude: banco indisponível:", e.message);
  }
  const ok = verificacoes.configuracao && verificacoes.banco;
  const corpo = { ok, versao: VERSAO, gerador: GERADOR_VERSAO, verificacoes, msBanco, ms: Date.now() - inicio, em: new Date().toISOString() };

  if (req.query.resumo === "1") {
    const u = await usuarioDaRequisicao(req).catch(() => null);
    if (!u || !(await ehAdminDaPlataforma(u.id).catch(() => false))) return res.status(403).json({ message: "Só a conta da plataforma vê o resumo." });
    corpo.resumo = await rest("rpc/resumo_saude", { metodo: "POST", corpo: { p_horas: Math.min(168, Math.max(1, Number(req.query.horas) || 24)) } });
  }
  return res.status(ok ? 200 : 503).json(corpo);
}

// Eventos do navegador: amostrados e limitados por origem, para não virar porta de abuso
async function evento(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const b = corpoDe(req);
  const rota = String(b.rota || "").replace(/[?#].*$/, "").slice(0, 200);
  try {
    const n = await contarTentativas(`telemetria:${origemDe(req) || "sem-origem"}`, 600, true);
    if (n > 60) return res.status(204).end();
    if (b.tipo === "vital" && VITAIS.includes(b.nome) && Number.isFinite(Number(b.valor)) && Number(b.valor) >= 0 && Number(b.valor) < 120000) {
      await registrar({ tipo: "vital", rota, nome: b.nome, valor: Number(b.valor) });
    } else if (b.tipo === "erro") {
      await registrar({ tipo: "erro_navegador", rota, nome: String(b.nome || "Error"), detalhe: String(b.detalhe || "").slice(0, 1500) });
    }
  } catch (e) {
    console.error("telemetria:", e.message);
  }
  return res.status(204).end();
}

module.exports = async (req, res) => {
  if (req.method === "POST") return evento(req, res);
  if (req.method !== "GET") return res.status(405).json({ message: "Método não permitido." });
  if (req.query && req.query.saude === "1") return saude(req, res);

  res.setHeader("Cache-Control", "public, max-age=300");
  const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const anon = process.env.SUPABASE_ANON_KEY || "";
  if (!url || !anon) return res.status(500).json({ message: "Login não configurado (faltam SUPABASE_URL ou SUPABASE_ANON_KEY na Vercel)." });
  // Chave pública do Web Push (não é segredo): o navegador precisa dela para assinar os avisos
  return res.status(200).json({ url, anon, vapidPublic: process.env.VAPID_PUBLIC_KEY || "" });
};
