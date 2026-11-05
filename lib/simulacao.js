// Simulação de 30 dias de funcionamento, para apresentação. Só a conta da plataforma usa.
// Tudo o que é criado aqui vai com simulado = true. Zerar apaga só essas linhas; os dados reais não são tocados.
// A simulação não roda se a barbearia já tiver uma simulação (zere antes).
const { rest } = require("./supabase");
const { codigoNovo } = require("./agenda");

// Nomes fictícios
const NOMES = ["Lucas", "Bruno", "Rafael", "Thiago", "Gabriel", "Felipe", "Rodrigo", "Diego", "Caio", "Vinicius", "Matheus", "André", "Eduardo", "Leandro", "Gustavo", "Renato", "Marcelo", "Fábio", "Danilo", "Henrique", "Igor", "Otávio", "Nicolas", "Ricardo", "Samuel", "Paulo", "Wesley", "Daniel"];
const SOBRENOMES = ["Silva", "Souza", "Oliveira", "Santos", "Pereira", "Lima", "Costa", "Ribeiro", "Almeida", "Nascimento", "Carvalho", "Rocha", "Dias", "Monteiro", "Barbosa", "Teixeira"];

// Serviço, preço, duração (min)
const SERVICOS = [
  ["Corte social", 45, 30],
  ["Barba", 30, 30],
  ["Corte + barba", 65, 60],
  ["Sobrancelha", 15, 15],
  ["Pigmentação", 70, 40],
];
const DESPESAS = [
  ["Aluguel do ponto", "aluguel", 2500],
  ["Energia e água", "contas", 650],
  ["Internet e telefone", "contas", 150],
  ["Sistema de agendamento", "software", 120],
  ["Contador", "servicos", 400],
];
// Insumo, unidade, estoque mínimo, quantidade por compra, valor por compra (faixa), consumo por dia (faixa)
const INSUMOS = [
  { nome: "Lâmina descartável", unidade: "un", minimo: 10, compra: 20, valor: [60, 110], uso: [1, 2] },
  { nome: "Pomada modeladora", unidade: "un", minimo: 5, compra: 10, valor: [80, 140], uso: [0, 1] },
  { nome: "Óleo para barba", unidade: "ml", minimo: 50, compra: 200, valor: [40, 90], uso: [5, 15] },
  { nome: "Talco", unidade: "g", minimo: 100, compra: 300, valor: [25, 45], uso: [10, 30] },
];
const DIAS = 30;
const ABERTURA = 9 * 60;
const FECHAMENTO = 19 * 60;

const hojeBr = () => new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
const somaDias = (iso, n) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const sorteio = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const escolha = (lista) => lista[Math.floor(Math.random() * lista.length)];
const hm = (min) => String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
const r2 = (n) => Math.round(n * 100) / 100;

async function enviarEmLotes(caminho, linhas) {
  for (let i = 0; i < linhas.length; i += 200) {
    await rest(caminho, { metodo: "POST", prefer: "return=minimal", corpo: linhas.slice(i, i + 200) });
  }
}

async function simularTrintaDias(barbeariaId) {
  const barb = (await rest(`barbearias?id=eq.${barbeariaId}&select=slug`))[0];
  if (!barb) return { status: 404, message: "Barbearia não encontrada." };

  const jaTem = await rest(`pedidos?barbearia_id=eq.${barbeariaId}&simulado=eq.true&select=id&limit=1`);
  if (jaTem.length) return { status: 409, message: "Esta barbearia já tem uma simulação. Zere antes de simular de novo." };

  const equipe = await rest(`profissionais?barbearia_id=eq.${barbeariaId}&ativo=eq.true&select=id,nome,comissao_pct&order=criado_em.asc`);
  if (!equipe.length) return { status: 400, message: "Cadastre pelo menos um barbeiro antes de simular." };

  // Preços: se a barbearia ainda não tem nenhum, usa os de exemplo (marcados como simulados)
  let precos = await rest(`servicos_precos?barbearia_id=eq.${barbeariaId}&select=nome,preco`);
  if (!precos.length) {
    await enviarEmLotes(
      "servicos_precos",
      SERVICOS.map(([nome, preco]) => ({ barbearia_id: barbeariaId, nome, preco, simulado: true }))
    );
    precos = await rest(`servicos_precos?barbearia_id=eq.${barbeariaId}&select=nome,preco`);
  }
  const duracaoDe = Object.fromEntries(SERVICOS.map(([nome, , dur]) => [nome, dur]));
  const catalogo = precos.map((p) => ({ nome: p.nome, preco: Number(p.preco), dur: duracaoDe[p.nome] || 30 }));

  // Gastos fixos de exemplo
  await enviarEmLotes(
    "despesas",
    DESPESAS.map(([descricao, categoria, valor]) => ({ barbearia_id: barbeariaId, descricao, categoria, valor, simulado: true }))
  );

  // Insumos de exemplo (não recria o que já existe com o mesmo nome)
  const existentes = (await rest(`insumos?barbearia_id=eq.${barbeariaId}&select=nome`)).map((i) => i.nome);
  const novos = INSUMOS.filter((i) => !existentes.includes(i.nome));
  await enviarEmLotes(
    "insumos",
    novos.map((i) => ({ barbearia_id: barbeariaId, nome: i.nome, unidade: i.unidade, estoque_minimo: i.minimo, simulado: true }))
  );
  const insumosBanco = await rest(`insumos?barbearia_id=eq.${barbeariaId}&select=id,nome`);
  const movimentos = [];
  const hoje = hojeBr();
  const inicio = somaDias(hoje, -(DIAS - 1));
  for (const cfg of INSUMOS) {
    const row = insumosBanco.find((i) => i.nome === cfg.nome);
    if (!row || existentes.includes(cfg.nome)) continue; // insumo real com o mesmo nome: não mexe
    for (let k = 0; k < DIAS; k++) {
      const data = somaDias(inicio, k);
      if (k % 6 === 0) {
        movimentos.push({ barbearia_id: barbeariaId, insumo_id: row.id, tipo: "entrada", quantidade: cfg.compra, valor_total: r2(sorteio(cfg.valor[0], cfg.valor[1])), data, motivo: "Compra", simulado: true });
      }
      // Saída precisa ser maior que zero (regra do banco); dia sem uso não gera movimento
      const uso = sorteio(cfg.uso[0], cfg.uso[1]);
      if (new Date(data + "T12:00:00Z").getUTCDay() !== 0 && uso > 0) {
        movimentos.push({ barbearia_id: barbeariaId, insumo_id: row.id, tipo: "saida", quantidade: uso, valor_total: null, data, motivo: "Uso no atendimento", simulado: true });
      }
    }
  }
  await enviarEmLotes("insumo_movimentos", movimentos);

  // Atendimentos: de segunda a sábado, nos 30 dias, para cada barbeiro
  const codigos = new Set((await rest(`pedidos?slug=eq.${barb.slug}&select=codigo`)).map((p) => p.codigo));
  const pedidos = [];
  for (let k = 0; k < DIAS; k++) {
    const dia = somaDias(inicio, k);
    if (new Date(dia + "T12:00:00Z").getUTCDay() === 0) continue;
    for (const p of equipe) {
      let minuto = ABERTURA + sorteio(0, 30);
      while (minuto + 15 <= FECHAMENTO) {
        const s = escolha(catalogo);
        if (minuto + s.dur > FECHAMENTO) break;
        const naoRealizado = Math.random() < 0.07;
        let codigo;
        do codigo = codigoNovo(); while (codigos.has(codigo));
        codigos.add(codigo);
        pedidos.push({
          barbearia_id: barbeariaId,
          slug: barb.slug,
          codigo,
          profissional_id: p.id,
          profissional: p.nome,
          servico: s.nome,
          dia,
          horario: hm(minuto),
          horario_fim: hm(minuto + s.dur),
          duracao_min: s.dur,
          cliente: `${escolha(NOMES)} ${escolha(SOBRENOMES)}`,
          observacao: "",
          status: naoRealizado ? "nao_realizado" : "realizado",
          motivo: naoRealizado ? escolha(["reagendado", "cliente_nao_apareceu"]) : null,
          valor: naoRealizado ? null : s.preco,
          comissao_pct: Number(p.comissao_pct),
          simulado: true,
        });
        minuto += s.dur + sorteio(0, 40);
      }
    }
  }
  await enviarEmLotes("pedidos", pedidos);

  return {
    status: 201,
    ok: true,
    pedidos: pedidos.length,
    realizados: pedidos.filter((x) => x.status === "realizado").length,
    despesas: DESPESAS.length,
    insumos: novos.length,
    movimentos: movimentos.length,
    precos: catalogo.length,
  };
}

// Apaga só o que a simulação criou, na ordem que respeita as ligações entre as tabelas
async function zerarSimulacao(barbeariaId) {
  const base = `barbearia_id=eq.${barbeariaId}&simulado=eq.true`;
  await rest(`insumo_movimentos?${base}`, { metodo: "DELETE", prefer: "return=minimal" });
  await rest(`insumos?${base}`, { metodo: "DELETE", prefer: "return=minimal" });
  await rest(`despesas?${base}`, { metodo: "DELETE", prefer: "return=minimal" });
  await rest(`servicos_precos?${base}`, { metodo: "DELETE", prefer: "return=minimal" });
  await rest(`pedidos?${base}`, { metodo: "DELETE", prefer: "return=minimal" });
  return { ok: true };
}

module.exports = { simularTrintaDias, zerarSimulacao, r2 };
