// Cria a barbearia do dono logado (primeiro acesso).
// Se o dono também atende, já cria o perfil "dono_barbeiro" e o profissional.
const { rest } = require("../lib/supabase");
const { usuarioDaRequisicao, perfilDe } = require("../lib/conta");
const { texto } = require("../lib/agenda");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ message: "Método não permitido." });

  let barbeariaId = null;
  try {
    const u = await usuarioDaRequisicao(req);
    if (!u) return res.status(401).json({ message: "Entre na sua conta para continuar." });
    if (await perfilDe(u.id)) return res.status(409).json({ message: "Sua conta já está ligada a uma barbearia." });

    const b = req.body || {};
    const nome = texto(b.nome, 80);
    const slug = texto(b.slug, 40).toLowerCase();
    const virarBarbeiro = b.virarBarbeiro === true;
    if (!nome) return res.status(400).json({ message: "Informe o nome da barbearia." });
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) return res.status(400).json({ message: "Endereço inválido: use de 3 a 40 letras minúsculas, números ou hífen." });

    const ja = await rest(`barbearias?slug=eq.${slug}&select=id`);
    if (ja.length) return res.status(409).json({ message: "Este endereço já está em uso. Escolha outro." });

    const criada = await rest("barbearias", { metodo: "POST", prefer: "return=representation", corpo: { nome, slug } });
    barbeariaId = criada[0].id;
    const papel = virarBarbeiro ? "dono_barbeiro" : "dono";
    const nomeDono = texto(u.metadata.full_name || u.metadata.name || u.email.split("@")[0], 80);
    await rest("perfis", { metodo: "POST", prefer: "return=minimal", corpo: { user_id: u.id, barbearia_id: barbeariaId, papel, nome: nomeDono } });
    if (virarBarbeiro) {
      await rest("profissionais", { metodo: "POST", prefer: "return=minimal", corpo: { barbearia_id: barbeariaId, perfil_user_id: u.id, nome: nomeDono } });
    }
    return res.status(201).json({ barbearia: criada[0], papel });
  } catch (e) {
    // Se a criação parou no meio, desfaz a barbearia para não deixar lixo
    if (barbeariaId) await rest(`barbearias?id=eq.${barbeariaId}`, { metodo: "DELETE", prefer: "return=minimal" }).catch(() => {});
    return res.status(500).json({ message: e.message });
  }
};
