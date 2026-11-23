// Planilha da aba Clientes (só o dono): importação (texto colado do Excel/Google ou CSV, conferida antes de gravar) e exportação.
// Parte da aba Clientes (painel-clientes.js, que carrega antes): usa o que ela compartilha em window.Clientes.interno.
(function () {
  "use strict";
  const Aba = window.Clientes.interno;
  const P = Aba.P, h = Aba.h, STATUS = Aba.STATUS, api = Aba.api, whatsBr = Aba.whatsBr, kpi = Aba.kpi, janela = Aba.janela, carregar = Aba.carregar;

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
    if (!Aba.dados || !Aba.dados.clientes.length) { P.toast("Ainda não há clientes para exportar."); return; }
    var j = janela("Exportar clientes", [
      h("div", { class: "menu opcoes-cadastro" }, [
        Aba.opcao("baixar", "Planilha (CSV)", "Abre no Excel e no Google Planilhas.", function () {
          P.baixarCsv("clientes.csv", [["Nome", "WhatsApp", "Aniversário", "Situação", "Última visita", "Visitas", "Ticket médio", "Aceita novidades"]].concat(Aba.dados.clientes.map(function (c) {
            return [c.nome, whatsBr(c.telefone), c.aniversario ? c.aniversario.dia : "", (STATUS[c.status] || [c.status])[0], c.ultima ? P.dataBr(c.ultima) + "/" + c.ultima.slice(0, 4) : "", c.visitas, c.ticket ? String(c.ticket).replace(".", ",") : "", c.aceita ? "sim" : "não"];
          })));
          j.fechar();
        }),
        Aba.opcao("perfil", "Contatos para o celular (vCard)", "Salva os clientes na agenda do celular, para usar nas listas de transmissão do WhatsApp.", function () {
          var vcf = Aba.dados.clientes.filter(function (c) { return c.telefone && !c.saiu; }).map(function (c) {
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

  Aba.importar = importar; Aba.exportar = exportar;
  window.Clientes._.lerTabela = lerTabela;
  window.Clientes._.mapear = mapear;
})();
