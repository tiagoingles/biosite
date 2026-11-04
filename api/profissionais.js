// Lista pública dos profissionais ativos de uma barbearia, com o id do banco.
// O site usa esse id para o cliente escolher o barbeiro. GET /api/profissionais?slug=...
const { rest } = require("../lib/supabase");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ message: "Método não permitido." });

  const slug = String(req.query.slug || "");
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return res.status(400).json({ message: "Barbearia inválida." });

  try {
    const barb = await rest(`barbearias?slug=eq.${slug}&select=id`);
    if (!barb.length) return res.status(404).json({ message: "Barbearia não encontrada." });
    const lista = await rest(`profissionais?barbearia_id=eq.${barb[0].id}&ativo=eq.true&select=id,nome,foto_url&order=nome`);
    return res.status(200).json({ profissionais: lista });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};
