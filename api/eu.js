// Dados da conta logada. GET mostra o perfil e a barbearia.
// POST "virar-barbeiro": o dono passa a atender também (vira dono-barbeiro).
const crypto = require("crypto");
const { rest, linkDeEnvio, cfg } = require("../lib/supabase");

// Foto do próprio barbeiro: JPG, PNG ou WebP até 5 MB, no bucket público "midia"
const FOTOS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const FOTO_MAX = 5 * 1024 * 1024;
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
      const prof = await rest(`profissionais?perfil_user_id=eq.${u.id}&select=id,nome,ativo,foto_url`);
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

      // Foto do próprio barbeiro: mexe só no profissional ligado a esta conta
      if (b.acao === "foto-propria-link" || b.acao === "foto-propria-salvar") {
        const meu = (await rest(`profissionais?perfil_user_id=eq.${u.id}&select=id,barbearia_id`))[0];
        if (!meu) return res.status(403).json({ message: "Sua conta não tem agenda de atendimento." });
        const prefixo = `${cfg().url}/storage/v1/object/public/midia/barbeiros/${meu.barbearia_id}/${meu.id}-`;

        if (b.acao === "foto-propria-link") {
          const ext = FOTOS[b.tipo];
          if (!ext) return res.status(400).json({ message: "Use uma foto em JPG, PNG ou WebP." });
          if (!(Number(b.tamanho) > 0) || Number(b.tamanho) > FOTO_MAX) return res.status(400).json({ message: "A foto deve ter no máximo 5 MB." });
          const caminho = `barbeiros/${meu.barbearia_id}/${meu.id}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
          const uploadUrl = await linkDeEnvio("midia", caminho);
          return res.status(200).json({ uploadUrl, publicUrl: `${cfg().url}/storage/v1/object/public/midia/${caminho}` });
        }

        const foto = String(b.foto || "");
        if (!foto.startsWith(prefixo) || foto.includes("..") || foto.length > 500) return res.status(400).json({ message: "Foto inválida." });
        await rest(`profissionais?id=eq.${meu.id}`, { metodo: "PATCH", prefer: "return=minimal", corpo: { foto_url: foto } });
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
