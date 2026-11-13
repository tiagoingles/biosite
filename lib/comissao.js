// Comissão do barbeiro num atendimento: valor fixo (atendimento de assinante do clube, que não paga no
// balcão) ou porcentagem do valor do serviço.
function comissaoDe(p) {
  if (p && p.comissao_valor != null) return Number(p.comissao_valor) || 0;
  return ((Number(p && p.valor) || 0) * (Number(p && p.comissao_pct) || 0)) / 100;
}

module.exports = { comissaoDe };
