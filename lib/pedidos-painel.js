// Pedidos de horário da barbearia, para o painel.
// GET ?dia=2026-11-04 lista os pedidos do dia. O dono vê todos; o barbeiro vê só os dele.
// PATCH { id, status: "confirmado" | "recusado" } confirma ou recusa um pedido pendente.
// Quem confirma: o dono, o dono-barbeiro, ou o próprio barbeiro do pedido.
const { rest } = require("./supabase");
const { usuarioDaRequisicao, perfilDe, ehAdmin, ehAdminDaPlataforma } = require("./conta");

const UUID = /^[0-9a-f-]{36}$/i;
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const DECISOES = ["confirmado", "recusado"];

// Id do profissional ligado ao usuário logado (só barbeiros têm)
async function profissionalDoUsuario(userId) {
  const linhas = await rest(`profissionais?perfil_user_id=eq.${userId}&select=id`);
  return linhas[0] ? linhas[0].id : null;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const u = await usuarioDaRequisicao(req);
    if (!u) return res.status(401).json({ message: "Entre na sua conta para continuar." });
    const perfil = await perfilDe(u.id);
    const plataforma = await ehAdminDaPlataforma(u.id);
    // Administrador da plataforma escolhe o site (?barbearia=id); os outros usam a própria barbearia
    let barbeariaId = perfil ? perfil.barbearia_id : null;
    if (plataforma && UUID.test(String(req.query.barbearia || ""))) barbeariaId = req.query.barbearia;
    if (!barbeariaId) return res.status(403).json({ message: "Sua conta ainda não está ligada a uma barbearia." });

    // Barbeiro sem ser administrador só enxerga e decide os próprios pedidos
    const soDele = !plataforma && !ehAdmin(perfil);
    const meuProfissional = soDele ? await profissionalDoUsuario(u.id) : null;
    if (soDele && !meuProfissional) return res.status(403).json({ message: "Seu perfil não tem agenda de atendimento." });

    if (req.method === "GET") {
      const filtro = soDele ? `&profissional_id=eq.${meuProfissional}` : "";
      // Pendentes de hoje em diante, de todos os dias (para as telas de confirmação)
      if (req.query.pendentes === "1") {
        const hoje = new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
        const pendentes = await rest(
          `pedidos?barbearia_id=eq.${barbeariaId}&status=eq.pendente&dia=gte.${hoje}${filtro}&select=id,codigo,servico,profissional,profissional_id,dia,horario,horario_fim,duracao_min,cliente,observacao,status&order=dia.asc,horario.asc`
        );
        return res.status(200).json({ pedidos: pendentes });
      }
      const dia = String(req.query.dia || "");
      if (!DIA.test(dia)) return res.status(400).json({ message: "Data inválida." });
      const pedidos = await rest(
        `pedidos?barbearia_id=eq.${barbeariaId}&dia=eq.${dia}${filtro}&select=id,codigo,servico,profissional,profissional_id,horario,horario_fim,duracao_min,cliente,observacao,status&order=horario.asc`
      );
      return res.status(200).json({ pedidos });
    }

    if (req.method === "PATCH") {
      const b = req.body || {};
      const id = String(b.id || "");
      if (!UUID.test(id)) return res.status(400).json({ message: "Pedido inválido." });
      if (!DECISOES.includes(b.status)) return res.status(400).json({ message: "Use confirmado ou recusado." });

      // O pedido precisa ser desta barbearia e, para barbeiro, ser dele
      const atual = await rest(`pedidos?id=eq.${id}&barbearia_id=eq.${barbeariaId}&select=id,status,profissional_id`);
      if (!atual.length) return res.status(404).json({ message: "Pedido não encontrado." });
      if (soDele && atual[0].profissional_id !== meuProfissional) return res.status(403).json({ message: "Este pedido é de outro barbeiro." });
      if (atual[0].status !== "pendente") return res.status(409).json({ message: "Este pedido já foi decidido." });

      const [novo] = await rest(`pedidos?id=eq.${id}&status=eq.pendente`, {
        metodo: "PATCH",
        prefer: "return=representation",
        corpo: { status: b.status },
      });
      if (!novo) return res.status(409).json({ message: "Este pedido já foi decidido." });
      return res.status(200).json({ pedido: novo });
    }

    return res.status(405).json({ message: "Método não permitido." });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};
