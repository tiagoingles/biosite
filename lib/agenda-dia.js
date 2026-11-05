// Agenda do dia de um profissional: expediente e almoço de cada dia, publicados no site só depois
// de confirmados, e bloqueios pontuais (horário travado para encaixe, consulta, folga de algumas horas).
// Usado pelo barbeiro (a própria agenda, em api/eu.js) e pelo dono (qualquer barbeiro da equipe,
// em api/equipe.js), inclusive para quem não tem login.
const { rest } = require("./supabase");
const { texto } = require("./agenda");
const { diaDaSemana, dataValida, horaValida, hojeBr, somaDias, minutos } = require("./horarios");
const { erroPublico, UUID } = require("./seguranca");

const cortaHora = (t) => (t ? String(t).slice(0, 5) : null);
const DIAS_SEMANA_MAX = 14;

function formatar(linha) {
  return linha
    ? { inicio: cortaHora(linha.inicio), fim: cortaHora(linha.fim), almocoInicio: cortaHora(linha.almoco_inicio), almocoFim: cortaHora(linha.almoco_fim), confirmadaEm: linha.confirmada_em }
    : null;
}

// Padrão da semana (disponibilidade e almoço recorrente) para um dia da semana
function padraoDo(dow, jornadas, almocos) {
  const j = jornadas.find((x) => x.dia_semana === dow);
  const a = almocos.find((x) => x.dia_semana === dow);
  return {
    inicio: j ? cortaHora(j.inicio) : "09:00",
    fim: j ? cortaHora(j.fim) : "18:00",
    almocoInicio: a ? cortaHora(a.inicio) : "",
    almocoFim: a ? cortaHora(a.fim) : "",
    trabalha: jornadas.length ? !!j : true,
  };
}

async function lerPadroes(profissionalId) {
  const [jornadas, almocos] = await Promise.all([
    rest(`disponibilidade?profissional_id=eq.${profissionalId}&select=dia_semana,inicio,fim&order=inicio.asc`),
    rest(`bloqueios?profissional_id=eq.${profissionalId}&tipo=eq.recorrente&select=dia_semana,inicio,fim&order=inicio.asc`),
  ]);
  return { jornadas, almocos };
}

// Um dia: o que está salvo e o padrão da semana
async function agendaDoDia(profissionalId, dia) {
  const [[linha], padroes] = await Promise.all([
    rest(`agenda_dia?profissional_id=eq.${profissionalId}&dia=eq.${dia}&select=inicio,fim,almoco_inicio,almoco_fim,confirmada_em`),
    lerPadroes(profissionalId),
  ]);
  const p = padraoDo(diaDaSemana(dia), padroes.jornadas, padroes.almocos);
  return { dia, agenda: formatar(linha), padrao: { inicio: p.inicio, fim: p.fim, almocoInicio: p.almocoInicio, almocoFim: p.almocoFim } };
}

// Vários dias seguidos (para publicar a semana de uma vez)
async function agendaDaSemana(profissionalId, de, n = 7) {
  n = Math.max(1, Math.min(DIAS_SEMANA_MAX, Number(n) || 7));
  const ate = somaDias(de, n - 1);
  const [linhas, padroes, bloqueios] = await Promise.all([
    rest(`agenda_dia?profissional_id=eq.${profissionalId}&dia=gte.${de}&dia=lte.${ate}&select=dia,inicio,fim,almoco_inicio,almoco_fim,confirmada_em`),
    lerPadroes(profissionalId),
    rest(`bloqueios?profissional_id=eq.${profissionalId}&tipo=eq.pontual&data=gte.${de}&data=lte.${ate}&select=id,data,inicio,fim,motivo&order=data.asc,inicio.asc`),
  ]);
  const porDia = new Map(linhas.map((l) => [l.dia, l]));
  const dias = [];
  for (let i = 0; i < n; i++) {
    const dia = somaDias(de, i);
    const p = padraoDo(diaDaSemana(dia), padroes.jornadas, padroes.almocos);
    dias.push({
      dia,
      agenda: formatar(porDia.get(dia)),
      padrao: p,
      bloqueios: bloqueios.filter((b) => b.data === dia).map((b) => ({ id: b.id, inicio: cortaHora(b.inicio), fim: cortaHora(b.fim), motivo: b.motivo })),
    });
  }
  return { de, ate, dias };
}

// Valida um dia de agenda vindo da tela
function validarDia(d) {
  const dia = String(d.dia || "");
  const inicio = String(d.inicio || "");
  const fim = String(d.fim || "");
  const almocoInicio = String(d.almocoInicio || "");
  const almocoFim = String(d.almocoFim || "");
  if (!dataValida(dia)) throw erroPublico(400, "Data inválida.");
  if (dia < hojeBr()) throw erroPublico(400, "Não dá para mudar a agenda de um dia que já passou.");
  if (dia > somaDias(hojeBr(), 90)) throw erroPublico(400, "Publique a agenda até 90 dias à frente.");
  if (!horaValida(inicio) || !horaValida(fim) || minutos(fim) <= minutos(inicio)) throw erroPublico(400, "Informe o horário de início e de fim do expediente.");
  const temAlmoco = almocoInicio !== "" || almocoFim !== "";
  if (temAlmoco && (!horaValida(almocoInicio) || !horaValida(almocoFim) || minutos(almocoFim) <= minutos(almocoInicio) || minutos(almocoInicio) < minutos(inicio) || minutos(almocoFim) > minutos(fim))) {
    throw erroPublico(400, `O horário de almoço precisa estar dentro do expediente (${dia.split("-").reverse().join("/")}).`);
  }
  return { dia, inicio, fim, almocoInicio: temAlmoco ? almocoInicio : null, almocoFim: temAlmoco ? almocoFim : null };
}

// Salva um dia. confirmar = publica no site. folga = tira o dia do site (sem apagar nada).
async function salvarDia(profissionalId, d, confirmar) {
  if (d.folga === true) {
    const dia = String(d.dia || "");
    if (!dataValida(dia) || dia < hojeBr()) throw erroPublico(400, "Data inválida.");
    await rest(`agenda_dia?profissional_id=eq.${profissionalId}&dia=eq.${dia}`, {
      metodo: "PATCH",
      prefer: "return=minimal",
      corpo: { confirmada_em: null, atualizada_em: new Date().toISOString() },
    });
    return;
  }
  const v = validarDia(d);
  await rest("agenda_dia?on_conflict=profissional_id,dia", {
    metodo: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    corpo: {
      profissional_id: profissionalId,
      dia: v.dia,
      inicio: v.inicio,
      fim: v.fim,
      almoco_inicio: v.almocoInicio,
      almoco_fim: v.almocoFim,
      confirmada_em: confirmar ? new Date().toISOString() : null,
      atualizada_em: new Date().toISOString(),
    },
  });
}

async function salvarSemana(profissionalId, dias, confirmar) {
  if (!Array.isArray(dias) || !dias.length || dias.length > DIAS_SEMANA_MAX) throw erroPublico(400, "Envie de 1 a 14 dias.");
  // Valida tudo antes de gravar qualquer dia
  dias.forEach((d) => { if (d.folga !== true) validarDia(d); });
  for (const d of dias) await salvarDia(profissionalId, d, confirmar);
}

// Bloqueio pontual: trava um intervalo num dia (o site deixa de oferecer esses horários)
async function criarBloqueio(profissionalId, b) {
  const dia = String(b.dia || "");
  const inicio = String(b.inicio || "");
  const fim = String(b.fim || "");
  if (!dataValida(dia) || dia < hojeBr()) throw erroPublico(400, "Escolha hoje ou um dia futuro.");
  if (!horaValida(inicio) || !horaValida(fim) || minutos(fim) <= minutos(inicio)) throw erroPublico(400, "Informe o início e o fim do bloqueio.");
  const [criado] = await rest("bloqueios", {
    metodo: "POST",
    prefer: "return=representation",
    corpo: { profissional_id: profissionalId, tipo: "pontual", data: dia, inicio, fim, motivo: texto(b.motivo, 80) },
  });
  return { id: criado.id, dia, inicio, fim, motivo: criado.motivo };
}

async function removerBloqueio(profissionalId, id) {
  if (!UUID.test(String(id || ""))) throw erroPublico(400, "Bloqueio inválido.");
  await rest(`bloqueios?id=eq.${id}&profissional_id=eq.${profissionalId}&tipo=eq.pontual`, { metodo: "DELETE", prefer: "return=minimal" });
}

module.exports = { agendaDoDia, agendaDaSemana, salvarDia, salvarSemana, criarBloqueio, removerBloqueio, validarDia };
