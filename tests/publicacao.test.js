// Configuração de publicação: cabeçalhos de segurança, arquivos internos fora do site,
// limite de funções do plano gratuito da Vercel e páginas que compilam.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const raiz = path.join(__dirname, "..");
const ler = (p) => fs.readFileSync(path.join(raiz, p), "utf8");

test("cabeçalhos de segurança em todas as páginas", () => {
  const v = JSON.parse(ler("vercel.json"));
  const geral = v.headers.find((h) => h.source === "/(.*)");
  const nomes = geral.headers.map((h) => h.key);
  for (const k of ["X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy", "X-Frame-Options"]) assert.ok(nomes.includes(k), k);
  const csp = v.headers.find((h) => h.source === "/((?!criador).*)").headers.find((h) => h.key === "Content-Security-Policy").value;
  for (const diretiva of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'self'", "base-uri 'self'", "form-action 'self'", "connect-src 'self' https://*.supabase.co"]) {
    assert.ok(csp.includes(diretiva), diretiva);
  }
  assert.ok(!/script-src[^;]*https?:/.test(csp), "nenhum script de outro domínio");
});

test("código do servidor, SQL, documentos e testes não ficam públicos", () => {
  const v = JSON.parse(ler("vercel.json"));
  assert.ok(v.redirects.some((r) => r.source === "/lib/:caminho*"), "lib/ bloqueado por redirecionamento");
  const ignorados = ler(".vercelignore").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  for (const p of ["tests", "scripts", "docs", "supabase", "planilha", "admin", ".github", "package.json"]) assert.ok(ignorados.includes(p), p);
});

test("até 12 funções na pasta api (limite do plano gratuito da Vercel)", () => {
  const funcoes = fs.readdirSync(path.join(raiz, "api")).filter((f) => f.endsWith(".js"));
  assert.ok(funcoes.length <= 12, funcoes.length + " funções");
});

test("todas as rotas carregam sem erro", () => {
  for (const f of fs.readdirSync(path.join(raiz, "api")).filter((x) => x.endsWith(".js"))) {
    const h = require(path.join(raiz, "api", f));
    assert.equal(typeof h, "function", f);
  }
});

test("scripts das páginas compilam", () => {
  const paginas = fs.readdirSync(raiz).filter((f) => f.endsWith(".html"));
  for (const p of paginas) {
    const html = ler(p);
    const re = /<script(?![^>]*\bsrc=)(?![^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/g;
    let m, n = 0;
    while ((m = re.exec(html))) new vm.Script(m[1], { filename: `${p}#${++n}` });
  }
  for (const js of ["conta.js", "avisos.js", "sw.js", "painel-comum.js"].filter((f) => fs.existsSync(path.join(raiz, f)))) new vm.Script(ler(js), { filename: js });
});

test("painéis: conteúdo vindo do banco só entra na página escapado", () => {
  for (const p of ["painel-dono.html", "painel-barbeiro.html", "app.html", "financeiro.html", "painel-comum.js"].filter((f) => fs.existsSync(path.join(raiz, f)))) {
    const linhas = ler(p).split(/\r?\n/);
    linhas.forEach((l, i) => {
      if (!/\.innerHTML\s*=/.test(l)) return;
      // Permitido: texto fixo entre aspas, ou montagem que passa por esc()
      const direita = l.slice(l.indexOf("innerHTML"));
      const temVariavel = /\+\s*[a-zA-Z_$][\w$.]*(\[[^\]]*\])?\s*(\+|;|\))/.test(direita) || /\$\{/.test(direita);
      if (temVariavel) assert.ok(/esc\(|brl\(|fmtData\(|icone\(|n\(|String\(Number/.test(direita), `${p}:${i + 1} innerHTML com dado sem esc(): ${l.trim().slice(0, 140)}`);
    });
  }
});

test("service worker só abre endereços do próprio site", () => {
  const sw = ler("sw.js");
  assert.match(sw, /startsWith\("\/"\)|new URL/);
});
