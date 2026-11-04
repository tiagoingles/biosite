// Preço de cada serviço no momento do agendamento.
// A tabela servicos_precos é a fonte: se o dono já cadastrou o preço, ele vale.
// Se não, usa o preço que o site mostrou ao cliente e já cadastra esse preço na tabela.
const { rest } = require("./supabase");

// "45,00" -> 45 ; "1.250,00" -> 1250 ; texto sem número -> null
function valorDoTexto(v) {
  let t = String(v == null ? "" : v).replace(/[^\d,.]/g, "");
  if (!t) return null;
  t = t.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n * 100) / 100 : null;
}

async function precoDoServico(barbeariaId, nome, precoDoSite) {
  if (!nome) return null;
  const cadastrado = await rest(`servicos_precos?barbearia_id=eq.${barbeariaId}&nome=eq.${encodeURIComponent(nome)}&select=preco`);
  if (cadastrado.length) return Number(cadastrado[0].preco);
  const valor = valorDoTexto(precoDoSite);
  if (valor === null) return null;
  // Cadastra o preço do site; se outra requisição cadastrou antes, não sobrescreve
  await rest("servicos_precos?on_conflict=barbearia_id,nome", {
    metodo: "POST",
    prefer: "resolution=ignore-duplicates,return=minimal",
    corpo: { barbearia_id: barbeariaId, nome, preco: valor, simulado: false },
  });
  return valor;
}

module.exports = { precoDoServico, valorDoTexto };
