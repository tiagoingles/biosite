// Horários livres de UM profissional num dia, lendo o banco. Usado pela consulta de horários
// e pela criação de pedido. Regra: o dia só fica disponível no site depois que o barbeiro
// (ou o dono, para quem não tem login) confirma a agenda daquele dia.
const { rest } = require("./supabase");
const { horariosLivres, diaDaSemana, hojeBr, agoraMinBr } = require("./horarios");

// Pedidos que ocupam o horário na agenda (recusados, cancelados e não realizados liberam).
// Dados de simulação nunca ocupam horário real.
const OCUPAM = "pendente,confirmado,avulso,realizado";

// Mantido pelo nome antigo, usado em outras rotas
const hojeEmBrasilia = () => hojeBr();

// Agenda confirmada do dia (ou null). Sem confirmação, o dia não aparece no site.
async function agendaConfirmada(profissionalId, dia) {
  const linhas = await rest(`agenda_dia?profissional_id=eq.${profissionalId}&dia=eq.${dia}&select=inicio,fim,almoco_inicio,almoco_fim,confirmada_em`);
  const a = linhas[0];
  return a && a.confirmada_em ? a : null;
}

// Livres e quantos pedidos o profissional já tem no dia (para dividir o trabalho na equipe)
async function disponibilidadeDoDia(profissionalId, dia, duracao, agora = Date.now()) {
  const dow = diaDaSemana(dia);
  const hoje = dia === hojeBr(agora);
  const [agenda, bloqueios, pedidos] = await Promise.all([
    agendaConfirmada(profissionalId, dia),
    rest(`bloqueios?profissional_id=eq.${profissionalId}&or=(and(tipo.eq.recorrente,dia_semana.eq.${dow}),and(tipo.eq.pontual,data.eq.${dia}))&select=inicio,fim`),
    rest(`pedidos?profissional_id=eq.${profissionalId}&dia=eq.${dia}&status=in.(${OCUPAM})&simulado=eq.false&select=horario,duracao_min`),
  ]);
  if (!agenda) return { livres: [], pedidos: pedidos.length, publicada: false };
  const bloq = bloqueios.map((b) => ({ inicio: b.inicio, fim: b.fim }));
  if (agenda.almoco_inicio && agenda.almoco_fim) bloq.push({ inicio: agenda.almoco_inicio, fim: agenda.almoco_fim });
  const livres = horariosLivres({
    duracaoMin: duracao,
    agoraMin: hoje ? agoraMinBr(agora) : -1,
    disponibilidade: [{ inicio: agenda.inicio, fim: agenda.fim }],
    bloqueios: bloq,
    ocupados: pedidos.map((p) => ({ inicio: p.horario, duracaoMin: p.duracao_min || 30 })),
  });
  return { livres, pedidos: pedidos.length, publicada: true };
}

async function horariosDoProfissional(profissionalId, dia, duracao) {
  return (await disponibilidadeDoDia(profissionalId, dia, duracao)).livres;
}

// "Qualquer barbeiro": dos livres naquele horário, escolhe quem tem menos pedidos no dia
async function escolherLivre(equipe, dia, duracao, horario) {
  const todos = await Promise.all(equipe.map(async (p) => ({ p, d: await disponibilidadeDoDia(p.id, dia, duracao) })));
  const livres = todos.filter((x) => x.d.livres.includes(horario));
  livres.sort((a, b) => a.d.pedidos - b.d.pedidos);
  return livres.length ? livres[0].p : null;
}

module.exports = { horariosDoProfissional, disponibilidadeDoDia, escolherLivre, agendaConfirmada, hojeEmBrasilia, OCUPAM };
