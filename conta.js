// Login e sessão das páginas de conta (entrar, redefinir senha e painel).
// Fala direto com a autenticação do Supabase. A sessão fica no navegador e é renovada sozinha.
(function () {
  var CHAVE = "bio_sessao";
  var cfgPromessa = null;

  function config() {
    if (!cfgPromessa) {
      cfgPromessa = fetch("/api/config").then(function (r) {
        if (!r.ok) throw new Error("Login indisponível no momento.");
        return r.json();
      });
    }
    return cfgPromessa;
  }

  // Demonstração sem login (fase 25): ?demo=dono ou ?demo=barbeiro abre o painel da barbearia vitrine, só para
  // olhar. A sessão de mentira fica só nesta aba (sessionStorage) e não mexe no login de verdade deste aparelho.
  var DEMO = "bio_demo";
  try {
    var pedidoDemo = new URLSearchParams(window.location.search).get("demo");
    if (pedidoDemo === "dono" || pedidoDemo === "barbeiro") sessionStorage.setItem(DEMO, pedidoDemo);
  } catch (e) {}
  function demo() {
    try { var v = sessionStorage.getItem(DEMO); return v === "dono" || v === "barbeiro" ? v : null; } catch (e) { return null; }
  }

  function ler() {
    var d = demo();
    if (d) return { access_token: "demo-" + d, refresh_token: "", expira: Date.now() + 864e5, demo: d };
    try { return JSON.parse(localStorage.getItem(CHAVE)); } catch (e) { return null; }
  }
  function gravar(s) {
    try { if (s) localStorage.setItem(CHAVE, JSON.stringify(s)); else localStorage.removeItem(CHAVE); } catch (e) {}
  }
  function sessaoDe(j) {
    return { access_token: j.access_token, refresh_token: j.refresh_token, expira: Date.now() + (j.expires_in || 3600) * 1000 };
  }

  // Mensagens em português para os erros mais comuns do Supabase
  function traduz(j) {
    var m = String((j && (j.error_description || j.msg || j.message)) || "");
    if (/Invalid login/i.test(m)) return "E-mail ou senha incorretos.";
    if (/already registered|already been registered/i.test(m)) return "Este e-mail já tem conta. Entre com sua senha.";
    if (/not confirmed/i.test(m)) return "Confirme seu e-mail antes de entrar. Enviamos um link para ele.";
    if (/at least|weak|Password should|pwned|leaked/i.test(m)) return "Senha fraca ou já vazada na internet. Use pelo menos 8 caracteres, com letras e números.";
    if (/rate limit|too many/i.test(m)) return "Muitas tentativas. Espere alguns minutos e tente de novo.";
    return m || "Não foi possível concluir. Tente de novo.";
  }

  async function auth(metodo, caminho, corpo, token) {
    var c = await config();
    var cab = { apikey: c.anon, "Content-Type": "application/json" };
    if (token) cab.Authorization = "Bearer " + token;
    var r = await fetch(c.url + "/auth/v1" + caminho, {
      method: metodo,
      headers: cab,
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(traduz(j));
    return j;
  }

  function entrar(email, senha) {
    return auth("POST", "/token?grant_type=password", { email: email, password: senha }).then(function (j) {
      gravar(sessaoDe(j));
      return j;
    });
  }

  // Quando o e-mail precisa de confirmação, o Supabase não devolve sessão
  function criarConta(email, senha) {
    return auth("POST", "/signup", { email: email, password: senha }).then(function (j) {
      if (j.access_token) gravar(sessaoDe(j));
      return j;
    });
  }

  function esqueciSenha(email, redirecionar) {
    return config().then(function (c) {
      return auth("POST", "/recover?redirect_to=" + encodeURIComponent(redirecionar), { email: email });
    });
  }

  function trocarSenha(novaSenha) {
    var s = ler();
    if (!s) return Promise.reject(new Error("O link de redefinição expirou. Peça um novo."));
    return auth("PUT", "/user", { password: novaSenha }, s.access_token);
  }

  // Formas de login ativadas no Supabase (ex.: { google: true }). Se não der para saber, nenhuma extra.
  function provedores() {
    return auth("GET", "/settings").then(function (j) {
      return (j && j.external) || {};
    }, function () { return {}; });
  }

  function entrarComGoogle(redirecionar) {
    config().then(function (c) {
      window.location.href = c.url + "/auth/v1/authorize?provider=google&redirect_to=" + encodeURIComponent(redirecionar);
    });
  }

  // Ao voltar do Google ou de um link de e-mail, o Supabase põe os tokens no endereço (#access_token=...)
  function capturarSessaoDaUrl() {
    var h = window.location.hash;
    if (h.indexOf("access_token=") < 0) return null;
    var p = new URLSearchParams(h.slice(1));
    var s = { access_token: p.get("access_token"), refresh_token: p.get("refresh_token"), expira: Date.now() + (+p.get("expires_in") || 3600) * 1000 };
    gravar(s);
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return { tipo: p.get("type") };
  }

  async function renovar() {
    var s = ler();
    if (!s || !s.refresh_token) { sair(); throw new Error("Sua sessão expirou. Entre de novo."); }
    try {
      var j = await auth("POST", "/token?grant_type=refresh_token", { refresh_token: s.refresh_token });
      gravar(sessaoDe(j));
    } catch (e) {
      sair();
      throw new Error("Sua sessão expirou. Entre de novo.");
    }
  }

  // Chamada à API do site com o token do usuário; renova a sessão se necessário
  async function api(caminho, opcoes) {
    opcoes = opcoes || {};
    var s = ler();
    if (!s) throw new Error("Entre na sua conta para continuar.");
    if (Date.now() > s.expira - 60000) await renovar();
    async function chamar() {
      var t = ler().access_token;
      var r = await fetch(caminho, {
        method: opcoes.metodo || (opcoes.corpo ? "POST" : "GET"),
        headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" },
        body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
      });
      var j = await r.json().catch(function () { return {}; });
      return { status: r.status, ok: r.ok, j: j };
    }
    var res = await chamar();
    if (res.status === 401) {
      await renovar();
      res = await chamar();
    }
    // O erro leva a situação e a resposta inteira (ex.: conflito de horário que o dono pode confirmar)
    if (!res.ok) { var falha = new Error(res.j.message || "Erro " + res.status); falha.status = res.status; falha.dados = res.j; throw falha; }
    return res.j;
  }

  // Faixa da demonstração no topo das páginas do painel: dados de exemplo, nada é salvo, e os caminhos para
  // contratar (WhatsApp de vendas do Bio Site, o mesmo da página de vendas) ou sair da demonstração.
  var WHATS_VENDAS = "5581999186042";
  function faixaDemo() {
    if (!demo() || !document.body || document.getElementById("faixaDemo")) return;
    var f = document.createElement("div");
    f.id = "faixaDemo";
    f.setAttribute("role", "note");
    f.style.cssText = "display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;justify-content:center;padding:9px 14px;background:#1f2a44;color:#fff;font:600 13px/1.4 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;text-align:center";
    var t = document.createElement("span");
    t.textContent = "Demonstração: os dados são de exemplo e nada é salvo.";
    var quero = document.createElement("a");
    quero.href = "https://wa.me/" + WHATS_VENDAS + "?text=" + encodeURIComponent("Olá! Vi a demonstração do painel do Bio Site e quero para a minha barbearia.");
    quero.target = "_blank";
    quero.rel = "noopener";
    quero.textContent = "Quero na minha barbearia";
    var sairLink = document.createElement("a");
    sairLink.href = "/#demonstracao";
    sairLink.textContent = "Sair da demonstração";
    sairLink.addEventListener("click", function () { sair(); });
    [quero, sairLink].forEach(function (a) { a.style.cssText = "color:#fff;text-decoration:underline;white-space:nowrap"; });
    f.appendChild(t);
    f.appendChild(quero);
    f.appendChild(sairLink);
    document.body.insertBefore(f, document.body.firstChild);
  }

  // Na demonstração, sair só encerra a demonstração desta aba (o login de verdade continua como estava)
  function sair() {
    if (demo()) { try { sessionStorage.removeItem(DEMO); } catch (e) {} return; }
    gravar(null);
  }

  window.Conta = {
    config: config,
    ler: ler,
    entrar: entrar,
    criarConta: criarConta,
    esqueciSenha: esqueciSenha,
    trocarSenha: trocarSenha,
    provedores: provedores,
    entrarComGoogle: entrarComGoogle,
    capturarSessaoDaUrl: capturarSessaoDaUrl,
    api: api,
    sair: sair,
    demo: demo,
    faixaDemo: faixaDemo,
    traduz: traduz,
  };
})();
