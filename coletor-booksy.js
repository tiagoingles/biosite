// Coletor do Booksy para o barbeirotop. Roda na página do Booksy Biz (booksy.com/pro), aberto pelo favorito que o
// /app do barbeirotop gera (o favorito traz o código de uso da coleta). Usa a sessão que já está aberta neste
// navegador: só lê (GET) os clientes, a equipe, os serviços, os produtos e a agenda dos próximos 90 dias, e manda
// tudo para o barbeirotop. Depois, o histórico de atendimentos (um ano por vez), que entra marcado como do
// aplicativo anterior. A senha do Booksy não é usada nem guardada, e nada é alterado no Booksy.
// __BIO_MIGRACAO = { token, api, so? }: so = "historico" manda só o histórico (o resto já veio antes).
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
  // Faz o próprio Booksy buscar dados (troca de tela dentro do site) para os cabeçalhos aparecerem. Se a tela já
  // é a de clientes, o Booksy não busca de novo: aí vai para a agenda (e vice-versa).
  function provocar() {
    try {
      var tela = /\/customers(\/|$)/.test(location.pathname) ? "calendar" : "customers";
      history.pushState({}, "", "/pro/" + idioma + "/" + negocio + "/" + tela);
      window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
    } catch (e) {}
  }
  function esperarSessao() {
    aviso("Conectando à sessão do Booksy…", 2);
    provocar();
    var inicio = Date.now(), tentou = false, pediu = false;
    return new Promise(function (ok, falhou) {
      (function olhar() {
        if (cab) return ok();
        if (!tentou && Date.now() - inicio > 3000) { tentou = true; provocar(); }
        if (!pediu && Date.now() - inicio > 7000) { pediu = true; aviso("Toque em Calendário ou em Clientes no menu do Booksy para eu começar.", 2); }
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
  // Quem se cadastrou pelo app do Booksy tem nome e telefone no perfil combinado (merged_data), não na ficha da
  // barbearia (business_customer): vale o que estiver preenchido, primeiro o combinado. O id é sempre o da ficha.
  function cliente(c) {
    var b = c.business_customer || {}, m = c.merged_data || {};
    var v = function (k) { return m[k] != null && m[k] !== "" ? m[k] : b[k]; };
    var nasc = /^\d{4}-\d{2}-\d{2}$/.test(String(v("birthday") || "")) ? v("birthday") : "";
    var curto = /^(\d{2})(\d{2})$/.exec(String(v("short_birthday") || ""));
    if (!nasc && curto) nasc = curto[2] + "/" + curto[1]; // MMDD -> DD/MM (aniversário sem o ano)
    var obs = String(v("business_secret_note") || "");
    if (c.blacklisted || v("blacklisted")) obs = (obs ? obs + " · " : "") + "Bloqueado no Booksy";
    return {
      id: b.id || m.id || c._id, nome: v("full_name") || [v("first_name"), v("last_name")].filter(Boolean).join(" "), telefone: v("cell_phone") || "",
      nascimento: nasc, cpf: v("tax_id") || "", obs: obs, aceita: !!(v("web_communication_agreement") || c.web_communication_agreement) && !c.blasts_unsubscribed,
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

  // Manda uma parte para o barbeirotop (texto puro: sem pré-verificação de CORS) e devolve o resumo dela
  async function enviar(dados) {
    var r;
    try {
      r = await fetch(String(M.api).replace(/\/+$/, "") + "/api/config", {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({ tipo: "migracao", token: M.token, dados: dados }),
      });
    } catch (e) {
      throw new Error("A conexão com o barbeirotop caiu durante o envio. Parte dos dados pode ter entrado: veja em \"Ver o resultado\" no /app e toque no favorito de novo (nada é duplicado).");
    }
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(j.message || "O barbeirotop respondeu " + r.status + ".");
    return j.resumo || {};
  }

  // Histórico: atendimentos que já aconteceram (atendido ou não compareceu), um ano por vez, até ontem. No
  // barbeirotop eles ficam marcados como do aplicativo anterior, fora da agenda e do financeiro.
  var ANO_INICIO = 2016;
  async function historico(ddd, equipe) {
    var hoje = new Date(), ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
    var total = { lidos: 0, novos: 0, jaEstavam: 0, semCliente: 0 }, parte = 0, anos = ontem.getFullYear() - ANO_INICIO + 1;
    for (var ano = ANO_INICIO; ano <= ontem.getFullYear(); ano++) {
      var pct = 93 + 6 * ((ano - ANO_INICIO) / anos);
      aviso("Lendo o histórico de " + ano + "…", pct);
      var fim = ano === ontem.getFullYear() ? diaLocal(ontem) : ano + "-12-31";
      var j = await ler("calendar?start_date=" + ano + "-01-01&end_date=" + fim + "&include_unconfirmed=true&version=3&resources_per_page=50");
      var lista = [];
      Object.keys(j.bookings || {}).forEach(function (id) {
        var b = j.bookings[id] || {}, c = b.customer || {}, s = b.service || {};
        if (b.status !== "F" && b.status !== "N") return;
        lista.push({ id: b.id || id, inicio: b.booked_from, status: b.status, clienteId: c.id || "", clienteTelefone: c.phone || "", servicoNome: s.name || "", equipeId: ((b.resources || [])[0] || {}).id || "" });
      });
      if (lista.length) {
        parte++;
        aviso("Enviando " + lista.length + " atendimentos de " + ano + " (histórico)…", pct);
        var dados = { origem: "booksy", negocio: negocio, ddd: ddd, equipe: equipe, historico: lista, historicoParte: parte };
        var h = (await enviar(dados)).historico || {};
        // Se o tempo do servidor acabou no meio, manda o mesmo ano de novo (o que já entrou não duplica)
        if (h.pendentes) { var h2 = (await enviar(dados)).historico || {}; h = { novos: (h.novos || 0) + (h2.novos || 0), jaEstavam: h2.jaEstavam || 0, semCliente: h.semCliente || 0, pendentes: h2.pendentes || 0 }; }
        total.lidos += lista.length;
        total.novos += h.novos || 0;
        total.jaEstavam += h.jaEstavam || 0;
        total.semCliente += h.semCliente || 0;
        if (h.pendentes) total.pendentes = (total.pendentes || 0) + h.pendentes;
      }
      await pausa(PAUSA);
    }
    return total;
  }
  function textoHistorico(t) {
    return "• Histórico do Booksy (app anterior): " + t.novos + " atendimentos novos" + (t.jaEstavam ? ", " + t.jaEstavam + " já estavam" : "") +
      (t.semCliente ? ", " + t.semCliente + " sem cliente com ficha" : "") + (t.pendentes ? "\nFaltou parte do histórico: toque no favorito de novo (nada é duplicado)." : "");
  }

  (async function () {
    try {
      await esperarSessao();
      devolver();
      aviso("Lendo a equipe e os serviços…", 4);
      // DDD da barbearia (telefone dela no Booksy): completa o número de cliente salvo sem DDD
      var ddd = "";
      try { var neg = await ler(""); var fone = String(((neg && neg.business) || neg || {}).phone || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, ""); if (/^[1-9][1-9]/.test(fone)) ddd = fone.slice(0, 2); } catch (e) {}
      await pausa(PAUSA);
      var rec = await ler("resources");
      var equipe = (Array.isArray(rec) ? rec : rec.resources || []).map(function (r) { return { id: r.id, nome: r.name, visivel: r.visible !== false }; });
      await pausa(PAUSA);
      // Só o histórico (o resto já veio numa coleta anterior)
      if (M.so === "historico") {
        var t0 = await historico(ddd, equipe);
        encerrar("Pronto! Entrou no barbeirotop:\n" + textoHistorico(t0), !t0.pendentes);
        return;
      }
      var svc = await ler("services");
      var servicos = (svc.services || []).map(function (s) { var v = (s.variants || [])[0] || {}; return { id: s.id, nome: s.name, duracao: v.duration, preco: v.price != null ? v.price : s.service_price || "" }; });
      await pausa(PAUSA);
      var cli = await clientes();
      aviso("Lendo os produtos…", 62);
      var prod = await produtos();
      var ag = await agenda();
      aviso("Enviando " + cli.length + " clientes, " + ag.agendamentos.length + " horários e " + prod.length + " produtos para o barbeirotop…", 92);
      var s = await enviar({ origem: "booksy", negocio: negocio, ddd: ddd, equipe: equipe, servicos: servicos, produtos: prod, clientes: cli, agendamentos: ag.agendamentos, bloqueios: ag.bloqueios });
      var n = function (o, k) { return (o && o[k]) || 0; };
      var ja = function (o) { return n(o, "jaEstavam") ? ", " + n(o, "jaEstavam") + " já estavam" : ""; };
      var linhas = "• Clientes: " + n(s.clientes, "novos") + " novos, " + n(s.clientes, "atualizados") + " completados" + ja(s.clientes) + "\n" +
        "• Barbeiros: " + n(s.equipe, "novos") + " novos, " + n(s.equipe, "ligados") + " ligados" + ja(s.equipe) + "\n" +
        "• Serviços: " + n(s.servicos, "novos") + " novos\n" +
        "• Produtos: " + n(s.produtos, "novos") + " novos, " + n(s.produtos, "atualizados") + " atualizados\n" +
        "• Agendamentos futuros: " + n(s.agendamentos, "novos") + " novos" + ja(s.agendamentos) + (n(s.agendamentos, "ligados") ? ", " + n(s.agendamentos, "ligados") + " ligados ao cliente" : "") + "\n" +
        "• Bloqueios de horário: " + n(s.bloqueios, "novos") + " novos" + ja(s.bloqueios) + (s.erros && s.erros.length ? "\nCom problema: " + s.erros.join(", ") : "");
      // O histórico só vem depois que todos os clientes entraram (cada atendimento é ligado ao cliente)
      if (s.parcial) { encerrar("Entrou uma parte. Toque no favorito de novo para completar (nada é duplicado):\n" + linhas, false); return; }
      var t = await historico(ddd, equipe);
      encerrar("Pronto! Entrou no barbeirotop:\n" + linhas + "\n" + textoHistorico(t), !t.pendentes);
    } catch (e) {
      devolver();
      encerrar(e && e.message ? e.message : "Não deu para coletar agora. Tente de novo.");
    }
  })();
})();
