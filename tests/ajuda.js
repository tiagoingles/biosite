// Ferramentas dos testes: banco Supabase falso (fetch interceptado), requisição e resposta falsas.
// Nada aqui fala com a internet: todo fetch passa pelo roteador do teste.
process.env.SUPABASE_URL = "https://teste.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "chave-de-servico-de-teste";
process.env.SUPABASE_ANON_KEY = "chave-anon-de-teste";
process.env.CRIADOR_SENHA = "senha-do-criador-de-teste-123";
process.env.GITHUB_TOKEN = "token-github-de-teste";
process.env.GITHUB_REPO = "teste/biosite";
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;

const UUIDS = {
  barbearia: "11111111-1111-4111-8111-111111111111",
  outraBarbearia: "22222222-2222-4222-8222-222222222222",
  bruno: "33333333-3333-4333-8333-333333333333",
  rafael: "44444444-4444-4444-8444-444444444444",
  estranho: "55555555-5555-4555-8555-555555555555",
  pedido: "66666666-6666-4666-8666-666666666666",
  donoUser: "77777777-7777-4777-8777-777777777777",
  brunoUser: "88888888-8888-4888-8888-888888888888",
  adminUser: "99999999-9999-4999-8999-999999999999",
};

// Usuários por token (o que /auth/v1/user devolveria)
const TOKENS = {
  "token-dono": { id: UUIDS.donoUser, email: "dono@exemplo.com" },
  "token-bruno": { id: UUIDS.brunoUser, email: "bruno@exemplo.com" },
  "token-admin": { id: UUIDS.adminUser, email: "admin@exemplo.com" },
  "token-sem-perfil": { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "novo@exemplo.com" },
};

function resposta(status, corpo) {
  const texto = corpo === undefined ? "" : JSON.stringify(corpo);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => texto,
    json: async () => (texto ? JSON.parse(texto) : null),
  };
}

// Instala um fetch falso. rotas: [{ metodo?, padrao: RegExp|string, resposta: fn(url, opcoes, corpo) | {status, corpo} }]
// Também responde /auth/v1/user pelos TOKENS. Guarda todas as chamadas em chamadas[].
function instalarFetch(rotas = []) {
  const chamadas = [];
  global.fetch = async (url, opcoes = {}) => {
    const metodo = (opcoes.method || "GET").toUpperCase();
    let corpo = null;
    try { corpo = opcoes.body ? JSON.parse(opcoes.body) : null; } catch (e) { corpo = opcoes.body; }
    chamadas.push({ url: String(url), metodo, corpo, headers: opcoes.headers || {} });
    if (String(url).includes("/auth/v1/user")) {
      const auth = String((opcoes.headers || {}).Authorization || "");
      const u = TOKENS[auth.replace("Bearer ", "")];
      return u ? resposta(200, u) : resposta(401, { msg: "invalid" });
    }
    for (const r of rotas) {
      if (r.metodo && r.metodo !== metodo) continue;
      const casa = typeof r.padrao === "string" ? String(url).includes(r.padrao) : r.padrao.test(String(url));
      if (!casa) continue;
      const v = typeof r.resposta === "function" ? await r.resposta(String(url), opcoes, corpo) : r.resposta;
      if (v && v.__resposta) return v.__resposta;
      return resposta(v.status || 200, v.corpo);
    }
    return resposta(404, { message: "rota sem mock: " + metodo + " " + url });
  };
  return chamadas;
}

// Perfis e profissionais padrão do banco falso
function rotasDeConta() {
  return [
    {
      padrao: /\/rest\/v1\/perfis\?user_id=eq\./,
      resposta: (url) => {
        if (url.includes(UUIDS.donoUser)) return { corpo: [{ user_id: UUIDS.donoUser, barbearia_id: UUIDS.barbearia, papel: "dono", nome: "Dono" }] };
        if (url.includes(UUIDS.brunoUser)) return { corpo: [{ user_id: UUIDS.brunoUser, barbearia_id: UUIDS.barbearia, papel: "barbeiro", nome: "Bruno" }] };
        return { corpo: [] };
      },
    },
    { padrao: /\/rest\/v1\/plataforma_admins\?user_id=eq\./, resposta: (url) => ({ corpo: url.includes(UUIDS.adminUser) ? [{ user_id: UUIDS.adminUser }] : [] }) },
    {
      padrao: /\/rest\/v1\/profissionais\?perfil_user_id=eq\./,
      resposta: (url) => ({ corpo: url.includes(UUIDS.brunoUser) ? [{ id: UUIDS.bruno, barbearia_id: UUIDS.barbearia, nome: "Bruno" }] : [] }),
    },
    { padrao: /\/rest\/v1\/rpc\/contar_tentativa/, resposta: { corpo: 0 } },
    { padrao: /\/rest\/v1\/telemetria/, resposta: { status: 201 } },
  ];
}

function req({ metodo = "GET", query = {}, corpo, token, headers = {} } = {}) {
  return {
    method: metodo,
    query,
    body: corpo,
    headers: { host: "biosite.teste", "x-forwarded-proto": "https", "x-real-ip": "203.0.113.7", ...(token ? { authorization: "Bearer " + token } : {}), ...headers },
  };
}

function res() {
  const r = {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end() { return this; },
  };
  return r;
}

async function chamar(handler, opcoes) {
  const r = res();
  await handler(req(opcoes), r);
  return r;
}

// Data de hoje e dias seguintes em Brasília, no formato do banco
const { hojeBr, somaDias } = require("../lib/horarios");
const hoje = () => hojeBr();
const daquiA = (n) => somaDias(hojeBr(), n);

module.exports = { UUIDS, TOKENS, instalarFetch, rotasDeConta, req, res, chamar, resposta, hoje, daquiA };
