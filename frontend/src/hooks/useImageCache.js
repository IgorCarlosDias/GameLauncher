import { useCallback, useEffect, useState } from "react";
import {
  getCachedCoverSync,
  getOrFetchCover,
  invalidateCachedCover,
  isCoverFailed,
  resolveCoverHref,
} from "../lib/imageCache";

/**
 * Hook React para renderização instantânea (0ms) de capas via Cache Storage (`gamelauncher-covers-v1`).
 * Fluxo: Memória (0ms) -> Cache Storage Local -> Rede -> Salva no Cache.
 */
export function useImageCache(fileOrUrl) {
  const targetUrl = resolveCoverHref(fileOrUrl);

  const [entry, setEntry] = useState(() => ({
    url: targetUrl,
    src: targetUrl ? getCachedCoverSync(targetUrl) : null,
    failed: targetUrl ? isCoverFailed(targetUrl) : false,
  }));

  useEffect(() => {
    if (!targetUrl) return undefined;

    const syncHit = getCachedCoverSync(targetUrl);
    if (syncHit) {
      return undefined;
    }

    let cancelled = false;
    getOrFetchCover(targetUrl).then((resolvedBlobUrl) => {
      if (cancelled) return;
      if (resolvedBlobUrl) {
        setEntry({ url: targetUrl, src: resolvedBlobUrl, failed: false });
      } else {
        setEntry({ url: targetUrl, src: null, failed: true });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [targetUrl]);

  const handleError = useCallback(() => {
    if (!targetUrl) return;
    invalidateCachedCover(targetUrl);
    setEntry({ url: targetUrl, src: null, failed: true });
  }, [targetUrl]);

  if (!targetUrl) {
    return { src: null, failed: false, onError: handleError };
  }

  // Se o cache em memória já possui a imagem (ex: pré-carregada em background), retorna em 0ms
  const memoryHit = getCachedCoverSync(targetUrl);
  const isCurrentUrl = entry.url === targetUrl;
  const failed = isCurrentUrl ? entry.failed : isCoverFailed(targetUrl);
  const src = failed ? null : memoryHit || (isCurrentUrl ? entry.src : null) || targetUrl;

  return {
    src,
    isCachedBlob: Boolean(memoryHit || (isCurrentUrl && entry.src)),
    failed,
    onError: handleError,
  };
}
