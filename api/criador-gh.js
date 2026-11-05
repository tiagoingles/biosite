// Ponte entre o Criador de Bio (criador.html) e o GitHub.
// O token do GitHub fica só na Vercel; o navegador manda apenas a senha de acesso.
// Proteção: senha comparada em tempo constante, até 10 erros por origem em 15 minutos,
// só os caminhos que o Criador usa e nunca atualização forçada da branch.
// Variáveis de ambiente na Vercel:
//   CRIADOR_SENHA  senha que libera o Criador (use 16+ caracteres aleatórios)
//   GITHUB_TOKEN   token do GitHub com "Contents: Read and write" no repositório
//   GITHUB_REPO    ex.: tiagoingles/biosite
const { segredoIgual, bloqueadoPorTentativas, registrarErroDeSenha, corpoDe, falha } = require("../lib/seguranca");

const METODOS = ["GET", "POST", "PUT", "PATCH"];

// Só os caminhos que o Criador usa: informações do repositório, arquivos e a árvore do git
function caminhoPermitido(c) {
  return (c === "" || /^\/(contents|git)\/[A-Za-z0-9_./%?=&,-]*$/.test(c)) && !c.includes("..") && !c.includes("//");
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ message: "Método não permitido." });

  if (!process.env.CRIADOR_SENHA || !process.env.GITHUB_TOKEN || !process.env.GITHUB_REPO) {
    return res.status(500).json({ message: "Servidor não configurado (faltam CRIADOR_SENHA, GITHUB_TOKEN ou GITHUB_REPO na Vercel)." });
  }

  try {
    if (await bloqueadoPorTentativas(req, "criador")) {
      return res.status(429).json({ message: "Muitas tentativas de senha. Espere 15 minutos e tente de novo." });
    }
    const b = corpoDe(req);
    if (!segredoIgual(b.senha, process.env.CRIADOR_SENHA)) {
      await registrarErroDeSenha(req, "criador");
      await new Promise((r) => setTimeout(r, 800));
      return res.status(401).json({ message: "Senha incorreta." });
    }

    const caminho = String(b.caminho ?? "");
    const metodo = String(b.metodo || "GET").toUpperCase();
    if (!caminhoPermitido(caminho) || !METODOS.includes(metodo)) {
      return res.status(400).json({ message: "Pedido não permitido." });
    }
    // Atualização da branch só para a frente (sem reescrever o histórico)
    let corpo = b.corpo ? String(b.corpo) : undefined;
    if (corpo && metodo === "PATCH" && caminho.startsWith("/git/refs/")) {
      try {
        const j = JSON.parse(corpo);
        if (j.force) return res.status(400).json({ message: "Atualização forçada não é permitida." });
      } catch (e) {
        return res.status(400).json({ message: "Pedido inválido." });
      }
    }
    if (corpo && corpo.length > 4500000) return res.status(413).json({ message: "Arquivo grande demais." });

    const r = await fetch("https://api.github.com/repos/" + process.env.GITHUB_REPO + caminho, {
      method: metodo,
      cache: "no-store",
      body: corpo,
      headers: {
        Authorization: "Bearer " + process.env.GITHUB_TOKEN,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "biosite",
        ...(corpo ? { "Content-Type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(25000),
    });
    // 401 aqui é o token do GitHub, não a senha: não pode aparecer como "senha incorreta" no navegador
    if (r.status === 401) return res.status(502).json({ message: "O token do GitHub guardado na Vercel é inválido ou expirou." });
    const j = await r.json().catch(() => ({}));
    return res.status(r.status).json(j);
  } catch (e) {
    return falha(res, e, "POST /api/criador-gh");
  }
};
