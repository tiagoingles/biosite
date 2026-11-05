// Teste de fumaça do site no ar (só leitura: não grava nada).
// Uso: node scripts/fumaca.js [https://biosite-dusky.vercel.app]
// Confere: saúde da API e do banco, páginas principais, cabeçalhos de segurança, arquivos internos
// bloqueados, horários e equipe do site da GW Barbearia, e tempo de resposta.
const BASE = (process.argv[2] || process.env.SITE_URL || "https://biosite-dusky.vercel.app").replace(/\/+$/, "");
const SLUG = process.env.SITE_SLUG || "gw-barbearia";
const LIMITE_MS = Number(process.env.LIMITE_MS || 4000);

const falhas = [];
const avisos = [];
function confere(ok, msg) {
  if (!ok) falhas.push(msg);
  console.log((ok ? "  ok  " : "  FALHOU ") + msg);
}

async function pegar(caminho, opcoes = {}) {
  const t = Date.now();
  const r = await fetch(BASE + caminho, { redirect: "manual", ...opcoes, signal: AbortSignal.timeout(20000) });
  const ms = Date.now() - t;
  const texto = await r.text();
  if (ms > LIMITE_MS) avisos.push(`${caminho} demorou ${ms} ms`);
  return { r, ms, texto, json: () => JSON.parse(texto) };
}

function hojeBr() {
  return new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
}

(async () => {
  console.log("Teste de fumaça em " + BASE);

  const s = await pegar("/api/config?saude=1");
  confere(s.r.status === 200, `saúde responde 200 (veio ${s.r.status}, ${s.ms} ms)`);
  let saude = {};
  try { saude = s.json(); } catch (e) {}
  confere(saude.ok === true && saude.verificacoes && saude.verificacoes.banco, "banco conectado");

  for (const p of ["/" + SLUG, "/entrar", "/painel-dono", "/painel-barbeiro", "/app", "/financeiro"]) {
    const x = await pegar(p);
    confere(x.r.status === 200, `${p} abre (${x.r.status}, ${x.ms} ms)`);
    const h = x.r.headers;
    confere(!!h.get("content-security-policy"), `${p} tem Content-Security-Policy`);
    confere(h.get("x-content-type-options") === "nosniff", `${p} tem X-Content-Type-Options`);
    confere(!!h.get("x-frame-options"), `${p} tem X-Frame-Options`);
  }

  for (const p of ["/lib/servidor.js", "/lib/supabase.js", "/supabase/schema.sql", "/docs/especificacao-plataforma.md", "/tests/ajuda.js", "/package.json"]) {
    const x = await pegar(p);
    confere(x.r.status !== 200 || !/require\(|create table|# Especifica|SUPABASE_SERVICE_KEY/.test(x.texto), `${p} não é público (veio ${x.r.status})`);
  }

  const eq = await pegar(`/api/profissionais?slug=${SLUG}`);
  confere(eq.r.status === 200, `equipe do site responde (${eq.r.status})`);
  let equipe = [];
  try { equipe = eq.json().profissionais || []; } catch (e) {}
  confere(equipe.length > 0, `equipe tem barbeiros (${equipe.length})`);

  const dias = await pegar(`/api/horarios?slug=${SLUG}&profissional=qualquer&dias=1`);
  confere(dias.r.status === 200, `dias publicados respondem (${dias.r.status})`);
  let lista = [];
  try { lista = dias.json().dias || []; } catch (e) {}
  if (!lista.length) avisos.push("nenhum dia com agenda publicada nos próximos 30 dias");
  const dia = lista[0] || hojeBr();
  const hs = await pegar(`/api/horarios?slug=${SLUG}&profissional=qualquer&dia=${dia}&duracao=30`);
  confere(hs.r.status === 200, `horários de ${dia} respondem (${hs.r.status}, ${hs.ms} ms)`);

  const ruim = await pegar(`/api/horarios?slug=${SLUG}&profissional=qualquer&dia=2026-02-30&duracao=30`);
  confere(ruim.r.status === 400, "data inexistente é recusada");
  const anon = await pegar("/api/pedido?painel=1");
  confere(anon.r.status === 401, "painel sem login responde 401");
  const pedidoRuim = await pegar("/api/pedido", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: SLUG, dia: "2020-01-01", horario: "10:00", servico: "x", cliente: "Teste", qualquer: true }) });
  confere(pedidoRuim.r.status === 400, "pedido com data no passado é recusado (sem gravar)");

  const site = await pegar("/" + SLUG);
  confere(site.texto.includes("Seu pedido não foi registrado"), "site da GW com o agendamento novo");

  if (avisos.length) console.log("\nAvisos:\n - " + avisos.join("\n - "));
  if (falhas.length) {
    console.error(`\n${falhas.length} falha(s).`);
    process.exit(1);
  }
  console.log("\nTudo certo.");
})().catch((e) => {
  console.error("Erro no teste de fumaça:", e.message);
  process.exit(1);
});
