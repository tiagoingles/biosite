// Painel do dono (/painel?s=<site>): lê e salva preços e "esgotado".
const S = require("../lib/servidor");
const G = require("../lib/gerador");

module.exports = async (req, res) => {
  try {
    const ok = await S.guardar(req, res);
    if (!ok) return;
    const { b, site } = ok;
    const atual = await S.lerSite(site);
    if (!atual) return res.status(404).json({ erro: "Site não encontrado." });
    const cfg = atual.cfg;

    if (b.acao === "ler") {
      return res.json({
        nome: cfg.nome,
        cor: cfg.cor,
        planilha: !!cfg.planilha,
        categorias: cfg.categorias || [],
        produtos: (cfg.produtos || []).map((p) => ({ id: p.id, nome: p.nome, cat: p.cat || "", preco: p.preco || "", esgotado: !!p.esgotado })),
        atualizadoEm: cfg.precosAtualizadosEm || null,
      });
    }
    if (b.acao !== "salvar") return res.status(400).json({ erro: "Ação inválida." });
    if (cfg.planilha) return res.status(409).json({ erro: "Os preços deste site são atualizados pela planilha. Faça a mudança na planilha." });

    let n = 0;
    for (const a of Array.isArray(b.alteracoes) ? b.alteracoes.slice(0, 500) : []) {
      const p = (cfg.produtos || []).find((q) => q.id === a.id);
      if (!p) continue;
      if (typeof a.preco === "string") {
        const v = a.preco.trim().slice(0, 20);
        if (v && isNaN(G.num(v))) return res.status(400).json({ erro: 'Preço inválido em "' + p.nome + '".' });
        p.preco = v;
      }
      if (typeof a.esgotado === "boolean") p.esgotado = a.esgotado;
      n++;
    }
    if (!n) return res.json({ ok: true, alterados: 0 });

    cfg.precosAtualizadosEm = new Date().toISOString();
    await S.commitar([{ path: site + ".html", mode: "100644", type: "blob", content: G.bioHTML(cfg, (u) => u) }], "Preços atualizados pelo dono: " + cfg.nome);
    return res.json({ ok: true, alterados: n, atualizadoEm: cfg.precosAtualizadosEm });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: e.publico ? e.message : "Não foi possível concluir agora. Tente de novo em instantes." });
  }
};
