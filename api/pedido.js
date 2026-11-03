// Recebe um pedido de horário feito no site. Grava como "pendente" e devolve o código
// que o cliente envia junto na mensagem do WhatsApp.
const { rest } = require("../lib/supabase");
const { codigoNovo, texto } = require("../lib/agenda");

const LIMITE_DIA = 60; // pedidos por barbearia em 24 horas, para conter abuso

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ message: "Método não permitido." });

  const b = req.body || {};
  // Campo escondido no formulário: robô costuma preencher, pessoa não
  if (b.website) return res.status(201).json({ codigo: "" });

  const slug = texto(b.slug, 60);
  const dia = texto(b.dia, 10);
  const horario = texto(b.horario, 5);
  const servico = texto(b.servico, 80);
  let profissional = texto(b.profissional, 80);
  const profissionalId = texto(b.profissionalId, 36);
  const cliente = texto(b.cliente, 80);
  const observacao = texto(b.observacao, 200);
  // Duração do serviço, para bloquear o horário certo na agenda. Sem valor válido, assume 30 min.
  const duracao = Number.isInteger(Number(b.duracao)) && Number(b.duracao) >= 5 && Number(b.duracao) <= 240 ? Number(b.duracao) : 30;

  if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ message: "Barbearia inválida." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !/^\d{2}:\d{2}$/.test(horario)) return res.status(400).json({ message: "Data ou horário inválido." });
  if (profissionalId && !/^[0-9a-f-]{36}$/i.test(profissionalId)) return res.status(400).json({ message: "Profissional inválido." });
  if (!servico || !cliente || (!profissional && !profissionalId)) return res.status(400).json({ message: "Preencha serviço, profissional e nome." });

  try {
    const barb = await rest(`barbearias?slug=eq.${slug}&select=id`);
    if (!barb.length) return res.status(404).json({ message: "Barbearia não encontrada." });
    const barbearia_id = barb[0].id;

    // O cliente escolheu o barbeiro: o banco confirma que ele é desta barbearia e grava o id dele
    let profissional_id = null;
    if (profissionalId) {
      const p = await rest(`profissionais?id=eq.${profissionalId}&barbearia_id=eq.${barbearia_id}&ativo=eq.true&select=id,nome`);
      if (!p.length) return res.status(400).json({ message: "Profissional não encontrado nesta barbearia." });
      profissional_id = p[0].id;
      profissional = p[0].nome;
    }

    const desde = new Date(Date.now() - 864e5).toISOString();
    const recentes = await rest(`pedidos?barbearia_id=eq.${barbearia_id}&criado_em=gte.${desde}&select=id`);
    if (recentes.length >= LIMITE_DIA) return res.status(429).json({ message: "Muitos pedidos hoje. Fale com a barbearia pelo WhatsApp." });

    // Se o código sorteado já existir na mesma barbearia, tenta outro
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const codigo = codigoNovo();
      try {
        await rest("pedidos", {
          metodo: "POST",
          prefer: "return=minimal",
          corpo: { slug, barbearia_id, profissional_id, codigo, servico, profissional, dia, horario, cliente, observacao, duracao_min: duracao, status: "pendente" },
        });
        return res.status(201).json({ codigo });
      } catch (e) {
        if (!/duplicate|unique/i.test(e.message)) throw e;
      }
    }
    return res.status(500).json({ message: "Não foi possível gerar o código. Tente de novo." });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};
