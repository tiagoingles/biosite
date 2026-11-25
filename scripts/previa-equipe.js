// Rotas de /api/equipe da prévia local (scripts/previa.js): assinatura, financeiro, clube, clientes, equipe,
// produtos, prótese, caixa e o resto do que os painéis pedem, respondendo com os dados fictícios.
const CL = require("../lib/clientes");
const AUTO = require("../lib/automacoes");
const D = require("./previa-dados");
const { PORTA, hoje, somaDias, caixaMovPrev, esperaPrev, pedidos, clubePlanos, clubeAssinantes, clubePrevia, campanhasPrev, visitasDe, clientesPrevia, soNumeros, convitesPrev, automacoesPrev, premiumPrevia, maisUmMesPrevia, valorPrevia, financeiroPrevia, produtosPrev, vendasPrev, protesePrev, semana } = D;

// Sempre responde (a última linha responde { ok: true }): quem chama só repassa o retorno.
async function rotaEquipe({ res, q, metodo, b, json }) {
      // Assinatura do Bio Site (Stripe): oferta de lançamento; contratar simula o retorno do Stripe
      if (q.area === "assinatura") {
        if (metodo === "POST" && b.acao === "checkout") { D.assinaturaPrevia = { status: "em_teste", plano: "lancamento", valor_mensal: 39.9, implantacao_paga_em: new Date().toISOString(), primeira_cobranca_em: new Date(Date.now() + 60 * 864e5).toISOString(), proxima_cobranca_em: new Date(Date.now() + 60 * 864e5).toISOString(), cancelar_no_fim: false, stripe_customer_id: "cus_previa" }; return json(res, 200, { url: "/painel-dono.html?assinatura=ok#mais" }); }
        if (metodo === "POST") return json(res, 200, { url: "/painel-dono.html#mais" });
        return json(res, 200, { configurado: true, assinatura: D.assinaturaPrevia, oferta: { promocao: true, vagasRestantes: 7, mensal: 39.9, normal: 89.9, implantacao: 120, diasAtePrimeiraCobranca: 60 } });
      }
      if (q.area === "clientes") {
        // Busca do encaixe (lib/clientes.js buscar): nome ou final do telefone
        if (metodo === "GET" && q.busca !== undefined) {
          const t = String(q.busca).trim().toLowerCase(), dig = t.replace(/[^0-9]/g, "");
          const achados = D.clientesPrev.filter((c) => (dig.length >= 3 && dig.length === t.replace(/[^0-9a-z]/g, "").length ? String(c.telefone || "").endsWith(dig) : c.nome.toLowerCase().includes(t))).slice(0, 8);
          return json(res, 200, { clientes: achados.map((c) => ({ id: c.id, nome: c.nome, final: String(c.telefone || "").slice(-4) })) });
        }
        if (metodo === "GET" && q.id) {
          const c = D.clientesPrev.find((x) => x.id === q.id);
          if (!c) return json(res, 404, { message: "Cliente não encontrado." });
          const dono = D.papel !== "barbeiro";
          return json(res, 200, {
            cliente: {
              id: c.id, nome: c.nome, telefone: c.telefone || "", nascimento: dono ? c.nascimento : null, aniversario: c.nascimento ? c.nascimento.slice(8, 10) + "/" + c.nascimento.slice(5, 7) : "", observacao: c.observacao, cpf: dono ? c.cpf || "" : "", cpfMascarado: dono ? CL.mascararCpf(c.cpf) : "",
              origem: c.origem, profissional_id: c.profissional_id, ultima_visita_externa: c.ultima_visita_externa || null, aceita: !!c.aceita && !c.saiu,
              aceite_em: c.aceita ? somaDias(hoje, -30) + "T12:00:00Z" : null, aceite_origem: c.aceita ? c.origem : null, saiu_em: c.saiu ? somaDias(hoje, -10) + "T12:00:00Z" : null, criado_em: somaDias(hoje, -100) + "T12:00:00Z",
              // Gustavo veio de uma migração do Booksy, com o histórico de lá (fase 28)
              veioDe: c.id === "c11" ? "booksy" : null,
            },
            visitas: visitasDe(c.id).map(({ id, dia, horario, servico, profissional, status, valor }) => ({ id, dia, horario, servico, profissional, status, valor })),
            campanhas: c.id === "c2" ? [{ nome: campanhasPrev[campanhasPrev.length - 1].nome, enviado_em: campanhasPrev[campanhasPrev.length - 1].criado_em }] : [],
            anteriores: c.id === "c11" ? [
              { dia: somaDias(hoje, -70), horario: "10:00", servico: "Corte de cabelo degradê", profissional: "Bruno", status: "realizado", origem: "booksy" },
              { dia: somaDias(hoje, -110), horario: "15:30", servico: "Barba + Cabelo", profissional: "Bruno", status: "realizado", origem: "booksy" },
              { dia: somaDias(hoje, -150), horario: "11:00", servico: "Corte de cabelo degradê", profissional: "", status: "faltou", origem: "booksy" },
              { dia: "2023-08-12", horario: "09:30", servico: "Corte americano", profissional: "Rafael", status: "realizado", origem: "booksy" },
            ] : [],
          });
        }
        if (metodo === "GET" && q.campanhas === "1") return json(res, 200, { campanhas: campanhasPrev });
        if (metodo === "GET" && q.premium === "1") return json(res, D.papel === "barbeiro" ? 403 : 200, D.papel === "barbeiro" ? { message: "Só o dono cuida do WhatsApp automático." } : premiumPrevia());
        if (b.acao === "automacao-salvar") {
          const def = AUTO.AUTOMACOES.find((x) => x.tipo === b.tipo);
          if (!def) return json(res, 400, { message: "Automação desconhecida." });
          if (b.texto !== undefined && (String(b.texto).trim().length < 10 || String(b.texto).length > 700)) return json(res, 400, { message: "A mensagem precisa ter de 10 a 700 caracteres." });
          if (b.config && b.config.avaliacao && !/^https:\/\/\S{6,}$/.test(b.config.avaliacao)) return json(res, 400, { message: "Cole o link de avaliação completo, começando com https://" });
          let a = automacoesPrev.find((x) => x.tipo === b.tipo);
          if (!a) { a = { tipo: b.tipo, ativa: true, texto: def.texto, config: { ...(def.config || {}) } }; automacoesPrev.push(a); }
          if (typeof b.ativa === "boolean") a.ativa = b.ativa;
          if (b.texto !== undefined) a.texto = String(b.texto).trim();
          if (b.config) a.config = { ...a.config, ...b.config };
          return json(res, 200, { ok: true });
        }
        if (metodo === "GET") return json(res, 200, clientesPrevia());
        if (b.acao === "salvar") {
          const zap = soNumeros(b.telefone);
          if (String(b.nome || "").trim().length < 2) return json(res, 400, { message: "Informe o nome do cliente." });
          if (zap && D.clientesPrev.some((x) => x.telefone === zap && x.id !== b.id)) return json(res, 409, { message: "Já existe um cliente com este WhatsApp." });
          const nasc = CL.lerData(b.nascimento, { semAno: true });
          if (nasc === null) return json(res, 400, { message: "Data de nascimento inválida. Use dia/mês/ano." });
          if (b.cpf && !CL.cpfValido(b.cpf)) return json(res, 400, { message: "CPF inválido. Confira os números ou deixe em branco." });
          const dadosC = { nome: String(b.nome).trim(), telefone: zap || null, nascimento: nasc || null, observacao: b.observacao || "" };
          if (D.papel !== "barbeiro") Object.assign(dadosC, { cpf: b.cpf ? soNumeros(b.cpf) : null, aceita: b.aceita === true, profissional_id: b.profissional_id || null });
          if (b.id) { Object.assign(D.clientesPrev.find((x) => x.id === b.id) || {}, dadosC); return json(res, 200, { cliente: { id: b.id } }); }
          const novo = { id: "cn" + D.seq++, origem: "painel", profissional_id: D.papel === "barbeiro" ? "b1" : null, ...dadosC };
          D.clientesPrev.push(novo);
          if (b.pedidoId) { const pd = pedidos.find((x) => x.id === b.pedidoId); if (pd) { pd.cliente_id = novo.id; pd.clientes = { nome: novo.nome, telefone: novo.telefone }; } }
          return json(res, 201, { cliente: { id: novo.id } });
        }
        if (b.acao === "apagar") { D.clientesPrev = D.clientesPrev.filter((x) => x.id !== b.id); return json(res, 200, { ok: true }); }
        if (b.acao === "vincular") {
          const pd = pedidos.find((x) => x.id === b.pedidoId), c = D.clientesPrev.find((x) => x.id === b.clienteId);
          if (!pd || !c) return json(res, 404, { message: "Atendimento não encontrado." });
          pd.cliente_id = c.id;
          pd.clientes = { nome: c.nome, telefone: c.telefone };
          return json(res, 200, { ok: true });
        }
        if (b.acao === "convite") {
          const token = "previa" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
          const zap = soNumeros(b.telefone);
          convitesPrev[token] = { nome: b.nome || "", telefone: zap, pedidoId: b.pedidoId || null };
          return json(res, 201, { token, link: "http://localhost:" + PORTA + "/cadastro?c=" + token, expiraEm: new Date(Date.now() + 3 * 864e5).toISOString(), telefone: zap });
        }
        if (b.acao === "importar") {
          const ignorados = [], novos = [];
          (b.linhas || []).forEach((r, i) => {
            const l = CL.lerLinha(r || {});
            if (l.motivo) return ignorados.push({ linha: i + 1, nome: (r && r.nome) || "", motivo: l.motivo });
            if (l.linha.telefone && D.clientesPrev.some((x) => x.telefone === l.linha.telefone)) return ignorados.push({ linha: i + 1, nome: l.linha.nome, motivo: "já cadastrado" });
            novos.push(l.linha);
          });
          if (!b.simular) novos.forEach((x) => D.clientesPrev.push({ id: "cn" + D.seq++, origem: "importacao", aceita: b.aceitaram === true, profissional_id: null, ...x }));
          return json(res, 200, { simulado: !!b.simular, inseridos: novos.length, atualizados: 0, ignorados, totalIgnorados: ignorados.length });
        }
        if (b.acao === "aviso") {
          if (D.papel === "barbeiro") return json(res, 403, { message: "Só o dono pode fazer isso." });
          if (String(b.mensagem || "").trim().length < 3) return json(res, 400, { message: "Escreva a mensagem do aviso." });
          const n = b.clienteId ? 1 : b.segmento === "todos" ? 6 : 2;
          return json(res, 200, { aparelhos: n, entregues: n });
        }
        if (b.acao === "campanha-criar") {
          const c = { id: "cp" + D.seq++, nome: b.nome, segmento: b.segmento, mensagem: b.mensagem, criado_em: new Date().toISOString(), enviados: 0, voltaram: 0, faturou: 0 };
          campanhasPrev.unshift(c);
          return json(res, 201, { campanha: { id: c.id } });
        }
        if (b.acao === "campanha-envio") { const c = campanhasPrev.find((x) => x.id === b.campanhaId); if (c) c.enviados++; return json(res, 200, { ok: true }); }
        return json(res, 400, { message: "Ação desconhecida." });
      }
      if (q.area === "clube") {
        if (metodo === "GET") return json(res, 200, clubePrevia());
        if (b.acao === "plano-salvar") {
          if (!b.nome || String(b.nome).trim().length < 2) return json(res, 400, { message: "Dê um nome ao plano." });
          const corpo = { nome: b.nome, descricao: b.descricao || "", preco: Number(String(b.preco).replace(",", ".")), servicos: b.servicos, intervalo_dias: Number(b.intervalo_dias), dias_semana: b.dias_semana, hora_limite: b.hora_limite || null, comissao_valor: Number(String(b.comissao_valor || 0).replace(",", ".")) };
          const pl = clubePlanos.find((x) => x.id === b.id);
          if (pl) Object.assign(pl, corpo); else clubePlanos.push({ id: "pl" + D.seq++, ativo: true, ...corpo });
          return json(res, pl ? 200 : 201, { plano: corpo });
        }
        if (b.acao === "plano-ativo") { const pl = clubePlanos.find((x) => x.id === b.id); if (pl) pl.ativo = b.ativo === true; return json(res, 200, { ok: true }); }
        if (b.acao === "assinante-salvar") {
          const zap = String(b.whatsapp || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
          if (zap.length < 10) return json(res, 400, { message: "Informe o WhatsApp do assinante com DDD." });
          if (clubeAssinantes.some((x) => x.whatsapp === zap && x.id !== b.id)) return json(res, 409, { message: "Já existe um assinante com este WhatsApp." });
          const corpo = { nome: b.nome, whatsapp: zap, plano_id: b.plano_id, pago_ate: b.pago_ate || null, observacao: b.observacao || "" };
          const a = clubeAssinantes.find((x) => x.id === b.id);
          if (a) { Object.assign(a, corpo); return json(res, 200, { assinante: a }); }
          const novo = { id: "a" + D.seq++, status: "ativo", ...corpo };
          if (b.recebeu === true) {
            const valor = valorPrevia(b.valor, (clubePlanos.find((p) => p.id === b.plano_id) || { preco: 0 }).preco);
            if (!Number.isFinite(valor)) return json(res, 400, { message: "Informe o valor recebido." });
            novo.pago_ate = maisUmMesPrevia(hoje);
            D.clubePagamentos.push({ id: "pg" + D.seq++, ordem: D.seq, assinante_id: novo.id, valor, data: hoje, pago_ate_antes: null, pago_ate_depois: novo.pago_ate });
          }
          clubeAssinantes.push(novo);
          return json(res, 201, { assinante: novo });
        }
        if (b.acao === "assinante-pagou") {
          const a = clubeAssinantes.find((x) => x.id === b.id);
          const valor = valorPrevia(b.valor, (clubePlanos.find((p) => p.id === a.plano_id) || { preco: 0 }).preco);
          if (!Number.isFinite(valor)) return json(res, 400, { message: "Informe o valor recebido." });
          const antes = a.pago_ate || null;
          a.pago_ate = maisUmMesPrevia(a.pago_ate && a.pago_ate > hoje ? a.pago_ate : hoje);
          a.status = "ativo";
          const pg = { id: "pg" + D.seq++, ordem: D.seq, assinante_id: a.id, valor, data: hoje, pago_ate_antes: antes, pago_ate_depois: a.pago_ate };
          D.clubePagamentos.push(pg);
          return json(res, 200, { pago_ate: a.pago_ate, pagamento: { id: pg.id, valor, data: hoje } });
        }
        if (b.acao === "assinante-desfazer-pagamento") {
          const a = clubeAssinantes.find((x) => x.id === b.id);
          const meus = D.clubePagamentos.filter((pg) => pg.assinante_id === b.id).sort((x, y) => y.ordem - x.ordem);
          if (!meus.length || meus[0].id !== b.pagamento) return json(res, 409, { message: "Este já não é o último pagamento do assinante. Abra os pagamentos de novo para conferir." });
          const pg = meus[0];
          D.clubePagamentos = D.clubePagamentos.filter((x) => x !== pg);
          const manteve = a.pago_ate !== pg.pago_ate_depois;
          if (!manteve) a.pago_ate = pg.pago_ate_antes;
          return json(res, 200, { pago_ate: a.pago_ate, valor: pg.valor, manteve });
        }
        if (b.acao === "assinante-status") { const a = clubeAssinantes.find((x) => x.id === b.id); a.status = b.status; return json(res, 200, { ok: true }); }
        if (b.acao === "assinante-lembrete") {
          const a = clubeAssinantes.find((x) => x.id === b.id);
          if (!a) return json(res, 404, { message: "Assinante não encontrado." });
          a.lembrete_em = new Date().toISOString();
          a.lembrete_pago_ate = a.pago_ate || null;
          return json(res, 200, { lembrete_em: a.lembrete_em, lembrete_pago_ate: a.lembrete_pago_ate });
        }
        return json(res, 400, { message: "Ação desconhecida." });
      }
      // Lista de espera (lib/espera.js): a mesma conta de quem cabe no horário que vagou
      if (q.area === "espera") {
        const { cabeNaVaga } = require("../lib/espera");
        if (metodo === "POST" && b.acao === "status") { const e = esperaPrev.find((x) => x.id === b.id); if (!e) return json(res, 404, { message: "Registro não encontrado." }); e.status = b.status; if (b.status === "contatado") e.contatado_em = new Date().toISOString(); return json(res, 200, { entrada: e }); }
        if (metodo === "POST" && b.acao === "nova") {
          // Cliente escolhido na busca da carteira: o WhatsApp vem do cadastro; quem já está no dia é atualizado
          const c = b.clienteId ? D.clientesPrev.find((x) => x.id === b.clienteId) : null;
          if (b.clienteId && !c) return json(res, 400, { message: "Cliente não encontrado na carteira." });
          const dadosE = { cliente_id: c ? c.id : null, nome: b.nome || (c && c.nome), telefone: soNumeros(b.telefone) || (c ? soNumeros(c.telefone) : ""), servico: b.servico, duracao_min: Number(b.duracao) || 30, profissional_id: b.profissionalId || null, dia: b.dia, de: b.de, ate: b.ate, observacao: b.observacao || "" };
          const ja = esperaPrev.find((x) => x.dia === b.dia && ["esperando", "contatado"].includes(x.status) && ((dadosE.telefone && x.telefone === dadosE.telefone) || (c && x.cliente_id === c.id)));
          if (ja) { Object.assign(ja, dadosE); return json(res, 200, { entrada: ja, atualizado: true }); }
          const e = { id: "e" + Date.now(), ...dadosE, status: "esperando", contatado_em: null, pelo_site: false, criado_em: new Date().toISOString() };
          esperaPrev.push(e);
          return json(res, 201, { entrada: e });
        }
        const lista = esperaPrev.filter((e) => e.dia >= hoje && ["esperando", "contatado"].includes(e.status)).sort((a, z) => (a.dia + a.criado_em).localeCompare(z.dia + z.criado_em));
        const nome = (id) => ({ b1: "Bruno", b2: "Rafael" })[id] || "";
        // Horário que vagou e ninguém ocupou de novo (mesma regra do servidor)
        const { minutos, sobrepoe } = require("../lib/horarios");
        const fim = (x) => minutos(x.horario.slice(0, 5)) + (x.duracao_min || 30);
        const ocupada = (c) => pedidos.some((a) => ["pendente", "confirmado", "avulso", "realizado"].includes(a.status) && a.profissional_id === c.profissional_id && a.dia === c.dia && sobrepoe(minutos(c.horario.slice(0, 5)), fim(c), minutos(a.horario.slice(0, 5)), fim(a)));
        const vagas = pedidos.filter((p) => p.status === "cancelado" && p.dia >= hoje && !ocupada(p)).map((p) => ({ id: p.id, dia: p.dia, horario: p.horario.slice(0, 5), duracao_min: p.duracao_min || 30, profissional_id: p.profissional_id, profissional: p.profissional, servico: p.servico, fila: lista.filter((e) => cabeNaVaga(e, p)).map((e) => e.id) })).filter((v) => v.fila.length);
        return json(res, 200, { hoje, lista: lista.map((e) => ({ ...e, profissional: e.profissional_id ? nome(e.profissional_id) : "" })), vagas, profissionais: [{ id: "b1", nome: "Bruno" }, { id: "b2", nome: "Rafael" }] });
      }
      if (q.area === "caixa") {
        const { calcularCaixa } = require("../lib/caixa");
        const num = (v) => Number(String(v == null ? "" : v).replace(/[.]/g, "").replace(",", ".")) || 0;
        const doDia = pedidos.filter((p) => p.dia === hoje);
        const equipe = [{ id: "b1", nome: "Bruno" }, { id: "b2", nome: "Rafael" }];
        if (metodo === "POST") {
          if (b.acao === "abrir") D.caixaPrev = { id: "cx1", dia: hoje, troco: num(b.troco), aberto_em: new Date().toISOString(), fechado_em: null, observacao: "" };
          if (b.acao === "movimento") {
            if (b.tipo === "retirada" && !b.categoria) return json(res, 400, { message: "Escolha para que é a retirada." });
            caixaMovPrev.push({ id: "cm" + Date.now(), tipo: b.tipo, valor: num(b.valor), motivo: b.motivo || "", categoria: b.tipo === "retirada" ? b.categoria : null, profissional_id: b.categoria === "vale" ? b.profissionalId : null, criado_em: new Date().toISOString() });
          }
          if (b.acao === "apagar-movimento") { const i = caixaMovPrev.findIndex((m) => m.id === b.id); if (i > -1) caixaMovPrev.splice(i, 1); }
          if (b.acao === "reabrir") D.caixaPrev = { ...D.caixaPrev, fechado_em: null, contado: null, esperado: null, fica_troco: null, resumo: null };
          if (b.acao === "fechar") {
            const c = calcularCaixa(D.caixaPrev, caixaMovPrev, doDia, []);
            const contado = num(b.contado);
            const fica = b.ficaTroco == null || b.ficaTroco === "" ? Math.min(contado, c.troco) : num(b.ficaTroco);
            if (fica > contado) return json(res, 400, { message: "O troco que fica na gaveta não pode ser maior que o dinheiro contado." });
            const resumo = { entradas: c.entradas, total: c.total, troco: c.troco, retiradas: c.retiradas, retiradasPor: c.retiradasPor, reforcos: c.reforcos, recolhido: contado - fica };
            D.caixaPrev = { ...D.caixaPrev, fechado_em: new Date().toISOString(), contado, esperado: c.esperado, fica_troco: fica, resumo, observacao: b.observacao || "" };
            return json(res, 200, { esperado: c.esperado, contado, diferenca: Math.round((contado - c.esperado) * 100) / 100, ficaTroco: fica, recolhido: contado - fica });
          }
          return json(res, 200, { ok: true });
        }
        // Dois fechamentos de exemplo: ontem bateu; anteontem faltaram R$ 5 (pagou R$ 35 de produto de limpeza pela gaveta)
        const passados = [
          { dia: somaDias(hoje, -1), troco: 100, contado: 230, esperado: 230, fica: 100, entradas: { dinheiro: 130, pix: 180, debito: 60, credito: 40, sem: 0 }, por: { despesa: 0, vale: 0, dono: 0, guardar: 0 } },
          { dia: somaDias(hoje, -2), troco: 100, contado: 180, esperado: 185, fica: 100, entradas: { dinheiro: 120, pix: 150, debito: 50, credito: 45, sem: 0 }, por: { despesa: 35, vale: 0, dono: 0, guardar: 0 } },
        ];
        const historico = passados.map((x) => ({ dia: x.dia, contado: x.contado, esperado: x.esperado, diferenca: x.contado - x.esperado, ficaTroco: x.fica, total: x.entradas.dinheiro + x.entradas.pix + x.entradas.debito + x.entradas.credito }));
        const comuns = { hoje, trocoSugerido: 100, profissionais: equipe, historico, abertoAntes: null };
        const antigo = q.dia && q.dia !== hoje ? passados.find((x) => x.dia === q.dia) : null;
        if (q.dia && q.dia !== hoje) {
          const caixa = antigo ? { id: "cx-" + antigo.dia, dia: antigo.dia, troco: antigo.troco, aberto_em: antigo.dia + "T11:05:00Z", fechado_em: antigo.dia + "T22:40:00Z", contado: antigo.contado, esperado: antigo.esperado, fica_troco: antigo.fica, observacao: antigo.por.despesa ? "Faltou o troco de um cliente." : "", resumo: { entradas: antigo.entradas, total: historico.find((x) => x.dia === antigo.dia).total, troco: antigo.troco, retiradas: antigo.por.despesa, retiradasPor: antigo.por, reforcos: 0, recolhido: antigo.contado - antigo.fica } } : null;
          const movimentos = antigo && antigo.por.despesa ? [{ id: "cm-a", tipo: "retirada", valor: 35, motivo: "Produto de limpeza", categoria: "despesa", profissional: null, criado_em: antigo.dia + "T17:12:00Z" }] : [];
          return json(res, 200, { ...comuns, dia: q.dia, caixa, movimentos, ...calcularCaixa(caixa, movimentos, [], []), entradas: antigo ? antigo.entradas : calcularCaixa(null, [], [], []).entradas, pendentes: 0 });
        }
        const c = calcularCaixa(D.caixaPrev, caixaMovPrev, doDia, []);
        const movimentos = caixaMovPrev.map((m) => ({ ...m, profissional: m.profissional_id ? (equipe.find((p) => p.id === m.profissional_id) || {}).nome || "Barbeiro" : null }));
        return json(res, 200, { ...comuns, dia: hoje, caixa: D.caixaPrev, movimentos, ...c, pendentes: doDia.filter((p) => p.status === "confirmado" || p.status === "avulso").length });
      }
      if (q.area === "financeiro") {
        if (metodo === "GET") return json(res, 200, { ...financeiroPrevia(), plataforma: false });
        return json(res, 200, { ok: true });
      }
      // Prótese capilar (lib/protese.js): fichas em memória da prévia
      if (q.area === "protese") {
        const { situacao } = require("../lib/protese");
        const listaP = () => {
          const fichas = protesePrev.filter((f) => f.ativo).map((f) => ({ ...f, profissional: f.profissional_id === "b1" ? "Bruno Oliveira" : f.profissional_id === "b2" ? "Rafael Souza" : "", ...situacao(f, hoje) }));
          const ordem = { atrasada: 0, vence: 1, em_dia: 2, sem_data: 3 };
          fichas.sort((a, b) => ordem[a.status] - ordem[b.status]);
          return { ativa: true, fichas, equipe: [{ id: "b1", nome: "Bruno Oliveira" }, { id: "b2", nome: "Rafael Souza" }], resumo: { total: fichas.length, atrasadas: fichas.filter((f) => f.status === "atrasada").length, vencem: fichas.filter((f) => f.status === "vence").length, semana: fichas.filter((f) => f.dias != null && f.dias >= 0 && f.dias <= 7).length } };
        };
        if (metodo === "GET") return json(res, 200, listaP());
        if (b.acao === "aba") return json(res, 200, { ativa: b.ativa });
        if (b.acao === "criar") { protesePrev.push({ id: "pf" + D.seq++, nome: b.nome, telefone: String(b.telefone || "").replace(/[^0-9]/g, ""), profissional_id: b.profissionalId, modelo: b.modelo || "", aplicada_em: b.aplicadaEm, intervalo_dias: b.intervaloDias || 21, ultima_manutencao: b.aplicadaEm, lembrete_em: null, observacao: b.observacao || "", ativo: true }); return json(res, 201, { ok: true }); }
        const f = protesePrev.find((x) => x.id === b.id);
        if (!f) return json(res, 404, { message: "Ficha não encontrada." });
        if (b.acao === "manutencao") { f.ultima_manutencao = b.dia; return json(res, 201, { proxima: somaDias(b.dia, f.intervalo_dias) }); }
        if (b.acao === "lembrar") { f.lembrete_em = new Date().toISOString(); return json(res, 200, { ok: true }); }
        if (b.acao === "historico") return json(res, 200, { manutencoes: [{ dia: f.ultima_manutencao || hoje, tipo: "manutencao", observacao: "" }] });
        if (b.acao === "desativar") { f.ativo = false; return json(res, 200, { ok: true }); }
        if (b.acao === "editar") { Object.assign(f, { nome: b.nome, modelo: b.modelo, intervalo_dias: b.intervaloDias }); return json(res, 200, { ok: true }); }
        return json(res, 400, { message: "Ação desconhecida." });
      }
      // Produtos e estoque (lib/produtos.js): estado em memória da prévia
      if (q.area === "produtos") {
        const baixo = (p) => p.ativo && p.estoque <= Math.max(0, p.minimo);
        const lista = () => ({
          dono: D.papel !== "barbeiro",
          produtos: produtosPrev.map((p) => ({ ...p, baixo: baixo(p), ...(D.papel === "barbeiro" ? { custo: undefined, lucro: undefined } : { lucro: p.custo == null ? null : Math.round((p.preco - p.custo) * 100) / 100 }) })),
          baixos: produtosPrev.filter(baixo).map((p) => ({ id: p.id, nome: p.nome, estoque: p.estoque })),
          hoje: { unidades: vendasPrev.length, bruto: vendasPrev.reduce((t, v) => t + v, 0) },
        });
        if (metodo === "GET") return json(res, 200, lista());
        const p = produtosPrev.find((x) => x.id === b.id);
        if (b.acao === "criar") { produtosPrev.push({ id: "pr" + D.seq++, nome: b.nome, custo: Number(String(b.custo).replace(",", ".")) || null, preco: Number(String(b.preco).replace(",", ".")) || 0, estoque: Number(b.estoque) || 0, minimo: Number(b.minimo) || 0, foto: "", ativo: true }); return json(res, 201, { ok: true }); }
        if (!p) return json(res, 404, { message: "Produto não encontrado." });
        if (b.acao === "estoque") { p.estoque += Number(b.quantidade) || 0; return json(res, 200, { estoque: p.estoque, baixo: baixo(p) }); }
        if (b.acao === "vender") { const n = Number(b.quantidade) || 1; p.estoque -= n; for (let i = 0; i < n; i++) vendasPrev.push(p.preco); return json(res, 201, { estoque: p.estoque, baixo: baixo(p) }); }
        if (b.acao === "editar") { if (b.ativo !== undefined) p.ativo = b.ativo; if (b.preco !== undefined) p.preco = Number(String(b.preco).replace(",", ".")); if (b.custo !== undefined) p.custo = Number(String(b.custo).replace(",", ".")) || null; if (b.minimo !== undefined) p.minimo = Number(b.minimo); return json(res, 200, { ok: true }); }
        return json(res, 400, { message: "Ação desconhecida." });
      }
      if (q.agenda === "1") return json(res, 200, { profissional: { id: q.profissionalId, nome: "Rafael", temLogin: false }, ...semana(q.de || hoje, q.dias) });
      if (b.acao === "agenda-semana-salvar") return json(res, 200, semana(b.dias[0].dia, b.dias.length));
      if (metodo === "GET") return json(res, 200, { profissionais: D.equipeGestao, convites: D.convites });
      if (b.acao === "convidar") {
        // Com profissionalId: convite pela ficha de quem está na equipe sem login (fase 27)
        const ficha = b.profissionalId ? D.equipeGestao.find((p) => p.id === b.profissionalId) : null;
        const token = "tok" + D.seq++;
        D.convites.unshift({ id: "cn" + D.seq++, email: b.email, expira_em: new Date(Date.now() + 7 * 864e5).toISOString(), profissionalId: ficha ? ficha.id : null, link: "http://localhost:" + PORTA + "/entrar.html?convite=" + token });
        return json(res, 201, { link: D.convites[0].link, ficha: ficha ? ficha.nome : null });
      }
      if (b.acao === "cancelar-convite") { D.convites = D.convites.filter((c) => c.id !== b.id); return json(res, 200, { ok: true }); }
      if (b.acao === "remover") { D.equipeGestao = D.equipeGestao.filter((p) => p.id !== b.profissionalId); return json(res, 200, { ok: true }); }
      if (b.acao === "foto-remover") { const p = D.equipeGestao.find((x) => x.id === b.profissionalId); if (p) p.foto_url = null; return json(res, 200, { ok: true }); }
      return json(res, 200, { ok: true });
}

module.exports = { rotaEquipe };
