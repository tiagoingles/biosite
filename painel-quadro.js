// Agenda em quadro (painéis do dono e do barbeiro): uma coluna por barbeiro, com as horas do dia; os horários
// marcados são blocos e o que fica em branco está livre (tocar num espaço livre abre o encaixe naquela hora).
// Segure e arraste um horário para cima ou para baixo (no painel do dono, também para outro barbeiro) para ajustar
// atrasos e imprevistos: ao soltar, o painel confirma, remarca e pode avisar o cliente no celular.
// "Atrasar", no topo da coluna, empurra os próximos horários do barbeiro de uma vez.
// Usa painel-comum.js (window.Painel) e painel-agenda.js (cartão do pedido, encaixe).
(function () {
  "use strict";
  var P = window.Painel;
  var h = P.h;
  var PX = 1.8; // pixels por minuto: 1 hora = 108 px
  var PASSO = 5; // o arraste anda de 5 em 5 minutos
  var MOVEIS = ["pendente", "confirmado", "avulso"];
  var VISIVEIS = ["pendente", "confirmado", "avulso", "realizado", "nao_realizado"];
  var arraste = null; // arraste em andamento (o quadro não é redesenhado no meio dele)

  function min(t) { var p = String(t || "").slice(0, 5).split(":"); return Number(p[0]) * 60 + Number(p[1]); }
  function hm(m) { m = Math.max(0, Math.min(24 * 60 - 1, Math.round(m))); return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); }
  function agoraMin() { var d = new Date(Date.now() - 3 * 36e5); return d.getUTCHours() * 60 + d.getUTCMinutes(); }
  function duracao(p) { return Number(p.duracao_min) || 30; }

  // Horas do quadro: do primeiro início (de agenda ou atendimento) ao último fim, em horas cheias
  function faixa(colunas, pedidos) {
    var ini = Infinity, fim = -Infinity;
    colunas.forEach(function (c) { if (c.agenda) { ini = Math.min(ini, min(c.agenda.inicio)); fim = Math.max(fim, min(c.agenda.fim)); } });
    pedidos.forEach(function (p) { var a = min(p.horario); ini = Math.min(ini, a); fim = Math.max(fim, a + duracao(p)); });
    if (!isFinite(ini)) { ini = 8 * 60; fim = 20 * 60; }
    return { ini: Math.floor(ini / 60) * 60, fim: Math.min(24 * 60, Math.ceil(fim / 60) * 60) };
  }

  // Faixas que não são horário de atendimento: antes do início, depois do fim, almoço e bloqueios
  function sombras(c, f) {
    var lista = [];
    var a = c.agenda;
    if (a && a.publicada) {
      if (min(a.inicio) > f.ini) lista.push({ de: f.ini, ate: min(a.inicio), texto: "" });
      if (min(a.fim) < f.fim) lista.push({ de: min(a.fim), ate: f.fim, texto: "" });
      if (a.almocoInicio && a.almocoFim) lista.push({ de: min(a.almocoInicio), ate: min(a.almocoFim), texto: "Almoço", pausa: true });
    }
    (c.bloqueios || []).forEach(function (b) { lista.push({ de: min(b.inicio), ate: min(b.fim), texto: b.motivo || "Bloqueado", pausa: true }); });
    return lista;
  }

  // Horário mudado pela barbearia que o cliente ainda não aceitou
  function aguarda(p) { return !!p.remarcado_em && !p.cliente_resposta && MOVEIS.indexOf(p.status) > -1; }
  function classeDe(p) {
    return "q-bloco " + p.status + (p.cliente_resposta === "sim" ? " confirmou" : "") + (aguarda(p) ? " aguarda" : "") + (duracao(p) < 25 ? " curto" : "");
  }

  function bloco(p, f, podeMover) {
    var top = (min(p.horario) - f.ini) * PX;
    var fim = min(p.horario) + duracao(p);
    var selos = [];
    if (p.chegou_em) selos.push("chegou");
    if (p.sinal_status === "aguardando") selos.push("sinal");
    if (p.clube_assinante_id) selos.push("clube");
    if (aguarda(p)) selos.push("aguarda aceite");
    var el = h("div", {
      class: classeDe(p) + (podeMover ? " movel" : ""),
      style: "top:" + top + "px;height:" + Math.max(18, duracao(p) * PX - 2) + "px",
      tabindex: "0",
      role: "button",
      "aria-label": P.hm(p.horario) + " a " + hm(fim) + ", " + p.cliente + ", " + p.servico + (podeMover ? ". Segure e arraste para mudar o horário." : ""),
    }, [
      h("b", { texto: P.hm(p.horario) + " " + p.cliente }),
      h("small", { texto: p.servico + (selos.length ? " · " + selos.join(" · ") : "") }),
    ]);
    el.dataset.id = p.id;
    return el;
  }

  function desenhar(alvo, dados, ctx, op) {
    op = op || {};
    if (arraste) return; // não mexe no quadro com um horário na mão
    var dia = op.dia || dados.dia;
    var hoje = P.hoje();
    var editavel = dia >= hoje;
    var colunas = (dados.equipe || []).filter(function (e) { return !op.filtro || e.id === op.filtro; });
    if (!colunas.length) { P.trocar(alvo, P.vazio("🗓️", "Ninguém na equipe para mostrar neste dia.")); return; }
    var ids = colunas.map(function (c) { return c.id; });
    var pedidos = (dados.pedidos || []).filter(function (p) { return VISIVEIS.indexOf(p.status) > -1 && ids.indexOf(p.profissional_id) > -1; });
    var f = faixa(colunas, pedidos);
    var altura = (f.fim - f.ini) * PX;
    var antigo = alvo.querySelector(".quadro");
    var rolagem = antigo ? { top: antigo.scrollTop, left: antigo.scrollLeft } : null;
    var mudarColuna = !!op.mudarColuna && colunas.length > 1;
    function redesenhar() { desenhar(alvo, dados, ctx, op); }

    var cab = h("div", { class: "q-cab" }, [h("div", { class: "q-canto" })].concat(colunas.map(function (c) {
      var temProximos = editavel && pedidos.some(function (p) { return p.profissional_id === c.id && MOVEIS.indexOf(p.status) > -1 && (dia > hoje || min(p.horario) + duracao(p) > agoraMin()); });
      // No celular, só o ícone (o nome do barbeiro fica com o espaço); a palavra volta na tela larga
      var atrasar = temProximos ? h("button", { type: "button", class: "q-atrasar", title: "Atrasar os próximos", "aria-label": "Atrasar os próximos horários de " + c.nome }, [P.icone("relogio"), h("span", { class: "q-rotulo", texto: "Atrasar" })]) : null;
      if (atrasar) atrasar.onclick = function () { atrasarProximos(c, dia, ctx); };
      var semAgenda = !c.agenda || !c.agenda.publicada;
      return h("div", { class: "q-nome" }, [P.avatar(c, "p"), h("span", { class: "q-quem" }, [h("b", { texto: c.nome }), semAgenda ? h("small", { texto: "agenda não publicada" }) : null]), atrasar]);
    })));

    var horas = h("div", { class: "q-horas", style: "height:" + altura + "px" });
    for (var m = f.ini; m <= f.fim; m += 60) horas.appendChild(h("span", { style: "top:" + (m - f.ini) * PX + "px", texto: hm(m) }));

    var corpo = h("div", { class: "q-corpo" }, [horas]);
    var cols = colunas.map(function (c) {
      var col = h("div", { class: "q-col", style: "height:" + altura + "px" });
      col.dataset.id = c.id;
      sombras(c, f).forEach(function (s) {
        var de = Math.max(s.de, f.ini), ate = Math.min(s.ate, f.fim);
        if (ate <= de) return;
        col.appendChild(h("div", { class: "q-sombra" + (s.pausa ? " pausa" : ""), style: "top:" + (de - f.ini) * PX + "px;height:" + (ate - de) * PX + "px" }, s.texto ? h("span", { texto: s.texto }) : null));
      });
      pedidos.filter(function (p) { return p.profissional_id === c.id; }).forEach(function (p) {
        var podeMover = editavel && MOVEIS.indexOf(p.status) > -1 && (dia > hoje || min(p.horario) + duracao(p) > agoraMin() - 5);
        var el = bloco(p, f, podeMover);
        ligarBloco(el, p, { f: f, col: col, cols: function () { return cols; }, colunas: colunas, grade: function () { return grade; }, ctx: ctx, dia: dia, hoje: hoje, podeMover: podeMover, mudarColuna: mudarColuna, redesenhar: redesenhar });
        col.appendChild(el);
      });
      // Espaço livre: tocar abre o encaixe naquela hora (de 15 em 15 minutos)
      col.addEventListener("click", function (e) {
        if (!editavel || e.target.closest(".q-bloco")) return;
        var r = col.getBoundingClientRect();
        var hora = f.ini + Math.floor((e.clientY - r.top) / PX / 15) * 15;
        if (dia === hoje && hora + 15 < agoraMin()) { P.toast("Esse horário já passou."); return; }
        P.encaixe(ctx, { dia: dia, horario: hm(hora), profissionalId: c.id });
      });
      corpo.appendChild(col);
      return col;
    });
    if (dia === hoje) {
      var agora = agoraMin();
      if (agora >= f.ini && agora <= f.fim) corpo.appendChild(h("div", { class: "q-agora", style: "top:" + (agora - f.ini) * PX + "px", "aria-hidden": "true" }));
    }
    var grade = h("div", { class: "quadro", style: "--n:" + colunas.length + ";--px-hora:" + 60 * PX + "px" }, [cab, corpo]);
    var dica = editavel
      ? (mudarColuna ? "Segure um horário e arraste para cima, para baixo ou para outro barbeiro. Toque num espaço livre para encaixar." : "Segure um horário e arraste para cima ou para baixo. Toque num espaço livre para encaixar.")
      : "Dia que já passou: toque num horário para ver e encerrar.";
    // Em cima do quadro: a dica e "Tela cheia"; na tela cheia, fechar, o dia e as setas para trocar de dia
    var barra = alvo.classList.contains("q-cheio")
      ? h("div", { class: "q-barra cheia" }, [botaoCheio(alvo, false, redesenhar), navDia(-1), h("b", { class: "q-titulo", texto: P.dataLonga(dia) }), navDia(1), P.demo && P.demo() ? h("span", { class: "q-demo", texto: "Demonstração" }) : null])
      : h("div", { class: "q-barra" }, [h("p", { class: "nota p q-dica", texto: dica }), botaoCheio(alvo, true, redesenhar)]);
    P.trocar(alvo, [barra, grade]);
    // Volta onde estava; na primeira vez, abre perto de agora (ou do primeiro horário)
    if (rolagem) { grade.scrollTop = rolagem.top; grade.scrollLeft = rolagem.left; }
    else {
      var foco = dia === hoje ? agoraMin() : pedidos.length ? Math.min.apply(null, pedidos.map(function (p) { return min(p.horario); })) : f.ini;
      grade.scrollTop = Math.max(0, (foco - f.ini) * PX - 90);
    }
  }

  // ---------- Tela cheia ----------
  // O quadro cobre a tela (o topo e as abas do painel saem da frente) e, onde o navegador deixa (Android), some
  // também a barra do navegador. Fecha no botão, no Esc, ao sair da tela cheia do navegador ou ao trocar de aba.
  // Os avisos (toasts) e as janelas continuam aparecendo por cima.
  var cheioAtual = null;
  function botaoCheio(alvo, ligar, redesenhar) {
    var b = ligar
      ? h("button", { type: "button", class: "botao p q-btn-cheio", "aria-label": "Abrir o quadro em tela cheia" }, [P.icone("expandir"), h("span", { texto: "Tela cheia" })])
      : h("button", { type: "button", class: "icone q-btn-cheio", "aria-label": "Sair da tela cheia", title: "Sair da tela cheia" }, P.icone("recolher"));
    b.onclick = function () { if (ligar) abrirTelaCheia(alvo, redesenhar); else fecharTelaCheia(); };
    return b;
  }
  // As setas da tela cheia usam as mesmas do painel (que já sabem trocar de dia e recarregar)
  function navDia(passo) {
    var original = document.getElementById(passo < 0 ? "diaAnt" : "diaProx");
    if (!original) return null;
    var b = h("button", { type: "button", class: "icone", "aria-label": passo < 0 ? "Dia anterior" : "Próximo dia" }, P.icone(passo < 0 ? "seta_esq" : "seta_dir"));
    b.onclick = function () { original.click(); };
    return b;
  }
  function abrirTelaCheia(alvo, redesenhar) {
    if (cheioAtual) return;
    var raiz = document.documentElement;
    cheioAtual = { alvo: alvo, redesenhar: redesenhar, doNavegador: false };
    alvo.classList.add("q-cheio");
    raiz.classList.add("q-sem-rolagem");
    document.addEventListener("fullscreenchange", aoMudarTelaCheia);
    document.addEventListener("keydown", aoTeclar);
    window.addEventListener("hashchange", fecharTelaCheia);
    try {
      if (raiz.requestFullscreen && !document.fullscreenElement) {
        var pedido = raiz.requestFullscreen({ navigationUI: "hide" });
        if (pedido && pedido.then) pedido.then(function () { if (cheioAtual) cheioAtual.doNavegador = true; }, function () {});
      }
    } catch (e) {}
    redesenhar();
  }
  function fecharTelaCheia() {
    if (!cheioAtual) return;
    var c = cheioAtual;
    cheioAtual = null;
    c.alvo.classList.remove("q-cheio");
    document.documentElement.classList.remove("q-sem-rolagem");
    document.removeEventListener("fullscreenchange", aoMudarTelaCheia);
    document.removeEventListener("keydown", aoTeclar);
    window.removeEventListener("hashchange", fecharTelaCheia);
    try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {}); } catch (e) {}
    c.redesenhar();
  }
  // Saiu da tela cheia do navegador (botão voltar do Android, Esc no computador): o quadro volta ao lugar
  function aoMudarTelaCheia() { if (cheioAtual && cheioAtual.doNavegador && !document.fullscreenElement) fecharTelaCheia(); }
  function aoTeclar(e) { if (e.key === "Escape" && !document.querySelector("dialog[open]")) fecharTelaCheia(); }

  // Toque: abre o atendimento (com as ações de sempre). Segurar e arrastar: muda o horário.
  function ligarBloco(el, p, q) {
    var estado = null;
    var suprimirClique = false;
    el.addEventListener("click", function () {
      if (suprimirClique) { suprimirClique = false; return; }
      abrirDetalhes(p, q.ctx);
    });
    el.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrirDetalhes(p, q.ctx); } });
    if (!q.podeMover) return;
    el.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    // No celular, o arraste começa depois de segurar; aí a tela para de rolar
    el.addEventListener("touchmove", function (e) { if (estado && estado.ativo) e.preventDefault(); }, { passive: false });
    el.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || arraste) return;
      suprimirClique = false;
      var grade = q.grade();
      estado = { id: e.pointerId, x: e.clientX, y: e.clientY, ultX: e.clientX, ultY: e.clientY, rolagem: grade.scrollTop, ativo: false, toque: e.pointerType !== "mouse", min: min(p.horario), col: q.col, timer: null };
      if (estado.toque) estado.timer = setTimeout(function () { ativar(); }, 380);
    });
    el.addEventListener("pointermove", function (e) {
      if (!estado || e.pointerId !== estado.id) return;
      estado.ultX = e.clientX;
      estado.ultY = e.clientY;
      var dist = Math.abs(e.clientX - estado.x) + Math.abs(e.clientY - estado.y);
      if (!estado.ativo) {
        if (estado.toque) { if (dist > 10) cancelar(); return; } // rolando a tela
        if (dist > 5) ativar();
        return;
      }
      mover();
    });
    el.addEventListener("pointerup", function (e) { if (estado && e.pointerId === estado.id) soltar(); });
    el.addEventListener("pointercancel", function () { if (estado) { var ativo = estado.ativo; cancelar(); if (ativo) q.redesenhar(); } });

    function ativar() {
      if (!estado || estado.ativo) return;
      clearTimeout(estado.timer);
      estado.ativo = true;
      suprimirClique = true;
      arraste = estado;
      try { el.setPointerCapture(estado.id); } catch (x) {}
      try { if (navigator.vibrate) navigator.vibrate(12); } catch (x) {}
      // Onde estava: um contorno tracejado
      estado.fantasma = h("div", { class: "q-fantasma", style: "top:" + el.style.top + ";height:" + el.style.height });
      q.col.appendChild(estado.fantasma);
      estado.etiqueta = h("div", { class: "q-etiqueta" });
      el.appendChild(estado.etiqueta);
      el.classList.add("arrastando");
      estado.rolar = requestAnimationFrame(rolarNaBorda);
      mover();
    }
    function cancelar() {
      if (!estado) return;
      clearTimeout(estado.timer);
      cancelAnimationFrame(estado.rolar);
      if (estado.fantasma) estado.fantasma.remove();
      if (estado.etiqueta) estado.etiqueta.remove();
      el.classList.remove("arrastando");
      estado = null;
      arraste = null;
    }
    // Perto da borda de cima ou de baixo (ou dos lados), o quadro rola sozinho
    function rolarNaBorda() {
      if (!estado || !estado.ativo) return;
      // Só depois que o dedo andou um pouco: segurar perto da borda, parado, não rola o quadro
      if (Math.abs(estado.ultY - estado.y) + Math.abs(estado.ultX - estado.x) < 14) { estado.rolar = requestAnimationFrame(rolarNaBorda); return; }
      var grade = q.grade();
      var r = grade.getBoundingClientRect();
      var dy = estado.ultY < r.top + 56 ? -9 : estado.ultY > r.bottom - 40 ? 9 : 0;
      var dx = q.mudarColuna ? (estado.ultX < r.left + 70 ? -9 : estado.ultX > r.right - 30 ? 9 : 0) : 0;
      if (dy || dx) { grade.scrollTop += dy; grade.scrollLeft += dx; mover(); }
      estado.rolar = requestAnimationFrame(rolarNaBorda);
    }
    function colunaSob(x) {
      var cols = q.cols();
      for (var i = 0; i < cols.length; i++) { var r = cols[i].getBoundingClientRect(); if (x >= r.left && x < r.right) return cols[i]; }
      return null;
    }
    function mover() {
      if (!estado || !estado.ativo) return;
      var grade = q.grade();
      var dy = estado.ultY - estado.y + (grade.scrollTop - estado.rolagem);
      var dur = duracao(p);
      var novo = Math.round((min(p.horario) + dy / PX) / PASSO) * PASSO;
      var menor = q.f.ini;
      if (q.dia === q.hoje) menor = Math.max(menor, Math.ceil((agoraMin() - 5) / PASSO) * PASSO);
      novo = Math.max(menor, Math.min(q.f.fim - dur, novo));
      estado.min = novo;
      if (q.mudarColuna) {
        var c = colunaSob(estado.ultX);
        if (c && c !== estado.col) { estado.col = c; c.appendChild(el); }
      }
      el.style.top = (novo - q.f.ini) * PX + "px";
      var nome = (q.colunas.filter(function (x) { return x.id === estado.col.dataset.id; })[0] || {}).nome || "";
      estado.etiqueta.textContent = hm(novo) + (estado.col !== q.col ? " · " + nome : "");
    }
    function soltar() {
      if (!estado) return;
      if (!estado.ativo) { clearTimeout(estado.timer); estado = null; return; } // foi um toque: o clique abre o atendimento
      var novo = estado.min;
      var col = estado.col;
      var mudou = novo !== min(p.horario) || col !== q.col;
      cancelar();
      if (!mudou) { q.redesenhar(); return; }
      var destino = q.colunas.filter(function (x) { return x.id === col.dataset.id; })[0];
      confirmarMudanca(p, novo, destino, q);
    }
  }

  function confirmarMudanca(p, novo, destino, q) {
    var ctx = q.ctx;
    var outroBarbeiro = destino && destino.id !== p.profissional_id;
    var tel = P.telefoneDe(p);
    var avisar = h("input", { type: "checkbox", checked: true });
    var zap = h("input", { type: "checkbox", checked: true });
    var para = hm(novo);
    P.janela({
      titulo: "Mover " + P.primeiroNome(p.cliente),
      conteudo: h("div", { class: "grade" }, [
        h("p", { class: "nota", texto: p.servico + ": de " + P.hm(p.horario) + " para " + para + (outroBarbeiro ? ", com " + destino.nome : "") + "." }),
        h("label", { class: "check-linha" }, [avisar, "Avisar no celular (se ele ligou os avisos da barbearia)"]),
        h("label", { class: "check-linha" }, [zap, tel ? "Mandar no WhatsApp se ele não tiver os avisos no celular" : "Mandar no WhatsApp se ele não tiver os avisos (sem número no cadastro: você escolhe a conversa)"]),
        h("p", { class: "nota p", texto: "O cliente recebe o novo horário com \"Aceito\" e \"Não posso\". Até ele responder, o horário fica marcado como aguardando aceite." }),
      ]),
      acoes: [{ texto: "Voltar", valor: "cancelar" }, { texto: "Mover", classe: "principal", valor: "ok" }],
    }).then(function (r) {
      if (r.valor !== "ok") { q.redesenhar(); return; }
      var corpo = { acao: "remarcar", id: p.id, dia: p.dia, horario: para, duracao: duracao(p), avisar: avisar.checked, whatsapp: zap.checked };
      if (outroBarbeiro) corpo.profissionalId = destino.id;
      P.api("/api/pedido", { corpo: corpo }).then(function (res) {
        var msg = "Movido para " + para + (outroBarbeiro ? " com " + destino.nome : "") + "." + (res.avisados ? " Cliente avisado no celular." : "");
        var novoPedido = Object.assign({}, p, res.pedido || {}, { horario: para, profissional: outroBarbeiro ? destino.nome : p.profissional });
        var extra = { link: res.link ? location.origin + res.link : "", era: P.horarioAnterior(p, p.dia) };
        ctx.recarregar();
        // Recebeu no celular: o WhatsApp fica como opção no aviso; não recebeu: a mensagem já vai pronta
        if (!zap.checked) { P.toast(msg, "ok"); return; }
        if (res.avisados) { P.toast(msg, "ok", { texto: "WhatsApp também", acao: function () { P.abrirWhats(P.mensagem("remarcado", novoPedido, ctx.barbearia, extra), tel); } }); return; }
        P.toast(msg, "ok");
        P.oferecerWhats("remarcado", novoPedido, ctx, "Mandar a mudança no WhatsApp", extra);
      }).catch(function (e) { P.toast(e.message, "erro"); q.redesenhar(); ctx.recarregar(); });
    });
  }

  // O atendimento numa janela, com as mesmas ações da lista (confirmar, encerrar, remarcar, cancelar...)
  function abrirDetalhes(p, ctx) {
    var d = h("dialog", { class: "dlg" });
    function fechar() { if (d.open) d.close(); }
    var c2 = Object.assign({}, ctx, { recarregar: function () { fechar(); ctx.recarregar(); } });
    d.appendChild(h("div", { class: "dlg-corpo" }, [
      h("div", { class: "dlg-topo" }, [h("h2", { texto: P.hm(p.horario) + " · " + P.primeiroNome(p.cliente) }), h("button", { type: "button", class: "icone", "aria-label": "Fechar", onclick: fechar }, P.icone("x"))]),
      P.cartaoPedido(p, c2, { mostrarBarbeiro: true, mostrarDia: false }),
    ]));
    d.addEventListener("close", function () { setTimeout(function () { d.remove(); }, 300); });
    d.addEventListener("click", function (e) { if (e.target === d) fechar(); });
    document.body.appendChild(d);
    d.showModal();
  }

  // Atraso ou imprevisto: empurra os próximos horários do barbeiro (o servidor faz tudo de uma vez)
  function atrasarProximos(c, dia, ctx) {
    var hoje = P.hoje();
    var aPartir = h("input", { type: "time", step: 300, value: dia === hoje ? hm(Math.ceil(agoraMin() / 5) * 5) : (c.agenda && c.agenda.inicio) || "08:00" });
    var escolhido = 15;
    var chips = h("div", { class: "linha chips-tempo" }, [5, 10, 15, 20, 30, 45, 60].map(function (m) {
      var b = h("button", { type: "button", class: "botao p" + (m === escolhido ? " principal" : ""), "aria-pressed": m === escolhido ? "true" : "false", texto: m + " min" });
      b.onclick = function () {
        escolhido = m;
        [].forEach.call(chips.children, function (x) { x.classList.remove("principal"); x.setAttribute("aria-pressed", "false"); });
        b.classList.add("principal");
        b.setAttribute("aria-pressed", "true");
      };
      return b;
    }));
    var avisar = h("input", { type: "checkbox", checked: true });
    var zap = h("input", { type: "checkbox", checked: true });
    P.janela({
      titulo: "Atrasar os próximos de " + P.primeiroNome(c.nome),
      conteudo: h("div", { class: "grade" }, [
        h("p", { class: "nota", texto: "Empurra os horários de " + c.nome + " a partir da hora escolhida. Quem não couber fica onde está e o painel avisa." }),
        h("label", { class: "campo" }, ["A partir de", aPartir]),
        h("div", { class: "campo" }, [h("span", { texto: "Quanto" }), chips]),
        h("label", { class: "check-linha" }, [avisar, "Avisar os clientes no celular (quem ligou os avisos)"]),
        h("label", { class: "check-linha" }, [zap, "Mandar no WhatsApp para quem não tiver os avisos no celular"]),
        h("p", { class: "nota p", texto: "Cada cliente recebe o novo horário com \"Aceito\" e \"Não posso\"." }),
      ]),
      acoes: [{ texto: "Voltar", valor: "cancelar" }, { texto: "Atrasar", classe: "principal", valor: "ok" }],
    }).then(function (r) {
      if (r.valor !== "ok") return;
      P.api("/api/pedido", { corpo: { acao: "atrasar", profissionalId: c.id, dia: dia, aPartirDe: aPartir.value, minutos: escolhido, avisar: avisar.checked, whatsapp: zap.checked } }).then(function (res) {
        var t = res.movidos ? res.movidos + (res.movidos === 1 ? " horário empurrado " : " horários empurrados ") + escolhido + " min." : "Nenhum horário para empurrar a partir dessa hora.";
        if (res.avisados) t += " " + res.avisados + (res.avisados === 1 ? " cliente avisado" : " clientes avisados") + " no celular.";
        if (res.falhas && res.falhas.length) t += " Não couberam: " + res.falhas.map(function (x) { return x.cliente + " (" + x.horario + ", " + x.motivo + ")"; }).join("; ") + ".";
        P.toast(t, res.falhas && res.falhas.length ? "erro" : "ok");
        ctx.recarregar();
        var semAviso = (res.lista || []).filter(function (x) { return !x.avisado; });
        if (zap.checked && semAviso.length) whatsDosAtrasados(semAviso, ctx);
      }).catch(function (e) { P.toast(e.message, "erro"); });
    });
  }

  // Depois de atrasar: um botão de WhatsApp por cliente que não recebeu no celular (cada toque abre a conversa)
  function whatsDosAtrasados(lista, ctx) {
    var linhas = lista.map(function (x) {
      var b = h("button", { type: "button", class: "botao p whats" }, [P.icone("whats"), "WhatsApp"]);
      b.onclick = function () {
        var p = { cliente: x.cliente, dia: x.dia, horario: x.para, servico: x.servico, profissional: x.profissional, codigo: x.codigo };
        P.abrirWhats(P.mensagem("remarcado", p, ctx.barbearia, { link: x.link ? location.origin + x.link : "", era: x.de }), x.telefone);
        P.trocar(b, [P.icone("check"), "Aberto"]);
        b.classList.remove("whats");
      };
      return h("li", null, [h("span", null, [h("b", { texto: x.cliente }), h("small", { texto: x.de + " → " + x.para + (x.telefone ? "" : " · sem WhatsApp no cadastro") })]), b]);
    });
    P.janela({
      titulo: "Avisar pelo WhatsApp",
      conteudo: h("div", { class: "grade" }, [h("p", { class: "nota", texto: lista.length === 1 ? "Este cliente não recebeu o aviso no celular. A mensagem já vai pronta, com o link para aceitar ou recusar." : "Estes clientes não receberam o aviso no celular. Toque em cada um: a mensagem já vai pronta, com o link para aceitar ou recusar." }), h("ul", { class: "mini-lista zap-lista" }, linhas)]),
      acoes: [{ texto: "Fechar", classe: "principal", valor: "ok" }],
    });
  }

  // Modo da agenda (lista ou quadro), lembrado neste aparelho
  function modo(novo) {
    try {
      if (novo) localStorage.setItem("bio_agenda_modo", novo);
      return localStorage.getItem("bio_agenda_modo") === "lista" ? "lista" : "quadro";
    } catch (e) { return novo || "quadro"; }
  }

  window.Quadro = { desenhar: desenhar, modo: modo, arrastando: function () { return !!arraste; }, telaCheia: function () { return !!cheioAtual; }, fecharTelaCheia: fecharTelaCheia, _: { faixa: faixa, sombras: sombras, hm: hm, min: min } };
})();
