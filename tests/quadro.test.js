// Agenda em quadro (painel-quadro.js): horas do quadro, faixas fora do atendimento (almoço, bloqueios), os
// bloqueios do dia vindo junto com o painel e a ligação nos dois painéis (Quadro | Lista, arrastar, atrasar).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const A = require("./ajuda");
const pedido = require("../api/pedido");

const { UUIDS } = A;
const ler = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
// Objetos criados dentro do vm têm outro protótipo: compara pelo conteúdo
const igual = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, m);

// O componente roda no navegador; aqui só as contas (sem tela)
function quadro() {
  const ctx = { window: { Painel: { h: () => ({}) } }, localStorage: { getItem: () => null, setItem: () => {} }, navigator: {}, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} };
  vm.runInNewContext(ler("painel-quadro.js"), ctx);
  return ctx.window.Quadro;
}

test("quadro: horas do primeiro início ao último fim (horas cheias); sem agenda nem horário, 8h às 20h", () => {
  const Q = quadro()._;
  const colunas = [{ agenda: { publicada: true, inicio: "09:30", fim: "18:00" } }, { agenda: null }];
  igual(Q.faixa(colunas, [{ horario: "19:10", duracao_min: 40 }]), { ini: 9 * 60, fim: 20 * 60 });
  igual(Q.faixa([{ agenda: null }], []), { ini: 8 * 60, fim: 20 * 60 });
  igual(Q.faixa([{ agenda: null }], [{ horario: "07:45", duracao_min: 30 }]), { ini: 7 * 60, fim: 9 * 60 });
  assert.equal(Q.hm(14 * 60 + 5), "14:05");
  assert.equal(Q.min("09:30:00"), 570);
});

test("quadro: antes e depois do expediente, almoço e bloqueios ficam marcados", () => {
  const Q = quadro()._;
  const f = { ini: 8 * 60, fim: 20 * 60 };
  const s = Q.sombras({ agenda: { publicada: true, inicio: "09:00", fim: "18:00", almocoInicio: "12:00", almocoFim: "13:00" }, bloqueios: [{ inicio: "16:00", fim: "16:30", motivo: "Dentista" }] }, f);
  igual(s.map((x) => [x.de, x.ate, x.texto]), [[480, 540, ""], [1080, 1200, ""], [720, 780, "Almoço"], [960, 990, "Dentista"]]);
  // Agenda não publicada: o dia todo fica livre no quadro (o dono pode encaixar)
  igual(Q.sombras({ agenda: { publicada: false, inicio: "09:00", fim: "18:00" } }, f), []);
});

test("painel do dia: traz os bloqueios do dia de cada barbeiro (do dia e os semanais)", async () => {
  const dia = A.daquiA(1);
  const chamadas = A.instalarFetch([
    ...A.rotasDeConta(),
    { padrao: /\/rest\/v1\/bloqueios\?tipo=eq\.pontual/, resposta: { corpo: [{ profissional_id: UUIDS.bruno, inicio: "16:00:00", fim: "16:30:00", motivo: "Dentista" }] } },
    { padrao: /\/rest\/v1\/bloqueios\?tipo=eq\.recorrente/, resposta: { corpo: [{ profissional_id: UUIDS.bruno, inicio: "08:00:00", fim: "09:00:00", motivo: null }] } },
    { padrao: /\/rest\/v1\/pedidos\?/, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/profissionais\?barbearia_id=eq\./, resposta: { corpo: [{ id: UUIDS.bruno, nome: "Bruno", foto_url: null, perfil_user_id: null, comissao_pct: 40 }, { id: UUIDS.rafael, nome: "Rafael", foto_url: null, perfil_user_id: null, comissao_pct: 40 }] } },
    { padrao: /\/rest\/v1\/agenda_dia\?dia=eq\./, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/servicos_precos\?/, resposta: { corpo: [] } },
  ]);
  const r = await A.chamar(pedido, { query: { painel: "1", dia }, token: "token-dono" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const bruno = r.body.equipe.find((e) => e.id === UUIDS.bruno);
  const rafael = r.body.equipe.find((e) => e.id === UUIDS.rafael);
  assert.deepEqual(bruno.bloqueios, [{ inicio: "16:00", fim: "16:30", motivo: "Dentista" }, { inicio: "08:00", fim: "09:00", motivo: "" }]);
  assert.deepEqual(rafael.bloqueios, []);
  const busca = chamadas.find((c) => c.url.includes("bloqueios?tipo=eq.pontual"));
  assert.ok(busca.url.includes(`data=eq.${dia}`) && busca.url.includes(`profissionais.barbearia_id=eq.${UUIDS.barbearia}`), "só desta barbearia e deste dia");
});

test("quadro nos dois painéis: Quadro | Lista, arrastar com confirmação e aviso, atrasar os próximos", () => {
  const q = ler("painel-quadro.js");
  assert.match(q, /acao: "remarcar", id: p\.id, dia: p\.dia, horario: para, duracao: duracao\(p\), avisar: avisar\.checked/);
  assert.match(q, /acao: "atrasar", profissionalId: c\.id/);
  assert.match(q, /addEventListener\("touchmove", function \(e\) \{ if \(estado && estado\.ativo\) e\.preventDefault\(\); \}, \{ passive: false \}\)/, "no celular, a tela não rola durante o arraste");
  assert.match(q, /setTimeout\(function \(\) \{ ativar\(\); \}, 380\)/, "no toque, o arraste começa depois de segurar");
  assert.match(q, /if \(arraste\) return;/, "a atualização automática não desmancha um arraste");
  for (const arq of ["painel-dono.html", "painel-barbeiro.html"]) {
    const t = ler(arq);
    assert.match(t, /<script src="\/painel-quadro\.js"><\/script>/, arq);
    assert.match(t, /id="modoAgenda"/, arq);
    assert.match(t, /id="quadroDia"/, arq);
    assert.match(t, /window\.Quadro\.desenhar\(\$\("quadroDia"\)/, arq);
  }
  assert.match(ler("painel-dono.html"), /mudarColuna: true/, "o dono passa o horário para outro barbeiro");
  assert.doesNotMatch(ler("painel-barbeiro.html"), /mudarColuna: true/, "o barbeiro só mexe na própria coluna");
});
