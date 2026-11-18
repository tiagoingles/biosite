// Componentes de agenda usados pelos dois painéis: cartão do pedido com as ações (confirmar,
// recusar, encerrar, remarcar, cancelar, valor, WhatsApp), encaixe (atendimento espontâneo),
// editor da semana (publicar vários dias) e bloqueios pontuais. Usa o painel-comum.js (window.Painel).
(function () {
  "use strict";
  var P = window.Painel;
  var h = P.h;

  // ctx: { barbearia, equipe: [{id,nome}], servicos: [{nome,preco}], dono: bool, recarregar() }
  function cartaoPedido(p, ctx, opcoes) {
    opcoes = opcoes || {};
    var hoje = P.hoje();
    var encerravel = (p.status === "confirmado" || p.status === "avulso") && p.dia <= hoje;
    var editavel = ["pendente", "confirmado", "avulso"].indexOf(p.status) > -1;
    var classe = "pedido" + (p.status === "pendente" ? " pendente" : "") + (["recusado", "cancelado", "nao_realizado"].indexOf(p.status) > -1 ? " apagado" : "");

    // Ações principais (lado a lado) e secundárias (compactas, numa linha só)
    var primarias = h("div", { class: "primarias" });
    var secundarias = h("div", { class: "secundarias" });
    function botao(onde, texto, classeBotao, icone, fn) {
      var b = h("button", { type: "button", class: "botao " + (onde === primarias ? "p " : "mini ") + (classeBotao || "") }, [icone ? P.icone(icone) : null, texto]);
      b.addEventListener("click", function () { fn(b); });
      onde.appendChild(b);
      return b;
    }

    // Sinal no Pix: o dono confere no banco e toca em "Recebi o sinal" (o pedido fica confirmado)
    if (p.sinal_status === "aguardando" && ctx.dono && (p.status === "pendente" || p.status === "confirmado")) {
      botao(primarias, "Recebi o sinal", "ok", "dinheiro", function (b) { sinalRecebido(p, ctx, b); });
    }
    if (p.status === "pendente") {
      botao(primarias, "Confirmar", "ok", "check", function (b) { decidir(p, "confirmado", ctx, b); });
      botao(primarias, "Recusar", "perigo", "x", function (b) { decidir(p, "recusado", ctx, b); });
    }
    if (encerravel) {
      botao(primarias, "Realizado", "principal", "check", function (b) { encerrar(p, { status: "realizado" }, ctx, b); });
      botao(primarias, "Não realizado", "", null, function (b) { naoRealizado(p, ctx, b); });
    }
    // Gestão de atrasos: no atendimento de hoje, "Chegou" para o aviso de atraso; atrasado, o WhatsApp vai pronto
    var hojeAtivo = p.dia === hoje && (p.status === "confirmado" || p.status === "avulso");
    var atraso = hojeAtivo && !p.chegou_em ? agoraMin() - P.min(P.hm(p.horario)) : 0;
    if (hojeAtivo && !p.chegou_em) botao(secundarias, "Chegou", "ok", "check", function (b) { marcarChegada(p, ctx, b); });
    if (hojeAtivo && !p.chegou_em && atraso >= 5) botao(secundarias, "Avisar atraso", "", "whats", function () { P.abrirWhats(textoAtraso(p, ctx), telefoneDe(p)); });
    if (editavel) botao(secundarias, "Remarcar", "", "relogio", function () { remarcar(p, ctx); });
    if (editavel && p.status !== "pendente") botao(secundarias, "Lembrete", "", "whats", function () { P.abrirWhats(P.mensagem("lembrete", p, ctx.barbearia), telefoneDe(p)); });
    // Atendimento sem cadastro do cliente: cadastrar (pelo celular dele, no painel ou ligando a um cadastro)
    if (!p.cliente_id && !p.clube_assinante_id && ["confirmado", "avulso", "realizado"].indexOf(p.status) > -1 && window.Clientes) {
      botao(secundarias, "Cadastrar", "", "clientes", function () { window.Clientes.cadastrarDoAtendimento(p, ctx); });
    }
    if (p.status !== "recusado" && p.status !== "cancelado") botao(secundarias, "Valor", "", "dinheiro", function () { editarValor(p, ctx); });
    if (editavel) botao(secundarias, "Cancelar", "perigo", "x", function (b) { cancelar(p, ctx, b); });
    var acoes = h("div", { class: "acoes" }, [primarias.childNodes.length ? primarias : null, secundarias.childNodes.length ? secundarias : null]);

    // Assinante do clube: já pagou a mensalidade, não cobra no balcão; o barbeiro ganha a comissão fixa do plano
    var clube = !!p.clube_assinante_id;
    var nomeClube = clube && p.clube_assinantes && p.clube_assinantes.nome;
    // Cliente cadastrado (pelo WhatsApp do agendamento ou no painel): mostra o nome do cadastro se for outro
    var nomeCadastro = !nomeClube && p.cliente_id && p.clientes && p.clientes.nome;
    function outro(n) { return n && n.toLowerCase() !== String(p.cliente || "").toLowerCase(); }
    var meta = [
      h("span", { texto: p.cliente + (outro(nomeClube) ? " (assinante: " + nomeClube + ")" : outro(nomeCadastro) ? " (cadastro: " + nomeCadastro + ")" : "") }),
      opcoes.mostrarBarbeiro && p.profissional ? h("span", { texto: "com " + p.profissional }) : null,
      h("span", { texto: P.duracao(p.duracao_min || 30) }),
      h("span", { texto: clube ? (Number(p.valor) ? P.brl(p.valor) + " extra" : "pago no clube") : p.valor == null ? "sem preço" : P.brl(p.valor) }),
      clube && p.comissao_valor != null ? h("span", { texto: "comissão " + P.brl(p.comissao_valor) }) : null,
      p.codigo ? h("span", { texto: "código " + p.codigo }) : null,
      p.chegou_em ? h("span", { class: "chegou", texto: "chegou " + horaBr(p.chegou_em) }) : atraso >= 5 ? h("span", { class: "atrasado", texto: atraso + " min atrasado" }) : null,
      p.sinal_valor ? h("span", { class: p.sinal_status === "pago" ? "chegou" : "atrasado", texto: "sinal " + P.brl(p.sinal_valor) + (p.sinal_status === "pago" ? " pago" : p.sinal_status === "expirado" ? " não pago" : " aguardando") }) : null,
      // Confirmação de presença pelo celular do cliente (fase 23)
      p.cliente_resposta === "sim" ? h("span", { class: "chegou", texto: p.remarcado_em ? "✓ cliente aceitou o novo horário" : "✓ cliente confirmou" })
        : p.cliente_resposta === "nao" ? h("span", { class: "atrasado", texto: p.remarcado_em ? "não aceitou o novo horário" : "cancelou pelo celular" })
        : p.remarcado_em && editavel ? h("span", { class: "aguarda", texto: "aguardando o cliente aceitar o novo horário" + (p.horario_anterior ? " (era " + (p.dia_anterior && p.dia_anterior !== p.dia ? P.diaCurto(p.dia_anterior) + " " : "") + String(p.horario_anterior).slice(0, 5) + ")" : "") }) : null,
    ];
    return h("article", { class: classe + (clube ? " do-clube" : ""), dataset: { id: p.id } }, [
      h("div", { class: "hora" }, [h("b", { texto: P.hm(p.horario) }), opcoes.mostrarDia || p.dia !== hoje ? h("small", { texto: P.diaCurto(p.dia) }) : h("small", { texto: P.hm(p.horario_fim) ? "até " + P.hm(p.horario_fim) : "" })]),
      h("div", { class: "info" }, [
        h("div", { class: "titulo" }, [h("b", { texto: p.servico }), h("span", { class: "selos" }, [clube ? h("span", { class: "selo selo-clube", texto: "Clube · não cobrar" }) : null, P.selo(p)])]),
        h("div", { class: "meta" }, meta),
        p.observacao ? h("p", { class: "obs", texto: p.observacao }) : null,
        acoes.childNodes.length ? acoes : null,
      ]),
    ]);
  }

  function erro(e) { P.toast(e.message || "Não foi possível concluir.", "erro"); }
  // Minutos desde a meia-noite em Brasília e a hora (HH:MM) de um instante, também em Brasília
  function agoraMin() { var d = new Date(Date.now() - 3 * 36e5); return d.getUTCHours() * 60 + d.getUTCMinutes(); }
  function horaBr(iso) { return new Date(Date.parse(iso) - 3 * 36e5).toISOString().slice(11, 16); }
  function textoAtraso(p, ctx) {
    return "Oi, " + P.primeiroNome(p.cliente) + "! Estamos te esperando para o seu horário das " + P.hm(p.horario) + " na " + (ctx.barbearia || "barbearia") + ". Vai conseguir vir? Se precisar, a gente remarca.";
  }
  function sinalRecebido(p, ctx, botao) {
    P.acao(botao, P.api("/api/pedido", { corpo: { acao: "sinal-pago", id: p.id } }).then(function (r) {
      P.toast("Sinal recebido. Horário confirmado.", "ok");
      ctx.recarregar();
      return oferecerWhats("confirmado", Object.assign({}, p, r.pedido || {}), ctx, "Sinal recebido!");
    }).catch(erro));
  }
  function marcarChegada(p, ctx, botao) {
    P.acao(botao, P.api("/api/pedido", { corpo: { acao: "chegou", id: p.id } }).then(function () {
      P.toast(P.primeiroNome(p.cliente) + " chegou.", "ok");
      ctx.recarregar();
    }).catch(erro));
  }
  // WhatsApp do cliente cadastrado ligado ao pedido (abre direto a conversa dele)
  function telefoneDe(p) { return (p && p.clientes && p.clientes.telefone) || ""; }

  // Depois de decidir, oferece mandar a resposta ao cliente pelo WhatsApp (o número não é guardado)
  function oferecerWhats(tipo, p, ctx, titulo, extra) {
    // Recusou: dá para sugerir outros horários livres em vez de só avisar
    var sugerir = tipo === "recusado" && ctx.slug;
    return P.janela({
      titulo: titulo,
      conteudo: h("div", { class: "grade" }, [
        h("p", { class: "nota", texto: telefoneDe(p) ? "Quer avisar o cliente pelo WhatsApp? A mensagem já vai pronta para a conversa dele." : "Quer avisar o cliente pelo WhatsApp? A mensagem já vai pronta: é só escolher a conversa." }),
        h("p", { class: "obs", style: "white-space:pre-line", texto: P.mensagem(tipo, p, ctx.barbearia, extra) }),
      ]),
      acoes: [{ texto: "Agora não", valor: "cancelar" }].concat(sugerir ? [{ texto: "Sugerir outros horários", valor: "sugerir" }] : [], [{ texto: "Abrir WhatsApp", classe: "whats", valor: "ok" }]),
    }).then(function (r) {
      if (r.valor === "ok") P.abrirWhats(P.mensagem(tipo, p, ctx.barbearia, extra), telefoneDe(p));
      if (r.valor === "sugerir") oferecerHorarios(ctx, { profissionalId: p.profissional_id, cliente: p.cliente, telefone: telefoneDe(p), duracao: p.duracao_min, servico: p.servico, dia: p.dia });
    });
  }

  // ---------- vender produto no balcão (lib/produtos.js) ----------
  // O barbeiro vende em nome dele; o estoque baixa sozinho e o dono recebe o aviso quando chega ao mínimo
  function venderProduto(ctx) {
    P.api("/api/equipe?area=produtos").then(function (j) {
      var ativos = j.produtos.filter(function (p) { return p.ativo; });
      if (!ativos.length) {
        P.janela({ titulo: "Nenhum produto cadastrado", conteudo: h("p", { class: "nota", texto: ctx.dono ? "Cadastre os produtos no Financeiro, em Produtos e estoque." : "O dono ainda não cadastrou os produtos que a barbearia vende." }), acoes: [{ texto: "Entendi", classe: "principal", valor: "ok" }] });
        return;
      }
      var sel = h("select", { "aria-label": "Produto" }, ativos.map(function (p) { return h("option", { value: p.id, texto: p.nome + " · " + P.brl(p.preco) + (p.estoque <= 0 ? " · sem estoque" : " · " + p.estoque + " em estoque") }); }));
      var qtd = h("input", { type: "number", min: "1", max: "100", step: "1", value: "1", inputmode: "numeric" });
      P.janela({
        titulo: "Vender produto",
        conteudo: h("div", { class: "grade" }, [h("label", { class: "campo" }, ["Produto", sel]), h("label", { class: "campo" }, ["Quantidade", qtd]), j.hoje && j.hoje.unidades ? h("p", { class: "nota p", texto: "Hoje: " + j.hoje.unidades + " vendido(s), " + P.brl(j.hoje.bruto) + "." }) : null]),
        acoes: [{ texto: "Voltar", valor: "cancelar" }, { texto: "Registrar venda", classe: "principal", valor: "ok" }],
      }).then(function (r) {
        if (r.valor !== "ok") return;
        var p = ativos.filter(function (a) { return a.id === sel.value; })[0];
        P.api("/api/equipe?area=produtos", { corpo: { acao: "vender", id: sel.value, quantidade: Number(qtd.value) || 1 } }).then(function (x) {
          P.toast("Venda registrada" + (p ? ": " + p.nome : "") + "." + (x.baixo ? (ctx.dono ? " Estoque baixo: hora de repor." : " Estoque baixo: avise o dono.") : ""), "ok");
          if (ctx.recarregar) ctx.recarregar();
        }).catch(function (e) { P.toast(e.message, "erro"); });
      });
    }).catch(function (e) { P.toast(e.message, "erro"); });
  }

  // ---------- mandar horários livres pelo WhatsApp ----------
  // Pedido dos donos: ao passar a agenda para o cliente, escolher QUAIS horários mandar.
  // ctx.slug + ctx.equipe (dono) ou ctx.eu (barbeiro); o: { profissionalId, cliente, telefone, duracao, servico, dia }
  var DURACOES = [20, 30, 40, 50, 60, 90, 120];
  function listaHoras(hs) { return hs.length < 2 ? hs.join("") : hs.slice(0, -1).join(", ") + " e " + hs[hs.length - 1]; }
  function oferecerHorarios(ctx, o) {
    o = o || {};
    var equipe = ctx.equipe && ctx.equipe.length ? ctx.equipe : ctx.eu ? [ctx.eu] : [];
    if (!ctx.slug || !equipe.length) { P.toast("Ainda não dá para mandar horários: a agenda da equipe não carregou.", "erro"); return; }
    var est = {
      prof: equipe.some(function (e) { return e.id === o.profissionalId; }) ? o.profissionalId : equipe[0].id,
      duracao: DURACOES.indexOf(Number(o.duracao)) > -1 ? Number(o.duracao) : 30,
      dia: "", dias: [], horas: [], escolhidas: [],
    };
    var selProf = h("select", { "aria-label": "Barbeiro" }, equipe.map(function (e) { var op = h("option", { value: e.id, texto: e.nome }); if (e.id === est.prof) op.selected = true; return op; }));
    var selDur = h("select", { "aria-label": "Duração" }, DURACOES.map(function (m) { var op = h("option", { value: String(m), texto: m + " min" }); if (m === est.duracao) op.selected = true; return op; }));
    var caixaDias = h("div", { class: "segmentos" });
    var caixaHoras = h("div", { class: "linha", style: "flex-wrap:wrap" });
    var previa = h("p", { class: "obs", style: "white-space:pre-line" });
    function nomeProf() { var e = equipe.filter(function (x) { return x.id === est.prof; })[0]; return e ? e.nome : ""; }
    function texto() {
      var hs = est.escolhidas.slice().sort();
      if (!hs.length) return "";
      var ola = o.cliente ? "Olá, " + P.primeiroNome(o.cliente) + "! " : "Olá! ";
      var dia = P.dataLonga(est.dia).replace(/^Hoje, /, "hoje, ").replace(/^Amanhã, /, "amanhã, ");
      // O link leva o dia e os horários escolhidos: no site, o cliente escolhe só entre eles
      var link = location.origin + "/" + ctx.slug + "?barbeiro=" + encodeURIComponent(est.prof) + "&dia=" + est.dia + "&horas=" + hs.map(function (x) { return x.replace(":", ""); }).join("-") + (o.servico ? "&servico=" + encodeURIComponent(o.servico) : "");
      return ola + "Tenho " + (hs.length === 1 ? "este horário livre" : "estes horários livres") + " na " + (ctx.barbearia || "barbearia") + " " + (/^(hoje|amanhã)/.test(dia) ? "" : "na ") + dia + ", com " + nomeProf() + ":\n" +
        hs.map(function (x) { return "• " + x; }).join("\n") + (o.servico ? "\n(" + o.servico + ")" : "") +
        "\n\nQual fica melhor? É só responder aqui ou marcar um deles pelo link: " + link;
    }
    function desenharPrevia() { var t = texto(); previa.textContent = t || "Toque nos horários que você quer oferecer."; }
    function desenharHoras() {
      if (!est.dia) { P.trocar(caixaHoras, h("p", { class: "nota p", texto: "Nenhum dia com agenda publicada nos próximos 30 dias." })); desenharPrevia(); return; }
      if (est.horas === null) { P.trocar(caixaHoras, h("div", { class: "esqueleto" })); return; }
      if (!est.horas.length) { P.trocar(caixaHoras, h("p", { class: "nota p", texto: "Sem horário livre de " + est.duracao + " min neste dia. Escolha outro dia ou outra duração." })); desenharPrevia(); return; }
      P.trocar(caixaHoras, est.horas.map(function (x) {
        var marcado = est.escolhidas.indexOf(x) > -1;
        var b = h("button", { type: "button", class: "botao p" + (marcado ? " principal" : ""), "aria-pressed": marcado ? "true" : "false", texto: x });
        b.onclick = function () { var i = est.escolhidas.indexOf(x); if (i > -1) est.escolhidas.splice(i, 1); else est.escolhidas.push(x); desenharHoras(); };
        return b;
      }));
      desenharPrevia();
    }
    function carregarHoras() {
      est.escolhidas = []; est.horas = null; desenharHoras();
      if (!est.dia) return;
      var q = "?slug=" + encodeURIComponent(ctx.slug) + "&profissional=" + encodeURIComponent(est.prof) + "&dia=" + est.dia + "&duracao=" + est.duracao;
      fetch("/api/horarios" + q).then(function (r) { return r.json(); }).then(function (j) { est.horas = j.horarios || []; desenharHoras(); })
        .catch(function () { est.horas = []; desenharHoras(); P.toast("Não consegui ver os horários livres.", "erro"); });
    }
    function desenharDias() {
      P.trocar(caixaDias, est.dias.slice(0, 10).map(function (d) {
        var b = h("button", { type: "button", class: "botao p" + (d === est.dia ? " principal" : ""), "aria-pressed": d === est.dia ? "true" : "false", texto: d === P.hoje() ? "Hoje" : d === P.somaDias(P.hoje(), 1) ? "Amanhã" : P.diaCurto(d) });
        b.onclick = function () { est.dia = d; desenharDias(); carregarHoras(); };
        return b;
      }));
    }
    function carregarDias() {
      P.trocar(caixaDias, h("div", { class: "esqueleto" }));
      fetch("/api/horarios?slug=" + encodeURIComponent(ctx.slug) + "&profissional=" + encodeURIComponent(est.prof) + "&dias=1").then(function (r) { return r.json(); }).then(function (j) {
        est.dias = j.dias || [];
        est.dia = est.dias.indexOf(est.dia || o.dia) > -1 ? (est.dia || o.dia) : est.dias[0] || "";
        desenharDias(); carregarHoras();
      }).catch(function () { est.dias = []; est.dia = ""; desenharDias(); desenharHoras(); });
    }
    selProf.onchange = function () { est.prof = selProf.value; carregarDias(); };
    selDur.onchange = function () { est.duracao = Number(selDur.value); carregarHoras(); };
    P.janela({
      titulo: o.cliente ? "Horários para " + P.primeiroNome(o.cliente) : "Mandar horários livres",
      conteudo: h("div", { class: "grade" }, [
        h("div", { class: "linha" }, [equipe.length > 1 ? h("label", { class: "campo", style: "flex:1;min-width:140px" }, ["Barbeiro", selProf]) : null, h("label", { class: "campo", style: "flex:1;min-width:110px" }, ["Duração", selDur])]),
        h("div", { class: "campo" }, [h("span", { texto: "Dia" }), caixaDias]),
        h("div", { class: "campo" }, [h("span", { texto: "Horários que vão na mensagem" }), caixaHoras]),
        previa,
      ]),
      acoes: [{ texto: "Voltar", valor: "cancelar" }, { texto: "Abrir WhatsApp", classe: "whats", valor: "ok" }],
      validar: function (v) { return v === "ok" && !est.escolhidas.length ? "Toque em pelo menos um horário." : ""; },
    }).then(function (r) { if (r.valor === "ok") P.abrirWhats(texto(), o.telefone || ""); });
    carregarDias();
  }

  function decidir(p, status, ctx, botao) {
    var vai = status === "recusado" ? P.confirmar("Recusar pedido?", "O horário das " + P.hm(p.horario) + " volta a ficar livre no site.", "Recusar", true) : Promise.resolve(true);
    vai.then(function (ok) {
      if (!ok) return;
      return P.acao(botao, P.api("/api/pedido", { metodo: "PATCH", corpo: { id: p.id, status: status } }))
        .then(function (r) {
          P.toast(status === "confirmado" ? "Pedido confirmado." : "Pedido recusado.", "ok");
          ctx.recarregar();
          return oferecerWhats(status, Object.assign({}, p, r.pedido || {}), ctx, status === "confirmado" ? "Confirmado!" : "Recusado");
        })
        .catch(function (e) { erro(e); ctx.recarregar(); });
    });
  }

  function encerrar(p, corpo, ctx, botao) {
    return P.acao(botao, P.api("/api/pedido", { metodo: "PATCH", corpo: Object.assign({ id: p.id }, corpo) }))
      .then(function () { P.toast(corpo.status === "realizado" ? "Atendimento realizado. Valor lançado no financeiro." : "Registrado como não realizado.", "ok"); ctx.recarregar(); })
      .catch(function (e) { erro(e); ctx.recarregar(); });
  }

  function naoRealizado(p, ctx) {
    var escolha = h("div", { class: "menu" }, [
      h("label", { class: "chave" }, [h("input", { type: "radio", name: "motivo", value: "cliente_nao_apareceu", checked: true }), "Cliente não apareceu"]),
      h("label", { class: "chave" }, [h("input", { type: "radio", name: "motivo", value: "reagendado" }), "Foi reagendado"]),
    ]);
    P.janela({ titulo: "Por que não foi realizado?", conteudo: escolha, acoes: [{ texto: "Voltar", valor: "cancelar" }, { texto: "Registrar", classe: "principal", valor: "ok" }] }).then(function (r) {
      if (r.valor !== "ok") return;
      var m = r.form.querySelector("input[name=motivo]:checked");
      encerrar(p, { status: "nao_realizado", motivo: m ? m.value : "cliente_nao_apareceu" }, ctx);
    });
  }

  function cancelar(p, ctx) {
    P.confirmar("Cancelar este horário?", p.cliente + " · " + P.dataLonga(p.dia) + " às " + P.hm(p.horario) + ". O horário volta a ficar livre no site.", "Cancelar horário", true).then(function (ok) {
      if (!ok) return;
      P.api("/api/pedido", { corpo: { acao: "cancelar", id: p.id } })
        .then(function () { P.toast("Horário cancelado.", "ok"); ctx.recarregar(); return oferecerWhats("cancelado", p, ctx, "Cancelado"); })
        .catch(erro);
    });
  }

  function editarValor(p, ctx) {
    var campo = h("input", { name: "valor", inputmode: "decimal", placeholder: "Ex.: 40,00", value: p.valor == null ? "" : String(p.valor).replace(".", ",") });
    P.janela({
      titulo: "Valor do atendimento",
      conteudo: h("div", { class: "grade" }, [h("label", { class: "campo" }, ["Valor em R$ (deixe vazio para tirar)", campo]), h("p", { class: "nota p", texto: "Use para desconto ou serviço extra. O valor entra no financeiro quando o atendimento é realizado." })]),
      acoes: [{ texto: "Voltar", valor: "cancelar" }, { texto: "Salvar", classe: "principal", valor: "ok" }],
      validar: function () { var v = campo.value.trim(); return v && !/^\d{1,6}([.,]\d{1,2})?$/.test(v.replace(/\./g, "").replace(/^R\$\s*/, "")) ? "Use só números, ex.: 40,00" : ""; },
    }).then(function (r) {
      if (r.valor !== "ok") return;
      P.api("/api/pedido", { metodo: "PATCH", corpo: { id: p.id, valor: campo.value.trim() } }).then(function () { P.toast("Valor atualizado.", "ok"); ctx.recarregar(); }).catch(erro);
    });
  }

  function remarcar(p, ctx) {
    var dia = h("input", { type: "date", name: "dia", value: p.dia < P.hoje() ? P.hoje() : p.dia, min: P.hoje(), required: true });
    var hora = h("input", { type: "time", name: "hora", value: P.hm(p.horario), step: 300, required: true });
    var dur = h("input", { type: "number", name: "duracao", min: 5, max: 240, step: 5, value: p.duracao_min || 30 });
    var avisar = h("input", { type: "checkbox", checked: true });
    var zap = h("input", { type: "checkbox", checked: true });
    var prof = ctx.dono && ctx.equipe && ctx.equipe.length > 1
      ? h("select", { name: "prof" }, ctx.equipe.map(function (e) { var o = h("option", { value: e.id, texto: e.nome }); if (e.id === p.profissional_id) o.selected = true; return o; }))
      : null;
    P.janela({
      titulo: "Remarcar " + P.primeiroNome(p.cliente),
      conteudo: h("div", { class: "grade" }, [
        h("p", { class: "nota", texto: p.servico + " · agora: " + P.dataLonga(p.dia) + " às " + P.hm(p.horario) }),
        h("div", { class: "grade d2" }, [h("label", { class: "campo" }, ["Novo dia", dia]), h("label", { class: "campo" }, ["Novo horário", hora])]),
        h("div", { class: "grade d2" }, [h("label", { class: "campo" }, ["Duração (min)", dur]), prof ? h("label", { class: "campo" }, ["Barbeiro", prof]) : null]),
        h("label", { class: "check-linha" }, [avisar, "Avisar o cliente no celular (se ele ligou os avisos da barbearia)"]),
        h("label", { class: "check-linha" }, [zap, telefoneDe(p) ? "Mandar no WhatsApp se ele não tiver os avisos no celular" : "Mandar no WhatsApp se ele não tiver os avisos (sem número no cadastro: você escolhe a conversa)"]),
        h("p", { class: "nota p", texto: "O cliente recebe o novo horário com \"Aceito\" e \"Não posso\". A resposta aparece aqui na agenda." }),
      ]),
      acoes: [{ texto: "Voltar", valor: "cancelar" }, { texto: "Remarcar", classe: "principal", valor: "ok" }],
      validar: function () { return !dia.value || !hora.value ? "Escolha o dia e o horário." : ""; },
    }).then(function (r) {
      if (r.valor !== "ok") return;
      var corpo = { acao: "remarcar", id: p.id, dia: dia.value, horario: hora.value, duracao: Number(dur.value) || p.duracao_min || 30, avisar: avisar.checked, whatsapp: zap.checked };
      if (prof) corpo.profissionalId = prof.value;
      P.api("/api/pedido", { corpo: corpo })
        .then(function (res) {
          P.toast("Remarcado para " + P.dataLonga(dia.value) + " às " + hora.value + "." + (res.avisados ? " Cliente avisado no celular." : ""), "ok");
          ctx.recarregar();
          var novo = Object.assign({}, p, res.pedido || {}, { dia: dia.value, horario: hora.value });
          var extra = { link: res.link ? location.origin + res.link : "", era: P.horarioAnterior(p, dia.value) };
          if (!zap.checked) return;
          // Recebeu no celular: o WhatsApp fica como opção; não recebeu: a mensagem já vai pronta
          if (res.avisados) { P.toast("Cliente avisado no celular.", "ok", { texto: "WhatsApp também", acao: function () { P.abrirWhats(P.mensagem("remarcado", novo, ctx.barbearia, extra), telefoneDe(p)); } }); return; }
          return oferecerWhats("remarcado", novo, ctx, "Mandar a mudança no WhatsApp", extra);
        })
        .catch(erro);
    });
  }

  // Encaixe: cliente que chegou sem agendar (vai direto para a agenda, sem confirmação)
  function encaixe(ctx, padrao) {
    padrao = padrao || {};
    if (!ctx.servicos || !ctx.servicos.length) {
      P.janela({ titulo: "Cadastre os serviços primeiro", conteudo: h("p", { class: "nota", texto: ctx.dono ? "Os serviços e preços são cadastrados no Financeiro. Depois disso, o encaixe fica disponível." : "O dono ainda não cadastrou os serviços e preços. Peça para ele cadastrar no Financeiro." }), acoes: [{ texto: "Entendi", classe: "principal", valor: "ok" }] });
      return;
    }
    var agora = P.agoraMin(), arred = Math.ceil(agora / 5) * 5;
    var servico = h("select", { name: "servico" }, ctx.servicos.map(function (s) { return h("option", { value: s.nome, texto: s.nome + (s.preco != null ? " · " + P.brl(s.preco) : "") }); }));
    var cliente = h("input", { name: "cliente", maxlength: 80, autocomplete: "off", placeholder: "Nome do cliente", required: true });
    var dia = h("input", { type: "date", name: "dia", value: padrao.dia || P.hoje() });
    var hora = h("input", { type: "time", name: "hora", step: 300, value: padrao.horario || String(Math.floor(arred / 60) % 24).padStart(2, "0") + ":" + String(arred % 60).padStart(2, "0") });
    var dur = h("select", { name: "duracao" }, [15, 20, 30, 40, 45, 50, 60, 75, 90, 120].map(function (m) { var o = h("option", { value: m, texto: P.duracao(m) }); if (m === 30) o.selected = true; return o; }));
    var prof = ctx.dono ? h("select", { name: "prof" }, (ctx.equipe || []).map(function (e) { var o = h("option", { value: e.id, texto: e.nome }); if (e.id === padrao.profissionalId) o.selected = true; return o; })) : null;
    P.janela({
      titulo: "Encaixe (sem agendamento)",
      conteudo: h("div", { class: "grade" }, [
        h("label", { class: "campo" }, ["Serviço", servico]),
        h("label", { class: "campo" }, ["Cliente", cliente]),
        prof ? h("label", { class: "campo" }, ["Barbeiro", prof]) : null,
        h("div", { class: "grade d3" }, [h("label", { class: "campo" }, ["Dia", dia]), h("label", { class: "campo" }, ["Horário", hora]), h("label", { class: "campo" }, ["Duração", dur])]),
      ]),
      acoes: [{ texto: "Voltar", valor: "cancelar" }, { texto: "Registrar encaixe", classe: "principal", valor: "ok" }],
      validar: function () { return cliente.value.trim().length < 2 ? "Informe o nome do cliente." : !hora.value ? "Informe o horário." : ""; },
    }).then(function (r) {
      if (r.valor !== "ok") return;
      var corpo = { acao: "avulso", servico: servico.value, cliente: cliente.value.trim(), dia: dia.value, horario: hora.value, duracao: Number(dur.value) };
      if (prof) corpo.profissionalId = prof.value;
      P.api("/api/pedido", { corpo: corpo }).then(function () { P.toast("Encaixe registrado na agenda.", "ok"); ctx.recarregar(); }).catch(erro);
    });
  }

  // ---------- editor da semana ----------
  // opcoes: { carregar(de) -> Promise({dias}), salvar(dias, confirmar) -> Promise, titulo }
  function editorSemana(caixa, opcoes) {
    var de = P.hoje();
    var estado = [];
    function linha(d) {
      var a = d.agenda, pd = d.padrao || {};
      var base = a || pd;
      var trabalha = a ? !!a.confirmadaEm : pd.trabalha !== false;
      var publicado = !!(a && a.confirmadaEm);
      var ini = h("input", { type: "time", value: base.inicio || "09:00", step: 900, "aria-label": "Início" });
      var fim = h("input", { type: "time", value: base.fim || "18:00", step: 900, "aria-label": "Fim" });
      var ai = h("input", { type: "time", value: base.almocoInicio || "", step: 900, "aria-label": "Início do almoço" });
      var af = h("input", { type: "time", value: base.almocoFim || "", step: 900, "aria-label": "Fim do almoço" });
      var chave = h("input", { type: "checkbox", checked: trabalha, "aria-label": "Trabalha neste dia" });
      var horas = h("div", { class: "horas" }, [
        h("label", null, ["Início", ini]), h("label", null, ["Fim", fim]), h("label", null, ["Almoço de", ai]), h("label", null, ["até", af]),
      ]);
      var bloq = (d.bloqueios || []).length ? h("small", { class: "nota p", texto: "Bloqueios: " + d.bloqueios.map(function (b) { return b.inicio + "–" + b.fim; }).join(", ") }) : null;
      var el = h("div", { class: "dia-semana" + (trabalha ? "" : " folga") }, [
        h("div", { class: "topo-dia" }, [
          h("div", { class: "quando" }, [h("b", { texto: P.diaCurto(d.dia) + (d.dia === P.hoje() ? " · hoje" : "") }), h("small", { texto: publicado ? "No site" : a ? "Salvo, fora do site" : "Não publicado" })]),
          h("label", { class: "chave" }, [chave, h("span", { texto: trabalha ? "Trabalho" : "Folga" })]),
        ]),
        horas,
        bloq,
      ]);
      horas.hidden = !trabalha;
      chave.addEventListener("change", function () {
        el.classList.toggle("folga", !chave.checked);
        horas.hidden = !chave.checked;
        chave.nextSibling.textContent = chave.checked ? "Trabalho" : "Folga";
      });
      estado.push({ dia: d.dia, chave: chave, ini: ini, fim: fim, ai: ai, af: af });
      return el;
    }
    function desenhar(sem) {
      estado = [];
      var lista = h("div", { class: "semana" }, sem.dias.map(linha));
      var salvar = h("button", { type: "button", class: "botao principal g cheio" }, [P.icone("check"), "Publicar no site"]);
      salvar.addEventListener("click", function () {
        var dias = estado.map(function (s) {
          if (!s.chave.checked) return { dia: s.dia, folga: true };
          return { dia: s.dia, inicio: s.ini.value, fim: s.fim.value, almocoInicio: s.ai.value, almocoFim: s.af.value };
        });
        P.acao(salvar, opcoes.salvar(dias, true))
          .then(function (r) { P.toast("Agenda publicada. Os clientes já veem os horários.", "ok"); if (r && r.dias) desenhar(r); else carregar(); })
          .catch(erro);
      });
      var copiar = h("button", { type: "button", class: "botao p" }, "Repetir o 1º dia em todos");
      copiar.addEventListener("click", function () {
        var p0 = estado[0];
        estado.slice(1).forEach(function (s) { if (s.chave.checked) { s.ini.value = p0.ini.value; s.fim.value = p0.fim.value; s.ai.value = p0.ai.value; s.af.value = p0.af.value; } });
        P.toast("Horários copiados. Confira e publique.");
      });
      var nav = h("div", { class: "navdia" }, [
        h("button", { type: "button", class: "icone", "aria-label": "Semana anterior", onclick: function () { if (de > P.hoje()) { de = P.somaDias(de, -7); if (de < P.hoje()) de = P.hoje(); carregar(); } } }, P.icone("seta_esq")),
        h("span", { class: "rotulo", texto: P.dataBr(sem.dias[0].dia) + " a " + P.dataBr(sem.dias[sem.dias.length - 1].dia) }),
        h("button", { type: "button", class: "icone", "aria-label": "Próxima semana", onclick: function () { de = P.somaDias(de, 7); carregar(); } }, P.icone("seta_dir")),
      ]);
      P.trocar(caixa, [nav, h("p", { class: "nota p", texto: "Marque os dias de trabalho e os horários. Só os dias publicados aparecem para os clientes no site. Pedidos já marcados continuam valendo." }), lista, h("div", { class: "linha" }, [copiar]), salvar]);
    }
    function carregar() {
      P.trocar(caixa, h("div", { class: "esqueleto" }));
      return opcoes.carregar(de).then(desenhar).catch(function (e) { P.trocar(caixa, h("p", { class: "aviso-faixa erro", texto: e.message })); });
    }
    carregar();
    return { recarregar: carregar };
  }

  // ---------- bloqueios pontuais ----------
  // opcoes: { carregar() -> Promise({dias:[{dia, bloqueios:[]}]}), criar(corpo), remover(id) }
  function editorBloqueios(caixa, opcoes) {
    function carregar() {
      return opcoes.carregar().then(function (sem) {
        var itens = [];
        sem.dias.forEach(function (d) { (d.bloqueios || []).forEach(function (b) { itens.push({ dia: d.dia, b: b }); }); });
        var lista = itens.length
          ? h("div", { class: "lista" }, itens.map(function (x) {
              var rem = h("button", { type: "button", class: "botao p perigo" }, "Remover");
              rem.addEventListener("click", function () { P.acao(rem, opcoes.remover(x.b.id)).then(function () { P.toast("Bloqueio removido.", "ok"); carregar(); }).catch(erro); });
              return h("div", { class: "membro" }, [P.icone("trava"), h("div", { class: "cresce" }, [h("div", { class: "nome", texto: P.diaCurto(x.dia) + " · " + x.b.inicio + " às " + x.b.fim }), x.b.motivo ? h("div", { class: "det", texto: x.b.motivo }) : null]), rem]);
            }))
          : h("p", { class: "nota", texto: "Nenhum horário bloqueado nos próximos 14 dias." });
        var dia = h("input", { type: "date", value: P.hoje(), min: P.hoje() });
        var ini = h("input", { type: "time", value: "12:00", step: 900 });
        var fim = h("input", { type: "time", value: "13:00", step: 900 });
        var motivo = h("input", { maxlength: 80, placeholder: "Motivo (opcional)" });
        var add = h("button", { type: "button", class: "botao principal" }, [P.icone("trava"), "Bloquear horário"]);
        add.addEventListener("click", function () {
          P.acao(add, opcoes.criar({ dia: dia.value, inicio: ini.value, fim: fim.value, motivo: motivo.value.trim() }))
            .then(function () { P.toast("Horário bloqueado: some do site.", "ok"); carregar(); })
            .catch(erro);
        });
        P.trocar(caixa, [
          lista,
          h("div", { class: "grade d3" }, [h("label", { class: "campo" }, ["Dia", dia]), h("label", { class: "campo" }, ["Das", ini]), h("label", { class: "campo" }, ["Até", fim])]),
          h("label", { class: "campo" }, ["Motivo", motivo]),
          add,
        ]);
      }).catch(function (e) { P.trocar(caixa, h("p", { class: "aviso-faixa erro", texto: e.message })); });
    }
    carregar();
    return { recarregar: carregar };
  }

  P.cartaoPedido = cartaoPedido;
  P.encaixe = encaixe;
  P.oferecerHorarios = oferecerHorarios;
  P.venderProduto = venderProduto;
  P.remarcar = remarcar;
  P.oferecerWhats = oferecerWhats;
  P.telefoneDe = telefoneDe;
  P.editorSemana = editorSemana;
  P.editorBloqueios = editorBloqueios;
  P.vazio = function (emoji, texto) { return h("div", { class: "vazio" }, [h("span", { class: "emoji", "aria-hidden": "true", texto: emoji }), h("p", { texto: texto })]); };
})();
