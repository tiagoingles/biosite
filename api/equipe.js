// Equipe da barbearia. Só o dono ou o dono-barbeiro administra.
// GET: lista profissionais (com atendimentos) e convites pendentes.
// GET ?agenda=1&profissionalId=&de=&dias=7: agenda de um barbeiro (o dono publica por quem não tem login).
// POST acao:
//   "convidar" { email }               cria um convite (válido por 7 dias) e devolve o link;
//   "cancelar-convite" { id } / "remover" { profissionalId };
//   "foto-link" / "foto-salvar" / "foto-remover"  foto do barbeiro;
//   "agenda-semana-salvar" { profissionalId, dias, confirmar }  publica dias da agenda de um barbeiro;
//   "bloqueio-criar" / "bloqueio-remover" { profissionalId, ... }.
// ?area=financeiro e ?area=assinatura usam esta mesma função (limite de funções da Vercel no plano gratuito).
const crypto = require("crypto");
const { rest, todas, linkDeEnvio, cfg } = require("../lib/supabase");
const { usuarioDaRequisicao, perfilDoContexto, ehAdmin } = require("../lib/conta");
const { texto } = require("../lib/agenda");
const { dataValida, hojeBr, somaDias } = require("../lib/horarios");
const { agendaDaSemana, salvarSemana, criarBloqueio, removerBloqueio } = require("../lib/agenda-dia");
const { falha, corpoDe, UUID } = require("../lib/seguranca");
const financeiro = require("../lib/financeiro");
const assinatura = require("../lib/assinatura");

const DIAS_CONVITE = 7;
// Foto do barbeiro: JPG, PNG ou WebP até 5 MB, no bucket público "midia"
const FOTOS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const FOTO_MAX = 5 * 1024 * 1024;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

function enderecoDoSite(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${req.headers.host}`;
}

async function profissionalDaBarbearia(id, barbeariaId) {
  if (!UUID.test(String(id || ""))) return null;
  return (await rest(`profissionais?id=eq.${id}&barbearia_id=eq.${barbeariaId}&select=id,nome,perfil_user_id`))[0] || null;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.query && req.query.area === "financeiro") return financeiro(req, res);
  if (req.query && req.query.area === "assinatura") return assinatura.area(req, res);
  try {
    const u = await usuarioDaRequisicao(req);
    if (!u) return res.status(401).json({ message: "Entre na sua conta para continuar." });
    const perfil = await perfilDoContexto(u, req);
    if (!ehAdmin(perfil)) return res.status(403).json({ message: "Só o dono administra a equipe." });
    const q = req.query || {};

    if (req.method === "GET" && q.agenda === "1") {
      const prof = await profissionalDaBarbearia(q.profissionalId, perfil.barbearia_id);
      if (!prof) return res.status(404).json({ message: "Profissional não encontrado." });
      const de = String(q.de || hojeBr());
      if (!dataValida(de)) return res.status(400).json({ message: "Data inválida." });
      return res.status(200).json({ profissional: { id: prof.id, nome: prof.nome, temLogin: !!prof.perfil_user_id }, ...(await agendaDaSemana(prof.id, de, q.dias)) });
    }

    if (req.method === "GET") {
      const hoje = hojeBr();
      const desde30 = somaDias(hoje, -29);
      const [profissionais, convites, feitos] = await Promise.all([
        rest(`profissionais?barbearia_id=eq.${perfil.barbearia_id}&select=id,nome,ativo,perfil_user_id,foto_url,comissao_pct&order=criado_em.asc`),
        rest(`convites?barbearia_id=eq.${perfil.barbearia_id}&aceito_em=is.null&expira_em=gt.${new Date().toISOString()}&select=id,email,token,expira_em&order=criado_em.desc`),
        // Atendimentos realizados por barbeiro e por serviço: total e últimos 30 dias
        todas(`pedidos?barbearia_id=eq.${perfil.barbearia_id}&status=eq.realizado&select=profissional_id,servico,dia&order=id`),
      ]);
      const porProf = {};
      for (const f of feitos) {
        if (!f.profissional_id || f.dia > hoje) continue;
        const r = porProf[f.profissional_id] || (porProf[f.profissional_id] = { total: 0, ultimos30: 0, servicos: {} });
        r.total++;
        if (f.dia >= desde30) r.ultimos30++;
        r.servicos[f.servico] = (r.servicos[f.servico] || 0) + 1;
      }
      return res.status(200).json({
        profissionais: profissionais.map((p) => {
          const r = porProf[p.id] || { total: 0, ultimos30: 0, servicos: {} };
          return {
            ...p,
            atendimentos: {
              total: r.total,
              ultimos30: r.ultimos30,
              servicos: Object.entries(r.servicos).map(([nome, quantidade]) => ({ nome, quantidade })).sort((a, b) => b.quantidade - a.quantidade),
            },
          };
        }),
        convites: convites.map((c) => ({ id: c.id, email: c.email, expira_em: c.expira_em, link: `${enderecoDoSite(req)}/entrar.html?convite=${c.token}` })),
      });
    }

    if (req.method !== "POST") return res.status(405).json({ message: "Método não permitido." });
    const b = corpoDe(req);

    if (b.acao === "convidar") {
      const email = texto(b.email, 120).toLowerCase();
      if (!EMAIL.test(email)) return res.status(400).json({ message: "Informe um e-mail válido." });
      const token = crypto.randomBytes(24).toString("hex");
      const expira = new Date(Date.now() + DIAS_CONVITE * 864e5).toISOString();
      await rest("convites", { metodo: "POST", prefer: "return=minimal", corpo: { barbearia_id: perfil.barbearia_id, email, token, expira_em: expira } });
      return res.status(201).json({ link: `${enderecoDoSite(req)}/entrar.html?convite=${token}` });
    }

    if (b.acao === "cancelar-convite") {
      if (!UUID.test(String(b.id || ""))) return res.status(400).json({ message: "Convite inválido." });
      await rest(`convites?id=eq.${b.id}&barbearia_id=eq.${perfil.barbearia_id}`, { metodo: "DELETE", prefer: "return=minimal" });
      return res.status(200).json({ ok: true });
    }

    if (b.acao === "remover") {
      const alvo = await profissionalDaBarbearia(b.profissionalId, perfil.barbearia_id);
      if (!alvo) return res.status(404).json({ message: "Profissional não encontrado." });
      if (alvo.perfil_user_id === u.id) return res.status(400).json({ message: "Você não pode se remover da própria equipe." });
      await rest(`profissionais?id=eq.${alvo.id}&barbearia_id=eq.${perfil.barbearia_id}`, { metodo: "DELETE", prefer: "return=minimal" });
      if (alvo.perfil_user_id) {
        // Só remove o perfil de quem era barbeiro; um dono nunca é removido por aqui
        await rest(`perfis?user_id=eq.${alvo.perfil_user_id}&papel=eq.barbeiro`, { metodo: "DELETE", prefer: "return=minimal" });
      }
      return res.status(200).json({ ok: true });
    }

    // Agenda de um barbeiro, publicada pelo dono (necessário para quem não tem login)
    if (b.acao === "agenda-semana-salvar" || b.acao === "bloqueio-criar" || b.acao === "bloqueio-remover") {
      const prof = await profissionalDaBarbearia(b.profissionalId, perfil.barbearia_id);
      if (!prof) return res.status(404).json({ message: "Profissional não encontrado." });
      if (b.acao === "agenda-semana-salvar") {
        await salvarSemana(prof.id, b.dias, b.confirmar === true);
        const de = (b.dias || []).map((d) => String(d.dia)).sort()[0];
        return res.status(200).json(await agendaDaSemana(prof.id, de, (b.dias || []).length));
      }
      if (b.acao === "bloqueio-criar") return res.status(201).json({ bloqueio: await criarBloqueio(prof.id, b) });
      await removerBloqueio(prof.id, b.id);
      return res.status(200).json({ ok: true });
    }

    // Foto do barbeiro: o navegador envia o arquivo direto ao Storage, por um link assinado
    if (b.acao === "foto-link" || b.acao === "foto-salvar" || b.acao === "foto-remover") {
      const alvo = await profissionalDaBarbearia(b.profissionalId, perfil.barbearia_id);
      if (!alvo) return res.status(404).json({ message: "Profissional não encontrado." });
      const prefixo = `${cfg().url}/storage/v1/object/public/midia/barbeiros/${perfil.barbearia_id}/${alvo.id}-`;

      if (b.acao === "foto-link") {
        const ext = FOTOS[b.tipo];
        if (!ext) return res.status(400).json({ message: "Use uma foto em JPG, PNG ou WebP." });
        if (!(Number(b.tamanho) > 0) || Number(b.tamanho) > FOTO_MAX) return res.status(400).json({ message: "A foto deve ter no máximo 5 MB." });
        const caminho = `barbeiros/${perfil.barbearia_id}/${alvo.id}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
        const uploadUrl = await linkDeEnvio("midia", caminho);
        return res.status(200).json({ uploadUrl, publicUrl: `${cfg().url}/storage/v1/object/public/midia/${caminho}` });
      }

      const foto = b.acao === "foto-salvar" ? String(b.foto || "") : null;
      // Só aceita a foto que o próprio servidor preparou para este barbeiro
      if (foto !== null && (!foto.startsWith(prefixo) || !/^[0-9a-f]{12}\.(jpg|png|webp)$/.test(foto.slice(prefixo.length)))) return res.status(400).json({ message: "Foto inválida." });
      await rest(`profissionais?id=eq.${alvo.id}&barbearia_id=eq.${perfil.barbearia_id}`, { metodo: "PATCH", prefer: "return=minimal", corpo: { foto_url: foto } });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ message: "Ação desconhecida." });
  } catch (e) {
    return falha(res, e, `${req.method} /api/equipe`);
  }
};
