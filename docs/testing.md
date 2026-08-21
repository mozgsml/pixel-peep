# Testing

```bash
npm run typecheck    # tsc --noEmit, strict
npm test             # unit tests and codec round-trips
npm run test:e2e     # real Chrome against the production build
npm run smoke        # only the smoke suite; honours BASE_URL
```

The end-to-end tests drive the Chrome already installed on the machine (`channel: 'chrome'`), so
there is no separate browser download. Set `BASE_URL` to point them at a deployment instead of a
local build.

## Unit tests

Run in node with a small `ImageData` polyfill. Codec tests pre-compile the wasm from `node_modules`
and hand it to `@jsquash`'s `init()`, because node cannot `fetch` a local `.wasm` — so they exercise
the real encoders, not a mock.

| Area | What it covers |
|---|---|
| `geometry` | the top priority. Every formula, including `fit > 1`, degenerate sizes, window resize, both panning modes, the divider gap |
| `metrics` | synthetic data with a closed-form PSNR, the alpha-is-ignored rule, SSIM behaviour on a brightness shift |
| `cache` | eviction by pixel budget rather than entry count, LRU order, pruning |
| `codecs` | round-trips, parameterised over the registry — see [codecs](codecs.md) |
| `pool` | queueing, cancellation of queued and running tasks, error routing |
| `store`, `exif`, `image-source`, `i18n` | the rest |

## End-to-end tests

Three files, by purpose:

- **`smoke.spec.ts`** — what must be true of a deployment. Cross-origin isolation, the build under
  test being the one just deployed, file loading, `PSNR = ∞` on PNG, encoding to WebP and JXL, and
  1:1 really being one image pixel per device pixel. This is what runs after a deploy.
- **`interaction.spec.ts`** — the things unit tests cannot reach: the divider, panning a frame
  smaller than its panel, the encoding indicator, saving, the language switch, the alignment
  control.
- **`memory.spec.ts`** — 30 format switches on a 12 Mpx photo must not grow the heap past the cache
  budget. Uses CDP to force a collection before measuring.

## Fixtures

Kept small — up to roughly 200 KB each, or the repository swells. `tests/fixtures/sample.png` is a
generated target with gradients, hard edges and fine checkerboards, chosen because those are the
three things codecs fail at differently.

## What the tests do not catch

Worth a human look after touching the interface, because none of this is asserted:

- the divider under a real finger, and in the vertical layout;
- "continue" mode at low zoom with two frames of different aspect ratio;
- the compact (phone) layout — the panel header and the metrics row are both tight, and anything
  added to either can push a control off screen while remaining perfectly "visible" to a test.

That last one has bitten twice. A control that exists in the DOM, has non-zero size and sits outside
the viewport passes every reasonable assertion and is still unreachable.
