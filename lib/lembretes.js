// Gestão de atrasos (fase 21): avisos perto da hora do atendimento.
// GET /api/config?lembretes=proximos   chamado a cada 5 minutos pelo agendador do banco (pg_cron + pg_net).
//   - "Cliente chegando": no celular do barbeiro (ou do dono, se o barbeiro não tem login), 5 a 15 min antes;
//   - lembrete no celular do cliente que pediu no site, 20 a 30 min antes;
//   - "Cliente atrasado": 10 a 20 min depois do horário, se ninguém marcou "Chegou" (e o cliente recebe
//     "estamos te esperando").
//   Cada aviso sai uma vez só por atendimento (trava em avisos_pedido). Chamar fora de hora não faz mal:
//   só sai o que já está na janela, e a origem é limitada (no máximo 6 chamadas por minuto).
// POST /api/config { tipo: "lembrete-cliente", slug, codigo, subscription }  o cliente liga o lembrete no
//   celular logo depois de pedir o horário no site (até 1 hora depois do pedido).
const { rest } = require("./supabase");
const { enviar, endpointDePushValido } = require("./webpush");
const { hojeBr, agoraMinBr, minutos } = require("./horarios");
const { contarTentativas, origemDe } = require("./seguranca");
const { enviarPara, donosDe } = require("./avisos");

const pushConfigurado = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
const CODIGO = /^[A-Z0-9]{4,6}$/;

// Tipos de aviso pelo tempo até o horário (minutos; negativo = já passou)
function avisosDe(p, agora) {
  const falta = minutos(String(p.horario).slice(0, 5)) - agora;
  const tipos = [];
  if (falta > 5 && falta <= 15) tipos.push("chega");
  if (falta > 20 && falta <= 30) tipos.push("cliente30");
  if (falta <= -10 && falta > -20 && !p.chegou_em && p.status === "confirmado") tipos.push("atraso", "cliente_atraso");
  return { falta, tipos };
}

// Reserva o aviso (uma vez por atendimento e tipo): devolve true só para quem reservou primeiro
async function reservar(pedidoId, tipo) {
  const r = await rest("avisos_pedido?on_conflict=pedido_id,tipo", { metodo: "POST", prefer: "resolution=ignore-duplicates,return=representation", corpo: { pedido_id: pedidoId, tipo } });
  return Array.isArray(r) && r.length > 0;
}

const hm = (h) => String(h).slice(0, 5);

async function paraCliente(p, aviso) {
  const subs = await rest(`push_clientes?pedido_id=eq.${p.id}&select=endpoint,p256dh,auth_key`);
  let n = 0;
  for (const s of subs) {
    const ok = await enviar({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } }, { ...aviso, url: "/" + p.slug }).catch(() => null);
    if (ok) n++;
    if (ok === false) await rest(`push_clientes?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { metodo: "DELETE", prefer: "return=minimal" }).catch(() => {});
  }
  return n;
}

async function proximos(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if ((await contarTentativas(`lembretes:${origemDe(req) || "sem-origem"}`, 60, true)) > 6) return res.status(429).json({ message: "Chamadas demais." });
  if (!pushConfigurado()) return res.status(200).json({ avisos: 0, motivo: "Web Push não configurado" });
  const hoje = hojeBr();
  const agora = agoraMinBr();
  const pedidos = await rest(`pedidos?dia=eq.${hoje}&status=in.(confirmado,avulso)&simulado=eq.false&select=id,barbearia_id,slug,profissional_id,servico,horario,cliente,chegou_em,status&order=horario.asc&limit=2000`);
  const agora_ = pedidos.map((p) => ({ p, ...avisosDe(p, agora) })).filter((x) => x.tipos.length);
  if (!agora_.length) return res.status(200).json({ avisos: 0 });

  // Quem recebe no celular: o barbeiro do atendimento; sem login, os donos da barbearia
  const ids = [...new Set(agora_.map((x) => x.p.profissional_id).filter(Boolean))];
  const profs = ids.length ? await rest(`profissionais?id=in.(${ids.join(",")})&select=id,perfil_user_id,barbearia_id`) : [];
  const loginDe = Object.fromEntries(profs.map((x) => [x.id, x.perfil_user_id]));
  const donosCache = {};
  async function destinatarios(p) {
    const u = loginDe[p.profissional_id];
    if (u) return new Map([[u, "barbeiro"]]);
    if (!donosCache[p.barbearia_id]) donosCache[p.barbearia_id] = await donosDe(p.barbearia_id);
    return donosCache[p.barbearia_id];
  }

  let avisos = 0;
  for (const { p, falta, tipos } of agora_) {
    for (const tipo of tipos) {
      if (!(await reservar(p.id, tipo))) continue;
      try {
        if (tipo === "chega") {
          avisos += await enviarPara(await destinatarios(p), { title: "Cliente chegando", body: `${p.cliente} · ${hm(p.horario)} · ${p.servico} (em ${falta} min)` });
        } else if (tipo === "atraso") {
          avisos += await enviarPara(await destinatarios(p), { title: "Cliente atrasado", body: `${p.cliente} está ${-falta} min atrasado · ${hm(p.horario)} ${p.servico}. Marque "Chegou" ou avise pelo WhatsApp.` });
        } else if (tipo === "cliente30") {
          avisos += await paraCliente(p, { title: "Seu horário está chegando", body: `${p.servico} às ${hm(p.horario)}. Até já!` });
        } else if (tipo === "cliente_atraso") {
          avisos += await paraCliente(p, { title: "Estamos te esperando", body: `Seu horário era às ${hm(p.horario)}. Se for atrasar, avise a barbearia pelo WhatsApp.` });
        }
      } catch (e) {
        console.error("aviso perto da hora:", tipo, e.message);
      }
    }
  }
  return res.status(200).json({ avisos });
}

// O cliente liga o lembrete no celular logo depois de pedir o horário
async function inscreverCliente(req, res, b) {
  res.setHeader("Cache-Control", "no-store");
  if ((await contarTentativas(`lembrete-cliente:${origemDe(req) || "sem-origem"}`, 3600, true)) > 20) return res.status(429).json({ message: "Muitas tentativas. Use \"Salvar na agenda do celular\"." });
  const s = b.subscription || {};
  const endpoint = String(s.endpoint || "");
  const p256dh = String((s.keys || {}).p256dh || "");
  const auth = String((s.keys || {}).auth || "");
  if (endpoint.length > 2000 || !endpointDePushValido(endpoint) || !/^[A-Za-z0-9_-]{20,200}$/.test(p256dh) || !/^[A-Za-z0-9_-]{8,100}$/.test(auth)) {
    return res.status(400).json({ message: "Este navegador não deu para ligar o lembrete." });
  }
  const slug = String(b.slug || "");
  const codigo = String(b.codigo || "").toUpperCase();
  if (!/^[a-z0-9-]{3,40}$/.test(slug) || !CODIGO.test(codigo)) return res.status(400).json({ message: "Pedido inválido." });
  // Só logo depois do pedido (1 hora): ninguém fica testando códigos antigos
  const desde = new Date(Date.now() - 3600e3).toISOString();
  const p = (await rest(`pedidos?slug=eq.${slug}&codigo=eq.${codigo}&dia=gte.${hojeBr()}&status=in.(pendente,confirmado)&criado_em=gte.${desde}&select=id`))[0];
  if (!p) return res.status(404).json({ message: "Pedido não encontrado." });
  await rest("push_clientes?on_conflict=pedido_id,endpoint", { metodo: "POST", prefer: "resolution=ignore-duplicates,return=minimal", corpo: { pedido_id: p.id, endpoint, p256dh, auth_key: auth } });
  return res.status(201).json({ ok: true });
}

module.exports = { proximos, inscreverCliente, avisosDe };
