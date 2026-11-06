// Dados da conta logada.
// GET                         perfil, barbearia e profissional ligado à conta.
// GET ?agenda=1&dia=          agenda do dia do barbeiro (o que está salvo e o padrão da semana).
// GET ?semana=1&de=&dias=7    vários dias seguidos, com os bloqueios pontuais (publicar a semana de uma vez).
// POST acao:
//   "inscrever-push" / "cancelar-push"     avisos no celular deste aparelho;
//   "foto-propria-link" / "foto-propria-salvar"   foto do próprio barbeiro;
//   "agenda-dia-salvar" { dia, inicio, fim, almocoInicio, almocoFim, confirmar }
//   "agenda-semana-salvar" { dias: [{ dia, inicio, fim, almocoInicio, almocoFim, folga }], confirmar }
//   "bloqueio-criar" { dia, inicio, fim, motivo } / "bloqueio-remover" { id }
//   "virar-barbeiro"  o dono passa a atender também (vira dono-barbeiro).
const crypto = require("crypto");
const { rest, linkDeEnvio, cfg } = require("../lib/supabase");
const { usuarioDaRequisicao, perfilDe, perfilDoContexto, barbeariaDe, ehAdminDaPlataforma } = require("../lib/conta");
const { dataValida, hojeBr } = require("../lib/horarios");
const { agendaDoDia, agendaDaSemana, salvarDia, salvarSemana, criarBloqueio, removerBloqueio } = require("../lib/agenda-dia");
const { falha, corpoDe } = require("../lib/seguranca");

// Foto do próprio barbeiro: JPG, PNG ou WebP até 5 MB, no bucket público "midia"
const FOTOS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const FOTO_MAX = 5 * 1024 * 1024;

// Serviços de Web Push dos navegadores (Chrome/Android, Firefox, Edge/Windows, Safari/iPhone)
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /^web\.push\.apple\.com$/];
function endpointDePushValido(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOSTS.some((r) => r.test(u.hostname));
  } catch (e) {
    return false;
  }
}

async function meuProfissional(userId) {
  return (await rest(`profissionais?perfil_user_id=eq.${userId}&select=id,barbearia_id,nome`))[0] || null;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const u = await usuarioDaRequisicao(req);
    if (!u) return res.status(401).json({ message: "Entre na sua conta para continuar." });
    const q = req.query || {};

    if (req.method === "GET" && (q.agenda === "1" || q.semana === "1")) {
      const meu = await meuProfissional(u.id);
      if (!meu) return res.status(403).json({ message: "Sua conta não tem agenda de atendimento." });
      const dia = String(q.dia || q.de || hojeBr());
      if (!dataValida(dia)) return res.status(400).json({ message: "Data inválida." });
      if (q.semana === "1") return res.status(200).json(await agendaDaSemana(meu.id, dia, q.dias));
      return res.status(200).json(await agendaDoDia(meu.id, dia));
    }

    const perfil = await perfilDe(u.id);

    if (req.method === "GET") {
      // Administrador da plataforma abrindo um site (?barbearia=id): vê a página como o dono dele
      const contexto = await perfilDoContexto(u, req);
      if (contexto && contexto.visaoAdmin) {
        const barbearia = await barbeariaDe(contexto.barbearia_id);
        return res.status(200).json({ usuario: { id: u.id, email: u.email }, perfil: contexto, barbearia, profissional: null, admin: false, visaoAdmin: true });
      }
      if (!perfil && (await ehAdminDaPlataforma(u.id))) {
        // Administrador da plataforma: vê todos os sites
        const [barbearias, equipe, leads, assinaturas] = await Promise.all([
          rest("barbearias?select=id,slug,nome,teste_user_id&order=criado_em.desc"),
          rest("profissionais?ativo=eq.true&select=id,nome,barbearia_id,perfil_user_id&order=criado_em.asc"),
          // Interessados da página de vendas (se a tabela ainda não existir, a lista vem vazia)
          rest("leads?select=id,criado_em,nome,barbearia,cidade,whatsapp,barbeiros,plano,pagina,status&order=criado_em.desc&limit=100").catch(() => []),
          // Assinatura do Bio Site de cada barbearia (Stripe)
          rest("assinaturas?select=barbearia_id,status,plano,valor_mensal,primeira_cobranca_em,proxima_cobranca_em").catch(() => []),
        ]);
        return res.status(200).json({
          usuario: { id: u.id, email: u.email },
          perfil: null,
          admin: true,
          leads,
          barbearias: barbearias.map((b) => ({
            id: b.id,
            slug: b.slug,
            nome: b.nome,
            temTeste: !!b.teste_user_id,
            assinatura: assinaturas.find((a) => a.barbearia_id === b.id) || null,
            equipe: equipe.filter((p) => p.barbearia_id === b.id).map((p) => ({ id: p.id, nome: p.nome, temAcesso: !!p.perfil_user_id })),
          })),
        });
      }
      if (!perfil) {
        // Sem perfil: mostra os convites recebidos por este e-mail
        const convites = await rest(`convites?email=eq.${encodeURIComponent(u.email)}&aceito_em=is.null&expira_em=gt.${new Date().toISOString()}&select=token,barbearia_id`);
        return res.status(200).json({ usuario: { id: u.id, email: u.email }, perfil: null, convites: convites.length });
      }
      const [barbearia, prof] = await Promise.all([barbeariaDe(perfil.barbearia_id), rest(`profissionais?perfil_user_id=eq.${u.id}&select=id,nome,ativo,foto_url,comissao_pct`)]);
      return res.status(200).json({ usuario: { id: u.id, email: u.email }, perfil, barbearia, profissional: prof[0] || null });
    }

    if (req.method === "POST") {
      const b = corpoDe(req);

      // Avisos no celular: qualquer conta logada pode ativar os avisos do próprio aparelho
      if (b.acao === "inscrever-push") {
        const s = b.subscription || {};
        const endpoint = String(s.endpoint || "");
        const p256dh = String((s.keys || {}).p256dh || "");
        const auth = String((s.keys || {}).auth || "");
        if (endpoint.length > 2000 || !endpointDePushValido(endpoint) || !/^[A-Za-z0-9_-]{20,200}$/.test(p256dh) || !/^[A-Za-z0-9_-]{8,100}$/.test(auth)) {
          return res.status(400).json({ message: "Assinatura de avisos inválida." });
        }
        await rest("push_inscricoes?on_conflict=endpoint", {
          metodo: "POST",
          prefer: "resolution=merge-duplicates,return=minimal",
          corpo: { user_id: u.id, endpoint, p256dh, auth_key: auth },
        });
        return res.status(200).json({ ok: true });
      }
      if (b.acao === "cancelar-push") {
        const endpoint = String(b.endpoint || "").slice(0, 2000);
        await rest(`push_inscricoes?endpoint=eq.${encodeURIComponent(endpoint)}&user_id=eq.${u.id}`, { metodo: "DELETE", prefer: "return=minimal" });
        return res.status(200).json({ ok: true });
      }

      // Foto do próprio barbeiro: mexe só no profissional ligado a esta conta
      if (b.acao === "foto-propria-link" || b.acao === "foto-propria-salvar") {
        const meu = await meuProfissional(u.id);
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
        if (!foto.startsWith(prefixo) || !/^[0-9a-f]{12}\.(jpg|png|webp)$/.test(foto.slice(prefixo.length))) return res.status(400).json({ message: "Foto inválida." });
        await rest(`profissionais?id=eq.${meu.id}`, { metodo: "PATCH", prefer: "return=minimal", corpo: { foto_url: foto } });
        return res.status(200).json({ ok: true });
      }

      // Agenda: salvar mantém fora do site até confirmar; confirmar publica
      if (["agenda-dia-salvar", "agenda-semana-salvar", "bloqueio-criar", "bloqueio-remover"].includes(b.acao)) {
        const meu = await meuProfissional(u.id);
        if (!meu) return res.status(403).json({ message: "Sua conta não tem agenda de atendimento." });
        if (b.acao === "agenda-dia-salvar") {
          await salvarDia(meu.id, b, b.confirmar === true);
          return res.status(200).json(await agendaDoDia(meu.id, String(b.dia)));
        }
        if (b.acao === "agenda-semana-salvar") {
          await salvarSemana(meu.id, b.dias, b.confirmar === true);
          const de = (b.dias || []).map((d) => String(d.dia)).sort()[0];
          return res.status(200).json(await agendaDaSemana(meu.id, de, (b.dias || []).length));
        }
        if (b.acao === "bloqueio-criar") return res.status(201).json({ bloqueio: await criarBloqueio(meu.id, b) });
        await removerBloqueio(meu.id, b.id);
        return res.status(200).json({ ok: true });
      }

      // Conta da plataforma: andamento de um interessado da página de vendas
      if (b.acao === "lead-status") {
        if (perfil || !(await ehAdminDaPlataforma(u.id))) return res.status(403).json({ message: "Só a conta da plataforma faz isso." });
        if (!/^[0-9a-f-]{36}$/i.test(String(b.id || "")) || !["novo", "contatado", "cliente", "descartado"].includes(b.status)) return res.status(400).json({ message: "Pedido inválido." });
        await rest(`leads?id=eq.${b.id}`, { metodo: "PATCH", prefer: "return=minimal", corpo: { status: b.status, atualizado_em: new Date().toISOString() } });
        return res.status(200).json({ ok: true });
      }

      if (b.acao !== "virar-barbeiro") return res.status(400).json({ message: "Ação desconhecida." });
      if (!perfil || perfil.papel !== "dono") return res.status(403).json({ message: "Só o dono pode fazer isso." });
      const nome = perfil.nome || u.email.split("@")[0];
      await rest(`perfis?user_id=eq.${u.id}`, { metodo: "PATCH", prefer: "return=minimal", corpo: { papel: "dono_barbeiro" } });
      await rest("profissionais", { metodo: "POST", prefer: "return=minimal", corpo: { barbearia_id: perfil.barbearia_id, perfil_user_id: u.id, nome } });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ message: "Método não permitido." });
  } catch (e) {
    return falha(res, e, `${req.method} /api/eu`);
  }
};
