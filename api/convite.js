// Convite de dono ou de barbeiro.
// GET ?token=      mostra a barbearia, o e-mail convidado e se esse e-mail já tem conta.
// POST { token }   com a conta logada: aceita o convite com essa conta.
// POST { token, nome, senha } sem login: cria a conta já confirmada e aceita o convite. O link do convite
//   vai pelo WhatsApp e vale como confirmação (o Supabase não manda e-mail para quem não é da equipe).
//   Conta confirmada que já existe nunca tem a senha trocada por aqui: a pessoa entra com a senha dela.
const { rest } = require("../lib/supabase");
const { usuarioDaRequisicao, perfilDe, barbeariaDe } = require("../lib/conta");
const { texto } = require("../lib/agenda");
const { falha, corpoDe, contarTentativas, origemDe } = require("../lib/seguranca");
const { authAdmin } = require("../lib/publicar");

const TOKEN = /^[0-9a-f]{48}$/;
const MAX_ERROS_HORA = 20;

async function conviteValido(token) {
  if (!TOKEN.test(token)) return null;
  const linhas = await rest(`convites?token=eq.${token}&aceito_em=is.null&select=id,barbearia_id,email,expira_em,papel`);
  const c = linhas[0];
  if (!c || new Date(c.expira_em) < new Date()) return null;
  return c;
}

// Conta do Supabase com este e-mail (id e se está confirmada), ou null
async function contaDoEmail(email) {
  const r = await rest("rpc/conta_por_email", { metodo: "POST", corpo: { p_email: email } });
  return (Array.isArray(r) ? r[0] : r) || null;
}

function senhaFraca(s) {
  return s.length < 8 || s.length > 72 || !/[a-zA-Z]/.test(s) || !/\d/.test(s);
}

// Marca o convite como usado só se ninguém usou antes: dois toques ao mesmo tempo não criam duas contas
async function reservarConvite(c) {
  const r = await rest(`convites?id=eq.${c.id}&aceito_em=is.null`, { metodo: "PATCH", prefer: "return=representation", corpo: { aceito_em: new Date().toISOString() } });
  return Array.isArray(r) && r.length > 0;
}
async function liberarConvite(c) {
  await rest(`convites?id=eq.${c.id}`, { metodo: "PATCH", prefer: "return=minimal", corpo: { aceito_em: null } }).catch(() => {});
}

// Liga a conta à barbearia: o dono vira administrador do site; o barbeiro entra na equipe e na agenda
async function ligarConta(c, userId, nome) {
  const dono = c.papel === "dono";
  await rest("perfis", { metodo: "POST", prefer: "return=minimal", corpo: { user_id: userId, barbearia_id: c.barbearia_id, papel: dono ? "dono" : "barbeiro", nome } });
  if (dono) return;
  try {
    await rest("profissionais", { metodo: "POST", prefer: "return=minimal", corpo: { barbearia_id: c.barbearia_id, perfil_user_id: userId, nome } });
  } catch (e) {
    await rest(`perfis?user_id=eq.${userId}`, { metodo: "DELETE", prefer: "return=minimal" }).catch(() => {});
    throw e;
  }
}

async function criarContaPeloConvite(req, res, b) {
  const chave = `convite-conta:${origemDe(req) || "sem-origem"}`;
  if ((await contarTentativas(chave, 3600, false)) >= MAX_ERROS_HORA) return res.status(429).json({ message: "Muitas tentativas. Tente de novo mais tarde." });
  const c = await conviteValido(texto(b.token, 64));
  if (!c) {
    await contarTentativas(chave, 3600, true).catch(() => 0);
    return res.status(404).json({ message: "Convite inválido ou vencido. Peça um novo link a quem convidou você." });
  }
  const nome = texto(b.nome, 80);
  const senha = String(b.senha == null ? "" : b.senha);
  if (!nome) return res.status(400).json({ message: "Informe seu nome." });
  if (senhaFraca(senha)) return res.status(400).json({ message: "Crie uma senha com pelo menos 8 caracteres, com letras e números." });

  const existente = await contaDoEmail(c.email);
  if (existente && existente.confirmado) {
    return res.status(409).json({ message: `O e-mail ${c.email} já tem conta. Entre com a sua senha para aceitar o convite.`, temConta: true });
  }
  if (existente && (await perfilDe(existente.id))) return res.status(409).json({ message: "Esta conta já está ligada a uma barbearia." });
  if (!(await reservarConvite(c))) return res.status(409).json({ message: "Este convite acabou de ser usado. Entre com o seu e-mail e a sua senha.", temConta: true });

  let userId = null;
  let criada = false;
  try {
    const dados = { password: senha, email_confirm: true, user_metadata: { full_name: nome } };
    if (existente) {
      // Cadastro antigo que nunca foi confirmado (o e-mail não chegou): conclui com a senha nova
      await authAdmin(`users/${existente.id}`, { metodo: "PUT", corpo: dados });
      userId = existente.id;
    } else {
      const novo = await authAdmin("users", { corpo: { email: c.email, ...dados } });
      userId = novo.id;
      criada = true;
    }
    await ligarConta(c, userId, nome);
  } catch (e) {
    await liberarConvite(c);
    if (criada && userId) await authAdmin(`users/${userId}`, { metodo: "DELETE" }).catch(() => {});
    if (/password/i.test(String(e && e.message))) return res.status(400).json({ message: "Essa senha não foi aceita. Use pelo menos 8 caracteres, misturando letras e números." });
    throw e;
  }
  const bb = await barbeariaDe(c.barbearia_id);
  return res.status(201).json({ barbearia: bb && bb.nome, email: c.email });
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      const c = await conviteValido(texto(req.query.token, 64));
      if (!c) return res.status(404).json({ message: "Convite inválido ou vencido." });
      const [b, conta] = await Promise.all([barbeariaDe(c.barbearia_id), contaDoEmail(c.email).catch(() => null)]);
      return res.status(200).json({ barbearia: b && b.nome, email: c.email, papel: c.papel === "dono" ? "dono" : "barbeiro", temConta: !!(conta && conta.confirmado) });
    }

    if (req.method !== "POST") return res.status(405).json({ message: "Método não permitido." });
    const b = corpoDe(req);
    const u = await usuarioDaRequisicao(req);
    if (!u && b.senha !== undefined) return await criarContaPeloConvite(req, res, b);
    if (!u) return res.status(401).json({ message: "Entre com o e-mail convidado para aceitar." });
    if (await perfilDe(u.id)) return res.status(409).json({ message: "Sua conta já está ligada a uma barbearia." });

    const c = await conviteValido(texto(b.token, 64));
    if (!c) return res.status(404).json({ message: "Convite inválido ou vencido." });
    if (String(c.email).toLowerCase() !== String(u.email).toLowerCase()) return res.status(403).json({ message: `Este convite é para ${c.email}. Entre com essa conta.` });

    const nome = texto(u.metadata.full_name || u.metadata.name || u.email.split("@")[0], 80);
    if (!(await reservarConvite(c))) return res.status(409).json({ message: "Este convite já foi usado." });
    try {
      await ligarConta(c, u.id, nome);
    } catch (e) {
      await liberarConvite(c);
      throw e;
    }
    const bb = await barbeariaDe(c.barbearia_id);
    return res.status(201).json({ barbearia: bb && bb.nome });
  } catch (e) {
    return falha(res, e, `${req.method} /api/convite`);
  }
};
