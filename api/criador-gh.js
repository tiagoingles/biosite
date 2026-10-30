// Ponte entre o Criador de Bio (criador.html) e o GitHub.
// O token do GitHub fica só na Vercel; o navegador manda apenas a senha de acesso.
// Variáveis de ambiente na Vercel:
//   CRIADOR_SENHA  senha que libera o Criador
//   GITHUB_TOKEN   token do GitHub com "Contents: Read and write" no repositório
//   GITHUB_REPO    ex.: tiagoingles/biosite
const crypto = require("crypto");

const METODOS = ["GET", "POST", "PUT", "PATCH"];

// Só os caminhos que o Criador usa: informações do repositório, arquivos e a árvore do git
function caminhoPermitido(c) {
  return (c === "" || /^\/(contents|git)\//.test(c)) && !c.includes("..");
}

function senhaCorreta(enviada) {
  const alvo = Buffer.from(process.env.CRIADOR_SENHA || "");
  const dada = Buffer.from(String(enviada || ""));
  return alvo.length > 0 && dada.length === alvo.length && crypto.timingSafeEqual(dada, alvo);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ message: "Método não permitido." });

  if (!process.env.CRIADOR_SENHA || !process.env.GITHUB_TOKEN || !process.env.GITHUB_REPO) {
    return res.status(500).json({ message: "Servidor não configurado (faltam CRIADOR_SENHA, GITHUB_TOKEN ou GITHUB_REPO na Vercel)." });
  }

  let b = req.body;
  if (typeof b === "string") {
    try { b = JSON.parse(b || "{}"); } catch (e) { return res.status(400).json({ message: "Pedido inválido." }); }
  }
  b = b || {};

  if (!senhaCorreta(b.senha)) {
    await new Promise((r) => setTimeout(r, 800));
    return res.status(401).json({ message: "Senha incorreta." });
  }

  const caminho = String(b.caminho ?? "");
  const metodo = String(b.metodo || "GET").toUpperCase();
  if (!caminhoPermitido(caminho) || !METODOS.includes(metodo)) {
    return res.status(400).json({ message: "Pedido não permitido." });
  }

  const r = await fetch("https://api.github.com/repos/" + process.env.GITHUB_REPO + caminho, {
    method: metodo,
    cache: "no-store",
    body: b.corpo ? String(b.corpo) : undefined,
    headers: {
      Authorization: "Bearer " + process.env.GITHUB_TOKEN,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "biosite",
      ...(b.corpo ? { "Content-Type": "application/json" } : {}),
    },
  });
  // 401 aqui é o token do GitHub, não a senha: não pode aparecer como "senha incorreta" no navegador
  if (r.status === 401) return res.status(502).json({ message: "O token do GitHub guardado na Vercel é inválido ou expirou." });
  const j = await r.json().catch(() => ({}));
  return res.status(r.status).json(j);
};
