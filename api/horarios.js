// Horários livres para o cliente escolher no site.
// GET /api/horarios?slug=...&profissional=ID&dia=2026-11-04&duracao=30
// profissional=qualquer: junta os horários livres de todos os barbeiros ativos (o sistema atribui um ao pedido).
const { rest } = require("../lib/supabase");
const { horariosDoProfissional } = require("../lib/disponibilidade");

const UUID = /^[0-9a-f-]{36}$/i;

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ message: "Método não permitido." });

  const slug = String(req.query.slug || "");
  const profissional = String(req.query.profissional || "");
  const dia = String(req.query.dia || "");
  const duracao = Number(req.query.duracao);

  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return res.status(400).json({ message: "Barbearia inválida." });
  if (profissional !== "qualquer" && !UUID.test(profissional)) return res.status(400).json({ message: "Profissional inválido." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return res.status(400).json({ message: "Data inválida." });
  if (!Number.isInteger(duracao) || duracao < 5 || duracao > 240) return res.status(400).json({ message: "Duração inválida." });

  try {
    const barb = await rest(`barbearias?slug=eq.${slug}&select=id`);
    if (!barb.length) return res.status(404).json({ message: "Barbearia não encontrada." });
    const barbearia = barb[0].id;

    if (profissional === "qualquer") {
      const equipe = await rest(`profissionais?barbearia_id=eq.${barbearia}&ativo=eq.true&select=id`);
      const todos = new Set();
      for (const p of equipe) (await horariosDoProfissional(p.id, dia, duracao)).forEach((h) => todos.add(h));
      return res.status(200).json({ horarios: [...todos].sort() });
    }

    // O profissional precisa ser da barbearia e estar ativo
    const prof = await rest(`profissionais?id=eq.${profissional}&barbearia_id=eq.${barbearia}&ativo=eq.true&select=id`);
    if (!prof.length) return res.status(404).json({ message: "Profissional não encontrado." });
    return res.status(200).json({ horarios: await horariosDoProfissional(profissional, dia, duracao) });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};
