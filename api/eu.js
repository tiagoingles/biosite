// Dados da conta logada. GET mostra o perfil e a barbearia.
// POST "virar-barbeiro": o dono passa a atender também (vira dono-barbeiro).
const { rest } = require("../lib/supabase");
const { usuarioDaRequisicao, perfilDe, barbeariaDe, ehAdminDaPlataforma } = require("../lib/conta");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const u = await usuarioDaRequisicao(req);
    if (!u) return res.status(401).json({ message: "Entre na sua conta para continuar." });

    const perfil = await perfilDe(u.id);

    if (req.method === "GET") {
      if (!perfil && (await ehAdminDaPlataforma(u.id))) {
        // Administrador da plataforma: vê todos os sites
        const barbearias = await rest("barbearias?select=id,slug,nome,teste_user_id&order=criado_em.desc");
        const equipe = await rest("profissionais?ativo=eq.true&select=id,nome,barbearia_id,perfil_user_id&order=criado_em.asc");
        return res.status(200).json({
          usuario: { id: u.id, email: u.email },
          perfil: null,
          admin: true,
          barbearias: barbearias.map((b) => ({
            id: b.id,
            slug: b.slug,
            nome: b.nome,
            temTeste: !!b.teste_user_id,
            equipe: equipe
              .filter((p) => p.barbearia_id === b.id)
              .map((p) => ({ id: p.id, nome: p.nome, temAcesso: !!p.perfil_user_id })),
          })),
        });
      }
      if (!perfil) {
        // Sem perfil: mostra os convites recebidos por este e-mail
        const convites = await rest(
          `convites?email=eq.${encodeURIComponent(u.email)}&aceito_em=is.null&expira_em=gt.${new Date().toISOString()}&select=token,barbearia_id`
        );
        return res.status(200).json({ usuario: { id: u.id, email: u.email }, perfil: null, convites: convites.length });
      }
      const barbearia = await barbeariaDe(perfil.barbearia_id);
      const prof = await rest(`profissionais?perfil_user_id=eq.${u.id}&select=id,nome,ativo`);
      return res.status(200).json({ usuario: { id: u.id, email: u.email }, perfil, barbearia, profissional: prof[0] || null });
    }

    if (req.method === "POST") {
      const b = req.body || {};

      // Avisos no celular: qualquer conta logada pode ativar os avisos do próprio aparelho
      if (b.acao === "inscrever-push") {
        const s = b.subscription || {};
        const endpoint = String(s.endpoint || "");
        const p256dh = String((s.keys || {}).p256dh || "");
        const auth = String((s.keys || {}).auth || "");
        if (!/^https:\/\//.test(endpoint) || endpoint.length > 2000 || !p256dh || !auth) return res.status(400).json({ message: "Assinatura inválida." });
        await rest("push_inscricoes?on_conflict=endpoint", {
          metodo: "POST",
          prefer: "resolution=merge-duplicates,return=minimal",
          corpo: { user_id: u.id, endpoint, p256dh, auth_key: auth },
        });
        return res.status(200).json({ ok: true });
      }
      if (b.acao === "cancelar-push") {
        const endpoint = String(b.endpoint || "");
        await rest(`push_inscricoes?endpoint=eq.${encodeURIComponent(endpoint)}&user_id=eq.${u.id}`, { metodo: "DELETE", prefer: "return=minimal" });
        return res.status(200).json({ ok: true });
      }

      if (b.acao !== "virar-barbeiro") return res.status(400).json({ message: "Ação desconhecida." });
      if (!perfil || perfil.papel !== "dono") return res.status(403).json({ message: "Só o dono pode fazer isso." });
      const nome = perfil.nome || u.email.split("@")[0];
      await rest(`perfis?user_id=eq.${u.id}`, { metodo: "PATCH", prefer: "return=minimal", corpo: { papel: "dono_barbeiro" } });
      await rest("profissionais", {
        metodo: "POST",
        prefer: "return=minimal",
        corpo: { barbearia_id: perfil.barbearia_id, perfil_user_id: u.id, nome },
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ message: "Método não permitido." });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};
