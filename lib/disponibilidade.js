// Horários livres de UM profissional num dia, lendo o banco. Usado pela consulta de horários
// e pela criação de pedido (quando o cliente não escolhe o barbeiro).
// Regra: o dia só fica disponível no site depois que o barbeiro confirma a agenda daquele dia.
const { rest } = require("./supabase");
const { horariosLivres, diaDaSemana } = require("./horarios");

// Dia de hoje e hora atual em Brasília (sem fuso, para comparar com a data do pedido)
function hojeEmBrasilia() {
  return new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
}
function agoraEmMinutos() {
  const br = new Date(Date.now() - 3 * 36e5);
  return br.getUTCHours() * 60 + br.getUTCMinutes();
}

// Agenda confirmada do dia (ou null). Sem confirmação, o dia não aparece no site.
async function agendaConfirmada(profissionalId, dia) {
  const linhas = await rest(`agenda_dia?profissional_id=eq.${profissionalId}&dia=eq.${dia}&select=inicio,fim,almoco_inicio,almoco_fim,confirmada_em`);
  const a = linhas[0];
  return a && a.confirmada_em ? a : null;
}

async function horariosDoProfissional(profissionalId, dia, duracao) {
  const dow = diaDaSemana(dia);
  const hoje = dia === hojeEmBrasilia();
  const [agenda, bloqueios, pedidos] = await Promise.all([
    agendaConfirmada(profissionalId, dia),
    rest(`bloqueios?profissional_id=eq.${profissionalId}&or=(and(tipo.eq.recorrente,dia_semana.eq.${dow}),and(tipo.eq.pontual,data.eq.${dia}))&select=inicio,fim`),
    rest(`pedidos?profissional_id=eq.${profissionalId}&dia=eq.${dia}&status=in.(pendente,confirmado,avulso)&select=horario,duracao_min`),
  ]);
  if (!agenda) return [];
  const bloq = bloqueios.map((b) => ({ inicio: b.inicio, fim: b.fim }));
  if (agenda.almoco_inicio && agenda.almoco_fim) bloq.push({ inicio: agenda.almoco_inicio, fim: agenda.almoco_fim });
  return horariosLivres({
    duracaoMin: duracao,
    agoraMin: hoje ? agoraEmMinutos() : -1,
    disponibilidade: [{ inicio: agenda.inicio, fim: agenda.fim }],
    bloqueios: bloq,
    ocupados: pedidos.map((p) => ({ inicio: p.horario, duracaoMin: p.duracao_min || 30 })),
  });
}

module.exports = { horariosDoProfissional, agendaConfirmada, hojeEmBrasilia };
