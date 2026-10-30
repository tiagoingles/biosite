// Recebe o catálogo da planilha Google do cliente (script da planilha) e publica o site.
// Ações:
//   ler        devolve os produtos atuais do site (para preencher a planilha na primeira vez)
//   status     devolve as fotos da planilha que já estão no site
//   foto       recebe uma foto (base64) e guarda no GitHub, sem publicar ainda
//   publicar   troca os produtos do site pelos da planilha e publica (um único commit)
const S = require("../lib/servidor");
const G = require("../lib/gerador");

const CHAVE = /^d-[A-Za-z0-9_-]{10,80}-[a-z0-9]{4,14}$/;

function tipoImagem(b64) {
  const ini = Buffer.from(b64.slice(0, 24), "base64");
  if (ini[0] === 0xff && ini[1] === 0xd8) return "jpg";
  if (ini[0] === 0x89 && ini[1] === 0x50) return "png";
  if (ini.slice(0, 4).toString() === "RIFF" && ini.slice(8, 12).toString() === "WEBP") return "webp";
  if (ini.slice(0, 3).toString() === "GIF") return "gif";
  return "";
}

module.exports = async (req, res) => {
  try {
    const ok = await S.guardar(req, res);
    if (!ok) return;
    const { b, site } = ok;
    const prefixo = "img/" + site + "/";

    if (b.acao === "ler") {
      const a = await S.lerSite(site);
      if (!a) return res.status(404).json({ erro: "Este site ainda não foi publicado pelo Criador." });
      const c = a.cfg;
      return res.json({
        nome: c.nome,
        categorias: c.categorias || [],
        produtos: (c.produtos || []).map((p) => ({ id: p.id, nome: p.nome, preco: p.preco || "", cat: p.cat || "", desc: p.desc || "", esgotado: !!p.esgotado, temFoto: !!p.foto })),
      });
    }

    if (b.acao === "status") {
      const arv = await S.arvore();
      return res.json({ fotos: arv.filter((t) => t.path.startsWith(prefixo + "d-")).map((t) => t.path.slice(prefixo.length).replace(/\.jpg$/, "")) });
    }

    if (b.acao === "foto") {
      const chave = String(b.chave || "");
      const b64 = String(b.base64 || "").replace(/\s/g, "");
      if (!CHAVE.test(chave)) return res.status(400).json({ erro: "Identificação da foto inválida." });
      if (!b64 || b64.length > 4000000) return res.status(400).json({ erro: "Foto grande demais." });
      if (!tipoImagem(b64)) return res.status(400).json({ erro: "O arquivo não é uma imagem JPG, PNG, WEBP ou GIF." });
      const bl = await S.gh("/git/blobs", { method: "POST", body: JSON.stringify({ content: b64, encoding: "base64" }) });
      return res.json({ sha: bl.sha });
    }

    if (b.acao === "publicar") {
      const a = await S.lerSite(site);
      if (!a) return res.status(404).json({ erro: "Este site ainda não foi publicado pelo Criador." });
      const cfg = a.cfg;
      const antes = new Map((cfg.produtos || []).map((p) => [p.id, p]));
      const novas = b.novasFotos && typeof b.novasFotos === "object" ? b.novasFotos : {};
      const arv = await S.arvore();
      const existentes = new Set(arv.map((t) => t.path));
      const entradas = [], avisos = [], produtos = [], ids = new Set();

      for (const r of Array.isArray(b.produtos) ? b.produtos.slice(0, 1000) : []) {
        const nome = String(r.nome || "").trim().slice(0, 120);
        if (!nome) continue;
        const id = String(r.id || "").trim();
        if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || ids.has(id)) { avisos.push('Código inválido ou repetido em "' + nome + '".'); continue; }
        ids.add(id);
        let preco = String(r.preco == null ? "" : r.preco).trim().slice(0, 20);
        if (preco && isNaN(G.num(preco))) { avisos.push('Preço inválido em "' + nome + '": ficou como "Consultar".'); preco = ""; }

        let foto = (antes.get(id) || {}).foto || "";
        const f = String(r.foto || "").trim();
        if (f === "-") foto = "";
        else if (f) {
          const path = prefixo + f + ".jpg";
          if (!CHAVE.test(f)) avisos.push('Foto inválida em "' + nome + '".');
          else if (existentes.has(path)) foto = "/" + path;
          else if (/^[0-9a-f]{40}$/.test(novas[f] || "")) { entradas.push({ path, mode: "100644", type: "blob", sha: novas[f] }); existentes.add(path); foto = "/" + path; }
          else avisos.push('A foto de "' + nome + '" não chegou. Tento de novo na próxima atualização.');
        }
        produtos.push({
          id, nome, preco,
          cat: String(r.cat || "").trim().slice(0, 60),
          desc: String(r.desc || "").trim().slice(0, 400),
          foto, esgotado: !!r.esgotado,
        });
      }
      if (!produtos.length) return res.status(400).json({ erro: "A planilha não tem nenhum produto com nome." });

      cfg.produtos = produtos;
      cfg.categorias = [...new Set(produtos.map((p) => p.cat).filter(Boolean))];
      cfg.planilha = true;

      const usadas = new Set(produtos.map((p) => p.foto).filter((u) => u.startsWith("/" + prefixo)).map((u) => u.slice(1)));
      for (const t of arv) if (t.path.startsWith(prefixo + "d-") && !usadas.has(t.path)) entradas.push({ path: t.path, mode: "100644", type: "blob", sha: null });

      // Sem mudança nenhuma? Não publica de novo.
      if (!entradas.length && G.bioHTML(cfg, (u) => u) === a.texto) return res.json({ ok: true, semMudancas: true, produtos: produtos.length, avisos });

      cfg.precosAtualizadosEm = new Date().toISOString();
      entradas.push({ path: site + ".html", mode: "100644", type: "blob", content: G.bioHTML(cfg, (u) => u) });
      await S.commitar(entradas, "Catálogo atualizado pela planilha: " + cfg.nome);
      return res.json({ ok: true, produtos: produtos.length, avisos });
    }

    return res.status(400).json({ erro: "Ação inválida." });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: e.publico ? e.message : "Não foi possível concluir agora. Tente de novo em instantes." });
  }
};
