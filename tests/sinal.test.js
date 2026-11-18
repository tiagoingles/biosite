// Sinal de pré-agendamento no Pix (fase 22): Pix copia e cola (BR Code), regras do dono, pedido aguardando
// sinal, "Recebi o sinal", cancelamento de quem não paga no prazo e o sinal de quem falta no Financeiro.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const A = require("./ajuda");
const Pix = require("../lib/pix");
const S = require("../lib/sinal");
const pedido = require("../api/pedido");
const eu = require("../api/eu");
const { calcularFinanceiro } = require("../lib/financeiro-calculo");

const { UUIDS } = A;
const DIA = A.daquiA(1);
const ler = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const CFG = { ativo: true, tipo: "fixo", valor: 10, prazoMin: 30, dias: [], servicos: [], tipoChave: "celular", chave: "+5581999998888", chaveDigitada: "(81) 99999-8888", nome: "GW Barbearia", cidade: "Recife" };

test("Pix copia e cola: CRC do exemplo do Banco Central e chave do jeito que o banco espera", () => {
  const exemplo = "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304";
  assert.equal(Pix.crc16(exemplo), "1D3D");
  assert.equal(Pix.normalizarChave("(81) 99999-8888", "celular"), "+5581999998888");
  assert.equal(Pix.normalizarChave("123.456.789-09", "cpf_cnpj"), "12345678909");
  assert.equal(Pix.normalizarChave("Dono@Barbearia.com", "email"), "dono@barbearia.com");
  assert.equal(Pix.normalizarChave("123", "cpf_cnpj"), "", "chave que não fecha com o tipo");
  const code = Pix.brCode({ chave: "+5581999998888", nome: "Barbearia São João", cidade: "Recife", valor: 10, txid: "AB23" });
  assert.match(code, /^000201/);
  assert.ok(code.includes("540510.00"), "valor de R$ 10,00");
  assert.ok(code.includes("BARBEARIA SAO JOAO"), "nome sem acento e em maiúsculas");
  assert.ok(code.includes("0504AB23"), "código do pedido como identificador");
  assert.equal(code.slice(-4), Pix.crc16(code.slice(0, -4)));
});

test("regras do dono: valor fixo ou % do serviço, só nos dias e serviços marcados; desligado não cobra", () => {
  assert.equal(S.valorDoSinal(CFG, { dia: "2026-11-17", servico: "Corte", preco: 40 }), 10);
  assert.equal(S.valorDoSinal({ ...CFG, tipo: "percentual", valor: 25 }, { dia: "2026-11-17", servico: "Corte", preco: 40 }), 10);
  assert.equal(S.valorDoSinal({ ...CFG, tipo: "percentual", valor: 25 }, { dia: "2026-11-17", servico: "Corte", preco: null }), 0, "sem preço, sem %");
  assert.equal(S.valorDoSinal({ ...CFG, dias: [5, 6] }, { dia: "2026-11-17", servico: "Corte", preco: 40 }), 0, "terça não está nos dias");
  assert.equal(S.valorDoSinal({ ...CFG, dias: [2] }, { dia: "2026-11-17", servico: "Corte", preco: 40 }), 10);
  assert.equal(S.valorDoSinal({ ...CFG, servicos: ["Prótese capilar"] }, { dia: "2026-11-17", servico: "Corte", preco: 40 }), 0);
  assert.equal(S.valorDoSinal({ ...CFG, ativo: false }, { dia: "2026-11-17", servico: "Corte", preco: 40 }), 0);
  assert.equal(S.lerConfig({ ...CFG, valor: "" }, { validar: true }).erro, "Informe o valor do sinal.");
  assert.match(S.lerConfig({ ...CFG, chave: "abc", tipoChave: "email" }, { validar: true }).erro, /chave Pix/);
  assert.match(S.lerConfig({ ...CFG, tipo: "percentual", valor: 150 }, { validar: true }).erro, /100%/);
});

function rotasSite(sinal, auto = false) {
  return [
    { padrao: /\/rest\/v1\/barbearias\?slug=eq\.gw-teste/, resposta: { corpo: [{ id: UUIDS.barbearia, confirmacao_automatica: auto, sinal }] } },
    { padrao: /\/rest\/v1\/profissionais\?barbearia_id=eq\./, resposta: { corpo: [{ id: UUIDS.bruno, nome: "Bruno" }] } },
    { padrao: /\/rest\/v1\/agenda_dia\?profissional_id=eq\./, resposta: { corpo: [{ inicio: "09:00:00", fim: "18:00:00", almoco_inicio: null, almoco_fim: null, confirmada_em: "2026-11-01T10:00:00Z" }] } },
    { padrao: /\/rest\/v1\/bloqueios\?/, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/pedidos\?profissional_id=eq\./, resposta: { corpo: [] } },
    { padrao: /\/rest\/v1\/servicos_precos\?barbearia_id=eq\./, resposta: { corpo: [{ preco: "40.00" }] } },
    { padrao: /\/rest\/v1\/rpc\/criar_pedido/, resposta: { corpo: { id: UUIDS.pedido } } },
    ...A.rotasDeConta(),
  ];
}
const pedir = () => A.chamar(pedido, { metodo: "POST", corpo: { slug: "gw-teste", servico: "Corte", profissionalId: UUIDS.bruno, profissional: "Bruno", dia: DIA, horario: "10:00", cliente: "Ana Paula", duracao: 30 } });

test("pedido com sinal: fica pendente (mesmo com confirmação automática) e o site recebe o Pix com o valor", async () => {
  const chamadas = A.instalarFetch(rotasSite(CFG, true));
  const r = await pedir();
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  const p = chamadas.find((c) => c.url.includes("criar_pedido")).corpo.p;
  assert.deepEqual([p.status, p.sinal_valor], ["pendente", 10], "espera o sinal antes de confirmar");
  assert.equal(r.body.confirmado, false);
  assert.equal(r.body.sinal.valor, 10);
  assert.equal(r.body.sinal.prazoMin, 30);
  assert.equal(r.body.sinal.chave, "(81) 99999-8888");
  assert.ok(r.body.sinal.copiaECola.includes("0504" + r.body.codigo), "Pix com o código do pedido");
  // Sem sinal configurado: segue a confirmação automática
  const sem = A.instalarFetch(rotasSite({}, true));
  const r2 = await pedir();
  assert.equal(r2.body.sinal, null);
  assert.equal(sem.find((c) => c.url.includes("criar_pedido")).corpo.p.status, "confirmado");
});

test("Recebi o sinal: só o dono; o pedido pendente fica confirmado; sem sinal aguardando não vale", async () => {
  const chamadas = A.instalarFetch([
    { metodo: "GET", padrao: /\/rest\/v1\/pedidos\?id=eq\./, resposta: (url) => ({ corpo: url.includes(UUIDS.pedido) ? [{ id: UUIDS.pedido, status: "pendente", sinal_status: "aguardando" }] : [{ id: UUIDS.estranho, status: "confirmado", sinal_status: "pago" }] }) },
    { metodo: "PATCH", padrao: /\/rest\/v1\/pedidos\?id=eq\./, resposta: (u, op, corpo) => ({ corpo: [{ id: UUIDS.pedido, ...corpo }] }) },
    ...A.rotasDeConta(),
  ]);
  let r = await A.chamar(pedido, { metodo: "POST", token: "token-dono", corpo: { acao: "sinal-pago", id: UUIDS.pedido } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const patch = chamadas.find((c) => c.metodo === "PATCH").corpo;
  assert.deepEqual([patch.sinal_status, patch.status], ["pago", "confirmado"]);
  r = await A.chamar(pedido, { metodo: "POST", token: "token-bruno", corpo: { acao: "sinal-pago", id: UUIDS.pedido } });
  assert.equal(r.statusCode, 403, "o Pix cai na conta do dono");
  r = await A.chamar(pedido, { metodo: "POST", token: "token-dono", corpo: { acao: "sinal-pago", id: UUIDS.estranho } });
  assert.equal(r.statusCode, 409);
});

test("relógio: pedido com sinal que passou do prazo é cancelado (o horário volta a ficar livre)", async () => {
  const velho = new Date(Date.now() - 45 * 60e3).toISOString();
  const novo = new Date(Date.now() - 15 * 60e3).toISOString();
  const chamadas = A.instalarFetch([
    { metodo: "GET", padrao: /\/rest\/v1\/pedidos\?sinal_status=eq\.aguardando/, resposta: { corpo: [{ id: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1", barbearia_id: UUIDS.barbearia, criado_em: velho }, { id: "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2", barbearia_id: UUIDS.barbearia, criado_em: novo }] } },
    { metodo: "GET", padrao: /\/rest\/v1\/barbearias\?id=in\./, resposta: { corpo: [{ id: UUIDS.barbearia, sinal: { ...CFG, prazoMin: 30 } }] } },
    { metodo: "PATCH", padrao: /\/rest\/v1\/pedidos\?id=eq\./, resposta: (url) => ({ corpo: [{ id: url }] }) },
  ]);
  assert.equal(await S.expirar(), 1);
  const patch = chamadas.find((c) => c.metodo === "PATCH");
  assert.ok(patch.url.includes("a1a1a1a1"), "só o que passou dos 30 min");
  assert.deepEqual(patch.corpo, { status: "cancelado", sinal_status: "expirado" });
  assert.match(patch.url, /sinal_status=eq\.aguardando&status=eq\.pendente/, "não cancela quem pagou no meio do caminho");
});

test("dono salva a configuração do sinal; inválida é recusada; barbeiro não muda", async () => {
  const chamadas = A.instalarFetch([{ metodo: "PATCH", padrao: /\/rest\/v1\/barbearias\?id=eq\./, resposta: { status: 204 } }, ...A.rotasDeConta()]);
  let r = await A.chamar(eu, { metodo: "POST", token: "token-dono", corpo: { acao: "config-barbearia", sinal: { ...CFG, chave: "(81) 99999-8888" } } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(chamadas.find((c) => c.metodo === "PATCH").corpo.sinal.chave, "+5581999998888");
  r = await A.chamar(eu, { metodo: "POST", token: "token-dono", corpo: { acao: "config-barbearia", sinal: { ...CFG, tipoChave: "" } } });
  assert.equal(r.statusCode, 400);
  r = await A.chamar(eu, { metodo: "POST", token: "token-bruno", corpo: { acao: "config-barbearia", sinal: CFG } });
  assert.equal(r.statusCode, 403);
});

test("financeiro: o sinal de quem não veio fica com a barbearia e entra no faturamento", () => {
  const hoje = "2026-11-17";
  const f = calcularFinanceiro(hoje, { pedidos: [
    { dia: hoje, status: "nao_realizado", valor: 40, sinal_valor: "10.00", sinal_status: "pago" },
    { dia: hoje, status: "nao_realizado", valor: 40, sinal_valor: null, sinal_status: null },
    { dia: hoje, status: "realizado", valor: 40, comissao_pct: 0, sinal_valor: "10.00", sinal_status: "pago" },
  ] });
  assert.equal(f.resumo.dia.sinaisFaltas, 10);
  assert.equal(f.resumo.dia.entradas, 50, "atendimento realizado (com o sinal dentro) + sinal de quem faltou");
});

test("telas: Falta o sinal no site (copia e cola, QR, já paguei), Recebi o sinal na agenda e o cartão em Mais", () => {
  const site = ler("gw-barbearia.html");
  assert.match(site, /Falta o sinal/);
  assert.match(site, /data-ag="pix-copiar"/);
  assert.match(site, /s\.src="\/qr\.js"/);
  assert.match(site, /Já paguei: avisar a barbearia/);
  assert.match(ler("painel-agenda.js"), /"Recebi o sinal"/);
  const dono = ler("painel-dono.html");
  assert.match(dono, /id="secSinal"/);
  assert.match(dono, /Cobrar sinal para agendar pelo site/);
});
