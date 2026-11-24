// Aba Caixa do painel do dono (lib/caixa.js, fase 35; pedido do Manolo, Dom Manolo).
// Abre o dia com o troco da gaveta, registra retiradas (despesa, vale de barbeiro, retirada do dono, guardar)
// e reforços, e fecha contando a gaveta: mostra se bateu e pergunta quanto fica de troco para o próximo dia.
// O Financeiro usa esses registros: despesa sai do lucro, vale aparece na comissão, sobra ou falta entra no lucro.
(function () {
  "use strict";
  var P = window.Painel, h = P.h;
  var raiz = null, el = {}, dados = null;
  var dia = null; // null = hoje; outro dia = caixa que ficou aberto ou um fechamento antigo
  // Para onde foi o dinheiro da retirada: [nome, explicação, exemplo de descrição]
  var CATEGORIAS = {
    despesa: ["Pagar uma despesa", "Café, limpeza, uma conta… Entra como gasto no Financeiro.", "Ex.: café e açúcar"],
    vale: ["Vale para barbeiro", "Adiantamento. Aparece ao lado da comissão dele no Financeiro.", "Ex.: adiantamento da semana"],
    dono: ["Retirada do dono", "Dinheiro que você tira para você. Não conta como gasto.", "Ex.: retirada do dia"],
    guardar: ["Guardar ou depositar", "Levar para o cofre ou para o banco. Só sai da gaveta.", "Ex.: depósito no banco"],
  };
  var NA_CONTA = { despesa: "Despesas pagas", vale: "Vales para barbeiros", dono: "Retiradas do dono", guardar: "Guardado ou depositado" };
  var NO_REGISTRO = { despesa: "Despesa", vale: "Vale", dono: "Retirada do dono", guardar: "Guardado ou depositado" };

  function api(corpo) {
    if (corpo) return P.api("/api/equipe?area=caixa", { corpo: Object.assign({ dia: dia || undefined }, corpo) });
    return P.api("/api/equipe?area=caixa" + (dia ? "&dia=" + dia : ""));
  }
  function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  // "1.234,56", "100" ou "100,5" -> número; vazio -> null; inválido -> NaN (a mesma regra do servidor)
  function numero(v) {
    var t = String(v == null ? "" : v).trim();
    if (!t) return null;
    t = t.replace(/[^\d,.]/g, "");
    if (!t) return NaN;
    if (t.indexOf(",") > -1) t = t.replace(/\./g, "").replace(",", ".");
    var n = Number(t);
    return isFinite(n) && n >= 0 && n <= 1e6 ? r2(n) : NaN;
  }
  function valorBr(n) { return Number(n || 0).toFixed(2).replace(".", ","); }
  function hora(iso) { return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }); }
  function textoDiferenca(dif) { return dif === 0 ? "bateu certinho" : dif > 0 ? "sobrou " + P.brl(dif) : "faltou " + P.brl(-dif); }
  function seloDiferenca(dif) {
    return h("span", { class: "selo " + (dif === 0 ? "selo-ok" : dif > 0 ? "selo-info" : "selo-alerta"), texto: dif === 0 ? "Bateu" : dif > 0 ? "Sobrou " + P.brl(dif) : "Faltou " + P.brl(-dif) });
  }
  function campoValor(rotulo, valor) {
    var input = h("input", { inputmode: "decimal", maxlength: "12", placeholder: "Ex.: 100,00", value: valor || "" });
    return { input: input, label: h("label", { class: "campo" }, [h("span", { texto: rotulo }), input]) };
  }
  function campoTexto(rotulo, exemplo, max) {
    var input = h("input", { maxlength: String(max || 80), placeholder: exemplo || "" });
    return { input: input, label: h("label", { class: "campo" }, [h("span", { texto: rotulo }), input]) };
  }
  function linha(rotulo, valor, classe) { return h("div", { class: "cx-linha" + (classe ? " " + classe : "") }, [h("span", { texto: rotulo }), h("b", { texto: P.brl(valor) })]); }
  function faixa(tipo, texto, rotulo, acao) {
    return h("div", { class: "aviso-faixa " + tipo }, [h("span", { texto: texto }), rotulo ? h("button", { type: "button", class: "botao p", texto: rotulo, onclick: acao }) : null]);
  }
  function kpi(rotulo, valor, sub) { return h("div", { class: "kpi" }, [h("span", { texto: rotulo }), h("b", { texto: valor }), h("small", { texto: sub })]); }
  function enviar(corpo, aviso) {
    return api(corpo).then(function (x) {
      P.toast(typeof aviso === "function" ? aviso(x) : aviso, "ok");
      return carregar();
    }).catch(function (e) { P.toast(e.message, "erro"); });
  }

  function montar(alvo) {
    raiz = alvo;
    el.avisos = h("div", { class: "larga cx-avisos" });
    el.kpis = h("div", { class: "kpis larga" }, [h("div", { class: "esqueleto" }), h("div", { class: "esqueleto" }), h("div", { class: "esqueleto" }), h("div", { class: "esqueleto" })]);
    el.principal = h("section", { class: "cartao" }, h("div", { class: "esqueleto" }));
    el.movs = h("section", { class: "cartao", hidden: true });
    el.conta = h("section", { class: "cartao", hidden: true });
    el.hist = h("section", { class: "cartao", hidden: true });
    P.trocar(raiz, [el.avisos, el.kpis, h("div", { class: "coluna" }, [el.principal, el.movs]), h("div", { class: "coluna" }, [el.conta, el.hist])]);
  }

  function carregar() {
    if (!raiz) return Promise.resolve();
    return api().then(function (j) { dados = j; desenhar(); }).catch(function (e) { P.trocar(el.principal, P.vazio("⚠️", e.message)); });
  }

  function desenhar() {
    var j = dados, c = j.caixa, ehHoje = j.dia === j.hoje;
    // Caixa fechado: os números do momento do fechamento; aberto (ou sem caixa): a conta ao vivo
    var r = c && c.fechado_em && c.resumo ? c.resumo : j;
    desenharAvisos(j, c, ehHoje);
    P.trocar(el.kpis, [
      kpi(ehHoje ? "Entrou hoje" : "Entrou em " + P.dataBr(j.dia), P.brl(r.total), "atendimentos e produtos"),
      kpi("Dinheiro", P.brl(r.entradas.dinheiro), "vai para a gaveta"),
      kpi("Pix", P.brl(r.entradas.pix), "direto na conta"),
      kpi("Cartão", P.brl(r2(r.entradas.debito + r.entradas.credito)), "débito e crédito"),
    ]);
    if (!c) desenharSemCaixa(j, ehHoje);
    else if (c.fechado_em) desenharFechado(j, c, ehHoje);
    else desenharAberto(j, c);
    desenharConta(c, r);
    desenharMovimentos(j, c);
    desenharHistorico(j);
  }

  function desenharAvisos(j, c, ehHoje) {
    var lista = [];
    if (!ehHoje) lista.push(faixa("info", "Você está vendo o caixa de " + P.diaCurto(j.dia) + ".", "Voltar para hoje", function () { dia = null; carregar(); }));
    if (j.abertoAntes && j.abertoAntes !== j.dia) {
      lista.push(faixa("alerta", "O caixa de " + P.diaCurto(j.abertoAntes) + " ficou aberto. Conte a gaveta e feche.", "Ver e fechar", function () { dia = j.abertoAntes; carregar(); }));
    }
    if (c && !c.fechado_em && j.pendentes) {
      var qtd = j.pendentes === 1 ? "1 atendimento deste dia ainda está" : j.pendentes + " atendimentos deste dia ainda estão";
      lista.push(faixa("alerta", qtd + " sem Realizado. O valor só entra na conta do caixa depois.", ehHoje ? "Ver agenda" : null, function () { location.hash = "#agenda"; }));
    }
    P.trocar(el.avisos, lista);
  }

  function desenharSemCaixa(j, ehHoje) {
    if (!ehHoje) { P.trocar(el.principal, [h("h2", { texto: "Caixa de " + P.dataBr(j.dia) }), P.vazio("🗄️", "Não houve caixa neste dia.")]); return; }
    var t = campoValor("Troco na gaveta (R$)", j.trocoSugerido != null ? valorBr(j.trocoSugerido) : "");
    var abrir = h("button", { type: "button", class: "botao principal g cheio" }, [P.icone("dinheiro"), "Abrir o caixa"]);
    abrir.onclick = function () {
      if (isNaN(numero(t.input.value))) { P.toast("Troco inválido. Ex.: 100,00", "erro"); return; }
      P.acao(abrir, api({ acao: "abrir", troco: t.input.value }).then(function () { P.toast("Caixa aberto. Bom trabalho!", "ok"); return carregar(); })
        .catch(function (e) { P.toast(e.message, "erro"); }));
    };
    P.trocar(el.principal, [
      h("div", { class: "cartao-topo" }, [h("h2", { texto: "Abrir o caixa" }), h("span", { class: "selo selo-neutro", texto: "Fechado" })]),
      h("p", { class: "nota p", texto: "Antes do primeiro cliente, conte o dinheiro que já está na gaveta. Esse é o troco do dia." }),
      t.label,
      j.trocoSugerido != null ? h("p", { class: "nota p", texto: "No último fechamento ficaram " + P.brl(j.trocoSugerido) + " de troco na gaveta." }) : null,
      abrir,
    ]);
  }

  function desenharAberto(j, c) {
    var partes = [P.brl(j.troco) + " de troco"];
    if (j.entradas.dinheiro) partes.push("+ " + P.brl(j.entradas.dinheiro) + " em dinheiro");
    if (j.reforcos) partes.push("+ " + P.brl(j.reforcos) + " de reforço");
    if (j.retiradas) partes.push("− " + P.brl(j.retiradas) + " de retiradas");
    var ret = h("button", { type: "button", class: "botao g", onclick: retirada }, [P.icone("baixar"), "Retirada"]);
    var ref = h("button", { type: "button", class: "botao g", onclick: reforco }, [P.icone("mais_um"), "Reforço"]);
    var fec = h("button", { type: "button", class: "botao principal g cheio", onclick: fechar }, [P.icone("check"), "Fechar o caixa"]);
    P.trocar(el.principal, [
      h("div", { class: "cartao-topo" }, [h("h2", { texto: "Caixa aberto" }), h("span", { class: "selo selo-ok", texto: "Desde " + hora(c.aberto_em) })]),
      h("div", { class: "cx-gaveta" }, [
        h("span", { class: "nota p", texto: "Deve ter na gaveta agora" }),
        h("b", { class: "cx-grande", texto: P.brl(j.esperado) }),
        h("span", { class: "nota p", texto: partes.join(" ") + "." }),
      ]),
      h("div", { class: "grade d2" }, [ret, ref]),
      fec,
    ]);
  }

  function desenharFechado(j, c, ehHoje) {
    var esperado = Number(c.esperado), contado = Number(c.contado), dif = r2(contado - esperado);
    var fica = c.fica_troco == null ? null : Number(c.fica_troco);
    var filhos = [
      h("div", { class: "cartao-topo" }, [h("h2", { texto: "Caixa fechado" }), seloDiferenca(dif)]),
      h("p", { class: "nota p", texto: "Fechado às " + hora(c.fechado_em) + ". O sistema esperava " + P.brl(esperado) + " e foram contados " + P.brl(contado) + ": " + textoDiferenca(dif) + "." }),
      h("div", { class: "cx-linhas" }, [
        linha("Esperado na gaveta", esperado),
        linha("Contado", contado),
        fica != null ? linha("Ficou de troco", fica) : null,
        fica != null ? linha("Recolhido (guardado ou levado)", r2(contado - fica)) : null,
      ]),
      c.observacao ? h("p", { class: "nota p", texto: "Observação: " + c.observacao }) : null,
    ];
    if (ehHoje) {
      var re = h("button", { type: "button", class: "botao" }, "Reabrir o caixa");
      re.onclick = function () {
        P.confirmar("Reabrir o caixa?", "O fechamento é desfeito: dá para registrar retiradas de novo e fechar outra vez.", "Reabrir")
          .then(function (ok) { if (ok) enviar({ acao: "reabrir" }, "Caixa reaberto."); });
      };
      filhos.push(h("div", { class: "linha" }, re));
    }
    P.trocar(el.principal, filhos);
  }

  // A conta da gaveta: troco + dinheiro + reforços − cada tipo de retirada = o que deve ter
  function desenharConta(c, r) {
    el.conta.hidden = !c;
    if (!c) return;
    var esperado = c.fechado_em ? Number(c.esperado) : dados.esperado;
    var linhas = [linha("Troco da abertura", r.troco), linha("+ Dinheiro recebido", r.entradas.dinheiro)];
    if (r.reforcos) linhas.push(linha("+ Reforços", r.reforcos));
    if (r.retiradasPor) Object.keys(NA_CONTA).forEach(function (k) { if (r.retiradasPor[k]) linhas.push(linha("− " + NA_CONTA[k], r.retiradasPor[k])); });
    else if (r.retiradas) linhas.push(linha("− Retiradas", r.retiradas));
    linhas.push(linha("= Deve ter na gaveta", esperado, "total"));
    var fora = [["pix", "Pix"], ["debito", "Débito"], ["credito", "Crédito"], ["sem", "Sem forma informada"]]
      .filter(function (f) { return r.entradas[f[0]]; })
      .map(function (f) { return f[1] + " " + P.brl(r.entradas[f[0]]); });
    P.trocar(el.conta, [
      h("h2", { texto: "Conta da gaveta" }),
      h("div", { class: "cx-linhas" }, linhas),
      h("p", { class: "nota p", texto: fora.length ? "Fora da gaveta (entra direto na conta): " + fora.join(" · ") + "." : "Pix e cartão não passam pela gaveta: entram direto na conta." }),
    ]);
  }

  function desenharMovimentos(j, c) {
    el.movs.hidden = !c;
    if (!c) return;
    var aberto = !c.fechado_em;
    var lista = j.movimentos.map(function (m) {
      var retirou = m.tipo === "retirada";
      var nome = retirou ? NO_REGISTRO[m.categoria] || "Retirada" : "Reforço";
      var detalhe = [m.profissional, m.motivo].filter(Boolean).join(" · ");
      var apagar = null;
      if (aberto) {
        apagar = h("button", { type: "button", class: "botao mini perigo", "aria-label": "Apagar " + nome.toLowerCase() + " de " + P.brl(m.valor) }, P.icone("lixo"));
        apagar.onclick = function () { apagarRegistro(m, nome); };
      }
      return h("div", { class: "cx-mov" }, [
        h("span", { class: "hora", texto: hora(m.criado_em) }),
        h("div", { class: "cresce" }, [h("b", { texto: nome }), detalhe ? h("small", { texto: detalhe }) : null]),
        h("span", { class: "valor", texto: (retirou ? "− " : "+ ") + P.brl(m.valor) }),
        apagar,
      ]);
    });
    P.trocar(el.movs, [
      h("h2", { texto: "Retiradas e reforços" }),
      lista.length ? h("div", { class: "lista" }, lista)
        : h("p", { class: "nota p", texto: aberto ? "Nada ainda. Tirou dinheiro da gaveta? Toque em \"Retirada\"." : "Nenhuma retirada ou reforço neste dia." }),
    ]);
  }

  function desenharHistorico(j) {
    var lista = (j.historico || []).filter(function (x) { return x.dia !== j.dia; });
    el.hist.hidden = !lista.length;
    if (!lista.length) return;
    P.trocar(el.hist, [
      h("h2", { texto: "Últimos fechamentos" }),
      h("div", { class: "lista" }, lista.map(function (x) {
        var ver = h("button", { type: "button", class: "botao p", texto: "Ver" });
        ver.onclick = function () { dia = x.dia === j.hoje ? null : x.dia; carregar(); window.scrollTo(0, 0); };
        var info = [x.total != null ? "entrou " + P.brl(x.total) : "", x.ficaTroco != null ? "ficou " + P.brl(x.ficaTroco) + " de troco" : ""].filter(Boolean).join(" · ");
        return h("div", { class: "cx-mov" }, [
          h("div", { class: "cresce" }, [h("b", { texto: P.diaCurto(x.dia) }), info ? h("small", { texto: info }) : null]),
          seloDiferenca(x.diferenca),
          ver,
        ]);
      })),
    ]);
  }

  // ---------- janelas ----------
  function retirada() {
    var valor = campoValor("Valor (R$)", "");
    var desc = campoTexto("Descrição (opcional)", CATEGORIAS.despesa[2]);
    var barbeiros = dados.profissionais || [];
    var escolhida = "despesa";
    var selBarbeiro = h("select", null, [h("option", { value: "", texto: "Escolha o barbeiro" })].concat(barbeiros.map(function (p) { return h("option", { value: p.id, texto: p.nome }); })));
    var campoBarbeiro = h("label", { class: "campo", hidden: true }, [h("span", { texto: "Barbeiro" }), selBarbeiro]);
    var opcoes = Object.keys(CATEGORIAS).filter(function (k) { return k !== "vale" || barbeiros.length; }).map(function (k) {
      var radio = h("input", { type: "radio", name: "categoria", value: k, checked: k === escolhida });
      radio.onchange = function () { escolhida = k; campoBarbeiro.hidden = k !== "vale"; desc.input.placeholder = CATEGORIAS[k][2]; };
      return h("label", { class: "cx-opcao" }, [radio, h("span", null, [h("b", { texto: CATEGORIAS[k][0] }), h("small", { texto: CATEGORIAS[k][1] })])]);
    });
    P.janela({
      titulo: "Retirada da gaveta",
      conteudo: h("div", { class: "grade" }, [
        h("p", { class: "nota p", texto: "Na gaveta agora: " + P.brl(dados.esperado) + "." }),
        valor.label,
        h("fieldset", { class: "campo-grupo" }, [h("legend", { texto: "Para quê?" }), h("div", { class: "cx-opcoes" }, opcoes)]),
        campoBarbeiro,
        desc.label,
      ]),
      acoes: [{ texto: "Voltar", valor: "cancelar" }, { texto: "Registrar retirada", classe: "principal", valor: "ok" }],
      validar: function () {
        if (!(numero(valor.input.value) > 0)) return "Informe o valor. Ex.: 50,00";
        if (escolhida === "vale" && !selBarbeiro.value) return "Escolha o barbeiro do vale.";
        return "";
      },
    }).then(function (r) {
      if (r.valor !== "ok") return;
      enviar({ acao: "movimento", tipo: "retirada", valor: valor.input.value, categoria: escolhida, profissionalId: escolhida === "vale" ? selBarbeiro.value : undefined, motivo: desc.input.value }, "Retirada registrada.");
    });
  }

  function reforco() {
    var valor = campoValor("Valor (R$)", "");
    var desc = campoTexto("Descrição (opcional)", "Ex.: troco trocado no banco");
    P.janela({
      titulo: "Reforço de troco",
      conteudo: h("div", { class: "grade" }, [h("p", { class: "nota p", texto: "Dinheiro que você coloca na gaveta durante o dia, por exemplo para ter troco." }), valor.label, desc.label]),
      acoes: [{ texto: "Voltar", valor: "cancelar" }, { texto: "Registrar reforço", classe: "principal", valor: "ok" }],
      validar: function () { return numero(valor.input.value) > 0 ? "" : "Informe o valor. Ex.: 50,00"; },
    }).then(function (r) {
      if (r.valor === "ok") enviar({ acao: "movimento", tipo: "reforco", valor: valor.input.value, motivo: desc.input.value }, "Reforço registrado.");
    });
  }

  function fechar() {
    var esperado = dados.esperado;
    var contado = campoValor("Dinheiro contado na gaveta (R$)", "");
    var fica = campoValor("Fica na gaveta de troco para o próximo dia (R$)", valorBr(dados.troco));
    var obs = campoTexto("Observação (opcional)", "Ex.: faltou o troco de um cliente", 300);
    var resultado = h("p", { class: "cx-resultado" });
    var recolhe = h("p", { class: "nota p" });
    var ficaMexido = false;
    function atualizar() {
      var c = numero(contado.input.value), f = numero(fica.input.value);
      var contou = c !== null && !isNaN(c);
      if (!contou) { resultado.textContent = "O sistema espera " + P.brl(esperado) + " na gaveta."; resultado.className = "cx-resultado"; }
      else {
        var dif = r2(c - esperado);
        resultado.textContent = "O sistema esperava " + P.brl(esperado) + ": " + textoDiferenca(dif) + ".";
        resultado.className = "cx-resultado " + (dif === 0 ? "ok" : "alerta");
      }
      recolhe.textContent = !contou || f === null || isNaN(f) ? "" : f > c ? "O troco que fica não pode passar do dinheiro contado."
        : "Você recolhe " + P.brl(r2(c - f)) + " (guarda ou leva) e deixa " + P.brl(f) + " na gaveta.";
    }
    contado.input.addEventListener("input", function () {
      var c = numero(contado.input.value);
      // Sem mexer no troco: fica o mesmo da abertura, ou tudo o que foi contado, se for menos
      if (!ficaMexido && c !== null && !isNaN(c)) fica.input.value = valorBr(Math.min(dados.troco, c));
      atualizar();
    });
    fica.input.addEventListener("input", function () { ficaMexido = true; atualizar(); });
    atualizar();
    var pendentes = dados.pendentes ? h("p", { class: "aviso-faixa alerta", texto: (dados.pendentes === 1 ? "1 atendimento ainda está" : dados.pendentes + " atendimentos ainda estão") + " sem Realizado: o valor fica de fora deste fechamento." }) : null;
    P.janela({
      titulo: dados.dia === dados.hoje ? "Fechar o caixa" : "Fechar o caixa de " + P.dataBr(dados.dia),
      conteudo: h("div", { class: "grade" }, [
        h("p", { class: "nota p", texto: "Conte todo o dinheiro da gaveta: notas e moedas." }),
        pendentes,
        contado.label,
        resultado,
        fica.label,
        recolhe,
        obs.label,
      ]),
      acoes: [{ texto: "Voltar", valor: "cancelar" }, { texto: "Fechar o caixa", classe: "principal", valor: "ok" }],
      validar: function () {
        var c = numero(contado.input.value), f = numero(fica.input.value);
        if (c === null || isNaN(c)) return "Conte o dinheiro da gaveta e informe o valor.";
        if (f !== null && isNaN(f)) return "Troco inválido. Ex.: 100,00";
        if (f !== null && f > c) return "O troco que fica não pode ser maior que o dinheiro contado.";
        return "";
      },
    }).then(function (r) {
      if (r.valor !== "ok") return;
      enviar({ acao: "fechar", contado: contado.input.value, ficaTroco: fica.input.value, observacao: obs.input.value }, function (x) {
        return "Caixa fechado: " + textoDiferenca(x.diferenca) + ".";
      });
    });
  }

  function apagarRegistro(m, nome) {
    P.confirmar("Apagar este registro?", nome + " de " + P.brl(m.valor) + " às " + hora(m.criado_em) + ". A conta da gaveta volta a ficar sem ele.", "Apagar", true)
      .then(function (ok) { if (ok) enviar({ acao: "apagar-movimento", id: m.id }, "Registro apagado."); });
  }

  window.Caixa = { montar: montar, carregar: carregar, _: { numero: numero, textoDiferenca: textoDiferenca } };
})();
