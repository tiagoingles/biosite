// Confirmação de presença pelo celular do cliente (fase 23). O aviso de confirmação (e o de mudança de
// horário) leva um link assinado: /<slug>?confirmar=<id do pedido>.<assinatura>. Quem tem o link vê o
// horário e responde; ninguém consegue montar o link de outro pedido sem a chave do servidor.
// GET  /api/config?presenca=TOKEN                       o horário (serviço, dia, hora, barbeiro, situação)
// POST /api/config { tipo: "presenca", token, resposta } "sim" confirma; "nao" cancela e libera o horário
//      (o barbeiro e o dono recebem o aviso no celular).
const crypto = require("crypto");
const { rest } = require("./supabase");
const { hojeBr, agoraMinBr, minutos } = require("./horarios");
const { contarTentativas, origemDe, UUID } = require("./seguranca");
const { enviarPara, donosDe } = require("./avisos");

const ATIVOS = ["pendente", "confirmado", "avulso"];
const segredo = () => process.env.PRESENCA_SEGREDO || process.env.SUPABASE_SERVICE_KEY || "biosite-dev";
const assinatura = (id) => crypto.createHmac("sha256", segredo()).update("presenca:" + id).digest("base64url").slice(0, 16);

function token(pedidoId) {
  return `${pedidoId}.${assinatura(pedidoId)}`;
}

// Devolve o id do pedido se a assinatura confere; senão, null
function lerToken(t) {
  const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{16})$/i.exec(String(t || ""));
  if (!m || !UUID.test(m[1])) return null;
  const a = Buffer.from(m[2]);
  const b = Buffer.from(assinatura(m[1].toLowerCase()));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? m[1].toLowerCase() : null;
}

const hm = (h) => String(h || "").slice(0, 5);
// Já passou? Vale até 30 minutos depois do horário (o cliente pode responder em cima da hora)
function passou(p, hoje = hojeBr(), agora = agoraMinBr()) {
  return p.dia < hoje || (p.dia === hoje && minutos(hm(p.horario)) + 30 < agora);
}

const CAMPOS = "id,barbearia_id,profissional_id,slug,servico,profissional,dia,horario,status,cliente,cliente_resposta,sinal_status,barbearias(nome,slug)";

async function pedidoDoToken(t) {
  const id = lerToken(t);
  if (!id) return null;
  return (await rest(`pedidos?id=eq.${id}&select=${CAMPOS}`))[0] || null;
}

async function info(req, res, t) {
  res.setHeader("Cache-Control", "no-store");
  if ((await contarTentativas(`presenca:${origemDe(req) || "sem-origem"}`, 3600, true)) > 60) return res.status(429).json({ message: "Muitas tentativas. Fale com a barbearia pelo WhatsApp." });
  const p = await pedidoDoToken(t);
  if (!p) return res.status(404).json({ message: "Link inválido. Fale com a barbearia pelo WhatsApp." });
  const b = p.barbearias || {};
  return res.status(200).json({
    barbearia: b.nome || "",
    servico: p.servico,
    profissional: p.profissional || "",
    dia: p.dia,
    horario: hm(p.horario),
    hoje: hojeBr(),
    status: p.status,
    resposta: p.cliente_resposta || "",
    passou: passou(p),
  });
}

async function responder(req, res, b) {
  res.setHeader("Cache-Control", "no-store");
  if ((await contarTentativas(`presenca:${origemDe(req) || "sem-origem"}`, 3600, true)) > 60) return res.status(429).json({ message: "Muitas tentativas. Fale com a barbearia pelo WhatsApp." });
  const resposta = b.resposta === "sim" || b.resposta === "nao" ? b.resposta : "";
  if (!resposta) return res.status(400).json({ message: "Resposta inválida." });
  const p = await pedidoDoToken(b.token);
  if (!p) return res.status(404).json({ message: "Link inválido. Fale com a barbearia pelo WhatsApp." });
  if (!ATIVOS.includes(p.status)) {
    const msg = p.status === "cancelado" ? "Este horário já foi cancelado." : p.status === "realizado" ? "Este atendimento já foi feito." : "Este horário não está mais ativo.";
    return res.status(409).json({ message: msg, status: p.status });
  }
  if (passou(p)) return res.status(410).json({ message: "O horário já passou. Fale com a barbearia pelo WhatsApp." });
  const agora = new Date().toISOString();
  const corpo = resposta === "sim" ? { cliente_resposta: "sim", cliente_respondeu_em: agora } : { status: "cancelado", cliente_resposta: "nao", cliente_respondeu_em: agora };
  const [novo] = await rest(`pedidos?id=eq.${p.id}&status=in.(${ATIVOS.join(",")})`, { metodo: "PATCH", prefer: "return=representation", corpo });
  if (!novo) return res.status(409).json({ message: "Este horário mudou. Atualize a página." });
  if (resposta === "nao") {
    // Cancelou pelo celular: o barbeiro (se tem login) e os donos ficam sabendo na hora. Espera o envio (até 4 s):
    // na Vercel, o que fica rodando depois da resposta pode não terminar.
    await Promise.race([
      avisarCancelamento(p).catch((e) => console.error("aviso de cancelamento pelo cliente:", e.message)),
      new Promise((ok) => setTimeout(ok, 4000)),
    ]);
  }
  return res.status(200).json({ ok: true, status: novo.status, resposta });
}

async function avisarCancelamento(p) {
  const quem = await donosDe(p.barbearia_id);
  if (p.profissional_id) {
    const prof = (await rest(`profissionais?id=eq.${p.profissional_id}&select=perfil_user_id`))[0];
    if (prof && prof.perfil_user_id && !quem.has(prof.perfil_user_id)) quem.set(prof.perfil_user_id, "barbeiro");
  }
  const dia = p.dia === hojeBr() ? "hoje" : `${p.dia.slice(8, 10)}/${p.dia.slice(5, 7)}`;
  const body = `${p.cliente} · ${dia} às ${hm(p.horario)} · ${p.servico}. O horário ficou livre.${p.sinal_status === "pago" ? " Ele tinha pago o sinal." : ""}`;
  return enviarPara(quem, { title: "Cliente cancelou pelo celular", body });
}

module.exports = { token, lerToken, info, responder, passou };
