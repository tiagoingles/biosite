// Convite de barbeiro. GET mostra o nome da barbearia. POST aceita o convite com a conta logada.
const { rest } = require("../lib/supabase");
const { usuarioDaRequisicao, perfilDe, barbeariaDe } = require("../lib/conta");
const { texto } = require("../lib/agenda");

const TOKEN = /^[0-9a-f]{48}$/;

async function conviteValido(token) {
  if (!TOKEN.test(token)) return null;
  const linhas = await rest(`convites?token=eq.${token}&aceito_em=is.null&select=id,barbearia_id,email,expira_em`);
  const c = linhas[0];
  if (!c || new Date(c.expira_em) < new Date()) return null;
  return c;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      const c = await conviteValido(texto(req.query.token, 64));
      if (!c) return res.status(404).json({ message: "Convite inválido ou vencido." });
      const b = await barbeariaDe(c.barbearia_id);
      return res.status(200).json({ barbearia: b && b.nome, email: c.email });
    }

    if (req.method !== "POST") return res.status(405).json({ message: "Método não permitido." });
    const u = await usuarioDaRequisicao(req);
    if (!u) return res.status(401).json({ message: "Entre com o e-mail convidado para aceitar." });
    if (await perfilDe(u.id)) return res.status(409).json({ message: "Sua conta já está ligada a uma barbearia." });

    const token = texto((req.body || {}).token, 64);
    const c = await conviteValido(token);
    if (!c) return res.status(404).json({ message: "Convite inválido ou vencido." });
    if (c.email !== u.email) return res.status(403).json({ message: `Este convite é para ${c.email}. Entre com essa conta.` });

    const nome = texto(u.metadata.full_name || u.metadata.name || u.email.split("@")[0], 80);
    await rest("perfis", { metodo: "POST", prefer: "return=minimal", corpo: { user_id: u.id, barbearia_id: c.barbearia_id, papel: "barbeiro", nome } });
    await rest("profissionais", { metodo: "POST", prefer: "return=minimal", corpo: { barbearia_id: c.barbearia_id, perfil_user_id: u.id, nome } });
    await rest(`convites?id=eq.${c.id}`, { metodo: "PATCH", prefer: "return=minimal", corpo: { aceito_em: new Date().toISOString() } });
    const b = await barbeariaDe(c.barbearia_id);
    return res.status(201).json({ barbearia: b && b.nome });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};
