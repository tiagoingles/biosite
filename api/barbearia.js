// Ações sobre sites, só para a conta da plataforma (o admin). Usadas pelo Criador e pelo painel.
// POST acao "publicar": liga o site a uma barbearia, cria o usuário de teste e, se informado, o convite do dono.
// POST acao "redefinir-teste": gera nova senha para o usuário de teste de um site.
// POST acao "link-senha" { slug, userId }: link para uma conta do site (ex.: o dono) criar uma senha nova.
const { usuarioDaRequisicao, ehAdminDaPlataforma } = require("../lib/conta");
const { texto } = require("../lib/agenda");
const { publicar, redefinirTeste, criarTesteBarbeiro, redefinirTesteBarbeiro, linkNovaSenha } = require("../lib/publicar");
const { rest } = require("../lib/supabase");
const { falha, corpoDe, UUID } = require("../lib/seguranca");

function origemDo(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${req.headers.host}`;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ message: "Método não permitido." });

  try {
    const u = await usuarioDaRequisicao(req);
    if (!u) return res.status(401).json({ message: "Entre na sua conta para continuar." });
    if (!(await ehAdminDaPlataforma(u.id))) return res.status(403).json({ message: "Só a conta da plataforma publica sites." });

    const b = corpoDe(req);
    const slug = texto(b.slug, 40).toLowerCase();

    if (b.acao === "publicar") {
      const r = await publicar({
        nome: texto(b.nome, 80),
        slug,
        emailDono: texto(b.emailDono, 120).toLowerCase(),
        origem: origemDo(req),
      });
      return res.status(r.nova ? 201 : 200).json(r);
    }

    if (b.acao === "redefinir-teste") return res.status(200).json(await redefinirTeste(slug));
    if (b.acao === "teste-barbeiro") return res.status(201).json(await criarTesteBarbeiro({ slug, profissionalId: b.profissionalId }));
    if (b.acao === "redefinir-teste-barbeiro") return res.status(200).json(await redefinirTesteBarbeiro({ slug, profissionalId: b.profissionalId }));

    if (b.acao === "link-senha") {
      const userId = String(b.userId || "");
      if (!UUID.test(userId)) return res.status(400).json({ message: "Conta inválida." });
      const site = (await rest(`barbearias?slug=eq.${encodeURIComponent(slug)}&select=id`))[0];
      if (!site) return res.status(404).json({ message: "Site não encontrado." });
      const perfil = (await rest(`perfis?user_id=eq.${userId}&barbearia_id=eq.${site.id}&select=nome`))[0];
      if (!perfil) return res.status(404).json({ message: "Esta conta não é deste site." });
      const r = await linkNovaSenha(userId, origemDo(req));
      return res.status(200).json({ link: r.link, nome: perfil.nome });
    }

    return res.status(400).json({ message: "Ação desconhecida." });
  } catch (e) {
    return falha(res, e, "POST /api/barbearia");
  }
};
