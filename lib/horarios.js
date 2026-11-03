// Horários livres de um profissional num dia. Função pura, sem banco: quem chama lê as tabelas.
// Horários são minutos desde 00:00. A data é só o dia (YYYY-MM-DD), sem fuso.

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

// Dois intervalos [a, b) e [c, d) se sobrepõem?
function sobrepoe(a, b, c, d) {
  return a < d && c < b;
}

/*
  entrada:
    dia           "2026-11-04"
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

module.exports = { horariosLivres, minutos, hora, diaDaSemana };
