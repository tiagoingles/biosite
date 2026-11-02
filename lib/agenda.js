// Regras compartilhadas do agendamento: status, códigos e validação de texto.
const crypto = require("crypto");

const STATUS = ["pendente", "confirmado", "recusado", "cancelado", "avulso"];
// Sem letras e números parecidos (0/O, 1/I/L) para o cliente não errar ao ler
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function codigoNovo(tamanho = 4) {
  const bytes = crypto.randomBytes(tamanho);
  let c = "";
  for (let i = 0; i < tamanho; i++) c += ALFABETO[bytes[i] % ALFABETO.length];
  return c;
}

// Texto limpo e com tamanho máximo
function texto(v, max) {
  return String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

module.exports = { STATUS, codigoNovo, texto };
