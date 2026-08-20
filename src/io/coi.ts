/**
 * Cross-origin isolation is what gives the wasm codecs threads and SIMD.
 * Without it AVIF and JPEG XL are several times slower — and the failure is
 * silent, which is the worst kind.
 *
 * The headers should come from the server (`public/_headers`). Where the host
 * cannot send them, a service worker can put them back on the client. This
 * registers that fallback, once, and only when it is actually needed.
 */

const RELOAD_FLAG = 'pixel-peep:coi-reloaded';

export async function ensureCrossOriginIsolation(): Promise<boolean> {
  if (self.crossOriginIsolated) return true;
  if (!('serviceWorker' in navigator)) return false;

  // Service workers need a secure context; on plain http there is nothing to do.
  if (!self.isSecureContext) return false;

  try {
    const url = new URL('coi-serviceworker.js', document.baseURI);
    const registration = await navigator.serviceWorker.register(url, { scope: './' });
    await registration.update().catch(() => undefined);

    // Only the reload after the worker takes control is actually isolated, and
    // exactly one reload is allowed — a loop here would be unescapable.
    if (registration.active && !sessionStorage.getItem(RELOAD_FLAG)) {
      sessionStorage.setItem(RELOAD_FLAG, '1');
      location.reload();
      return false;
    }
  } catch {
    return false;
  }

  return self.crossOriginIsolated;
}
