// Painel do dono: lê e salva preços e "esgotado" dos produtos de um site.
// Variáveis de ambiente na Vercel:
//   GITHUB_TOKEN  token do GitHub com "Contents: Read and write" no repositório
//   GITHUB_REPO   ex.: tiagoingles/bios
const crypto = require("crypto");

const INI = '<script type="application/json" id="bio-config">';

function gh(path, opt = {}) {
  return fetch("https://api.github.com/repos/" + process.env.GITHUB_REPO + path, {
    method: opt.method || "GET",
    body: opt.body,
    cache: "no-store",
    headers: {
      Authorization: "Bearer " + process.env.GITHUB_TOKEN,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "bios-painel",
      ...(opt.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

async function lerArquivo(path) {
  const r = await gh("/contents/" + path);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("GitHub " + r.status);
  const j = await r.json();
  let b64 = j.content;
  if (!b64) {
    const b = await gh("/git/blobs/" + j.sha);
    b64 = (await b.json()).content;
  }
  return { sha: j.sha, texto: Buffer.from(b64, "base64").toString("utf8") };
}

function extrairConfig(html) {
  const i = html.indexOf(INI);
  if (i < 0) return null;
  const j = html.indexOf("</script>", i);
  return { i, j, cfg: JSON.parse(html.slice(i + INI.length, j)) };
}

function normCodigo(c) {
  return String(c || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function verificar(codigo, acesso) {
  if (!acesso || !acesso.hash || !codigo) return false;
  const h = crypto.pbkdf2Sync(normCodigo(codigo), Buffer.from(acesso.salt, "hex"), acesso.iter || 150000, 32, "sha256");
  const alvo = Buffer.from(acesso.hash, "hex");
  return alvo.length === h.length && crypto.timingSafeEqual(h, alvo);
}

function num(v) {
  let t = String(v == null ? "" : v).replace(/[^\d,.]/g, "");
  if (!t) return NaN;
  if (t.indexOf(",") > -1) t = t.replace(/\./g, "").replace(",", ".");
  return parseFloat(t);
}
const brl = (n) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ erro: "Método não permitido." });
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPO)
    return res.status(500).json({ erro: "O painel ainda não foi configurado no servidor." });
  try {
    let b = req.body;
    if (typeof b === "string") b = JSON.parse(b || "{}");
    b = b || {};
    const site = String(b.site || "").toLowerCase();
    if (!/^[a-z0-9-]{1,60}$/.test(site)) return res.status(400).json({ erro: "Endereço do site inválido." });

    const acessoArq = await lerArquivo("admin/" + site + ".json");
    if (!acessoArq) return res.status(404).json({ erro: "Este site ainda não tem painel liberado. Fale com quem criou o seu site." });
    if (!verificar(b.codigo, JSON.parse(acessoArq.texto))) {
      await new Promise((r) => setTimeout(r, 800));
      return res.status(401).json({ erro: "Código de acesso incorreto." });
    }

    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const arq = await lerArquivo(site + ".html");
      if (!arq) return res.status(404).json({ erro: "Site não encontrado." });
      const x = extrairConfig(arq.texto);
      if (!x) return res.status(500).json({ erro: "Não consegui ler os produtos deste site." });
      const cfg = x.cfg;

      if (b.acao === "ler") {
        return res.json({
          nome: cfg.nome,
          cor: cfg.cor,
          categorias: cfg.categorias || [],
          produtos: (cfg.produtos || []).map((p) => ({ id: p.id, nome: p.nome, cat: p.cat || "", preco: p.preco || "", esgotado: !!p.esgotado })),
          atualizadoEm: cfg.precosAtualizadosEm || null,
        });
      }
      if (b.acao !== "salvar") return res.status(400).json({ erro: "Ação inválida." });

      const alt = Array.isArray(b.alteracoes) ? b.alteracoes.slice(0, 500) : [];
      let html = arq.texto, n = 0;
      for (const a of alt) {
        const p = (cfg.produtos || []).find((q) => q.id === a.id);
        if (!p) continue;
        if (typeof a.preco === "string") {
          const v = a.preco.trim().slice(0, 20);
          if (v && isNaN(num(v))) return res.status(400).json({ erro: 'Preço inválido em "' + p.nome + '".' });
          p.preco = v;
        }
        if (typeof a.esgotado === "boolean") p.esgotado = a.esgotado;
        n++;
        if (/^[A-Za-z0-9_-]+$/.test(p.id)) {
          const txt = isNaN(num(p.preco)) ? "Consultar" : brl(num(p.preco));
          html = html.replace(new RegExp('(<b class="preco" data-pid="' + p.id + '">)[^<]*(</b>)'), (m, a1, a2) => a1 + txt + a2);
        }
      }
      if (!n) return res.json({ ok: true, alterados: 0 });

      cfg.precosAtualizadosEm = new Date().toISOString();
      const k = extrairConfig(html);
      html = html.slice(0, k.i + INI.length) + JSON.stringify(cfg).replace(/</g, "\\u003c") + html.slice(k.j);

      const r = await gh("/contents/" + site + ".html", {
        method: "PUT",
        body: JSON.stringify({
          message: "Preços atualizados pelo dono: " + cfg.nome,
          content: Buffer.from(html, "utf8").toString("base64"),
          sha: arq.sha,
        }),
      });
      if (r.status === 409 || r.status === 422) continue;
      if (!r.ok) throw new Error("GitHub " + r.status);
      return res.json({ ok: true, alterados: n, atualizadoEm: cfg.precosAtualizadosEm });
    }
    return res.status(409).json({ erro: "O site foi alterado ao mesmo tempo. Tente salvar de novo." });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: "Não foi possível concluir agora. Tente de novo em instantes." });
  }
};
