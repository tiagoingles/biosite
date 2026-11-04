// Service worker dos avisos de pedido (Web Push). Só mostra o aviso e abre o painel ao tocar nele.
self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil(self.registration.showNotification(d.title || "Bio Site", { body: d.body || "", data: { url: d.url || "/" } }));
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (lista) {
      for (var i = 0; i < lista.length; i++) {
        if (lista[i].url.indexOf(url) > -1 && "focus" in lista[i]) return lista[i].focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
