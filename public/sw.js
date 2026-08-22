// Minimal service worker: no offline caching logic, just enough presence
// for browsers to treat this as an installable PWA. Safe to expand later.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
