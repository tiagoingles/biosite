// Avisos no celular do cliente (fase 23): o "app" da barbearia. O cliente coloca o site na tela do
// celular e liga os avisos uma vez; daí em diante recebe o lembrete, o pedido de confirmação e as mudanças
// de horário de todos os agendamentos, e as novidades que o dono mandar (se aceitou).
// POST /api/config { tipo: "lembrete-cliente", slug, subscription, codigo?, app?, novidades? }
//   - com codigo (até 1 hora depois do pedido): liga o aparelho ao pedido (e ao cadastro do cliente, se o
//     pedido tem WhatsApp). As páginas antigas (gerador v11) mandam só isto;
//   - app: true: guarda o aparelho na barbearia (clientes_push), mesmo sem pedido. novidades: true quando o
//     botão do site pediu também as novidades.
// Cada barbearia só alcança os aparelhos dela; assinatura que o serviço de push recusa (404/410) é apagada.
const { rest } = require("./supabase");
const { enviar, endpointDePushValido } = require("./webpush");
const { hojeBr } = require("./horarios");
const { contarTentativas, origemDe } = require("./seguranca");

const CODIGO = /^[A-Z0-9]{4,6}$/;
const SLUG = /^[a-z0-9-]{3,40}$/;
const SITE = (process.env.SITE_URL || "https://barbeirotop.com.br").replace(/\/+$/, "");

function lerInscricao(s) {
  s = s || {};
  const endpoint = String(s.endpoint || "");
  const p256dh = String((s.keys || {}).p256dh || "");
  const auth = String((s.keys || {}).auth || "");
  if (endpoint.length > 2000 || !endpointDePushValido(endpoint) || !/^[A-Za-z0-9_-]{20,200}$/.test(p256dh) || !/^[A-Za-z0-9_-]{8,100}$/.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

async function inscrever(req, res, b) {
  res.setHeader("Cache-Control", "no-store");
  if ((await contarTentativas(`lembrete-cliente:${origemDe(req) || "sem-origem"}`, 3600, true)) > 30) return res.status(429).json({ message: "Muitas tentativas. Use \"Salvar na agenda do celular\"." });
  const ins = lerInscricao(b.subscription);
  if (!ins) return res.status(400).json({ message: "Este navegador não deu para ligar os avisos." });
  const slug = String(b.slug || "");
  const codigo = String(b.codigo || "").toUpperCase();
  if (!SLUG.test(slug) || (codigo && !CODIGO.test(codigo)) || (!codigo && b.app !== true)) return res.status(400).json({ message: "Pedido inválido." });

  let pedido = null;
  if (codigo) {
    // Só logo depois do pedido (1 hora): ninguém fica testando códigos antigos
    const desde = new Date(Date.now() - 3600e3).toISOString();
    pedido = (await rest(`pedidos?slug=eq.${slug}&codigo=eq.${codigo}&dia=gte.${hojeBr()}&status=in.(pendente,confirmado)&criado_em=gte.${desde}&select=id,barbearia_id,cliente_id`))[0];
    if (!pedido) return res.status(404).json({ message: "Pedido não encontrado." });
    await rest("push_clientes?on_conflict=pedido_id,endpoint", { metodo: "POST", prefer: "resolution=ignore-duplicates,return=minimal", corpo: { pedido_id: pedido.id, endpoint: ins.endpoint, p256dh: ins.p256dh, auth_key: ins.auth } });
  }
  if (b.app === true) {
    const barbeariaId = pedido ? pedido.barbearia_id : ((await rest(`barbearias?slug=eq.${slug}&select=id`))[0] || {}).id;
    if (!barbeariaId) return res.status(404).json({ message: "Barbearia não encontrada." });
    const corpo = { barbearia_id: barbeariaId, endpoint: ins.endpoint, p256dh: ins.p256dh, auth_key: ins.auth, visto_em: new Date().toISOString() };
    // O aceite das novidades só liga (nunca desliga sozinho) e o cadastro só muda quando o pedido tem cliente
    if (b.novidades === true) corpo.novidades = true;
    if (pedido && pedido.cliente_id) corpo.cliente_id = pedido.cliente_id;
    await rest("clientes_push?on_conflict=barbearia_id,endpoint", { metodo: "POST", prefer: "resolution=merge-duplicates,return=minimal", corpo });
  }
  return res.status(201).json({ ok: true, ligadoAoPedido: !!pedido });
}

// Aparelhos que recebem os avisos de um atendimento: os ligados ao pedido e os do cadastro do cliente
async function aparelhosDoPedido(p) {
  const [doPedido, doCliente] = await Promise.all([
    rest(`push_clientes?pedido_id=eq.${p.id}&select=endpoint,p256dh,auth_key`),
    p.cliente_id && p.barbearia_id ? rest(`clientes_push?cliente_id=eq.${p.cliente_id}&barbearia_id=eq.${p.barbearia_id}&select=id,endpoint,p256dh,auth_key`) : [],
  ]);
  const vistos = new Set();
  const lista = [];
  for (const a of [...doCliente.map((x) => ({ ...x, tabela: "clientes_push" })), ...doPedido.map((x) => ({ ...x, tabela: "push_clientes" }))]) {
    if (vistos.has(a.endpoint)) continue;
    vistos.add(a.endpoint);
    lista.push(a);
  }
  return lista;
}

// Manda o aviso para os aparelhos; devolve quantos receberam. Recusado pelo serviço (404/410): apaga.
async function enviarAparelhos(lista, aviso) {
  let entregues = 0;
  await Promise.allSettled(
    lista.map(async (a) => {
      const ok = await enviar({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth_key } }, aviso).catch((e) => {
        console.error("push do cliente falhou:", e.message);
        return null;
      });
      if (ok) entregues++;
      if (ok === false) await rest(`${a.tabela || "clientes_push"}?endpoint=eq.${encodeURIComponent(a.endpoint)}`, { metodo: "DELETE", prefer: "return=minimal" }).catch(() => {});
    })
  );
  return entregues;
}

async function enviarAoCliente(p, aviso) {
  const lista = await aparelhosDoPedido(p);
  if (!lista.length) return 0;
  const icon = aviso.icon || (await iconeDoSite(p.slug));
  return enviarAparelhos(lista, { url: "/" + p.slug, ...aviso, ...(icon ? { icon } : {}) });
}

// Ícone da barbearia para o aviso: o mesmo do app (está no manifesto do site). Guardado por 10 minutos.
const icones = new Map();
async function iconeDoSite(slug) {
  if (!SLUG.test(String(slug || ""))) return "";
  const guardado = icones.get(slug);
  if (guardado && guardado.ate > Date.now()) return guardado.icone;
  let icone = "";
  try {
    const r = await fetch(`${SITE}/${slug}.webmanifest`, { signal: AbortSignal.timeout(2500) });
    if (r.ok) {
      const m = await r.json();
      const i = (m.icons || []).find((x) => x && /^\/img\/[a-z0-9-]+\/[\w.-]+\.png$/.test(String(x.src || "")));
      icone = i ? i.src : "";
    }
  } catch (e) {
    icone = "";
  }
  icones.set(slug, { icone, ate: Date.now() + 600e3 });
  return icone;
}

module.exports = { inscrever, lerInscricao, aparelhosDoPedido, enviarAparelhos, enviarAoCliente, iconeDoSite };
