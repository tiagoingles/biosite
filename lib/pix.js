// Pix "copia e cola" (BR Code estático, padrão EMV do Banco Central) para o sinal do agendamento.
// Sem banco intermediário: o dinheiro vai direto para a chave Pix da barbearia e o dono confere no app
// do banco e toca em "Recebi o sinal". Campos: 00 formato, 26 conta Pix (GUI + chave), 52 categoria,
// 53 moeda (986 = real), 54 valor, 58 país, 59 nome, 60 cidade, 62 identificador (txid), 63 CRC16.
const TIPOS_CHAVE = ["cpf_cnpj", "celular", "email", "aleatoria"];

function campo(id, valor) {
  const v = String(valor);
  return id + String(v.length).padStart(2, "0") + v;
}

// CRC16-CCITT (polinômio 0x1021, início 0xFFFF), como pede o padrão
function crc16(texto) {
  let crc = 0xffff;
  for (const byte of Buffer.from(texto, "utf8")) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// Nome e cidade: sem acento, só letras, números e espaço, em maiúsculas (os bancos rejeitam o resto)
function ascii(t, max) {
  return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().toUpperCase().slice(0, max);
}

// Chave como o banco espera, pelo tipo escolhido pelo dono. Devolve "" se não fecha com o tipo.
function normalizarChave(chave, tipo) {
  const t = String(chave || "").trim();
  if (tipo === "email") return /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/.test(t) ? t.toLowerCase() : "";
  if (tipo === "aleatoria") return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t) ? t.toLowerCase() : "";
  const d = t.replace(/\D/g, "");
  if (tipo === "celular") {
    const n = d.length === 13 && d.startsWith("55") ? d.slice(2) : d;
    return n.length === 10 || n.length === 11 ? "+55" + n : "";
  }
  if (tipo === "cpf_cnpj") return d.length === 11 || d.length === 14 ? d : "";
  return "";
}

// Identificador do pagamento: só letras e números, até 25 (usamos o código do pedido)
function txidDe(t) {
  const s = String(t || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 25);
  return s || "***";
}

function brCode({ chave, nome, cidade, valor, txid }) {
  if (!chave) throw new Error("Chave Pix vazia.");
  const conta = campo("00", "br.gov.bcb.pix") + campo("01", chave);
  let p =
    campo("00", "01") +
    campo("26", conta) +
    campo("52", "0000") +
    campo("53", "986") +
    (valor ? campo("54", Number(valor).toFixed(2)) : "") +
    campo("58", "BR") +
    campo("59", ascii(nome, 25) || "RECEBEDOR") +
    campo("60", ascii(cidade, 15) || "BRASIL") +
    campo("62", campo("05", txidDe(txid)));
  p += "6304";
  return p + crc16(p);
}

module.exports = { brCode, crc16, normalizarChave, ascii, TIPOS_CHAVE };
