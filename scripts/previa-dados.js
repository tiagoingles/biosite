// Dados fictícios da prévia local (scripts/previa.js): pedidos, clube, clientes, financeiro, equipe, produtos,
// prótese e convites, guardados em memória enquanto a prévia roda, e as contas que montam as respostas da API.
// O estado que as rotas trocam por inteiro (ex.: equipeGestao = equipeGestao.filter(...)) fica acessível por get/set.
const { calcularFinanceiro } = require("../lib/financeiro-calculo");
const { vencimento } = require("../lib/clube");
const CL = require("../lib/clientes");
const AUTO = require("../lib/automacoes");

// Porta da prévia: os links fictícios (convites, formulário) apontam para ela
const PORTA = Number(process.argv[2] || 4321);

const hoje = new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
const somaDias = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let papel = "dono";
let googleAtivo = false; // como em produção: login com Google desligado no Supabase (/__google?ativo=1 liga)
let seq = 1;
// Confirmação de presença da prévia (/barbearia-modelo?confirmar=<id>.<assinatura>)
const presencaPrev = { status: "confirmado", resposta: "", anterior: null, dia: null, horario: "15:00" };
// Caixa do dia (lib/caixa.js): estado em memória
let caixaPrev = null;
const caixaMovPrev = [];
const LINK_PREVIA = "/gw-barbearia?confirmar=8c484a0d-d00c-4915-971c-39f2a6c1e1c9.Qf4Fh7ASDkUGPZZY";
const P = (extra) => ({ id: "p" + seq++, codigo: "K" + (100 + seq), servico: "Corte degradê", profissional: "Bruno", profissional_id: "b1", dia: hoje, horario: "10:00", horario_fim: "10:40", duracao_min: 40, cliente: "Carlos Souza", observacao: "", status: "confirmado", motivo: null, valor: 40, comissao_pct: null, simulado: false, ...extra });
let pedidos = [
  P({ horario: "09:00", horario_fim: "09:30", duracao_min: 30, servico: "Corte social", cliente: "João Pedro", status: "realizado", valor: 35, comissao_pct: 40, forma_pagamento: "dinheiro" }),
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
      // App da barbearia (fase 23): quem ligou os avisos no celular
      app: !soDele && ["c1", "c2", "c4", "c8", "c13"].includes(c.id), appNovidades: !soDele && ["c1", "c2", "c8", "c13"].includes(c.id),
    };
    item.segmentos = CL.segmentosDe(item, mes);
    return item;
  });
  if (soDele) lista = lista.filter((c) => c.profissional_id === "b1");
  lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const conta = (seg) => lista.filter((c) => c.segmentos.includes(seg)).length;
  return {
    hoje, dono: !soDele, clientes: lista, equipe: [{ id: "b1", nome: "Bruno" }, { id: "b2", nome: "Rafael" }],
    kpis: { total: lista.length, comWhats: lista.filter((c) => c.telefone).length, aceitam: lista.filter((c) => c.aceita).length, comApp: lista.filter((c) => c.app).length, appSemCadastro: soDele ? 0 : 2, avisos: soDele ? null : { aparelhos: 7, comCadastro: 5, semCadastro: 2, novidades: 6, iphone: 2, android: 5, outros: 0 }, ativos: lista.filter((c) => ["novo", "em_dia", "agendado"].includes(c.status)).length, novosMes: 3, taxaSegundaVisita: soDele ? null : 62, baseSegundaVisita: 8 },
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
    // Aba Caixa (fase 35): um gasto pago pela gaveta, um vale do Bruno, uma retirada do dono e dois fechamentos
    retiradasCaixa: [
      { id: "r1", valor: 35, categoria: "despesa", profissional_id: null, dia: somaDias(hoje, -2) },
      { id: "r2", valor: 100, categoria: "vale", profissional_id: "b1", dia: somaDias(hoje, -1) },
      { id: "r3", valor: 200, categoria: "dono", profissional_id: null, dia: somaDias(hoje, -1) },
    ],
    fechamentosCaixa: [
      { id: "c1", dia: somaDias(hoje, -2), contado: 180, esperado: 185 },
      { id: "c2", dia: somaDias(hoje, -1), contado: 230, esperado: 230 },
    ],
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
    { id: "b1", nome: "Bruno", foto_url: null, temLogin: true, agenda: { publicada: true, inicio: "09:00", fim: "18:00", almocoInicio: "12:00", almocoFim: "13:00" }, atendimentos: ativos.filter((p) => p.profissional_id === "b1").length, ocupacao: 27, bloqueios: [{ id: "bl-dentista", tipo: "pontual", inicio: "16:00", fim: "16:30", motivo: "Dentista" }] },
    // Rafael sem login, com um bloqueio sem motivo (como os que vêm de uma migração do Booksy): o dono muda ou remove no quadro
    { id: "b2", nome: "Rafael", foto_url: null, temLogin: false, agenda: null, atendimentos: ativos.filter((p) => p.profissional_id === "b2").length, ocupacao: null, bloqueios: [{ id: "bl-almoco", tipo: "pontual", inicio: "12:40", fim: "14:30", motivo: "" }] },
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

module.exports = { PORTA, hoje, somaDias, presencaPrev, caixaMovPrev, LINK_PREVIA, P, pedidos, clubePlanos, clubeAssinantes, regrasPrevia, clubePrevia, campanhasPrev, visitasDe, clientesPrevia, soNumeros, convitesPrev, automacoesPrev, premiumPrevia, maisUmMesPrevia, valorPrevia, financeiroPrevia, formPrev, produtosPrev, vendasPrev, protesePrev, leads, painel, semana };
Object.defineProperty(module.exports, "papel", { get: () => papel, set: (v) => { papel = v; }, enumerable: true });
Object.defineProperty(module.exports, "googleAtivo", { get: () => googleAtivo, set: (v) => { googleAtivo = v; }, enumerable: true });
Object.defineProperty(module.exports, "seq", { get: () => seq, set: (v) => { seq = v; }, enumerable: true });
Object.defineProperty(module.exports, "caixaPrev", { get: () => caixaPrev, set: (v) => { caixaPrev = v; }, enumerable: true });
Object.defineProperty(module.exports, "clubePagamentos", { get: () => clubePagamentos, set: (v) => { clubePagamentos = v; }, enumerable: true });
Object.defineProperty(module.exports, "clientesPrev", { get: () => clientesPrev, set: (v) => { clientesPrev = v; }, enumerable: true });
Object.defineProperty(module.exports, "equipeGestao", { get: () => equipeGestao, set: (v) => { equipeGestao = v; }, enumerable: true });
Object.defineProperty(module.exports, "assinaturaPrevia", { get: () => assinaturaPrevia, set: (v) => { assinaturaPrevia = v; }, enumerable: true });
Object.defineProperty(module.exports, "convites", { get: () => convites, set: (v) => { convites = v; }, enumerable: true });
