import { beforeAll, describe, expect, it } from 'vitest';
import { codecs, listCodecs } from '../src/codecs/registry.ts';
import { type CodecAdapter, defaultParams, normaliseParams } from '../src/codecs/types.ts';
import { psnr } from '../src/core/metrics.ts';
import { codecsReady } from './setup.ts';

/**
 * The shared adapter template, parameterised over every registered codec.
 * A new format is expected to pass this table with no edits beyond its own row
 * in the registry.
 */

const WIDTH = 48;
const HEIGHT = 32;

function testImage(): ImageData {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const o = (y * WIDTH + x) * 4;
      data[o] = (x * 5) % 256;
      data[o + 1] = (y * 8) % 256;
      data[o + 2] = ((x + y) * 3) % 256;
      data[o + 3] = 255;
    }
  }
  return new ImageData(data, WIDTH, HEIGHT);
}

/** Distinct RGB under fully transparent pixels — the WebP `exact` trap. */
function alphaImage(): ImageData {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const o = (y * WIDTH + x) * 4;
      data[o] = 200;
      data[o + 1] = 30;
      data[o + 2] = 90;
      data[o + 3] = x < WIDTH / 2 ? 0 : 255;
    }
  }
  return new ImageData(data, WIDTH, HEIGHT);
}

/**
 * Every codec here must decode its own lossless output bit for bit — that is
 * what makes the png control sample meaningful.
 *
 * JPEG XL is the one exception, and it is the *decoder*, not the encoder: the
 * squoosh libjxl decode build converts through float and rounds, leaving a
 * handful of samples off by one (about 0.07% of them on random noise). The
 * encoder really is in lossless mode; the wasm decoder just cannot hand the
 * pixels back unchanged. Recorded here rather than hidden so the deviation is
 * visible if a future version of the package fixes it.
 */
const DECODER_TOLERANCE: Record<string, number> = { jxl: 1 };

function maxError(a: ImageData, b: ImageData): number {
  let max = 0;
  for (let i = 0; i < a.data.length; i++) max = Math.max(max, Math.abs(a.data[i]! - b.data[i]!));
  return max;
}

function bytesEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

/** Lossless parameter set for a codec, or null when it has no lossless mode. */
function losslessParams(codec: CodecAdapter): Record<string, string | number | boolean> | null {
  if (codec.lossless === true) return defaultParams(codec.params);
  if (codec.lossless !== 'optional') return null;
  const params = normaliseParams(codec.params, { ...defaultParams(codec.params), lossless: true });
  return codec.isLossless?.(params) ? params : null;
}

beforeAll(async () => {
  await codecsReady();
}, 120_000);

describe.each(codecs.map((codec) => [codec.id, codec] as const))('adapter %s', (_id, codec) => {
  const params = defaultParams(codec.params);

  it('declares a usable descriptor', () => {
    expect(codec.id).toMatch(/^[a-z0-9-]+$/);
    expect(codec.label.length).toBeGreaterThan(0);
    expect(codec.mime).toContain('/');
    expect(codec.extension.length).toBeGreaterThan(0);
    for (const param of codec.params) {
      expect(param.key).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/);
      expect(param.label.length).toBeGreaterThan(0);
    }
  });

  it('round-trips to an image of the original size', async () => {
    const image = testImage();
    const bytes = await codec.encode(image, params, new AbortController().signal);
    expect(bytes.byteLength).toBeGreaterThan(0);

    const decoded = await codec.decode(bytes, new AbortController().signal);
    expect(decoded.width).toBe(WIDTH);
    expect(decoded.height).toBe(HEIGHT);
    expect(decoded.data.length).toBe(WIDTH * HEIGHT * 4);
  });

  it('is deterministic, so the cache can trust its key', async () => {
    const image = testImage();
    const first = await codec.encode(image, params, new AbortController().signal);
    const second = await codec.encode(image, params, new AbortController().signal);
    expect(bytesEqual(first, second)).toBe(true);
  });

  it('honours an aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(codec.encode(testImage(), params, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });

    const bytes = await codec.encode(testImage(), params, new AbortController().signal);
    const decodeController = new AbortController();
    decodeController.abort();
    await expect(codec.decode(bytes, decodeController.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  const lossless = losslessParams(codec);
  const tolerance = DECODER_TOLERANCE[codec.id] ?? 0;

  it.runIf(lossless)('is bit-exact in lossless mode', async () => {
    const image = testImage();
    const bytes = await codec.encode(image, lossless!, new AbortController().signal);
    const decoded = await codec.decode(bytes, new AbortController().signal);
    expect(decoded.width).toBe(WIDTH);

    if (tolerance === 0) {
      expect([...decoded.data]).toEqual([...image.data]);
      expect(psnr(image, decoded)).toBe(Infinity);
    } else {
      expect(maxError(image, decoded)).toBeLessThanOrEqual(tolerance);
      expect(psnr(image, decoded)).toBeGreaterThan(60);
    }
  });

  it.runIf(lossless && codec.id !== 'original')(
    'keeps RGB under fully transparent pixels in lossless mode',
    async () => {
      const image = alphaImage();
      const bytes = await codec.encode(image, lossless!, new AbortController().signal);
      const decoded = await codec.decode(bytes, new AbortController().signal);
      expect(maxError(image, decoded)).toBeLessThanOrEqual(tolerance);
    },
  );
});

describe('the pipeline control sample', () => {
  it('gives PSNR = Infinity for png — proof the pipeline is intact', async () => {
    const png = codecs.find((c) => c.id === 'png')!;
    const image = testImage();
    const bytes = await png.encode(image, defaultParams(png.params), new AbortController().signal);
    const decoded = await png.decode(bytes, new AbortController().signal);
    expect(psnr(image, decoded)).toBe(Infinity);
  });
});

describe('lossy codecs actually compress', () => {
  it.each(['jpeg', 'webp', 'avif', 'jxl'])('%s produces a smaller file than raw pixels', async (id) => {
    const codec = codecs.find((c) => c.id === id)!;
    const image = testImage();
    const bytes = await codec.encode(image, defaultParams(codec.params), new AbortController().signal);
    expect(bytes.byteLength).toBeLessThan(image.data.byteLength);
  });

  it('lowering quality lowers the size', async () => {
    const jpeg = codecs.find((c) => c.id === 'jpeg')!;
    const image = testImage();
    const base = defaultParams(jpeg.params);
    const high = await jpeg.encode(image, { ...base, quality: 95 }, new AbortController().signal);
    const low = await jpeg.encode(image, { ...base, quality: 20 }, new AbortController().signal);
    expect(low.byteLength).toBeLessThan(high.byteLength);
  });
});

describe('the registry', () => {
  it('has no duplicate ids', () => {
    const ids = codecs.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('hides development-only formats from production builds', () => {
    expect(listCodecs(false).some((c) => c.id === 'debug-blur')).toBe(false);
    expect(listCodecs(true).some((c) => c.id === 'debug-blur')).toBe(true);
  });

  it('drives the interface entirely from declarations', () => {
    // The "add a format" checklist: a file in codecs/ plus one registry line.
    // Everything the interface needs must come out of the descriptor.
    for (const codec of codecs) {
      expect(typeof codec.encode).toBe('function');
      expect(typeof codec.decode).toBe('function');
      expect(Array.isArray(codec.params)).toBe(true);
      expect(Object.keys(defaultParams(codec.params))).toEqual(codec.params.map((p) => p.key));
    }
  });
});
