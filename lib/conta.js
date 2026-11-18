// Identificação do usuário logado e regras de perfil (dono, barbeiro, dono-barbeiro).
const { cfg, rest } = require("./supabase");

// ---------- Demonstração sem login (fase 25) ----------
// O painel da barbearia vitrine (barbearias.demonstracao = 'vitrine') abre para qualquer pessoa, só para olhar.
// O navegador manda "Bearer demo-dono" ou "Bearer demo-barbeiro": a conta é de mentira, enxerga só a vitrine
// e tudo o que não é leitura (GET) é recusado aqui, antes de chegar em qualquer rota.
const TOKENS_DEMO = { "demo-dono": "dono", "demo-barbeiro": "barbeiro" };
const IDS_DEMO = { dono: "00000000-0000-4000-8000-00000000d0d0", barbeiro: "00000000-0000-4000-8000-00000000b0b0" };
const MSG_DEMO = "Esta é uma demonstração: aqui nada é salvo. Para usar na sua barbearia, fale com o Bio Site.";
let vitrineEmCache = null;

async function vitrine() {
  if (vitrineEmCache && Date.now() - vitrineEmCache.em < 5 * 60 * 1000) return vitrineEmCache.b;
  const b = (await rest("barbearias?demonstracao=eq.vitrine&select=id,nome&order=criado_em.asc&limit=1"))[0] || null;
  vitrineEmCache = { b, em: Date.now() };
  return b;
}

// "dono", "barbeiro" ou null: a conta de mentira da demonstração
function papelDemo(userId) {
  return userId === IDS_DEMO.dono ? "dono" : userId === IDS_DEMO.barbeiro ? "barbeiro" : null;
}

// O barbeiro de exemplo da vitrine (o primeiro da equipe é o dono)
async function profissionalDemo(campos) {
  const v = await vitrine();
  if (!v) return null;
  return (await rest(`profissionais?barbearia_id=eq.${v.id}&ativo=eq.true&select=${campos || "id,barbearia_id,nome"}&order=criado_em.asc&offset=1&limit=1`))[0] || null;
}

// Pergunta ao Supabase quem é o usuário do token enviado pelo navegador
async function usuarioDaRequisicao(req) {
  const m = String(req.headers.authorization || "").match(/^Bearer (.+)$/);
  if (!m) return null;
  const demo = TOKENS_DEMO[m[1]];
  if (demo) {
    if (req.method !== "GET") throw Object.assign(new Error(MSG_DEMO), { status: 403 });
    if (!(await vitrine())) return null;
    return { id: IDS_DEMO[demo], email: "demonstracao@barbeirotop.com.br", metadata: { full_name: demo === "dono" ? "Dono da demonstração" : "Barbeiro da demonstração" }, demo };
  }
  const { url, key } = cfg();
  const r = await fetch(url + "/auth/v1/user", {
    headers: { apikey: key, Authorization: "Bearer " + m[1] },
  });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? { id: u.id, email: String(u.email || "").toLowerCase(), metadata: u.user_metadata || {} } : null;
}

async function perfilDe(userId) {
  const demo = papelDemo(userId);
  if (demo) {
    const v = await vitrine();
    return v ? { user_id: userId, barbearia_id: v.id, papel: demo, nome: demo === "dono" ? "Dono da demonstração" : "Barbeiro da demonstração", demo: true } : null;
  }
  const linhas = await rest(`perfis?user_id=eq.${userId}&select=user_id,barbearia_id,papel,nome`);
  return linhas[0] || null;
}

async function barbeariaDe(id) {
  const linhas = await rest(`barbearias?id=eq.${id}&select=id,slug,nome,confirmacao_automatica,protese_ativa,sinal,pedir_confirmacao_min,whatsapp,demonstracao`);
  return linhas[0] || null;
}

// Administra todos os sites (conta da plataforma, sem barbearia própria)
async function ehAdminDaPlataforma(userId) {
  const linhas = await rest(`plataforma_admins?user_id=eq.${userId}&select=user_id`);
  return linhas.length > 0;
}

// Perfil usado pelas rotas: o do próprio usuário. O administrador da plataforma que pede
// uma barbearia (?barbearia=id) vê a página como o dono dela (visão de administração).
async function perfilDoContexto(u, req) {
  const alvo = String((req.query || {}).barbearia || "");
  if (/^[0-9a-f-]{36}$/i.test(alvo) && (await ehAdminDaPlataforma(u.id))) {
    return { user_id: u.id, barbearia_id: alvo, papel: "dono", nome: "Administração", visaoAdmin: true };
  }
  return perfilDe(u.id);
}

// Quem administra a barbearia (dono ou dono-barbeiro)
function ehAdmin(perfil) {
  return !!perfil && (perfil.papel === "dono" || perfil.papel === "dono_barbeiro");
}

// Quem atende (barbeiro ou dono-barbeiro)
function ehBarbeiro(perfil) {
  return !!perfil && (perfil.papel === "barbeiro" || perfil.papel === "dono_barbeiro");
}

module.exports = { usuarioDaRequisicao, perfilDe, perfilDoContexto, barbeariaDe, ehAdminDaPlataforma, ehAdmin, ehBarbeiro, papelDemo, profissionalDemo, IDS_DEMO, MSG_DEMO };
