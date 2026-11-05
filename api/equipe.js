// Equipe da barbearia. Só o dono ou o dono-barbeiro administra.
// GET: lista profissionais e convites pendentes.
// POST acao "convidar": cria um convite por e-mail e devolve o link (válido por 7 dias).
// POST acao "cancelar-convite" e "remover": desfazem convite ou remove um barbeiro.
const crypto = require("crypto");
const { rest, linkDeEnvio, cfg } = require("../lib/supabase");
const { usuarioDaRequisicao, perfilDoContexto, ehAdmin } = require("../lib/conta");
const { texto } = require("../lib/agenda");

const UUID = /^[0-9a-f-]{36}$/i;
const DIAS_CONVITE = 7;
// Foto do barbeiro: JPG, PNG ou WebP até 5 MB, no bucket público "midia"
const FOTOS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const FOTO_MAX = 5 * 1024 * 1024;

// Lê todas as linhas de uma consulta, em páginas (o banco devolve no máximo 1000 por vez)
async function todosDoBanco(caminho) {
  let saida = [];
  for (let inicio = 0; ; inicio += 1000) {
    const lote = await rest(`${caminho}&limit=1000&offset=${inicio}`);
    saida = saida.concat(lote);
    if (lote.length < 1000) return saida;
  }
}

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
    const perfil = await perfilDoContexto(u, req);
    if (!ehAdmin(perfil)) return res.status(403).json({ message: "Só o dono administra a equipe." });

    if (req.method === "GET") {
      const profissionais = await rest(`profissionais?barbearia_id=eq.${perfil.barbearia_id}&select=id,nome,ativo,perfil_user_id,foto_url&order=criado_em.asc`);
      const convites = await rest(
        `convites?barbearia_id=eq.${perfil.barbearia_id}&aceito_em=is.null&expira_em=gt.${new Date().toISOString()}&select=id,email,token,expira_em&order=criado_em.desc`
      );
      // Atendimentos realizados por barbeiro e por serviço: total e últimos 30 dias
      const hojeBr = new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
      const desde30 = new Date(Date.now() - 3 * 36e5 - 29 * 864e5).toISOString().slice(0, 10);
      const feitos = await todosDoBanco(`pedidos?barbearia_id=eq.${perfil.barbearia_id}&status=eq.realizado&select=profissional_id,servico,dia&order=id`);
      const porProf = {};
      for (const f of feitos) {
        if (!f.profissional_id || f.dia > hojeBr) continue;
        const r = porProf[f.profissional_id] || (porProf[f.profissional_id] = { total: 0, ultimos30: 0, servicos: {} });
        r.total++;
        if (f.dia >= desde30) r.ultimos30++;
        r.servicos[f.servico] = (r.servicos[f.servico] || 0) + 1;
      }
      const comAtendimentos = profissionais.map((p) => {
        const r = porProf[p.id] || { total: 0, ultimos30: 0, servicos: {} };
        return {
          ...p,
          atendimentos: {
            total: r.total,
            ultimos30: r.ultimos30,
            servicos: Object.entries(r.servicos).map(([nome, quantidade]) => ({ nome, quantidade })).sort((a, b) => b.quantidade - a.quantidade),
          },
        };
      });
      return res.status(200).json({
        profissionais: comAtendimentos,
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

    // Foto do barbeiro: o navegador envia o arquivo direto ao Storage, por um link assinado
    if (b.acao === "foto-link" || b.acao === "foto-salvar" || b.acao === "foto-remover") {
      if (!UUID.test(String(b.profissionalId || ""))) return res.status(400).json({ message: "Barbeiro inválido." });
      const alvo = await rest(`profissionais?id=eq.${b.profissionalId}&barbearia_id=eq.${perfil.barbearia_id}&select=id`);
      if (!alvo.length) return res.status(404).json({ message: "Profissional não encontrado." });
      const prefixo = `${cfg().url}/storage/v1/object/public/midia/barbeiros/${perfil.barbearia_id}/${b.profissionalId}-`;

      if (b.acao === "foto-link") {
        const ext = FOTOS[b.tipo];
        if (!ext) return res.status(400).json({ message: "Use uma foto em JPG, PNG ou WebP." });
        if (!(Number(b.tamanho) > 0) || Number(b.tamanho) > FOTO_MAX) return res.status(400).json({ message: "A foto deve ter no máximo 5 MB." });
        const caminho = `barbeiros/${perfil.barbearia_id}/${b.profissionalId}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
        const uploadUrl = await linkDeEnvio("midia", caminho);
        return res.status(200).json({ uploadUrl, publicUrl: `${cfg().url}/storage/v1/object/public/midia/${caminho}` });
      }

      const foto = b.acao === "foto-salvar" ? String(b.foto || "") : null;
      // Só aceita a foto que o próprio servidor preparou para este barbeiro
      if (foto !== null && (!foto.startsWith(prefixo) || foto.includes("..") || foto.length > 500)) return res.status(400).json({ message: "Foto inválida." });
      await rest(`profissionais?id=eq.${b.profissionalId}&barbearia_id=eq.${perfil.barbearia_id}`, { metodo: "PATCH", prefer: "return=minimal", corpo: { foto_url: foto } });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ message: "Ação desconhecida." });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};
