// Ações sobre sites, só para a conta da plataforma (o admin). Usadas pelo Criador e pelo painel.
// POST acao "publicar": liga o site a uma barbearia, cria o usuário de teste e, se informado, o convite do dono.
// POST acao "redefinir-teste": gera nova senha para o usuário de teste de um site.
const { usuarioDaRequisicao, ehAdminDaPlataforma } = require("../lib/conta");
const { texto } = require("../lib/agenda");
const { publicar, redefinirTeste, criarTesteBarbeiro, redefinirTesteBarbeiro } = require("../lib/publicar");
const { falha, corpoDe } = require("../lib/seguranca");

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

    return res.status(400).json({ message: "Ação desconhecida." });
  } catch (e) {
    return falha(res, e, "POST /api/barbearia");
  }
};
