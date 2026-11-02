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
  const profissional = texto(b.profissional, 80);
  const cliente = texto(b.cliente, 80);
  const observacao = texto(b.observacao, 200);

  if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ message: "Barbearia inválida." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !/^\d{2}:\d{2}$/.test(horario)) return res.status(400).json({ message: "Data ou horário inválido." });
  if (!servico || !profissional || !cliente) return res.status(400).json({ message: "Preencha serviço, profissional e nome." });

  try {
    const desde = new Date(Date.now() - 864e5).toISOString();
    const recentes = await rest(`pedidos?slug=eq.${encodeURIComponent(slug)}&criado_em=gte.${desde}&select=id`);
    if (recentes.length >= LIMITE_DIA) return res.status(429).json({ message: "Muitos pedidos hoje. Fale com a barbearia pelo WhatsApp." });

    // Se o código sorteado já existir na mesma barbearia, tenta outro
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const codigo = codigoNovo();
      try {
        await rest("pedidos", {
          metodo: "POST",
          prefer: "return=minimal",
          corpo: { slug, codigo, servico, profissional, dia, horario, cliente, observacao, status: "pendente" },
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
