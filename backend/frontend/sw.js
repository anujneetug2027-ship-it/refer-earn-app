// AmbikaShelf World Chat — Service Worker
// Handles incoming push notifications (e.g. @mentions) and click actions.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "World Chat", body: event.data ? event.data.text() : "New message" };
  }

  const title = data.title || "World Chat";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icons/ambikashelf.png",
    badge: data.badge || "/icons/ambikashelf.png",
    data: { url: data.url || "/worldchat" },
    vibrate: [100, 50, 100]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/worldchat";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(targetUrl) && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
