// Envio de avisos Web Push (RFC 8291 para o conteúdo e RFC 8292 VAPID para a identificação).
// Sem bibliotecas: só o módulo crypto do Node.
// Variáveis na Vercel:
//   VAPID_PUBLIC_KEY   chave pública (base64url, 65 bytes) — também vai para o navegador
//   VAPID_PRIVATE_KEY  chave privada (base64url, 32 bytes) — nunca vai para o navegador
//   VAPID_SUBJECT      ex.: mailto:voce@exemplo.com
const crypto = require("crypto");

function b64u(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64u(s) {
  return Buffer.from(String(s || "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function hmac(chave, dados) {
  return crypto.createHmac("sha256", chave).update(dados).digest();
}

// HKDF com SHA-256 (uma expansão de 32 bytes basta; para tamanhos menores, corta)
function hkdf(sal, ikm, info, tamanho) {
  const prk = hmac(sal, ikm);
  return hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, tamanho);
}

// Chave privada EC P-256 a partir das duas chaves VAPID
function chavePrivadaVapid() {
  const pub = unb64u(process.env.VAPID_PUBLIC_KEY);
  const d = unb64u(process.env.VAPID_PRIVATE_KEY);
  if (pub.length !== 65 || d.length !== 32) throw new Error("Chaves VAPID inválidas (confira VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY na Vercel).");
  return crypto.createPrivateKey({
    key: { kty: "EC", crv: "P-256", x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: b64u(d) },
    format: "jwk",
  });
}

// Cabeçalho Authorization (JWT ES256) que prova ao serviço de push quem envia
function cabecalhoVapid(endpoint) {
  const aud = new URL(endpoint).origin;
  const cabeca = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const corpo = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: process.env.VAPID_SUBJECT || "mailto:contato@biosite.app" }));
  const assinante = crypto.sign("sha256", Buffer.from(`${cabeca}.${corpo}`), { key: chavePrivadaVapid(), dsaEncoding: "ieee-p1363" });
  return `vapid t=${cabeca}.${corpo}.${b64u(assinante)}, k=${process.env.VAPID_PUBLIC_KEY}`;
}

// Criptografa o aviso para a assinatura do navegador (aes128gcm, registro único)
function criptografar(inscricao, texto) {
  const uaPub = unb64u(inscricao.keys.p256dh);
  const authSecret = unb64u(inscricao.keys.auth);
  const efemera = crypto.createECDH("prime256v1");
  efemera.generateKeys();
  const asPub = efemera.getPublicKey();
  const segredo = efemera.computeSecret(uaPub);

  const ikm = hkdf(authSecret, segredo, Buffer.concat([Buffer.from("WebPush: info\0"), uaPub, asPub]), 32);
  const sal = crypto.randomBytes(16);
  const cek = hkdf(sal, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(sal, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);

  const cifra = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const cifrado = Buffer.concat([cifra.update(Buffer.concat([Buffer.from(texto, "utf8"), Buffer.from([2])])), cifra.final(), cifra.getAuthTag()]);

  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096, 0);
  return Buffer.concat([sal, rs, Buffer.from([asPub.length]), asPub, cifrado]);
}

// Envia um aviso. Devolve true se entregue, false se a assinatura não vale mais (410/404).
async function enviar(inscricao, aviso) {
  const corpo = criptografar(inscricao, JSON.stringify(aviso));
  const r = await fetch(inscricao.endpoint, {
    method: "POST",
    headers: {
      Authorization: cabecalhoVapid(inscricao.endpoint),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "normal",
    },
    body: corpo,
  });
  if (r.status === 404 || r.status === 410) return false;
  if (!r.ok) throw new Error("Push: serviço recusou o aviso (" + r.status + ")");
  return true;
}

module.exports = { enviar };
