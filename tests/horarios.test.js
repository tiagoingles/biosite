// Regras de horário e data (funções puras)
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../lib/horarios");
const { valorDoTexto } = require("../lib/precos");
const { codigoNovo, texto } = require("../lib/agenda");

test("datas reais: recusa dia inexistente e formatos errados", () => {
  assert.equal(H.dataValida("2026-11-05"), true);
  assert.equal(H.dataValida("2028-02-29"), true);
  assert.equal(H.dataValida("2026-02-29"), false);
  assert.equal(H.dataValida("2026-02-30"), false);
  assert.equal(H.dataValida("2026-13-01"), false);
  assert.equal(H.dataValida("2026-1-5"), false);
  assert.equal(H.dataValida("2026-11-05T00:00"), false);
  assert.equal(H.dataValida(null), false);
  assert.equal(H.dataValida("2026-11-05' or 1=1"), false);
});

test("horas válidas: 00:00 a 23:59", () => {
  assert.equal(H.horaValida("09:30"), true);
  assert.equal(H.horaValida("23:59"), true);
  assert.equal(H.horaValida("24:00"), false);
  assert.equal(H.horaValida("12:60"), false);
  assert.equal(H.horaValida("9:30"), false);
  assert.equal(H.horaValida("09:30:00"), false);
});

test("fuso de Brasília: hoje e minuto do dia", () => {
  const t = Date.parse("2026-11-05T02:30:00Z"); // 23:30 do dia 4 em Brasília
  assert.equal(H.hojeBr(t), "2026-11-04");
  assert.equal(H.agoraMinBr(t), 23 * 60 + 30);
  assert.equal(H.somaDias("2026-12-31", 1), "2027-01-01");
  assert.equal(H.somaDias("2026-03-01", -1), "2026-02-28");
  assert.equal(H.diaDaSemana("2026-11-05"), 4); // quinta
});

test("horários livres: expediente, almoço, bloqueios e pedidos", () => {
  const livres = H.horariosLivres({
    duracaoMin: 30,
    disponibilidade: [{ inicio: "09:00", fim: "12:00" }],
    bloqueios: [{ inicio: "10:00", fim: "10:30" }],
    ocupados: [{ inicio: "11:00", duracaoMin: 40 }],
  });
  assert.ok(livres.includes("09:00"));
  assert.ok(livres.includes("09:30"));
  assert.ok(!livres.includes("09:45"), "09:45 + 30 invade o bloqueio das 10:00");
  assert.ok(!livres.includes("10:00"));
  assert.ok(livres.includes("10:30"));
  assert.ok(!livres.includes("10:45"), "10:45 + 30 invade o pedido das 11:00");
  assert.ok(!livres.includes("11:30"), "11:30 está dentro do pedido das 11:00-11:40");
  assert.ok(!livres.includes("11:45"), "11:45 + 30 passa do fim do expediente");
});

test("horários livres: hoje não oferece horário que já passou", () => {
  const livres = H.horariosLivres({ duracaoMin: 30, agoraMin: 10 * 60 + 5, disponibilidade: [{ inicio: "09:00", fim: "11:00" }] });
  assert.deepEqual(livres, ["10:15", "10:30"]);
});

test("minutos de trabalho: expediente menos almoço", () => {
  assert.equal(H.minutosDeTrabalho({ inicio: "09:00", fim: "18:00", almoco_inicio: "12:00", almoco_fim: "13:00" }), 480);
  assert.equal(H.minutosDeTrabalho({ inicio: "09:00", fim: "12:00" }), 180);
  assert.equal(H.minutosDeTrabalho(null), 0);
});

test("preço do texto do site", () => {
  assert.equal(valorDoTexto("45,00"), 45);
  assert.equal(valorDoTexto("R$ 1.250,90"), 1250.9);
  assert.equal(valorDoTexto("35"), 35);
  assert.equal(valorDoTexto("Consultar"), null);
  assert.equal(valorDoTexto(""), null);
  assert.equal(valorDoTexto("999999,00"), null, "acima do limite");
});

test("código do pedido: sem letras parecidas e com o tamanho pedido", () => {
  for (let i = 0; i < 500; i++) {
    const c = codigoNovo();
    assert.match(c, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
  }
  assert.equal(codigoNovo(5).length, 5);
});

test("texto limpo: tira caracteres de controle e corta no tamanho", () => {
  assert.equal(texto("  Ana\u0000\u001f Paula  ", 80), "Ana   Paula");
  assert.ok(!/[\u0000-\u001f]/.test(texto("a\nb\tc\r", 80)), "quebra de linha e tab viram espaço");
  assert.equal(texto("x".repeat(100), 10), "x".repeat(10));
  assert.equal(texto(null, 10), "");
});
