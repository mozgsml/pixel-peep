# How this project deploys itself

This describes the deployment of **this particular repository** to
[pixel-peep.pages.dev](https://pixel-peep.pages.dev) — Cloudflare Pages, driven by GitHub Actions.
It is written down mostly so that we do not have to rediscover it in six months.

If you only want to put your own copy somewhere, none of this is required — see
[self-hosting](self-hosting.md), which is two headers and a folder. Read on if you are working on
this repository, or if you want a worked example of the same pipeline with a smoke test attached.

Production is updated when changes land on `main`; merging a pull request is the act of shipping.

## The three workflows

| Workflow | When | What it does |
|---|---|---|
| `ci.yml` | push to a non-`main` branch, pull request | typecheck → tests → build |
| `preview.yml` | pull request | the same, plus a preview deployment and a link commented on the PR |
| `deploy.yml` | push to `main`, manual run | checks → build → deploy → wait → smoke test → rollback on failure |

`ci.yml` also asserts that `_headers` actually reached `dist/`. That is the most likely production
failure by a wide margin: the file does not ship, everything still works, and encoding is silently
several times slower.

## Cloudflare Pages

The built-in Pages Git integration is deliberately **not** used, although it does exactly this job.
With it, the build and deploy happen on Cloudflare's side and there is nowhere to hang a smoke test.
Uploading from Actions with `wrangler pages deploy` keeps that step, and as a side effect the build
does not consume the 500-build Pages limit.

### The project is created by the workflow

`deploy.yml` creates the Pages project if it does not exist. That is a necessity rather than a
convenience: the current Cloudflare dashboard has removed "Pages → Direct Upload" from the
interface, leaving only the Workers flows, so there is no longer a way to create one by hand.

The API and `wrangler` still work as before. To create it ahead of time:

```bash
export CLOUDFLARE_API_TOKEN='...'
export CLOUDFLARE_ACCOUNT_ID='...'
npx wrangler pages project create pixel-peep --production-branch=main
```

The project name comes from the `CLOUDFLARE_PROJECT_NAME` variable, defaulting to `pixel-peep`.

### Secrets

Both live in GitHub Secrets, in the `production` environment bound to `deploy.yml`:

```bash
gh secret set CLOUDFLARE_API_TOKEN  --env production --repo <owner>/<repo>
gh secret set CLOUDFLARE_ACCOUNT_ID --env production --repo <owner>/<repo>
```

- **`CLOUDFLARE_API_TOKEN`** — a token whose only permission is `Account · Cloudflare Pages · Edit`,
  not the global account key. In "Account Resources" pick the account the id below belongs to; a
  token scoped to a different account fails in a way that looks like a bad token.
- **`CLOUDFLARE_ACCOUNT_ID`** — the 32 hex characters straight after `dash.cloudflare.com/` in the
  address bar, also shown in the "Account details" block. **Not** the Zone ID, which looks identical
  and sits right next to it on a domain's page.

Cloudflare answers *every* credential problem with the same opaque `Authentication error
[code: 10000]` — wrong token, wrong account, insufficient permission, all identical. So `deploy.yml`
probes the token and the account separately before touching anything and says which of the two is
wrong. That check exists because working it out from the raw error took several rounds.

## Waiting before the smoke test

Between deploying and smoke-testing, the workflow waits until production actually serves the build
that was just made, by comparing the content hash of the entry bundle in `dist/index.html` against
what the live URL returns.

Waiting for the URL to merely answer is not enough, for two separate reasons:

- a brand-new project has no TLS certificate for its subdomain yet, and the browser fails with
  `ERR_SSL_VERSION_OR_CIPHER_MISMATCH` — which is what happened on the very first deploy;
- on a redeploy the previous build keeps answering for a while, and a smoke test would pass happily
  against it without having tested the new build at all.

## The smoke test

`e2e/smoke.spec.ts`, run against the deployed URL with `BASE_URL` set. It checks that the build
under test is the one just deployed, that `self.crossOriginIsolated` is true, that a fixture image
loads, that PNG gives `PSNR = ∞`, that WebP and JXL encode, and that 1:1 is really one image pixel
per device pixel.

The isolation check is the important one, for the reason in `ci.yml` above.

## Rolling back

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

## Build version

Injected through `define` in `vite.config.ts` (`__BUILD_SHA__`, `__BUILD_DATE__`), shown in small
type in the corner of the interface and printed to the console at startup. Without it there is no
way to tell which build the person reporting a bug was looking at.

One consequence worth knowing: `__BUILD_DATE__` has minute precision, so **the build is not
reproducible** — the same commit built a minute later produces different file hashes. The wait step
above is unaffected, because it compares production against a `dist/` built in the same job, but you
cannot verify "is production serving my commit" by rebuilding locally and comparing hashes. Read the
build info out of the page instead.

## No branch protection, on purpose

`main` takes direct pushes. `ci.yml` and `preview.yml` therefore gate nothing by themselves — they
run on pull requests, and nobody is obliged to open one.

That is a decision, not an omission: at this size the pull-request ceremony costs more than it
catches. What actually protects production is downstream of the push — `deploy.yml` runs typecheck,
tests and build before it will deploy at all, then smoke-tests the deployed site and rolls back on
failure. A bad push does not reach production; it fails the deploy.

Worth revisiting the day more than one person pushes here. Settings → Branches → require a pull
request and the `check` status from `ci.yml`.
