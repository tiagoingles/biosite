// Ficha do cliente na aba Clientes: dados, visitas (e as do aplicativo anterior), campanhas recebidas e apagar (LGPD).
// Parte da aba Clientes (painel-clientes.js, que carrega antes): usa o que ela compartilha em window.Clientes.interno.
(function () {
  "use strict";
  const Aba = window.Clientes.interno;
  const P = Aba.P, h = Aba.h, STATUS = Aba.STATUS, ORIGEM = Aba.ORIGEM, APP_ANTERIOR = Aba.APP_ANTERIOR, api = Aba.api, whatsBr = Aba.whatsBr, dataBrAno = Aba.dataBrAno, abrirLink = Aba.abrirLink, linkZap = Aba.linkZap, sugestao = Aba.sugestao, janela = Aba.janela, carregar = Aba.carregar, linhaRetorno = Aba.linhaRetorno;

  // ---------- ficha ----------
  function ficha(id) {
    P.api("/api/equipe?area=clientes&id=" + id).then(function (f) {
      var c = f.cliente;
      var resumo = (Aba.dados && Aba.dados.clientes.filter(function (x) { return x.id === id; })[0]) || {};
      var linhas = [
        ["WhatsApp", c.telefone ? whatsBr(c.telefone) : "—"],
        ["Aniversário", c.nascimento ? dataBrAno(c.nascimento) : c.aniversario || "—"],
        Aba.op.dono ? ["CPF", c.cpfMascarado || "—"] : null,
        ["Retorno", resumo.status ? (STATUS[resumo.status] || [resumo.status])[0] + " · " + linhaRetorno(resumo) : "—"],
        ["Novidades", c.saiu_em ? "Pediu para não receber (" + P.dataBr(String(c.saiu_em).slice(0, 10)) + ")" : c.aceita ? "Aceitou em " + P.dataBr(String(c.aceite_em || c.criado_em).slice(0, 10)) + (c.aceite_origem ? " (" + (ORIGEM[c.aceite_origem] || c.aceite_origem).replace(/^se /, "") + ")" : "") : "Ainda não aceitou"],
        ["Origem", c.veioDe && APP_ANTERIOR[c.veioDe] ? "veio do " + APP_ANTERIOR[c.veioDe] + " (aplicativo anterior)" : ORIGEM[c.origem] || c.origem],
        c.ultima_visita_externa ? ["Antes do Bio Site", "última visita em " + dataBrAno(c.ultima_visita_externa)] : null,
      ].filter(Boolean);
      var visitas = f.visitas.length ? h("ul", { class: "mini-lista visitas" }, f.visitas.slice(0, 30).map(function (v) {
        var st = (P.STATUS && P.STATUS[v.status]) || [v.status];
        return h("li", null, [
          h("span", null, [h("b", { texto: P.dataBr(v.dia) + "/" + v.dia.slice(2, 4) + " · " + v.servico }), h("small", { texto: (v.profissional ? "com " + v.profissional + " · " : "") + st[0] })]),
          h("b", { texto: v.valor == null ? "—" : P.brl(v.valor) }),
        ]);
      })) : h("p", { class: "nota p", texto: "Nenhum atendimento ligado a este cliente ainda." });
      // Atendimentos no aplicativo anterior (migração do Booksy): separados, só como histórico
      var ant = f.anteriores || [];
      var app = ant.length ? (APP_ANTERIOR[ant[0].origem] || "aplicativo anterior") : "";
      var anteriores = ant.length ? h("details", { class: "anteriores" }, [
        h("summary", { texto: "No " + app + " (aplicativo anterior) · " + (ant.length >= 300 ? "os 300 atendimentos mais recentes" : ant.length + (ant.length === 1 ? " atendimento" : " atendimentos")) + ", de " + ant[ant.length - 1].dia.slice(0, 4) + " a " + ant[0].dia.slice(0, 4) }),
        h("p", { class: "nota p", texto: "Feitos antes do barbeirotop, no " + app + ". Ficam só como histórico: não entram no financeiro nem nas comissões." }),
        h("ul", { class: "mini-lista visitas" }, ant.map(function (v) {
          return h("li", null, [h("span", null, [
            h("b", { texto: P.dataBr(v.dia) + "/" + v.dia.slice(2, 4) + " · " + (v.servico || "Atendimento") }),
            h("small", { texto: (v.profissional ? "com " + v.profissional + " · " : "") + (v.status === "faltou" ? "não compareceu" : "atendido") + " · " + app }),
          ])]);
        })),
      ]) : null;
      var conteudo = [
        h("dl", { class: "ficha-dados" }, linhas.map(function (l) { return h("div", null, [h("dt", { texto: l[0] }), h("dd", { texto: l[1] })]); })),
        c.observacao ? h("p", { class: "obs", texto: c.observacao }) : null,
        h("h3", { class: "sub-titulo", texto: "Visitas" }),
        visitas,
        anteriores,
        f.campanhas.length ? h("p", { class: "nota p", texto: "Campanhas recebidas: " + f.campanhas.map(function (x) { return x.nome + " (" + P.dataBr(String(x.enviado_em).slice(0, 10)) + ")"; }).join(", ") }) : null,
      ];
      var j = janela(c.nome, conteudo);
      var acoes = [];
      if (Aba.op.dono) acoes.push({ texto: "Apagar dados", classe: "perigo", icone: "lixo", fn: function () { j.fechar(); apagar(c); } });
      acoes.push({ texto: "Editar", icone: "lapis", fn: function () { j.fechar(); Aba.formulario(c); } });
      if (c.telefone) acoes.push({ texto: "WhatsApp", classe: "whats", icone: "whats", fn: function () { abrirLink(linkZap(c.telefone, sugestao(Object.assign({}, resumo, c)))); } });
      if (Aba.op.dono && resumo.app) acoes.push({ texto: "Aviso", icone: "sino", fn: function () { j.fechar(); Aba.avisoNoCelular({ cliente: Object.assign({}, resumo, c) }); } });
      j.acoes(acoes);
    }).catch(function (e) { P.toast(e.message, "erro"); });
  }

  function apagar(c) {
    P.confirmar("Apagar os dados de " + c.nome + "?", "Use quando o cliente pedir (LGPD). O cadastro some para sempre; os atendimentos continuam no financeiro, sem o nome ligado ao cadastro.", "Apagar para sempre", true).then(function (ok) {
      if (!ok) return;
      api({ acao: "apagar", id: c.id }).then(function () { P.toast("Dados apagados.", "ok"); carregar(); }).catch(function (e) { P.toast(e.message, "erro"); });
    });
  }

  Aba.ficha = ficha;
})();
