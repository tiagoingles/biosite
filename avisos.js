// Liga os avisos de novo pedido neste aparelho (Web Push). Usa o conta.js para falar com a API.
var Avisos = (function () {
  function bytesDe(b64u) {
    var s = (b64u + "=".repeat((4 - (b64u.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); });
  }

  function suportado() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }

  // Pede permissão, registra o sw.js, assina e manda a assinatura para a conta logada
  function ativar() {
    if (!suportado()) return Promise.reject(new Error("Este navegador não oferece avisos. No iPhone, adicione o painel à tela inicial e abra por ela."));
    return Notification.requestPermission().then(function (permissao) {
      if (permissao !== "granted") throw new Error("Sem permissão para avisos. Libere as notificações nas configurações do navegador.");
      return fetch("/api/config").then(function (r) { return r.json(); }).then(function (cfg) {
        if (!cfg.vapidPublic) throw new Error("Avisos ainda não estão configurados.");
        return navigator.serviceWorker.register("/sw.js").then(function (reg) {
          return navigator.serviceWorker.ready.then(function () {
            return reg.pushManager.getSubscription().then(function (atual) {
              return atual || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytesDe(cfg.vapidPublic) });
            });
          });
        });
      }).then(function (inscricao) {
        return Conta.api("/api/eu", { corpo: { acao: "inscrever-push", subscription: inscricao.toJSON() } });
      });
    });
  }

  return { ativar: ativar, suportado: suportado };
})();
