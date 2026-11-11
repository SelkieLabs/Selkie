/*
 * Selkie's service worker. It has one job: show a notification when money
 * comes in, even with Selkie closed (see frontend/src/lib/push.ts), and open
 * the wallet when the notification is tapped. It caches nothing, so the app
 * never serves a stale page because of it.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    // An unreadable message still gets a notification: a push the browser
    // never shows can cost Selkie its permission to send them.
  }
  event.waitUntil(
    (async () => {
      // Always show it. Safari withdraws push from sites that receive one
      // without showing anything. With Selkie open, the tab already says so,
      // so the notification arrives without a sound.
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const watching = windows.some((client) => client.focused);
      await self.registration.showNotification(message.title || "Selkie", {
        body: message.body || "Something new in your wallet.",
        icon: "/icon-192.png",
        tag: message.tag,
        data: { url: message.url },
        silent: watching,
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const fallback = new URL("/wallet/home", self.location.origin);
  let target = fallback;
  try {
    target = new URL(event.notification.data?.url || fallback.href, self.location.origin);
  } catch {}
  // Only ever open Selkie itself.
  if (target.origin !== self.location.origin) target = fallback;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (!open) return self.clients.openWindow(target.href);
      // Already in the wallet: just bring it forward, so a half-typed payment
      // is not thrown away. Anywhere else: go to the wallet.
      if (!new URL(open.url).pathname.startsWith("/wallet") && "navigate" in open) {
        await open.navigate(target.href).catch(() => {});
      }
      return open.focus();
    })(),
  );
});
