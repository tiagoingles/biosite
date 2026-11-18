// Sinal de pré-agendamento no Pix (fase 22). O dono liga em Mais > Sinal no Pix e escolhe:
//   valor fixo (R$) ou % do serviço · dias da semana e serviços em que cobra (nenhum marcado = todos)
//   prazo para pagar (min) · chave Pix (tipo + chave), nome de quem recebe e cidade.
// No site, o pedido com sinal fica "aguardando sinal": o cliente vê o Pix copia e cola e o QR. O dono confere
// no app do banco e toca em "Recebi o sinal" (o pedido fica confirmado). Sem pagamento no prazo, o relógio de
// 5 minutos (lib/lembretes.js) cancela o pedido e o horário volta a ficar livre.
const { rest } = require("./supabase");
const { brCode, normalizarChave, TIPOS_CHAVE } = require("./pix");
const { diaDaSemana } = require("./horarios");

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const txt = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

// Configuração limpa (o que vem do banco ou do painel). Devolve { cfg } ou { erro }.
function lerConfig(b, { validar = false } = {}) {
  b = b && typeof b === "object" ? b : {};
  const tipo = b.tipo === "percentual" ? "percentual" : "fixo";
  const valor = r2(String(b.valor == null ? "" : b.valor).replace(",", "."));
  const prazoMin = Number.isInteger(Number(b.prazoMin)) ? Math.min(240, Math.max(10, Number(b.prazoMin))) : 30;
  const dias = Array.isArray(b.dias) ? [...new Set(b.dias.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
  const servicos = Array.isArray(b.servicos) ? b.servicos.map((s) => txt(s, 80)).filter(Boolean).slice(0, 80) : [];
  const tipoChave = TIPOS_CHAVE.includes(b.tipoChave) ? b.tipoChave : "";
  const chave = tipoChave ? normalizarChave(b.chave, tipoChave) : "";
  const cfg = { ativo: b.ativo === true, tipo, valor, prazoMin, dias, servicos, tipoChave, chave, chaveDigitada: txt(b.chaveDigitada || b.chave, 120), nome: txt(b.nome, 60), cidade: txt(b.cidade, 40) };
  if (validar && cfg.ativo) {
    if (!(valor > 0)) return { erro: "Informe o valor do sinal." };
    if (tipo === "percentual" && valor > 100) return { erro: "A porcentagem vai até 100%." };
    if (tipo === "fixo" && valor > 5000) return { erro: "Valor do sinal alto demais." };
    if (!tipoChave) return { erro: "Escolha o tipo da chave Pix." };
    if (!chave) return { erro: "Confira a chave Pix: ela não bate com o tipo escolhido." };
    if (cfg.nome.length < 2) return { erro: "Informe o nome de quem recebe o Pix." };
    if (cfg.cidade.length < 2) return { erro: "Informe a cidade de quem recebe o Pix." };
  }
  return { cfg };
}

// Quanto de sinal este pedido pede (0 = não cobra)
function valorDoSinal(config, { dia, servico, preco }) {
  const { cfg } = lerConfig(config);
  if (!cfg.ativo || !cfg.chave || !(cfg.valor > 0)) return 0;
  if (cfg.dias.length && !cfg.dias.includes(diaDaSemana(dia))) return 0;
  if (cfg.servicos.length && !cfg.servicos.includes(servico)) return 0;
  if (cfg.tipo === "fixo") return r2(cfg.valor);
  const base = Number(preco);
  if (!(base > 0)) return 0;
  const v = r2((base * cfg.valor) / 100);
  return v >= 1 ? v : 0;
}

// O que o site mostra: o Pix copia e cola (com o valor e o código do pedido), a chave e o prazo
function pixDoPedido(config, valor, codigo) {
  const { cfg } = lerConfig(config);
  return {
    valor: r2(valor),
    copiaECola: brCode({ chave: cfg.chave, nome: cfg.nome, cidade: cfg.cidade, valor, txid: codigo }),
    chave: cfg.chaveDigitada || cfg.chave,
    recebedor: cfg.nome,
    prazoMin: cfg.prazoMin,
  };
}

// Relógio de 5 minutos: cancela os pedidos com sinal que passaram do prazo sem o dono tocar em "Recebi o sinal"
async function expirar() {
  const limite = new Date(Date.now() - 10 * 60e3).toISOString();
  const pendentes = await rest(`pedidos?sinal_status=eq.aguardando&status=eq.pendente&criado_em=lt.${limite}&select=id,barbearia_id,criado_em&limit=500`);
  if (!pendentes.length) return 0;
  const ids = [...new Set(pendentes.map((p) => p.barbearia_id))];
  const barbs = await rest(`barbearias?id=in.(${ids.join(",")})&select=id,sinal`);
  const prazoDe = Object.fromEntries(barbs.map((b) => [b.id, lerConfig(b.sinal).cfg.prazoMin]));
  let n = 0;
  for (const p of pendentes) {
    const prazo = prazoDe[p.barbearia_id] || 30;
    if (Date.parse(p.criado_em) > Date.now() - prazo * 60e3) continue;
    const r = await rest(`pedidos?id=eq.${p.id}&sinal_status=eq.aguardando&status=eq.pendente`, { metodo: "PATCH", prefer: "return=representation", corpo: { status: "cancelado", sinal_status: "expirado" } });
    if (Array.isArray(r) && r.length) n++;
  }
  return n;
}

module.exports = { lerConfig, valorDoSinal, pixDoPedido, expirar };
