# Architecture

How the thing is put together, and why the awkward-looking parts are the way they are.

## Layout

```
src/
  core/        # DOM-free pure functions: geometry, viewport, metrics, cache, store, exif
  codecs/      # registry and adapters; wasm behind a dynamic import()
  workers/     # worker pool with cancellation of stale tasks, plus the message protocol
  render/      # mip pyramids, multi-pass downsampling, panel drawing
  io/          # file decoding, cross-origin isolation fallback
  i18n/        # message catalogues and lookup
  ui/          # layout, panel, generated controls, toolbar
  app/         # state, encoding pipeline, wiring
```

`core/` knows nothing about the DOM — that is a rule, not an aspiration. It is what lets the
geometry be tested exhaustively without a browser. `core/image-source.ts` holds the type and the
pure helpers; the browser-dependent decoding lives in `io/decode-file.ts` so the rule holds
literally.

State is a small home-grown store (observable plus subscriptions, roughly 100 lines). No framework:
everything heavy is drawn into a canvas imperatively, and only the interface chrome needs
reactivity.

Every panel owns its source, its format and its parameters. `PanelState[]` is an array and nothing
assumes it has two entries — no `panels[0]/panels[1]` instead of iteration, no `left`/`right` names,
no layout hard-wired to a two-cell grid. Synchronisation is an operation over the array.

## Geometry

`core/geometry.ts` is pure mathematics and is tested harder than anything else here. It is worth
understanding before changing anything that moves.

Notation: `Wᵢ × Hᵢ` is the image size of panel i in pixels, `PW × PH` the panel size in CSS pixels.

### Scale

One global parameter `z` across all panels:

```
fitᵢ = min(PW / Wᵢ, PH / Hᵢ)          // z=0: the whole image is visible
scaleᵢ(z) = fitᵢ ^ (1 − z)             // z=1: one image pixel per device pixel
```

The interpolation is **geometric, not linear**. Equal wheel deltas must produce equal *ratios* of
magnification, not equal differences, or the wheel feels lumpy. If `fitᵢ > 1` — the image is smaller
than the panel — the scale simply runs the other way; the logic is unchanged and no clamping is
needed.

`z` is allowed outside `[0, 1]`: it runs from −0.35 to 3, so a frame can be pushed away from the
panel edge and artefacts can be inspected past 1:1.

### Position

The stored value is a **normalised** point `(u, v) ∈ [0,1]²` — the image point sitting at the centre
of the panel. Percentages instead of pixels give synchronisation of differently sized images for
free. The visible window, in the same units:

```
visWᵢ = PW / (Wᵢ · scaleᵢ)
visHᵢ = PH / (Hᵢ · scaleᵢ)
```

### Zoom anchored under the cursor

Without this the zoom drifts and the tool is unusable:

```
1. before changing z: resolve the normalised point (uc, vc) under the cursor
2. apply the new z, recompute scale and vis
3. choose (u, v) so that (uc, vc) stays under the cursor:
   u = uc − (cursorX/PW − 0.5) · visW
   v = vc − (cursorY/PH − 0.5) · visH
4. recompute the other panels according to the synchronisation mode
5. clamp
```

Zooming from the keyboard or the slider anchors at the centre of the panel.

### Clamping — read this before changing it

When the image is larger than the panel (`vis < 1`) the visible window is held inside it,
`u ∈ [visW/2, 1 − visW/2]`, so the panel is never part background.

When the image already fits (`vis ≥ 1`) the centre is **not** pinned to `0.5`. It is bounded to
`u ∈ [0, 1]` instead: the frame can be nudged aside, but the centre of the panel always stays
somewhere inside the image, so it can never be pushed off screen entirely.

This looks like a missing simplification and is not. Pinning the centre made a small frame
impossible to move at all, and in "continue" mode the second panel then never reached the frame — it
showed empty background at every zoom below 1:1, which is exactly the range that mode exists for.

### Panning modes

`mirror` — every panel shares `(u, v)`. The same fragment shown twice.

`continue` — panel i+1 shows the region beginning where panel i's region ended:

```
u_{i+1} = u_i + visW_i / 2 + gap_i + visW_{i+1} / 2
```

along whichever axis the panels are laid out on, taken from the current layout rather than from a
setting. `gap` is the divider width expressed in fractions of the image: the divider hides part of
the frame, and without accounting for it the seam is off by exactly those pixels — visibly so once
the divider has been dragged.

Clamping applies to the leading panel and the rest are derived from it. A trailing panel may run
into the edge, and one whose window falls entirely outside the frame says so rather than showing an
unexplained grey rectangle.

## Rendering

- One `<canvas>` per panel. Backing store is `PW·dpr × PH·dpr`, CSS size is `PW × PH`. Without this
  "1:1" is a lie on a retina display.
- The decoded `ImageData` goes into an offscreen canvas **once**; every frame afterwards is a single
  `drawImage` with a transform. `putImageData` per frame would cap the whole thing at a few frames a
  second on a 24 Mpx photo.
- `scale ≥ 1` → `imageSmoothingEnabled = false`. We are looking at real pixels, not interpolation.
  The exception is a proxy-resolution preview, whose enlarged pixels are not the truth and are
  smoothed rather than presented as fact.
- `scale < 1` → multi-pass downsampling (successive halving) with a cached mip pyramid, so the final
  step never reduces by more than half. A single-pass browser resize aliases, and then you are
  comparing scaling artefacts rather than codecs.
- One `requestAnimationFrame` loop with a dirty flag draws all panels in the same frame, or they
  visibly drift apart while being dragged.
- Textures are owned by a shared store rather than by a panel, because the flip test shows panel 0's
  pixels inside every panel and rebuilding a mip pyramid on every press of the space bar would
  defeat the point of the flip test.

## The encoding pipeline

```
ImageSource.full (or .proxy) → encode(params) → Blob   ← the size comes from here
                                       ↓
                                    decode → ImageData  ← this is what is drawn
```

What is displayed is the **decoded result**, not the original. Otherwise there is nothing to compare.

### Proxy previews

- `PROXY_MAX_PIXELS = 4_000_000`, about 2560×1600.
- While a quality slider is being dragged the proxy is encoded, debounced by 200 ms. The panel is
  marked as encoding when the task is *scheduled*, not when the debounce expires, so a drag says
  immediately that it is working. On release, a full-size encode is queued.
- A proxy result is badged "preview", its size is shown with a `≈`, and "of original" is withheld —
  comparing proxy bytes against the source file would be a lie. Saving stays disabled until the
  full-resolution pass lands, so a preview is never saved under a full-size name.

### Cancellation

A new task for a panel aborts its previous unfinished one. A wasm encode is a single synchronous
call and cannot be interrupted midway, so aborting drops queued tasks immediately and releases the
caller at once, discarding the eventual result. The alternative — making the interface wait for a
dead encode to finish — is exactly the lag being avoided.

Pool size is `min(navigator.hardwareConcurrency − 1, 4)`.

## Memory is the binding constraint

A 24 Mpx photo is 96 MB as `ImageData`. The original plus two results plus the buffers inside wasm
easily reach 400+ MB, and mobile Safari dies. Hence:

- caches and budgets are counted **in pixels, not entries** — a 24 Mpx result and a thumbnail cost
  wildly different amounts of memory, and it is memory that kills the tab;
- the original is stored once and panels reference it by `sourceId`;
- a result's `ImageData` is dropped as soon as the panel changes format or parameters;
- the result cache is deliberately modest. Going back to a previous format re-encodes; running out
  of memory does not recover;
- a file above the limit produces a warning and an offer to work on the proxy.

`e2e/memory.spec.ts` guards this: 30 format switches on a 12 Mpx photo must not grow the heap past
the cache budget.

## Metrics

Computed in a worker, at full size, between the result and that panel's own reference.

- **PSNR** — `10·log₁₀(255² / MSE)` over R, G, B; alpha ignored. A byte-for-byte match gives `∞`.
- **SSIM** — 8×8 window, averaged over the image.
- **Difference map** `|A − B|` with a gain slider. The gain is applied as a draw-time filter, so the
  slider responds instantly and nothing is recomputed.

PSNR correlates poorly with perception — a frame nudged in brightness scores badly, a smeared one
scores well — and the interface says so in a tooltip rather than presenting the number as a verdict.

## Visual language

This is a measuring instrument, not a shop window:

- strictly neutral palette, background around 18% grey, one accent colour used only for active
  controls. **No colour within 200 px of the image**: coloured surroundings shift colour perception
  and make the tool unfit for its purpose;
- tabular figures, so metrics do not jump as they update;
- no transition animations between image states — any movement makes it harder to notice the
  difference between frames;
- visible keyboard focus, `prefers-reduced-motion`, and text contrast for the metrics no lower
  than AA.

## See also

- [Adding a codec](codecs.md)
- [Translations](i18n.md)
- [Testing](testing.md)
- [Self-hosting](self-hosting.md)
- [How this deploys](deploy.md)
