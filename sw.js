/*
 * Service worker Yuny (#108): оболочка приложения открывается быстро и без сети.
 *
 * - Страницы — сначала сеть (свежая сборка сразу после выкладки), без сети —
 *   сохранённая оболочка.
 * - Файлы сборки с хешем в имени, шрифты, иконки, черты знаков — из кэша:
 *   они не меняются, новая сборка приходит под новыми именами.
 * - Данные Supabase и всё остальное не трогаем — только сеть.
 *
 * `9ef3f3c4b451` подставляет выкладка (pages.yml): новая сборка — новый кэш,
 * старый удаляется при активации.
 */
const BUILD = "9ef3f3c4b451";
const SHELL = `yuny-shell-${BUILD}`;
const STATIC = `yuny-static-${BUILD}`;
const STROKES = "yuny-strokes-v1";
const scope = new URL(self.registration.scope);
const shellUrl = new URL("./", scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.add(new Request(shellUrl, { cache: "reload" })))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, STATIC, STROKES].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function cacheFirst(request, name) {
  return caches.open(name).then((cache) =>
    cache.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        }),
    ),
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate" && url.origin === scope.origin) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) caches.open(SHELL).then((c) => c.put(shellUrl, res.clone()));
          return res;
        })
        .catch(() => caches.match(shellUrl).then((hit) => hit || Response.error())),
    );
    return;
  }

  if (url.origin === scope.origin) {
    const path = url.pathname.slice(scope.pathname.length - 1);
    if (/^\/(_expo\/static|assets)\//.test(path) || /\.(png|ttf|otf|woff2?)$/.test(path)) {
      event.respondWith(cacheFirst(request, STATIC));
    }
    return;
  }

  // Черты знаков (Hanzi Writer, CDN): неизменны, пригодятся без сети.
  if (url.hostname === "cdn.jsdelivr.net" && url.pathname.includes("hanzi-writer-data")) {
    event.respondWith(cacheFirst(request, STROKES));
  }
});

// Напоминания (#251): тело шифрует `reminders-hook` (Web Push), здесь — показ.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Юни";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: new URL("icon-192.png", scope).href,
      badge: new URL("icon-192.png", scope).href,
      tag: data.tag || "yuny-reminder",
      data: { url: new URL((data.url || "./").replace(/^\//, ""), scope).href },
    }),
  );
});

// Нажатие — открытое окно приложения на передний план, иначе новое.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || scope.href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const own = list.find((c) => c.url.startsWith(scope.origin));
      if (own) return own.focus().then((c) => (c && "navigate" in c ? c.navigate(url) : undefined)).catch(() => undefined);
      return self.clients.openWindow(url);
    }),
  );
});
