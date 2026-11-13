const STATIC_CACHE = "nunuza-static-v1";
const PRECACHE_URLS = [
  "/offline.html",
  "/manifest.webmanifest",
  "/brand/logo-icon.svg",
  "/brand/icon-192.png",
  "/brand/icon-512.png",
  "/brand/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("nunuza-static-") && key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache authenticated pages, APIs, auth flows, or user/workspace data.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/app/") ||
    url.pathname.startsWith("/auth/") ||
    url.pathname.startsWith("/login") ||
    url.pathname.startsWith("/logout") ||
    url.pathname.startsWith("/billing")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const offline = await caches.match("/offline.html");
        return offline || new Response("You are offline. Please reconnect and try again.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      })
    );
    return;
  }

  const isPublicStatic =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/brand/") ||
    url.pathname === "/manifest.webmanifest";
  if (!isPublicStatic) return;

  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        await cache.put(request, response.clone());
      }
      return response;
    })
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = typeof data.title === "string" ? data.title : "Nunuza update";
  const options = {
    body: typeof data.body === "string" ? data.body : "You have an important update.",
    icon: "/brand/icon-192.png",
    badge: "/brand/icon-192.png",
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
