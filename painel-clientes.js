// Carteira de clientes, usada pelos painéis do dono e do barbeiro (aba Clientes):
// números, segmentos (chamar de volta, 2ª visita, sumidos, aniversariantes), ficha com as visitas,
// cadastro no painel ou pelo celular do cliente (link no WhatsApp ou QR code), importação da planilha,
// campanhas enviadas uma a uma pelo WhatsApp (com quantos voltaram) e exportação.
// O dono vê tudo; o barbeiro vê a própria carteira, sem CPF, importação nem campanhas.
// Usa painel-comum.js (window.Painel) e qr.js (window.QR).
(function () {
  "use strict";
  var P = window.Painel, h = P.h;

  var STATUS = {
    novo: ["Novo", "info"], em_dia: ["Em dia", "ok"], agendado: ["Agendado", "ok"], atrasado: ["Atrasado", "alerta"],
    sumido: ["Sumido", "erro"], perdido: ["Perdido", "neutro"], sem_visita: ["Sem visita", "neutro"],
  };
  var SEGMENTOS = [["", "Todos"], ["chamar", "Chamar de volta"], ["segunda", "2ª visita"], ["sumidos", "Sumidos"], ["aniversario", "Aniversariantes"]];
  var EXPLICA = {
    chamar: "Passaram do ritmo de cada um: quem corta a cada 15 dias entra aqui no dia 23; quem corta a cada 30, no dia 45.",
    segunda: "Vieram uma vez, há 3 semanas ou mais, e ainda não voltaram. É na segunda visita que mais se perde cliente.",
    sumidos: "Não voltam há muito tempo. Uma oferta para voltar costuma funcionar melhor que um lembrete.",
    aniversario: "Fazem aniversário este mês. Uma mensagem no dia, com um mimo, traz o cliente de volta.",
  };
  var MODELOS = {
    chamar: "Olá, {nome}! Já faz {dias} dias do seu último corte aqui na {barbearia}. Bora deixar o visual em dia? Agende pelo link: {site}",
    segunda: "Olá, {nome}! Obrigado por ter vindo à {barbearia}. Quando quiser voltar, é só agendar pelo link: {site}",
    sumidos: "Olá, {nome}! Sentimos sua falta aqui na {barbearia}. Que tal voltar esta semana? Agende pelo link: {site}",
    aniversario: "Feliz aniversário, {nome}! 🎉 A {barbearia} deseja um ótimo dia. Passe aqui para comemorar de visual novo: {site}",
    "": "Olá, {nome}! Novidade na {barbearia}: ... Agende pelo link: {site}",
  };
  var ORIGEM = { painel: "cadastrado no painel", importacao: "veio da planilha", site: "agendou pelo site", convite: "se cadastrou pelo link" };
  var LOTE = 60;

  var op = {}, raiz = null, dados = null, seg = "", busca = "", limite = LOTE, campanhasCache = null;
  var el = {};

  function api(corpo) { return P.api("/api/equipe?area=clientes", corpo ? { corpo: corpo } : undefined); }
  function whatsBr(n) { n = String(n || ""); return n.length === 11 ? "(" + n.slice(0, 2) + ") " + n.slice(2, 7) + "-" + n.slice(7) : n.length === 10 ? "(" + n.slice(0, 2) + ") " + n.slice(2, 6) + "-" + n.slice(6) : n; }
  function dataBrAno(iso) { if (!iso) return ""; var p = String(iso).slice(0, 10).split("-"); return p[0] === "1904" ? p[2] + "/" + p[1] : p[2] + "/" + p[1] + "/" + p[0]; }
  function abrirLink(url) { var a = h("a", { href: url, target: "_blank", rel: "noopener" }); document.body.appendChild(a); a.click(); a.remove(); }
  function linkZap(tel, msg) { return "https://wa.me/55" + String(tel || "").replace(/\D/g, "") + "?text=" + encodeURIComponent(msg); }
  function preencher(modelo, c) {
    return String(modelo || "")
      .split("{nome}").join(P.primeiroNome(c.nome))
      .split("{dias}").join(c.diasSem != null ? String(c.diasSem) : "alguns")
      .split("{barbearia}").join(op.barbearia || "barbearia")
      .split("{site}").join(op.site || "");
  }
  // Mensagem sugerida para o cliente, conforme a situação dele
  function sugestao(c) {
    if (c.aniversario && c.aniversario.diasAte <= 1) return preencher(MODELOS.aniversario, c);
    if (c.status === "atrasado") return preencher(MODELOS.chamar, c);
    if (c.status === "sumido" || c.status === "perdido") return preencher(MODELOS.sumidos, c);
    if (c.visitas === 1 && c.status !== "agendado") return preencher(MODELOS.segunda, c);
    return "Olá, " + P.primeiroNome(c.nome) + "! Aqui é da " + (op.barbearia || "barbearia") + ".";
  }
  function kpi(rotulo, valor, detalhe) { return h("div", { class: "kpi" }, [h("span", { texto: rotulo }), h("b", { texto: valor }), detalhe ? h("small", { texto: detalhe }) : null]); }

  // Janela com conteúdo que muda (passos), no mesmo estilo do P.janela
  function janela(titulo, conteudo, acoes) {
    var d = h("dialog", { class: "dlg", "aria-label": titulo });
    var corpo = h("div", { class: "grade" }, conteudo);
    var rodape = h("div", { class: "dlg-acoes" });
    var form = h("form", { method: "dialog", class: "dlg-corpo" }, [
      h("div", { class: "dlg-topo" }, [h("h2", { texto: titulo }), h("button", { type: "button", class: "icone", "aria-label": "Fechar", onclick: function () { d.close(""); } }, P.icone("x"))]),
      corpo, rodape,
    ]);
    form.addEventListener("submit", function (ev) { ev.preventDefault(); });
    d.appendChild(form);
    d.addEventListener("close", function () { setTimeout(function () { d.remove(); }, 300); });
    document.body.appendChild(d);
    d.showModal();
    var j = {
      corpo: corpo,
      fechar: function () { d.close(""); },
      trocar: function (c) { P.trocar(corpo, c); },
      acoes: function (lista) {
        P.trocar(rodape, (lista || []).map(function (a) {
          var b = h("button", { type: "button", class: "botao " + (a.classe || "") }, a.icone ? [P.icone(a.icone), a.texto] : a.texto);
          b.onclick = function () { a.fn(b); };
          return b;
        }));
      },
      aoFechar: function (fn) { d.addEventListener("close", fn); },
    };
    j.acoes(acoes || [{ texto: "Fechar", fn: j.fechar }]);
    return j;
  }

  // ---------- tela ----------
  // configurar: logo que o painel sabe quem é (dono, nome da barbearia, link do site); montar: ao abrir a aba
  function configurar(opcoes) { op = opcoes || {}; }
  function montar(alvo) {
    raiz = alvo;
    el.kpis = h("div", { class: "kpis larga" }, [h("div", { class: "esqueleto" }), h("div", { class: "esqueleto" }), h("div", { class: "esqueleto" }), h("div", { class: "esqueleto" })]);
    el.qtd = h("span", { class: "contador", texto: "0" });
    el.seg = h("div", { class: "segmentos" });
    el.faixa = h("div");
    el.busca = h("input", { type: "search", class: "busca-painel", placeholder: "Buscar por nome ou WhatsApp", "aria-label": "Buscar cliente" });
    el.busca.oninput = function () { busca = el.busca.value.trim().toLowerCase(); limite = LOTE; desenharLista(); };
    el.lista = h("div", { class: "lista" }, h("div", { class: "esqueleto" }));
    el.mais = h("button", { type: "button", class: "botao p", hidden: true, texto: "Mostrar mais" });
    el.mais.onclick = function () { limite += LOTE; desenharLista(); };
    var bNovo = h("button", { type: "button", class: "botao p principal" }, [P.icone("mais_um"), "Novo cliente"]);
    bNovo.onclick = function () { formulario(null); };
    var bConvite = h("button", { type: "button", class: "botao p" }, [P.icone("qr"), "Cadastro pelo celular"]);
    bConvite.onclick = function () { convite({}); };
    var ferramentas = [bConvite];
    if (op.dono) {
      var bImportar = h("button", { type: "button", class: "botao p" }, [P.icone("enviar"), "Importar planilha"]);
      bImportar.onclick = importar;
      var bExportar = h("button", { type: "button", class: "botao p" }, [P.icone("baixar"), "Exportar"]);
      bExportar.onclick = exportar;
      ferramentas.push(bImportar, bExportar);
    }
    el.campanhas = h("div", { class: "lista" });
    var colunaDireita = [
      op.dono ? h("section", { class: "cartao" }, [
        h("div", { class: "cartao-topo" }, [h("h2", { texto: "Campanhas" })]),
        h("p", { class: "nota p", texto: "Escolha um grupo à esquerda e toque em \"Mandar mensagem\". O painel abre o WhatsApp de cada cliente com a mensagem pronta e, depois, mostra quantos voltaram em até 30 dias." }),
        el.campanhas,
      ]) : null,
      op.extra || null,
      h("section", { class: "cartao" }, [
        h("div", { class: "cartao-topo" }, [h("h2", { texto: "Como funciona" })]),
        h("ul", { class: "mini-lista passos" }, [
          h("li", { texto: "Quem agenda pelo site informando o WhatsApp entra aqui sozinho, com o histórico de visitas." }),
          h("li", { texto: "Depois do primeiro corte, toque em \"Cadastrar\" no atendimento: o cliente preenche os dados no próprio celular e aceita (ou não) receber novidades." }),
          h("li", { texto: "O painel aprende o ritmo de cada cliente e avisa quem passou do tempo de voltar." }),
          op.dono ? h("li", { texto: "Já tem uma lista? Importe a planilha com nome, WhatsApp, CPF e nascimento." }) : null,
        ]),
      ]),
    ];
    P.trocar(raiz, [
      el.kpis,
      h("div", { class: "coluna" }, [
        h("section", { class: "cartao" }, [
          h("div", { class: "cartao-topo" }, [h("h2", null, [op.dono ? "Clientes " : "Meus clientes ", el.qtd]), bNovo]),
          h("div", { class: "linha ferramentas" }, ferramentas),
          el.seg, el.faixa, el.busca, el.lista, el.mais,
        ]),
      ]),
      h("div", { class: "coluna" }, colunaDireita),
    ]);
  }

  // Sem a aba montada (cadastro feito pela agenda), só atualiza os dados guardados
  function carregar() {
    return api().then(function (j) { dados = j; if (raiz) desenhar(); if (op.aoCarregar) op.aoCarregar(j); }).catch(function (e) { P.toast(e.message, "erro"); });
  }

  function desenhar() {
    var k = dados.kpis;
    P.trocar(el.kpis, [
      kpi(op.dono ? "Clientes" : "Meus clientes", String(k.total), k.comWhats + " com WhatsApp"),
      kpi("Ativos", String(k.ativos), "em dia ou com horário"),
      kpi("Para chamar", String(dados.segmentos.chamar + dados.segmentos.segunda), dados.segmentos.chamar + " atrasados · " + dados.segmentos.segunda + " sem 2ª visita"),
      kpi("Voltaram", k.taxaSegundaVisita == null ? "—" : k.taxaSegundaVisita + "%", k.taxaSegundaVisita == null ? "aparece com 5 clientes novos" : "dos novos voltaram"),
    ]);
    el.qtd.textContent = k.total;
    P.trocar(el.seg, SEGMENTOS.map(function (s) {
      var n = s[0] ? dados.segmentos[s[0]] : k.total;
      var b = h("button", { type: "button", class: "botao p" + (seg === s[0] ? " principal" : ""), "aria-pressed": seg === s[0] ? "true" : "false" }, [s[1], h("span", { class: "n", texto: String(n) })]);
      b.onclick = function () { seg = s[0]; limite = LOTE; desenhar(); };
      return b;
    }));
    desenharLista();
    if (op.dono) carregarCampanhas();
  }

  function filtrados() {
    var digitos = busca.replace(/\D/g, "");
    return dados.clientes.filter(function (c) {
      if (seg && c.segmentos.indexOf(seg) < 0) return false;
      if (!busca) return true;
      return c.nome.toLowerCase().indexOf(busca) > -1 || (digitos.length >= 3 && c.telefone.indexOf(digitos) > -1);
    }).sort(function (a, b) {
      if (seg === "aniversario") return a.aniversario.diasAte - b.aniversario.diasAte;
      if (seg) return (b.diasSem || 0) - (a.diasSem || 0) || a.nome.localeCompare(b.nome, "pt-BR");
      return a.nome.localeCompare(b.nome, "pt-BR");
    });
  }

  function desenharLista() {
    var lista = filtrados();
    // Faixa do segmento: explicação e, para o dono, a campanha para o grupo
    var faixa = null;
    if (seg) {
      var comZap = lista.filter(function (c) { return c.telefone && !c.saiu; });
      var acoes = [h("span", { texto: EXPLICA[seg] })];
      if (op.dono && comZap.length) {
        var b = h("button", { type: "button", class: "botao p whats" }, [P.icone("whats"), "Mandar mensagem (" + comZap.length + ")"]);
        b.onclick = function () { campanha(seg, comZap); };
        acoes.push(b);
      }
      faixa = h("div", { class: "aviso-faixa info" }, acoes);
    }
    P.trocar(el.faixa, faixa);
    var vazio = !dados.clientes.length
      ? P.vazio("👥", op.dono ? "Nenhum cliente ainda. Cadastre, importe a planilha ou peça o WhatsApp no agendamento do site." : "Nenhum cliente na sua carteira ainda. Toque em Cadastrar nos seus atendimentos.")
      : P.vazio("🔎", seg ? "Ninguém neste grupo agora." : "Ninguém encontrado com essa busca.");
    P.trocar(el.lista, lista.length ? lista.slice(0, limite).map(cartao) : vazio);
    el.mais.hidden = lista.length <= limite;
  }

  function linhaRetorno(c) {
    if (c.status === "agendado") return "Volta " + P.diaCurto(c.proximo) + (c.diasSem != null ? " · última visita há " + c.diasSem + " dias" : "");
    if (!c.ultima) return "Ainda sem visita registrada";
    var t = "Última visita há " + c.diasSem + (c.diasSem === 1 ? " dia" : " dias") + (c.visitas ? "" : " (antes do Bio Site)");
    if (c.ciclo) t += " · costuma voltar a cada " + c.ciclo + " dias";
    return t;
  }

  function cartao(c) {
    var s = STATUS[c.status] || [c.status, "neutro"];
    var selos = [h("span", { class: "selo selo-" + s[1], texto: s[0] })];
    if (c.aniversario && c.aniversario.diasAte <= 7) selos.unshift(h("span", { class: "selo selo-clube", texto: c.aniversario.diasAte === 0 ? "🎂 Hoje" : "🎂 " + c.aniversario.dia }));
    var det = [c.telefone ? whatsBr(c.telefone) : "sem WhatsApp"];
    if (c.aniversario) det.push("aniversário " + c.aniversario.dia);
    var uso = [c.visitas ? c.visitas + (c.visitas === 1 ? " visita" : " visitas") : "nenhuma visita pelo Bio Site"];
    if (c.ticket) uso.push("ticket " + P.brl(c.ticket));
    if (c.barbeiro && op.dono) uso.push("com " + c.barbeiro);
    var bZap = c.telefone ? h("button", { type: "button", class: "botao p whats" }, [P.icone("whats"), "WhatsApp"]) : null;
    if (bZap) bZap.onclick = function () { abrirLink(linkZap(c.telefone, sugestao(c))); };
    var bFicha = h("button", { type: "button", class: "botao p" }, [P.icone("perfil"), "Ficha"]);
    bFicha.onclick = function () { ficha(c.id); };
    return h("div", { class: "cliente" }, [
      h("div", { class: "assinante-topo" }, [
        h("div", { class: "cresce" }, [h("div", { class: "nome", texto: c.nome }), h("div", { class: "det", texto: det.join(" · ") })]),
        h("span", { class: "selos" }, selos),
      ]),
      h("p", { class: "nota p", texto: linhaRetorno(c) }),
      h("p", { class: "nota p", texto: uso.join(" · ") + (c.saiu ? " · pediu para não receber mensagens" : c.aceita ? " · aceita novidades" : "") }),
      h("div", { class: "linha" }, [bZap, bFicha]),
    ]);
  }

  // ---------- ficha ----------
  function ficha(id) {
    P.api("/api/equipe?area=clientes&id=" + id).then(function (f) {
      var c = f.cliente;
      var resumo = (dados && dados.clientes.filter(function (x) { return x.id === id; })[0]) || {};
      var linhas = [
        ["WhatsApp", c.telefone ? whatsBr(c.telefone) : "—"],
        ["Aniversário", c.nascimento ? dataBrAno(c.nascimento) : c.aniversario || "—"],
        op.dono ? ["CPF", c.cpfMascarado || "—"] : null,
        ["Retorno", resumo.status ? (STATUS[resumo.status] || [resumo.status])[0] + " · " + linhaRetorno(resumo) : "—"],
        ["Novidades", c.saiu_em ? "Pediu para não receber (" + P.dataBr(String(c.saiu_em).slice(0, 10)) + ")" : c.aceita ? "Aceitou em " + P.dataBr(String(c.aceite_em || c.criado_em).slice(0, 10)) + (c.aceite_origem ? " (" + (ORIGEM[c.aceite_origem] || c.aceite_origem).replace(/^se /, "") + ")" : "") : "Ainda não aceitou"],
        ["Origem", ORIGEM[c.origem] || c.origem],
        c.ultima_visita_externa ? ["Antes do Bio Site", "última visita em " + dataBrAno(c.ultima_visita_externa)] : null,
      ].filter(Boolean);
      var visitas = f.visitas.length ? h("ul", { class: "mini-lista visitas" }, f.visitas.slice(0, 30).map(function (v) {
        var st = (P.STATUS && P.STATUS[v.status]) || [v.status];
        return h("li", null, [
          h("span", null, [h("b", { texto: P.dataBr(v.dia) + "/" + v.dia.slice(2, 4) + " · " + v.servico }), h("small", { texto: (v.profissional ? "com " + v.profissional + " · " : "") + st[0] })]),
          h("b", { texto: v.valor == null ? "—" : P.brl(v.valor) }),
        ]);
      })) : h("p", { class: "nota p", texto: "Nenhum atendimento ligado a este cliente ainda." });
      var conteudo = [
        h("dl", { class: "ficha-dados" }, linhas.map(function (l) { return h("div", null, [h("dt", { texto: l[0] }), h("dd", { texto: l[1] })]); })),
        c.observacao ? h("p", { class: "obs", texto: c.observacao }) : null,
        h("h3", { class: "sub-titulo", texto: "Visitas" }),
        visitas,
        f.campanhas.length ? h("p", { class: "nota p", texto: "Campanhas recebidas: " + f.campanhas.map(function (x) { return x.nome + " (" + P.dataBr(String(x.enviado_em).slice(0, 10)) + ")"; }).join(", ") }) : null,
      ];
      var j = janela(c.nome, conteudo);
      var acoes = [];
      if (op.dono) acoes.push({ texto: "Apagar dados", classe: "perigo", icone: "lixo", fn: function () { j.fechar(); apagar(c); } });
      acoes.push({ texto: "Editar", icone: "lapis", fn: function () { j.fechar(); formulario(c); } });
      if (c.telefone) acoes.push({ texto: "WhatsApp", classe: "whats", icone: "whats", fn: function () { abrirLink(linkZap(c.telefone, sugestao(Object.assign({}, resumo, c)))); } });
      j.acoes(acoes);
    }).catch(function (e) { P.toast(e.message, "erro"); });
  }

  function apagar(c) {
    P.confirmar("Apagar os dados de " + c.nome + "?", "Use quando o cliente pedir (LGPD). O cadastro some para sempre; os atendimentos continuam no financeiro, sem o nome ligado ao cadastro.", "Apagar para sempre", true).then(function (ok) {
      if (!ok) return;
      api({ acao: "apagar", id: c.id }).then(function () { P.toast("Dados apagados.", "ok"); carregar(); }).catch(function (e) { P.toast(e.message, "erro"); });
    });
  }

  // ---------- cadastro no painel ----------
  function formulario(c, extra, rascunho) {
    extra = extra || {};
    var v = rascunho || (c ? { nome: c.nome, telefone: whatsBr(c.telefone), nascimento: c.nascimento ? dataBrAno(c.nascimento) : "", cpf: c.cpf || "", observacao: c.observacao || "", aceita: !!c.aceita, profissional_id: c.profissional_id || "" }
      : { nome: extra.nome || "", telefone: extra.telefone || "", nascimento: "", cpf: "", observacao: "", aceita: false, profissional_id: "" });
    var nome = h("input", { maxlength: "80", autocomplete: "off", value: v.nome });
    var tel = h("input", { type: "tel", inputmode: "tel", maxlength: "20", placeholder: "(00) 00000-0000", value: v.telefone });
    var nasc = h("input", { inputmode: "numeric", maxlength: "10", placeholder: "dd/mm/aaaa", value: v.nascimento });
    // Barbeiro editando quem já tem aniversário: só mostra o dia e o mês (o dono cuida da data completa)
    var nascFixo = !op.dono && c && c.aniversario ? h("p", { class: "nota p", texto: "Aniversário: " + c.aniversario }) : null;
    var cpf = op.dono ? h("input", { inputmode: "numeric", maxlength: "14", placeholder: "Opcional", value: v.cpf }) : null;
    var obs = h("input", { maxlength: "300", placeholder: "Ex.: prefere máquina 2 nas laterais", value: v.observacao });
    var aceita = op.dono ? h("input", { type: "checkbox", checked: v.aceita }) : null;
    var barbeiro = op.dono && dados && dados.equipe.length ? h("select", null, [h("option", { value: "", texto: "Ninguém em especial" })].concat(dados.equipe.map(function (e) { return h("option", { value: e.id, selected: e.id === v.profissional_id, texto: e.nome }); }))) : null;
    function lido() {
      return { nome: nome.value.trim(), telefone: tel.value.trim(), nascimento: nasc.value.trim(), cpf: cpf ? cpf.value.trim() : "", observacao: obs.value.trim(), aceita: aceita ? aceita.checked : false, profissional_id: barbeiro ? barbeiro.value : "" };
    }
    P.janela({
      titulo: c ? "Editar cliente" : "Novo cliente",
      conteudo: h("div", { class: "grade" }, [
        h("label", { class: "campo" }, ["Nome", nome]),
        nascFixo ? h("label", { class: "campo" }, ["WhatsApp", tel]) : h("div", { class: "grade d2" }, [h("label", { class: "campo" }, ["WhatsApp", tel]), h("label", { class: "campo" }, ["Nascimento", nasc])]),
        nascFixo,
        cpf ? h("label", { class: "campo" }, ["CPF (opcional)", cpf]) : null,
        cpf ? h("p", { class: "nota p", texto: "Serve só para identificar o cliente. Pela LGPD, não condicione desconto ao CPF." }) : null,
        h("label", { class: "campo" }, ["Observação", obs]),
        barbeiro ? h("label", { class: "campo" }, ["Barbeiro de referência", barbeiro]) : null,
        aceita ? h("label", { class: "check-linha" }, [aceita, "O cliente aceitou receber promoções e novidades pelo WhatsApp"]) : null,
        aceita ? h("p", { class: "nota p", texto: "Marque só se ele disse que sim. Fica registrado quando e por onde ele aceitou. Desmarcar conta como pedido para sair." }) : null,
      ]),
      acoes: [{ texto: "Voltar", valor: "cancelar" }, { texto: c ? "Salvar" : "Cadastrar", classe: "principal", valor: "ok" }],
      validar: function () {
        var x = lido();
        if (x.nome.length < 2) return "Informe o nome do cliente.";
        var d = x.telefone.replace(/\D/g, "");
        if (d && (d.length < 10 || d.length > 13)) return "Confira o WhatsApp: DDD e número.";
        return "";
      },
    }).then(function (r) {
      if (r.valor !== "ok") return;
      var x = lido();
      var corpo = { acao: "salvar", id: c ? c.id : undefined, nome: x.nome, telefone: x.telefone, nascimento: x.nascimento, observacao: x.observacao, pedidoId: extra.pedidoId };
      if (op.dono) { corpo.cpf = x.cpf; corpo.aceita = x.aceita; corpo.profissional_id = x.profissional_id; }
      api(corpo).then(function () {
        P.toast(c ? "Cliente salvo." : "Cliente cadastrado." + (extra.pedidoId ? " O atendimento já ficou ligado a ele." : ""), "ok");
        carregar();
        if (extra.aoSalvar) extra.aoSalvar();
      }).catch(function (e) { P.toast(e.message, "erro"); formulario(c, extra, x); });
    });
  }

  // ---------- cadastro pelo celular do cliente (link ou QR code) ----------
  // extra: { pedidoId, nome, telefone, aoUsar }
  function convite(extra) {
    extra = extra || {};
    var tel = h("input", { type: "tel", inputmode: "tel", maxlength: "20", placeholder: "(00) 00000-0000", value: extra.telefone ? whatsBr(extra.telefone) : "" });
    var j = janela("Cadastro pelo celular do cliente", []);
    function inicio() {
      j.trocar([
        h("p", { class: "nota", texto: "O cliente preenche os próprios dados (nome, WhatsApp, nascimento e, se quiser, CPF) e aceita ou não receber promoções. Conte que, cadastrado, ele não perde as novidades da casa." }),
        h("label", { class: "campo" }, ["WhatsApp do cliente", tel]),
        h("p", { class: "nota p", texto: "O link vale " + 3 + " dias e serve para um cadastro." }),
      ]);
      j.acoes([
        { texto: "Mostrar QR code", icone: "qr", fn: function (b) { gerar(b, "qr"); } },
        { texto: "Mandar pelo WhatsApp", classe: "whats", icone: "whats", fn: function (b) { gerar(b, "whats"); } },
      ]);
    }
    function gerar(botao, modo) {
      var d = tel.value.replace(/\D/g, "");
      if (modo === "whats" && (d.length < 10 || d.length > 13)) { P.toast("Informe o WhatsApp do cliente com DDD.", "erro"); tel.focus(); return; }
      P.acao(botao, api({ acao: "convite", pedidoId: extra.pedidoId, nome: extra.nome, telefone: d ? tel.value : "" }).then(function (r) {
        var nome = P.primeiroNome(extra.nome || "");
        var msg = "Olá" + (nome ? ", " + nome : "") + "! Para completar seu cadastro na " + (op.barbearia || "barbearia") + " e não perder as promoções e novidades, toque no link (leva menos de 1 minuto): " + r.link;
        if (modo === "whats") {
          abrirLink(linkZap(r.telefone, msg));
          j.fechar();
          P.toast("Link enviado. Quando o cliente preencher, o cadastro aparece aqui.", "ok");
          return;
        }
        mostrarQr(r);
      })).catch(function (e) { P.toast(e.message, "erro"); });
    }
    function mostrarQr(r) {
      var caixa = h("div", { class: "qr-caixa" });
      try { caixa.innerHTML = window.QR.svg(r.link, { rotulo: "QR code do cadastro" }); } catch (e) { caixa.textContent = "Não deu para desenhar o QR code. Use o link abaixo."; }
      j.trocar([
        h("p", { class: "nota", texto: "Peça para o cliente apontar a câmera do celular para o código." }),
        caixa,
        h("p", { class: "obs link-convite", texto: r.link }),
        h("p", { class: "nota p", texto: "Vale até " + P.dataBr(String(r.expiraEm).slice(0, 10)) + ". Quando ele terminar, toque em Pronto para atualizar a lista." }),
      ]);
      j.acoes([
        { texto: "Copiar link", icone: "copiar", fn: function () { P.copiar(r.link, "Link copiado."); } },
        { texto: "Pronto", classe: "principal", fn: function () { j.fechar(); carregar(); if (extra.aoUsar) extra.aoUsar(); } },
      ]);
    }
    inicio();
  }

  // ---------- a partir de um atendimento (cartão da agenda) ----------
  function cadastrarDoAtendimento(p, ctx) {
    var j = janela("Cadastrar " + P.primeiroNome(p.cliente), [
      h("p", { class: "nota", texto: "Peça os dados agora, no balcão, e conte que cadastrado ele não perde as promoções e novidades." }),
    ]);
    function recarregar() { if (ctx && ctx.recarregar) ctx.recarregar(); }
    var opcoes = h("div", { class: "menu opcoes-cadastro" }, [
      opcao("qr", "Pelo celular dele", "Mostra um QR code ou manda o link no WhatsApp. Ele mesmo preenche.", function () { j.fechar(); convite({ pedidoId: p.id, nome: p.cliente, aoUsar: recarregar }); }),
      opcao("lapis", "Preencher agora", "Você digita os dados que ele passar.", function () { j.fechar(); garantirDados().then(function () { formulario(null, { pedidoId: p.id, nome: p.cliente, aoSalvar: recarregar }); }); }),
      opcao("perfil", "Já tem cadastro", "Liga este atendimento ao cadastro que já existe.", function () { j.fechar(); escolherExistente(p, recarregar); }),
    ]);
    j.corpo.appendChild(opcoes);
  }
  function opcao(icone, titulo, texto, fn) {
    var b = h("button", { type: "button", class: "opcao" }, [P.icone(icone), h("span", null, [h("b", { texto: titulo }), h("small", { texto: texto })])]);
    b.onclick = fn;
    return b;
  }
  function garantirDados() { return dados ? Promise.resolve(dados) : api().then(function (j) { dados = j; return j; }); }

  function escolherExistente(p, aoLigar) {
    var campo = h("input", { type: "search", class: "busca-painel", placeholder: "Nome ou WhatsApp", value: P.primeiroNome(p.cliente) });
    var lista = h("div", { class: "lista" }, h("div", { class: "esqueleto" }));
    var j = janela("Ligar a um cadastro", [campo, lista]);
    function desenhar() {
      var t = campo.value.trim().toLowerCase(), dig = t.replace(/\D/g, "");
      var achados = (dados ? dados.clientes : []).filter(function (c) { return !t || c.nome.toLowerCase().indexOf(t) > -1 || (dig.length >= 3 && c.telefone.indexOf(dig) > -1); }).slice(0, 8);
      P.trocar(lista, achados.length ? achados.map(function (c) {
        var b = opcao("perfil", c.nome, (c.telefone ? whatsBr(c.telefone) : "sem WhatsApp") + " · " + c.visitas + (c.visitas === 1 ? " visita" : " visitas"), function () {
          api({ acao: "vincular", pedidoId: p.id, clienteId: c.id }).then(function () { j.fechar(); P.toast("Atendimento ligado a " + c.nome + ".", "ok"); if (aoLigar) aoLigar(); carregar(); }).catch(function (e) { P.toast(e.message, "erro"); });
        });
        return b;
      }) : P.vazio("🔎", "Ninguém encontrado. Volte e use \"Pelo celular dele\" ou \"Preencher agora\"."));
    }
    campo.oninput = desenhar;
    garantirDados().then(desenhar).catch(function (e) { P.toast(e.message, "erro"); });
  }

  // ---------- importação da planilha ----------
  var COLUNAS = [
    ["nome", /^(nome|cliente|nome completo|nome do cliente|name)$/],
    ["telefone", /^(whats ?app|telefone|celular|fone|contato|tel|telefone celular|numero|phone)$/],
    ["cpf", /^(cpf|cpf do cliente)$/],
    ["nascimento", /^(nascimento|data de nascimento|data nascimento|dt nascimento|aniversario|nasc)$/],
    ["observacao", /^(observacao|observacoes|obs|notas|anotacoes)$/],
    ["ultima_visita", /^(ultima visita|data da ultima visita|ultimo atendimento|ultimo corte|ultima vez)$/],
  ];
  var ROTULO_COLUNA = { nome: "Nome", telefone: "WhatsApp", cpf: "CPF", nascimento: "Nascimento", observacao: "Observação", ultima_visita: "Última visita" };
  function semAcento(t) { return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim(); }
  // Texto colado do Excel/Google (tabulação) ou CSV (; ou ,), com aspas
  function lerTabela(texto) {
    texto = String(texto || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
    if (!texto) return [];
    var primeira = texto.split("\n")[0];
    var sep = primeira.indexOf("\t") > -1 ? "\t" : primeira.indexOf(";") > -1 ? ";" : ",";
    var linhas = [], linha = [], campo = "", aspas = false;
    for (var i = 0; i < texto.length; i++) {
      var ch = texto[i];
      if (aspas) {
        if (ch === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += ch;
      } else if (ch === '"' && campo === "") aspas = true;
      else if (ch === sep) { linha.push(campo); campo = ""; }
      else if (ch === "\n") { linha.push(campo); linhas.push(linha); linha = []; campo = ""; }
      else campo += ch;
    }
    linha.push(campo);
    linhas.push(linha);
    return linhas.filter(function (l) { return l.some(function (c) { return String(c).trim(); }); });
  }
  function mapear(linhas) {
    var cab = (linhas[0] || []).map(semAcento), mapa = {};
    cab.forEach(function (t, i) { COLUNAS.forEach(function (c) { if (!(c[0] in mapa) && c[1].test(t)) mapa[c[0]] = i; }); });
    return mapa;
  }
  function importar() {
    var area = h("textarea", { rows: "7", class: "colar", placeholder: "Nome\tWhatsApp\tCPF\tNascimento\nJoão Silva\t(81) 99999-0000\t\t20/05/1990" });
    var arquivo = h("input", { type: "file", accept: ".csv,.txt,text/csv,text/plain" });
    var modelo = h("button", { type: "button", class: "botao mini" }, [P.icone("baixar"), "Baixar modelo"]);
    modelo.onclick = function () { P.baixarCsv("modelo-clientes.csv", [["Nome", "WhatsApp", "CPF", "Nascimento", "Observação", "Última visita"], ["João da Silva", "(81) 99999-0000", "", "20/05/1990", "Prefere máquina 2", "02/11/2026"]]); };
    arquivo.onchange = function () {
      var f = arquivo.files && arquivo.files[0];
      if (!f) return;
      if (f.size > 2 * 1024 * 1024) { P.toast("Arquivo grande demais (máximo 2 MB).", "erro"); return; }
      var leitor = new FileReader();
      leitor.onload = function () { area.value = String(leitor.result || ""); };
      leitor.readAsText(f, "utf-8");
    };
    var j = janela("Importar clientes", []);
    var linhasLidas = [];
    function passo1() {
      j.trocar([
        h("p", { class: "nota", texto: "Abra sua planilha (Excel ou Google), selecione as colunas com os títulos, copie e cole aqui. Ou envie um arquivo CSV." }),
        area,
        h("div", { class: "linha" }, [h("label", { class: "botao mini arquivo" }, [P.icone("enviar"), "Enviar CSV", arquivo]), modelo]),
        h("p", { class: "nota p", texto: "Colunas aceitas: Nome (obrigatória), WhatsApp, CPF, Nascimento, Observação e Última visita. O painel confere tudo antes de gravar e não repete quem já está cadastrado." }),
      ]);
      j.acoes([{ texto: "Voltar", fn: j.fechar }, { texto: "Conferir", classe: "principal", fn: conferir }]);
    }
    function conferir(botao) {
      var tabela = lerTabela(area.value);
      if (tabela.length < 2) { P.toast("Cole as linhas da planilha, com a linha dos títulos.", "erro"); return; }
      var mapa = mapear(tabela);
      if (!("nome" in mapa)) { P.toast("Não achei a coluna Nome. A primeira linha precisa ter os títulos (Nome, WhatsApp, CPF, Nascimento).", "erro"); return; }
      linhasLidas = tabela.slice(1).map(function (l) {
        var o = {};
        Object.keys(mapa).forEach(function (k) { o[k] = String(l[mapa[k]] == null ? "" : l[mapa[k]]).trim(); });
        return o;
      });
      if (linhasLidas.length > 2000) { P.toast("Importe no máximo 2.000 clientes por vez.", "erro"); return; }
      P.acao(botao, api({ acao: "importar", simular: true, linhas: linhasLidas }).then(function (r) { passo2(r, mapa); })).catch(function (e) { P.toast(e.message, "erro"); });
    }
    var aceitaram = h("input", { type: "checkbox" });
    function passo2(r, mapa) {
      var cols = Object.keys(mapa).map(function (k) { return ROTULO_COLUNA[k]; }).join(" · ");
      j.trocar([
        h("p", { class: "nota", texto: "Colunas encontradas: " + cols + "." }),
        h("div", { class: "kpis", style: "grid-template-columns:repeat(3,minmax(0,1fr))" }, [kpi("Novos", String(r.inseridos)), kpi("Completados", String(r.atualizados), "já existiam"), kpi("De fora", String(r.totalIgnorados))]),
        r.ignorados.length ? h("ul", { class: "mini-lista ignorados" }, r.ignorados.slice(0, 8).map(function (x) { return h("li", null, [h("span", { texto: "Linha " + (x.linha + 1) + (x.nome ? " · " + x.nome : "") }), h("small", { texto: x.motivo })]); })) : null,
        r.totalIgnorados > 8 ? h("p", { class: "nota p", texto: "E mais " + (r.totalIgnorados - 8) + ". Corrija na planilha e importe de novo: quem já entrou não se repete." }) : null,
        h("label", { class: "check-linha" }, [aceitaram, "Estes clientes aceitaram receber promoções e novidades da barbearia"]),
        h("p", { class: "nota p", texto: "Marque só se eles deram esse aceite (por exemplo, numa ficha de cadastro). Sem aceite, eles ficam na carteira, mas fora das campanhas de promoção." }),
      ]);
      j.acoes([{ texto: "Voltar", fn: passo1 }, { texto: "Importar " + (r.inseridos + r.atualizados), classe: "principal", fn: function (b) { gravar(b); } }]);
      if (!(r.inseridos + r.atualizados)) j.acoes([{ texto: "Voltar", fn: passo1 }]);
    }
    function gravar(botao) {
      P.acao(botao, api({ acao: "importar", linhas: linhasLidas, aceitaram: aceitaram.checked }).then(function (r) {
        j.trocar([
          h("p", { class: "nota", texto: "Pronto! " + r.inseridos + (r.inseridos === 1 ? " cliente cadastrado" : " clientes cadastrados") + (r.atualizados ? " e " + r.atualizados + " completados" : "") + "." + (r.totalIgnorados ? " " + r.totalIgnorados + " ficaram de fora." : "") }),
        ]);
        j.acoes([{ texto: "Fechar", classe: "principal", fn: j.fechar }]);
        carregar();
      })).catch(function (e) { P.toast(e.message, "erro"); });
    }
    passo1();
  }

  // ---------- exportação ----------
  function limparVcf(t) { return String(t || "").replace(/[\r\n;,\\]/g, " ").trim(); }
  function exportar() {
    if (!dados || !dados.clientes.length) { P.toast("Ainda não há clientes para exportar."); return; }
    var j = janela("Exportar clientes", [
      h("div", { class: "menu opcoes-cadastro" }, [
        opcao("baixar", "Planilha (CSV)", "Abre no Excel e no Google Planilhas.", function () {
          P.baixarCsv("clientes.csv", [["Nome", "WhatsApp", "Aniversário", "Situação", "Última visita", "Visitas", "Ticket médio", "Aceita novidades"]].concat(dados.clientes.map(function (c) {
            return [c.nome, whatsBr(c.telefone), c.aniversario ? c.aniversario.dia : "", (STATUS[c.status] || [c.status])[0], c.ultima ? P.dataBr(c.ultima) + "/" + c.ultima.slice(0, 4) : "", c.visitas, c.ticket ? String(c.ticket).replace(".", ",") : "", c.aceita ? "sim" : "não"];
          })));
          j.fechar();
        }),
        opcao("perfil", "Contatos para o celular (vCard)", "Salva os clientes na agenda do celular, para usar nas listas de transmissão do WhatsApp.", function () {
          var vcf = dados.clientes.filter(function (c) { return c.telefone && !c.saiu; }).map(function (c) {
            return ["BEGIN:VCARD", "VERSION:3.0", "FN:" + limparVcf(c.nome), "N:" + limparVcf(c.nome) + ";;;;", "TEL;TYPE=CELL:+55" + c.telefone, "END:VCARD"].join("\r\n");
          }).join("\r\n");
          var a = h("a", { href: URL.createObjectURL(new Blob([vcf], { type: "text/vcard;charset=utf-8" })), download: "clientes.vcf" });
          document.body.appendChild(a);
          a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
          j.fechar();
        }),
      ]),
      h("p", { class: "nota p", texto: "Lembrete: a lista de transmissão só chega a quem salvou o número da barbearia e aceita até 256 contatos. As campanhas daqui chegam a todos." }),
    ]);
  }

  // ---------- campanha: um por um pelo WhatsApp ----------
  function campanha(segmento, grupo) {
    var aceitos = grupo.filter(function (c) { return c.aceita; });
    var nome = h("input", { maxlength: "80", value: (SEGMENTOS.filter(function (s) { return s[0] === segmento; })[0] || ["", "Novidades"])[1] + " · " + P.dataBr(P.hoje()) });
    var msg = h("textarea", { rows: "5", maxlength: "1000" });
    msg.value = MODELOS[segmento] || MODELOS[""];
    var soAceitos = h("input", { type: "checkbox", checked: true });
    var exemplo = h("p", { class: "obs", style: "white-space:pre-line" });
    function atualizar() { exemplo.textContent = preencher(msg.value, grupo[0]); }
    msg.oninput = atualizar;
    atualizar();
    var j = janela("Mandar mensagem", [
      h("label", { class: "campo" }, ["Nome da campanha", nome]),
      h("label", { class: "campo" }, ["Mensagem", msg]),
      h("p", { class: "nota p", texto: "{nome} vira o primeiro nome do cliente, {dias} os dias sem vir e {site} o link de agendamento. Exemplo com " + grupo[0].nome + ":" }),
      exemplo,
      h("label", { class: "check-linha" }, [soAceitos, "Só quem aceitou receber novidades (" + aceitos.length + " de " + grupo.length + ")"]),
      h("p", { class: "nota p", texto: "É o que pede a LGPD para promoções. Quem pediu para sair nunca entra." }),
    ]);
    j.acoes([{ texto: "Voltar", fn: j.fechar }, {
      texto: "Começar", classe: "principal", fn: function (b) {
        var alvo = soAceitos.checked ? aceitos : grupo;
        if (!alvo.length) { P.toast("Ninguém deste grupo aceitou receber novidades ainda.", "erro"); return; }
        if (nome.value.trim().length < 2 || msg.value.trim().length < 2) { P.toast("Dê um nome e escreva a mensagem.", "erro"); return; }
        P.acao(b, api({ acao: "campanha-criar", nome: nome.value.trim(), segmento: segmento, mensagem: msg.value.trim() }).then(function (r) {
          j.fechar();
          enviarUmPorUm(r.campanha.id, nome.value.trim(), msg.value.trim(), alvo);
        })).catch(function (e) { P.toast(e.message, "erro"); });
      },
    }]);
  }
  function enviarUmPorUm(campanhaId, nome, modelo, alvo) {
    var i = 0, enviados = 0;
    var j = janela(nome, []);
    function tela() {
      if (i >= alvo.length) {
        j.trocar([h("p", { class: "nota", texto: "Pronto! " + enviados + (enviados === 1 ? " mensagem enviada." : " mensagens enviadas.") + " Em até 30 dias, a campanha mostra quantos voltaram." })]);
        j.acoes([{ texto: "Fechar", classe: "principal", fn: function () { j.fechar(); campanhasCache = null; carregar(); } }]);
        return;
      }
      var c = alvo[i], texto = preencher(modelo, c), feito = false;
      j.trocar([
        h("p", { class: "nota", texto: (i + 1) + " de " + alvo.length }),
        h("div", { class: "barra" }, h("i", { style: "width:" + Math.round((i / alvo.length) * 100) + "%" })),
        h("p", null, [h("b", { texto: c.nome }), " · " + whatsBr(c.telefone)]),
        h("p", { class: "obs", style: "white-space:pre-line", texto: texto }),
      ]);
      var proximo = { texto: "Próximo", fn: function () { i++; tela(); } };
      j.acoes([
        { texto: "Pular", fn: function () { i++; tela(); } },
        {
          texto: "Abrir WhatsApp", classe: "whats", icone: "whats", fn: function (b) {
            abrirLink(linkZap(c.telefone, texto));
            if (!feito) { feito = true; enviados++; api({ acao: "campanha-envio", campanhaId: campanhaId, clienteId: c.id }).catch(function () {}); }
            b.textContent = "Abrir de novo";
            j.acoes([{ texto: "Abrir de novo", classe: "", fn: function () { abrirLink(linkZap(c.telefone, texto)); } }, Object.assign({}, proximo, { classe: "principal" })]);
          },
        },
      ]);
    }
    tela();
  }

  function carregarCampanhas() {
    if (campanhasCache) return desenharCampanhas();
    P.api("/api/equipe?area=clientes&campanhas=1").then(function (r) { campanhasCache = r.campanhas; desenharCampanhas(); }).catch(function () {});
  }
  function desenharCampanhas() {
    var l = campanhasCache || [];
    P.trocar(el.campanhas, l.length ? l.map(function (c) {
      var pct = c.enviados ? Math.round((c.voltaram / c.enviados) * 100) : 0;
      return h("div", { class: "campanha" }, [
        h("div", { class: "assinante-topo" }, [h("div", { class: "cresce" }, [h("div", { class: "nome", texto: c.nome }), h("div", { class: "det", texto: P.dataBr(String(c.criado_em).slice(0, 10)) + " · " + c.enviados + (c.enviados === 1 ? " mensagem" : " mensagens") })]), h("span", { class: "selo " + (c.voltaram ? "selo-ok" : "selo-neutro"), texto: c.voltaram + " voltaram" })]),
        h("div", { class: "barra" }, h("i", { style: "width:" + pct + "%" })),
        h("p", { class: "nota p", texto: c.voltaram ? pct + "% voltaram em até 30 dias · " + P.brl(c.faturou) + " em atendimentos" : "Ainda ninguém voltou. O resultado conta até 30 dias depois de cada mensagem." }),
      ]);
    }) : P.vazio("📣", "Nenhuma campanha ainda."));
  }

  window.Clientes = { configurar: configurar, montar: montar, carregar: carregar, cadastrarDoAtendimento: cadastrarDoAtendimento, convite: convite, _: { lerTabela: lerTabela, mapear: mapear, preencher: preencher } };
})();
