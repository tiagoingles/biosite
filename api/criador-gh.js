// Ponte entre o Criador de Bio (criador.html) e o GitHub.
// O token do GitHub fica só na Vercel; o navegador manda apenas a senha de acesso.
// Proteção: senha comparada em tempo constante, até 10 erros por origem em 15 minutos,
// só os caminhos que o Criador usa e nunca atualização forçada da branch.
// Variáveis de ambiente na Vercel:
//   CRIADOR_SENHA  senha que libera o Criador (use 16+ caracteres aleatórios)
//   GITHUB_TOKEN   token do GitHub com "Contents: Read and write" no repositório
//   GITHUB_REPO    ex.: tiagoingles/biosite
const { segredoIgual, bloqueadoPorTentativas, registrarErroDeSenha, corpoDe, falha } = require("../lib/seguranca");
const { VERSAO } = require("../lib/gerador");

const METODOS = ["GET", "POST", "PUT", "PATCH"];

// Só os caminhos que o Criador usa: informações do repositório, arquivos e a árvore do git
function caminhoPermitido(c) {
  return (c === "" || /^\/(contents|git)\/[A-Za-z0-9_./%?=&,-]*$/.test(c)) && !c.includes("..") && !c.includes("//");
}

// Endereços das páginas da plataforma: um site de cliente nunca pode usar (nem sobrescrever)
const RESERVADOS = new Set([
  "app", "entrar", "redefinir", "financeiro", "criador", "index", "vendas", "planos", "precos", "privacidade", "termos",
  "sobre", "contato", "ajuda", "suporte", "status", "login", "cadastro", "blog", "previa", "404", "sw", "conta", "avisos",
  "api", "lib", "img", "admin", "docs", "tests", "scripts", "supabase", "planilha",
]);
function slugDeSite(s) {
  return /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(s) && !RESERVADOS.has(s) && !s.startsWith("painel");
}
// Arquivos que o Criador pode publicar: a página do site, o atalho de avaliação, as fotos e o acesso ao painel de preços
function arquivoDeSite(p) {
  let m;
  if ((m = /^([a-z0-9-]+)\.html$/.exec(p))) return slugDeSite(m[1].replace(/-avaliar$/, ""));
  if ((m = /^img\/([a-z0-9-]+)\/[A-Za-z0-9._-]{1,120}$/.exec(p))) return slugDeSite(m[1]);
  if ((m = /^admin\/([a-z0-9-]+)\.json$/.exec(p))) return slugDeSite(m[1]);
  return false;
}
// Arquivos da plataforma que Criadores antigos regravavam a cada publicação: vale sempre a versão do repositório
const DA_PLATAFORMA = new Set(["api/precos.js", "painel.html"]);

// Confere a árvore enviada pelo Criador: tira os arquivos da plataforma e recusa qualquer coisa fora do site
function arvoreSegura(corpo) {
  let j;
  try { j = JSON.parse(corpo); } catch (e) { return { erro: "Pedido inválido." }; }
  if (!j || !Array.isArray(j.tree)) return { erro: "Pedido inválido." };
  const tree = j.tree.filter((e) => !DA_PLATAFORMA.has(String(e && e.path)));
  for (const e of tree) {
    const p = String((e && e.path) || "");
    if (!arquivoDeSite(p)) return { erro: `O Criador só publica arquivos do site; "${p.slice(0, 80)}" é da plataforma ou é um endereço reservado.` };
    if (e.type !== "blob" || e.mode !== "100644") return { erro: "Pedido inválido." };
  }
  return { corpo: JSON.stringify({ ...j, tree }) };
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
    // Aba antiga do Criador guarda o gerador e os arquivos antigos na memória: só publica quem está na versão atual
    if (metodo !== "GET" && Number(b.versao) !== VERSAO) {
      return res.status(426).json({ message: "Esta aba do Criador está desatualizada. Recarregue a página (Ctrl+Shift+R) e publique de novo; o rascunho fica salvo." });
    }
    // Atualização da branch só para a frente (sem reescrever o histórico)
    let corpo = b.corpo ? String(b.corpo) : undefined;
    if (corpo && metodo === "POST" && caminho === "/git/trees") {
      const a = arvoreSegura(corpo);
      if (a.erro) return res.status(400).json({ message: a.erro });
      corpo = a.corpo;
    }
    if (metodo === "PUT" && caminho.startsWith("/contents/")) {
      let arq = "";
      try { arq = decodeURIComponent(caminho.slice("/contents/".length).split("?")[0]); } catch (e) {}
      if (!arquivoDeSite(arq)) return res.status(400).json({ message: "O Criador só grava arquivos do site." });
    }
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
