// Horários livres de UM profissional num dia, lendo o banco. Usado pela consulta de horários
// e pela criação de pedido. Regra: o dia só fica disponível no site depois que o barbeiro
// (ou o dono, para quem não tem login) confirma a agenda daquele dia.
const { rest } = require("./supabase");
const { horariosLivres, diaDaSemana, hojeBr, agoraMinBr, minutos, hora, sobrepoe } = require("./horarios");

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

// O dia de um profissional: agenda publicada, bloqueios (com o almoço) e os pedidos que ocupam horário
async function dadosDoDia(profissionalId, dia) {
  const dow = diaDaSemana(dia);
  const [agenda, bloqueios, pedidos] = await Promise.all([
    agendaConfirmada(profissionalId, dia),
    rest(`bloqueios?profissional_id=eq.${profissionalId}&or=(and(tipo.eq.recorrente,dia_semana.eq.${dow}),and(tipo.eq.pontual,data.eq.${dia}))&select=inicio,fim`),
    rest(`pedidos?profissional_id=eq.${profissionalId}&dia=eq.${dia}&status=in.(${OCUPAM})&simulado=eq.false&select=horario,duracao_min`),
  ]);
  if (!agenda) return { publicada: false, pedidos: pedidos.length };
  const bloq = bloqueios.map((b) => ({ inicio: b.inicio, fim: b.fim }));
  if (agenda.almoco_inicio && agenda.almoco_fim) bloq.push({ inicio: agenda.almoco_inicio, fim: agenda.almoco_fim });
  return { publicada: true, agenda, bloqueios: bloq, ocupados: pedidos.map((p) => ({ inicio: p.horario, duracaoMin: p.duracao_min || 30 })), pedidos: pedidos.length };
}

// Livres e quantos pedidos o profissional já tem no dia (para dividir o trabalho na equipe)
async function disponibilidadeDoDia(profissionalId, dia, duracao, agora = Date.now()) {
  const d = await dadosDoDia(profissionalId, dia);
  if (!d.publicada) return { livres: [], pedidos: d.pedidos, publicada: false };
  const hoje = dia === hojeBr(agora);
  const livres = horariosLivres({
    duracaoMin: duracao,
    agoraMin: hoje ? agoraMinBr(agora) : -1,
    disponibilidade: [{ inicio: d.agenda.inicio, fim: d.agenda.fim }],
    bloqueios: d.bloqueios,
    ocupados: d.ocupados,
  });
  return { livres, pedidos: d.pedidos, publicada: true };
}

// ---------- vários serviços de uma vez (fase 38) ----------
const PASSO = 15; // grade dos horários de início, como nos horários livres
const ESPERA_MAX = 30; // "horários próximos": até 30 min entre um serviço e o próximo

// Cabe um serviço de "duracao" minutos começando em "ini" (minutos do dia) no dia deste profissional?
function cabe(d, ini, duracao, agoraMin = -1) {
  if (!d || !d.publicada) return false;
  const fim = ini + duracao;
  if (ini < agoraMin || ini < minutos(d.agenda.inicio) || fim > minutos(d.agenda.fim)) return false;
  if (d.bloqueios.some((b) => sobrepoe(ini, fim, minutos(b.inicio), minutos(b.fim)))) return false;
  return !d.ocupados.some((o) => sobrepoe(ini, fim, minutos(o.inicio), minutos(o.inicio) + Number(o.duracaoMin)));
}

// Todos no mesmo horário, cada serviço com um barbeiro diferente (tentativa e erro: são poucos)
function planoJunto(lista, duracoes, t, agoraMin) {
  const usados = [];
  const tenta = (i) => {
    if (i === duracoes.length) return true;
    for (const b of lista) {
      if (usados.includes(b) || !cabe(b.dados, t, duracoes[i], agoraMin)) continue;
      usados.push(b);
      if (tenta(i + 1)) return true;
      usados.pop();
    }
    return false;
  };
  return tenta(0) ? usados.map((b, i) => ({ id: b.id, nome: b.nome, horario: hora(t), duracao: duracoes[i] })) : null;
}

// Um depois do outro: o próximo começa quando o anterior acaba (ou até 30 min depois, de 5 em 5),
// de preferência com o mesmo barbeiro do anterior
function planoSeguido(lista, duracoes, t, agoraMin) {
  const itens = [];
  let livreEm = t;
  for (let i = 0; i < duracoes.length; i++) {
    const d = duracoes[i];
    const anterior = itens.length ? itens[itens.length - 1].b : null;
    const ordem = anterior ? [anterior].concat(lista.filter((b) => b !== anterior)) : lista;
    const tentativas = i === 0 ? [t] : Array.from({ length: ESPERA_MAX / 5 + 1 }, (_, k) => livreEm + k * 5);
    let achou = null;
    for (const x of tentativas) {
      const b = ordem.find((p) => cabe(p.dados, x, d, agoraMin) && !itens.some((it) => it.b === p && x < it.fim && it.ini < x + d));
      if (b) {
        achou = { b, ini: x, fim: x + d };
        break;
      }
    }
    if (!achou) return null;
    itens.push(achou);
    livreEm = achou.fim;
  }
  return itens.map((it, i) => ({ id: it.b.id, nome: it.b.nome, horario: hora(it.ini), duracao: duracoes[i] }));
}

// Planos do dia para vários serviços: para cada horário de início, quem faz cada serviço e a que horas.
// barbeiros: [{ id, nome, dados }] (dados de dadosDoDia), na ordem de preferência (quem tem menos pedidos antes).
// modo "junto": no mesmo horário, com barbeiros diferentes; "seguido": um depois do outro.
function planosDoDia({ barbeiros, duracoes, modo, agoraMin = -1, limite = 48 }) {
  const lista = barbeiros.filter((b) => b.dados && b.dados.publicada);
  if (!lista.length || !duracoes.length) return [];
  const inicios = new Set();
  lista.forEach((b) => {
    for (let t = minutos(b.dados.agenda.inicio); t + duracoes[0] <= minutos(b.dados.agenda.fim); t += PASSO) inicios.add(t);
  });
  const planos = [];
  for (const t of [...inicios].sort((a, b) => a - b)) {
    const itens = modo === "junto" ? planoJunto(lista, duracoes, t, agoraMin) : planoSeguido(lista, duracoes, t, agoraMin);
    if (!itens) continue;
    const fim = Math.max(...itens.map((x) => minutos(x.horario) + x.duracao));
    planos.push({ horario: hora(t), fim: hora(fim), itens });
    if (planos.length >= limite) break;
  }
  return planos;
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

module.exports = { horariosDoProfissional, disponibilidadeDoDia, escolherLivre, agendaConfirmada, hojeEmBrasilia, OCUPAM, dadosDoDia, cabe, planosDoDia };
