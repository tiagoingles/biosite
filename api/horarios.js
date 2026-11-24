// Horários livres para o cliente escolher no site.
// GET /api/horarios?slug=...&profissional=ID&dia=2026-11-04&duracao=30
// profissional=qualquer: junta os horários livres de todos os barbeiros ativos (o sistema atribui um ao pedido).
// A resposta fica 10 s em cache na borda da Vercel: o pedido confere de novo no banco antes de gravar.
// Vários serviços de uma vez (fase 38): GET ...&profissional=ID|qualquer&dia=...&duracoes=40,30&modo=junto|seguido
//   -> planos: para cada horário de início, o barbeiro e o horário de cada serviço. "junto": no mesmo horário, com
//   barbeiros diferentes; "seguido": um depois do outro (mesmo barbeiro ou outro, com até 30 min de espera).
const { rest } = require("../lib/supabase");
const { disponibilidadeDoDia, dadosDoDia, planosDoDia } = require("../lib/disponibilidade");
const { dataValida, hojeBr, somaDias, agoraMinBr, minutos } = require("../lib/horarios");
const { falha, UUID } = require("../lib/seguranca");

// Dias com agenda publicada nos próximos 30 dias (o site só mostra esses dias).
// GET /api/horarios?slug=...&profissional=ID|qualquer&dias=1
// Hoje sai da lista quando o expediente publicado já está acabando.
async function diasPublicados(res, slug, profissional) {
  try {
    const barb = await rest(`barbearias?slug=eq.${slug}&select=id`);
    if (!barb.length) return res.status(404).json({ message: "Barbearia não encontrada." });
    const hoje = hojeBr();
    const ate = somaDias(hoje, 30);
    const filtroProf =
      profissional === "qualquer"
        ? `&profissionais.barbearia_id=eq.${barb[0].id}&profissionais.ativo=eq.true`
        : `&profissional_id=eq.${profissional}&profissionais.barbearia_id=eq.${barb[0].id}&profissionais.ativo=eq.true`;
    const linhas = await rest(
      `agenda_dia?dia=gte.${hoje}&dia=lte.${ate}&confirmada_em=not.is.null&select=dia,fim,profissionais!inner(barbearia_id,ativo)${filtroProf}&order=dia.asc&limit=500`
    );
    const agora = agoraMinBr();
    const dias = [...new Set(linhas.filter((l) => l.dia !== hoje || minutos(String(l.fim).slice(0, 5)) - 15 > agora).map((l) => l.dia))];
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=30, stale-while-revalidate=60");
    return res.status(200).json({ dias });
  } catch (e) {
    return falha(res, e, "GET /api/horarios?dias=1");
  }
}

// Planos para vários serviços (fase 38)
async function planos(res, { slug, profissional, dia, duracoes, modo }) {
  try {
    const barb = await rest(`barbearias?slug=eq.${slug}&select=id`);
    if (!barb.length) return res.status(404).json({ message: "Barbearia não encontrada." });
    let equipe = await rest(`profissionais?barbearia_id=eq.${barb[0].id}&ativo=eq.true&select=id,nome&order=criado_em.asc`);
    // Um depois do outro com o barbeiro escolhido: só ele; no mesmo horário, a equipe toda
    if (modo === "seguido" && profissional !== "qualquer") {
      equipe = equipe.filter((p) => p.id === profissional);
      if (!equipe.length) return res.status(404).json({ message: "Profissional não encontrado." });
    }
    const barbeiros = await Promise.all(equipe.map(async (p) => ({ id: p.id, nome: p.nome, dados: await dadosDoDia(p.id, dia) })));
    // Quem tem menos pedidos no dia vem antes (divide o trabalho, como no "qualquer barbeiro")
    barbeiros.sort((a, b) => (a.dados.pedidos || 0) - (b.dados.pedidos || 0));
    const lista = planosDoDia({ barbeiros, duracoes, modo, agoraMin: dia === hojeBr() ? agoraMinBr() : -1 });
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=10, stale-while-revalidate=20");
    return res.status(200).json({ planos: lista });
  } catch (e) {
    return falha(res, e, "GET /api/horarios?duracoes");
  }
}

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ message: "Método não permitido." });
  const q = req.query || {};
  const slug = String(q.slug || "");
  const profissional = String(q.profissional || "");
  const dia = String(q.dia || "");
  const duracao = Number(q.duracao);

  res.setHeader("Cache-Control", "no-store");
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return res.status(400).json({ message: "Barbearia inválida." });
  if (profissional !== "qualquer" && !UUID.test(profissional)) return res.status(400).json({ message: "Profissional inválido." });
  if (q.dias === "1") return diasPublicados(res, slug, profissional);
  if (!dataValida(dia)) return res.status(400).json({ message: "Data inválida." });
  if (q.duracoes !== undefined) {
    const duracoes = String(q.duracoes).split(",").map(Number);
    const modo = q.modo === "junto" ? "junto" : "seguido";
    const total = duracoes.reduce((t, d) => t + d, 0);
    if (duracoes.length < 2 || duracoes.length > 4 || duracoes.some((d) => !Number.isInteger(d) || d < 5 || d > 240) || (modo === "seguido" && total > 240)) {
      return res.status(400).json({ message: "Serviços inválidos." });
    }
    const hoje = hojeBr();
    if (dia < hoje || dia > somaDias(hoje, 60)) return res.status(200).json({ planos: [] });
    return planos(res, { slug, profissional, dia, duracoes, modo });
  }
  if (!Number.isInteger(duracao) || duracao < 5 || duracao > 240) return res.status(400).json({ message: "Duração inválida." });
  const hoje = hojeBr();
  if (dia < hoje || dia > somaDias(hoje, 60)) return res.status(200).json({ horarios: [] });

  try {
    const barb = await rest(`barbearias?slug=eq.${slug}&select=id`);
    if (!barb.length) return res.status(404).json({ message: "Barbearia não encontrada." });
    const barbearia = barb[0].id;

    let horarios;
    if (profissional === "qualquer") {
      const equipe = await rest(`profissionais?barbearia_id=eq.${barbearia}&ativo=eq.true&select=id`);
      const todos = await Promise.all(equipe.map((p) => disponibilidadeDoDia(p.id, dia, duracao)));
      horarios = [...new Set(todos.flatMap((d) => d.livres))].sort();
    } else {
      // O profissional precisa ser da barbearia e estar ativo
      const prof = await rest(`profissionais?id=eq.${profissional}&barbearia_id=eq.${barbearia}&ativo=eq.true&select=id`);
      if (!prof.length) return res.status(404).json({ message: "Profissional não encontrado." });
      horarios = (await disponibilidadeDoDia(profissional, dia, duracao)).livres;
    }
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=10, stale-while-revalidate=20");
    return res.status(200).json({ horarios });
  } catch (e) {
    return falha(res, e, "GET /api/horarios");
  }
};
