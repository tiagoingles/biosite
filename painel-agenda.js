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

    if (p.status === "pendente") {
      botao(primarias, "Confirmar", "ok", "check", function (b) { decidir(p, "confirmado", ctx, b); });
      botao(primarias, "Recusar", "perigo", "x", function (b) { decidir(p, "recusado", ctx, b); });
    }
    if (encerravel) {
      botao(primarias, "Realizado", "principal", "check", function (b) { encerrar(p, { status: "realizado" }, ctx, b); });
      botao(primarias, "Não realizado", "", null, function (b) { naoRealizado(p, ctx, b); });
    }
    if (editavel) botao(secundarias, "Remarcar", "", "relogio", function () { remarcar(p, ctx); });
    if (editavel && p.status !== "pendente") botao(secundarias, "Lembrete", "", "whats", function () { P.abrirWhats(P.mensagem("lembrete", p, ctx.barbearia)); });
    if (p.status !== "recusado" && p.status !== "cancelado") botao(secundarias, "Valor", "", "dinheiro", function () { editarValor(p, ctx); });
    if (editavel) botao(secundarias, "Cancelar", "perigo", "x", function (b) { cancelar(p, ctx, b); });
    var acoes = h("div", { class: "acoes" }, [primarias.childNodes.length ? primarias : null, secundarias.childNodes.length ? secundarias : null]);

    var meta = [
      h("span", { texto: p.cliente }),
      opcoes.mostrarBarbeiro && p.profissional ? h("span", { texto: "com " + p.profissional }) : null,
      h("span", { texto: P.duracao(p.duracao_min || 30) }),
      h("span", { texto: p.valor == null ? "sem preço" : P.brl(p.valor) }),
      p.codigo ? h("span", { texto: "código " + p.codigo }) : null,
    ];
    return h("article", { class: classe, dataset: { id: p.id } }, [
      h("div", { class: "hora" }, [h("b", { texto: P.hm(p.horario) }), opcoes.mostrarDia || p.dia !== hoje ? h("small", { texto: P.diaCurto(p.dia) }) : h("small", { texto: P.hm(p.horario_fim) ? "até " + P.hm(p.horario_fim) : "" })]),
      h("div", { class: "info" }, [
        h("div", { class: "titulo" }, [h("b", { texto: p.servico }), P.selo(p)]),
        h("div", { class: "meta" }, meta),
        p.observacao ? h("p", { class: "obs", texto: p.observacao }) : null,
        acoes.childNodes.length ? acoes : null,
      ]),
    ]);
  }

  function erro(e) { P.toast(e.message || "Não foi possível concluir.", "erro"); }

  // Depois de decidir, oferece mandar a resposta ao cliente pelo WhatsApp (o número não é guardado)
  function oferecerWhats(tipo, p, ctx, titulo) {
    return P.janela({
      titulo: titulo,
      conteudo: h("div", { class: "grade" }, [
        h("p", { class: "nota", texto: "Quer avisar o cliente pelo WhatsApp? A mensagem já vai pronta: é só escolher a conversa." }),
        h("p", { class: "obs", style: "white-space:pre-line", texto: P.mensagem(tipo, p, ctx.barbearia) }),
      ]),
      acoes: [{ texto: "Agora não", valor: "cancelar" }, { texto: "Abrir WhatsApp", classe: "whats", valor: "ok" }],
    }).then(function (r) { if (r.valor === "ok") P.abrirWhats(P.mensagem(tipo, p, ctx.barbearia)); });
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
    var prof = ctx.dono && ctx.equipe && ctx.equipe.length > 1
      ? h("select", { name: "prof" }, ctx.equipe.map(function (e) { var o = h("option", { value: e.id, texto: e.nome }); if (e.id === p.profissional_id) o.selected = true; return o; }))
      : null;
    P.janela({
      titulo: "Remarcar " + P.primeiroNome(p.cliente),
      conteudo: h("div", { class: "grade" }, [
        h("p", { class: "nota", texto: p.servico + " · agora: " + P.dataLonga(p.dia) + " às " + P.hm(p.horario) }),
        h("div", { class: "grade d2" }, [h("label", { class: "campo" }, ["Novo dia", dia]), h("label", { class: "campo" }, ["Novo horário", hora])]),
        h("div", { class: "grade d2" }, [h("label", { class: "campo" }, ["Duração (min)", dur]), prof ? h("label", { class: "campo" }, ["Barbeiro", prof]) : null]),
      ]),
      acoes: [{ texto: "Voltar", valor: "cancelar" }, { texto: "Remarcar", classe: "principal", valor: "ok" }],
      validar: function () { return !dia.value || !hora.value ? "Escolha o dia e o horário." : ""; },
    }).then(function (r) {
      if (r.valor !== "ok") return;
      var corpo = { acao: "remarcar", id: p.id, dia: dia.value, horario: hora.value, duracao: Number(dur.value) || p.duracao_min || 30 };
      if (prof) corpo.profissionalId = prof.value;
      P.api("/api/pedido", { corpo: corpo })
        .then(function (res) {
          P.toast("Remarcado para " + P.dataLonga(dia.value) + " às " + hora.value + ".", "ok");
          ctx.recarregar();
          return oferecerWhats("remarcado", Object.assign({}, p, res.pedido || {}, { dia: dia.value, horario: hora.value }), ctx, "Remarcado");
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
  P.remarcar = remarcar;
  P.editorSemana = editorSemana;
  P.editorBloqueios = editorBloqueios;
  P.vazio = function (emoji, texto) { return h("div", { class: "vazio" }, [h("span", { class: "emoji", "aria-hidden": "true", texto: emoji }), h("p", { texto: texto })]); };
})();
