// Horários livres de um profissional num dia, para o cliente escolher no site.
// GET /api/horarios?slug=...&profissional=ID&dia=2026-11-04&duracao=30
const { rest } = require("../lib/supabase");
const { horariosLivres, diaDaSemana } = require("../lib/horarios");

const UUID = /^[0-9a-f-]{36}$/i;

// Horário de agora em Brasília, em minutos, para não mostrar horários que já passaram hoje
function agoraEmMinutos() {
  const br = new Date(Date.now() - 3 * 36e5);
  return br.getUTCHours() * 60 + br.getUTCMinutes();
}

function hojeEmBrasilia() {
  return new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ message: "Método não permitido." });

  const slug = String(req.query.slug || "");
  const profissional = String(req.query.profissional || "");
  const dia = String(req.query.dia || "");
  const duracao = Number(req.query.duracao);

  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return res.status(400).json({ message: "Barbearia inválida." });
  if (!UUID.test(profissional)) return res.status(400).json({ message: "Profissional inválido." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return res.status(400).json({ message: "Data inválida." });
  if (!Number.isInteger(duracao) || duracao < 5 || duracao > 240) return res.status(400).json({ message: "Duração inválida." });

  try {
    const barb = await rest(`barbearias?slug=eq.${slug}&select=id`);
    if (!barb.length) return res.status(404).json({ message: "Barbearia não encontrada." });
    const barbearia = barb[0].id;

    // O profissional precisa ser da barbearia e estar ativo
    const prof = await rest(`profissionais?id=eq.${profissional}&barbearia_id=eq.${barbearia}&ativo=eq.true&select=id`);
    if (!prof.length) return res.status(404).json({ message: "Profissional não encontrado." });

    const dow = diaDaSemana(dia);
    const hoje = dia === hojeEmBrasilia();
    const [disponibilidade, bloqueios, pedidos] = await Promise.all([
      rest(`disponibilidade?profissional_id=eq.${profissional}&dia_semana=eq.${dow}&select=inicio,fim`),
      rest(`bloqueios?profissional_id=eq.${profissional}&or=(and(tipo.eq.recorrente,dia_semana.eq.${dow}),and(tipo.eq.pontual,data.eq.${dia}))&select=inicio,fim`),
      rest(`pedidos?profissional_id=eq.${profissional}&dia=eq.${dia}&status=in.(pendente,confirmado,avulso)&select=horario,duracao_min`),
    ]);

    const horarios = horariosLivres({
      duracaoMin: duracao,
      agoraMin: hoje ? agoraEmMinutos() : -1,
      disponibilidade: disponibilidade.map((d) => ({ inicio: d.inicio, fim: d.fim })),
      bloqueios: bloqueios.map((b) => ({ inicio: b.inicio, fim: b.fim })),
      ocupados: pedidos.map((p) => ({ inicio: p.horario, duracaoMin: p.duracao_min || 30 })),
    });

    return res.status(200).json({ horarios });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};
