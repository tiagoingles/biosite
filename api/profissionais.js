// Lista pública dos profissionais ativos de uma barbearia, com o id do banco.
// O site usa esse id para o cliente escolher o barbeiro. GET /api/profissionais?slug=...
// Fica 60 s em cache na borda da Vercel (a equipe muda pouco), o que deixa o site mais rápido.
const { rest } = require("../lib/supabase");
const { falha } = require("../lib/seguranca");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ message: "Método não permitido." });
  res.setHeader("Cache-Control", "no-store");

  const slug = String((req.query || {}).slug || "");
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return res.status(400).json({ message: "Barbearia inválida." });

  try {
    const barb = await rest(`barbearias?slug=eq.${slug}&select=id`);
    if (!barb.length) return res.status(404).json({ message: "Barbearia não encontrada." });
    const lista = await rest(`profissionais?barbearia_id=eq.${barb[0].id}&ativo=eq.true&select=id,nome,foto_url&order=nome`);
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({ profissionais: lista });
  } catch (e) {
    return falha(res, e, "GET /api/profissionais");
  }
};
