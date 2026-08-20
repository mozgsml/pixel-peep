/*
 * Cross-origin isolation fallback.
 *
 * Some static hosts (GitHub Pages, most notably) cannot serve custom headers.
 * This worker re-issues every same-origin response with COOP/COEP attached, so
 * `crossOriginIsolated` becomes true and the wasm codecs get threads and SIMD
 * back. It is registered only when the server did not already send the headers
 * — see src/io/coi.ts.
 *
 * Note that COEP breaks any third-party resource served without CORS. This
 * application loads nothing from anywhere else, so there is nothing to break.
 *
 * Approach follows gzuidhof/coi-serviceworker (MIT).
 */

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Range requests replayed through the worker would be served incorrectly.
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.status === 0) return response;
        const headers = new Headers(response.headers);
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      })
      .catch((error) => {
        console.error('coi-serviceworker:', error);
        throw error;
      }),
  );
});
