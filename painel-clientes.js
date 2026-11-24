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
  // Aplicativo que a barbearia usava antes (migração): nome que a ficha mostra no histórico de lá
  var APP_ANTERIOR = { booksy: "Booksy" };
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
    bNovo.onclick = function () { Aba.formulario(null); };
    var bConvite = h("button", { type: "button", class: "botao p" }, [P.icone("qr"), "Cadastro pelo celular"]);
    bConvite.onclick = function () { Aba.convite({}); };
    var ferramentas = [bConvite];
    if (op.dono) {
      var bImportar = h("button", { type: "button", class: "botao p" }, [P.icone("enviar"), "Importar planilha"]);
      bImportar.onclick = Aba.importar;
      var bExportar = h("button", { type: "button", class: "botao p" }, [P.icone("baixar"), "Exportar"]);
      bExportar.onclick = Aba.exportar;
      ferramentas.push(bImportar, bExportar);
      el.avisoTodos = h("button", { type: "button", class: "botao p", hidden: true });
      el.avisoTodos.onclick = function () { Aba.avisoNoCelular({ segmento: "todos", n: el.avisoTodos._n || 0 }); };
      ferramentas.unshift(el.avisoTodos);
    }
    el.campanhas = h("div", { class: "lista" });
    // Quantos ligaram os avisos da barbearia no celular (só o dono vê)
    el.avisosCel = op.dono ? h("section", { class: "cartao", id: "cartaoAvisosCelular" }, h("div", { class: "esqueleto" })) : null;
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
        el.avisosCel,
        h("section", { class: "cartao" }, [
          h("div", { class: "cartao-topo" }, [h("h2", null, [op.dono ? "Clientes " : "Meus clientes ", el.qtd]), bNovo]),
          h("div", { class: "linha ferramentas" }, ferramentas),
          el.seg, el.faixa, el.busca, el.lista, el.mais,
        ]),
      ]),
      h("div", { class: "coluna" }, colunaDireita),
    ]);
  }

  // Cartão "Avisos no celular": quantos aparelhos têm os avisos da barbearia ligados, quantos com cadastro
  // (selo App na lista), quantos aceitam novidades (recebem o aviso para grupos) e se é Android ou iPhone
  function desenharAvisosCelular(a) {
    a = a || { aparelhos: 0, comCadastro: 0, semCadastro: 0, novidades: 0, iphone: 0, android: 0, outros: 0 };
    var resumo = !a.aparelhos ? "Ninguém ligou os avisos da barbearia ainda."
      : (a.aparelhos === 1 ? "1 celular com os avisos ligados" : a.aparelhos + " celulares com os avisos ligados") + ": " + a.comCadastro + " com cadastro (selo App na lista)" + (a.semCadastro ? " e " + a.semCadastro + " sem cadastro" : "") + ".";
    var como = h("details", { class: "como-avisos" }, [
      h("summary", { texto: "Como o cliente liga os avisos" }),
      h("p", { class: "nota p", texto: "No Android: ao agendar pelo site, toca em \"Receber avisos no celular\" e em Permitir. No iPhone: a Apple só libera os avisos com o site colocado na tela de início e aberto pelo ícone; depois de agendar, o site mostra o passo a passo. Quem liga sem ter agendado com o WhatsApp aparece aqui como \"sem cadastro\" até o próximo agendamento." }),
    ]);
    P.trocar(el.avisosCel, [
      h("div", { class: "cartao-topo" }, [h("h2", null, [P.icone("sino"), "Avisos no celular"]), h("span", { class: "contador", texto: String(a.aparelhos) })]),
      h("p", { class: "nota", texto: resumo }),
      a.aparelhos ? h("p", { class: "nota", texto: "Android: " + a.android + " · iPhone: " + a.iphone + (a.outros ? " · outros: " + a.outros : "") + " · " + a.novidades + " aceitam novidades (recebem os avisos para grupos)" }) : null,
      como,
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
    if (el.avisosCel) desenharAvisosCelular(k.avisos);
    if (el.avisoTodos) {
      var nApp = comAppNoGrupo(dados.clientes).length + (k.appSemCadastro || 0);
      el.avisoTodos._n = nApp;
      el.avisoTodos.hidden = !nApp;
      P.trocar(el.avisoTodos, [P.icone("sino"), "Aviso no celular (" + nApp + ")"]);
    }
    P.trocar(el.seg, SEGMENTOS.map(function (s) {
      var n = s[0] ? dados.segmentos[s[0]] : k.total;
      var b = h("button", { type: "button", class: "botao p" + (seg === s[0] ? " principal" : ""), "aria-pressed": seg === s[0] ? "true" : "false" }, [s[1], h("span", { class: "n", texto: String(n) })]);
      b.onclick = function () { seg = s[0]; limite = LOTE; desenhar(); };
      return b;
    }));
    desenharLista();
    if (op.dono) Aba.carregarCampanhas();
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
        b.onclick = function () { Aba.campanha(seg, comZap); };
        acoes.push(b);
      }
      var comApp = comAppNoGrupo(lista);
      if (op.dono && comApp.length) {
        var bApp = h("button", { type: "button", class: "botao p" }, [P.icone("sino"), "Aviso no celular (" + comApp.length + ")"]);
        bApp.onclick = function () { Aba.avisoNoCelular({ segmento: seg, n: comApp.length }); };
        acoes.push(bApp);
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
    if (c.app) selos.push(h("span", { class: "selo selo-info", texto: "App", title: "Ligou os avisos da barbearia no celular" }));
    if (c.aniversario && c.aniversario.diasAte <= 7) selos.unshift(h("span", { class: "selo selo-clube", texto: c.aniversario.diasAte === 0 ? "🎂 Hoje" : "🎂 " + c.aniversario.dia }));
    var det = [c.telefone ? whatsBr(c.telefone) : "sem WhatsApp"];
    if (c.aniversario) det.push("aniversário " + c.aniversario.dia);
    var uso = [c.visitas ? c.visitas + (c.visitas === 1 ? " visita" : " visitas") : "nenhuma visita pelo Bio Site"];
    // Atendimentos no aplicativo anterior (migração): contam no ritmo de retorno, não no ticket
    if (c.visitasExternas) uso.push(c.visitasExternas + " no app anterior");
    if (c.ticket) uso.push("ticket " + P.brl(c.ticket));
    if (c.barbeiro && op.dono) uso.push("com " + c.barbeiro);
    var bZap = c.telefone ? h("button", { type: "button", class: "botao p whats" }, [P.icone("whats"), "WhatsApp"]) : null;
    if (bZap) bZap.onclick = function () { abrirLink(linkZap(c.telefone, sugestao(c))); };
    var bFicha = h("button", { type: "button", class: "botao p" }, [P.icone("perfil"), "Ficha"]);
    bFicha.onclick = function () { Aba.ficha(c.id); };
    var bAviso = op.dono && c.app ? h("button", { type: "button", class: "botao p" }, [P.icone("sino"), "Aviso"]) : null;
    if (bAviso) bAviso.onclick = function () { Aba.avisoNoCelular({ cliente: c }); };
    return h("div", { class: "cliente" }, [
      h("div", { class: "assinante-topo" }, [
        h("div", { class: "cresce" }, [h("div", { class: "nome", texto: c.nome }), h("div", { class: "det", texto: det.join(" · ") })]),
        h("span", { class: "selos" }, selos),
      ]),
      h("p", { class: "nota p", texto: linhaRetorno(c) }),
      h("p", { class: "nota p", texto: uso.join(" · ") + (c.saiu ? " · pediu para não receber mensagens" : c.aceita ? " · aceita novidades" : "") }),
      h("div", { class: "linha" }, [bZap, bAviso, bFicha]),
    ]);
  }

  function comAppNoGrupo(lista) { return lista.filter(function (c) { return c.appNovidades && !c.saiu; }); }
  function filtrar(s) { seg = s || ""; limite = LOTE; if (dados && raiz) desenhar(); }

  // Partes da aba em arquivos próprios (painel-clientes-ficha.js, painel-clientes-cadastro.js, painel-clientes-planilha.js, painel-clientes-campanhas.js):
  // usam o que o núcleo compartilha aqui e acrescentam as funções delas. O estado da aba fica no núcleo.
  const Aba = { P: P, h: h, STATUS: STATUS, SEGMENTOS: SEGMENTOS, MODELOS: MODELOS, ORIGEM: ORIGEM, APP_ANTERIOR: APP_ANTERIOR, el: el, api: api, whatsBr: whatsBr, dataBrAno: dataBrAno, abrirLink: abrirLink, linkZap: linkZap, preencher: preencher, sugestao: sugestao, kpi: kpi, janela: janela, carregar: carregar, linhaRetorno: linhaRetorno };
  Object.defineProperty(Aba, "op", { get: function () { return op; }, set: function (v) { op = v; } });
  Object.defineProperty(Aba, "dados", { get: function () { return dados; }, set: function (v) { dados = v; } });
  Object.defineProperty(Aba, "campanhasCache", { get: function () { return campanhasCache; }, set: function (v) { campanhasCache = v; } });
  window.Clientes = { configurar: configurar, montar: montar, carregar: carregar, filtrar: filtrar, _: { preencher: preencher } };
  window.Clientes.interno = Aba; // só para as partes da aba
})();
