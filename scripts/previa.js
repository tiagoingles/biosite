// Prévia local dos painéis com dados fictícios (não fala com o banco nem com o GitHub).
// Uso: node scripts/previa.js [porta]   e abra http://localhost:4321/previa
// A página /previa grava uma sessão falsa no navegador e oferece os links do painel do dono e do barbeiro.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { calcularFinanceiro } = require("../lib/financeiro-calculo");
const { vencimento } = require("../lib/clube");
const CL = require("../lib/clientes");
const AUTO = require("../lib/automacoes");

const PORTA = Number(process.argv[2] || 4321);
const RAIZ = path.join(__dirname, "..");
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };

const hoje = new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
const somaDias = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let papel = "dono";
let googleAtivo = false; // como em produção: login com Google desligado no Supabase (/__google?ativo=1 liga)
let seq = 1;
// Confirmação de presença da prévia (/barbearia-modelo?confirmar=<id>.<assinatura>)
const presencaPrev = { status: "confirmado", resposta: "" };
const P = (extra) => ({ id: "p" + seq++, codigo: "K" + (100 + seq), servico: "Corte degradê", profissional: "Bruno", profissional_id: "b1", dia: hoje, horario: "10:00", horario_fim: "10:40", duracao_min: 40, cliente: "Carlos Souza", observacao: "", status: "confirmado", motivo: null, valor: 40, comissao_pct: null, simulado: false, ...extra });
let pedidos = [
  P({ horario: "09:00", horario_fim: "09:30", duracao_min: 30, servico: "Corte social", cliente: "João Pedro", status: "realizado", valor: 35, comissao_pct: 40 }),
  P({ horario: "10:00", cliente: "Carlos Souza", status: "confirmado", cliente_id: "c9", clientes: { nome: "Carlos Souza", telefone: "81999990009" } }),
  P({ horario: "11:30", horario_fim: "12:20", duracao_min: 50, servico: "Corte + barba", cliente: "Rafael Lima", status: "avulso", valor: 60, profissional: "Rafael", profissional_id: "b2" }),
  P({ horario: "14:00", horario_fim: "14:30", duracao_min: 30, servico: "Barba tradicional", cliente: "Marcos Vinícius", status: "pendente", valor: 25, observacao: "Prefiro máquina 2 nas laterais" }),
  P({ dia: somaDias(hoje, 1), horario: "16:00", horario_fim: "16:30", duracao_min: 30, servico: "Corte social", cliente: "André Costa", status: "pendente", valor: 35, profissional: "Rafael", profissional_id: "b2" }),
  P({ horario: "15:00", cliente: "Lucas Almeida", status: "recusado" }),
  P({ dia: somaDias(hoje, -1), horario: "17:00", horario_fim: "17:30", duracao_min: 30, cliente: "Diego Ramos", status: "confirmado", valor: 35 }),
  // Assinante do clube: não paga no balcão, comissão fixa
  P({ horario: "16:30", horario_fim: "17:10", cliente: "Pedrinho", status: "confirmado", valor: 0, comissao_valor: 15, clube_assinante_id: "a1", clube_assinantes: { nome: "Pedro Henrique" } }),
  P({ dia: somaDias(hoje, 1), horario: "10:00", cliente: "Mateus Silva", status: "confirmado", cliente_id: "c13", clientes: { nome: "Mateus Silva", telefone: "81999990013" } }),
  P({ dia: somaDias(hoje, 2), horario: "15:30", horario_fim: "16:00", duracao_min: 30, servico: "Corte social", cliente: "João Pedro", status: "confirmado", valor: 35, cliente_id: "c8", clientes: { nome: "João Pedro", telefone: "81999990008" } }),
  P({ dia: somaDias(hoje, 3), horario: "18:00", cliente: "Vinícius Rocha", status: "confirmado", profissional: "Rafael", profissional_id: "b2", cliente_id: "c14", clientes: { nome: "Vinícius Rocha", telefone: "81999990014" } }),
];

// Clube de assinatura (prévia): planos, assinantes e uso
let clubePlanos = [
  { id: "pl1", nome: "Corte ilimitado", descricao: "Cabelo sempre em dia, sem pagar a cada corte", preco: 99.9, servicos: ["Corte degradê", "Corte social"], intervalo_dias: 7, dias_semana: [1, 2, 3, 4], hora_limite: "17:00", comissao_valor: 15, ativo: true },
  { id: "pl2", nome: "Corte + barba", descricao: "", preco: 149.9, servicos: ["Corte + barba", "Barba tradicional"], intervalo_dias: 14, dias_semana: [1, 2, 3, 4, 5, 6], hora_limite: null, comissao_valor: 25, ativo: true },
];
// Lembretes: Thiago foi lembrado antes de vencer (precisa de outro), Marcos já foi lembrado hoje
const instanteBr = (dia, hm) => new Date(Date.parse(dia + "T" + hm + ":00Z") + 3 * 36e5).toISOString();
let clubeAssinantes = [
  { id: "a1", plano_id: "pl1", nome: "Pedro Henrique", whatsapp: "81999990001", status: "ativo", pago_ate: somaDias(hoje, 18), observacao: "Paga por Pix todo dia 5" },
  { id: "a2", plano_id: "pl1", nome: "Thiago Moura", whatsapp: "81999990002", status: "ativo", pago_ate: somaDias(hoje, -2), observacao: "", lembrete_em: instanteBr(somaDias(hoje, -4), "18:10"), lembrete_pago_ate: somaDias(hoje, -2) },
  { id: "a3", plano_id: "pl2", nome: "Felipe Andrade", whatsapp: "81999990003", status: "ativo", pago_ate: somaDias(hoje, 2), observacao: "" },
  { id: "a4", plano_id: "pl1", nome: "Rodrigo Lima", whatsapp: "81999990004", status: "pausado", pago_ate: somaDias(hoje, -20), observacao: "Viajando" },
  { id: "a5", plano_id: "pl1", nome: "Marcos Vinícius", whatsapp: "81999990005", status: "ativo", pago_ate: hoje, observacao: "", lembrete_em: instanteBr(hoje, "09:12"), lembrete_pago_ate: hoje },
];
const DIAS_R = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
function regrasPrevia(pl) {
  const d = [...pl.dias_semana].sort();
  const dias = d.length === 7 ? "" : d.length > 2 && d.every((x, i) => !i || x === d[i - 1] + 1) ? `${DIAS_R[d[0]]} a ${DIAS_R[d[d.length - 1]]}` : d.map((x) => DIAS_R[x]).join(", ");
  return [pl.intervalo_dias ? `1 vez a cada ${pl.intervalo_dias} dias` : "sem intervalo mínimo", dias, pl.hora_limite ? "até " + pl.hora_limite : ""].filter(Boolean).join(" · ");
}
// Pagamentos do clube (o "Recebi"); ordem maior = mais novo
const PG = (assinante_id, valor, dias, antes, depois) => ({ id: "pg" + seq++, ordem: seq, assinante_id, valor, data: somaDias(hoje, dias), pago_ate_antes: antes, pago_ate_depois: depois });
let clubePagamentos = [
  PG("a4", 99.9, -50, null, somaDias(hoje, -20)),
  PG("a1", 99.9, -42, somaDias(hoje, -42), somaDias(hoje, -12)),
  PG("a2", 99.9, -32, null, somaDias(hoje, -2)),
  PG("a3", 149.9, -28, null, somaDias(hoje, 2)),
  PG("a1", 89.9, -12, somaDias(hoje, -12), somaDias(hoje, 18)),
];
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
function clubePrevia() {
  const ativos = clubeAssinantes.filter((a) => a.status === "ativo");
  const receita = ativos.reduce((t, a) => t + (clubePlanos.find((p) => p.id === a.plano_id) || { preco: 0 }).preco, 0);
  const doMes = clubePagamentos.filter((pg) => pg.data >= hoje.slice(0, 8) + "01" && pg.data <= hoje);
  const recebido = doMes.reduce((t, pg) => t + pg.valor, 0);
  const pagamentosDe = (id) => clubePagamentos.filter((pg) => pg.assinante_id === id).sort((x, y) => y.ordem - x.ordem).map(({ id, valor, data, pago_ate_antes, pago_ate_depois }) => ({ id, valor, data, pago_ate_antes, pago_ate_depois }));
  return {
    hoje, slug: "gw-barbearia",
    planos: clubePlanos.map((p) => ({ ...p, regras: regrasPrevia(p), assinantes: ativos.filter((a) => a.plano_id === p.id).length })),
    assinantes: clubeAssinantes.map((a) => ({ ...a, plano: (clubePlanos.find((p) => p.id === a.plano_id) || {}).nome || "", usosMes: a.id === "a1" ? 3 : a.id === "a3" ? 1 : 0, ultimoUso: a.id === "a1" ? somaDias(hoje, -6) : null, emAberto: a.id === "a1" ? hoje : null, liberaEm: a.id === "a1" ? somaDias(hoje, 1) : null, vencido: a.status === "ativo" && a.pago_ate < hoje, vencimento: vencimento(a, hoje), pagamentos: pagamentosDe(a.id) })),
    servicos: ["Barba tradicional", "Corte + barba", "Corte degradê", "Corte social"],
    kpis: { ativos: ativos.length, vencidos: ativos.filter((a) => a.pago_ate < hoje).length, paraLembrar: lembretesPrevia().length, receitaMensal: r2(receita), recebidoMes: r2(recebido), pagamentosMes: doMes.length, usosMes: 4, comissoesMes: 70, resultadoMes: r2(recebido - 70) },
  };
}
// Carteira de clientes (prévia): visitas em dias atrás, com ritmos diferentes para mostrar cada situação.
// Usa as mesmas contas do servidor (lib/clientes.js).
const aniv = (ano, dias) => ano + somaDias(hoje, dias).slice(4);
const VISITAS = { c1: [6, 27, 48, 69], c2: [35, 55, 75], c3: [12, 42, 72], c4: [10], c5: [28], c6: [95, 120, 145], c7: [220, 250], c8: [8, 23, 38, 53], c9: [50, 80, 110], c12: [15, 45], c13: [3, 33, 63, 93], c14: [40], c15: [19, 40, 61] };
const SERVICOS_PREVIA = ["Corte degradê", "Corte social", "Corte + barba", "Barba tradicional"];
let clientesPrev = [
  { id: "c1", nome: "Pedro Henrique", telefone: "81999990001", cpf: "52998224725", nascimento: aniv(1992, 40), observacao: "Paga por Pix", origem: "site", aceita: true, profissional_id: "b1", proximo: hoje },
  { id: "c2", nome: "Thiago Moura", telefone: "81999990002", cpf: null, nascimento: aniv(1990, 3), observacao: "", origem: "convite", aceita: true, profissional_id: "b1" },
  { id: "c3", nome: "Felipe Andrade", telefone: "81999990003", cpf: null, nascimento: aniv(1995, 0), observacao: "", origem: "site", aceita: false, profissional_id: "b2" },
  { id: "c4", nome: "Marcos Vinícius", telefone: "81999990004", cpf: null, nascimento: null, observacao: "", origem: "site", aceita: true, profissional_id: "b1" },
  { id: "c5", nome: "Lucas Almeida", telefone: "81999990005", cpf: null, nascimento: null, observacao: "", origem: "convite", aceita: true, profissional_id: "b2" },
  { id: "c6", nome: "Rafael Lima", telefone: "81999990006", cpf: null, nascimento: aniv(1985, 18), observacao: "", origem: "painel", aceita: true, profissional_id: "b2" },
  { id: "c7", nome: "André Costa", telefone: "81999990007", cpf: null, nascimento: null, observacao: "", origem: "importacao", aceita: false, profissional_id: null },
  { id: "c8", nome: "João Pedro", telefone: "81999990008", cpf: null, nascimento: null, observacao: "Corta a cada 15 dias", origem: "site", aceita: true, profissional_id: "b1" },
  { id: "c9", nome: "Carlos Souza", telefone: "81999990009", cpf: "11144477735", nascimento: aniv(1980, 25), observacao: "", origem: "site", aceita: true, profissional_id: "b1" },
  { id: "c10", nome: "Diego Ramos", telefone: "81999990010", cpf: null, nascimento: aniv(1999, 9), observacao: "", origem: "importacao", aceita: false, profissional_id: null },
  { id: "c11", nome: "Gustavo Lima", telefone: null, cpf: null, nascimento: null, observacao: "", origem: "importacao", aceita: false, profissional_id: null, ultima_visita_externa: somaDias(hoje, -70) },
  { id: "c12", nome: "Bruno Henrique", telefone: "81999990012", cpf: null, nascimento: null, observacao: "", origem: "site", aceita: false, profissional_id: "b2", saiu: true },
  { id: "c13", nome: "Mateus Silva", telefone: "81999990013", cpf: null, nascimento: null, observacao: "", origem: "site", aceita: true, profissional_id: "b1" },
  { id: "c14", nome: "Vinícius Rocha", telefone: "81999990014", cpf: null, nascimento: null, observacao: "", origem: "convite", aceita: true, profissional_id: "b1" },
  { id: "c15", nome: "Henrique Alves", telefone: "81999990015", cpf: null, nascimento: aniv(1993, -5), observacao: "", origem: "site", aceita: true, profissional_id: "b2" },
];
let campanhasPrev = [{ id: "cp1", nome: "Chamar de volta · " + somaDias(hoje, -20).slice(8, 10) + "/" + somaDias(hoje, -20).slice(5, 7), segmento: "chamar", mensagem: "Olá, {nome}! ...", criado_em: somaDias(hoje, -20) + "T13:00:00Z", enviados: 9, voltaram: 4, faturou: 185 }];
function visitasDe(id) {
  return (VISITAS[id] || []).map((d, i) => ({ id: id + "-v" + i, dia: somaDias(hoje, -d), horario: "10:00", servico: SERVICOS_PREVIA[i % 4], profissional: i % 2 ? "Rafael" : "Bruno", profissional_id: i % 2 ? "b2" : "b1", status: "realizado", valor: [40, 35, 60, 25][i % 4] }));
}
function clientesPrevia() {
  const soDele = papel === "barbeiro";
  const mes = Number(hoje.slice(5, 7));
  let lista = clientesPrev.map((c) => {
    const vs = visitasDe(c.id);
    const r = CL.retorno({ dias: vs.map((v) => v.dia), externa: c.ultima_visita_externa || null, proximo: c.proximo || null }, hoje);
    const gasto = vs.reduce((t, v) => t + v.valor, 0);
    const item = {
      id: c.id, nome: c.nome, telefone: c.telefone || "", cpfMascarado: soDele ? "" : CL.mascararCpf(c.cpf), nascimento: soDele ? null : c.nascimento,
      aniversario: CL.aniversario(c.nascimento, hoje), observacao: c.observacao, origem: c.origem, aceita: !!c.aceita && !c.saiu, saiu: !!c.saiu,
      profissional_id: c.profissional_id, barbeiro: c.profissional_id === "b2" ? "Rafael" : c.profissional_id === "b1" ? "Bruno" : "",
      ...r, gasto, ticket: vs.length ? Math.round((gasto / vs.length) * 100) / 100 : 0, criado_em: somaDias(hoje, -100) + "T12:00:00Z",
    };
    item.segmentos = CL.segmentosDe(item, mes);
    return item;
  });
  if (soDele) lista = lista.filter((c) => c.profissional_id === "b1");
  lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const conta = (seg) => lista.filter((c) => c.segmentos.includes(seg)).length;
  return {
    hoje, dono: !soDele, clientes: lista, equipe: [{ id: "b1", nome: "Bruno" }, { id: "b2", nome: "Rafael" }],
    kpis: { total: lista.length, comWhats: lista.filter((c) => c.telefone).length, aceitam: lista.filter((c) => c.aceita).length, ativos: lista.filter((c) => ["novo", "em_dia", "agendado"].includes(c.status)).length, novosMes: 3, taxaSegundaVisita: soDele ? null : 62, baseSegundaVisita: 8 },
    segmentos: { chamar: conta("chamar"), segunda: conta("segunda"), sumidos: conta("sumidos"), aniversario: conta("aniversario") },
  };
}
const soNumeros = (v) => String(v || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
let convitesPrev = {};
// WhatsApp automático (Premium) da prévia: o que o dono ligou, desligou ou reescreveu
let automacoesPrev = [];
function premiumPrevia() {
  const automacoes = AUTO.configuracao(automacoesPrev);
  const pedidosSemana = pedidos.filter((x) => x.dia >= hoje && x.dia <= somaDias(hoje, 7));
  const assinantes = clubeAssinantes.filter((a) => a.status === "ativo").map((a) => ({ nome: a.nome, whatsapp: a.whatsapp, pago_ate: a.pago_ate, clube_planos: { nome: (clubePlanos.find((x) => x.id === a.plano_id) || {}).nome || "" } }));
  return {
    modo: "teste", precos: AUTO.PRECO,
    automacoes: automacoes.map((a) => ({ tipo: a.tipo, nome: a.nome, categoria: a.categoria, quando: a.quando, ativa: a.ativa, texto: a.texto, config: a.config, pendencia: a.pendencia, padrao: AUTO.AUTOMACOES.find((x) => x.tipo === a.tipo).texto })),
    previa: AUTO.previa({ hoje, automacoes, clientes: clientesPrevia().clientes, pedidos: pedidosSemana, assinantes, contatos: new Map(), barbearia: "GW Barbearia", site: "http://localhost:" + PORTA + "/gw-barbearia" }),
  };
}

// Quem ainda precisa ser lembrado (o que a tela Hoje do dono recebe), com a mesma regra do servidor
function lembretesPrevia() {
  return clubeAssinantes.map((a) => ({ nome: a.nome, v: vencimento(a, hoje) })).filter((x) => x.v && !x.v.lembrado).map((x) => ({ nome: x.nome, dias: x.v.dias })).sort((a, b) => a.dias - b.dias);
}
function maisUmMesPrevia(iso) { const [a, m, d] = iso.split("-").map(Number); const u = new Date(Date.UTC(a, m + 1, 0)).getUTCDate(); return new Date(Date.UTC(a, m, Math.min(d, u))).toISOString().slice(0, 10); }
function valorPrevia(v, padrao) { if (v == null || String(v).trim() === "") return padrao; const n = Number(String(v).replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")); return n >= 0 && n < 10000 ? r2(n) : NaN; }

// Financeiro (prévia): 100 dias de atendimentos fictícios, gastos, insumos e as mensalidades do clube acima.
// Usa a mesma conta do servidor (lib/financeiro-calculo.js).
function financeiroPrevia() {
  let s = 7;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const precos = [{ id: "s1", nome: "Barba tradicional", preco: 25 }, { id: "s2", nome: "Corte degradê", preco: 40 }, { id: "s3", nome: "Corte social", preco: 35 }, { id: "s4", nome: "Corte + barba", preco: 60 }];
  const lista = [];
  for (let i = 100; i >= 0; i--) {
    const dia = somaDias(hoje, -i);
    if (new Date(dia + "T12:00:00Z").getUTCDay() === 0) continue;
    const n = 5 + Math.floor(rnd() * 6);
    for (let k = 0; k < n; k++) {
      const sv = precos[Math.floor(rnd() * precos.length)];
      const bruno = rnd() < 0.55;
      lista.push({ id: `f${i}-${k}`, dia, status: rnd() < 0.05 ? "nao_realizado" : "realizado", valor: sv.preco, comissao_pct: bruno ? 40 : 45, comissao_valor: null, clube_assinante_id: null, profissional_id: bruno ? "b1" : "b2", profissional: bruno ? "Bruno" : "Rafael", servico: sv.nome, simulado: false });
    }
    // Assinantes do clube: perto de 1 atendimento a cada 3 dias, com a comissão fixa do plano
    if (rnd() < 0.35) lista.push({ id: `fc${i}`, dia, status: "realizado", valor: 0, comissao_pct: 40, comissao_valor: 15, clube_assinante_id: "a1", profissional_id: "b1", profissional: "Bruno", servico: "Corte degradê", simulado: false });
  }
  return calcularFinanceiro(hoje, {
    pedidos: lista,
    despesas: [{ id: "d1", descricao: "Aluguel do ponto", categoria: "aluguel", valor: 1800, ativo: true }, { id: "d2", descricao: "Luz e água", categoria: "contas", valor: 420, ativo: true }, { id: "d3", descricao: "Bio Site", categoria: "software", valor: 39.9, ativo: true }],
    insumos: [{ id: "i1", nome: "Pomada modeladora", unidade: "un", estoque_minimo: 5 }, { id: "i2", nome: "Lâmina descartável", unidade: "cx", estoque_minimo: 2 }],
    movimentos: [{ id: "m1", insumo_id: "i1", tipo: "entrada", quantidade: 12, valor_total: 216, data: somaDias(hoje, -20) }, { id: "m2", insumo_id: "i1", tipo: "saida", quantidade: 8, data: somaDias(hoje, -5) }, { id: "m3", insumo_id: "i2", tipo: "entrada", quantidade: 3, valor_total: 89.7, data: somaDias(hoje, -3) }],
    precos,
    profissionais: [{ id: "b1", nome: "Bruno", comissao_pct: 40 }, { id: "b2", nome: "Rafael", comissao_pct: 45 }],
    pagamentosClube: clubePagamentos.map((pg) => ({ id: pg.id, valor: pg.valor, data: pg.data })),
  });
}

let equipeGestao = [
  { id: "b1", nome: "Bruno", ativo: true, perfil_user_id: "u2", foto_url: null, comissao_pct: 40, atendimentos: { total: 148, ultimos30: 41, servicos: [{ nome: "Corte degradê", quantidade: 77 }, { nome: "Corte social", quantidade: 39 }, { nome: "Barba tradicional", quantidade: 32 }] } },
  { id: "b2", nome: "Rafael", ativo: true, perfil_user_id: null, foto_url: null, comissao_pct: 45, atendimentos: { total: 64, ultimos30: 22, servicos: [{ nome: "Corte + barba", quantidade: 40 }, { nome: "Corte social", quantidade: 24 }] } },
];
// Formulário inicial falso: começa vazio, como o dono recebe
const formVazio = () => ({ barbearia: { nome: "", cidade: "", endereco: "", whatsapp: "", instagram: "", horario: "" }, dono: { nome: "", email: "", whatsapp: "", atende: false }, servicos: [], produtos: [], insumos: [], barbeiros: [], fotos: { logo: "", capa: "", ambiente: [] }, preferencias: { confirmacao: "", sinal: false, pixChave: "", pixNome: "" }, observacoes: "" });
let formPrev = { token: "ab".repeat(24), nome: "", status: "aberto", dados: formVazio() };
// Produtos falsos da prévia (lib/produtos.js)
let produtosPrev = [
  { id: "pr1", nome: "Pomada modeladora", custo: 18, preco: 35, estoque: 2, minimo: 3, foto: "", ativo: true },
  { id: "pr2", nome: "Óleo para barba", custo: 22, preco: 45, estoque: 9, minimo: 2, foto: "", ativo: true },
  { id: "pr3", nome: "Shampoo anticaspa", custo: null, preco: 30, estoque: 0, minimo: 1, foto: "", ativo: true },
];
let vendasPrev = [];
// Fichas de prótese falsas da prévia (lib/protese.js)
const diasAtras = (n) => new Date(Date.now() - 3 * 36e5 - n * 864e5).toISOString().slice(0, 10);
let protesePrev = [
  { id: "pf1", nome: "Marcos Lima", telefone: "81999990009", profissional_id: "b1", modelo: "Full lace", aplicada_em: diasAtras(60), intervalo_dias: 21, ultima_manutencao: diasAtras(25), lembrete_em: null, observacao: "", ativo: true },
  { id: "pf2", nome: "Paulo Henrique", telefone: "81999990010", profissional_id: "b2", modelo: "Base de tela", aplicada_em: diasAtras(30), intervalo_dias: 21, ultima_manutencao: diasAtras(19), lembrete_em: null, observacao: "", ativo: true },
  { id: "pf3", nome: "Ana Prado", telefone: "", profissional_id: null, modelo: "", aplicada_em: diasAtras(5), intervalo_dias: 21, ultima_manutencao: null, lembrete_em: null, observacao: "", ativo: true },
];
let leads = [
  { id: "00000000-0000-4000-8000-000000000001", criado_em: new Date(Date.now() - 2 * 36e5).toISOString(), nome: "Marcos Lima", barbearia: "Barbearia do Marcos", cidade: "Olinda", whatsapp: "81988887777", barbeiros: "2-3", plano: "Barbearia", pagina: "/?utm_source=instagram", status: "novo" },
  { id: "00000000-0000-4000-8000-000000000002", criado_em: new Date(Date.now() - 30 * 36e5).toISOString(), nome: "Ana Souza", barbearia: "Studio Navalha", cidade: "Recife", whatsapp: "5581977776666", barbeiros: "1", plano: "Solo", pagina: "/", status: "contatado" },
];
let assinaturaPrevia = null;
let convites = [{ id: "c1", email: "lucas.barbeiro@exemplo.com", expira_em: new Date(Date.now() + 5 * 864e5).toISOString(), link: "http://localhost:4321/entrar.html?convite=tok1" }];

function painel(dia) {
  const soDele = papel === "barbeiro";
  const meus = (p) => !soDele || p.profissional_id === "b1";
  const doDia = pedidos.filter((p) => p.dia === dia && meus(p));
  const ativos = doDia.filter((p) => ["pendente", "confirmado", "avulso", "realizado"].includes(p.status));
  const equipe = [
    { id: "b1", nome: "Bruno", foto_url: null, temLogin: true, agenda: { publicada: true, inicio: "09:00", fim: "18:00", almocoInicio: "12:00", almocoFim: "13:00" }, atendimentos: ativos.filter((p) => p.profissional_id === "b1").length, ocupacao: 27 },
    { id: "b2", nome: "Rafael", foto_url: null, temLogin: false, agenda: null, atendimentos: ativos.filter((p) => p.profissional_id === "b2").length, ocupacao: null },
  ].filter((e) => !soDele || e.id === "b1");
  const soma = (l) => l.reduce((t, p) => t + (Number(p.valor) || 0), 0);
  return {
    hoje, dia, pedidos: doDia,
    pendentes: pedidos.filter((p) => p.status === "pendente" && p.dia >= hoje && meus(p)),
    aEncerrar: pedidos.filter((p) => ["confirmado", "avulso"].includes(p.status) && p.dia <= hoje && meus(p)),
    equipe,
    servicos: [{ nome: "Barba tradicional", preco: 25 }, { nome: "Corte degradê", preco: 40 }, { nome: "Corte social", preco: 35 }, { nome: "Corte + barba", preco: 60 }],
    proximo: dia === hoje ? ativos.find((p) => p.status !== "realizado" && p.horario >= "10:00") || null : null,
    kpis: {
      dia: { agendados: ativos.length, pendentes: doDia.filter((p) => p.status === "pendente").length, confirmados: 2, realizados: doDia.filter((p) => p.status === "realizado").length, faturamentoPrevisto: soma(ativos), faturamentoRealizado: soma(doDia.filter((p) => p.status === "realizado")), ocupacao: 27 },
      ultimos30: { atendimentos: 212, faturamento: 8934.5, ticketMedio: 42.14, faltas: 9, taxaFaltas: 4.1 },
      mes: { atendimentos: 31, faturamento: 1302, comissao: 520.8 },
    },
    temSimulacao: false,
    ...(!soDele && dia === hoje ? { lembretesClube: lembretesPrevia() } : {}),
  };
}

function semana(de, n) {
  const dias = [];
  for (let i = 0; i < (Number(n) || 7); i++) {
    const dia = somaDias(de, i);
    const dow = new Date(dia + "T12:00:00Z").getUTCDay();
    dias.push({
      dia,
      agenda: i < 2 ? { inicio: "09:00", fim: "18:00", almocoInicio: "12:00", almocoFim: "13:00", confirmadaEm: new Date().toISOString() } : null,
      padrao: { inicio: "09:00", fim: dow === 6 ? "14:00" : "19:00", almocoInicio: dow === 6 ? "" : "12:00", almocoFim: dow === 6 ? "" : "13:00", trabalha: dow !== 0 },
      bloqueios: i === 1 ? [{ id: "bl1", inicio: "15:00", fim: "16:00", motivo: "Dentista" }] : [],
    });
  }
  return { de, ate: somaDias(de, (Number(n) || 7) - 1), dias };
}

function json(res, status, corpo) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(corpo));
}

async function corpoDe(req) {
  let t = "";
  for await (const c of req) t += c;
  try { return JSON.parse(t || "{}"); } catch (e) { return {}; }
}

const servidor = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  const q = Object.fromEntries(u.searchParams);
  if (u.pathname === "/previa") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(`<!doctype html><meta charset="utf-8"><title>Prévia</title><body style="font:16px system-ui;padding:24px;display:grid;gap:12px;max-width:420px">
<h1>Prévia dos painéis (dados fictícios)</h1>
<button onclick="ir('dono')">Painel do dono</button><button onclick="ir('barbeiro')">Painel do barbeiro</button>
<button onclick="ir('barbeiro','app.html')">Login do barbeiro (app.html)</button><button onclick="ir('admin','app.html')">Conta da plataforma (app.html)</button>
<button onclick="ir('novo','app.html')">Conta sem barbearia (app.html)</button><button onclick="ir('novo','app.html?convite=abc123')">Convite (app.html)</button>
<script>function ir(p,pag){localStorage.setItem("bio_sessao",JSON.stringify({access_token:"previa",refresh_token:"previa",expira:Date.now()+864e5}));fetch("/__papel?p="+p).then(function(){location.href="/"+(pag||"painel-"+p+".html")})}</script>`);
  }
  if (u.pathname === "/__papel") { papel = ["barbeiro", "admin", "novo"].includes(q.p) ? q.p : "dono"; return json(res, 200, { papel }); }
  if (u.pathname === "/__google") { googleAtivo = q.ativo === "1"; return json(res, 200, { googleAtivo }); }
  if (u.pathname === "/falso/auth/v1/settings") return json(res, 200, { external: { email: true, google: googleAtivo }, disable_signup: false });
  // Login falso da prévia (entrar com e-mail e senha depois de criar a conta pelo convite)
  // Envio falso de arquivo do formulário (aceita qualquer PUT)
  if (u.pathname === "/falso/upload") { res.writeHead(200); return res.end(); }
  if (u.pathname === "/falso/auth/v1/token") return json(res, 200, { access_token: "previa", refresh_token: "previa", expires_in: 3600, user: { id: "u9", email: "novo@exemplo.com" } });
  if (u.pathname.startsWith("/api/")) {
    const metodo = req.method;
    const b = metodo === "GET" ? {} : await corpoDe(req);
    if (u.pathname === "/api/config") {
      // App do cliente (fase 23): avisos ligados e confirmação de presença
      if (metodo === "POST" && b.tipo === "lembrete-cliente") return json(res, 201, { ok: true, ligadoAoPedido: !!b.codigo });
      if (metodo === "GET" && q.presenca) return /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{16}$/i.test(q.presenca) ? json(res, 200, { barbearia: "Barbearia Modelo", servico: "Corte + barba", profissional: "Rafael", dia: hoje, horario: "15:00", hoje, status: presencaPrev.status, resposta: presencaPrev.resposta, passou: false }) : json(res, 404, { message: "Link inválido. Fale com a barbearia pelo WhatsApp." });
      if (metodo === "POST" && b.tipo === "presenca") {
        if (presencaPrev.status === "cancelado") return json(res, 409, { message: "Este horário já foi cancelado.", status: "cancelado" });
        presencaPrev.resposta = b.resposta;
        if (b.resposta === "nao") presencaPrev.status = "cancelado";
        return json(res, 200, { ok: true, status: presencaPrev.status, resposta: b.resposta });
      }
      if (metodo === "POST" && b.tipo === "lead") {
        if (String(b.nome || "").trim().length < 2 || String(b.whatsapp || "").replace(/[^0-9]/g, "").length < 10) return json(res, 400, { message: "Informe o seu nome e o WhatsApp com DDD." });
        leads.unshift({ id: "00000000-0000-4000-8000-" + String(100000000000 + seq++), criado_em: new Date().toISOString(), nome: b.nome, barbearia: b.barbearia, cidade: b.cidade || "", whatsapp: String(b.whatsapp).replace(/[^0-9]/g, ""), barbeiros: b.barbeiros || "", plano: b.plano || "", pagina: b.pagina || "", status: "novo" });
        return json(res, 201, { ok: true });
      }
      // Formulário inicial (lib/formulario.js): /formulario?f=<48 hex> abre o formulário falso abaixo
      if (metodo === "GET" && q.formulario) return formPrev.token === q.formulario ? json(res, 200, { nome: formPrev.nome, status: formPrev.status, editavel: formPrev.status !== "importado", dados: formPrev.dados }) : json(res, 404, { message: "Este link não vale mais. Peça um novo ao Bio Site." });
      if (metodo === "POST" && b.tipo === "formulario") {
        formPrev.dados = b.dados;
        if (b.enviar) {
          const falta = [];
          if (!b.dados.barbearia || !b.dados.barbearia.nome) falta.push("Nome da barbearia");
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((b.dados.dono || {}).email || "")) falta.push("Seu e-mail (para criar o seu login)");
          if (!(b.dados.servicos || []).some((s) => s.nome && s.preco)) falta.push("Pelo menos um serviço com preço");
          if (falta.length) return json(res, 400, { message: "Falta preencher: " + falta.join(", ") + ".", falta });
          formPrev.status = "enviado";
        }
        return json(res, 200, { ok: true, status: formPrev.status, salvoEm: new Date().toISOString() });
      }
      if (metodo === "POST" && b.tipo === "formulario-midia") return json(res, 200, { uploadUrl: "http://localhost:" + PORTA + "/falso/upload", publicUrl: "/img/gw-barbearia/capa-jawd4x.jpg", tipo: String(b.tipoArquivo).startsWith("video") ? "video" : "foto" });
      if (metodo === "POST") { res.writeHead(204); return res.end(); }
      if (q.saude === "1") return json(res, papel === "dono" && q.resumo === "1" ? 403 : 200, { ok: true, gerador: 3, msBanco: 42 });
      return json(res, 200, { url: "http://localhost:" + PORTA + "/falso", anon: "x", vapidPublic: "" });
    }
    if (u.pathname === "/api/eu") {
      if (metodo === "GET" && (q.semana === "1" || q.agenda === "1")) return json(res, 200, semana(q.de || q.dia || hoje, q.dias));
      if (metodo === "GET" && papel === "admin") {
        return json(res, 200, { usuario: { id: "u0", email: "tiago@exemplo.com" }, perfil: null, admin: true, leads, formularios: [{ id: "ff000000-0000-4000-8000-000000000001", token: formPrev.token, nome: (formPrev.dados.barbearia && formPrev.dados.barbearia.nome) || "Dom Manolo Barbearia", whatsapp: "81999990000", status: formPrev.status, criado_em: new Date().toISOString(), enviado_em: formPrev.status === "enviado" ? new Date().toISOString() : null, resumo: { servicos: (formPrev.dados.servicos || []).filter((s) => s.nome).length, produtos: (formPrev.dados.produtos || []).filter((s) => s.nome).length, insumos: 0, barbeiros: (formPrev.dados.barbeiros || []).filter((s) => s.nome).length, fotos: 0, email: (formPrev.dados.dono || {}).email || "" } }], barbearias: [
          { id: "x", slug: "gw-barbearia", nome: "GW Barbearia", temTeste: true, equipe: [{ id: "b1", nome: "Bruno (teste)", temAcesso: true }, { id: "b2", nome: "Rafael (teste)", temAcesso: false }] },
          { id: "y", slug: "barbearia-do-ze", nome: "Barbearia do Zé", temTeste: false, equipe: [] },
        ] });
      }
      if (metodo === "GET" && papel === "novo") return json(res, 200, { usuario: { id: "u9", email: "novo@exemplo.com" }, perfil: null, convites: 1 });
      if (metodo === "GET") {
        return json(res, 200, papel === "barbeiro"
          ? { usuario: { id: "u2", email: "bruno@exemplo.com" }, perfil: { papel: "barbeiro", nome: "Bruno", barbearia_id: "x" }, barbearia: { id: "x", slug: "gw-barbearia", nome: "GW Barbearia" }, profissional: { id: "b1", nome: "Bruno Oliveira", foto_url: null, comissao_pct: 40 } }
          : { usuario: { id: "u1", email: "dono@exemplo.com" }, perfil: { papel: "dono", nome: "Gustavo Wanderley", barbearia_id: "x" }, barbearia: { id: "x", slug: "gw-barbearia", nome: "GW Barbearia", protese_ativa: true }, profissional: null });
      }
      if (b.acao === "lead-status") { const l = leads.find((x) => x.id === b.id); if (l) l.status = b.status; return json(res, 200, { ok: true }); }
      if (b.acao === "agenda-semana-salvar") return json(res, 200, semana(b.dias[0].dia, b.dias.length));
      if (b.acao === "bloqueio-criar") return json(res, 201, { bloqueio: { id: "bl" + seq++ } });
      return json(res, 200, { ok: true });
    }
    if (u.pathname === "/api/equipe") {
      // Assinatura do Bio Site (Stripe): oferta de lançamento; contratar simula o retorno do Stripe
      if (q.area === "assinatura") {
        if (metodo === "POST" && b.acao === "checkout") { assinaturaPrevia = { status: "em_teste", plano: "lancamento", valor_mensal: 39.9, implantacao_paga_em: new Date().toISOString(), primeira_cobranca_em: new Date(Date.now() + 60 * 864e5).toISOString(), proxima_cobranca_em: new Date(Date.now() + 60 * 864e5).toISOString(), cancelar_no_fim: false, stripe_customer_id: "cus_previa" }; return json(res, 200, { url: "/painel-dono.html?assinatura=ok#mais" }); }
        if (metodo === "POST") return json(res, 200, { url: "/painel-dono.html#mais" });
        return json(res, 200, { configurado: true, assinatura: assinaturaPrevia, oferta: { promocao: true, vagasRestantes: 7, mensal: 39.9, normal: 89.9, implantacao: 120, diasAtePrimeiraCobranca: 60 } });
      }
      if (q.area === "clientes") {
        if (metodo === "GET" && q.id) {
          const c = clientesPrev.find((x) => x.id === q.id);
          if (!c) return json(res, 404, { message: "Cliente não encontrado." });
          const dono = papel !== "barbeiro";
          return json(res, 200, {
            cliente: {
              id: c.id, nome: c.nome, telefone: c.telefone || "", nascimento: dono ? c.nascimento : null, aniversario: c.nascimento ? c.nascimento.slice(8, 10) + "/" + c.nascimento.slice(5, 7) : "", observacao: c.observacao, cpf: dono ? c.cpf || "" : "", cpfMascarado: dono ? CL.mascararCpf(c.cpf) : "",
              origem: c.origem, profissional_id: c.profissional_id, ultima_visita_externa: c.ultima_visita_externa || null, aceita: !!c.aceita && !c.saiu,
              aceite_em: c.aceita ? somaDias(hoje, -30) + "T12:00:00Z" : null, aceite_origem: c.aceita ? c.origem : null, saiu_em: c.saiu ? somaDias(hoje, -10) + "T12:00:00Z" : null, criado_em: somaDias(hoje, -100) + "T12:00:00Z",
            },
            visitas: visitasDe(c.id).map(({ id, dia, horario, servico, profissional, status, valor }) => ({ id, dia, horario, servico, profissional, status, valor })),
            campanhas: c.id === "c2" ? [{ nome: campanhasPrev[campanhasPrev.length - 1].nome, enviado_em: campanhasPrev[campanhasPrev.length - 1].criado_em }] : [],
          });
        }
        if (metodo === "GET" && q.campanhas === "1") return json(res, 200, { campanhas: campanhasPrev });
        if (metodo === "GET" && q.premium === "1") return json(res, papel === "barbeiro" ? 403 : 200, papel === "barbeiro" ? { message: "Só o dono cuida do WhatsApp automático." } : premiumPrevia());
        if (b.acao === "automacao-salvar") {
          const def = AUTO.AUTOMACOES.find((x) => x.tipo === b.tipo);
          if (!def) return json(res, 400, { message: "Automação desconhecida." });
          if (b.texto !== undefined && (String(b.texto).trim().length < 10 || String(b.texto).length > 700)) return json(res, 400, { message: "A mensagem precisa ter de 10 a 700 caracteres." });
          if (b.config && b.config.avaliacao && !/^https:\/\/\S{6,}$/.test(b.config.avaliacao)) return json(res, 400, { message: "Cole o link de avaliação completo, começando com https://" });
          let a = automacoesPrev.find((x) => x.tipo === b.tipo);
          if (!a) { a = { tipo: b.tipo, ativa: true, texto: def.texto, config: { ...(def.config || {}) } }; automacoesPrev.push(a); }
          if (typeof b.ativa === "boolean") a.ativa = b.ativa;
          if (b.texto !== undefined) a.texto = String(b.texto).trim();
          if (b.config) a.config = { ...a.config, ...b.config };
          return json(res, 200, { ok: true });
        }
        if (metodo === "GET") return json(res, 200, clientesPrevia());
        if (b.acao === "salvar") {
          const zap = soNumeros(b.telefone);
          if (String(b.nome || "").trim().length < 2) return json(res, 400, { message: "Informe o nome do cliente." });
          if (zap && clientesPrev.some((x) => x.telefone === zap && x.id !== b.id)) return json(res, 409, { message: "Já existe um cliente com este WhatsApp." });
          const nasc = CL.lerData(b.nascimento, { semAno: true });
          if (nasc === null) return json(res, 400, { message: "Data de nascimento inválida. Use dia/mês/ano." });
          if (b.cpf && !CL.cpfValido(b.cpf)) return json(res, 400, { message: "CPF inválido. Confira os números ou deixe em branco." });
          const dadosC = { nome: String(b.nome).trim(), telefone: zap || null, nascimento: nasc || null, observacao: b.observacao || "" };
          if (papel !== "barbeiro") Object.assign(dadosC, { cpf: b.cpf ? soNumeros(b.cpf) : null, aceita: b.aceita === true, profissional_id: b.profissional_id || null });
          if (b.id) { Object.assign(clientesPrev.find((x) => x.id === b.id) || {}, dadosC); return json(res, 200, { cliente: { id: b.id } }); }
          const novo = { id: "cn" + seq++, origem: "painel", profissional_id: papel === "barbeiro" ? "b1" : null, ...dadosC };
          clientesPrev.push(novo);
          if (b.pedidoId) { const pd = pedidos.find((x) => x.id === b.pedidoId); if (pd) { pd.cliente_id = novo.id; pd.clientes = { nome: novo.nome, telefone: novo.telefone }; } }
          return json(res, 201, { cliente: { id: novo.id } });
        }
        if (b.acao === "apagar") { clientesPrev = clientesPrev.filter((x) => x.id !== b.id); return json(res, 200, { ok: true }); }
        if (b.acao === "vincular") {
          const pd = pedidos.find((x) => x.id === b.pedidoId), c = clientesPrev.find((x) => x.id === b.clienteId);
          if (!pd || !c) return json(res, 404, { message: "Atendimento não encontrado." });
          pd.cliente_id = c.id;
          pd.clientes = { nome: c.nome, telefone: c.telefone };
          return json(res, 200, { ok: true });
        }
        if (b.acao === "convite") {
          const token = "previa" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
          const zap = soNumeros(b.telefone);
          convitesPrev[token] = { nome: b.nome || "", telefone: zap, pedidoId: b.pedidoId || null };
          return json(res, 201, { token, link: "http://localhost:" + PORTA + "/cadastro?c=" + token, expiraEm: new Date(Date.now() + 3 * 864e5).toISOString(), telefone: zap });
        }
        if (b.acao === "importar") {
          const ignorados = [], novos = [];
          (b.linhas || []).forEach((r, i) => {
            const l = CL.lerLinha(r || {});
            if (l.motivo) return ignorados.push({ linha: i + 1, nome: (r && r.nome) || "", motivo: l.motivo });
            if (l.linha.telefone && clientesPrev.some((x) => x.telefone === l.linha.telefone)) return ignorados.push({ linha: i + 1, nome: l.linha.nome, motivo: "já cadastrado" });
            novos.push(l.linha);
          });
          if (!b.simular) novos.forEach((x) => clientesPrev.push({ id: "cn" + seq++, origem: "importacao", aceita: b.aceitaram === true, profissional_id: null, ...x }));
          return json(res, 200, { simulado: !!b.simular, inseridos: novos.length, atualizados: 0, ignorados, totalIgnorados: ignorados.length });
        }
        if (b.acao === "campanha-criar") {
          const c = { id: "cp" + seq++, nome: b.nome, segmento: b.segmento, mensagem: b.mensagem, criado_em: new Date().toISOString(), enviados: 0, voltaram: 0, faturou: 0 };
          campanhasPrev.unshift(c);
          return json(res, 201, { campanha: { id: c.id } });
        }
        if (b.acao === "campanha-envio") { const c = campanhasPrev.find((x) => x.id === b.campanhaId); if (c) c.enviados++; return json(res, 200, { ok: true }); }
        return json(res, 400, { message: "Ação desconhecida." });
      }
      if (q.area === "clube") {
        if (metodo === "GET") return json(res, 200, clubePrevia());
        if (b.acao === "plano-salvar") {
          if (!b.nome || String(b.nome).trim().length < 2) return json(res, 400, { message: "Dê um nome ao plano." });
          const corpo = { nome: b.nome, descricao: b.descricao || "", preco: Number(String(b.preco).replace(",", ".")), servicos: b.servicos, intervalo_dias: Number(b.intervalo_dias), dias_semana: b.dias_semana, hora_limite: b.hora_limite || null, comissao_valor: Number(String(b.comissao_valor || 0).replace(",", ".")) };
          const pl = clubePlanos.find((x) => x.id === b.id);
          if (pl) Object.assign(pl, corpo); else clubePlanos.push({ id: "pl" + seq++, ativo: true, ...corpo });
          return json(res, pl ? 200 : 201, { plano: corpo });
        }
        if (b.acao === "plano-ativo") { const pl = clubePlanos.find((x) => x.id === b.id); if (pl) pl.ativo = b.ativo === true; return json(res, 200, { ok: true }); }
        if (b.acao === "assinante-salvar") {
          const zap = String(b.whatsapp || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
          if (zap.length < 10) return json(res, 400, { message: "Informe o WhatsApp do assinante com DDD." });
          if (clubeAssinantes.some((x) => x.whatsapp === zap && x.id !== b.id)) return json(res, 409, { message: "Já existe um assinante com este WhatsApp." });
          const corpo = { nome: b.nome, whatsapp: zap, plano_id: b.plano_id, pago_ate: b.pago_ate || null, observacao: b.observacao || "" };
          const a = clubeAssinantes.find((x) => x.id === b.id);
          if (a) { Object.assign(a, corpo); return json(res, 200, { assinante: a }); }
          const novo = { id: "a" + seq++, status: "ativo", ...corpo };
          if (b.recebeu === true) {
            const valor = valorPrevia(b.valor, (clubePlanos.find((p) => p.id === b.plano_id) || { preco: 0 }).preco);
            if (!Number.isFinite(valor)) return json(res, 400, { message: "Informe o valor recebido." });
            novo.pago_ate = maisUmMesPrevia(hoje);
            clubePagamentos.push({ id: "pg" + seq++, ordem: seq, assinante_id: novo.id, valor, data: hoje, pago_ate_antes: null, pago_ate_depois: novo.pago_ate });
          }
          clubeAssinantes.push(novo);
          return json(res, 201, { assinante: novo });
        }
        if (b.acao === "assinante-pagou") {
          const a = clubeAssinantes.find((x) => x.id === b.id);
          const valor = valorPrevia(b.valor, (clubePlanos.find((p) => p.id === a.plano_id) || { preco: 0 }).preco);
          if (!Number.isFinite(valor)) return json(res, 400, { message: "Informe o valor recebido." });
          const antes = a.pago_ate || null;
          a.pago_ate = maisUmMesPrevia(a.pago_ate && a.pago_ate > hoje ? a.pago_ate : hoje);
          a.status = "ativo";
          const pg = { id: "pg" + seq++, ordem: seq, assinante_id: a.id, valor, data: hoje, pago_ate_antes: antes, pago_ate_depois: a.pago_ate };
          clubePagamentos.push(pg);
          return json(res, 200, { pago_ate: a.pago_ate, pagamento: { id: pg.id, valor, data: hoje } });
        }
        if (b.acao === "assinante-desfazer-pagamento") {
          const a = clubeAssinantes.find((x) => x.id === b.id);
          const meus = clubePagamentos.filter((pg) => pg.assinante_id === b.id).sort((x, y) => y.ordem - x.ordem);
          if (!meus.length || meus[0].id !== b.pagamento) return json(res, 409, { message: "Este já não é o último pagamento do assinante. Abra os pagamentos de novo para conferir." });
          const pg = meus[0];
          clubePagamentos = clubePagamentos.filter((x) => x !== pg);
          const manteve = a.pago_ate !== pg.pago_ate_depois;
          if (!manteve) a.pago_ate = pg.pago_ate_antes;
          return json(res, 200, { pago_ate: a.pago_ate, valor: pg.valor, manteve });
        }
        if (b.acao === "assinante-status") { const a = clubeAssinantes.find((x) => x.id === b.id); a.status = b.status; return json(res, 200, { ok: true }); }
        if (b.acao === "assinante-lembrete") {
          const a = clubeAssinantes.find((x) => x.id === b.id);
          if (!a) return json(res, 404, { message: "Assinante não encontrado." });
          a.lembrete_em = new Date().toISOString();
          a.lembrete_pago_ate = a.pago_ate || null;
          return json(res, 200, { lembrete_em: a.lembrete_em, lembrete_pago_ate: a.lembrete_pago_ate });
        }
        return json(res, 400, { message: "Ação desconhecida." });
      }
      if (q.area === "financeiro") {
        if (metodo === "GET") return json(res, 200, { ...financeiroPrevia(), plataforma: false });
        return json(res, 200, { ok: true });
      }
      // Prótese capilar (lib/protese.js): fichas em memória da prévia
      if (q.area === "protese") {
        const { situacao } = require("../lib/protese");
        const listaP = () => {
          const fichas = protesePrev.filter((f) => f.ativo).map((f) => ({ ...f, profissional: f.profissional_id === "b1" ? "Bruno Oliveira" : f.profissional_id === "b2" ? "Rafael Souza" : "", ...situacao(f, hoje) }));
          const ordem = { atrasada: 0, vence: 1, em_dia: 2, sem_data: 3 };
          fichas.sort((a, b) => ordem[a.status] - ordem[b.status]);
          return { ativa: true, fichas, equipe: [{ id: "b1", nome: "Bruno Oliveira" }, { id: "b2", nome: "Rafael Souza" }], resumo: { total: fichas.length, atrasadas: fichas.filter((f) => f.status === "atrasada").length, vencem: fichas.filter((f) => f.status === "vence").length, semana: fichas.filter((f) => f.dias != null && f.dias >= 0 && f.dias <= 7).length } };
        };
        if (metodo === "GET") return json(res, 200, listaP());
        if (b.acao === "aba") return json(res, 200, { ativa: b.ativa });
        if (b.acao === "criar") { protesePrev.push({ id: "pf" + seq++, nome: b.nome, telefone: String(b.telefone || "").replace(/[^0-9]/g, ""), profissional_id: b.profissionalId, modelo: b.modelo || "", aplicada_em: b.aplicadaEm, intervalo_dias: b.intervaloDias || 21, ultima_manutencao: b.aplicadaEm, lembrete_em: null, observacao: b.observacao || "", ativo: true }); return json(res, 201, { ok: true }); }
        const f = protesePrev.find((x) => x.id === b.id);
        if (!f) return json(res, 404, { message: "Ficha não encontrada." });
        if (b.acao === "manutencao") { f.ultima_manutencao = b.dia; return json(res, 201, { proxima: somaDias(b.dia, f.intervalo_dias) }); }
        if (b.acao === "lembrar") { f.lembrete_em = new Date().toISOString(); return json(res, 200, { ok: true }); }
        if (b.acao === "historico") return json(res, 200, { manutencoes: [{ dia: f.ultima_manutencao || hoje, tipo: "manutencao", observacao: "" }] });
        if (b.acao === "desativar") { f.ativo = false; return json(res, 200, { ok: true }); }
        if (b.acao === "editar") { Object.assign(f, { nome: b.nome, modelo: b.modelo, intervalo_dias: b.intervaloDias }); return json(res, 200, { ok: true }); }
        return json(res, 400, { message: "Ação desconhecida." });
      }
      // Produtos e estoque (lib/produtos.js): estado em memória da prévia
      if (q.area === "produtos") {
        const baixo = (p) => p.ativo && p.estoque <= Math.max(0, p.minimo);
        const lista = () => ({
          dono: papel !== "barbeiro",
          produtos: produtosPrev.map((p) => ({ ...p, baixo: baixo(p), ...(papel === "barbeiro" ? { custo: undefined, lucro: undefined } : { lucro: p.custo == null ? null : Math.round((p.preco - p.custo) * 100) / 100 }) })),
          baixos: produtosPrev.filter(baixo).map((p) => ({ id: p.id, nome: p.nome, estoque: p.estoque })),
          hoje: { unidades: vendasPrev.length, bruto: vendasPrev.reduce((t, v) => t + v, 0) },
        });
        if (metodo === "GET") return json(res, 200, lista());
        const p = produtosPrev.find((x) => x.id === b.id);
        if (b.acao === "criar") { produtosPrev.push({ id: "pr" + seq++, nome: b.nome, custo: Number(String(b.custo).replace(",", ".")) || null, preco: Number(String(b.preco).replace(",", ".")) || 0, estoque: Number(b.estoque) || 0, minimo: Number(b.minimo) || 0, foto: "", ativo: true }); return json(res, 201, { ok: true }); }
        if (!p) return json(res, 404, { message: "Produto não encontrado." });
        if (b.acao === "estoque") { p.estoque += Number(b.quantidade) || 0; return json(res, 200, { estoque: p.estoque, baixo: baixo(p) }); }
        if (b.acao === "vender") { const n = Number(b.quantidade) || 1; p.estoque -= n; for (let i = 0; i < n; i++) vendasPrev.push(p.preco); return json(res, 201, { estoque: p.estoque, baixo: baixo(p) }); }
        if (b.acao === "editar") { if (b.ativo !== undefined) p.ativo = b.ativo; if (b.preco !== undefined) p.preco = Number(String(b.preco).replace(",", ".")); if (b.custo !== undefined) p.custo = Number(String(b.custo).replace(",", ".")) || null; if (b.minimo !== undefined) p.minimo = Number(b.minimo); return json(res, 200, { ok: true }); }
        return json(res, 400, { message: "Ação desconhecida." });
      }
      if (q.agenda === "1") return json(res, 200, { profissional: { id: q.profissionalId, nome: "Rafael", temLogin: false }, ...semana(q.de || hoje, q.dias) });
      if (b.acao === "agenda-semana-salvar") return json(res, 200, semana(b.dias[0].dia, b.dias.length));
      if (metodo === "GET") return json(res, 200, { profissionais: equipeGestao, convites });
      if (b.acao === "convidar") { const token = "tok" + seq++; convites.unshift({ id: "cn" + seq++, email: b.email, expira_em: new Date(Date.now() + 7 * 864e5).toISOString(), link: "http://localhost:" + PORTA + "/entrar.html?convite=" + token }); return json(res, 201, { link: convites[0].link }); }
      if (b.acao === "cancelar-convite") { convites = convites.filter((c) => c.id !== b.id); return json(res, 200, { ok: true }); }
      if (b.acao === "remover") { equipeGestao = equipeGestao.filter((p) => p.id !== b.profissionalId); return json(res, 200, { ok: true }); }
      if (b.acao === "foto-remover") { const p = equipeGestao.find((x) => x.id === b.profissionalId); if (p) p.foto_url = null; return json(res, 200, { ok: true }); }
      return json(res, 200, { ok: true });
    }
    if (u.pathname === "/api/convite") {
      // abc123: e-mail sem conta (cria aqui mesmo); tem-conta: e-mail que já tem conta (entra com a senha); dono123: convite de dono
      const convitesFalsos = {
        abc123: { barbearia: "GW Barbearia", email: "novo@exemplo.com", papel: "barbeiro", temConta: false },
        "tem-conta": { barbearia: "GW Barbearia", email: "bruno@exemplo.com", papel: "barbeiro", temConta: true },
        dono123: { barbearia: "Barbearia do Zé", email: "ze@exemplo.com", papel: "dono", temConta: false },
      };
      if (metodo === "GET") return convitesFalsos[q.token] ? json(res, 200, convitesFalsos[q.token]) : json(res, 404, { message: "Convite inválido." });
      const c = convitesFalsos[b.token];
      if (b.senha !== undefined) {
        if (!c) return json(res, 404, { message: "Convite inválido ou vencido. Peça um novo link a quem convidou você." });
        if (c.temConta) return json(res, 409, { message: "O e-mail " + c.email + " já tem conta. Entre com a sua senha para aceitar o convite.", temConta: true });
        papel = c.papel === "dono" ? "dono" : "barbeiro";
        return json(res, 201, { barbearia: c.barbearia, email: c.email });
      }
      papel = "barbeiro";
      return json(res, 200, { ok: true });
    }
    if (u.pathname === "/api/barbearia" && b.acao === "formulario-criar") return json(res, 201, { id: "ff000000-0000-4000-8000-000000000002", link: "http://localhost:" + PORTA + "/formulario?f=" + formPrev.token });
    if (u.pathname === "/api/barbearia" && b.acao === "formulario-ler") return json(res, 200, { id: b.id, token: formPrev.token, status: formPrev.status, dados: formPrev.dados, pendencias: [] });
    if (u.pathname === "/api/barbearia" && b.acao === "formulario-aplicar") return json(res, 200, { barbearia: "GW Barbearia", insumos: 2, convites: [{ nome: "Carlos", email: "carlos@exemplo.com", whatsapp: "81999990000", papel: "dono", jaEntrou: false, link: "http://localhost:" + PORTA + "/entrar.html?convite=dono123" }, { nome: "Rafael", email: "rafael@exemplo.com", whatsapp: "", papel: "barbeiro", comissao: 45, jaEntrou: false, link: "http://localhost:" + PORTA + "/entrar.html?convite=abc123" }] });
    if (u.pathname === "/api/barbearia" && /^formulario-/.test(b.acao || "")) return json(res, 200, { ok: true });
    if (u.pathname === "/api/barbearia") return json(res, 200, { email: "bruno.teste@exemplo.com", senha: "Previa-1234" });
    // Site público (agendamento): equipe e horários fictícios
    // Site sem cadastro no sistema (como a JM): a API não conhece a barbearia
    if (u.pathname === "/api/profissionais" && q.slug !== "gw-barbearia") return json(res, 404, { message: "Barbearia não encontrada." });
    if (u.pathname === "/api/profissionais") {
      const planos = clubePlanos.filter((p) => p.ativo).map((p) => ({ id: p.id, nome: p.nome, descricao: p.descricao, preco: p.preco, servicos: p.servicos, regras: `Inclui ${p.servicos.join(", ")} · ${regrasPrevia(p)}` }));
      return json(res, 200, { profissionais: equipeGestao.map((p) => ({ id: p.id, nome: p.nome, foto_url: p.foto_url })), precos: {}, clube: planos.length ? { planos } : null });
    }
    if (u.pathname === "/api/horarios") {
      if (q.dias === "1") return json(res, 200, { dias: [hoje, somaDias(hoje, 1), somaDias(hoje, 2)] });
      return json(res, 200, { horarios: ["10:00", "10:30", "14:00", "15:30", "17:00"] });
    }
    if (u.pathname === "/api/pedido") {
      // Cadastro do cliente pelo link de convite (página cadastro.html)
      if (q.convite !== undefined) {
        const cv = convitesPrev[q.convite];
        if (!cv) return json(res, 404, { message: "Link de cadastro inválido. Peça um novo na barbearia." });
        if (cv.usado) return json(res, 410, { message: "Este link já foi usado. Seu cadastro está feito." });
        if (metodo === "GET") return json(res, 200, { barbearia: "GW Barbearia", slug: "gw-barbearia", nome: cv.nome, telefone: cv.telefone });
        const zap = soNumeros(b.whatsapp);
        if (String(b.nome || "").trim().length < 2) return json(res, 400, { message: "Informe seu nome." });
        if (zap.length < 10) return json(res, 400, { message: "Informe seu WhatsApp com DDD." });
        if (b.cpf && !CL.cpfValido(b.cpf)) return json(res, 400, { message: "CPF inválido. Confira os números ou deixe em branco." });
        let c = clientesPrev.find((x) => x.telefone === zap);
        if (!c) {
          c = { id: "cn" + seq++, nome: String(b.nome).trim(), telefone: zap, cpf: b.cpf ? soNumeros(b.cpf) : null, nascimento: CL.lerData(b.nascimento, { semAno: true }) || null, observacao: "", origem: "convite", aceita: b.novidades === true, profissional_id: "b1" };
          clientesPrev.push(c);
        } else if (b.novidades === true) c.aceita = true;
        if (cv.pedidoId) { const pd = pedidos.find((x) => x.id === cv.pedidoId); if (pd) { pd.cliente_id = c.id; pd.clientes = { nome: c.nome, telefone: c.telefone }; } }
        cv.usado = true;
        return json(res, 201, { ok: true });
      }
      if (metodo === "GET" && q.painel === "1") return json(res, 200, painel(q.dia || hoje));
      if (metodo === "GET" && q.realizados === "1") return json(res, 200, { pedidos: pedidos.filter((p) => ["realizado", "nao_realizado"].includes(p.status)) });
      if (metodo === "GET") return json(res, 200, { pedidos: pedidos.filter((p) => p.dia === q.dia) });
      const p = pedidos.find((x) => x.id === b.id);
      if (metodo === "PATCH" && p) { if (b.status) { p.status = b.status; p.motivo = b.motivo || null; } if (b.valor !== undefined) p.valor = b.valor ? Number(String(b.valor).replace(",", ".")) : null; return json(res, 200, { pedido: p }); }
      if (b.acao === "cancelar" && p) { p.status = "cancelado"; return json(res, 200, { pedido: p }); }
      if (b.acao === "remarcar" && p) { p.dia = b.dia; p.horario = b.horario; return json(res, 200, { pedido: p }); }
      if (b.acao === "avulso") { const n = P({ servico: b.servico, cliente: b.cliente, dia: b.dia, horario: b.horario, status: "avulso", duracao_min: b.duracao }); pedidos.push(n); return json(res, 201, { pedido: n }); }
      // Pedido feito no site (prévia): assinante do clube pelo WhatsApp cadastrado
      if (metodo === "POST" && b.slug) {
        let a = null;
        if (b.clube === true) {
          const zap = String(b.clubeWhatsapp || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
          a = clubeAssinantes.find((x) => x.whatsapp === zap);
          if (!a) return json(res, 422, { message: "Não encontramos assinatura do clube com este WhatsApp. Confira o número ou marque sem o clube.", clube: true });
          if (a.status !== "ativo") return json(res, 422, { message: "Sua assinatura do clube está pausada ou cancelada. Fale com a barbearia.", clube: true });
          if (a.pago_ate && a.pago_ate < b.dia) return json(res, 422, { message: `A mensalidade do clube venceu em ${a.pago_ate.slice(8, 10)}/${a.pago_ate.slice(5, 7)}. Fale com a barbearia para renovar.`, clube: true });
        }
        const n = P({ servico: b.servico, cliente: b.cliente, dia: b.dia, horario: b.horario, status: "pendente", valor: a ? 0 : 40, comissao_valor: a ? 15 : null, clube_assinante_id: a ? a.id : null, clube_assinantes: a ? { nome: a.nome } : null });
        // WhatsApp do cliente (opcional): liga o pedido ao cadastro (cria na primeira vez), como o servidor
        const zapCli = soNumeros(b.whatsapp || b.clubeWhatsapp);
        if (zapCli.length >= 10) {
          let c = clientesPrev.find((x) => x.telefone === zapCli);
          if (!c) { c = { id: "cn" + seq++, nome: b.cliente, telefone: zapCli, cpf: null, nascimento: null, observacao: "", origem: "site", aceita: b.novidades === true, profissional_id: null }; clientesPrev.push(c); }
          else if (b.novidades === true) c.aceita = true;
          n.cliente_id = c.id;
          n.clientes = { nome: c.nome, telefone: c.telefone };
        }
        // Sinal no Pix na prévia: os serviços de barba pedem sinal de R$ 10 (lib/sinal.js)
        const comSinal = !a && /barba/i.test(b.servico || "");
        if (comSinal) { n.sinal_valor = 10; n.sinal_status = "aguardando"; }
        pedidos.push(n);
        const sinalPrevia = comSinal ? require("../lib/sinal").pixDoPedido({ ativo: true, tipo: "fixo", valor: 10, prazoMin: 30, tipoChave: "celular", chave: "(81) 99999-8888", nome: "GW Barbearia", cidade: "Recife" }, 10, n.codigo) : null;
        return json(res, 201, { codigo: n.codigo, profissional: b.profissional || "Bruno", verificado: true, clube: !!a, sinal: sinalPrevia });
      }
      return json(res, 400, { message: "Ação desconhecida." });
    }
    return json(res, 404, { message: "Sem prévia para " + u.pathname });
  }
  let arq = path.normalize(path.join(RAIZ, decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname)));
  if (!arq.startsWith(RAIZ)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(arq + ".html")) arq += ".html";
  if (!fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.writeHead(404); return res.end("404"); }
  res.writeHead(200, { "Content-Type": TIPOS[path.extname(arq)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(arq).pipe(res);
});

servidor.listen(PORTA, "127.0.0.1", () => console.log(`Prévia em http://localhost:${PORTA}/previa`));
