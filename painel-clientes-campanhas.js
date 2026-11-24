// Campanhas da aba Clientes (só o dono): mensagem um por um pelo WhatsApp, aviso no celular (app da barbearia) e o resultado das campanhas.
// Parte da aba Clientes (painel-clientes.js, que carrega antes): usa o que ela compartilha em window.Clientes.interno.
(function () {
  "use strict";
  const Aba = window.Clientes.interno;
  const P = Aba.P, h = Aba.h, SEGMENTOS = Aba.SEGMENTOS, MODELOS = Aba.MODELOS, el = Aba.el, api = Aba.api, whatsBr = Aba.whatsBr, abrirLink = Aba.abrirLink, linkZap = Aba.linkZap, preencher = Aba.preencher, janela = Aba.janela, carregar = Aba.carregar;

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
        j.acoes([{ texto: "Fechar", classe: "principal", fn: function () { j.fechar(); Aba.campanhasCache = null; carregar(); } }]);
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

  // ---------- aviso no celular (app da barbearia) ----------
  var MODELOS_AVISO = {
    cliente: "Olá, {nome}! ",
    chamar: "Olá, {nome}! Já está na hora de dar um trato no visual. Toque para agendar.",
    segunda: "Olá, {nome}! Gostou da primeira visita? Agende a próxima por aqui.",
    sumidos: "Olá, {nome}! Sentimos sua falta. Que tal voltar esta semana? Toque para agendar.",
    aniversario: "Feliz aniversário, {nome}! Venha comemorar de visual novo.",
    todos: "Novidade na barbearia: ",
  };
  // alvo: { cliente } para um cliente, ou { segmento, n } para um grupo ("todos" = todos com o app)
  function avisoNoCelular(alvo) {
    var umCliente = !!alvo.cliente;
    var chave = umCliente ? "cliente" : alvo.segmento;
    var msg = h("textarea", { rows: "3", maxlength: "180" });
    msg.value = MODELOS_AVISO[chave] || "";
    var abrir = h("select", null, [h("option", { value: "agendar", texto: "O agendamento (já abre para marcar o horário)" }), h("option", { value: "site", texto: "O site da barbearia" })]);
    var titulo = h("b", { texto: Aba.op.barbearia || "Barbearia" });
    var corpo = h("span");
    var conta = h("small", { class: "nota" });
    var exemplo = umCliente ? P.primeiroNome(alvo.cliente.nome) : "Ana";
    function atualizar() { corpo.textContent = msg.value.split("{nome}").join(exemplo); conta.textContent = msg.value.length + " de 180"; }
    msg.oninput = atualizar;
    atualizar();
    var quem = umCliente ? alvo.cliente.nome : (alvo.segmento === "todos" ? "todos com o app" : (SEGMENTOS.filter(function (s) { return s[0] === alvo.segmento; })[0] || ["", ""])[1].toLowerCase()) + " (" + alvo.n + (alvo.n === 1 ? " pessoa)" : " pessoas)");
    var j = janela("Aviso no celular", [
      h("p", { class: "nota p", texto: "Para " + quem + ". Chega como notificação, no celular de quem ligou os avisos da barbearia no site." }),
      h("div", { class: "previa-aviso", "aria-label": "Como o aviso aparece" }, [h("span", { class: "previa-icone", texto: P.iniciais(Aba.op.barbearia || "B") }), h("div", null, [titulo, corpo])]),
      h("label", { class: "campo" }, ["Mensagem", msg]),
      conta,
      h("label", { class: "campo" }, ["Ao tocar no aviso, abre", abrir]),
      h("p", { class: "nota p", texto: umCliente ? "{nome} vira o primeiro nome do cliente." : "{nome} vira o primeiro nome de cada cliente. Vai só para quem aceitou receber novidades; quem pediu para sair nunca recebe. No máximo 2 avisos para grupos por dia." }),
    ]);
    j.acoes([{ texto: "Voltar", fn: j.fechar }, {
      texto: "Enviar aviso", classe: "principal", icone: "sino", fn: function (b) {
        if (msg.value.trim().length < 3) { P.toast("Escreva a mensagem do aviso.", "erro"); return; }
        var corpoApi = { acao: "aviso", mensagem: msg.value.trim(), abrir: abrir.value };
        if (umCliente) corpoApi.clienteId = alvo.cliente.id; else corpoApi.segmento = alvo.segmento;
        P.acao(b, api(corpoApi).then(function (r) {
          j.fechar();
          P.toast(r.entregues ? "Aviso enviado para " + r.entregues + (r.entregues === 1 ? " celular." : " celulares.") : "Nenhum celular respondeu agora. Tente mais tarde ou use o WhatsApp.", r.entregues ? "ok" : "erro");
        })).catch(function (e) { P.toast(e.message, "erro"); });
      },
    }]);
  }

  function carregarCampanhas() {
    if (Aba.campanhasCache) return desenharCampanhas();
    P.api("/api/equipe?area=clientes&campanhas=1").then(function (r) { Aba.campanhasCache = r.campanhas; desenharCampanhas(); }).catch(function () {});
  }
  function desenharCampanhas() {
    var l = Aba.campanhasCache || [];
    P.trocar(el.campanhas, l.length ? l.map(function (c) {
      var pct = c.enviados ? Math.round((c.voltaram / c.enviados) * 100) : 0;
      return h("div", { class: "campanha" }, [
        h("div", { class: "assinante-topo" }, [h("div", { class: "cresce" }, [h("div", { class: "nome", texto: c.nome }), h("div", { class: "det", texto: P.dataBr(String(c.criado_em).slice(0, 10)) + " · " + c.enviados + (c.enviados === 1 ? " mensagem" : " mensagens") })]), h("span", { class: "selo " + (c.voltaram ? "selo-ok" : "selo-neutro"), texto: c.voltaram + " voltaram" })]),
        h("div", { class: "barra" }, h("i", { style: "width:" + pct + "%" })),
        h("p", { class: "nota p", texto: c.voltaram ? pct + "% voltaram em até 30 dias · " + P.brl(c.faturou) + " em atendimentos" : "Ainda ninguém voltou. O resultado conta até 30 dias depois de cada mensagem." }),
      ]);
    }) : P.vazio("📣", "Nenhuma campanha ainda."));
  }

  Aba.campanha = campanha; Aba.avisoNoCelular = avisoNoCelular; Aba.carregarCampanhas = carregarCampanhas;
  window.Clientes.avisoNoCelular = avisoNoCelular;
})();
