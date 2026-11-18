// Pedidos de horário.
// POST: recebe um pedido feito no site. Confere o horário com a agenda publicada, grava como
// "pendente" de forma atômica (sem dois clientes no mesmo horário) e devolve o código que o
// cliente envia junto na mensagem do WhatsApp.
// Assinante do clube (clube: true, clubeWhatsapp): o WhatsApp identifica a assinatura e as regras do
// plano são conferidas no banco; o pedido vai com valor 0 e a comissão fixa do plano.
// WhatsApp do cliente (whatsapp, opcional; novidades: aceita receber promoções): o pedido fica ligado ao
// cadastro do cliente na barbearia, criado na primeira vez (lib/clientes.js).
// GET e POST ?convite=<token>: o cliente se cadastra pelo link que a barbearia mandou (lib/clientes.js).
// GET, PATCH e POST com "acao": o painel lista e decide os pedidos (ver lib/pedidos-painel.js).
// Usa a mesma função para não passar do limite de funções da Vercel no plano gratuito.
const { rest } = require("../lib/supabase");
const { codigoNovo, texto } = require("../lib/agenda");
const painel = require("../lib/pedidos-painel");
const { avisarNovoPedido } = require("../lib/avisos");
const { disponibilidadeDoDia, escolherLivre } = require("../lib/disponibilidade");
const { precoDoServico } = require("../lib/precos");
const { dataValida, horaValida, hojeBr, somaDias } = require("../lib/horarios");
const { origemDe, falha, corpoDe, UUID, bloqueadoPorTentativas, registrarErroDeSenha } = require("../lib/seguranca");
const clube = require("../lib/clube");
const clientes = require("../lib/clientes");

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
  // Cadastro do cliente pelo link de convite (público, sem login)
  if (req.query && req.query.convite !== undefined) {
    if (req.method === "GET") return clientes.conviteInfo(req, res);
    if (req.method === "POST") return clientes.conviteSalvar(req, res);
    return erro(res, 405, "Método não permitido.");
  }
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
  const peloClube = b.clube === true;
  if (peloClube && !clube.normalizarWhats(b.clubeWhatsapp)) return res.status(400).json({ message: "Informe o WhatsApp do clube com DDD.", clube: true });
  // WhatsApp do cliente (opcional): liga o agendamento ao cadastro dele. Pelo clube, vale o número do clube.
  const temZap = String(b.whatsapp || "").replace(/\D/g, "").length > 0;
  const zapCliente = temZap ? clube.normalizarWhats(b.whatsapp) : peloClube ? clube.normalizarWhats(b.clubeWhatsapp) : "";
  if (temZap && !zapCliente) return erro(res, 400, "Confira seu WhatsApp: DDD e número.");

  try {
    const barb = await rest(`barbearias?slug=eq.${slug}&select=id,confirmacao_automatica`);
    if (!barb.length) return erro(res, 404, "Barbearia não encontrada.");
    const barbearia_id = barb[0].id;
    // A barbearia escolhe: o agendamento do site entra confirmado sozinho ou espera o dono/barbeiro confirmar
    const automatico = barb[0].confirmacao_automatica === true;

    // Assinante do clube. Número não encontrado conta como tentativa errada (ninguém fica testando números à toa).
    let assinante = null;
    if (peloClube) {
      if (await bloqueadoPorTentativas(req, "clube")) return res.status(429).json({ message: "Muitas tentativas com o WhatsApp do clube. Espere 15 minutos ou marque sem o clube.", clube: true });
      assinante = await clube.assinantePorWhatsapp(barbearia_id, b.clubeWhatsapp);
      if (assinante.erro) {
        await registrarErroDeSenha(req, "clube");
        return res.status(422).json({ message: assinante.erro, clube: true });
      }
    }
    // O nome do serviço vai escrito como está no plano (o banco compara o texto exato)
    const servicoPedido = assinante ? clube.servicoDoPlano(assinante.servicos, servico) : servico;
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
    // Com a confirmação automática, a trava conta também os confirmados do site: limite um pouco maior
    const limiteBarbearia = automatico ? Math.max(60, (LIMITE_DIA_POR_BARBEIRO + 4) * equipe.length) : Math.max(40, LIMITE_DIA_POR_BARBEIRO * equipe.length);

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
              servico: servicoPedido,
              dia,
              horario,
              cliente,
              observacao,
              duracao_min: duracao,
              valor,
              status: automatico ? "confirmado" : "pendente",
              origem,
              limite_hora_origem: LIMITE_HORA_ORIGEM,
              limite_dia_origem: LIMITE_DIA_ORIGEM,
              limite_dia_barbearia: limiteBarbearia,
              clube_assinante_id: assinante ? assinante.id : null,
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
      if (r && r.erro === "clube") return res.status(422).json({ message: clube.mensagemDoClube(r), clube: true });
      if (!r || !r.id) throw new Error("Pedido não gravado: resposta inesperada do banco.");

      // Liga o pedido ao cadastro do cliente pelo WhatsApp (cria na primeira vez); falha não derruba o pedido
      if (zapCliente) {
        await clientes.clienteDoAgendamento({ barbeariaId: barbearia_id, pedidoId: r.id, nome: cliente, telefone: zapCliente, novidades: b.novidades === true }).catch((e) =>
          console.error("cliente do agendamento:", e.message)
        );
      }

      // Aviso no celular do dono e do barbeiro; se falhar, o pedido já foi gravado
      await avisarNovoPedido({ barbearia_id, profissional_id: escolhido ? escolhido.id : null, cliente, servico: assinante ? servicoPedido + " · Clube" : servico, dia, horario, confirmado: automatico }).catch((e) =>
        console.error("aviso de pedido:", e.message)
      );
      return res.status(201).json({ codigo, profissional: escolhido ? escolhido.nome : profissionalNome, verificado, clube: !!assinante, confirmado: automatico });
    }
    throw new Error("Não foi possível gerar um código livre para o pedido.");
  } catch (e) {
    return falha(res, e, "POST /api/pedido");
  }
};
