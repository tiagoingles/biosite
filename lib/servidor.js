// Funções compartilhadas pelas APIs (api/precos.js e api/sincronizar.js).
// Variáveis de ambiente na Vercel:
//   GITHUB_TOKEN  token do GitHub com "Contents: Read and write" no repositório
//   GITHUB_REPO   ex.: tiagoingles/biosite
const crypto = require("crypto");

const INI = '<script type="application/json" id="bio-config">';

function configurado() {
  return !!(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO);
}

async function gh(path, opt = {}) {
  const r = await fetch("https://api.github.com/repos/" + process.env.GITHUB_REPO + path, {
    method: opt.method || "GET",
    body: opt.body,
    cache: "no-store",
    headers: {
      Authorization: "Bearer " + process.env.GITHUB_TOKEN,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "biosite",
      ...(opt.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const j = await r.json().catch(() => ({}));
  if (opt.permite404 && r.status === 404) return null;
  if (!r.ok) {
    const e = new Error("GitHub " + r.status + ": " + (j.message || ""));
    e.status = r.status;
    throw e;
  }
  return j;
}

async function lerArquivo(path) {
  const j = await gh("/contents/" + encodeURI(path), { permite404: true });
  if (!j) return null;
  let b64 = j.content;
  if (!b64) b64 = (await gh("/git/blobs/" + j.sha)).content;
  return { sha: j.sha, texto: Buffer.from(b64, "base64").toString("utf8") };
}

function extrairConfig(html) {
  const i = html.indexOf(INI);
  if (i < 0) return null;
  const j = html.indexOf("</script>", i);
  return JSON.parse(html.slice(i + INI.length, j));
}

async function lerSite(site) {
  const a = await lerArquivo(site + ".html");
  if (!a) return null;
  const cfg = extrairConfig(a.texto);
  if (!cfg) throw new Error("Site sem dados de configuração: " + site);
  return { ...a, cfg };
}

function normCodigo(c) {
  return String(c || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Retorna "ok", "sem-acesso" (painel não liberado) ou "negado"
async function autorizar(site, codigo) {
  const a = await lerArquivo("admin/" + site + ".json");
  if (!a) return "sem-acesso";
  const acesso = JSON.parse(a.texto);
  if (!codigo || !acesso.hash) return "negado";
  const h = crypto.pbkdf2Sync(normCodigo(codigo), Buffer.from(acesso.salt, "hex"), acesso.iter || 150000, 32, "sha256");
  const alvo = Buffer.from(acesso.hash, "hex");
  if (alvo.length === h.length && crypto.timingSafeEqual(h, alvo)) return "ok";
  await new Promise((r) => setTimeout(r, 800));
  return "negado";
}

let ramo = null;
async function ramoPadrao() {
  if (!ramo) ramo = (await gh("")).default_branch || "main";
  return ramo;
}

async function arvore() {
  const br = await ramoPadrao();
  const ref = await gh("/git/ref/heads/" + br);
  const commit = await gh("/git/commits/" + ref.object.sha);
  const t = await gh("/git/trees/" + commit.tree.sha + "?recursive=1");
  return (t.tree || []).filter((x) => x.type === "blob");
}

// Grava várias alterações num único commit (uma única publicação na Vercel)
async function commitar(entradas, mensagem) {
  const br = await ramoPadrao();
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const ref = await gh("/git/ref/heads/" + br);
    const commit = await gh("/git/commits/" + ref.object.sha);
    const tree = await gh("/git/trees", { method: "POST", body: JSON.stringify({ base_tree: commit.tree.sha, tree: entradas }) });
    const novo = await gh("/git/commits", { method: "POST", body: JSON.stringify({ message: mensagem, tree: tree.sha, parents: [ref.object.sha] }) });
    try {
      await gh("/git/refs/heads/" + br, { method: "PATCH", body: JSON.stringify({ sha: novo.sha }) });
      return novo.sha;
    } catch (e) {
      if (e.status !== 422 && e.status !== 409) throw e;
    }
  }
  throw Object.assign(new Error("O site foi alterado ao mesmo tempo. Tente de novo."), { publico: true });
}

function corpo(req) {
  let b = req.body;
  if (typeof b === "string") b = JSON.parse(b || "{}");
  return b || {};
}

function siteValido(s) {
  s = String(s || "").toLowerCase();
  return /^[a-z0-9-]{1,60}$/.test(s) ? s : "";
}

async function guardar(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ erro: "Método não permitido." }); return null; }
  if (!configurado()) { res.status(500).json({ erro: "O servidor ainda não foi configurado (falta o GITHUB_TOKEN na Vercel)." }); return null; }
  const b = corpo(req);
  const site = siteValido(b.site);
  if (!site) { res.status(400).json({ erro: "Endereço do site inválido." }); return null; }
  const a = await autorizar(site, b.codigo);
  if (a === "sem-acesso") { res.status(404).json({ erro: "Este site ainda não tem código de acesso. Gere o código no Criador e publique." }); return null; }
  if (a !== "ok") { res.status(401).json({ erro: "Código de acesso incorreto." }); return null; }
  return { b, site };
}

module.exports = { gh, lerArquivo, lerSite, extrairConfig, arvore, commitar, guardar, siteValido };
