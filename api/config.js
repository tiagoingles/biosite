// Dados públicos que o navegador precisa para falar com o Supabase (a chave anon é pública por desenho).
// Variáveis na Vercel: SUPABASE_URL e SUPABASE_ANON_KEY.
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const anon = process.env.SUPABASE_ANON_KEY || "";
  if (!url || !anon) return res.status(500).json({ message: "Login não configurado (faltam SUPABASE_URL ou SUPABASE_ANON_KEY na Vercel)." });
  // Chave pública do Web Push (não é segredo): o navegador precisa dela para assinar os avisos
  return res.status(200).json({ url, anon, vapidPublic: process.env.VAPID_PUBLIC_KEY || "" });
};
