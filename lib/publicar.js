// Publicação de site pelo Criador: liga o site a uma barbearia, cria o usuário de teste
// (para mostrar o painel aos vendedores) e, se pedido, o convite para o dono criar o perfil.
const crypto = require("crypto");
const { rest, cfg } = require("./supabase");

const DOMINIO_TESTE = "teste.biosite.app";
const DIAS_CONVITE = 7;
const SLUG = /^[a-z0-9-]{3,40}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f-]{36}$/i;

function erro(status, message) {
  return Object.assign(new Error(message), { status });
}

function emailDoTeste(slug) {
  return `teste-${slug}@${DOMINIO_TESTE}`;
}

// 12 caracteres sem letras ambíguas (sem 0, 1, i, l, o)
function senhaNova() {
  const alfabeto = "23456789abcdefghjkmnpqrstuvwxyz";
  let s = "";
  while (s.length < 12) {
    for (const v of crypto.randomBytes(24)) {
      if (v < 248 && s.length < 12) s += alfabeto[v % alfabeto.length];
    }
  }
  return s;
}

// Chamadas à parte de administração da autenticação do Supabase (usa a chave de serviço)
async function authAdmin(caminho, { metodo = "POST", corpo } = {}) {
  const { url, key } = cfg();
  const r = await fetch(`${url}/auth/v1/admin/${caminho}`, {
    method: metodo,
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Autenticação: " + (j.msg || j.message || j.error_description || r.status));
  return j;
}

// Cria o usuário de teste já confirmado (sem e-mail) e liga ele à barbearia como dono
async function criarTeste(barbearia, nome) {
  const email = emailDoTeste(barbearia.slug);
  const senha = senhaNova();
  const usuario = await authAdmin("users", {
    corpo: { email, password: senha, email_confirm: true, user_metadata: { full_name: "Teste " + nome } },
  });
  try {
    await rest("perfis", {
      metodo: "POST",
      prefer: "return=minimal",
      corpo: { user_id: usuario.id, barbearia_id: barbearia.id, papel: "dono", nome: "Teste " + nome },
    });
    await rest(`barbearias?id=eq.${barbearia.id}`, { metodo: "PATCH", prefer: "return=minimal", corpo: { teste_user_id: usuario.id } });
  } catch (e) {
    await authAdmin(`users/${usuario.id}`, { metodo: "DELETE" }).catch(() => {});
    throw e;
  }
  return { email, senha };
}

// origem: endereço do site (ex.: https://biosite-dusky.vercel.app), para montar o convite
async function publicar({ nome, slug, emailDono, origem }) {
  if (!nome) throw erro(400, "Informe o nome da barbearia.");
  if (!SLUG.test(slug)) throw erro(400, "Endereço inválido: use de 3 a 40 letras minúsculas, números ou hífen.");
  if (emailDono && !EMAIL.test(emailDono)) throw erro(400, "E-mail do dono inválido.");

  let barbearia = (await rest(`barbearias?slug=eq.${slug}&select=id,slug,nome,teste_user_id`))[0];
  const nova = !barbearia;
  let teste = null;
  let convite = null;
  try {
    if (nova) {
      [barbearia] = await rest("barbearias", { metodo: "POST", prefer: "return=representation", corpo: { nome, slug } });
    }
    // Só cria o teste se ainda não existir; quem já tem usa "Nova senha" no painel
    if (!barbearia.teste_user_id) teste = await criarTeste(barbearia, barbearia.nome || nome);

    if (emailDono) {
      const token = crypto.randomBytes(24).toString("hex");
      await rest("convites", {
        metodo: "POST",
        prefer: "return=minimal",
        corpo: {
          barbearia_id: barbearia.id,
          email: emailDono,
          token,
          papel: "dono",
          expira_em: new Date(Date.now() + DIAS_CONVITE * 864e5).toISOString(),
        },
      });
      convite = `${origem}/entrar.html?convite=${token}`;
    }
  } catch (e) {
    if (nova && barbearia) await rest(`barbearias?id=eq.${barbearia.id}`, { metodo: "DELETE", prefer: "return=minimal" }).catch(() => {});
    throw e;
  }

  return { nova, barbearia: { id: barbearia.id, slug, nome: barbearia.nome }, teste, convite };
}

// Gera outra senha para o usuário de teste do site (a antiga para de funcionar)
async function redefinirTeste(slug) {
  if (!SLUG.test(slug)) throw erro(400, "Endereço inválido.");
  const barbearia = (await rest(`barbearias?slug=eq.${slug}&select=id,teste_user_id`))[0];
  if (!barbearia) throw erro(404, "Site não encontrado.");
  if (!barbearia.teste_user_id) throw erro(409, "Este site ainda não tem usuário de teste.");
  const senha = senhaNova();
  await authAdmin(`users/${barbearia.teste_user_id}`, { metodo: "PUT", corpo: { password: senha } });
  return { email: emailDoTeste(slug), senha };
}

// Acesso de teste de um barbeiro: entra no painel dele (agenda e confirmações)
function slugDoNome(nome) {
  return String(nome || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20) || "barbeiro";
}

async function criarTesteBarbeiro({ slug, profissionalId }) {
  if (!SLUG.test(slug)) throw erro(400, "Endereço inválido.");
  if (!UUID.test(String(profissionalId || ""))) throw erro(400, "Barbeiro inválido.");
  const barbearia = (await rest(`barbearias?slug=eq.${slug}&select=id`))[0];
  if (!barbearia) throw erro(404, "Site não encontrado.");
  const prof = (await rest(`profissionais?id=eq.${profissionalId}&barbearia_id=eq.${barbearia.id}&select=id,nome,perfil_user_id`))[0];
  if (!prof) throw erro(404, "Barbeiro não encontrado neste site.");
  if (prof.perfil_user_id) throw erro(409, "Este barbeiro já tem acesso. Use Nova senha.");

  const email = `teste-${slug}-${slugDoNome(prof.nome)}-${prof.id.slice(0, 4)}@${DOMINIO_TESTE}`;
  const senha = senhaNova();
  const usuario = await authAdmin("users", {
    corpo: { email, password: senha, email_confirm: true, user_metadata: { full_name: prof.nome } },
  });
  try {
    await rest("perfis", {
      metodo: "POST",
      prefer: "return=minimal",
      corpo: { user_id: usuario.id, barbearia_id: barbearia.id, papel: "barbeiro", nome: prof.nome },
    });
    await rest(`profissionais?id=eq.${prof.id}`, { metodo: "PATCH", prefer: "return=minimal", corpo: { perfil_user_id: usuario.id } });
  } catch (e) {
    await authAdmin(`users/${usuario.id}`, { metodo: "DELETE" }).catch(() => {});
    throw e;
  }
  return { email, senha, nome: prof.nome };
}

// Nova senha do acesso de teste de um barbeiro
async function redefinirTesteBarbeiro({ slug, profissionalId }) {
  if (!SLUG.test(slug)) throw erro(400, "Endereço inválido.");
  if (!UUID.test(String(profissionalId || ""))) throw erro(400, "Barbeiro inválido.");
  const barbearia = (await rest(`barbearias?slug=eq.${slug}&select=id`))[0];
  if (!barbearia) throw erro(404, "Site não encontrado.");
  const prof = (await rest(`profissionais?id=eq.${profissionalId}&barbearia_id=eq.${barbearia.id}&select=id,nome,perfil_user_id`))[0];
  if (!prof || !prof.perfil_user_id) throw erro(409, "Este barbeiro ainda não tem acesso de teste.");
  const senha = senhaNova();
  await authAdmin(`users/${prof.perfil_user_id}`, { metodo: "PUT", corpo: { password: senha } });
  return { senha, nome: prof.nome };
}

module.exports = { publicar, redefinirTeste, criarTesteBarbeiro, redefinirTesteBarbeiro, emailDoTeste };
