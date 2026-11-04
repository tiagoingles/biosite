// Avisa o dono e o barbeiro quando chega um pedido novo (Web Push).
// Falha de aviso nunca derruba o pedido: quem chama deve tratar o erro como aviso perdido.
const { rest } = require("./supabase");
const { enviar } = require("./webpush");

async function avisarNovoPedido({ barbearia_id, profissional_id, cliente, servico, dia, horario }) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;

  // Quem recebe: dono e dono-barbeiro, e o barbeiro do pedido
  const donos = await rest(`perfis?barbearia_id=eq.${barbearia_id}&papel=in.(dono,dono_barbeiro)&select=user_id,papel`);
  const barbeiro = profissional_id
    ? await rest(`profissionais?id=eq.${profissional_id}&select=perfil_user_id`)
    : [];
  const papelDe = new Map(donos.map((d) => [d.user_id, d.papel]));
  if (barbeiro[0] && barbeiro[0].perfil_user_id) papelDe.set(barbeiro[0].perfil_user_id, "barbeiro");
  const ids = [...papelDe.keys()];
  if (!ids.length) return;

  const inscricoes = await rest(`push_inscricoes?user_id=in.(${ids.join(",")})&select=endpoint,p256dh,auth_key,user_id`);
  console.log("avisos de pedido: destinatarios", ids.length, "assinaturas", inscricoes.length);
  const aviso = {
    title: "Novo agendamento",
    body: `${cliente} · ${servico} · ${dia.split("-").reverse().slice(0, 2).join("/")} ${horario}`,
  };

  await Promise.allSettled(
    inscricoes.map(async (i) => {
      const papel = papelDe.get(i.user_id);
      const url = papel === "barbeiro" ? "/painel-barbeiro.html" : "/painel-dono.html";
      const entregue = await enviar({ endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth_key } }, { ...aviso, url }).catch((e) => {
        console.error("push falhou:", e.message);
        return true; // erro do serviço não apaga a assinatura
      });
      console.log("push enviado:", entregue ? "ok" : "assinatura expirada");
      // Assinatura expirada: apaga para não tentar de novo
      if (!entregue) await rest(`push_inscricoes?endpoint=eq.${encodeURIComponent(i.endpoint)}`, { metodo: "DELETE", prefer: "return=minimal" });
    })
  );
}

module.exports = { avisarNovoPedido };
