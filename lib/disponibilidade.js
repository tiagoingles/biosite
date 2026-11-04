// Horários livres de UM profissional num dia, lendo o banco. Usado pela consulta de horários
// e pela criação de pedido (quando o cliente não escolhe o barbeiro).
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

async function horariosDoProfissional(profissionalId, dia, duracao) {
  const dow = diaDaSemana(dia);
  const hoje = dia === hojeEmBrasilia();
  const [disponibilidade, bloqueios, pedidos] = await Promise.all([
    rest(`disponibilidade?profissional_id=eq.${profissionalId}&dia_semana=eq.${dow}&select=inicio,fim`),
    rest(`bloqueios?profissional_id=eq.${profissionalId}&or=(and(tipo.eq.recorrente,dia_semana.eq.${dow}),and(tipo.eq.pontual,data.eq.${dia}))&select=inicio,fim`),
    rest(`pedidos?profissional_id=eq.${profissionalId}&dia=eq.${dia}&status=in.(pendente,confirmado,avulso)&select=horario,duracao_min`),
  ]);
  return horariosLivres({
    duracaoMin: duracao,
    agoraMin: hoje ? agoraEmMinutos() : -1,
    disponibilidade: disponibilidade.map((d) => ({ inicio: d.inicio, fim: d.fim })),
    bloqueios: bloqueios.map((b) => ({ inicio: b.inicio, fim: b.fim })),
    ocupados: pedidos.map((p) => ({ inicio: p.horario, duracaoMin: p.duracao_min || 30 })),
  });
}

module.exports = { horariosDoProfissional, hojeEmBrasilia };
