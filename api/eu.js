// Dados da conta logada. GET mostra o perfil e a barbearia.
// POST "virar-barbeiro": o dono passa a atender também (vira dono-barbeiro).
const crypto = require("crypto");
const { rest, linkDeEnvio, cfg } = require("../lib/supabase");

// Foto do próprio barbeiro: JPG, PNG ou WebP até 5 MB, no bucket público "midia"
const FOTOS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const FOTO_MAX = 5 * 1024 * 1024;
const { usuarioDaRequisicao, perfilDe, perfilDoContexto, barbeariaDe, ehAdminDaPlataforma } = require("../lib/conta");
const { diaDaSemana } = require("../lib/horarios");
const { hojeEmBrasilia } = require("../lib/disponibilidade");

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^\d{2}:\d{2}$/;
const min = (h) => { const [a, b] = h.split(":").map(Number); return a * 60 + b; };
const cortaHora = (t) => (t ? String(t).slice(0, 5) : null);

// Agenda do dia do barbeiro ligado a esta conta: o que está salvo e o padrão da semana
async function agendaDoDia(profissionalId, dia) {
  const [linha] = await rest(`agenda_dia?profissional_id=eq.${profissionalId}&dia=eq.${dia}&select=inicio,fim,almoco_inicio,almoco_fim,confirmada_em`);
  const dow = diaDaSemana(dia);
  const [jornada] = await rest(`disponibilidade?profissional_id=eq.${profissionalId}&dia_semana=eq.${dow}&select=inicio,fim`);
  const [almoco] = await rest(`bloqueios?profissional_id=eq.${profissionalId}&tipo=eq.recorrente&dia_semana=eq.${dow}&select=inicio,fim&order=inicio.asc`);
  return {
    dia,
    agenda: linha
      ? { inicio: cortaHora(linha.inicio), fim: cortaHora(linha.fim), almocoInicio: cortaHora(linha.almoco_inicio), almocoFim: cortaHora(linha.almoco_fim), confirmadaEm: linha.confirmada_em }
      : null,
    padrao: {
      inicio: jornada ? cortaHora(jornada.inicio) : "09:00",
      fim: jornada ? cortaHora(jornada.fim) : "18:00",
      almocoInicio: almoco ? cortaHora(almoco.inicio) : "",
      almocoFim: almoco ? cortaHora(almoco.fim) : "",
    },
  };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const u = await usuarioDaRequisicao(req);
    if (!u) return res.status(401).json({ message: "Entre na sua conta para continuar." });

    const perfil = await perfilDe(u.id);

    if (req.method === "GET" && req.query.agenda === "1") {
      const meu = (await rest(`profissionais?perfil_user_id=eq.${u.id}&select=id`))[0];
      if (!meu) return res.status(403).json({ message: "Sua conta não tem agenda de atendimento." });
      const dia = String(req.query.dia || hojeEmBrasilia());
      if (!DIA.test(dia)) return res.status(400).json({ message: "Data inválida." });
      return res.status(200).json(await agendaDoDia(meu.id, dia));
    }

    if (req.method === "GET") {
      // Administrador da plataforma abrindo um site (?barbearia=id): vê a página como o dono dele
      const contexto = await perfilDoContexto(u, req);
      if (contexto && contexto.visaoAdmin) {
        const barbearia = await barbeariaDe(contexto.barbearia_id);
        return res.status(200).json({ usuario: { id: u.id, email: u.email }, perfil: contexto, barbearia, profissional: null, admin: false, visaoAdmin: true });
      }
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

      // Agenda do dia: salvar mantém fora do site até o barbeiro confirmar; confirmar publica o dia
      if (b.acao === "agenda-dia-salvar") {
        const meu = (await rest(`profissionais?perfil_user_id=eq.${u.id}&select=id,barbearia_id`))[0];
        if (!meu) return res.status(403).json({ message: "Sua conta não tem agenda de atendimento." });
        const dia = String(b.dia || "");
        const inicio = String(b.inicio || "");
        const fim = String(b.fim || "");
        const almocoInicio = String(b.almocoInicio || "");
        const almocoFim = String(b.almocoFim || "");
        if (!DIA.test(dia)) return res.status(400).json({ message: "Data inválida." });
        if (dia < hojeEmBrasilia()) return res.status(400).json({ message: "Não dá para mudar a agenda de um dia que já passou." });
        if (!HORA.test(inicio) || !HORA.test(fim) || min(fim) <= min(inicio)) return res.status(400).json({ message: "Informe o horário de início e de fim do expediente." });
        const temAlmoco = almocoInicio !== "" || almocoFim !== "";
        if (temAlmoco && (!HORA.test(almocoInicio) || !HORA.test(almocoFim) || min(almocoFim) <= min(almocoInicio) || min(almocoInicio) < min(inicio) || min(almocoFim) > min(fim))) {
          return res.status(400).json({ message: "O horário de almoço precisa estar dentro do expediente." });
        }
        await rest("agenda_dia?on_conflict=profissional_id,dia", {
          metodo: "POST",
          prefer: "resolution=merge-duplicates,return=minimal",
          corpo: {
            profissional_id: meu.id,
            dia,
            inicio,
            fim,
            almoco_inicio: temAlmoco ? almocoInicio : null,
            almoco_fim: temAlmoco ? almocoFim : null,
            confirmada_em: b.confirmar === true ? new Date().toISOString() : null,
            atualizada_em: new Date().toISOString(),
          },
        });
        return res.status(200).json(await agendaDoDia(meu.id, dia));
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
