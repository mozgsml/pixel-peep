# Deployment

Live at **https://pixel-peep.pages.dev**.

The application is entirely static: put `dist/` on any static host. The one requirement is
**being able to set HTTP headers**:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without them wasm threads and SIMD are unavailable and AVIF and JPEG XL become several times slower.
The failure is silent — everything looks fine. To check after a deploy, evaluate
`self.crossOriginIsolated === true` in the console; when it is `false` the application says so
itself.

## Cloudflare Pages — the target host

`public/_headers` lands in the root of `dist/` at build time:

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp

/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

The second section matters: the codec wasm binaries weigh tens of megabytes, and without a long
cache every visit re-downloads them. Vite puts content hashes in the file names, so `immutable` is
safe.

The built-in Pages Git integration is deliberately **not** used. With it, deployment happens on
Cloudflare's side and there is nowhere to put the smoke test. Instead the upload runs from GitHub
Actions via `wrangler pages deploy`, which also keeps the build off the 500-build Pages limit.

### Creating the project

Nothing to do by hand: `deploy.yml` creates the project if it does not exist. That is a necessity
rather than a convenience — the current Cloudflare dashboard has removed "Pages → Direct Upload"
from the interface, leaving only the Workers flows. The API and `wrangler` still work as before.

To create it ahead of time, locally:

```bash
export CLOUDFLARE_API_TOKEN='...'
export CLOUDFLARE_ACCOUNT_ID='...'
npx wrangler pages project create pixel-peep --production-branch=main
```

### Secrets

- `CLOUDFLARE_API_TOKEN` — a token whose only permission is `Account · Cloudflare Pages · Edit`,
  not the global account key. In "Account Resources" pick the account the id below belongs to;
- `CLOUDFLARE_ACCOUNT_ID` — visible in the dashboard URL
  (`https://dash.cloudflare.com/<ACCOUNT_ID>/…`) and in the "Account details" block on the right.
  **Not** the Zone ID, which looks identical and sits nearby.

Both go into GitHub Secrets, in the `production` environment bound to `deploy.yml`:

```bash
gh secret set CLOUDFLARE_API_TOKEN  --env production --repo <owner>/<repo>
gh secret set CLOUDFLARE_ACCOUNT_ID --env production --repo <owner>/<repo>
```

The project name comes from the `CLOUDFLARE_PROJECT_NAME` variable (`pixel-peep` by default).

Cloudflare answers every credential problem with the same opaque `Authentication error [code:
10000]`, so `deploy.yml` probes the token and the account separately before touching anything and
reports which of the two is wrong.

## Other hosts

### Netlify

The same `_headers`, nothing else.

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

### GitHub Pages

Arbitrary headers cannot be set there, so a fallback is included: `public/coi-serviceworker.js` puts
COOP/COEP back on the client. It registers automatically and **only** when the server did not send
the headers (`src/io/coi.ts`), and reloads exactly once.

Note that COEP breaks any third-party resource served without CORS. There are none here, but
anything you add would break.

## CI/CD

Production is updated when changes land on `main`; merging a pull request is the act of shipping.

| Workflow | When | What it does |
|---|---|---|
| `ci.yml` | push to a non-`main` branch, pull request | typecheck → tests → build |
| `preview.yml` | pull request | the same, plus a preview deployment and a link commented on the PR |
| `deploy.yml` | push to `main`, manual run | checks → build → deploy → wait → smoke test → rollback on failure |

`ci.yml` also asserts that `_headers` reached `dist/`. That is the most likely production failure:
the file does not ship, everything still works, and encoding is silently several times slower.

### Waiting before the smoke test

Between deploying and smoke-testing, `deploy.yml` waits until production actually serves the build
that was just made, by comparing the content hash of the entry bundle.

Waiting for the URL to merely answer is not enough, for two reasons. A brand-new project has no TLS
certificate for its subdomain yet, and the browser fails with `ERR_SSL_VERSION_OR_CIPHER_MISMATCH`.
And on a redeploy the previous build keeps answering for a while — during which a smoke test would
pass happily without having tested the new build at all.

### Rolling back

Automatic on smoke-test failure. By hand:

```bash
# deployments, newest first
npx wrangler pages deployment list --project-name=pixel-peep --environment=production

# roll back to a specific one
curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/pixel-peep/deployments/<DEPLOYMENT_ID>/rollback" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

Through the API rather than `wrangler`: there is no `pages deployment rollback` command in
`wrangler`, in either 3 or 4. The automatic rollback calls the same endpoint.

### Build version

Injected through `define` in `vite.config.ts` (`__BUILD_SHA__`, `__BUILD_DATE__`), shown in small
type in the corner of the interface and printed to the console at startup. Without it there is no
way to tell which build the person reporting a bug was looking at.

## Not configured yet

Branch protection on `main`. The workflows assume the PR flow, but direct pushes are still allowed,
so `ci.yml` and `preview.yml` do not actually gate anything. Settings → Branches → require a pull
request and the `check` status from `ci.yml`.
