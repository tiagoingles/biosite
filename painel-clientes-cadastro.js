// Cadastro de cliente na aba Clientes: no painel, pelo celular do cliente (link ou QR code) e a partir de um atendimento.
// Parte da aba Clientes (painel-clientes.js, que carrega antes): usa o que ela compartilha em window.Clientes.interno.
(function () {
  "use strict";
  const Aba = window.Clientes.interno;
  const P = Aba.P, h = Aba.h, api = Aba.api, whatsBr = Aba.whatsBr, dataBrAno = Aba.dataBrAno, abrirLink = Aba.abrirLink, linkZap = Aba.linkZap, janela = Aba.janela, carregar = Aba.carregar;

  // ---------- cadastro no painel ----------
  function formulario(c, extra, rascunho) {
    extra = extra || {};
    var v = rascunho || (c ? { nome: c.nome, telefone: whatsBr(c.telefone), nascimento: c.nascimento ? dataBrAno(c.nascimento) : "", cpf: c.cpf || "", observacao: c.observacao || "", aceita: !!c.aceita, profissional_id: c.profissional_id || "" }
      : { nome: extra.nome || "", telefone: extra.telefone || "", nascimento: "", cpf: "", observacao: "", aceita: false, profissional_id: "" });
    var nome = h("input", { maxlength: "80", autocomplete: "off", value: v.nome });
    var tel = h("input", { type: "tel", inputmode: "tel", maxlength: "20", placeholder: "(00) 00000-0000", value: v.telefone });
    var nasc = h("input", { inputmode: "numeric", maxlength: "10", placeholder: "dd/mm/aaaa", value: v.nascimento });
    // Barbeiro editando quem já tem aniversário: só mostra o dia e o mês (o dono cuida da data completa)
    var nascFixo = !Aba.op.dono && c && c.aniversario ? h("p", { class: "nota p", texto: "Aniversário: " + c.aniversario }) : null;
    var cpf = Aba.op.dono ? h("input", { inputmode: "numeric", maxlength: "14", placeholder: "Opcional", value: v.cpf }) : null;
    var obs = h("input", { maxlength: "300", placeholder: "Ex.: prefere máquina 2 nas laterais", value: v.observacao });
    var aceita = Aba.op.dono ? h("input", { type: "checkbox", checked: v.aceita }) : null;
    var barbeiro = Aba.op.dono && Aba.dados && Aba.dados.equipe.length ? h("select", null, [h("option", { value: "", texto: "Ninguém em especial" })].concat(Aba.dados.equipe.map(function (e) { return h("option", { value: e.id, selected: e.id === v.profissional_id, texto: e.nome }); }))) : null;
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
      if (Aba.op.dono) { corpo.cpf = x.cpf; corpo.aceita = x.aceita; corpo.profissional_id = x.profissional_id; }
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
        var msg = "Olá" + (nome ? ", " + nome : "") + "! Para completar seu cadastro na " + (Aba.op.barbearia || "barbearia") + " e não perder as promoções e novidades, toque no link (leva menos de 1 minuto): " + r.link;
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
    var pelaCelular = opcao("qr", "Pelo celular dele", "Mostra um QR code ou manda o link no WhatsApp. Ele mesmo preenche.", function () { j.fechar(); convite({ pedidoId: p.id, nome: p.cliente, aoUsar: recarregar }); });
    // A carteira é do dono: o barbeiro só manda o convite; preencher e ligar a um cadastro ficam com o dono
    var opcoes = h("div", { class: "menu opcoes-cadastro" }, Aba.op.dono ? [
      pelaCelular,
      opcao("lapis", "Preencher agora", "Você digita os dados que ele passar.", function () { j.fechar(); garantirDados().then(function () { formulario(null, { pedidoId: p.id, nome: p.cliente, aoSalvar: recarregar }); }); }),
      opcao("perfil", "Já tem cadastro", "Liga este atendimento ao cadastro que já existe.", function () { j.fechar(); escolherExistente(p, recarregar); }),
    ] : [pelaCelular]);
    j.corpo.appendChild(opcoes);
  }
  function opcao(icone, titulo, texto, fn) {
    var b = h("button", { type: "button", class: "opcao" }, [P.icone(icone), h("span", null, [h("b", { texto: titulo }), h("small", { texto: texto })])]);
    b.onclick = fn;
    return b;
  }
  function garantirDados() { return Aba.dados ? Promise.resolve(Aba.dados) : api().then(function (j) { Aba.dados = j; return j; }); }

  function escolherExistente(p, aoLigar) {
    var campo = h("input", { type: "search", class: "busca-painel", placeholder: "Nome ou WhatsApp", value: P.primeiroNome(p.cliente) });
    var lista = h("div", { class: "lista" }, h("div", { class: "esqueleto" }));
    var j = janela("Ligar a um cadastro", [campo, lista]);
    function desenhar() {
      var t = campo.value.trim().toLowerCase(), dig = t.replace(/\D/g, "");
      var achados = (Aba.dados ? Aba.dados.clientes : []).filter(function (c) { return !t || c.nome.toLowerCase().indexOf(t) > -1 || (dig.length >= 3 && c.telefone.indexOf(dig) > -1); }).slice(0, 8);
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

  Aba.formulario = formulario; Aba.convite = convite; Aba.opcao = opcao;
  window.Clientes.cadastrarDoAtendimento = cadastrarDoAtendimento;
  window.Clientes.convite = convite;
})();
