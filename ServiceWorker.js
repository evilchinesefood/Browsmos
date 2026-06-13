// Browsmos service worker.
//
// Strategy:
//   - First-party CODE (navigations, first-party .js/.css, the manifest) is
//     NETWORK-FIRST, falling back to cache offline. This means a fresh deploy
//     reaches returning users immediately when they're online — no stale wedge.
//   - Everything else (vendored Web Awesome/Font Awesome, audio, icons) is
//     CACHE-FIRST with runtime caching — those are large and content-stable.
//
// Bump CACHE whenever the SHELL list or a vendored asset changes (so the
// activate step purges the old cache). Tests/Structure.mjs enforces that every
// first-party Source/*.js stays listed in SHELL_FIRST_PARTY.
const CACHE = "browsmos-v3";

const SHELL_FIRST_PARTY = [
  "./",
  "./Index.html",
  "./Manifest.webmanifest",
  "./Source/Main.js",
  "./Source/Game/Mover.js",
  "./Source/Game/Cell.js",
  "./Source/Game/Camera.js",
  "./Source/Game/World.js",
  "./Source/Game/MusicPlayer.js",
  "./Source/UI/Chrome.js",
  "./Source/Styles/Reset.css",
  "./Source/Styles/Theme.css",
  "./Source/Styles/Game.css",
  "./Source/Assets/Icon.svg",
  "./Source/Assets/Icon192.png",
  "./Source/Assets/Icon512.png",
  "./Source/Assets/Logo.png",
  "./Source/Assets/Fonts/VT323.woff2",
  "./Source/Assets/Audio/Fx/Blip.ogg",
  "./Source/Assets/Audio/Fx/Bounce.ogg",
  "./Source/Assets/Audio/Fx/Death.ogg",
  "./Source/Assets/Audio/Fx/Win.ogg",
  "./Source/Assets/Audio/Music/BlackRainbow.ogg",
  "./Source/Assets/Audio/Music/Circles.ogg",
];

// Vendor entry points. Lazy WA chunks + FA webfonts are runtime-cached on use.
const SHELL_VENDOR = [
  "./Source/Vendor/WebAwesome/styles/webawesome.css",
  "./Source/Vendor/WebAwesome/webawesome.loader.js",
  "./Source/Vendor/FontAwesome/css/fontawesome.css",
  "./Source/Vendor/FontAwesome/css/duotone.css",
];

const MAX_RUNTIME = 300;
let runtimePuts = 0;

// Evict oldest runtime entries beyond MAX_RUNTIME, never touching the shell.
async function trim(cache) {
  const keys = await cache.keys();
  const base = new URL(self.registration.scope).pathname; // "/osmosis/" or "/"
  const shell = new Set([...SHELL_FIRST_PARTY, ...SHELL_VENDOR]);
  const evictable = keys.filter((req) => {
    const rel = "." + new URL(req.url).pathname.replace(base, "/");
    return !shell.has(rel);
  });
  for (let i = 0; i < evictable.length - MAX_RUNTIME; i++)
    await cache.delete(evictable[i]);
}

async function networkFirst(req, cache) {
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) return hit;
    if (req.mode === "navigate") return cache.match("./Index.html");
    return Response.error();
  }
}

async function cacheFirst(req, cache) {
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type === "basic") {
      const copy = res.clone();
      cache
        .put(req, copy)
        .then(() => {
          if (++runtimePuts % 20 === 0) return trim(cache);
        })
        .catch(() => {});
    }
    return res;
  } catch {
    if (req.mode === "navigate") return cache.match("./Index.html");
    return Response.error();
  }
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) =>
        c
          .addAll(SHELL_FIRST_PARTY)
          .then(() => Promise.allSettled(SHELL_VENDOR.map((u) => c.add(u)))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // leave cross-origin alone

  const p = url.pathname;
  const isCode =
    e.request.mode === "navigate" ||
    (/\.(?:js|css)$/.test(p) && !p.includes("/Source/Vendor/")) ||
    p.endsWith("/Manifest.webmanifest");

  e.respondWith(
    caches
      .open(CACHE)
      .then((cache) =>
        isCode ? networkFirst(e.request, cache) : cacheFirst(e.request, cache),
      ),
  );
});
