self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = typeof data.title === "string" ? data.title : "Nunuza update";
  const options = {
    body: typeof data.body === "string" ? data.body : "You have an important update.",
    icon: "/brand/logo-icon.svg",
    badge: "/brand/logo-icon.svg",
    tag: typeof data.tag === "string" ? data.tag : "nunuza-notification",
    renotify: false,
    data: {
      url: typeof data.url === "string" && data.url.startsWith("/app/") ? data.url : "/app/notifications",
    },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/app/notifications", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && "focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(target);
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
