// Gestão de atrasos (fase 21) e confirmação de presença (fase 23): avisos perto da hora do atendimento.
// GET /api/config?lembretes=proximos   chamado a cada 5 minutos pelo agendador do banco (pg_cron + pg_net).
//   - "Cliente chegando": no celular do barbeiro (ou do dono, se o barbeiro não tem login), 5 a 15 min antes;
//   - lembrete no celular do cliente com os avisos ligados, 20 a 30 min antes;
//   - "Cliente atrasado": 10 a 20 min depois do horário, se ninguém marcou "Chegou" (e o cliente recebe
//     "estamos te esperando");
//   - "Confirme seu horário": X minutos antes (a barbearia escolhe: 1, 2, 3 ou 24 horas), com os botões
//     "Confirmo" e "Não vou poder ir". Só entre 7h e 22h; quem já respondeu não recebe de novo.
//   Cada aviso sai uma vez só por atendimento (trava em avisos_pedido). Chamar fora de hora não faz mal:
//   só sai o que já está na janela, e a origem é limitada (no máximo 6 chamadas por minuto).
// O cliente liga os avisos no site (lib/app-cliente.js, POST /api/config { tipo: "lembrete-cliente" }).
const { rest } = require("./supabase");
const { hojeBr, agoraMinBr, minutos, somaDias } = require("./horarios");
const { contarTentativas, origemDe } = require("./seguranca");
const { enviarPara, donosDe } = require("./avisos");
const appCliente = require("./app-cliente");
const presenca = require("./presenca");
const sinal = require("./sinal");

const pushConfigurado = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
const hm = (h) => String(h).slice(0, 5);
// Pedido de confirmação só em hora de gente acordada (horário de Brasília)
const horaBoa = (agora) => agora >= 7 * 60 && agora < 22 * 60;

// Tipos de aviso pelo tempo até o horário (minutos; negativo = já passou).
// opc.amanha: o pedido é de amanhã (só o pedido de confirmação de 24 horas alcança);
// opc.confirmarMin: a barbearia pede confirmação X minutos antes (0 = não pede).
function avisosDe(p, agora, opc = {}) {
  const falta = (opc.amanha ? 1440 : 0) + minutos(hm(p.horario)) - agora;
  const tipos = [];
  if (!opc.amanha) {
    if (falta > 5 && falta <= 15) tipos.push("chega");
    if (falta > 20 && falta <= 30) tipos.push("cliente30");
    if (falta <= -10 && falta > -20 && !p.chegou_em && p.status === "confirmado") tipos.push("atraso", "cliente_atraso");
  }
  const min = Number(opc.confirmarMin) || 0;
  if (min && falta <= min && falta > 20 && p.status === "confirmado" && !p.cliente_resposta && horaBoa(agora)) tipos.push("confirmar");
  return { falta, tipos };
}

// Reserva o aviso (uma vez por atendimento e tipo): devolve true só para quem reservou primeiro
async function reservar(pedidoId, tipo) {
  const r = await rest("avisos_pedido?on_conflict=pedido_id,tipo", { metodo: "POST", prefer: "resolution=ignore-duplicates,return=representation", corpo: { pedido_id: pedidoId, tipo } });
  return Array.isArray(r) && r.length > 0;
}

// Aviso de confirmação: o link assinado abre o horário no site; os botões respondem sem abrir nada
function avisoDeConfirmacao(p, quando) {
  const t = presenca.token(p.id);
  return {
    title: "Confirme seu horário",
    body: `${p.servico} ${quando} às ${hm(p.horario)}${p.profissional ? " com " + p.profissional : ""}. Você vem?`,
    url: `/${p.slug}?confirmar=${t}`,
    tag: "confirmar-" + String(p.id).slice(0, 8),
    token: t,
    acoes: [{ action: "sim", title: "Confirmo" }, { action: "nao", title: "Não vou poder ir" }],
  };
}

const CAMPOS = "id,barbearia_id,slug,profissional_id,profissional,servico,dia,horario,cliente,cliente_id,chegou_em,status,cliente_resposta";

async function proximos(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if ((await contarTentativas(`lembretes:${origemDe(req) || "sem-origem"}`, 60, true)) > 6) return res.status(429).json({ message: "Chamadas demais." });
  // Sinal no Pix que passou do prazo: o pedido é cancelado e o horário volta a ficar livre (fase 22)
  const expirados = await sinal.expirar().catch((e) => { console.error("sinal expirado:", e.message); return 0; });
  if (!pushConfigurado()) return res.status(200).json({ avisos: 0, expirados, motivo: "Web Push não configurado" });
  const hoje = hojeBr();
  const amanha = somaDias(hoje, 1);
  const agora = agoraMinBr();
  const [deHoje, deAmanha] = await Promise.all([
    rest(`pedidos?dia=eq.${hoje}&status=in.(confirmado,avulso)&simulado=eq.false&select=${CAMPOS}&order=horario.asc&limit=2000`),
    // Amanhã, só quem ainda pode receber o pedido de confirmação de 24 horas
    rest(`pedidos?dia=eq.${amanha}&status=eq.confirmado&cliente_resposta=is.null&simulado=eq.false&select=${CAMPOS}&order=horario.asc&limit=2000`),
  ]);
  // Quanto antes cada barbearia pede a confirmação (null = não pede)
  const lojas = [...new Set([...deHoje, ...deAmanha].map((p) => p.barbearia_id).filter(Boolean))];
  const config = lojas.length ? await rest(`barbearias?id=in.(${lojas.join(",")})&select=id,pedir_confirmacao_min`).catch(() => []) : [];
  const minDe = Object.fromEntries(config.map((b) => [b.id, Number(b.pedir_confirmacao_min) || 0]));
  const agora_ = [
    ...deHoje.map((p) => ({ p, quando: "hoje", ...avisosDe(p, agora, { confirmarMin: minDe[p.barbearia_id] }) })),
    ...deAmanha.map((p) => ({ p, quando: "amanhã", ...avisosDe(p, agora, { amanha: true, confirmarMin: minDe[p.barbearia_id] }) })),
  ].filter((x) => x.tipos.length);
  if (!agora_.length) return res.status(200).json({ avisos: 0, expirados });

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
  for (const { p, falta, tipos, quando } of agora_) {
    for (const tipo of tipos) {
      if (!(await reservar(p.id, tipo))) continue;
      try {
        if (tipo === "chega") {
          avisos += await enviarPara(await destinatarios(p), { title: "Cliente chegando", body: `${p.cliente} · ${hm(p.horario)} · ${p.servico} (em ${falta} min)` });
        } else if (tipo === "atraso") {
          avisos += await enviarPara(await destinatarios(p), { title: "Cliente atrasado", body: `${p.cliente} está ${-falta} min atrasado · ${hm(p.horario)} ${p.servico}. Marque "Chegou" ou avise pelo WhatsApp.` });
        } else if (tipo === "cliente30") {
          avisos += await appCliente.enviarAoCliente(p, { title: "Seu horário está chegando", body: `${p.servico} às ${hm(p.horario)}. Até já!` });
        } else if (tipo === "cliente_atraso") {
          avisos += await appCliente.enviarAoCliente(p, { title: "Estamos te esperando", body: `Seu horário era às ${hm(p.horario)}. Se for atrasar, avise a barbearia pelo WhatsApp.` });
        } else if (tipo === "confirmar") {
          avisos += await appCliente.enviarAoCliente(p, avisoDeConfirmacao(p, quando));
        }
      } catch (e) {
        console.error("aviso perto da hora:", tipo, e.message);
      }
    }
  }
  return res.status(200).json({ avisos, expirados });
}

module.exports = { proximos, avisosDe, avisoDeConfirmacao, inscreverCliente: appCliente.inscrever };
