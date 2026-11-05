// Acesso ao Supabase pela API REST, sem dependências. Só o servidor usa a chave de serviço.
// Variáveis de ambiente na Vercel:
//   SUPABASE_URL          ex.: https://xxxx.supabase.co
//   SUPABASE_SERVICE_KEY  chave "service_role" (nunca vai para o navegador)

const TEMPO_MAXIMO_MS = 8000; // consulta travada não segura a função até o limite da Vercel

function cfg() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) throw new Error("Banco não configurado (faltam SUPABASE_URL ou SUPABASE_SERVICE_KEY na Vercel).");
  return { url, key };
}

async function rest(caminho, { metodo = "GET", corpo, prefer } = {}) {
  const { url, key } = cfg();
  const headers = { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(url + "/rest/v1/" + caminho, {
    method: metodo,
    headers,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal: AbortSignal.timeout(TEMPO_MAXIMO_MS),
  });
  const txt = await r.text();
  let dados = null;
  try { dados = txt ? JSON.parse(txt) : null; } catch (e) {}
  if (!r.ok) throw new Error("Banco: " + ((dados && dados.message) || r.status));
  return dados;
}

// Lê todas as linhas de uma consulta, em páginas (o Supabase devolve no máximo 1000 por vez)
async function todas(caminho, pagina = 1000) {
  let saida = [];
  for (let inicio = 0; ; inicio += pagina) {
    const lote = await rest(`${caminho}&limit=${pagina}&offset=${inicio}`);
    saida = saida.concat(lote || []);
    if (!lote || lote.length < pagina) return saida;
  }
}

// Cria um link assinado para enviar um arquivo direto ao Storage (a mídia não passa pela Vercel)
async function linkDeEnvio(bucket, caminho) {
  const { url, key } = cfg();
  const r = await fetch(`${url}/storage/v1/object/upload/sign/${bucket}/${caminho}`, {
    method: "POST",
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(TEMPO_MAXIMO_MS),
  });
  const dados = await r.json().catch(() => null);
  if (!r.ok || !dados || !dados.url) throw new Error("Storage: " + ((dados && dados.message) || r.status));
  return dados.url.startsWith("http") ? dados.url : `${url}/storage/v1${dados.url}`;
}

module.exports = { rest, todas, linkDeEnvio, cfg };
