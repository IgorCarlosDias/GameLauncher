import { apiFetch, coverUrl } from "../api";

export const COVER_CACHE_NAME = "gamelauncher-covers-v1";
const IDB_STORE_NAME = "covers";
const PRELOAD_CONCURRENCY = 3;

/**
 * Mapa em memória (URL original -> ObjectURL `blob:...`) para retorno síncrono instantâneo (0ms).
 * @type {Map<string, string>}
 */
const memoryBlobUrlMap = new Map();

/**
 * Deduplicação de downloads concorrentes para a mesma URL.
 * @type {Map<string, Promise<string | null>>}
 */
const inflightMap = new Map();

/**
 * URLs que falharam (404 / corrompidas) nesta sessão para evitar retentativas em loop.
 * @type {Set<string>}
 */
const failedUrls = new Set();

const hasCacheStorage = () =>
  typeof window !== "undefined" && "caches" in window && Boolean(window.caches);

// ==========================================
// Fallback IndexedDB (para contextos HTTP LAN onde window.caches é restrito)
// ==========================================
let idbPromise = null;

function openFallbackIdb() {
  if (typeof window === "undefined" || !window.indexedDB) {
    return Promise.resolve(null);
  }
  if (idbPromise) return idbPromise;

  idbPromise = new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(COVER_CACHE_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return idbPromise;
}

async function readBlobFromStorage(url) {
  if (hasCacheStorage()) {
    try {
      const cache = await window.caches.open(COVER_CACHE_NAME);
      const cachedResponse = await cache.match(url);
      if (cachedResponse && cachedResponse.ok) {
        const blob = await cachedResponse.blob();
        if (blob && blob.size > 0) return blob;
      }
    } catch {
      // Continua para fallback IndexedDB
    }
  }

  try {
    const db = await openFallbackIdb();
    if (!db) return null;
    return await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE_NAME, "readonly");
      const store = tx.objectStore(IDB_STORE_NAME);
      const getReq = store.get(url);
      getReq.onsuccess = () => {
        const val = getReq.result;
        resolve(val instanceof Blob && val.size > 0 ? val : null);
      };
      getReq.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function writeBlobToStorage(url, responseClone, blob) {
  if (hasCacheStorage() && responseClone) {
    try {
      const cache = await window.caches.open(COVER_CACHE_NAME);
      await cache.put(url, responseClone);
      return;
    } catch {
      // Fallback para IndexedDB se CacheStorage falhar
    }
  }

  try {
    const db = await openFallbackIdb();
    if (!db || !blob) return;
    await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE_NAME, "readwrite");
      const store = tx.objectStore(IDB_STORE_NAME);
      store.put(blob, url);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch {
    // Silencioso: falha de armazenamento local nunca quebra a UI
  }
}

/**
 * Resolve o caminho de capa (nome de arquivo ou URL completa) para URL absoluta.
 */
export function resolveCoverHref(fileOrUrl) {
  if (!fileOrUrl || typeof fileOrUrl !== "string") return null;
  const trimmed = fileOrUrl.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("blob:") || /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return coverUrl(trimmed);
}

/**
 * Consulta síncrona (0ms): retorna o ObjectURL se a capa já estiver hidratada em memória.
 */
export function getCachedCoverSync(fileOrUrl) {
  const url = resolveCoverHref(fileOrUrl);
  if (!url) return null;
  return memoryBlobUrlMap.get(url) || null;
}

/**
 * Verifica se a URL falhou anteriormente nesta sessão.
 */
export function isCoverFailed(fileOrUrl) {
  const url = resolveCoverHref(fileOrUrl);
  return url ? failedUrls.has(url) : false;
}

/**
 * Marca uma capa como inválida/corrompida e remove do cache local.
 */
export async function invalidateCachedCover(fileOrUrl) {
  const url = resolveCoverHref(fileOrUrl);
  if (!url) return;
  failedUrls.add(url);

  const existingObjUrl = memoryBlobUrlMap.get(url);
  if (existingObjUrl) {
    memoryBlobUrlMap.delete(url);
    try {
      URL.revokeObjectURL(existingObjUrl);
    } catch {
      // Silencioso
    }
  }

  if (hasCacheStorage()) {
    try {
      const cache = await window.caches.open(COVER_CACHE_NAME);
      await cache.delete(url);
    } catch {
      // Silencioso
    }
  }
}

/**
 * Fluxo principal de obtenção da capa:
 * 1. Memória RAM (0ms)
 * 2. Cache Storage API `gamelauncher-covers-v1` / IndexedDB
 * 3. Download via Rede (`apiFetch`) -> Salva assincronamente no Cache -> Retorna Blob URL
 */
export function getOrFetchCover(fileOrUrl) {
  const url = resolveCoverHref(fileOrUrl);
  if (!url || failedUrls.has(url)) return Promise.resolve(null);

  const memHit = memoryBlobUrlMap.get(url);
  if (memHit) return Promise.resolve(memHit);

  const existingPromise = inflightMap.get(url);
  if (existingPromise) return existingPromise;

  const task = (async () => {
    try {
      // 1. Verifica Cache Local (Cache Storage API / IndexedDB)
      const cachedBlob = await readBlobFromStorage(url);
      if (cachedBlob) {
        const objUrl = URL.createObjectURL(cachedBlob);
        memoryBlobUrlMap.set(url, objUrl);
        return objUrl;
      }

      // 2. Não existe no cache: efetua download via rede
      const response = await apiFetch(url, {
        method: "GET",
        skipAuthPrompt: true,
      });

      if (!response.ok) {
        if (response.status === 404) {
          failedUrls.add(url);
        }
        return null;
      }

      const responseClone = hasCacheStorage() ? response.clone() : null;
      const blob = await response.blob();
      if (!blob || blob.size === 0) {
        failedUrls.add(url);
        return null;
      }

      const objUrl = URL.createObjectURL(blob);
      memoryBlobUrlMap.set(url, objUrl);

      // 3. Salva assincronamente no Cache Storage para os próximos acessos (sem bloquear a renderização)
      writeBlobToStorage(url, responseClone, blob).catch(() => {});

      return objUrl;
    } catch {
      return null;
    } finally {
      inflightMap.delete(url);
    }
  })();

  inflightMap.set(url, task);
  return task;
}

/**
 * Pré-carrega em background todas as capas ausentes de uma lista de jogos,
 * com concorrência controlada e cedendo tempo à thread principal da UI.
 */
export function preloadGameCovers(games = []) {
  if (!Array.isArray(games) || games.length === 0 || typeof window === "undefined") {
    return;
  }

  const urlsToPreload = [];
  const seen = new Set();

  for (const game of games) {
    const url = resolveCoverHref(game?.cover);
    if (!url || seen.has(url) || memoryBlobUrlMap.has(url) || failedUrls.has(url)) {
      continue;
    }
    seen.add(url);
    urlsToPreload.push(url);
  }

  if (urlsToPreload.length === 0) return;

  const scheduleIdle =
    typeof window.requestIdleCallback === "function"
      ? (cb) => window.requestIdleCallback(cb, { timeout: 1200 })
      : (cb) => setTimeout(cb, 32);

  let index = 0;

  const runWorker = () => {
    scheduleIdle(async () => {
      while (index < urlsToPreload.length) {
        const currentUrl = urlsToPreload[index++];
        if (!currentUrl || memoryBlobUrlMap.has(currentUrl)) continue;
        await getOrFetchCover(currentUrl);
      }
    });
  };

  const workersCount = Math.min(PRELOAD_CONCURRENCY, urlsToPreload.length);
  for (let i = 0; i < workersCount; i++) {
    runWorker();
  }
}
