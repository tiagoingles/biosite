// Prévia local dos painéis com dados fictícios (não fala com o banco nem com o GitHub).
// Uso: node scripts/previa.js [porta]   e abra http://localhost:4321/previa
// A página /previa grava uma sessão falsa no navegador e oferece os links do painel do dono e do barbeiro.
const http = require("http");
const fs = require("fs");
const path = require("path");

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
];

let equipeGestao = [
  { id: "b1", nome: "Bruno", ativo: true, perfil_user_id: "u2", foto_url: null, comissao_pct: 40, atendimentos: { total: 148, ultimos30: 41, servicos: [{ nome: "Corte degradê", quantidade: 77 }, { nome: "Corte social", quantidade: 39 }, { nome: "Barba tradicional", quantidade: 32 }] } },
  { id: "b2", nome: "Rafael", ativo: true, perfil_user_id: null, foto_url: null, comissao_pct: 45, atendimentos: { total: 64, ultimos30: 22, servicos: [{ nome: "Corte + barba", quantidade: 40 }, { nome: "Corte social", quantidade: 24 }] } },
];
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
      if (metodo === "POST") { res.writeHead(204); return res.end(); }
      if (q.saude === "1") return json(res, papel === "dono" && q.resumo === "1" ? 403 : 200, { ok: true, gerador: 3, msBanco: 42 });
      return json(res, 200, { url: "http://localhost:" + PORTA + "/falso", anon: "x", vapidPublic: "" });
    }
    if (u.pathname === "/api/eu") {
      if (metodo === "GET" && (q.semana === "1" || q.agenda === "1")) return json(res, 200, semana(q.de || q.dia || hoje, q.dias));
      if (metodo === "GET" && papel === "admin") {
        return json(res, 200, { usuario: { id: "u0", email: "tiago@exemplo.com" }, perfil: null, admin: true, barbearias: [
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
      if (b.acao === "agenda-semana-salvar") return json(res, 200, semana(b.dias[0].dia, b.dias.length));
      if (b.acao === "bloqueio-criar") return json(res, 201, { bloqueio: { id: "bl" + seq++ } });
      return json(res, 200, { ok: true });
    }
    if (u.pathname === "/api/equipe") {
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
    if (u.pathname === "/api/profissionais") return json(res, 200, { profissionais: equipeGestao.map((p) => ({ id: p.id, nome: p.nome, foto_url: p.foto_url })), precos: {} });
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
