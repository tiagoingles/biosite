// Aba Espera do painel do dono (lib/espera.js, fase 39; pedido do Manolo, Dom Manolo).
// Quem não achou horário no site entra na lista com o dia e de que horas até que horas pode; o dono também coloca
// quem pede pelo telefone. A ordem de chegada é a prioridade (1º, 2º...). Quando um horário vaga (cancelamento ou
// desistência), ele aparece em cima com quem da lista cabe nele, na ordem, e o WhatsApp pronto para chamar.
(function () {
  "use strict";
  var P = window.Painel, h = P.h;
  var op = {}, raiz = null, el = {}, dados = null;
  var PARA_HORAS = [];
  for (var t = 7 * 60; t <= 22 * 60; t += 30) PARA_HORAS.push(String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"));

  function api(corpo) { return P.api("/api/equipe?area=espera", corpo ? { corpo: corpo } : undefined); }
  function configurar(o) { op = o || {}; }
  function quando(dia) { var t = P.dataLonga(dia); return t.charAt(0).toLowerCase() + t.slice(1); }
  function kpi(rotulo, valor, sub) { return h("div", { class: "kpi" }, [h("span", { texto: rotulo }), h("b", { texto: valor }), h("small", { texto: sub })]); }
  function porId(id) { return (dados.lista || []).filter(function (e) { return e.id === id; })[0]; }

  // O horário a oferecer: o da vaga ou, se o cliente só pode mais tarde, o começo do que ele pode (vagou 09:30, ele pode das 10:00: 10:00)
  function horaPara(e, v) { return e.de > v.horario ? e.de : v.horario; }
  // Mensagens do WhatsApp: com o horário que vagou, ou só avisando que abriu um horário no dia dele
  function textoVaga(e, v) {
    return "Olá, " + P.primeiroNome(e.nome) + "! Aqui é da " + (op.barbearia || "barbearia") + ". Abriu um horário " + quando(v.dia) + " às " + horaPara(e, v)
      + (v.profissional ? " com " + v.profissional : "") + ". Você estava na nossa lista de espera: quer esse horário? Responda aqui que a gente já marca.";
  }
  function textoLista(e) {
    return "Olá, " + P.primeiroNome(e.nome) + "! Aqui é da " + (op.barbearia || "barbearia") + ". Você está na nossa lista de espera para " + quando(e.dia)
      + ", das " + e.de + " às " + e.ate + ". Abriu um horário: posso marcar para você?";
  }

  function montar(alvo) {
    raiz = alvo;
    el.kpis = h("div", { class: "kpis larga" }, [h("div", { class: "esqueleto" }), h("div", { class: "esqueleto" }), h("div", { class: "esqueleto" })]);
    el.vagas = h("section", { class: "cartao larga", hidden: true });
    el.lista = h("section", { class: "cartao larga" }, h("div", { class: "esqueleto" }));
    P.trocar(raiz, [el.kpis, el.vagas, el.lista]);
  }

  function carregar() {
    if (!raiz) return Promise.resolve();
    return api().then(function (j) { dados = j; desenhar(); }).catch(function (e) { P.trocar(el.lista, P.vazio("⚠️", e.message)); });
  }
  // Só a bolinha da aba (horários vagos com alguém na lista), sem abrir a tela
  function contar() {
    return api().then(function (j) { P.bolinha("espera", (j.vagas || []).length); }).catch(function () {});
  }

  function desenhar() {
    var lista = dados.lista || [], vagas = dados.vagas || [];
    var hoje = lista.filter(function (e) { return e.dia === dados.hoje; }).length;
    P.trocar(el.kpis, [
      kpi("Na lista", String(lista.length), "de hoje em diante"),
      kpi("Para hoje", String(hoje), hoje === 1 ? "pessoa esperando" : "pessoas esperando"),
      kpi("Vagou", String(vagas.length), vagas.length ? "horário com gente na fila" : "nenhum horário vago"),
    ]);
    P.bolinha("espera", vagas.length);
    desenharVagas(vagas);
    desenharLista(lista);
  }

  // Horários que vagaram, cada um com quem da lista cabe nele, na ordem
  function desenharVagas(vagas) {
    el.vagas.hidden = !vagas.length;
    if (!vagas.length) { P.limpar(el.vagas); return; }
    P.trocar(el.vagas, [
      h("div", { class: "cartao-topo" }, [h("h2", { texto: "Horários que vagaram" })]),
      h("p", { class: "nota p", texto: "Um cliente cancelou ou desistiu. Chame quem está na lista, na ordem: o 1º tem a preferência." }),
      h("div", { class: "lista" }, vagas.map(function (v) {
        var fila = v.fila.map(porId).filter(Boolean);
        return h("div", { class: "esp-vaga" }, [
          h("b", { texto: P.diaCurto(v.dia) + " às " + v.horario + (v.profissional ? " com " + v.profissional : "") }),
          h("small", { texto: v.duracao_min + " min livres · era " + (v.servico || "um atendimento") }),
          h("div", { class: "lista" }, fila.map(function (e, i) { return linha(e, i + 1, v); })),
        ]);
      })),
    ]);
  }

  // A lista do dia, na ordem de chegada
  function desenharLista(lista) {
    var novo = h("button", { type: "button", class: "botao p principal" }, [P.icone("mais_um"), "Colocar na lista"]);
    novo.onclick = colocar;
    var topo = h("div", { class: "cartao-topo" }, [h("h2", { texto: "Lista de espera" }), novo]);
    if (!lista.length) {
      P.trocar(el.lista, [topo, P.vazio("⏳", "Ninguém na lista. Quando um cliente não achar horário no site, ele entra aqui com o horário que pode. Quem pede pelo telefone você coloca em \"Colocar na lista\".")]);
      return;
    }
    var dias = [];
    lista.forEach(function (e) { if (dias.indexOf(e.dia) < 0) dias.push(e.dia); });
    P.trocar(el.lista, [topo, h("p", { class: "nota p", texto: "A ordem é a de chegada: quem entrou primeiro tem a preferência." })].concat(dias.map(function (d) {
      var doDia = lista.filter(function (e) { return e.dia === d; });
      return h("div", { class: "grade" }, [h("h3", { class: "esp-dia", texto: P.dataLonga(d) + " · " + doDia.length + (doDia.length === 1 ? " pessoa" : " pessoas") }), h("div", { class: "lista" }, doDia.map(function (e, i) { return linha(e, i + 1, null); }))]);
    })));
  }

  // Uma pessoa da lista: posição, nome, horário que pode, serviço e os botões
  function linha(e, posicao, vaga) {
    var info = ["das " + e.de + " às " + e.ate, e.servico + (e.duracao_min ? " (" + e.duracao_min + " min)" : ""), e.profissional ? "com " + e.profissional : "qualquer barbeiro", e.pelo_site ? "pelo site" : "pelo telefone"];
    var zap = h("button", { type: "button", class: "botao p whats" }, [P.icone("whats"), vaga ? "Chamar" : "WhatsApp"]);
    zap.onclick = function () {
      P.abrirWhats(vaga ? textoVaga(e, vaga) : textoLista(e), e.telefone || "");
      api({ acao: "status", id: e.id, status: "contatado" }).then(carregar).catch(function () {});
    };
    var marcar = h("button", { type: "button", class: "botao p" }, [P.icone("mais_um"), "Marcar"]);
    marcar.onclick = function () { marcarHorario(e, vaga); };
    var tirar = h("button", { type: "button", class: "botao mini perigo", "aria-label": "Tirar " + e.nome + " da lista" }, P.icone("lixo"));
    tirar.onclick = function () {
      P.confirmar("Tirar da lista?", e.nome + " sai da lista de espera de " + quando(e.dia) + ".", "Tirar", true).then(function (ok) {
        if (ok) api({ acao: "status", id: e.id, status: "saiu" }).then(function () { P.toast("Saiu da lista.", "ok"); return carregar(); }).catch(function (x) { P.toast(x.message, "erro"); });
      });
    };
    return h("div", { class: "esp-item" }, [
      h("span", { class: "esp-pos", texto: posicao + "º" }),
      h("div", { class: "cresce" }, [
        h("div", { class: "esp-topo" }, [h("b", { texto: e.nome }), tirar]),
        h("small", { texto: info.join(" · ") }),
        e.observacao ? h("small", { class: "esp-obs", texto: "Obs.: " + e.observacao }) : null,
        e.status === "contatado" && e.contatado_em ? h("span", { class: "selo selo-info", texto: "Chamado às " + new Date(e.contatado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) }) : null,
        h("div", { class: "linha" }, [zap, marcar]),
      ]),
    ]);
  }

  // Marcar: abre o encaixe já com o cliente, o serviço, o dia e o horário (o da vaga ou o começo do que ele pode)
  function marcarHorario(e, vaga) {
    if (!op.ctx || !P.encaixe) return;
    P.encaixe(op.ctx, {
      dia: vaga ? vaga.dia : e.dia,
      horario: vaga ? horaPara(e, vaga) : e.de,
      profissionalId: vaga ? vaga.profissional_id : e.profissional_id,
      servico: e.servico, // o tempo vem do serviço do site, como num encaixe comum
      cliente: e.nome,
      clienteId: e.cliente_id,
      telefone: e.telefone,
      aoRegistrar: function () {
        api({ acao: "status", id: e.id, status: "marcado" }).then(function () { P.toast(e.nome + " saiu da lista: horário marcado.", "ok"); return carregar(); }).catch(function () {});
      },
    });
  }

  // Colocar na lista quem pediu pelo telefone ou no balcão. O cliente vem da carteira, buscando pelo nome ou pelo
  // final do telefone (como no encaixe): o WhatsApp sai do cadastro. Quem não está na carteira: nome e WhatsApp.
  function colocar() {
    var ctx = op.ctx || {};
    var nome = h("input", { maxlength: 80, autocomplete: "off", placeholder: "Nome ou final do telefone" });
    var zap = h("input", { type: "tel", inputmode: "tel", maxlength: 20, autocomplete: "off", placeholder: "(81) 99999-9999" });
    var boxZap = h("label", { class: "campo" }, ["WhatsApp", zap]);
    var sugestoes = h("div", { class: "sugestoes" });
    var escolhido = null, espera = null;
    function escolher(c) {
      escolhido = c;
      nome.value = c.nome;
      boxZap.hidden = !!c.final; // com WhatsApp no cadastro, a barbearia chama por ele
      P.trocar(sugestoes, h("p", { class: "nota p", texto: c.final ? "Cliente da carteira · WhatsApp final " + c.final + ". É por esse número que a barbearia chama." : "Cliente da carteira sem WhatsApp no cadastro: digite o número para poder chamar." }));
      if (!c.final) zap.focus();
    }
    function clienteNovo() {
      var t = nome.value.trim();
      escolhido = null;
      boxZap.hidden = false;
      // Digitou o telefone na busca: ele vai para o campo do WhatsApp e o nome fica para escrever
      if (/^[\d\s().+-]+$/.test(t)) { zap.value = t; nome.value = ""; }
      P.trocar(sugestoes, h("p", { class: "nota p", texto: "Cliente novo: escreva o nome e o WhatsApp." }));
      (nome.value ? zap : nome).focus();
    }
    nome.addEventListener("input", function () {
      if (escolhido && nome.value !== escolhido.nome) { escolhido = null; boxZap.hidden = false; }
      clearTimeout(espera);
      var t = nome.value.trim();
      if (escolhido || (t.length < 2 && t.replace(/\D/g, "").length < 3)) { P.limpar(sugestoes); return; }
      espera = setTimeout(function () {
        P.api("/api/equipe?area=clientes&busca=" + encodeURIComponent(t)).then(function (j) {
          if (nome.value.trim() !== t) return; // já digitou outra coisa
          var lista = j.clientes || [];
          var novo = h("button", { type: "button", class: "sugestao novo", onclick: clienteNovo }, [h("b", { texto: "+ Cliente novo (não está na carteira)" })]);
          P.trocar(sugestoes, (lista.length ? lista.map(function (c) {
            return h("button", { type: "button", class: "sugestao", onclick: function () { escolher(c); } }, [h("b", { texto: c.nome }), c.final ? h("span", { texto: " · final " + c.final }) : null]);
          }) : [h("p", { class: "nota p", texto: "Ninguém com esse nome ou telefone na carteira." })]).concat([novo]));
        }).catch(function () { P.limpar(sugestoes); });
      }, 250);
    });
    var servicos = (ctx.servicos || []).map(function (s) { return s.nome; });
    var servico = servicos.length ? h("select", null, servicos.map(function (n) { return h("option", { value: n, texto: n }); })) : h("input", { maxlength: 200, placeholder: "Ex.: Corte" });
    var dia = h("input", { type: "date", value: P.hoje(), min: P.hoje() });
    var de = h("select", null, PARA_HORAS.map(function (x) { return h("option", { value: x, texto: x, selected: x === "09:00" }); }));
    var ate = h("select", null, PARA_HORAS.map(function (x) { return h("option", { value: x, texto: x, selected: x === "18:00" }); }));
    var prof = h("select", null, [h("option", { value: "", texto: "Qualquer barbeiro" })].concat((dados && dados.profissionais || []).map(function (p) { return h("option", { value: p.id, texto: p.nome }); })));
    var obs = h("input", { maxlength: 200, placeholder: "Ex.: pode a qualquer hora depois do almoço" });
    P.janela({
      titulo: "Colocar na lista de espera",
      conteudo: h("div", { class: "grade" }, [
        h("label", { class: "campo" }, ["Cliente", nome]),
        sugestoes,
        boxZap,
        h("label", { class: "campo" }, ["Serviço", servico]),
        h("label", { class: "campo" }, ["Dia", dia]),
        h("div", { class: "grade d2" }, [h("label", { class: "campo" }, ["Pode de", de]), h("label", { class: "campo" }, ["até", ate])]),
        h("label", { class: "campo" }, ["Barbeiro", prof]),
        h("label", { class: "campo" }, ["Observação (opcional)", obs]),
        h("p", { class: "nota p", texto: "Entra no fim da lista do dia: a ordem é a de chegada." }),
      ]),
      acoes: [{ texto: "Voltar", valor: "cancelar" }, { texto: "Colocar na lista", classe: "principal", valor: "ok" }],
      validar: function () {
        var t = nome.value.trim();
        if (t.length < 2) return "Informe o nome do cliente.";
        if (!escolhido && /^[\d\s().+-]+$/.test(t)) return "Escolha o cliente na lista ou escreva o nome.";
        var d = zap.value.replace(/\D/g, "");
        if (!boxZap.hidden && d && (d.length < 10 || d.length > 13)) return "Confira o WhatsApp: DDD e número.";
        if (!dia.value) return "Escolha o dia.";
        return ate.value <= de.value ? "O \"até\" precisa ser depois do \"de\"." : "";
      },
    }).then(function (r) {
      if (r.valor !== "ok") return;
      var s = servico.value.trim();
      // O tempo do serviço é o do site (o mesmo que o cliente vê ao marcar); sem ele, 30 min
      var tempos = P.temposDosServicos ? P.temposDosServicos(ctx.slug).catch(function () { return {}; }) : Promise.resolve({});
      tempos.then(function (mapa) {
        return api({ acao: "nova", nome: nome.value.trim(), clienteId: escolhido ? escolhido.id : undefined, telefone: boxZap.hidden ? "" : zap.value.trim(), servico: s, duracao: (mapa || {})[s.toLowerCase()] || 30, dia: dia.value, de: de.value, ate: ate.value, profissionalId: prof.value || undefined, observacao: obs.value.trim() });
      })
        .then(function (j) { P.toast(j && j.atualizado ? "Já estava na lista desse dia: atualizado, sem perder a vez." : "Na lista de espera.", "ok"); return carregar(); })
        .catch(function (x) { P.toast(x.message, "erro"); });
    });
  }

  // Depois de cancelar um horário na agenda: quem da lista cabe nele, na ordem, com o WhatsApp pronto
  function oferecerVaga(vaga, candidatos, ctxAgenda) {
    if (!candidatos || !candidatos.length) return Promise.resolve();
    op.ctx = op.ctx || ctxAgenda;
    var v = { dia: vaga.dia, horario: String(vaga.horario).slice(0, 5), profissional: vaga.profissional, profissional_id: vaga.profissional_id, duracao_min: vaga.duracao_min };
    var linhas = candidatos.map(function (e, i) {
      var b = h("button", { type: "button", class: "botao p whats" }, [P.icone("whats"), "Chamar"]);
      b.onclick = function () {
        P.abrirWhats(textoVaga(e, v), e.telefone || "");
        api({ acao: "status", id: e.id, status: "contatado" }).catch(function () {});
        P.trocar(b, [P.icone("check"), "Chamado"]);
        b.classList.remove("whats");
      };
      return h("li", null, [h("span", null, [h("b", { texto: (i + 1) + "º " + e.nome }), h("small", { texto: "pode das " + e.de + " às " + e.ate + " · " + e.servico })]), b]);
    });
    return P.janela({
      titulo: "Vagou um horário: tem gente na lista de espera",
      conteudo: h("div", { class: "grade" }, [
        h("p", { class: "nota", texto: P.dataLonga(v.dia) + " às " + v.horario + (v.profissional ? " com " + v.profissional : "") + ". Chame na ordem: o 1º tem a preferência. A mensagem já vai pronta." }),
        h("ul", { class: "mini-lista zap-lista" }, linhas),
      ]),
      acoes: [{ texto: "Ver a lista", valor: "lista" }, { texto: "Fechar", classe: "principal", valor: "ok" }],
    }).then(function (r) { if (r.valor === "lista") location.hash = "#espera"; });
  }

  window.Espera = { configurar: configurar, montar: montar, carregar: carregar, contar: contar, oferecerVaga: oferecerVaga, _: { textoVaga: textoVaga, textoLista: textoLista, horaPara: horaPara } };
})();
