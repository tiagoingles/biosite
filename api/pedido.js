// Pedidos de horário.
// POST: recebe um pedido feito no site. Confere o horário com a agenda publicada, grava como
// "pendente" de forma atômica (sem dois clientes no mesmo horário) e devolve o código que o
// cliente envia junto na mensagem do WhatsApp.
// GET, PATCH e POST com "acao": o painel lista e decide os pedidos (ver lib/pedidos-painel.js).
// Usa a mesma função para não passar do limite de funções da Vercel no plano gratuito.
const { rest } = require("../lib/supabase");
const { codigoNovo, texto } = require("../lib/agenda");
const painel = require("../lib/pedidos-painel");
const { avisarNovoPedido } = require("../lib/avisos");
const { disponibilidadeDoDia, escolherLivre } = require("../lib/disponibilidade");
const { precoDoServico } = require("../lib/precos");
const { dataValida, horaValida, hojeBr, somaDias } = require("../lib/horarios");
const { origemDe, falha, corpoDe, UUID } = require("../lib/seguranca");

const DIAS_A_FRENTE = 60; // até quantos dias à frente o cliente pode agendar
// Limites contra abuso (robô ou pessoa enchendo a agenda de pedidos falsos)
const LIMITE_HORA_ORIGEM = 6;
const LIMITE_DIA_ORIGEM = 15;
const LIMITE_DIA_POR_BARBEIRO = 30;

function erro(res, status, message) {
  return res.status(status).json({ message });
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET" || req.method === "PATCH") return painel(req, res);
  const b = corpoDe(req);
  // Ações do painel (atendimento espontâneo, remarcar...) exigem login
  if (req.method === "POST" && b.acao) return painel(req, res);
  if (req.method !== "POST") return erro(res, 405, "Método não permitido.");

  // Campo escondido no formulário: robô costuma preencher, pessoa não
  if (b.website) return res.status(201).json({ codigo: "" });

  const slug = texto(b.slug, 60).toLowerCase();
  const dia = texto(b.dia, 10);
  const horario = texto(b.horario, 5);
  const servico = texto(b.servico, 80);
  const profissionalNome = texto(b.profissional, 80);
  const profissionalId = texto(b.profissionalId, 36);
  // Cliente sem preferência de barbeiro: o sistema escolhe um livre naquele horário
  const qualquer = b.qualquer === true;
  const cliente = texto(b.cliente, 80);
  const observacao = texto(b.observacao, 200);
  // Duração do serviço, para bloquear o horário certo na agenda. Sem valor válido, assume 30 min.
  const duracao = Number.isInteger(Number(b.duracao)) && Number(b.duracao) >= 5 && Number(b.duracao) <= 240 ? Number(b.duracao) : 30;

  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return erro(res, 400, "Barbearia inválida.");
  if (!dataValida(dia) || !horaValida(horario)) return erro(res, 400, "Data ou horário inválido.");
  const hoje = hojeBr();
  if (dia < hoje) return erro(res, 400, "Esta data já passou. Escolha outro dia.");
  if (dia > somaDias(hoje, DIAS_A_FRENTE)) return erro(res, 400, `Dá para agendar até ${DIAS_A_FRENTE} dias à frente.`);
  if (profissionalId && !UUID.test(profissionalId)) return erro(res, 400, "Profissional inválido.");
  if (!servico) return erro(res, 400, "Escolha o serviço.");
  if (cliente.length < 2) return erro(res, 400, "Informe seu nome.");
  if (!profissionalNome && !profissionalId && !qualquer) return erro(res, 400, "Escolha o profissional.");

  try {
    const barb = await rest(`barbearias?slug=eq.${slug}&select=id`);
    if (!barb.length) return erro(res, 404, "Barbearia não encontrada.");
    const barbearia_id = barb[0].id;
    const equipe = await rest(`profissionais?barbearia_id=eq.${barbearia_id}&ativo=eq.true&select=id,nome&order=criado_em.asc`);

    // Quem vai atender: o escolhido, um livre da equipe, ou (site antigo, sem id) o barbeiro com aquele nome
    let escolhido = null;
    let verificado = true;
    if (profissionalId) {
      escolhido = equipe.find((p) => p.id === profissionalId) || null;
      if (!escolhido) return erro(res, 400, "Profissional não encontrado nesta barbearia.");
      const d = await disponibilidadeDoDia(escolhido.id, dia, duracao);
      if (!d.livres.includes(horario)) return erro(res, 409, "Este horário não está mais livre. Escolha outro.");
    } else if (qualquer) {
      escolhido = await escolherLivre(equipe, dia, duracao, horario);
      if (!escolhido) return erro(res, 409, "Este horário não está mais livre. Escolha outro.");
    } else {
      const nome = profissionalNome.toLowerCase();
      escolhido = equipe.find((p) => p.nome.trim().toLowerCase() === nome) || null;
      if (escolhido) {
        const d = await disponibilidadeDoDia(escolhido.id, dia, duracao);
        if (!d.livres.includes(horario)) return erro(res, 409, "Este horário não está mais livre. Escolha outro.");
      } else {
        verificado = false; // site gerado antes da agenda no banco: a barbearia confirma pelo WhatsApp
      }
    }

    // Valor do atendimento já no agendamento: preço cadastrado pelo dono, ou o preço que o site mostrou
    const valor = await precoDoServico(barbearia_id, servico, b.preco);
    const origem = origemDe(req);
    const limiteBarbearia = Math.max(40, LIMITE_DIA_POR_BARBEIRO * equipe.length);

    // Grava de forma atômica. Se o código sorteado já existir na mesma barbearia, tenta outro.
    for (let tentativa = 0; tentativa < 4; tentativa++) {
      const codigo = codigoNovo(tentativa < 2 ? 4 : 5);
      let r;
      try {
        r = await rest("rpc/criar_pedido", {
          metodo: "POST",
          corpo: {
            p: {
              slug,
              barbearia_id,
              profissional_id: escolhido ? escolhido.id : null,
              profissional: escolhido ? escolhido.nome : profissionalNome,
              codigo,
              servico,
              dia,
              horario,
              cliente,
              observacao,
              duracao_min: duracao,
              valor,
              status: "pendente",
              origem,
              limite_hora_origem: LIMITE_HORA_ORIGEM,
              limite_dia_origem: LIMITE_DIA_ORIGEM,
              limite_dia_barbearia: limiteBarbearia,
            },
          },
        });
      } catch (e) {
        if (/duplicate|unique/i.test(e.message)) continue;
        throw e;
      }
      if (r && r.erro === "conflito") return erro(res, 409, "Este horário acabou de ser reservado. Escolha outro.");
      if (r && r.erro === "limite_origem") return erro(res, 429, "Você já fez vários pedidos agora há pouco. Se precisar de mais, fale com a barbearia pelo WhatsApp.");
      if (r && r.erro === "limite_barbearia") return erro(res, 429, "A barbearia recebeu muitos pedidos hoje. Fale com ela pelo WhatsApp.");
      if (!r || !r.id) throw new Error("Pedido não gravado: resposta inesperada do banco.");

      // Aviso no celular do dono e do barbeiro; se falhar, o pedido já foi gravado
      await avisarNovoPedido({ barbearia_id, profissional_id: escolhido ? escolhido.id : null, cliente, servico, dia, horario }).catch((e) =>
        console.error("aviso de pedido:", e.message)
      );
      return res.status(201).json({ codigo, profissional: escolhido ? escolhido.nome : profissionalNome, verificado });
    }
    throw new Error("Não foi possível gerar um código livre para o pedido.");
  } catch (e) {
    return falha(res, e, "POST /api/pedido");
  }
};
