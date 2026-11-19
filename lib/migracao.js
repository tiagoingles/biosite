// Migração de outro sistema para uma barbearia do barbeirotop (por enquanto, o Booksy).
// 1. No /app, o admin escolhe a barbearia e gera o coletor: um código que vale 2 horas (só o hash fica no banco).
// 2. O coletor (coletor-booksy.js, aberto por um favorito) roda no navegador onde o Booksy está logado: usa a
//    sessão que já está aberta, só lê, e manda os dados para POST /api/config { tipo: "migracao", token, dados }.
//    A senha do Booksy nunca passa pelo barbeirotop.
// 3. Aqui, equipe, serviços, produtos, clientes, agendamentos de hoje em diante e bloqueios entram na barbearia.
//    Cada registro guarda de onde veio (externo = "booksy:<id>"): rodar o coletor de novo não duplica nada, e o
//    que já existia na barbearia (mesmo WhatsApp, CPF ou nome) só tem os campos vazios completados.
const crypto = require("crypto");
const { rest, todas } = require("./supabase");
const { texto } = require("./agenda");
const { hojeBr, dataValida } = require("./horarios");
const { contarTentativas, origemDe } = require("./seguranca");
const { normalizarWhats } = require("./clube");
const { cpfValido, lerData } = require("./clientes");

const VALIDADE_MIN = 120;
const TOKEN = /^[0-9a-f]{48}$/;
const ORIGENS = ["https://booksy.com", "https://www.booksy.com"];
const LIMITES = { equipe: 200, servicos: 1000, produtos: 3000, clientes: 30000, agendamentos: 20000, bloqueios: 5000 };
const LOTE = 500;
const MAX_RECUSADOS = 25; // depois disso o erro se repete: para de dividir o lote e conta o resto como recusado
const TEMPO_IMPORTACAO_MS = 45000; // a função tem 60 segundos; o que faltar entra na próxima vez que o coletor rodar

function erro(status, message) {
  return Object.assign(new Error(message), { status });
}
const hash = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
const externo = (id) => "booksy:" + String(id == null ? "" : id).replace(/[^0-9A-Za-z_-]/g, "").slice(0, 40);
const chaveNome = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
// "2026-11-19T18:00" -> dia, hora; a duração vem da diferença (o Booksy manda a hora local da barbearia)
const diaDe = (s) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(s || "")); return m && dataValida(m[1]) ? m[1] : null; };
const horaDe = (s) => { const m = /T(\d{2}):(\d{2})/.exec(String(s || "")); return m ? m[1] + ":" + m[2] : null; };
function minutosEntre(de, ate) {
  const a = Date.parse(String(de).slice(0, 16) + ":00Z"), b = Date.parse(String(ate).slice(0, 16) + ":00Z");
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 60000) : NaN;
}
// "33.00", "R$ 28,00+", "1.234,56" -> número; vazio ou inválido -> null
function numero(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  let s = String(v).replace(/[^\d.,-]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return s && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
const telefoneBr = (t) => (t.length === 11 ? `(${t.slice(0, 2)}) ${t.slice(2, 7)}-${t.slice(7)}` : `(${t.slice(0, 2)}) ${t.slice(2, 6)}-${t.slice(6)}`);
// Número salvo sem DDD (8 ou 9 dígitos, comum no Booksy) é da cidade da barbearia: ganha o DDD dela
function telefoneDe(v, ddd) {
  const n = normalizarWhats(v);
  if (n || !ddd) return n || null;
  const d = String(v == null ? "" : v).replace(/\D/g, "");
  return d.length === 8 || d.length === 9 ? normalizarWhats(ddd + d) || null : null;
}
const DDD = /^[1-9][1-9]$/;
// Nome provisório de quem veio sem nome ("Cliente (81) 98888-7777"): numa coleta seguinte, o nome de verdade entra no lugar
const PROVISORIO = /^Cliente \(\d{2}\) \d{4,5}-\d{4}$/;

// ---------- código do coletor ----------
async function criar({ barbeariaId, userId }) {
  const b = (await rest(`barbearias?id=eq.${barbeariaId}&select=id,nome,slug,demonstracao`))[0];
  if (!b) throw erro(404, "Barbearia não encontrada.");
  if (b.demonstracao === "vitrine") throw erro(409, "A vitrine da página de vendas não recebe migração.");
  const token = crypto.randomBytes(24).toString("hex");
  const expiraEm = new Date(Date.now() + VALIDADE_MIN * 60000).toISOString();
  await rest("migracoes", { metodo: "POST", prefer: "return=minimal", corpo: { barbearia_id: b.id, origem: "booksy", token_hash: hash(token), criado_por: userId || null, expira_em: expiraEm } });
  return { token, expiraEm, barbearia: { id: b.id, nome: b.nome, slug: b.slug } };
}

// A última coleta de uma barbearia (o /app mostra o resultado enquanto espera)
async function ultima(barbeariaId) {
  const m = (await rest(`migracoes?barbearia_id=eq.${barbeariaId}&select=criado_em,expira_em,usado_em,resumo&order=criado_em.desc&limit=1`))[0];
  return { ultima: m || null };
}

// ---------- recebimento (vem do navegador do Booksy) ----------
function cors(req, res) {
  const o = String((req.headers || {}).origin || "");
  if (!ORIGENS.includes(o)) return;
  res.setHeader("Access-Control-Allow-Origin", o);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
}

async function receber(req, res, b) {
  res.setHeader("Cache-Control", "no-store");
  cors(req, res);
  const chave = `migracao:${origemDe(req) || "sem-origem"}`;
  if ((await contarTentativas(chave, 3600, false)) >= 20) return res.status(429).json({ message: "Muitas tentativas. Gere outro coletor no barbeirotop daqui a pouco." });
  const token = String(b.token || "");
  const m = TOKEN.test(token) ? (await rest(`migracoes?token_hash=eq.${hash(token)}&select=id,barbearia_id,expira_em&limit=1`))[0] : null;
  if (!m || new Date(m.expira_em) < new Date()) {
    await contarTentativas(chave, 3600, true).catch(() => 0);
    return res.status(404).json({ message: "Este coletor venceu ou não vale. Gere outro no /app do barbeirotop." });
  }
  const dados = b.dados && typeof b.dados === "object" && !Array.isArray(b.dados) ? b.dados : null;
  if (!dados) return res.status(400).json({ message: "Nada para importar." });
  for (const k of Object.keys(LIMITES)) {
    if (dados[k] != null && (!Array.isArray(dados[k]) || dados[k].length > LIMITES[k])) return res.status(400).json({ message: `Dados de ${k} inválidos.` });
  }
  const resumo = await importar(m.barbearia_id, dados);
  await rest(`migracoes?id=eq.${m.id}`, { metodo: "PATCH", prefer: "return=minimal", corpo: { usado_em: new Date().toISOString(), resumo } });
  return res.status(200).json({ ok: true, resumo });
}

// ---------- importação ----------
// Grava em lotes; se um lote falhar (um registro fora das regras do banco), divide ao meio até achar o recusado,
// para um registro ruim não custar 500 gravações. Se o erro se repete ou o tempo acaba, para e conta o resto
// (pendentes: o coletor rodado de novo continua de onde parou, sem duplicar).
async function inserirEmLotes(tabela, linhas, prazo = Infinity) {
  let ok = 0, recusados = 0, pendentes = 0, avisou = false;
  async function gravar(lote) {
    if (Date.now() > prazo) { pendentes += lote.length; return; }
    try {
      await rest(tabela, { metodo: "POST", prefer: "return=minimal", corpo: lote.length === 1 ? lote[0] : lote });
      ok += lote.length;
    } catch (e) {
      if (!avisou) { avisou = true; console.error("migracao " + tabela + ":", e.message); }
      if (lote.length === 1 || recusados >= MAX_RECUSADOS) { recusados += lote.length; return; }
      const meio = Math.ceil(lote.length / 2);
      await gravar(lote.slice(0, meio));
      await gravar(lote.slice(meio));
    }
  }
  for (let k = 0; k < linhas.length; k += LOTE) await gravar(linhas.slice(k, k + LOTE));
  return { ok, recusados, pendentes };
}

async function importar(barbeariaId, d, { prazo = Date.now() + TEMPO_IMPORTACAO_MS } = {}) {
  const barb = (await rest(`barbearias?id=eq.${barbeariaId}&select=id,slug,whatsapp`))[0];
  if (!barb) throw erro(404, "Barbearia não encontrada.");
  const hoje = hojeBr();
  const agora = new Date().toISOString();
  // DDD da barbearia: o do telefone dela no Booksy (o coletor manda) ou o do WhatsApp cadastrado no painel
  const dddWhats = String(normalizarWhats(barb.whatsapp) || "").slice(0, 2);
  const ddd = DDD.test(String(d.ddd || "")) ? String(d.ddd) : DDD.test(dddWhats) ? dddWhats : null;
  const resumo = { erros: [] };
  // Uma etapa que falha não derruba as outras. Se o tempo acabou (ou uma etapa ficou pela metade), as seguintes
  // ficam para a próxima coleta: assim os agendamentos só entram depois de todos os clientes, já ligados a eles.
  const etapa = async (nome, fn) => {
    if (resumo.parcial || Date.now() > prazo) { resumo.parcial = true; return; }
    try { await fn(); } catch (e) { console.error("migracao " + nome + ":", e.message); resumo.erros.push(nome); }
  };
  const gravarLotes = async (tabela, linhas) => {
    const g = await inserirEmLotes(tabela, linhas, prazo);
    if (g.pendentes) resumo.parcial = true;
    return g;
  };

  // 1. Equipe: só quem aparece na agenda do Booksy. Quem já existe (mesmo nome) fica ligado, sem duplicar.
  const mapaProf = new Map(); // id do Booksy -> { id, nome }
  // Ficha repetida no Booksy (mesmo WhatsApp ou CPF de outra): não vira outro cliente, mas o agendamento dela
  // precisa achar o cliente que ficou. externo da repetida -> "id:<cliente>" ou "ext:<externo da que ficou>"
  const apelidos = new Map();
  await etapa("equipe", async () => {
    const r = (resumo.equipe = { novos: 0, ligados: 0, jaEstavam: 0 });
    const profs = await rest(`profissionais?barbearia_id=eq.${barbeariaId}&select=id,nome,externo`);
    for (const x of (d.equipe || []).filter((y) => y && y.visivel !== false)) {
      const nome = texto(x.nome, 80);
      if (!nome) continue;
      const ext = externo(x.id);
      let p = profs.find((q) => q.externo === ext) || profs.find((q) => !q.externo && chaveNome(q.nome) === chaveNome(nome));
      if (p && p.externo === ext) r.jaEstavam++;
      else if (p) {
        await rest(`profissionais?id=eq.${p.id}`, { metodo: "PATCH", prefer: "return=minimal", corpo: { externo: ext } });
        p.externo = ext;
        r.ligados++;
      }
      if (!p) {
        [p] = await rest("profissionais", { metodo: "POST", prefer: "return=representation", corpo: { barbearia_id: barbeariaId, nome, externo: ext, ativo: true } });
        profs.push(p);
        r.novos++;
      }
      mapaProf.set(String(x.id), { id: p.id, nome: p.nome });
    }
  });

  // 2. Serviços: entram os que têm preço e ainda não existem (pelo nome); o mapa serve aos agendamentos
  const mapaSvc = new Map();
  await etapa("servicos", async () => {
    const r = (resumo.servicos = { novos: 0, existentes: 0, semPreco: 0 });
    const existentes = await rest(`servicos_precos?barbearia_id=eq.${barbeariaId}&select=nome`);
    const nomes = new Set(existentes.map((s) => chaveNome(s.nome)));
    const novos = [];
    for (const s of d.servicos || []) {
      const nome = texto(s && s.nome, 80);
      if (!nome) continue;
      const preco = numero(s.preco);
      const dur = Number(s.duracao);
      mapaSvc.set(String(s.id), { nome, preco, duracao: dur >= 5 && dur <= 240 ? Math.round(dur) : null });
      if (nomes.has(chaveNome(nome))) { r.existentes++; continue; }
      if (!(preco > 0)) { r.semPreco++; continue; }
      nomes.add(chaveNome(nome));
      novos.push({ barbearia_id: barbeariaId, nome, preco });
    }
    r.novos = (await gravarLotes("servicos_precos", novos)).ok;
  });

  // 3. Produtos: preço e estoque do Booksy; quem já existe (mesmo nome) é atualizado
  await etapa("produtos", async () => {
    const r = (resumo.produtos = { novos: 0, atualizados: 0 });
    const existentes = await rest(`produtos?barbearia_id=eq.${barbeariaId}&select=id,nome,externo`);
    const novos = [];
    for (const x of d.produtos || []) {
      const nome = texto(x && x.nome, 80);
      if (!nome) continue;
      const ext = externo(x.id);
      const preco = numero(x.preco);
      const estoque = Number.isFinite(Number(x.estoque)) ? Math.max(0, Math.round(Number(x.estoque))) : 0;
      const p = existentes.find((q) => q.externo === ext) || existentes.find((q) => chaveNome(q.nome) === chaveNome(nome));
      if (p) {
        const corpo = { externo: ext, estoque, ativo: x.ativo !== false };
        if (preco != null && preco >= 0) corpo.preco = preco;
        if (Date.now() > prazo) { resumo.parcial = true; break; }
        await rest(`produtos?id=eq.${p.id}`, { metodo: "PATCH", prefer: "return=minimal", corpo });
        r.atualizados++;
      } else if (!novos.some((q) => chaveNome(q.nome) === chaveNome(nome))) {
        novos.push({ barbearia_id: barbeariaId, nome, preco: preco != null && preco >= 0 ? preco : 0, estoque, estoque_minimo: 0, ativo: x.ativo !== false, externo: ext });
      }
    }
    r.novos = (await gravarLotes("produtos", novos)).ok;
  });

  // 4. Clientes: WhatsApp, aniversário, CPF válido, observação, última visita e o aceite de comunicações do Booksy.
  //    Quem já está na barbearia (mesmo WhatsApp ou CPF) só tem os campos vazios completados.
  await etapa("clientes", async () => {
    const r = (resumo.clientes = { novos: 0, atualizados: 0, jaEstavam: 0, ignorados: 0 });
    const existentes = await todas(`clientes?barbearia_id=eq.${barbeariaId}&select=id,nome,telefone,cpf,externo,nascimento,observacao,ultima_visita_externa&order=id`);
    const porExt = new Map(existentes.filter((c) => c.externo).map((c) => [c.externo, c]));
    const porTel = new Map(existentes.filter((c) => c.telefone).map((c) => [c.telefone, c]));
    const porCpf = new Map(existentes.filter((c) => c.cpf).map((c) => [c.cpf, c]));
    const vistos = { ext: new Set(), tel: new Map(), cpf: new Map() }; // tel/cpf -> externo de quem ficou
    const novos = [], atualizar = new Map(); // id do cliente -> campos a completar
    for (const x of d.clientes || []) {
      if (!x) continue;
      const ext = externo(x.id);
      if (vistos.ext.has(ext)) continue;
      vistos.ext.add(ext);
      const tel = telefoneDe(x.telefone, ddd);
      const cpf = x.cpf && cpfValido(x.cpf) ? String(x.cpf).replace(/\D/g, "") : null;
      let nome = texto(x.nome, 80);
      // No Booksy, muito cliente fica com o telefone no lugar do nome
      if (nome.replace(/[^A-Za-zÀ-ÿ]/g, "").length < 2) nome = tel ? "Cliente " + telefoneBr(tel) : "";
      if (nome.length < 2) { r.ignorados++; continue; }
      const nasc = lerData(x.nascimento, { semAno: true }) || null;
      const ultimaVisita = diaDe(x.ultimaVisita);
      const obs = texto(x.obs, 300) || null;
      const atual = porExt.get(ext) || (tel && porTel.get(tel)) || (cpf && porCpf.get(cpf));
      if (atual) {
        if (atual.externo !== ext) apelidos.set(ext, "id:" + atual.id);
        const p = {};
        if (PROVISORIO.test(atual.nome || "") && !PROVISORIO.test(nome)) p.nome = nome;
        if (!atual.externo && !porExt.has(ext)) p.externo = ext;
        if (!atual.telefone && tel && !porTel.has(tel)) p.telefone = tel;
        if (!atual.cpf && cpf && !porCpf.has(cpf)) p.cpf = cpf;
        if (!atual.nascimento && nasc) p.nascimento = nasc;
        if (!atual.observacao && obs) p.observacao = obs;
        if (ultimaVisita && (!atual.ultima_visita_externa || ultimaVisita > atual.ultima_visita_externa)) p.ultima_visita_externa = ultimaVisita;
        if (Object.keys(p).length) {
          // A próxima ficha repetida do mesmo cliente compara com o que já ficou (ex.: a última visita mais recente)
          Object.assign(atual, p);
          if (p.externo) porExt.set(p.externo, atual);
          if (p.telefone) porTel.set(p.telefone, atual);
          if (p.cpf) porCpf.set(p.cpf, atual);
          atualizar.set(atual.id, { ...(atualizar.get(atual.id) || {}), ...p, atualizado_em: agora });
        } else r.jaEstavam++;
        continue;
      }
      if ((tel && vistos.tel.has(tel)) || (cpf && vistos.cpf.has(cpf))) {
        apelidos.set(ext, "ext:" + ((tel && vistos.tel.get(tel)) || vistos.cpf.get(cpf)));
        r.ignorados++;
        continue;
      }
      if (tel) vistos.tel.set(tel, ext);
      if (cpf) vistos.cpf.set(cpf, ext);
      const aceita = x.aceita === true;
      novos.push({
        barbearia_id: barbeariaId, nome, telefone: tel, cpf, nascimento: nasc, observacao: obs || "", ultima_visita_externa: ultimaVisita,
        origem: "importacao", externo: ext, aceita_novidades: aceita, aceite_em: aceita ? agora : null, aceite_origem: aceita ? "importacao" : null,
      });
    }
    const g = await gravarLotes("clientes", novos);
    r.novos = g.ok;
    r.ignorados += g.recusados;
    for (const [id, corpo] of atualizar) {
      if (Date.now() > prazo) { resumo.parcial = true; break; }
      try { await rest(`clientes?id=eq.${id}`, { metodo: "PATCH", prefer: "return=minimal", corpo }); r.atualizados++; } catch (e) { r.ignorados++; }
    }
  });

  // 5. Agendamentos de hoje em diante: confirmados e pendentes, ligados ao barbeiro e ao cliente importados.
  //    O que já veio antes sem cliente (o cliente ainda não tinha entrado) fica ligado a ele agora.
  await etapa("agendamentos", async () => {
    const r = (resumo.agendamentos = { novos: 0, jaEstavam: 0, ligados: 0, semBarbeiro: 0, ignorados: 0 });
    const clientes = await todas(`clientes?barbearia_id=eq.${barbeariaId}&select=id,externo,nome&order=id`);
    const porExt = new Map(clientes.filter((c) => c.externo).map((c) => [c.externo, c]));
    const porId = new Map(clientes.map((c) => [c.id, c]));
    const achar = (idBooksy) => {
      if (idBooksy == null || idBooksy === "") return null;
      const ext = externo(idBooksy);
      const a = apelidos.get(ext);
      return porExt.get(ext) || (a && (a.startsWith("id:") ? porId.get(a.slice(3)) : porExt.get(a.slice(4)))) || null;
    };
    const ja = new Map((await todas(`pedidos?barbearia_id=eq.${barbeariaId}&externo=like.booksy:*&select=id,externo,cliente_id&order=id`)).map((p) => [p.externo, p]));
    const novos = [], ligar = [];
    for (const x of d.agendamentos || []) {
      if (!x) continue;
      const ext = externo(x.id);
      if (ja.has(ext)) {
        const antes = ja.get(ext);
        const quem = achar(x.clienteId);
        if (antes && !antes.cliente_id && quem) { ligar.push({ id: antes.id, corpo: { cliente_id: quem.id, cliente: texto(quem.nome, 80) } }); antes.cliente_id = quem.id; }
        r.jaEstavam++;
        continue;
      }
      const dia = diaDe(x.inicio), ini = horaDe(x.inicio), fim = horaDe(x.fim);
      const status = x.status === "A" ? "confirmado" : ["W", "P", "U"].includes(x.status) ? "pendente" : null;
      if (!dia || !ini || dia < hoje || !status) { r.ignorados++; continue; }
      const prof = mapaProf.get(String(x.equipeId));
      if (!prof) { r.semBarbeiro++; continue; }
      const svc = mapaSvc.get(String(x.servicoId)) || {};
      const dur = minutosEntre(x.inicio, x.fim);
      const cli = achar(x.clienteId);
      ja.set(ext, null);
      novos.push({
        slug: barb.slug, codigo: "B" + (/^\d+$/.test(String(x.id)) ? Number(x.id).toString(36).toUpperCase() : String(x.id).slice(-8)),
        servico: texto(x.servicoNome || svc.nome, 80) || "Atendimento", profissional: prof.nome, profissional_id: prof.id,
        dia, horario: ini, horario_fim: fim, duracao_min: Number.isFinite(dur) && dur >= 5 ? Math.min(240, dur) : svc.duracao || 30,
        cliente: texto((cli && cli.nome) || x.clienteNome, 80) || "Cliente", cliente_id: cli ? cli.id : null,
        status, barbearia_id: barbeariaId, valor: svc.preco > 0 ? svc.preco : null, observacao: texto(x.obs, 200) || "",
        origem: "booksy", externo: ext, simulado: false,
      });
    }
    const g = await gravarLotes("pedidos", novos);
    r.novos = g.ok;
    r.ignorados += g.recusados;
    for (const l of ligar) {
      if (Date.now() > prazo) { resumo.parcial = true; break; }
      try { await rest(`pedidos?id=eq.${l.id}&cliente_id=is.null`, { metodo: "PATCH", prefer: "return=minimal", corpo: l.corpo }); r.ligados++; } catch (e) { console.error("migracao ligar agendamento:", e.message); }
    }
  });

  // 6. Bloqueios de horário de hoje em diante (o site não oferece esses horários)
  await etapa("bloqueios", async () => {
    const r = (resumo.bloqueios = { novos: 0, jaEstavam: 0 });
    const ids = [...new Set([...mapaProf.values()].map((p) => p.id))];
    if (!ids.length) return;
    const ja = new Set((await rest(`bloqueios?profissional_id=in.(${ids.join(",")})&externo=like.booksy:*&select=externo`)).map((b2) => b2.externo));
    const novos = [];
    for (const x of d.bloqueios || []) {
      if (!x) continue;
      const ext = externo(x.id);
      if (ja.has(ext)) { r.jaEstavam++; continue; }
      const dia = diaDe(x.inicio), ini = horaDe(x.inicio), fim = horaDe(x.fim);
      const prof = mapaProf.get(String(x.equipeId));
      if (!dia || dia < hoje || !ini || !fim || fim <= ini || diaDe(x.fim) !== dia || !prof) continue;
      ja.add(ext);
      novos.push({ profissional_id: prof.id, tipo: "pontual", data: dia, inicio: ini, fim, motivo: texto(x.motivo, 80) || "Bloqueio (Booksy)", externo: ext });
    }
    r.novos = (await gravarLotes("bloqueios", novos)).ok;
  });

  if (!resumo.erros.length) delete resumo.erros;
  if (resumo.parcial) console.error("migracao: parte ficou para a próxima coleta (tempo ou etapa pela metade)");
  return resumo;
}

module.exports = { criar, ultima, receber, importar, cors, ORIGENS, numero, externo, _: { hash, diaDe, horaDe, minutosEntre } };
