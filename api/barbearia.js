// Ações sobre sites, só para a conta da plataforma (o admin). Usadas pelo Criador e pelo painel.
// POST acao "publicar": liga o site a uma barbearia, cria o usuário de teste e, se informado, o convite do dono.
// POST acao "redefinir-teste": gera nova senha para o usuário de teste de um site.
// POST acao "link-senha" { slug, userId }: link para uma conta do site (ex.: o dono) criar uma senha nova.
// POST acao "convite-dono" { slug, email, profissionalId? }: convite do dono de um site já no ar; com a ficha,
//      ele também atende e entra nela como dono-barbeiro (barbearia migrada, barbeiros já na equipe).
// POST acao "formulario-criar" { nome, whatsapp, leadId } / "formulario-ler" { id } / "formulario-arquivar" { id }
//      "formulario-criador" { id } (rascunho do Criador) / "formulario-aplicar" { id, slug } (convites e insumos).
const { usuarioDaRequisicao, ehAdminDaPlataforma } = require("../lib/conta");
const { texto } = require("../lib/agenda");
const { publicar, redefinirTeste, criarTesteBarbeiro, redefinirTesteBarbeiro, linkNovaSenha, conviteDono } = require("../lib/publicar");
const { rest } = require("../lib/supabase");
const formulario = require("../lib/formulario");
const migracao = require("../lib/migracao");
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

    if (b.acao === "convite-dono") {
      return res.status(201).json(await conviteDono({ slug, email: b.email, profissionalId: b.profissionalId || null, origem: origemDo(req) }));
    }

    // Migração do Booksy (lib/migracao.js): gera o coletor de uma barbearia e mostra o resultado da última coleta
    if (b.acao === "migracao-criar" || b.acao === "migracao-ultima") {
      const barbeariaId = String(b.barbeariaId || "");
      if (!UUID.test(barbeariaId)) return res.status(400).json({ message: "Escolha a barbearia." });
      if (b.acao === "migracao-ultima") return res.status(200).json(await migracao.ultima(barbeariaId));
      const r = await migracao.criar({ barbeariaId, userId: u.id });
      return res.status(201).json({ ...r, api: origemDo(req) });
    }

    if (b.acao === "formulario-criar") return res.status(201).json(await formulario.criar({ nome: b.nome, whatsapp: b.whatsapp, leadId: b.leadId }, origemDo(req)));
    if (b.acao === "formulario-ler") return res.status(200).json(await formulario.ler(b.id, origemDo(req)));
    if (b.acao === "formulario-arquivar") return res.status(200).json(await formulario.arquivar(b.id));
    if (b.acao === "formulario-criador") return res.status(200).json(formulario.paraCriador(await formulario.ler(b.id, origemDo(req))));
    if (b.acao === "formulario-aplicar") return res.status(200).json(await formulario.aplicar({ id: b.id, slug }, origemDo(req)));

    return res.status(400).json({ message: "Ação desconhecida." });
  } catch (e) {
    return falha(res, e, "POST /api/barbearia");
  }
};
