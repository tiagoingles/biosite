// Quem ligou os avisos no celular: o cartão do painel (aparelhos, com e sem cadastro, novidades, iPhone e
// Android), a vitrine que não liga avisos e o caminho do iPhone no site (tela de início, depois "Permitir").
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const A = require("./ajuda");
const AC = require("../lib/avisos-clientes");

const { UUIDS } = A;
const ler = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8").replace(/\r\n/g, "\n");
const ANA = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";

test("plataforma pelo serviço de push: Apple é iPhone, Google é Android; endereço estranho conta como outros", () => {
  assert.equal(AC.plataformaDo("https://web.push.apple.com/QK4fN2"), "iphone");
  assert.equal(AC.plataformaDo("https://fcm.googleapis.com/fcm/send/abc"), "android");
  assert.equal(AC.plataformaDo("https://updates.push.services.mozilla.com/wpush/v2/x"), "outros");
  assert.equal(AC.plataformaDo("https://evil.example/push.apple.com"), "outros");
  assert.equal(AC.plataformaDo(undefined), "outros");
});

test("cartão Avisos no celular: conta aparelhos, cadastro, novidades e iPhone/Android, sem devolver os endereços", async () => {
  A.instalarFetch([
    {
      padrao: /\/rest\/v1\/clientes_push\?barbearia_id=eq\.[^&]+&select=cliente_id,novidades,endpoint/,
      resposta: {
        corpo: [
          { cliente_id: ANA, novidades: true, endpoint: "https://fcm.googleapis.com/fcm/send/1" },
          { cliente_id: ANA, novidades: false, endpoint: "https://web.push.apple.com/2" },
          { cliente_id: null, novidades: true, endpoint: "https://web.push.apple.com/3" },
          { cliente_id: null, novidades: false, endpoint: "https://fcm.googleapis.com/fcm/send/4" },
        ],
      },
    },
  ]);
  const r = await AC.aparelhosDaCarteira(UUIDS.barbearia);
  assert.deepEqual(r.resumo, { aparelhos: 4, comCadastro: 2, semCadastro: 2, novidades: 2, iphone: 2, android: 2, outros: 0 });
  assert.equal(r.semCadastro, 1, "para o aviso em grupo, só os sem cadastro que aceitaram novidades");
  assert.deepEqual(r.app.get(ANA), { app: true, novidades: true });
  assert.ok(!JSON.stringify(r.resumo).includes("http"), "o endereço do aparelho não sai do servidor");
});

test("vitrine: o site da demonstração não liga avisos no celular", async () => {
  const config = require("../api/config");
  const chamadas = A.instalarFetch([
    { padrao: /\/rest\/v1\/rpc\/contar_tentativa/, resposta: { corpo: 1 } },
    { padrao: /\/rest\/v1\/barbearias\?slug=eq\.barbearia-exemplo/, resposta: { corpo: [{ id: UUIDS.barbearia, demonstracao: "vitrine" }] } },
    { metodo: "POST", padrao: /\/rest\/v1\/clientes_push/, resposta: { status: 201 } },
  ]);
  const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/abc123", keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } };
  const r = await A.chamar(config, { metodo: "POST", corpo: { tipo: "lembrete-cliente", slug: "barbearia-exemplo", subscription, app: true, novidades: true } });
  assert.equal(r.statusCode, 403, JSON.stringify(r.body));
  assert.equal(r.body.demonstracao, true);
  assert.ok(!chamadas.some((c) => c.url.includes("clientes_push")), "nada gravado");
});

test("telas: cartão no painel do dono e o caminho do iPhone no site (tela de início, depois Permitir)", () => {
  const painel = ler("painel-clientes.js");
  assert.match(painel, /function desenharAvisosCelular\(a\)/);
  assert.match(painel, /"Ninguém ligou os avisos da barbearia ainda\."/, "com zero, o cartão aparece e diz que ninguém ligou");
  assert.match(painel, /"Android: " \+ a\.android \+ " · iPhone: " \+ a\.iphone/);
  assert.match(painel, /el\.avisosCel = op\.dono \?/, "só o dono vê");
  const site = ler("barbearia-modelo.html");
  assert.match(site, /<b>Receber os avisos no iPhone<\/b>/);
  assert.match(site, /toque em <b>Permitir<\/b> quando pedir os avisos/);
  assert.match(site, /ios:function\(\)\{return ios\}/);
  assert.match(ler("barbearia-exemplo.html"), /function suportado\(\)\{return C\.demonstracao!=="vitrine"&&/, "a vitrine não oferece avisos");
  assert.ok(require("../lib/gerador").VERSAO >= 17);
});
