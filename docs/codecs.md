# Adding a codec

Adding a format must come down to **one file in `src/codecs/` and one line in the registry**. There
is no `switch` on format id anywhere else; controls, the dropdown entry, lazy wasm loading, caching,
metrics and worker plumbing all follow from the declaration.

## The four steps

1. `npm i <codec package>`
2. create `src/codecs/<id>.ts` implementing `CodecAdapter`
3. add one line to `src/codecs/registry.ts`
4. add a round-trip test from the shared template

Nothing outside `src/codecs/` should need to change. If it does, that is a bug in the abstraction
rather than something to work around.

## The contract

```ts
type ParamSchema = ReadonlyArray<
  | { kind: 'range'; key: string; label: string; min: number; max: number; step: number; default: number }
  | { kind: 'toggle'; key: string; label: string; default: boolean }
  | { kind: 'select'; key: string; label: string; options: {value: string; label: string}[]; default: string }
>;

interface CodecAdapter {
  id: string;
  label: string;
  mime: string;
  extension: string;
  lossless: boolean | 'optional';
  params: ParamSchema;
  encode(image: ImageData, params: Record<string, unknown>, signal: AbortSignal): Promise<ArrayBuffer>;
  decode(bytes: ArrayBuffer, signal: AbortSignal): Promise<ImageData>;
}
```

Each schema entry may also carry a `hint` and an `enabledWhen` predicate, so a control that has
become meaningless — quality once lossless is on — disables itself without the UI knowing why.
Labels and hints are message keys resolved through `t()`; see [translations](i18n.md).

Keep the wasm behind a dynamic `import()` inside `encode` / `decode`, and wrap it in `loadCodec`:

```ts
const { default: encode } = await loadCodec('WebP', () => import('@jsquash/webp/encode'));
```

Importing the registry then costs nothing, and a codec is fetched only when a panel actually
selects it.

The wrapper is not decoration. A dropped request on that first fetch is otherwise permanent: a
rejected dynamic import is recorded in the realm's module map, so every later `import()` of the
same specifier rejects from cache **without touching the network** — "Retry" issues no request at
all and only a page reload recovers. `loadCodec` turns the failure into a `CodecLoadError`, which
tells the worker pool to retire that worker; the retry then runs in a fresh realm and genuinely
re-fetches. A codec that skips the wrapper loses all of this silently.

Check `signal.aborted` at every await point. `AbortSignal` genuinely interrupting is part of the
contract and is tested.

## Option names

Take the exact option names **from the `.d.ts` of the installed package**, not from documentation
and not from memory — they have changed between major `@jsquash` versions. What each format should
expose to the user in *meaning* is a product decision; mapping that onto real fields is the
adapter's job.

Two traps worth knowing:

- **WebP lossless needs the `exact` flag.** Without it libwebp is free to rewrite RGB under fully
  transparent pixels, which silently corrupts the metrics of anything with an alpha channel.
- **libaom's `speed` runs backwards** from every other effort knob here — 0 is slowest and best.
  The AVIF adapter inverts it so the control reads the same way as the others.
- **JPEG XL gives out above roughly 20 Mpx.** Every one of these wasm modules is capped at 2 GB of
  address space, and libjxl passes that somewhere between 20 and 24 Mpx — so an ordinary camera
  photograph is already too big. It dies inside the module, so the console and the network stay
  clean and the only thing that comes back is a trap word: `unreachable`, `Aborted()`, or a
  corrupted table index, depending on where it happened to fall over. Neither quality nor effort
  changes it. `WASM_EXHAUSTED` in `pipeline.ts` recognises those words and the panel says what
  actually happened instead of repeating them; a new codec that can run out of room needs nothing
  added, as long as its wasm aborts the same way.

## Determinism

Encoding the same image with the same parameters must produce byte-identical output. The cache is
keyed on `(sourceId, formatId, hash(params), scale)` and depends on it. The shared test checks this
for every registered codec.

## The shared test

`tests/codecs.test.ts` is parameterised over the registry, so a new adapter is picked up without
writing a new test. Every codec must satisfy:

- `encode → decode` yields `ImageData` of the original dimensions;
- lossless modes match bit for bit;
- a pre-aborted `AbortSignal` rejects with `AbortError`;
- repeated calls with the same parameters produce identical bytes.

## `png` is the control sample

PNG is in the list not as a competitor but as proof the pipeline is intact: its PSNR must come out
as `Infinity`. If it does not, something between decode, encode and metrics is broken — the codec is
the last place to look. Both a unit test and the post-deploy smoke test check exactly this.

## Known deviation: JPEG XL lossless

JPEG XL in lossless mode is **not bit-exact**, and the encoder is not at fault. The wasm build of
the libjxl decoder converts through float and rounds, leaving a handful of samples out of thousands
off by ±1, so PSNR does not read `∞`.

This is recorded as an explicit tolerance in `tests/codecs.test.ts` and stated in the tooltip on the
switch, rather than hidden. If a future version of the package fixes it, the tolerance is the thing
to delete.

## `debug-blur`

A fake codec whose only job is to prove the scheme holds. It blurs the image, quantises, and
run-length encodes the result — so its "file size" is an honest byte count that responds to its
controls rather than a made-up number.

It exists so that the four-step checklist can be verified: it must appear in the interface with its
own generated controls, its own worker task, cache entry and metrics, without a single edit outside
its own file and the registry. It is hidden behind the development flag — `npm run dev`, or `?dev`
in the URL.

## See also

- [Architecture](architecture.md) — the pipeline the adapter plugs into
- [Testing](testing.md)
