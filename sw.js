// Service worker dos avisos de pedido (Web Push). Só mostra o aviso e abre o painel ao tocar nele.
// Por segurança, só abre endereços do próprio site (caminhos que começam com "/").
function caminhoSeguro(u) {
  return typeof u === "string" && u.startsWith("/") && !u.startsWith("//") ? u : "/";
}

self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil(
    self.registration.showNotification(String(d.title || "Novo aviso").slice(0, 80), {
      body: String(d.body || "").slice(0, 240),
      tag: "pedido",
      renotify: true,
      vibrate: [120, 60, 120],
      data: { url: caminhoSeguro(d.url) },
    })
  );
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var url = caminhoSeguro(e.notification.data && e.notification.data.url);
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (lista) {
      for (var i = 0; i < lista.length; i++) {
        if (lista[i].url.indexOf(url) > -1 && "focus" in lista[i]) return lista[i].focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
