// Avisos no celular (Web Push) para o dono e o barbeiro:
// - avisarNovoPedido: chegou um pedido novo (dono e barbeiro do pedido);
// - avisoDiarioDoClube: de manhã, assinantes do clube para lembrar da mensalidade (só o dono).
// Falha de aviso nunca derruba o pedido: quem chama deve tratar o erro como aviso perdido.
const { rest, todas } = require("./supabase");
const { enviar } = require("./webpush");
const { hojeBr, agoraMinBr, somaDias } = require("./horarios");
const { falha, segredoIgual } = require("./seguranca");
const { vencimento, avisoDoClube, LEMBRAR_ANTES, AVISO_ATE } = require("./clube");

const pushConfigurado = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

// Manda o aviso para todos os aparelhos inscritos destes usuários. papelDe: user_id -> papel.
// Devolve quantos aparelhos receberam. Assinatura expirada é apagada para não tentar de novo.
async function enviarPara(papelDe, aviso) {
  const ids = [...papelDe.keys()];
  if (!ids.length) return 0;
  const inscricoes = await rest(`push_inscricoes?user_id=in.(${ids.join(",")})&select=endpoint,p256dh,auth_key,user_id`);
  console.log("avisos: destinatarios", ids.length, "assinaturas", inscricoes.length);
  let entregues = 0;
  await Promise.allSettled(
    inscricoes.map(async (i) => {
      const papel = papelDe.get(i.user_id);
      const url = aviso.url || (papel === "barbeiro" ? "/painel-barbeiro.html" : "/painel-dono.html");
      const entregue = await enviar({ endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth_key } }, { ...aviso, url }).catch((e) => {
        console.error("push falhou:", e.message);
        return null; // erro do serviço não apaga a assinatura
      });
      console.log("push enviado:", entregue ? "ok" : entregue === false ? "assinatura expirada" : "erro");
      if (entregue) entregues++;
      if (entregue === false) await rest(`push_inscricoes?endpoint=eq.${encodeURIComponent(i.endpoint)}`, { metodo: "DELETE", prefer: "return=minimal" });
    })
  );
  return entregues;
}

// Donos e donos-barbeiros da barbearia
async function donosDe(barbearia_id) {
  const donos = await rest(`perfis?barbearia_id=eq.${barbearia_id}&papel=in.(dono,dono_barbeiro)&select=user_id,papel`);
  return new Map(donos.map((d) => [d.user_id, d.papel]));
}

async function avisarNovoPedido({ barbearia_id, profissional_id, cliente, servico, dia, horario, confirmado }) {
  if (!pushConfigurado()) return;

  // Quem recebe: dono e dono-barbeiro, e o barbeiro do pedido
  const papelDe = await donosDe(barbearia_id);
  const barbeiro = profissional_id
    ? await rest(`profissionais?id=eq.${profissional_id}&select=perfil_user_id`)
    : [];
  if (barbeiro[0] && barbeiro[0].perfil_user_id) papelDe.set(barbeiro[0].perfil_user_id, "barbeiro");
  await enviarPara(papelDe, {
    title: confirmado ? "Novo agendamento (já confirmado)" : "Novo agendamento",
    body: `${cliente} · ${servico} · ${dia.split("-").reverse().slice(0, 2).join("/")} ${horario}`,
  });
}

// ---------- aviso diário do clube ----------
// Chamado pelo agendador da Vercel ("crons" no vercel.json), todo dia às 9h de Brasília.
// Com CRON_SECRET na Vercel, exige o segredo que o agendador manda; sem ele, aceita só o agendador.
// Mesmo chamado de novo, cada barbearia recebe no máximo um aviso por dia (trava em clube_avisos_diarios).
function chamadaDoAgendador(req) {
  const segredo = process.env.CRON_SECRET;
  if (segredo) return segredoIgual(String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""), segredo);
  return /^vercel-cron\//i.test(String(req.headers["user-agent"] || ""));
}

async function avisoDiarioDoClube(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (!chamadaDoAgendador(req)) return res.status(401).json({ message: "Só o agendador da Vercel chama este endereço." });
    if (!pushConfigurado()) return res.status(200).json({ ok: true, avisos: 0, motivo: "push não configurado" });
    // Nunca de madrugada, mesmo se alguém chamar fora da hora
    const hora = Math.floor(agoraMinBr() / 60);
    if (hora < 8 || hora >= 20) return res.status(200).json({ ok: true, avisos: 0, motivo: "fora do horário" });

    const hoje = hojeBr();
    const perto = await todas(`clube_assinantes?status=eq.ativo&pago_ate=gte.${somaDias(hoje, -AVISO_ATE)}&pago_ate=lte.${somaDias(hoje, LEMBRAR_ANTES)}&select=id,barbearia_id,nome,status,pago_ate,lembrete_em,lembrete_pago_ate&order=id`);
    const porBarbearia = new Map();
    for (const a of perto) {
      const v = vencimento(a, hoje);
      if (!v || v.lembrado) continue;
      if (!porBarbearia.has(a.barbearia_id)) porBarbearia.set(a.barbearia_id, []);
      porBarbearia.get(a.barbearia_id).push({ nome: a.nome, dias: v.dias });
    }

    let avisos = 0;
    let barbearias = 0;
    for (const [barbeariaId, lista] of porBarbearia) {
      // Reserva o aviso de hoje; se já estava reservado (outra chamada), não avisa de novo
      const reserva = await rest("clube_avisos_diarios?on_conflict=barbearia_id,dia", {
        metodo: "POST",
        prefer: "resolution=ignore-duplicates,return=representation",
        corpo: { barbearia_id: barbeariaId, dia: hoje, assinantes: lista.length },
      });
      if (!reserva || !reserva.length) continue;
      barbearias++;
      avisos += await enviarPara(await donosDe(barbeariaId), avisoDoClube(lista)).catch((e) => {
        console.error("aviso diario do clube falhou:", e.message);
        return 0;
      });
    }
    // Guarda só os últimos 60 dias de travas
    await rest(`clube_avisos_diarios?dia=lt.${somaDias(hoje, -60)}`, { metodo: "DELETE", prefer: "return=minimal" }).catch(() => {});
    console.log("aviso diario do clube: barbearias", barbearias, "avisos", avisos);
    return res.status(200).json({ ok: true, barbearias, avisos });
  } catch (e) {
    return falha(res, e, "GET /api/config?lembretes=clube");
  }
}

// Estoque de um produto chegou ao mínimo (ou acabou) numa venda: avisa o dono no celular
async function avisarEstoqueBaixo({ barbearia_id, nome, estoque }) {
  if (!pushConfigurado()) return;
  await enviarPara(await donosDe(barbearia_id), {
    title: estoque <= 0 ? "Produto acabou" : "Estoque baixo",
    body: estoque <= 0 ? `${nome} acabou. Hora de repor.` : `${nome}: restam ${estoque}. Hora de repor.`,
    url: "/financeiro.html#secProdutos",
  });
}

module.exports = { avisarNovoPedido, avisoDiarioDoClube, chamadaDoAgendador, avisarEstoqueBaixo, enviarPara, donosDe };
