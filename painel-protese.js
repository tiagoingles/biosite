// Aba Prótese do painel do dono (lib/protese.js): ficha de cada cliente de prótese capilar, próxima manutenção,
// lembrete pronto no WhatsApp, horários livres para mandar e o histórico das manutenções.
(function () {
  "use strict";
  var P = window.Painel, h = P.h;
  var op = {}, raiz = null, el = {}, dados = null;
  var STATUS = { atrasada: ["Atrasada", "alerta"], vence: ["Vence logo", "info"], em_dia: ["Em dia", "ok"], sem_data: ["Sem data", "neutro"] };

  function api(corpo) { return P.api("/api/equipe?area=protese", corpo ? { corpo: corpo } : undefined); }
  function configurar(o) { op = o || {}; }

  function quando(f) {
    if (!f.proxima) return "Sem data da aplicação: edite a ficha para contar o prazo.";
    var dia = P.dataLonga(f.proxima);
    if (f.dias < 0) return "Manutenção atrasada há " + (-f.dias) + (f.dias === -1 ? " dia" : " dias") + " (era " + dia + ").";
    if (f.dias === 0) return "Manutenção vence hoje.";
    return "Próxima manutenção: " + dia + " (em " + f.dias + (f.dias === 1 ? " dia" : " dias") + ").";
  }
  function textoLembrete(f) {
    var nome = P.primeiroNome(f.nome);
    var prazo = !f.proxima ? "está chegando" : f.dias < 0 ? "já passou do prazo" : f.dias === 0 ? "vence hoje" : "vence " + P.dataLonga(f.proxima).replace(/^Amanhã, /, "amanhã, ");
    return "Olá, " + nome + "! A manutenção da sua prótese capilar na " + (op.barbearia || "barbearia") + " " + prazo + ". Vamos agendar?" + (op.site ? "\nÉ só responder aqui ou marcar pelo site: " + op.site + "#protese" : "");
  }

  function montar(alvo) {
    raiz = alvo;
    el.kpis = h("div", { class: "kpis larga" }, [h("div", { class: "esqueleto" }), h("div", { class: "esqueleto" }), h("div", { class: "esqueleto" })]);
    el.lista = h("div", { class: "lista" }, h("div", { class: "esqueleto" }));
    var nova = h("button", { type: "button", class: "botao p principal" }, [P.icone("mais_um"), "Nova ficha"]);
    nova.onclick = function () { formulario(null); };
    P.trocar(raiz, [
      el.kpis,
      h("section", { class: "cartao larga" }, [
        h("div", { class: "cartao-topo" }, [h("h2", { texto: "Clientes de prótese" }), nova]),
        h("p", { class: "nota p", texto: "A próxima manutenção conta da última (ou da aplicação) mais o intervalo de cada cliente. Atendimento de prótese marcado como realizado na agenda já entra como manutenção." }),
        el.lista,
      ]),
    ]);
  }

  function kpi(rotulo, valor, sub) { return h("div", { class: "kpi" }, [h("span", { texto: rotulo }), h("b", { texto: valor }), h("small", { texto: sub })]); }

  function carregar() {
    if (!raiz) return Promise.resolve();
    return api().then(function (j) { dados = j; desenhar(); }).catch(function (e) { P.trocar(el.lista, P.vazio("⚠️", e.message)); });
  }

  function desenhar() {
    var r = dados.resumo;
    P.trocar(el.kpis, [
      kpi("Clientes de prótese", String(r.total), "com ficha ativa"),
      kpi("Esta semana", String(r.semana), "manutenções nos próximos 7 dias"),
      kpi("Atrasadas", String(r.atrasadas), r.vencem ? r.vencem + " vencem em até 3 dias" : "sem manutenção vencendo"),
    ]);
    if (P.bolinha) P.bolinha("protese", r.atrasadas + r.vencem);
    if (!dados.fichas.length) { P.trocar(el.lista, P.vazio("💈", "Nenhuma ficha ainda. Toque em \"Nova ficha\" para cadastrar o primeiro cliente de prótese.")); return; }
    P.trocar(el.lista, dados.fichas.map(cartao));
  }

  function cartao(f) {
    var st = STATUS[f.status] || STATUS.sem_data;
    var bLembrar = h("button", { type: "button", class: "botao p whats" }, [P.icone("whats"), f.lembrado ? "Lembrar de novo" : "Lembrar"]);
    var bHoras = h("button", { type: "button", class: "botao p" }, [P.icone("agenda"), "Horários"]);
    var bFeita = h("button", { type: "button", class: "botao p principal" }, [P.icone("check"), "Manutenção feita"]);
    var bMais = h("button", { type: "button", class: "botao p fantasma" }, [P.icone("lapis"), "Ficha"]);
    bLembrar.onclick = function () { lembrar(f, bLembrar); };
    bHoras.onclick = function () {
      if (!P.oferecerHorarios || !op.ctx) { P.toast("Abra a aba Agenda uma vez para carregar a equipe.", "erro"); return; }
      P.oferecerHorarios(op.ctx, { profissionalId: f.profissional_id, cliente: f.nome, telefone: f.telefone, duracao: 60, servico: "Manutenção da prótese capilar" });
    };
    bFeita.onclick = function () { manutencao(f, bFeita); };
    bMais.onclick = function () { ficha(f); };
    var det = [f.modelo, f.profissional ? "com " + f.profissional : "", "a cada " + f.intervalo_dias + " dias"].filter(Boolean).join(" · ");
    return h("div", { class: "membro cartao-membro" }, [
      h("div", { class: "membro-topo" }, [
        P.avatar({ nome: f.nome }),
        h("div", { class: "cresce" }, [
          h("div", { class: "nome", texto: f.nome }),
          h("div", { class: "det", texto: det }),
          h("div", { class: "det", texto: quando(f) + (f.lembrado ? " Já lembrado." : "") }),
          h("span", { class: "selo selo-" + st[1], texto: st[0] }),
        ]),
      ]),
      h("div", { class: "acoes-membro" }, [bFeita, bLembrar, bHoras, bMais]),
    ]);
  }

  function lembrar(f, botao) {
    var texto = textoLembrete(f);
    P.abrirWhats(texto, f.telefone);
    P.acao(botao, api({ acao: "lembrar", id: f.id }).then(function () { carregar(); }).catch(function (e) { P.toast("O WhatsApp abriu, mas o lembrete não ficou anotado: " + e.message, "erro"); }));
  }

  function manutencao(f, botao) {
    var dia = h("input", { type: "date", value: P.hoje(), max: P.hoje() });
    var tipo = h("select", null, [h("option", { value: "manutencao", texto: "Manutenção" }), h("option", { value: "troca", texto: "Troca da prótese" }), h("option", { value: "aplicacao", texto: "Aplicação" })]);
    var obs = h("input", { type: "text", maxlength: 300, placeholder: "Opcional: cola, fita, ajuste..." });
    P.janela({
      titulo: "Manutenção de " + P.primeiroNome(f.nome),
      conteudo: h("div", { class: "grade" }, [h("label", { class: "campo" }, ["Dia", dia]), h("label", { class: "campo" }, ["O que foi feito", tipo]), h("label", { class: "campo" }, ["Observação", obs])]),
      acoes: [{ texto: "Voltar", valor: "cancelar" }, { texto: "Registrar", classe: "principal", valor: "ok" }],
    }).then(function (r) {
      if (r.valor !== "ok") return;
      P.acao(botao, api({ acao: "manutencao", id: f.id, dia: dia.value, tipo: tipo.value, observacao: obs.value }).then(function (x) {
        P.toast("Registrado. Próxima manutenção: " + P.dataLonga(x.proxima) + ".", "ok");
        carregar();
      }).catch(function (e) { P.toast(e.message, "erro"); }));
    });
  }

  function ficha(f) {
    var lista = h("div", { class: "lista" }, h("div", { class: "esqueleto" }));
    var bEditar = h("button", { type: "button", class: "botao" }, [P.icone("lapis"), "Editar ficha"]);
    var bSair = h("button", { type: "button", class: "botao perigo" }, [P.icone("lixo"), "Parou de usar"]);
    bEditar.onclick = function () { document.querySelectorAll("dialog.dlg").forEach(function (d) { d.close(""); }); formulario(f); };
    bSair.onclick = function () {
      P.confirmar("Tirar " + f.nome + " da lista?", "A ficha sai da aba Prótese. O histórico das manutenções fica guardado.", "Tirar da lista", true).then(function (ok) {
        if (!ok) return;
        api({ acao: "desativar", id: f.id }).then(function () { document.querySelectorAll("dialog.dlg").forEach(function (d) { d.close(""); }); P.toast(f.nome + " saiu da lista.", "ok"); carregar(); }).catch(function (e) { P.toast(e.message, "erro"); });
      });
    };
    P.janela({
      titulo: f.nome,
      conteudo: h("div", { class: "grade" }, [
        h("ul", { class: "mini-lista" }, [
          f.telefone ? h("li", null, [h("span", { texto: "WhatsApp" }), h("b", { texto: f.telefone })]) : null,
          f.modelo ? h("li", null, [h("span", { texto: "Prótese" }), h("b", { texto: f.modelo })]) : null,
          f.profissional ? h("li", null, [h("span", { texto: "Responsável" }), h("b", { texto: f.profissional })]) : null,
          f.aplicada_em ? h("li", null, [h("span", { texto: "Aplicada em" }), h("b", { texto: P.dataBr(f.aplicada_em) + "/" + f.aplicada_em.slice(0, 4) })]) : null,
          h("li", null, [h("span", { texto: "Intervalo" }), h("b", { texto: f.intervalo_dias + " dias" })]),
        ]),
        f.observacao ? h("p", { class: "nota p", style: "white-space:pre-line", texto: f.observacao }) : null,
        h("h3", { texto: "Histórico" }),
        lista,
        h("div", { class: "linha" }, [bEditar, bSair]),
      ]),
      acoes: [{ texto: "Fechar", valor: "cancelar" }],
    });
    var TIPO = { aplicacao: "Aplicação", manutencao: "Manutenção", troca: "Troca" };
    api({ acao: "historico", id: f.id }).then(function (j) {
      P.trocar(lista, j.manutencoes.length ? j.manutencoes.map(function (m) {
        return h("div", { class: "membro" }, [h("div", { class: "cresce" }, [h("div", { class: "nome", texto: (TIPO[m.tipo] || m.tipo) + " · " + P.diaCurto(m.dia) + "/" + m.dia.slice(0, 4) }), m.observacao ? h("div", { class: "det", texto: m.observacao }) : null])]);
      }) : P.vazio("🗓️", "Nenhuma manutenção registrada ainda."));
    }).catch(function (e) { P.trocar(lista, P.vazio("⚠️", e.message)); });
  }

  function formulario(f) {
    var equipe = (dados && dados.equipe) || [];
    var nome = h("input", { type: "text", maxlength: 80, value: f ? f.nome : "" });
    var zap = h("input", { type: "tel", maxlength: 20, placeholder: "(81) 99999-9999", value: f ? f.telefone : "" });
    var prof = h("select", null, [h("option", { value: "", texto: "Sem responsável" })].concat(equipe.map(function (e) { var o = h("option", { value: e.id, texto: e.nome }); if (f && f.profissional_id === e.id) o.selected = true; return o; })));
    var modelo = h("input", { type: "text", maxlength: 120, placeholder: "Ex.: Full lace, fornecedor X", value: f ? f.modelo : "" });
    var aplicada = h("input", { type: "date", max: P.hoje(), value: f && f.aplicada_em ? f.aplicada_em : "" });
    var intervalo = h("input", { type: "number", min: 7, max: 120, step: 1, value: f ? String(f.intervalo_dias) : "21" });
    var obs = h("textarea", { rows: 2, maxlength: 500 }); obs.value = f ? f.observacao : "";
    P.janela({
      titulo: f ? "Editar ficha" : "Nova ficha de prótese",
      conteudo: h("div", { class: "grade" }, [
        h("label", { class: "campo" }, ["Nome do cliente", nome]),
        h("label", { class: "campo" }, ["WhatsApp", zap]),
        h("label", { class: "campo" }, ["Barbeiro responsável", prof]),
        h("label", { class: "campo" }, ["Prótese (modelo, fornecedor)", modelo]),
        h("div", { class: "linha" }, [h("label", { class: "campo", style: "flex:1;min-width:140px" }, ["Data da aplicação", aplicada]), h("label", { class: "campo", style: "flex:1;min-width:120px" }, ["Manutenção a cada (dias)", intervalo])]),
        h("label", { class: "campo" }, ["Observação", obs]),
      ]),
      acoes: [{ texto: "Voltar", valor: "cancelar" }, { texto: f ? "Salvar" : "Criar ficha", classe: "principal", valor: "ok" }],
      validar: function (v) { return v === "ok" && nome.value.trim().length < 2 ? "Informe o nome do cliente." : ""; },
    }).then(function (r) {
      if (r.valor !== "ok") return;
      api({ acao: f ? "editar" : "criar", id: f ? f.id : undefined, nome: nome.value, telefone: zap.value, profissionalId: prof.value || null, modelo: modelo.value, aplicadaEm: aplicada.value || null, intervaloDias: Number(intervalo.value), observacao: obs.value })
        .then(function () { P.toast(f ? "Ficha atualizada." : "Ficha criada.", "ok"); carregar(); })
        .catch(function (e) { P.toast(e.message, "erro"); });
    });
  }

  window.Protese = { configurar: configurar, montar: montar, carregar: carregar, _: { quando: quando, textoLembrete: textoLembrete } };
})();
