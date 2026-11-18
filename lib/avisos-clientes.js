// Avisos no celular que o dono manda para os clientes (fase 23): para um cliente (na ficha) ou para um grupo
// da carteira (Sumidos, Chamar de volta, 2ª visita, Aniversariantes ou todos com o app).
// POST /api/equipe?area=clientes { acao: "aviso", clienteId? | segmento?, mensagem, abrir: "agendar" | "site" }
// - Vai só para os celulares com os avisos da barbearia ligados (clientes_push). Para grupos, só quem aceitou
//   as novidades e não pediu para sair; para um cliente, qualquer aparelho dele.
// - {nome} vira o primeiro nome do cliente. Título: o nome da barbearia. Tocar abre o agendamento (ou o site).
// - Limites: 3 avisos por cliente por dia e 2 avisos para grupos por dia, por barbearia.
const { rest, todas } = require("./supabase");
const { hojeBr } = require("./horarios");
const { UUID } = require("./seguranca");
const { enviarAparelhos, iconeDoSite } = require("./app-cliente");

const GRUPOS = ["todos", "chamar", "segunda", "sumidos", "aniversario"];
const LIMITE_CLIENTE_DIA = 3;
const LIMITE_GRUPO_DIA = 2;
const LOTE = 50;

const primeiroNome = (n) => String(n || "").trim().split(/\s+/)[0] || "";
// {nome} sem nome conhecido some sem deixar "Olá, !" para trás
function personalizar(modelo, nome) {
  const t = String(modelo).split("{nome}").join(nome || "");
  return nome ? t : t.replace(/\s+([,!.?])/g, "$1").replace(/,\s*([!.?])/g, "$1").replace(/^\s*,\s*/, "").replace(/\s{2,}/g, " ").trim();
}
// Início do dia em Brasília, em UTC (para contar os avisos de hoje)
const inicioDoDia = () => new Date(Date.parse(hojeBr() + "T00:00:00-03:00")).toISOString();

async function enviarEmLotes(lista, avisoDe) {
  let entregues = 0;
  for (let i = 0; i < lista.length; i += LOTE) {
    const lote = lista.slice(i, i + LOTE);
    const porNome = new Map();
    for (const a of lote) {
      const k = a._nome || "";
      if (!porNome.has(k)) porNome.set(k, []);
      porNome.get(k).push(a);
    }
    for (const [nome, aparelhos] of porNome) entregues += await enviarAparelhos(aparelhos, avisoDe(nome));
  }
  return entregues;
}

// dadosDaCarteira: a função que monta a carteira com os segmentos (lib/clientes.js), para o grupo ser o mesmo da tela
async function enviar(res, ctx, b, dadosDaCarteira) {
  const mensagem = String(b.mensagem || "").replace(/\s+/g, " ").trim();
  if (mensagem.length < 3) return res.status(400).json({ message: "Escreva a mensagem do aviso." });
  if (mensagem.length > 180) return res.status(400).json({ message: "A mensagem passa de 180 letras. Encurte um pouco." });
  const abrir = b.abrir === "site" ? "site" : "agendar";
  const clienteId = b.clienteId ? String(b.clienteId) : "";
  const segmento = clienteId ? "" : String(b.segmento || "todos");
  if (clienteId && !UUID.test(clienteId)) return res.status(400).json({ message: "Cliente inválido." });
  if (!clienteId && !GRUPOS.includes(segmento)) return res.status(400).json({ message: "Grupo inválido." });

  const [loja] = await rest(`barbearias?id=eq.${ctx.barbeariaId}&select=slug,nome`);
  if (!loja) return res.status(404).json({ message: "Barbearia não encontrada." });
  const desde = inicioDoDia();
  let aparelhos = [];
  if (clienteId) {
    const [c] = await rest(`clientes?id=eq.${clienteId}&barbearia_id=eq.${ctx.barbeariaId}&select=id,nome`);
    if (!c) return res.status(404).json({ message: "Cliente não encontrado." });
    const hoje = await rest(`avisos_clientes?barbearia_id=eq.${ctx.barbeariaId}&cliente_id=eq.${clienteId}&criado_em=gte.${desde}&select=id`);
    if (hoje.length >= LIMITE_CLIENTE_DIA) return res.status(429).json({ message: `Já foram ${LIMITE_CLIENTE_DIA} avisos para ${primeiroNome(c.nome)} hoje. Mande amanhã ou fale pelo WhatsApp.` });
    aparelhos = (await rest(`clientes_push?barbearia_id=eq.${ctx.barbeariaId}&cliente_id=eq.${clienteId}&select=id,endpoint,p256dh,auth_key`)).map((a) => ({ ...a, _nome: primeiroNome(c.nome) }));
  } else {
    const hoje = await rest(`avisos_clientes?barbearia_id=eq.${ctx.barbeariaId}&segmento=not.is.null&criado_em=gte.${desde}&select=id`);
    if (hoje.length >= LIMITE_GRUPO_DIA) return res.status(429).json({ message: `Já foram ${LIMITE_GRUPO_DIA} avisos para grupos hoje. Para não incomodar os clientes, mande o próximo amanhã.` });
    const carteira = await dadosDaCarteira(ctx);
    const doGrupo = new Map(carteira.clientes.filter((c) => !c.saiu && (segmento === "todos" || c.segmentos.includes(segmento))).map((c) => [c.id, primeiroNome(c.nome)]));
    const todosComAceite = await todas(`clientes_push?barbearia_id=eq.${ctx.barbeariaId}&novidades=eq.true&select=id,endpoint,p256dh,auth_key,cliente_id&order=id`);
    aparelhos = todosComAceite
      // "todos": também quem ligou os avisos pelo app sem ter cadastro; nos grupos, só os clientes do grupo
      .filter((a) => (a.cliente_id ? doGrupo.has(a.cliente_id) : segmento === "todos"))
      .map((a) => ({ ...a, _nome: a.cliente_id ? doGrupo.get(a.cliente_id) : "" }));
  }
  if (!aparelhos.length) return res.status(409).json({ message: clienteId ? "Este cliente não ligou os avisos da barbearia no celular." : "Ninguém deste grupo ligou os avisos da barbearia no celular ainda." });

  const icon = await iconeDoSite(loja.slug);
  const url = abrir === "site" ? `/${loja.slug}` : `/${loja.slug}?agendar=1`;
  const entregues = await enviarEmLotes(aparelhos, (nome) => ({ title: String(loja.nome).slice(0, 60), body: personalizar(mensagem, nome), url, tag: "novidade", ...(icon ? { icon } : {}) }));
  await rest("avisos_clientes", {
    metodo: "POST",
    prefer: "return=minimal",
    corpo: { barbearia_id: ctx.barbeariaId, cliente_id: clienteId || null, segmento: clienteId ? null : segmento, mensagem, aparelhos: aparelhos.length, entregues },
  }).catch((e) => console.error("histórico do aviso:", e.message));
  return res.status(200).json({ aparelhos: aparelhos.length, entregues });
}

// Quem tem os avisos ligados (para a carteira mostrar o selo e contar o grupo)
async function aparelhosDaCarteira(barbeariaId) {
  const lista = await todas(`clientes_push?barbearia_id=eq.${barbeariaId}&select=cliente_id,novidades&order=id`).catch(() => []);
  const app = new Map();
  let semCadastro = 0;
  for (const a of lista) {
    if (!a.cliente_id) { if (a.novidades) semCadastro++; continue; }
    const x = app.get(a.cliente_id) || { app: true, novidades: false };
    if (a.novidades) x.novidades = true;
    app.set(a.cliente_id, x);
  }
  return { app, semCadastro };
}

module.exports = { enviar, aparelhosDaCarteira, personalizar, GRUPOS };
