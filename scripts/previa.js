// Prévia local dos painéis com dados fictícios (não fala com o banco nem com o GitHub).
// Uso: node scripts/previa.js [porta]   e abra http://localhost:4321/previa
// A página /previa grava uma sessão falsa no navegador e oferece os links do painel do dono e do barbeiro.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { calcularFinanceiro } = require("../lib/financeiro-calculo");

const PORTA = Number(process.argv[2] || 4321);
const RAIZ = path.join(__dirname, "..");
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml" };

const hoje = new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
const somaDias = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let papel = "dono";
let seq = 1;
const P = (extra) => ({ id: "p" + seq++, codigo: "K" + (100 + seq), servico: "Corte degradê", profissional: "Bruno", profissional_id: "b1", dia: hoje, horario: "10:00", horario_fim: "10:40", duracao_min: 40, cliente: "Carlos Souza", observacao: "", status: "confirmado", motivo: null, valor: 40, comissao_pct: null, simulado: false, ...extra });
let pedidos = [
  P({ horario: "09:00", horario_fim: "09:30", duracao_min: 30, servico: "Corte social", cliente: "João Pedro", status: "realizado", valor: 35, comissao_pct: 40 }),
  P({ horario: "10:00", cliente: "Carlos Souza", status: "confirmado" }),
  P({ horario: "11:30", horario_fim: "12:20", duracao_min: 50, servico: "Corte + barba", cliente: "Rafael Lima", status: "avulso", valor: 60, profissional: "Rafael", profissional_id: "b2" }),
  P({ horario: "14:00", horario_fim: "14:30", duracao_min: 30, servico: "Barba tradicional", cliente: "Marcos Vinícius", status: "pendente", valor: 25, observacao: "Prefiro máquina 2 nas laterais" }),
  P({ dia: somaDias(hoje, 1), horario: "16:00", horario_fim: "16:30", duracao_min: 30, servico: "Corte social", cliente: "André Costa", status: "pendente", valor: 35, profissional: "Rafael", profissional_id: "b2" }),
  P({ horario: "15:00", cliente: "Lucas Almeida", status: "recusado" }),
  P({ dia: somaDias(hoje, -1), horario: "17:00", horario_fim: "17:30", duracao_min: 30, cliente: "Diego Ramos", status: "confirmado", valor: 35 }),
  // Assinante do clube: não paga no balcão, comissão fixa
  P({ horario: "16:30", horario_fim: "17:10", cliente: "Pedrinho", status: "confirmado", valor: 0, comissao_valor: 15, clube_assinante_id: "a1", clube_assinantes: { nome: "Pedro Henrique" } }),
];

// Clube de assinatura (prévia): planos, assinantes e uso
let clubePlanos = [
  { id: "pl1", nome: "Corte ilimitado", descricao: "Cabelo sempre em dia, sem pagar a cada corte", preco: 99.9, servicos: ["Corte degradê", "Corte social"], intervalo_dias: 7, dias_semana: [1, 2, 3, 4], hora_limite: "17:00", comissao_valor: 15, ativo: true },
  { id: "pl2", nome: "Corte + barba", descricao: "", preco: 149.9, servicos: ["Corte + barba", "Barba tradicional"], intervalo_dias: 14, dias_semana: [1, 2, 3, 4, 5, 6], hora_limite: null, comissao_valor: 25, ativo: true },
];
let clubeAssinantes = [
  { id: "a1", plano_id: "pl1", nome: "Pedro Henrique", whatsapp: "81999990001", status: "ativo", pago_ate: somaDias(hoje, 18), observacao: "Paga por Pix todo dia 5" },
  { id: "a2", plano_id: "pl1", nome: "Thiago Moura", whatsapp: "81999990002", status: "ativo", pago_ate: somaDias(hoje, -2), observacao: "" },
  { id: "a3", plano_id: "pl2", nome: "Felipe Andrade", whatsapp: "81999990003", status: "ativo", pago_ate: somaDias(hoje, 2), observacao: "" },
  { id: "a4", plano_id: "pl1", nome: "Rodrigo Lima", whatsapp: "81999990004", status: "pausado", pago_ate: somaDias(hoje, -20), observacao: "Viajando" },
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
    assinantes: clubeAssinantes.map((a) => ({ ...a, plano: (clubePlanos.find((p) => p.id === a.plano_id) || {}).nome || "", usosMes: a.id === "a1" ? 3 : a.id === "a3" ? 1 : 0, ultimoUso: a.id === "a1" ? somaDias(hoje, -6) : null, emAberto: a.id === "a1" ? hoje : null, liberaEm: a.id === "a1" ? somaDias(hoje, 1) : null, vencido: a.status === "ativo" && a.pago_ate < hoje, pagamentos: pagamentosDe(a.id) })),
    servicos: ["Barba tradicional", "Corte + barba", "Corte degradê", "Corte social"],
    kpis: { ativos: ativos.length, vencidos: ativos.filter((a) => a.pago_ate < hoje).length, receitaMensal: r2(receita), recebidoMes: r2(recebido), pagamentosMes: doMes.length, usosMes: 4, comissoesMes: 70, resultadoMes: r2(recebido - 70) },
  };
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
  if (u.pathname.startsWith("/api/")) {
    const metodo = req.method;
    const b = metodo === "GET" ? {} : await corpoDe(req);
    if (u.pathname === "/api/config") {
      if (metodo === "POST" && b.tipo === "lead") {
        if (String(b.nome || "").trim().length < 2 || String(b.whatsapp || "").replace(/[^0-9]/g, "").length < 10) return json(res, 400, { message: "Informe o seu nome e o WhatsApp com DDD." });
        leads.unshift({ id: "00000000-0000-4000-8000-" + String(100000000000 + seq++), criado_em: new Date().toISOString(), nome: b.nome, barbearia: b.barbearia, cidade: b.cidade || "", whatsapp: String(b.whatsapp).replace(/[^0-9]/g, ""), barbeiros: b.barbeiros || "", plano: b.plano || "", pagina: b.pagina || "", status: "novo" });
        return json(res, 201, { ok: true });
      }
      if (metodo === "POST") { res.writeHead(204); return res.end(); }
      if (q.saude === "1") return json(res, papel === "dono" && q.resumo === "1" ? 403 : 200, { ok: true, gerador: 3, msBanco: 42 });
      return json(res, 200, { url: "http://localhost:" + PORTA + "/falso", anon: "x", vapidPublic: "" });
    }
    if (u.pathname === "/api/eu") {
      if (metodo === "GET" && (q.semana === "1" || q.agenda === "1")) return json(res, 200, semana(q.de || q.dia || hoje, q.dias));
      if (metodo === "GET" && papel === "admin") {
        return json(res, 200, { usuario: { id: "u0", email: "tiago@exemplo.com" }, perfil: null, admin: true, leads, barbearias: [
          { id: "x", slug: "gw-barbearia", nome: "GW Barbearia", temTeste: true, equipe: [{ id: "b1", nome: "Bruno (teste)", temAcesso: true }, { id: "b2", nome: "Rafael (teste)", temAcesso: false }] },
          { id: "y", slug: "barbearia-do-ze", nome: "Barbearia do Zé", temTeste: false, equipe: [] },
        ] });
      }
      if (metodo === "GET" && papel === "novo") return json(res, 200, { usuario: { id: "u9", email: "novo@exemplo.com" }, perfil: null, convites: 1 });
      if (metodo === "GET") {
        return json(res, 200, papel === "barbeiro"
          ? { usuario: { id: "u2", email: "bruno@exemplo.com" }, perfil: { papel: "barbeiro", nome: "Bruno", barbearia_id: "x" }, barbearia: { id: "x", slug: "gw-barbearia", nome: "GW Barbearia" }, profissional: { id: "b1", nome: "Bruno Oliveira", foto_url: null, comissao_pct: 40 } }
          : { usuario: { id: "u1", email: "dono@exemplo.com" }, perfil: { papel: "dono", nome: "Gustavo Wanderley", barbearia_id: "x" }, barbearia: { id: "x", slug: "gw-barbearia", nome: "GW Barbearia" }, profissional: null });
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
        return json(res, 400, { message: "Ação desconhecida." });
      }
      if (q.area === "financeiro") {
        if (metodo === "GET") return json(res, 200, { ...financeiroPrevia(), plataforma: false });
        return json(res, 200, { ok: true });
      }
      if (q.agenda === "1") return json(res, 200, { profissional: { id: q.profissionalId, nome: "Rafael", temLogin: false }, ...semana(q.de || hoje, q.dias) });
      if (b.acao === "agenda-semana-salvar") return json(res, 200, semana(b.dias[0].dia, b.dias.length));
      if (metodo === "GET") return json(res, 200, { profissionais: equipeGestao, convites });
      if (b.acao === "convidar") { const token = "tok" + seq++; convites.unshift({ id: "c" + seq++, email: b.email, expira_em: new Date(Date.now() + 7 * 864e5).toISOString(), link: "http://localhost:" + PORTA + "/entrar.html?convite=" + token }); return json(res, 201, { link: convites[0].link }); }
      if (b.acao === "cancelar-convite") { convites = convites.filter((c) => c.id !== b.id); return json(res, 200, { ok: true }); }
      if (b.acao === "remover") { equipeGestao = equipeGestao.filter((p) => p.id !== b.profissionalId); return json(res, 200, { ok: true }); }
      if (b.acao === "foto-remover") { const p = equipeGestao.find((x) => x.id === b.profissionalId); if (p) p.foto_url = null; return json(res, 200, { ok: true }); }
      return json(res, 200, { ok: true });
    }
    if (u.pathname === "/api/convite") {
      if (metodo === "GET") return q.token === "abc123" ? json(res, 200, { barbearia: "GW Barbearia", email: "novo@exemplo.com" }) : json(res, 404, { message: "Convite inválido." });
      papel = "barbeiro";
      return json(res, 200, { ok: true });
    }
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
        pedidos.push(n);
        return json(res, 201, { codigo: n.codigo, profissional: b.profissional || "Bruno", verificado: true, clube: !!a });
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
