// Identificação do usuário logado e regras de perfil (dono, barbeiro, dono-barbeiro).
const { cfg, rest } = require("./supabase");

// Pergunta ao Supabase quem é o usuário do token enviado pelo navegador
async function usuarioDaRequisicao(req) {
  const m = String(req.headers.authorization || "").match(/^Bearer (.+)$/);
  if (!m) return null;
  const { url, key } = cfg();
  const r = await fetch(url + "/auth/v1/user", {
    headers: { apikey: key, Authorization: "Bearer " + m[1] },
  });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? { id: u.id, email: String(u.email || "").toLowerCase(), metadata: u.user_metadata || {} } : null;
}

async function perfilDe(userId) {
  const linhas = await rest(`perfis?user_id=eq.${userId}&select=user_id,barbearia_id,papel,nome`);
  return linhas[0] || null;
}

async function barbeariaDe(id) {
  const linhas = await rest(`barbearias?id=eq.${id}&select=id,slug,nome`);
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

module.exports = { usuarioDaRequisicao, perfilDe, perfilDoContexto, barbeariaDe, ehAdminDaPlataforma, ehAdmin, ehBarbeiro };
