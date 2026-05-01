/**
 * Hermes WebUI Service Worker
 * Minimal PWA service worker — enables "Add to Home Screen".
 * No offline caching of API responses (the UI requires a live backend).
 * Caches only static shell assets so the app shell loads fast on repeat visits.
 */

// Cache version is injected by the server at request time (routes.py /sw.js handler).
// Bumps automatically whenever the git commit changes — no manual edits needed.
const CACHE_NAME = 'hermes-shell-__CACHE_VERSION__';

// Static assets that form the app shell
const SHELL_ASSETS = [
  './static/style.css',
  './static/boot.js',
  './static/ui.js',
  './static/messages.js',
  './static/sessions.js',
  './static/panels.js',
  './static/commands.js',
  './static/icons.js',
  './static/i18n.js',
  './static/workspace.js',
  './static/terminal.js',
  './static/onboarding.js',
  './static/favicon.svg',
  './static/favicon-32.png',
  './manifest.json',
];

// Install: pre-cache the app shell (static assets only — NOT './' to avoid caching login redirect)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS).catch((err) => {
        // Non-fatal: if any asset fails, still activate
        console.warn('[sw] Shell pre-cache partial failure:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch strategy:
// - API calls (/api/*, /stream, /health) → always network (never cache)
// - Navigate requests → network-first, cache ONLY if not a redirect (avoids caching login page)
// - Shell assets → cache-first with network fallback
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept cross-origin requests
  if (url.origin !== self.location.origin) return;

  // API and streaming endpoints — always go to network.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.includes('/api/') ||
    url.pathname.includes('/stream') ||
    url.pathname.startsWith('/health') ||
    url.pathname.includes('/health')
  ) {
    return; // let browser handle normally
  }

  // ── Navigate requests (page loads) ──────────────────────────────────────────
  // Network-first: always try the server so auth middleware can redirect to /login
  // when the session expires.  Only cache the response if it is the real app shell
  // (i.e. not a redirect — response.redirected is true when the server sent a 302
  // to /login and the browser followed it transparently).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && !response.redirected) {
            // Genuine app shell — update the cache
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./', copy)).catch(() => {});
          }
          return response;
        })
        .catch(() =>
          // Offline: serve cached app shell or a friendly error page
          caches.match('./').then((cached) => {
            if (cached) return cached;
            return new Response(
              '<!doctype html><html lang="pt"><head><meta charset="utf-8">' +
              '<meta name="viewport" content="width=device-width,initial-scale=1">' +
              '<title>Hermes — Offline</title>' +
              '<style>body{font-family:sans-serif;background:#1a1a1a;color:#ccc;' +
              'display:flex;align-items:center;justify-content:center;height:100vh;margin:0}' +
              '.box{text-align:center;padding:2rem}h2{color:#fff}a{color:#7b9ef0}</style>' +
              '</head><body><div class="box"><h2>Hermes está offline</h2>' +
              '<p>Servidor desconectado.<br>Verifique o ngrok e recarregue a página.</p>' +
              '<p><a href="./">Tentar novamente</a></p></div></body></html>',
              { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            );
          })
        )
    );
    return;
  }

  // ── Static shell assets ──────────────────────────────────────────────────────
  // Cache-first: shell assets rarely change; network fallback keeps them fresh.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (request.method === 'GET' && response.status === 200 && !response.redirected) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
