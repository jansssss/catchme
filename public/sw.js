// 캐치미 서비스 워커 — 푸시 알림 수신 전용
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// PWA 설치 조건을 위한 fetch 핸들러 (캐시하지 않고 그대로 통과)
self.addEventListener("fetch", () => {});

self.addEventListener("push", (e) => {
  let d = { title: "캐치미", body: "" };
  try {
    d = e.data.json();
  } catch {}
  e.waitUntil(
    self.registration.showNotification(d.title, {
      body: d.body,
      tag: d.tag,
      icon: "/icon-192.png",
      badge: "/badge.png",
      vibrate: d.urgent ? [300, 100, 300, 100, 300] : [200, 100, 200],
      requireInteraction: !!d.urgent,
      data: { url: "/" },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow("/");
    })
  );
});
