/**
 * GameLauncher Remote — Service Worker (PWA)
 *
 * Estratégias de Cache:
 * 1. Network-Only: Chamadas de API REST, WebSockets, comandos de PC/energia/áudio e rotas de dev HMR.
 * 2. Cache-First: Assets imutáveis gerados no build (/assets/*) e arquivos de fontes (.woff2, fonts.gstatic.com).
 * 3. Stale-While-Revalidate: Demais assets estáticos (CSS, JS, ícones SVG/PNG, manifesto e HTML).
 */

const CACHE_VERSION = "v1.2.0";
const STATIC_CACHE = `gamelauncher-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `gamelauncher-runtime-${CACHE_VERSION}`;
const ACTIVE_CACHES = [STATIC_CACHE, RUNTIME_CACHE];

const PRECACHE_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/favicon.svg",
  "/gamepad.svg",
  "/icons.svg",
  "/pwa-192x192.png",
  "/pwa-512x512.png",
];

// Padrões de rotas de API / Comandos do PC que NUNCA devem ser cacheadas (Network-Only)
const API_PATH_PREFIXES = [
  "/api",
  "/wake",
  "/power",
  "/audio",
  "/system",
  "/games",
  "/remote",
  "/settings",
  "/times",
  "/covers",
  "/ws",
  "/socket.io",
];

// Padrões internos do servidor de desenvolvimento (Vite HMR) que devem ir direto para a rede
const DEV_PATH_PREFIXES = [
  "/@vite",
  "/@react-refresh",
  "/@fs",
  "/@id",
  "/src/",
  "/node_modules/",
];

/**
 * Identifica se a requisição é uma chamada de API, comando do PC, WebSocket ou recurso de dev.
 */
function isNetworkOnlyRequest(request, url) {
  if (request.method !== "GET") return true;

  if (url.protocol === "ws:" || url.protocol === "wss:" || url.protocol === "chrome-extension:") {
    return true;
  }

  const upgradeHeader = request.headers.get("upgrade");
  if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
    return true;
  }

  const acceptHeader = request.headers.get("accept") || "";
  if (acceptHeader.includes("text/event-stream") || acceptHeader.includes("application/json")) {
    // Permite cachear apenas o manifest.json
    if (!url.pathname.endsWith("/manifest.json") && !url.pathname.endsWith("/manifest.webmanifest")) {
      return true;
    }
  }

  // Qualquer requisição para outra origem/porta (ex.: backend Node na porta 3060), exceto Google Fonts
  const isGoogleFonts =
    url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (url.origin !== self.location.origin && !isGoogleFonts) {
    return true;
  }

  // Rotas de API ou comandos no mesmo host
  if (API_PATH_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) {
    return true;
  }

  // Rotas do Vite em modo desenvolvimento
  if (
    DEV_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix)) ||
    url.searchParams.has("t") ||
    url.searchParams.has("import") ||
    url.searchParams.has("v")
  ) {
    return true;
  }

  return false;
}

/**
 * Identifica assets estáticos imutáveis (hash no nome ou fontes binárias) ideais para Cache-First.
 */
function isCacheFirstAsset(url) {
  if (url.hostname === "fonts.gstatic.com") return true;
  if (url.pathname.startsWith("/assets/")) return true;
  return /\.(woff2?|ttf|otf|eot)$/i.test(url.pathname);
}

/**
 * Identifica assets estáticos gerais (CSS, JS, ícones, imagens, fontes CSS) para Stale-While-Revalidate.
 */
function isStaticAsset(request, url) {
  if (url.hostname === "fonts.googleapis.com") return true;
  const destination = request.destination;
  if (["style", "script", "worker", "font", "image", "manifest"].includes(destination)) {
    return true;
  }
  return /\.(css|js|mjs|svg|png|jpg|jpeg|webp|ico|json|webmanifest)$/i.test(url.pathname);
}

/**
 * Estratégia Stale-While-Revalidate:
 * Retorna imediatamente do cache se existir e atualiza o cache em segundo plano.
 */
async function staleWhileRevalidate(request, cacheName = STATIC_CACHE) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  const networkPromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse && (networkResponse.status === 200 || networkResponse.type === "opaque")) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => null);

  if (cachedResponse) {
    return cachedResponse;
  }

  const networkResponse = await networkPromise;
  if (networkResponse) {
    return networkResponse;
  }

  return new Response("Offline - Recurso indisponível", {
    status: 503,
    statusText: "Service Unavailable",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * Estratégia Cache-First:
 * Prioriza o cache local para máxima velocidade; busca na rede apenas se não estiver em cache.
 */
async function cacheFirst(request, cacheName = RUNTIME_CACHE) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  const networkResponse = await fetch(request);
  if (networkResponse && (networkResponse.status === 200 || networkResponse.type === "opaque")) {
    cache.put(request, networkResponse.clone());
  }
  return networkResponse;
}

// 1. INSTALL: Pré-carrega o App Shell estático e assume imediatamente
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// 2. ACTIVATE: Remove caches de versões anteriores e assume controle das abas abertas
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => !ACTIVE_CACHES.includes(name))
            .map((oldName) => caches.delete(oldName))
        )
      )
      .then(() => self.clients.claim())
  );
});

// 3. FETCH: Roteamento inteligente entre Network-Only, Cache-First e Stale-While-Revalidate
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Chamadas de API, WebSockets, comandos de PC/energia -> Network-Only (não intercepta/não cacheia)
  if (isNetworkOnlyRequest(request, url)) {
    return;
  }

  // Navegação SPA (HTML) -> Stale-While-Revalidate com fallback para /index.html
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response && response.status === 200) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put("/index.html", response.clone());
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(STATIC_CACHE);
          return (await cache.match("/index.html")) || (await cache.match("/"));
        })
    );
    return;
  }

  // Assets imutáveis (/assets/* e fontes) -> Cache-First
  if (isCacheFirstAsset(url)) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  // Demais assets estáticos (CSS, JS, ícones, manifesto) -> Stale-While-Revalidate
  if (isStaticAsset(request, url)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
  }
});
