// Prévia local dos painéis com dados fictícios (não fala com o banco nem com o GitHub).
// Uso: node scripts/previa.js [porta]   e abra http://localhost:4321/previa
// A página /previa grava uma sessão falsa no navegador e oferece os links do painel do dono e do barbeiro.
const http = require("http");
const fs = require("fs");
const path = require("path");
const CL = require("../lib/clientes");

const RAIZ = path.join(__dirname, "..");
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };

// Dados fictícios e estado em memória: scripts/previa-dados.js; rotas de /api/equipe: scripts/previa-equipe.js
const D = require("./previa-dados");
const { PORTA, hoje, somaDias, presencaPrev, LINK_PREVIA, P, pedidos, clubePlanos, clubeAssinantes, regrasPrevia, soNumeros, convitesPrev, formPrev, leads, painel, semana } = D;
const { rotaEquipe } = require("./previa-equipe");

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
  if (u.pathname === "/__papel") { D.papel = ["barbeiro", "admin", "novo"].includes(q.p) ? q.p : "dono"; return json(res, 200, { papel: D.papel }); }
  if (u.pathname === "/__google") { D.googleAtivo = q.ativo === "1"; return json(res, 200, { googleAtivo: D.googleAtivo }); }
  if (u.pathname === "/falso/auth/v1/settings") return json(res, 200, { external: { email: true, google: D.googleAtivo }, disable_signup: false });
  // Login falso da prévia (entrar com e-mail e senha depois de criar a conta pelo convite)
  // Envio falso de arquivo do formulário (aceita qualquer PUT)
  if (u.pathname === "/falso/upload") { res.writeHead(200); return res.end(); }
  if (u.pathname === "/falso/auth/v1/token") return json(res, 200, { access_token: "previa", refresh_token: "previa", expires_in: 3600, user: { id: "u9", email: "novo@exemplo.com" } });
  if (u.pathname.startsWith("/api/")) {
    const metodo = req.method;
    // Demonstração sem login (como lib/conta.js): o token demo-* só lê e vê a barbearia como dono ou barbeiro
    const tokenDemo = (String(req.headers.authorization || "").match(/^Bearer demo-(dono|barbeiro)$/) || [])[1];
    if (tokenDemo && metodo !== "GET") return json(res, 403, { message: "Esta é uma demonstração: aqui nada é salvo. Para usar na sua barbearia, fale com o Bio Site." });
    if (tokenDemo) D.papel = tokenDemo;
    const b = metodo === "GET" ? {} : await corpoDe(req);
    if (u.pathname === "/api/config") {
      // App do cliente (fase 23): avisos ligados e confirmação de presença
      if (metodo === "POST" && b.tipo === "lembrete-cliente") return json(res, 201, { ok: true, ligadoAoPedido: !!b.codigo });
      if (metodo === "GET" && q.presenca) return /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{16}$/i.test(q.presenca) ? json(res, 200, { barbearia: "Barbearia Modelo", servico: "Corte + barba", profissional: "Rafael", dia: presencaPrev.dia || hoje, horario: presencaPrev.horario, hoje, status: presencaPrev.status, resposta: presencaPrev.resposta, passou: false, anterior: presencaPrev.anterior }) : json(res, 404, { message: "Link inválido. Fale com a barbearia pelo WhatsApp." });
      if (metodo === "POST" && b.tipo === "presenca") {
        if (presencaPrev.status === "cancelado") return json(res, 409, { message: "Este horário já foi cancelado.", status: "cancelado" });
        presencaPrev.resposta = b.resposta;
        if (b.resposta === "nao") presencaPrev.status = "cancelado";
        return json(res, 200, { ok: true, status: presencaPrev.status, resposta: b.resposta });
      }
      if (metodo === "POST" && b.tipo === "lead") {
        if (String(b.nome || "").trim().length < 2 || String(b.whatsapp || "").replace(/[^0-9]/g, "").length < 10) return json(res, 400, { message: "Informe o seu nome e o WhatsApp com DDD." });
        leads.unshift({ id: "00000000-0000-4000-8000-" + String(100000000000 + D.seq++), criado_em: new Date().toISOString(), nome: b.nome, barbearia: b.barbearia, cidade: b.cidade || "", whatsapp: String(b.whatsapp).replace(/[^0-9]/g, ""), barbeiros: b.barbeiros || "", plano: b.plano || "", pagina: b.pagina || "", status: "novo" });
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
      if (q.saude === "1") return json(res, D.papel === "dono" && q.resumo === "1" ? 403 : 200, { ok: true, gerador: 3, msBanco: 42 });
      return json(res, 200, { url: "http://localhost:" + PORTA + "/falso", anon: "x", vapidPublic: "" });
    }
    if (u.pathname === "/api/eu") {
      if (metodo === "GET" && (q.semana === "1" || q.agenda === "1")) return json(res, 200, semana(q.de || q.dia || hoje, q.dias));
      if (metodo === "GET" && D.papel === "admin") {
        return json(res, 200, { usuario: { id: "u0", email: "tiago@exemplo.com" }, perfil: null, admin: true, leads, formularios: [{ id: "ff000000-0000-4000-8000-000000000001", token: formPrev.token, nome: (formPrev.dados.barbearia && formPrev.dados.barbearia.nome) || "Dom Manolo Barbearia", whatsapp: "81999990000", status: formPrev.status, criado_em: new Date().toISOString(), enviado_em: formPrev.status === "enviado" ? new Date().toISOString() : null, resumo: { servicos: (formPrev.dados.servicos || []).filter((s) => s.nome).length, produtos: (formPrev.dados.produtos || []).filter((s) => s.nome).length, insumos: 0, barbeiros: (formPrev.dados.barbeiros || []).filter((s) => s.nome).length, fotos: 0, email: (formPrev.dados.dono || {}).email || "" } }], barbearias: [
          { id: "x", slug: "gw-barbearia", nome: "GW Barbearia", temTeste: true, equipe: [{ id: "b1", nome: "Bruno (teste)", temAcesso: true }, { id: "b2", nome: "Rafael (teste)", temAcesso: false }] },
          { id: "y", slug: "barbearia-do-ze", nome: "Barbearia do Zé", temTeste: false, equipe: [] },
        ] });
      }
      if (metodo === "GET" && D.papel === "novo") return json(res, 200, { usuario: { id: "u9", email: "novo@exemplo.com" }, perfil: null, convites: 1 });
      if (metodo === "GET") {
        return json(res, 200, D.papel === "barbeiro"
          ? { usuario: { id: "u2", email: "bruno@exemplo.com" }, perfil: { papel: "barbeiro", nome: "Bruno", barbearia_id: "x" }, barbearia: { id: "x", slug: "gw-barbearia", nome: "GW Barbearia" }, profissional: { id: "b1", nome: "Bruno Oliveira", foto_url: null, comissao_pct: 40 } }
          : { usuario: { id: "u1", email: "dono@exemplo.com" }, perfil: { papel: "dono", nome: "Gustavo Wanderley", barbearia_id: "x" }, barbearia: { id: "x", slug: "gw-barbearia", nome: "GW Barbearia", protese_ativa: true }, profissional: null });
      }
      if (b.acao === "config-barbearia" && b.whatsapp !== undefined) {
        const n = soNumeros(b.whatsapp);
        if (n && !/^\d{10,11}$/.test(n)) return json(res, 400, { message: "Confira o WhatsApp: DDD e número." });
        return json(res, 200, { ok: true, whatsapp: n || null });
      }
      if (b.acao === "lead-status") { const l = leads.find((x) => x.id === b.id); if (l) l.status = b.status; return json(res, 200, { ok: true }); }
      if (b.acao === "agenda-semana-salvar") return json(res, 200, semana(b.dias[0].dia, b.dias.length));
      if (b.acao === "bloqueio-criar") return json(res, 201, { bloqueio: { id: "bl" + D.seq++ } });
      return json(res, 200, { ok: true });
    }
    if (u.pathname === "/api/equipe") return rotaEquipe({ res, q, metodo, b, json });
    if (u.pathname === "/api/convite") {
      // abc123: e-mail sem conta (cria aqui mesmo); tem-conta: e-mail que já tem conta (entra com a senha); dono123: convite de dono
      const convitesFalsos = {
        abc123: { barbearia: "GW Barbearia", email: "novo@exemplo.com", papel: "barbeiro", temConta: false },
        "tem-conta": { barbearia: "GW Barbearia", email: "bruno@exemplo.com", papel: "barbeiro", temConta: true },
        dono123: { barbearia: "Barbearia do Zé", email: "ze@exemplo.com", papel: "dono", temConta: false },
        // ficha123: convite pela ficha de um barbeiro que já está na equipe (ex.: veio do Booksy com agenda)
        ficha123: { barbearia: "GW Barbearia", email: "rafael@exemplo.com", papel: "barbeiro", temConta: false, ficha: "Rafael" },
      };
      if (metodo === "GET") return convitesFalsos[q.token] ? json(res, 200, convitesFalsos[q.token]) : json(res, 404, { message: "Convite inválido." });
      const c = convitesFalsos[b.token];
      if (b.senha !== undefined) {
        if (!c) return json(res, 404, { message: "Convite inválido ou vencido. Peça um novo link a quem convidou você." });
        if (c.temConta) return json(res, 409, { message: "O e-mail " + c.email + " já tem conta. Entre com a sua senha para aceitar o convite.", temConta: true });
        D.papel = c.papel === "dono" ? "dono" : "barbeiro";
        return json(res, 201, { barbearia: c.barbearia, email: c.email });
      }
      D.papel = "barbeiro";
      return json(res, 200, { ok: true });
    }
    if (u.pathname === "/api/barbearia" && b.acao === "formulario-criar") return json(res, 201, { id: "ff000000-0000-4000-8000-000000000002", link: "http://localhost:" + PORTA + "/formulario?f=" + formPrev.token });
    if (u.pathname === "/api/barbearia" && b.acao === "formulario-ler") return json(res, 200, { id: b.id, token: formPrev.token, status: formPrev.status, dados: formPrev.dados, pendencias: [] });
    if (u.pathname === "/api/barbearia" && b.acao === "formulario-aplicar") return json(res, 200, { barbearia: "GW Barbearia", insumos: 2, convites: [{ nome: "Carlos", email: "carlos@exemplo.com", whatsapp: "81999990000", papel: "dono", jaEntrou: false, link: "http://localhost:" + PORTA + "/entrar.html?convite=dono123" }, { nome: "Rafael", email: "rafael@exemplo.com", whatsapp: "", papel: "barbeiro", comissao: 45, jaEntrou: false, link: "http://localhost:" + PORTA + "/entrar.html?convite=abc123" }] });
    if (u.pathname === "/api/barbearia" && /^formulario-/.test(b.acao || "")) return json(res, 200, { ok: true });
    if (u.pathname === "/api/barbearia" && b.acao === "convite-dono") return json(res, 201, { link: "http://localhost:" + PORTA + "/entrar.html?convite=dono123", email: String(b.email || "").toLowerCase(), barbearia: "GW Barbearia", ficha: b.profissionalId === "b2" ? "Rafael (teste)" : null });
    if (u.pathname === "/api/barbearia") return json(res, 200, { email: "bruno.teste@exemplo.com", senha: "Previa-1234" });
    // Site público (agendamento): equipe e horários fictícios
    // Site sem cadastro no sistema (como a JM): a API não conhece a barbearia
    if (u.pathname === "/api/profissionais" && !["gw-barbearia", "barbearia-modelo", "barbearia-exemplo"].includes(q.slug)) return json(res, 404, { message: "Barbearia não encontrada." });
    if (u.pathname === "/api/profissionais") {
      const planos = clubePlanos.filter((p) => p.ativo).map((p) => ({ id: p.id, nome: p.nome, descricao: p.descricao, preco: p.preco, servicos: p.servicos, regras: `Inclui ${p.servicos.join(", ")} · ${regrasPrevia(p)}` }));
      // WhatsApp do painel (fase 25): na Modelo da prévia, o número do dono que assiste à apresentação
      return json(res, 200, { profissionais: D.equipeGestao.map((p) => ({ id: p.id, nome: p.nome, foto_url: p.foto_url })), precos: {}, clube: planos.length ? { planos } : null, whatsapp: q.slug === "barbearia-modelo" ? "81988887777" : null });
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
        let c = D.clientesPrev.find((x) => x.telefone === zap);
        if (!c) {
          c = { id: "cn" + D.seq++, nome: String(b.nome).trim(), telefone: zap, cpf: b.cpf ? soNumeros(b.cpf) : null, nascimento: CL.lerData(b.nascimento, { semAno: true }) || null, observacao: "", origem: "convite", aceita: b.novidades === true, profissional_id: "b1" };
          D.clientesPrev.push(c);
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
      if (b.acao === "remarcar" && p) {
        const ini = Number(b.horario.slice(0, 2)) * 60 + Number(b.horario.slice(3, 5)), dur = Number(b.duracao) || p.duracao_min || 30, prof = b.profissionalId || p.profissional_id;
        const conflito = pedidos.find((x) => x.id !== p.id && x.dia === b.dia && x.profissional_id === prof && ["pendente", "confirmado", "avulso", "realizado"].includes(x.status) && (() => { const a = Number(x.horario.slice(0, 2)) * 60 + Number(x.horario.slice(3, 5)); return a < ini + dur && ini < a + (x.duracao_min || 30); })());
        if (conflito) return json(res, 409, { message: `Conflito com outro atendimento (das ${conflito.horario.slice(0, 5)}). Escolha outro horário.` });
        const pedirAceite = !!(b.avisar || b.whatsapp);
        if (pedirAceite) { Object.assign(presencaPrev, { anterior: { dia: p.dia, horario: p.horario.slice(0, 5) }, dia: b.dia, horario: b.horario, resposta: "", status: "confirmado" }); p.remarcado_em = new Date().toISOString(); p.dia_anterior = p.dia; p.horario_anterior = p.horario.slice(0, 5); p.cliente_resposta = null; }
        p.dia = b.dia; p.horario = b.horario; p.profissional_id = prof; p.profissional = prof === "b2" ? "Rafael" : "Bruno";
        return json(res, 200, { pedido: p, avisados: b.avisar ? 1 : 0, link: pedirAceite ? LINK_PREVIA : "" });
      }
      if (b.acao === "atrasar") {
        const prof = D.papel === "barbeiro" ? "b1" : b.profissionalId;
        const desde = b.aPartirDe || "00:00";
        const lista = pedidos.filter((x) => x.dia === b.dia && x.profissional_id === prof && ["pendente", "confirmado", "avulso"].includes(x.status) && x.horario.slice(0, 5) >= desde);
        const resumo = lista.map((x) => { const de = x.horario.slice(0, 5); const m = Number(x.horario.slice(0, 2)) * 60 + Number(x.horario.slice(3, 5)) + Number(b.minutos); x.horario = String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); return { id: x.id, cliente: x.cliente, servico: x.servico, profissional: x.profissional, codigo: x.codigo, dia: x.dia, de, para: x.horario, telefone: (x.clientes && x.clientes.telefone) || "", avisado: !!b.avisar && x.cliente !== "Pedrinho", link: b.avisar || b.whatsapp ? LINK_PREVIA : "" }; });
        return json(res, 200, { movidos: lista.length, falhas: [], avisados: resumo.filter((x) => x.avisado).length, lista: resumo });
      }
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
          let c = D.clientesPrev.find((x) => x.telefone === zapCli);
          if (!c) { c = { id: "cn" + D.seq++, nome: b.cliente, telefone: zapCli, cpf: null, nascimento: null, observacao: "", origem: "site", aceita: b.novidades === true, profissional_id: null }; D.clientesPrev.push(c); }
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
