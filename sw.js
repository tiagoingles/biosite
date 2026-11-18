// Service worker dos avisos (Web Push): os do painel (pedido novo, cliente chegando...) e os do cliente no app da
// barbearia (lembrete, "Confirme seu horário", "Seu horário mudou", novidades). Só mostra o aviso e, ao tocar,
// abre o endereço do aviso. Os botões "Confirmo" e "Não vou poder ir" respondem a confirmação de presença.
// Por segurança, só abre endereços do próprio site (caminhos que começam com "/").
function caminhoSeguro(u) {
  return typeof u === "string" && u.startsWith("/") && !u.startsWith("//") ? u : "/";
}
var ACOES = { sim: 1, nao: 1 };

self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) {}
  var token = typeof d.token === "string" && /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{16}$/i.test(d.token) ? d.token : "";
  var opcoes = {
    body: String(d.body || "").slice(0, 240),
    tag: typeof d.tag === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(d.tag) ? d.tag : "pedido",
    renotify: true,
    vibrate: [120, 60, 120],
    data: { url: caminhoSeguro(d.url), token: token },
  };
  if (typeof d.icon === "string" && /^\/img\/[a-z0-9-]+\/[\w.-]+\.png$/.test(d.icon)) opcoes.icon = d.icon;
  var acoes = (Array.isArray(d.acoes) ? d.acoes : []).filter(function (a) { return a && ACOES[a.action] && token; }).slice(0, 2);
  if (acoes.length) opcoes.actions = acoes.map(function (a) { return { action: a.action, title: String(a.title || "").slice(0, 30) }; });
  e.waitUntil(self.registration.showNotification(String(d.title || "Novo aviso").slice(0, 80), opcoes));
});

function abrir(url) {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (lista) {
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].url.indexOf(url) > -1 && "focus" in lista[i]) return lista[i].focus();
    }
    return self.clients.openWindow(url);
  });
}

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var dados = e.notification.data || {};
  var url = caminhoSeguro(dados.url);
  // "Confirmo": responde direto, sem abrir o site, e mostra que deu certo
  if (e.action === "sim" && dados.token) {
    e.waitUntil(
      fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo: "presenca", token: dados.token, resposta: "sim" }) })
        .then(function (r) {
          if (!r.ok) throw new Error("presenca");
          return self.registration.showNotification("Presença confirmada ✓", { body: "Obrigado! A barbearia já sabe que você vem.", tag: e.notification.tag, data: { url: url } });
        })
        .catch(function () { return abrir(url); })
    );
    return;
  }
  // "Não vou poder ir": abre o site já na pergunta de cancelar (o cliente confirma lá)
  if (e.action === "nao" && dados.token) url += (url.indexOf("?") > -1 ? "&" : "?") + "r=nao";
  e.waitUntil(abrir(url));
});
