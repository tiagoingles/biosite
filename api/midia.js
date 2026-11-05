// Gera o link para o Criador enviar a foto ou o vídeo de um serviço direto ao Supabase Storage.
// Só quem sabe a senha do Criador (CRIADOR_SENHA) consegue pedir o link. Até 10 erros de senha
// por origem em 15 minutos. O bucket só aceita os tipos abaixo, até 25 MB.
const crypto = require("crypto");
const { linkDeEnvio, cfg } = require("../lib/supabase");
const { texto } = require("../lib/agenda");
const { segredoIgual, bloqueadoPorTentativas, registrarErroDeSenha, corpoDe, falha } = require("../lib/seguranca");

const MB = 1024 * 1024;
const TIPOS = {
  "video/mp4": { ext: "mp4", tipo: "video", max: 25 },
  "video/webm": { ext: "webm", tipo: "video", max: 25 },
  "video/quicktime": { ext: "mov", tipo: "video", max: 25 },
  "image/jpeg": { ext: "jpg", tipo: "foto", max: 5 },
  "image/png": { ext: "png", tipo: "foto", max: 5 },
  "image/webp": { ext: "webp", tipo: "foto", max: 5 },
};

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ message: "Método não permitido." });
  try {
    if (await bloqueadoPorTentativas(req, "criador")) return res.status(429).json({ message: "Muitas tentativas de senha. Espere 15 minutos." });
    const b = corpoDe(req);
    if (!segredoIgual(b.senha, process.env.CRIADOR_SENHA)) {
      await registrarErroDeSenha(req, "criador");
      return res.status(401).json({ message: "Senha do Criador incorreta." });
    }

    const slug = texto(b.slug, 60);
    const servico = texto(b.servico, 40);
    const tipo = TIPOS[b.tipo];
    const tamanho = Number(b.tamanho) || 0;
    if (!/^[a-z0-9-]{3,40}$/.test(slug) || !/^[\w-]{1,40}$/.test(servico)) return res.status(400).json({ message: "Serviço ou site inválido." });
    if (!tipo) return res.status(400).json({ message: "Use foto (JPG, PNG ou WebP) ou vídeo (MP4, WebM ou MOV)." });
    if (tamanho <= 0 || tamanho > tipo.max * MB) {
      return res.status(400).json({ message: `${tipo.tipo === "video" ? "Vídeo" : "Foto"} maior que ${tipo.max} MB. Comprima antes de enviar.` });
    }

    const caminho = `${slug}/${servico}/${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}.${tipo.ext}`;
    const uploadUrl = await linkDeEnvio("midia", caminho);
    const publicUrl = `${cfg().url}/storage/v1/object/public/midia/${caminho}`;
    return res.status(200).json({ uploadUrl, publicUrl, tipo: tipo.tipo });
  } catch (e) {
    return falha(res, e, "POST /api/midia");
  }
};
