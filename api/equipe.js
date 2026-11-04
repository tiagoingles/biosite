// Equipe da barbearia. Só o dono ou o dono-barbeiro administra.
// GET: lista profissionais e convites pendentes.
// POST acao "convidar": cria um convite por e-mail e devolve o link (válido por 7 dias).
// POST acao "cancelar-convite" e "remover": desfazem convite ou remove um barbeiro.
const crypto = require("crypto");
const { rest } = require("../lib/supabase");
const { usuarioDaRequisicao, perfilDe, ehAdmin } = require("../lib/conta");
const { texto } = require("../lib/agenda");

const UUID = /^[0-9a-f-]{36}$/i;
const DIAS_CONVITE = 7;

function enderecoDoSite(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${req.headers.host}`;
}

// Financeiro usa esta mesma função (?area=financeiro) para não passar do limite de funções da Vercel
const financeiro = require("../lib/financeiro");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.query && req.query.area === "financeiro") return financeiro(req, res);
  try {
    const u = await usuarioDaRequisicao(req);
    if (!u) return res.status(401).json({ message: "Entre na sua conta para continuar." });
    const perfil = await perfilDe(u.id);
    if (!ehAdmin(perfil)) return res.status(403).json({ message: "Só o dono administra a equipe." });

    if (req.method === "GET") {
      const profissionais = await rest(`profissionais?barbearia_id=eq.${perfil.barbearia_id}&select=id,nome,ativo,perfil_user_id&order=criado_em.asc`);
      const convites = await rest(
        `convites?barbearia_id=eq.${perfil.barbearia_id}&aceito_em=is.null&expira_em=gt.${new Date().toISOString()}&select=id,email,token,expira_em&order=criado_em.desc`
      );
      return res.status(200).json({
        profissionais,
        convites: convites.map((c) => ({ id: c.id, email: c.email, expira_em: c.expira_em, link: `${enderecoDoSite(req)}/entrar.html?convite=${c.token}` })),
      });
    }

    if (req.method !== "POST") return res.status(405).json({ message: "Método não permitido." });
    const b = req.body || {};

    if (b.acao === "convidar") {
      const email = texto(b.email, 120).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "Informe um e-mail válido." });
      const token = crypto.randomBytes(24).toString("hex");
      const expira = new Date(Date.now() + DIAS_CONVITE * 864e5).toISOString();
      await rest("convites", {
        metodo: "POST",
        prefer: "return=minimal",
        corpo: { barbearia_id: perfil.barbearia_id, email, token, expira_em: expira },
      });
      return res.status(201).json({ link: `${enderecoDoSite(req)}/entrar.html?convite=${token}` });
    }

    if (b.acao === "cancelar-convite") {
      if (!UUID.test(String(b.id || ""))) return res.status(400).json({ message: "Convite inválido." });
      await rest(`convites?id=eq.${b.id}&barbearia_id=eq.${perfil.barbearia_id}`, { metodo: "DELETE", prefer: "return=minimal" });
      return res.status(200).json({ ok: true });
    }

    if (b.acao === "remover") {
      if (!UUID.test(String(b.profissionalId || ""))) return res.status(400).json({ message: "Profissional inválido." });
      const alvo = await rest(`profissionais?id=eq.${b.profissionalId}&barbearia_id=eq.${perfil.barbearia_id}&select=id,perfil_user_id`);
      if (!alvo.length) return res.status(404).json({ message: "Profissional não encontrado." });
      if (alvo[0].perfil_user_id === u.id) return res.status(400).json({ message: "Você não pode se remover da própria equipe." });
      await rest(`profissionais?id=eq.${b.profissionalId}`, { metodo: "DELETE", prefer: "return=minimal" });
      if (alvo[0].perfil_user_id) {
        // Só remove o perfil de quem era barbeiro; um dono nunca é removido por aqui
        await rest(`perfis?user_id=eq.${alvo[0].perfil_user_id}&papel=eq.barbeiro`, { metodo: "DELETE", prefer: "return=minimal" });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ message: "Ação desconhecida." });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};
