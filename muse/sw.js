// Muse AI service worker: makes the app installable and usable offline, and keeps it
// up to date by itself. App files are fetched fresh from the website whenever the phone
// is online (falling back to the saved copy offline), so every push to GitHub reaches
// the phone the next time Muse opens. Bump CACHE only if the file list changes.
const CACHE = "muse-v1";
const SHELL = ["./", "index.html", "muse.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "version.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first for our own site (always the latest code and data); saved copy when offline.
// The AI backend (script.google.com) is never cached.
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: "no-store" })
      .then(res => {
        if (res.ok && (url.pathname.startsWith("/muse/") || url.pathname.startsWith("/data/"))) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html")))
  );
});
