# Self-hosting

Pixel Peep is a static site. Build it, put the folder on a web server, done — there is no backend,
no database and nothing to configure.

```bash
npm ci
npm run build      # → dist/
```

Then copy `dist/` wherever you serve files from.

## The one requirement

Your host must let you set two response headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

These put the page in a *cross-origin isolated* context, which is what unlocks `SharedArrayBuffer`
— and with it wasm threads and SIMD. The codecs need them: without isolation AVIF and JPEG XL
encode several times slower, and a large photo can take minutes instead of seconds.

**The failure is silent.** Everything still loads, every button still works, and nothing looks
wrong. That is what makes it worth checking deliberately.

### Checking

Open the page and evaluate this in the browser console:

```js
self.crossOriginIsolated   // must be true
```

If it is `false`, the application also says so itself in a banner — but the console is the quicker
answer.

### A caveat that comes with the headers

`require-corp` blocks any cross-origin resource that does not opt in with CORS. Pixel Peep loads
nothing from anywhere else, so there is nothing to break out of the box. If you add an analytics
script, a font from a CDN or an external image, it will be blocked until you serve it with the right
CORS headers.

## Configuration per host

### Anything with `_headers` — Cloudflare Pages, Netlify

`public/_headers` is already in the repository and lands in the root of `dist/` at build time.
Nothing to do.

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp

/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

The second section is worth keeping. The codec wasm binaries weigh tens of megabytes, and without a
long cache every visit re-downloads them. Vite puts a content hash in every file name, so
`immutable` is safe — a changed file gets a new name.

### Vercel — `vercel.json`

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }
      ]
    },
    {
      "source": "/assets/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    }
  ]
}
```

### Firebase Hosting — `firebase.json`

```json
{
  "hosting": {
    "public": "dist",
    "headers": [
      {
        "source": "**",
        "headers": [
          { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
          { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }
        ]
      },
      {
        "source": "/assets/**",
        "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
      }
    ]
  }
}
```

### nginx

```nginx
location / {
    add_header Cross-Origin-Opener-Policy  same-origin  always;
    add_header Cross-Origin-Embedder-Policy require-corp always;
    try_files $uri $uri/ /index.html;
}

location /assets/ {
    add_header Cross-Origin-Opener-Policy  same-origin  always;
    add_header Cross-Origin-Embedder-Policy require-corp always;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
}
```

`add_header` does not inherit into a nested `location`, which is why the two isolation headers are
repeated in the second block. Leaving them out there is a common and invisible mistake: the page
would be isolated, the wasm would not load, and nothing would say why.

### Apache — `.htaccess`

```apache
Header always set Cross-Origin-Opener-Policy "same-origin"
Header always set Cross-Origin-Embedder-Policy "require-corp"

<FilesMatch "^assets/">
  Header always set Cache-Control "public, max-age=31536000, immutable"
</FilesMatch>
```

### GitHub Pages, and other hosts with no header control

Arbitrary headers cannot be set on GitHub Pages, so a fallback ships with the application:
`public/coi-serviceworker.js` registers a service worker that re-issues every response with the
isolation headers attached.

It registers **only** when the server did not send the headers itself (`src/io/coi.ts`), and it
reloads the page exactly once so the isolated context takes effect. Nothing to enable — if your host
sends the headers, the fallback stays out of the way entirely.

Two things to know before relying on it: the very first page load is not isolated (the reload is
what fixes that), and the service worker needs a secure context, so `https` or `localhost`.

## Serving from a subdirectory

The build uses relative asset paths (`base: './'` in `vite.config.ts`), so `dist/` works from any
path — `example.com/`, `example.com/tools/pixel-peep/`, or a `file://` URL for a quick look, though
the last one will not be isolated.

## See also

- [How this project deploys itself](deploy.md) — the Cloudflare Pages and GitHub Actions setup, as
  a worked example
- [Architecture](architecture.md)
