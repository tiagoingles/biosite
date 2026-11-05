// Avisos no celular (Web Push): a criptografia segue o RFC 8291 e a assinatura VAPID (RFC 8292) é válida.
// O teste faz o papel do navegador: decifra o aviso com a chave privada dele.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const b64u = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
const hkdf = (sal, ikm, info, n) => hmac(hmac(sal, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, n);

test("aviso cifrado é decifrado pelo navegador e o VAPID é assinado pelo servidor", async () => {
  // Chaves VAPID do servidor
  const vapid = crypto.createECDH("prime256v1");
  vapid.generateKeys();
  process.env.VAPID_PUBLIC_KEY = b64u(vapid.getPublicKey());
  process.env.VAPID_PRIVATE_KEY = b64u(vapid.getPrivateKey());
  process.env.VAPID_SUBJECT = "mailto:teste@exemplo.com";
  // Chaves do navegador
  const ua = crypto.createECDH("prime256v1");
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const inscricao = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) } };

  let capturado = null;
  global.fetch = async (url, opcoes) => {
    capturado = { url, opcoes };
    return { ok: true, status: 201 };
  };
  delete require.cache[require.resolve("../lib/webpush")];
  const { enviar } = require("../lib/webpush");
  const aviso = { title: "Novo agendamento", body: "Ana · Corte · 05/11 10:00", url: "/painel-dono.html" };
  assert.equal(await enviar(inscricao, aviso), true);

  // Decifra como o navegador (aes128gcm)
  const corpo = Buffer.from(capturado.opcoes.body);
  const sal = corpo.subarray(0, 16);
  const tamanhoChave = corpo[20];
  const asPub = corpo.subarray(21, 21 + tamanhoChave);
  const cifrado = corpo.subarray(21 + tamanhoChave);
  const segredo = ua.computeSecret(asPub);
  const ikm = hkdf(auth, segredo, Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPub]), 32);
  const cek = hkdf(sal, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(sal, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const dec = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  dec.setAuthTag(cifrado.subarray(cifrado.length - 16));
  const claro = Buffer.concat([dec.update(cifrado.subarray(0, cifrado.length - 16)), dec.final()]);
  assert.equal(claro[claro.length - 1], 2, "delimitador de registro final");
  assert.deepEqual(JSON.parse(claro.subarray(0, -1).toString("utf8")), aviso);

  // Confere o JWT do VAPID com a chave pública do servidor
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(capturado.opcoes.headers.Authorization);
  assert.ok(m, "cabeçalho VAPID");
  const pub = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64u(unb64u(m[4]).subarray(1, 33)), y: b64u(unb64u(m[4]).subarray(33, 65)) }, format: "jwk" });
  const ok = crypto.verify("sha256", Buffer.from(`${m[1]}.${m[2]}`), { key: pub, dsaEncoding: "ieee-p1363" }, unb64u(m[3]));
  assert.ok(ok, "assinatura VAPID válida");
  const claims = JSON.parse(unb64u(m[2]).toString());
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600, "expira em até 24 h");
  assert.equal(capturado.opcoes.headers["Content-Encoding"], "aes128gcm");

  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
});

test("assinatura expirada (404/410) avisa para apagar; outro erro vira exceção", async () => {
  const vapid = crypto.createECDH("prime256v1");
  vapid.generateKeys();
  process.env.VAPID_PUBLIC_KEY = b64u(vapid.getPublicKey());
  process.env.VAPID_PRIVATE_KEY = b64u(vapid.getPrivateKey());
  const ua = crypto.createECDH("prime256v1");
  ua.generateKeys();
  const inscricao = { endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(crypto.randomBytes(16)) } };
  const { enviar } = require("../lib/webpush");
  global.fetch = async () => ({ ok: false, status: 410 });
  assert.equal(await enviar(inscricao, { title: "x" }), false);
  global.fetch = async () => ({ ok: false, status: 500 });
  await assert.rejects(() => enviar(inscricao, { title: "x" }));
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
});
