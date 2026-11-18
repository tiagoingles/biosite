// Coletor do Booksy para o barbeirotop. Roda na página do Booksy Biz (booksy.com/pro), aberto pelo favorito que o
// /app do barbeirotop gera (o favorito traz o código de uso da coleta). Usa a sessão que já está aberta neste
// navegador: só lê (GET) os clientes, a equipe, os serviços, os produtos e a agenda dos próximos 90 dias, e manda
// tudo para o barbeirotop. A senha do Booksy não é usada nem guardada, e nada é alterado no Booksy.
(function () {
  "use strict";
  var M = window.__BIO_MIGRACAO || {};
  if (window.__bioColetor) return;
  window.__bioColetor = true;
  var DIAS = 90, POR_PAGINA = 100, PAUSA = 250;

  // ---------- painel na tela ----------
  var caixa = document.createElement("div");
  caixa.setAttribute("role", "status");
  caixa.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;width:min(380px,calc(100vw - 32px));background:#141414;color:#fff;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.45);font:14px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;padding:16px";
  var titulo = document.createElement("b");
  titulo.textContent = "Coletor do barbeirotop";
  titulo.style.cssText = "display:block;font-size:16px";
  var texto = document.createElement("p");
  texto.style.cssText = "margin:8px 0 0;white-space:pre-line";
  var trilho = document.createElement("div");
  trilho.style.cssText = "height:6px;background:#333;border-radius:4px;margin-top:10px;overflow:hidden";
  var barra = document.createElement("i");
  barra.style.cssText = "display:block;height:100%;width:0;background:#e3b04b;transition:width .3s";
  trilho.appendChild(barra);
  var fechar = document.createElement("button");
  fechar.type = "button";
  fechar.textContent = "Fechar";
  fechar.hidden = true;
  fechar.style.cssText = "margin-top:12px;background:#333;color:#fff;border:0;border-radius:10px;padding:8px 14px;cursor:pointer;font:inherit";
  fechar.onclick = function () { caixa.remove(); };
  caixa.appendChild(titulo); caixa.appendChild(texto); caixa.appendChild(trilho); caixa.appendChild(fechar);
  document.body.appendChild(caixa);
  function aviso(t, pct) { texto.textContent = t; if (pct != null) barra.style.width = Math.max(0, Math.min(100, pct)) + "%"; }
  function encerrar(t, ok) { aviso(t, ok ? 100 : null); if (!ok) barra.style.background = "#d9534f"; fechar.hidden = false; window.__bioColetor = false; }

  if (!M.token || !M.api) return encerrar("Este favorito está incompleto. Gere o coletor de novo no /app do barbeirotop.");
  var achado = /^\/pro\/([a-z-]+)\/(\d+)(\/|$)/.exec(location.pathname);
  if (!/(^|\.)booksy\.com$/.test(location.hostname) || !achado) return encerrar("Abra o Booksy Biz (booksy.com/pro) já logado na barbearia e toque de novo no favorito.");
  var idioma = achado[1], negocio = achado[2];

  // ---------- sessão do Booksy: os mesmos cabeçalhos que o próprio site manda ----------
  var cab = null, base = null;
  var abrir = XMLHttpRequest.prototype.open, porCab = XMLHttpRequest.prototype.setRequestHeader, enviar = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__bioU = String(u || ""); this.__bioH = {}; return abrir.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) { try { if (this.__bioH) this.__bioH[k] = v; } catch (e) {} return porCab.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    try {
      var u = this.__bioU || "", h = this.__bioH || {};
      var m = /^(https:\/\/[^/]+\/core\/v2\/business_api\/)/.exec(u);
      var temToken = Object.keys(h).some(function (k) { return /^x-access-token$/i.test(k) && h[k]; });
      if (m && temToken && !cab) {
        cab = {};
        Object.keys(h).forEach(function (k) { if (!/^(bksreqid|traceparent)$/i.test(k)) cab[k] = h[k]; });
        base = m[1] + "me/businesses/" + negocio + "/";
      }
    } catch (e) {}
    return enviar.apply(this, arguments);
  };
  function devolver() { XMLHttpRequest.prototype.open = abrir; XMLHttpRequest.prototype.setRequestHeader = porCab; XMLHttpRequest.prototype.send = enviar; }

  function pausa(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  // Faz o próprio Booksy buscar a lista de clientes (troca de tela dentro do site) para os cabeçalhos aparecerem
  function provocar() {
    try {
      history.pushState({}, "", "/pro/" + idioma + "/" + negocio + "/customers");
      window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
    } catch (e) {}
  }
  function esperarSessao() {
    aviso("Conectando à sessão do Booksy…", 2);
    provocar();
    var inicio = Date.now(), pediu = false;
    return new Promise(function (ok, falhou) {
      (function olhar() {
        if (cab) return ok();
        if (!pediu && Date.now() - inicio > 4000) { pediu = true; aviso("Toque em Clientes no menu do Booksy para eu começar.", 2); }
        if (Date.now() - inicio > 90000) return falhou(new Error("Não consegui usar a sessão do Booksy. Recarregue a página do Booksy e toque de novo no favorito."));
        setTimeout(olhar, 300);
      })();
    });
  }

  function ler(caminho) {
    return fetch(base + caminho, { headers: cab, credentials: "omit" }).then(function (r) {
      if (r.status === 401 || r.status === 403) throw new Error("O Booksy pediu login de novo. Entre no Booksy e toque de novo no favorito.");
      if (!r.ok) throw new Error("O Booksy respondeu " + r.status + " em " + caminho.split("?")[0] + ".");
      return r.json();
    });
  }
  function diaLocal(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

  // ---------- leitura ----------
  function cliente(c) {
    var b = c.business_customer || c.merged_data || {};
    var nasc = /^\d{4}-\d{2}-\d{2}$/.test(String(b.birthday || "")) ? b.birthday : "";
    var curto = /^(\d{2})(\d{2})$/.exec(String(b.short_birthday || ""));
    if (!nasc && curto) nasc = curto[2] + "/" + curto[1]; // MMDD -> DD/MM (aniversário sem o ano)
    return {
      id: b.id || c._id, nome: b.full_name || [b.first_name, b.last_name].filter(Boolean).join(" "), telefone: b.cell_phone || "",
      nascimento: nasc, cpf: b.tax_id || "", obs: b.business_secret_note || "", aceita: !!(b.web_communication_agreement || c.web_communication_agreement) && !c.blasts_unsubscribed,
      ultimaVisita: c.recent_visit || "", visitas: Number(c.booking_count) || 0,
    };
  }
  async function clientes() {
    var lista = [], pagina = 1, total = null;
    while (pagina < 500) {
      var j = await ler("customers?page=" + pagina + "&per_page=" + POR_PAGINA);
      var itens = j.customers || [];
      if (total == null) total = Number(j.count) || 0;
      itens.forEach(function (c) { lista.push(cliente(c)); });
      aviso("Lendo os clientes: " + lista.length + " de " + (total || "?") + "…", 5 + 55 * (total ? lista.length / total : 0));
      if (!itens.length || (total && lista.length >= total)) break;
      pagina++;
      await pausa(PAUSA);
    }
    return lista;
  }
  async function produtos() {
    var lista = [], pagina = 1;
    while (pagina < 100) {
      var j = await ler("warehouse/commodities?page=" + pagina + "&per_page=" + POR_PAGINA);
      var itens = j.commodities || [];
      itens.forEach(function (p) {
        var est = (p.stock_levels || [])[0] || {};
        lista.push({ id: p.id, nome: p.name, preco: p.gross_price, estoque: est.total_packages_left != null ? est.total_packages_left : est.full_packages_left, ativo: !p.archived, categoria: p.category_name || "" });
      });
      if (itens.length < POR_PAGINA || (j.counter && lista.length >= j.counter)) break;
      pagina++;
      await pausa(PAUSA);
    }
    return lista;
  }
  async function agenda() {
    var ags = [], blqs = [], hoje = new Date();
    for (var k = 0; k < DIAS; k += 7) {
      var de = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + k), ate = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + Math.min(k + 6, DIAS - 1));
      var j = await ler("calendar?start_date=" + diaLocal(de) + "&end_date=" + diaLocal(ate) + "&include_unconfirmed=true&version=3&resources_per_page=50");
      Object.keys(j.bookings || {}).forEach(function (id) {
        var b = j.bookings[id] || {}, c = b.customer || {}, s = b.service || {};
        ags.push({ id: b.id || id, inicio: b.booked_from, fim: b.booked_till, status: b.status, clienteId: c.id || "", clienteNome: c.name || "", servicoId: s.id || "", servicoNome: s.name || "", equipeId: ((b.resources || [])[0] || {}).id || "", obs: b.customer_note || "" });
      });
      Object.keys(j.reservations || {}).forEach(function (id) {
        var r = j.reservations[id] || {};
        blqs.push({ id: r.id || id, inicio: r.reserved_from, fim: r.reserved_till, equipeId: ((r.resources || [])[0] || {}).id || "", motivo: r.business_note || r.reason || "" });
      });
      aviso("Lendo a agenda: " + ags.length + " horários até " + ate.toLocaleDateString("pt-BR") + "…", 70 + 20 * ((k + 7) / DIAS));
      await pausa(PAUSA);
    }
    return { agendamentos: ags, bloqueios: blqs };
  }

  (async function () {
    try {
      await esperarSessao();
      devolver();
      aviso("Lendo a equipe e os serviços…", 4);
      var rec = await ler("resources");
      var equipe = (Array.isArray(rec) ? rec : rec.resources || []).map(function (r) { return { id: r.id, nome: r.name, visivel: r.visible !== false }; });
      await pausa(PAUSA);
      var svc = await ler("services");
      var servicos = (svc.services || []).map(function (s) { var v = (s.variants || [])[0] || {}; return { id: s.id, nome: s.name, duracao: v.duration, preco: v.price != null ? v.price : s.service_price || "" }; });
      await pausa(PAUSA);
      var cli = await clientes();
      aviso("Lendo os produtos…", 62);
      var prod = await produtos();
      var ag = await agenda();
      aviso("Enviando " + cli.length + " clientes, " + ag.agendamentos.length + " horários e " + prod.length + " produtos para o barbeirotop…", 92);
      var r = await fetch(String(M.api).replace(/\/+$/, "") + "/api/config", {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({ tipo: "migracao", token: M.token, dados: { origem: "booksy", negocio: negocio, equipe: equipe, servicos: servicos, produtos: prod, clientes: cli, agendamentos: ag.agendamentos, bloqueios: ag.bloqueios } }),
      });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(j.message || "O barbeirotop respondeu " + r.status + ".");
      var s = j.resumo || {}, n = function (o, k) { return (o && o[k]) || 0; };
      encerrar("Pronto! Entrou no barbeirotop:\n" +
        "• Clientes: " + n(s.clientes, "novos") + " novos, " + n(s.clientes, "atualizados") + " completados\n" +
        "• Barbeiros: " + (n(s.equipe, "novos") + n(s.equipe, "ligados")) + "\n" +
        "• Serviços: " + n(s.servicos, "novos") + " novos\n" +
        "• Produtos: " + (n(s.produtos, "novos") + n(s.produtos, "atualizados")) + "\n" +
        "• Agendamentos futuros: " + n(s.agendamentos, "novos") + "\n" +
        "• Bloqueios de horário: " + n(s.bloqueios, "novos") + (s.erros && s.erros.length ? "\nCom problema: " + s.erros.join(", ") : ""), true);
    } catch (e) {
      devolver();
      encerrar(e && e.message ? e.message : "Não deu para coletar agora. Tente de novo.");
    }
  })();
})();
