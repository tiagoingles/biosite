// Horários livres de um profissional num dia e funções de data. Funções puras, sem banco:
// quem chama lê as tabelas. Horários são minutos desde 00:00. A data é só o dia (YYYY-MM-DD), sem fuso.
// Fuso: Brasília (UTC-3, sem horário de verão desde 2019).

const FUSO_MS = 3 * 36e5;

// "09:30" ou "09:30:00" -> 570
function minutos(hora) {
  const [h, m] = String(hora).split(":").map(Number);
  return h * 60 + m;
}

// 570 -> "09:30"
function hora(min) {
  return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
}

// Dia da semana de uma data YYYY-MM-DD (0 = domingo)
function diaDaSemana(dia) {
  return new Date(dia + "T00:00:00Z").getUTCDay();
}

// Hoje em Brasília (YYYY-MM-DD) e o minuto atual do dia
function hojeBr(agora = Date.now()) {
  return new Date(agora - FUSO_MS).toISOString().slice(0, 10);
}
function agoraMinBr(agora = Date.now()) {
  const br = new Date(agora - FUSO_MS);
  return br.getUTCHours() * 60 + br.getUTCMinutes();
}

function somaDias(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Data que existe de verdade no calendário (recusa 2026-02-30 e 2026-13-01)
function dataValida(s) {
  s = String(s == null ? "" : s);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Hora HH:MM entre 00:00 e 23:59
function horaValida(s) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(s == null ? "" : s));
  return !!m && Number(m[1]) < 24 && Number(m[2]) < 60;
}

// Dois intervalos [a, b) e [c, d) se sobrepõem?
function sobrepoe(a, b, c, d) {
  return a < d && c < b;
}

/*
  entrada:
    duracaoMin    tamanho do serviço em minutos
    passo         de quanto em quanto o horário começa (padrão 15)
    agoraMin      se for hoje, horários antes deste minuto são descartados
    disponibilidade  [{ inicio: "09:00", fim: "18:00" }]  já filtrada pelo dia da semana
    bloqueios        [{ inicio, fim }]  intervalos bloqueados (intervalos, folgas, bloqueio pontual)
    ocupados         [{ inicio: "10:00", duracaoMin: 30 }]  pedidos ativos no dia
  saída: ["09:00", "09:15", ...]
*/
function horariosLivres({ duracaoMin, passo = 15, agoraMin = -1, disponibilidade = [], bloqueios = [], ocupados = [] }) {
  const livres = [];
  const bloq = bloqueios.map((b) => [minutos(b.inicio), minutos(b.fim)]);
  const ocup = ocupados.map((o) => [minutos(o.inicio), minutos(o.inicio) + Number(o.duracaoMin)]);
  for (const janela of disponibilidade) {
    const ini = minutos(janela.inicio);
    const fim = minutos(janela.fim);
    for (let t = ini; t + duracaoMin <= fim; t += passo) {
      if (t < agoraMin) continue;
      const te = t + duracaoMin;
      if (bloq.some(([b1, b2]) => sobrepoe(t, te, b1, b2))) continue;
      if (ocup.some(([o1, o2]) => sobrepoe(t, te, o1, o2))) continue;
      livres.push(hora(t));
    }
  }
  return livres;
}

// Minutos de trabalho de uma agenda do dia (expediente menos almoço)
function minutosDeTrabalho(agenda) {
  if (!agenda || !agenda.inicio || !agenda.fim) return 0;
  let total = minutos(agenda.fim) - minutos(agenda.inicio);
  if (agenda.almoco_inicio && agenda.almoco_fim) total -= minutos(agenda.almoco_fim) - minutos(agenda.almoco_inicio);
  return Math.max(0, total);
}

module.exports = { horariosLivres, minutos, hora, diaDaSemana, hojeBr, agoraMinBr, somaDias, dataValida, horaValida, sobrepoe, minutosDeTrabalho };
