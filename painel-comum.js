// Base comum dos painéis do dono e do barbeiro: montagem segura da tela (sem innerHTML com dados),
// formatação, chamadas à API, mensagens rápidas, janelas de confirmação, abas, atualização automática,
// alerta de pedido novo e monitoramento (erros e tempos de carregamento).
// Usa o conta.js (window.Conta).
(function () {
  "use strict";
  var P = {};

  // ---------- montagem segura da tela ----------
  // Todo texto entra como textContent: nada que vem do banco vira HTML.
  function h(tag, props, filhos) {
    var e = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v == null || v === false) return;
        if (k === "class") e.className = v;
        else if (k === "texto") e.textContent = v;
        else if (k.indexOf("on") === 0 && typeof v === "function") e.addEventListener(k.slice(2), v);
        else if (k === "dataset") Object.keys(v).forEach(function (d) { e.dataset[d] = v[d]; });
        else if (k === "value") e.value = v;
        else if (k === "checked") e.checked = !!v;
        else if (v === true) e.setAttribute(k, "");
        else e.setAttribute(k, String(v));
      });
    }
    junta(e, filhos);
    return e;
  }
  function junta(e, filhos) {
    if (filhos == null || filhos === false) return;
    if (Array.isArray(filhos)) { filhos.forEach(function (f) { junta(e, f); }); return; }
    e.appendChild(typeof filhos === "object" && filhos.nodeType ? filhos : document.createTextNode(String(filhos)));
  }
  P.h = h;
  P.$ = function (id) { return document.getElementById(id); };
  P.limpar = function (e) { while (e && e.firstChild) e.removeChild(e.firstChild); return e; };
  P.trocar = function (e, filhos) { P.limpar(e); junta(e, filhos); return e; };

  // ---------- ícones (traço simples, 24x24) ----------
  var ICONES = {
    hoje: "M8 2v3M16 2v3M3.5 9h17M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V6A1.5 1.5 0 0 1 5 4.5zM8 13h3v3H8z",
    agenda: "M8 2v3M16 2v3M3.5 9h17M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V6A1.5 1.5 0 0 1 5 4.5zM7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2",
    pedidos: "M4 13l2.5-7.5A1.5 1.5 0 0 1 7.9 4.5h8.2a1.5 1.5 0 0 1 1.4 1L20 13M4 13v5.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V13M4 13h4.5l1.5 2.5h4l1.5-2.5H20",
    mais: "M4 7h16M4 12h16M4 17h16",
    historico: "M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4v4h4M12 7.5V12l3 2",
    perfil: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5a7.5 7.5 0 0 1 15 0",
    atualizar: "M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9M18.5 3.5v4h-4M5.5 20.5v-4h4",
    check: "M5 12.5l4.5 4.5L19 7.5",
    x: "M6 6l12 12M18 6L6 18",
    relogio: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2",
    dinheiro: "M3.5 7h17v10h-17zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6.5 10v4M17.5 10v4",
    equipe: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.2a6.5 6.5 0 0 1 3.5 5.8",
    grafico: "M4 20V10M10 20V4M16 20v-7M21.5 20H2.5",
    site: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3.5 12h17M12 3a13.5 13.5 0 0 1 0 18M12 3a13.5 13.5 0 0 0 0 18",
    link: "M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1",
    sino: "M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0",
    sair: "M14 4.5h4.5A1.5 1.5 0 0 1 20 6v12a1.5 1.5 0 0 1-1.5 1.5H14M10 16l-4-4 4-4M6 12h10",
    baixar: "M12 4v11M7.5 10.5L12 15l4.5-4.5M4.5 19.5h15",
    mais_um: "M12 5v14M5 12h14",
    whats: "M4 20l1.3-4A8 8 0 1 1 8 18.7zM9 9.5c.3 2.5 2.5 4.7 5 5l1.3-1.3 1.7.8v1.5c-4.2.4-8.6-4-8.2-8.2H10.3l.8 1.7z",
    tesoura: "M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.1 7.9L20 19M8.1 16.1L20 5",
    trava: "M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9.5h-13zM12 15v2",
    seta_esq: "M15 5l-7 7 7 7",
    seta_dir: "M9 5l7 7-7 7",
    saude: "M3 12h4l2.5-6 4 12 2.5-6h5",
  };
  P.icone = function (nome) {
    var NS = "http://www.w3.org/2000/svg";
    var s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "1.8");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true");
    var p = document.createElementNS(NS, "path");
    p.setAttribute("d", ICONES[nome] || "");
    s.appendChild(p);
    return s;
  };

  // ---------- formatação ----------
  var DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  var DIAS_CURTO = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  P.brl = function (n) { return Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); };
  P.hoje = function () { return new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10); };
  P.somaDias = function (iso, n) { var d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  P.dataBr = function (iso) { var p = String(iso).split("-"); return p[2] + "/" + p[1]; };
  P.diaSemana = function (iso) { return new Date(iso + "T12:00:00Z").getUTCDay(); };
  P.diaCurto = function (iso) { return DIAS_CURTO[P.diaSemana(iso)] + " " + P.dataBr(iso); };
  P.dataLonga = function (iso) {
    if (iso === P.hoje()) return "Hoje, " + P.dataBr(iso);
    if (iso === P.somaDias(P.hoje(), 1)) return "Amanhã, " + P.dataBr(iso);
    if (iso === P.somaDias(P.hoje(), -1)) return "Ontem, " + P.dataBr(iso);
    var d = DIAS[P.diaSemana(iso)];
    return d.charAt(0).toUpperCase() + d.slice(1) + ", " + P.dataBr(iso);
  };
  P.hm = function (t) { return String(t || "").slice(0, 5); };
  P.min = function (t) { var p = String(t).split(":"); return Number(p[0]) * 60 + Number(p[1]); };
  P.agoraMin = function () { var b = new Date(Date.now() - 3 * 36e5); return b.getUTCHours() * 60 + b.getUTCMinutes(); };
  P.duracao = function (min) { min = Number(min) || 0; var hh = Math.floor(min / 60), mm = min % 60; return hh ? hh + "h" + (mm ? String(mm).padStart(2, "0") : "") : mm + " min"; };
  P.daquiA = function (min) {
    if (min <= 0) return "agora";
    if (min < 60) return "em " + min + " min";
    var hh = Math.floor(min / 60), mm = min % 60;
    return "em " + hh + "h" + (mm ? String(mm).padStart(2, "0") : "");
  };
  P.iniciais = function (nome) { return String(nome || "?").trim().split(/\s+/).slice(0, 2).map(function (x) { return x.charAt(0); }).join("").toUpperCase() || "?"; };
  P.primeiroNome = function (nome) { return String(nome || "").trim().split(/\s+/)[0] || ""; };
  P.avatar = function (pessoa, tamanho) {
    var a = h("span", { class: "avatar" + (tamanho ? " " + tamanho : "") });
    if (pessoa && pessoa.foto_url && /^https:\/\//.test(pessoa.foto_url)) a.appendChild(h("img", { src: pessoa.foto_url, alt: "", loading: "lazy" }));
    else a.textContent = P.iniciais(pessoa && pessoa.nome);
    return a;
  };

  P.STATUS = {
    pendente: ["Aguardando confirmação", "alerta"],
    confirmado: ["Confirmado", "ok"],
    avulso: ["Encaixe", "info"],
    realizado: ["Realizado", "ok-forte"],
    nao_realizado: ["Não realizado", "neutro"],
    recusado: ["Recusado", "erro"],
    cancelado: ["Cancelado", "neutro"],
  };
  P.selo = function (p) {
    var s = P.STATUS[p.status] || [p.status, "neutro"];
    var t = s[0];
    if (p.motivo) t += " · " + (p.motivo === "reagendado" ? "reagendado" : "faltou");
    return h("span", { class: "selo selo-" + s[1], texto: t });
  };
  P.ativo = function (p) { return ["pendente", "confirmado", "avulso", "realizado"].indexOf(p.status) > -1; };

  // ---------- API ----------
  // Conta da plataforma abrindo o painel de um site (?barbearia=id): as chamadas levam esse id
  P.ctx = new URLSearchParams(location.search).get("barbearia") || "";
  P.api = function (caminho, opcoes) {
    if (P.ctx) caminho += (caminho.indexOf("?") > -1 ? "&" : "?") + "barbearia=" + encodeURIComponent(P.ctx);
    return window.Conta.api(caminho, opcoes);
  };
  P.link = function (pagina) { return P.ctx ? pagina + (pagina.indexOf("?") > -1 ? "&" : "?") + "barbearia=" + encodeURIComponent(P.ctx) : pagina; };

  // Botão ocupado enquanto a ação roda (evita clique duplo)
  P.acao = function (botao, promessa) {
    if (botao) { botao.classList.add("ocupado"); botao.disabled = true; }
    return Promise.resolve(promessa).finally(function () { if (botao) { botao.classList.remove("ocupado"); botao.disabled = false; } });
  };

  // ---------- mensagens rápidas ----------
  P.toast = function (msg, tipo) {
    var box = P.$("toasts");
    if (!box) { box = h("div", { id: "toasts", class: "toasts", "aria-live": "polite" }); document.body.appendChild(box); }
    var t = h("div", { class: "toast " + (tipo || ""), role: tipo === "erro" ? "alert" : "status", texto: msg });
    box.appendChild(t);
    setTimeout(function () { t.classList.add("sai"); setTimeout(function () { t.remove(); }, 400); }, tipo === "erro" ? 6500 : 3500);
  };

  // ---------- janelas ----------
  // opcoes: { titulo, conteudo, acoes: [{ texto, classe, valor }], validar(valor, form) -> mensagem de erro }
  P.janela = function (opcoes) {
    return new Promise(function (resolve) {
      var d = h("dialog", { class: "dlg", "aria-label": opcoes.titulo || "" });
      var acoes = opcoes.acoes || [{ texto: "OK", classe: "principal", valor: "ok" }];
      var form = h("form", { method: "dialog", class: "dlg-corpo" }, [
        h("div", { class: "dlg-topo" }, [h("h2", { texto: opcoes.titulo || "" }), h("button", { type: "button", class: "icone", "aria-label": "Fechar", onclick: function () { d.close(""); } }, P.icone("x"))]),
        opcoes.conteudo || null,
        h("div", { class: "dlg-acoes" }, acoes.map(function (a) { return h("button", { value: a.valor, class: "botao " + (a.classe || ""), texto: a.texto }); })),
      ]);
      form.addEventListener("submit", function (ev) {
        var v = ev.submitter ? ev.submitter.value : "ok";
        if (opcoes.validar && v && v !== "cancelar") {
          var erro = opcoes.validar(v, form);
          if (erro) { ev.preventDefault(); P.toast(erro, "erro"); }
        }
      });
      d.appendChild(form);
      d.addEventListener("close", function () {
        resolve({ valor: d.returnValue, form: form });
        setTimeout(function () { d.remove(); }, 300);
      });
      document.body.appendChild(d);
      d.showModal();
      var foco = form.querySelector("input,select,textarea");
      if (foco) setTimeout(function () { foco.focus(); }, 60);
    });
  };
  P.confirmar = function (titulo, texto, rotulo, perigo) {
    return P.janela({
      titulo: titulo,
      conteudo: h("p", { class: "nota", texto: texto }),
      acoes: [{ texto: "Voltar", valor: "cancelar" }, { texto: rotulo || "Confirmar", classe: perigo ? "perigo" : "principal", valor: "ok" }],
    }).then(function (r) { return r.valor === "ok"; });
  };

  // ---------- WhatsApp (sem número: o WhatsApp pergunta para quem enviar) ----------
  P.whats = function (texto) { return "https://wa.me/?text=" + encodeURIComponent(texto); };
  P.mensagem = function (tipo, p, barbearia) {
    var nome = P.primeiroNome(p.cliente);
    var quando = P.dataLonga(p.dia).replace(/^Hoje, /, "hoje, ").replace(/^Amanhã, /, "amanhã, ") + " às " + P.hm(p.horario);
    var com = p.profissional ? " com " + p.profissional : "";
    var cod = p.codigo ? "\nCódigo: " + p.codigo : "";
    var casa = barbearia || "barbearia";
    if (tipo === "confirmado") return "Olá, " + nome + "! Seu horário na " + casa + " está confirmado ✅\n" + p.servico + com + "\n" + quando + cod + "\nAté lá!";
    if (tipo === "recusado") return "Olá, " + nome + ". Infelizmente não conseguimos atender no horário pedido (" + quando + "). Quer escolher outro horário?";
    if (tipo === "remarcado") return "Olá, " + nome + "! Seu horário na " + casa + " foi remarcado para " + quando + " (" + p.servico + com + ")." + cod;
    if (tipo === "cancelado") return "Olá, " + nome + ". Seu horário na " + casa + " (" + quando + ") foi cancelado. Se quiser, escolha outro horário.";
    return "Olá, " + nome + "! Lembrete do seu horário na " + casa + ": " + p.servico + com + ", " + quando + "." + cod;
  };
  P.abrirWhats = function (texto) {
    var a = h("a", { href: P.whats(texto), target: "_blank", rel: "noopener" });
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // ---------- abas pelo endereço (#hoje, #agenda...) ----------
  P.abas = function (aoTrocar) {
    function mostrar() {
      var padrao = document.querySelector("[data-aba]").dataset.aba;
      var alvo = (location.hash || "").slice(1) || padrao;
      if (!document.querySelector('[data-tela="' + alvo + '"]')) alvo = padrao;
      document.querySelectorAll("[data-tela]").forEach(function (s) { s.hidden = s.dataset.tela !== alvo; });
      document.querySelectorAll("[data-aba]").forEach(function (a) { a.setAttribute("aria-current", a.dataset.aba === alvo ? "page" : "false"); });
      if (aoTrocar) aoTrocar(alvo);
    }
    window.addEventListener("hashchange", function () { mostrar(); window.scrollTo(0, 0); });
    mostrar();
  };
  P.bolinha = function (aba, n) {
    var a = document.querySelector('[data-aba="' + aba + '"]');
    if (!a) return;
    var b = a.querySelector(".bolinha");
    if (!n) { if (b) b.remove(); return; }
    if (!b) { b = h("span", { class: "bolinha" }); a.appendChild(b); }
    b.textContent = n > 99 ? "99+" : String(n);
  };

  // ---------- atualização automática e alerta de pedido novo ----------
  P.manterAtualizado = function (fn, ms) {
    setInterval(function () { if (!document.hidden && navigator.onLine !== false) fn(); }, ms || 30000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) fn(); });
    window.addEventListener("online", fn);
  };
  var vistos = null;
  P.novosPedidos = function (pendentes) {
    var ids = (pendentes || []).map(function (p) { return p.id; });
    if (vistos) {
      var novos = ids.filter(function (id) { return vistos.indexOf(id) < 0; });
      if (novos.length) {
        P.toast(novos.length === 1 ? "Chegou um pedido novo!" : "Chegaram " + novos.length + " pedidos novos!", "ok");
        try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch (e) {}
        try {
          var Ctx = window.AudioContext || window.webkitAudioContext;
          if (Ctx) {
            var c = new Ctx(), o = c.createOscillator(), g = c.createGain();
            o.frequency.value = 880; g.gain.value = 0.06; o.connect(g); g.connect(c.destination);
            o.start(); o.stop(c.currentTime + 0.18);
          }
        } catch (e) {}
        if (document.hidden && document.title.indexOf("(") !== 0) document.title = "(" + novos.length + ") " + document.title;
      }
    }
    vistos = ids;
  };
  document.addEventListener("visibilitychange", function () { if (!document.hidden) document.title = document.title.replace(/^\(\d+\) /, ""); });

  // ---------- sem internet ----------
  function avisoConexao() {
    var a = P.$("offline");
    if (navigator.onLine === false) {
      if (!a) document.body.appendChild(h("div", { id: "offline", class: "offline", role: "status", texto: "Sem internet. Os dados voltam a atualizar quando a conexão voltar." }));
    } else if (a) a.remove();
  }
  window.addEventListener("online", avisoConexao);
  window.addEventListener("offline", avisoConexao);

  // ---------- monitoramento: tempos de carregamento e erros (sem dados pessoais) ----------
  P.monitorar = function () {
    var rota = location.pathname;
    var enviados = 0;
    function envia(tipo, nome, valor, detalhe) {
      if (enviados++ > 12) return;
      var corpo = JSON.stringify({ tipo: tipo, nome: nome, valor: valor, detalhe: detalhe || "", rota: rota });
      try {
        if (navigator.sendBeacon) navigator.sendBeacon("/api/config", new Blob([corpo], { type: "application/json" }));
        else fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: corpo, keepalive: true });
      } catch (e) {}
    }
    window.addEventListener("error", function (e) {
      envia("erro", (e.error && e.error.name) || "Error", null, String(e.message || "") + " @ " + String(e.filename || "").replace(location.origin, "") + ":" + (e.lineno || 0));
    });
    window.addEventListener("unhandledrejection", function (e) {
      var r = e.reason || {};
      envia("erro", r.name || "Promise", null, String(r.message || r).slice(0, 500));
    });
    if (!("PerformanceObserver" in window)) return;
    var lcp = 0, cls = 0, inp = 0;
    try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (x) { lcp = x.startTime; }); }).observe({ type: "largest-contentful-paint", buffered: true }); } catch (e) {}
    try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (x) { if (!x.hadRecentInput) cls += x.value; }); }).observe({ type: "layout-shift", buffered: true }); } catch (e) {}
    try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (x) { if (x.interactionId && x.duration > inp) inp = x.duration; }); }).observe({ type: "event", buffered: true, durationThreshold: 40 }); } catch (e) {}
    var feito = false;
    function fecha() {
      if (feito) return;
      feito = true;
      var nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
      if (nav) { envia("vital", "TTFB", Math.round(nav.responseStart)); if (nav.loadEventEnd) envia("vital", "carregamento", Math.round(nav.loadEventEnd)); }
      if (lcp) envia("vital", "LCP", Math.round(lcp));
      envia("vital", "CLS", Math.round(cls * 1000) / 1000);
      if (inp) envia("vital", "INP", Math.round(inp));
    }
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") fecha(); });
    window.addEventListener("pagehide", fecha);
  };

  // ---------- CSV (abre no Excel em português) ----------
  P.baixarCsv = function (nome, linhas) {
    var csv = linhas.map(function (l) {
      return l.map(function (c) {
        var t = String(c == null ? "" : c);
        if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; // evita fórmula maliciosa no Excel
        return /[";\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
      }).join(";");
    }).join("\r\n");
    var blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    var a = h("a", { href: URL.createObjectURL(blob), download: nome });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };

  // ---------- sessão ----------
  P.exigirLogin = function () {
    if (!window.Conta || !window.Conta.ler()) { location.replace("entrar.html"); return false; }
    return true;
  };
  P.sair = function () { window.Conta.sair(); location.href = "entrar.html"; };

  window.Painel = P;
})();
