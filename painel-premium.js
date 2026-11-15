// WhatsApp automático (plano Premium), na aba Clientes do painel do dono. Modo de teste: nada é enviado.
// O dono liga e desliga cada automação, ajusta o texto e vê a prévia do que sairia nos próximos 7 dias,
// com o custo estimado na Meta. Usa painel-comum.js (window.Painel). Servidor: lib/automacoes.js.
(function () {
  "use strict";
  var P = window.Painel, h = P.h;
  var op = {}, dados = null, el = {};
  var CATEGORIA = { utilidade: ["Lembrete", "info"], marketing: ["Promoção", "clube"] };
  // Variáveis que cada mensagem aceita (o painel troca pelos dados de cada cliente)
  var VARIAVEIS = {
    lembrete_vespera: "{nome}, {dia}, {hora}, {servico}, {profissional} e {barbearia}",
    lembrete_2h: "{nome}, {hora}, {servico}, {profissional} e {barbearia}",
    pos_atendimento: "{nome}, {barbearia} e {avaliacao} (o link do Google)",
    retorno: "{nome}, {dias} (dias sem vir), {barbearia} e {site} (link de agendamento)",
    reconquista: "{nome}, {dias}, {oferta}, {barbearia} e {site}",
    aniversario: "{nome}, {oferta}, {barbearia} e {site}",
    clube_vencimento: "{nome}, {plano}, {vencimento} e {barbearia}",
  };

  function api(corpo) { return corpo ? P.api("/api/equipe?area=clientes", { corpo: corpo }) : P.api("/api/equipe?area=clientes&premium=1"); }
  function kpi(rotulo, valor, detalhe) { return h("div", { class: "kpi" }, [h("span", { texto: rotulo }), h("b", { texto: valor }), detalhe ? h("small", { texto: detalhe }) : null]); }
  function preencher(texto, v) { return String(texto || "").replace(/\{(\w+)\}/g, function (m, k) { return v[k] == null ? "" : String(v[k]); }).replace(/ {2,}/g, " ").trim(); }

  function configurar(opcoes) { op = opcoes || {}; }

  // Cartão que a aba Clientes coloca na coluna da direita
  function cartao() {
    el.resumo = h("div", { class: "grade" }, h("div", { class: "esqueleto" }));
    el.lista = h("div", { class: "lista automacoes" });
    el.rodape = h("div", { class: "linha" });
    el.raiz = h("section", { class: "cartao premium" }, [
      h("div", { class: "cartao-topo" }, [h("h2", null, [P.icone("raio"), "WhatsApp automático"]), h("span", { class: "selo selo-clube", texto: "Premium · teste" })]),
      el.resumo, el.lista, el.rodape,
    ]);
    return el.raiz;
  }

  function carregar() {
    if (!el.raiz) return Promise.resolve();
    return api().then(function (j) { dados = j; desenhar(); }).catch(function (e) { P.trocar(el.resumo, h("p", { class: "nota p", texto: e.message })); });
  }

  function desenhar() {
    var pv = dados.previa, total = pv.mensagens.length;
    P.trocar(el.resumo, [
      h("div", { class: "aviso-faixa info" }, [h("span", { texto: "Modo de teste: nada é enviado ainda. Quando o WhatsApp oficial da barbearia for conectado, estas mensagens saem sozinhas, no horário certo." })]),
      h("div", { class: "kpis", style: "grid-template-columns:repeat(2,minmax(0,1fr))" }, [
        kpi("Próximos 7 dias", String(total), total === 1 ? "mensagem seria enviada" : "mensagens seriam enviadas"),
        kpi("Custo na Meta", P.brl(pv.custoMes), "por mês, estimado"),
      ]),
    ]);
    P.trocar(el.lista, dados.automacoes.map(linha));
    var bVer = h("button", { type: "button", class: "botao p principal" }, [P.icone("whats"), "Ver as mensagens da semana"]);
    bVer.onclick = verMensagens;
    bVer.disabled = !total;
    P.trocar(el.rodape, [bVer, h("p", { class: "nota p", texto: "Promoções só vão para quem aceitou receber novidades, no máximo uma por semana, e nunca para quem já tem horário marcado." })]);
  }

  function linha(a) {
    var n = dados.previa.porTipo[a.tipo] || 0;
    var cat = CATEGORIA[a.categoria] || [a.categoria, "neutro"];
    var chave = h("input", { type: "checkbox", checked: a.ativa, "aria-label": (a.ativa ? "Desligar " : "Ligar ") + a.nome });
    var rotulo = h("span", { texto: a.ativa ? "Ligada" : "Desligada" });
    chave.onchange = function () {
      chave.disabled = true;
      api({ acao: "automacao-salvar", tipo: a.tipo, ativa: chave.checked }).then(function () {
        P.toast(a.nome + (chave.checked ? " ligada." : " desligada."), "ok");
        return carregar();
      }).catch(function (e) { chave.checked = !chave.checked; chave.disabled = false; P.toast(e.message, "erro"); });
    };
    var bEditar = h("button", { type: "button", class: "botao mini" }, [P.icone("lapis"), "Editar"]);
    bEditar.onclick = function () { editar(a); };
    var det = a.quando;
    if (a.ativa && !a.pendencia) det += " · " + (n === 1 ? "1 na semana" : n + " na semana");
    return h("div", { class: "automacao" + (a.ativa ? "" : " desligada") }, [
      h("div", { class: "automacao-topo" }, [
        h("div", { class: "cresce" }, [h("div", { class: "nome", texto: a.nome }), h("div", { class: "det", texto: det })]),
        h("span", { class: "selo selo-" + cat[1], texto: cat[0] }),
      ]),
      a.pendencia ? h("p", { class: "nota p pendencia", texto: a.pendencia }) : null,
      h("div", { class: "linha" }, [h("label", { class: "chave" }, [chave, rotulo]), bEditar]),
    ]);
  }

  function editar(a, rascunho) {
    var v = rascunho || { texto: a.texto, oferta: a.config.oferta || "", avaliacao: a.config.avaliacao || "" };
    var txt = h("textarea", { rows: "5", maxlength: "700" });
    txt.value = v.texto;
    var temOferta = Object.prototype.hasOwnProperty.call(a.config || {}, "oferta");
    var oferta = temOferta ? h("input", { maxlength: "160", value: v.oferta, placeholder: "Ex.: volte esta semana e ganhe 10% de desconto." }) : null;
    var link = a.tipo === "pos_atendimento" ? h("input", { type: "url", inputmode: "url", maxlength: "300", value: v.avaliacao, placeholder: "https://g.page/r/..." }) : null;
    var exemplo = h("p", { class: "obs", style: "white-space:pre-line" });
    function atualizar() {
      exemplo.textContent = preencher(txt.value, {
        nome: "João", dia: P.dataBr(P.somaDias(P.hoje(), 1)), hora: "10:00", servico: "Corte", profissional: "Bruno", barbearia: op.barbearia || "barbearia",
        site: op.site || "", dias: 32, oferta: oferta ? oferta.value.trim() : "", avaliacao: link ? link.value.trim() : "", plano: "Corte ilimitado", vencimento: P.dataBr(P.somaDias(P.hoje(), 3)),
      });
    }
    txt.oninput = atualizar;
    if (oferta) oferta.oninput = atualizar;
    if (link) link.oninput = atualizar;
    atualizar();
    var padrao = h("button", { type: "button", class: "botao mini" }, [P.icone("atualizar"), "Voltar ao texto padrão"]);
    padrao.onclick = function () { txt.value = a.padrao; atualizar(); };
    var cat = CATEGORIA[a.categoria] || [a.categoria];
    P.janela({
      titulo: a.nome,
      conteudo: h("div", { class: "grade" }, [
        h("p", { class: "nota p", texto: cat[0] + " · " + a.quando + (a.categoria === "marketing" ? " · só para quem aceitou receber novidades" : "") }),
        h("label", { class: "campo" }, ["Mensagem", txt]),
        h("p", { class: "nota p", texto: "Pode usar: " + (VARIAVEIS[a.tipo] || "{nome} e {barbearia}") + "." }),
        oferta ? h("label", { class: "campo" }, ["Oferta", oferta]) : null,
        link ? h("label", { class: "campo" }, ["Link de avaliação no Google", link]) : null,
        link ? h("p", { class: "nota p", texto: "No Perfil da Empresa no Google, toque em \"Pedir avaliações\" e copie o link." }) : null,
        h("p", { class: "nota p", texto: "Exemplo:" }),
        exemplo,
        padrao,
        h("p", { class: "nota p", texto: "Ao conectar o WhatsApp oficial, cada mensagem vira um modelo aprovado pela Meta antes do primeiro envio." }),
      ]),
      acoes: [{ texto: "Voltar", valor: "cancelar" }, { texto: "Salvar", classe: "principal", valor: "ok" }],
      validar: function () {
        var t = txt.value.trim();
        if (t.length < 10) return "Escreva a mensagem (pelo menos 10 caracteres).";
        if (link && link.value.trim() && !/^https:\/\/\S{6,}$/.test(link.value.trim())) return "Cole o link de avaliação completo, começando com https://";
        return "";
      },
    }).then(function (r) {
      if (r.valor !== "ok") return;
      var x = { texto: txt.value.trim(), oferta: oferta ? oferta.value.trim() : "", avaliacao: link ? link.value.trim() : "" };
      var config = {};
      if (oferta) config.oferta = x.oferta;
      if (link) config.avaliacao = x.avaliacao;
      api({ acao: "automacao-salvar", tipo: a.tipo, texto: x.texto, config: config }).then(function () {
        P.toast("Mensagem salva.", "ok");
        carregar();
      }).catch(function (e) { P.toast(e.message, "erro"); editar(a, x); });
    });
  }

  // Lista do que sairia nos próximos 7 dias, dia a dia
  function verMensagens() {
    var pv = dados.previa, dias = {}, ordem = [];
    pv.mensagens.slice(0, 150).forEach(function (m) {
      if (!dias[m.dia]) { dias[m.dia] = []; ordem.push(m.dia); }
      dias[m.dia].push(m);
    });
    var blocos = ordem.map(function (dia) {
      return h("div", { class: "grade dia-mensagens" }, [
        h("h3", { class: "sub-titulo", texto: P.dataLonga(dia) + " · " + dias[dia].length + (dias[dia].length === 1 ? " mensagem" : " mensagens") }),
        h("ul", { class: "mini-lista mensagens" }, dias[dia].map(function (m) {
          var cat = CATEGORIA[m.categoria] || [m.categoria, "neutro"];
          return h("li", null, [
            h("span", null, [h("b", { texto: m.horario + " · " + m.cliente }), h("small", { texto: m.nome }), h("small", { class: "texto-msg", texto: m.texto })]),
            h("span", { class: "selo selo-" + cat[1], texto: cat[0] }),
          ]);
        })),
      ]);
    });
    P.janela({
      titulo: "Mensagens da semana",
      conteudo: h("div", { class: "grade" }, [
        h("p", { class: "nota", texto: "No modo de teste nada sai. É isto que o Premium mandaria sozinho de hoje até " + P.dataBr(pv.ate) + ", com custo estimado de " + P.brl(pv.custoSemana) + " na Meta." }),
      ].concat(blocos, pv.mensagens.length > 150 ? [h("p", { class: "nota p", texto: "E mais " + (pv.mensagens.length - 150) + "." })] : [])),
      acoes: [{ texto: "Fechar", classe: "principal", valor: "ok" }],
    });
  }

  window.Premium = { configurar: configurar, cartao: cartao, carregar: carregar };
})();
