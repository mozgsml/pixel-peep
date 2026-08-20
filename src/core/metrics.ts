/**
 * Quality metrics. Pure functions over raw RGBA buffers so they can run in a
 * worker without touching the DOM.
 *
 * Honest caveat, repeated in the interface: PSNR and SSIM correlate poorly with
 * perception. A frame nudged in brightness scores badly; a smeared one scores
 * well. They are hints, not verdicts.
 */

export interface PlainImage {
  readonly data: Uint8ClampedArray | Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface Metrics {
  /** `Infinity` when the buffers match byte for byte. */
  readonly psnr: number;
  readonly ssim: number;
  readonly mse: number;
}

function assertSameShape(a: PlainImage, b: PlainImage): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
}

/** Mean squared error over R, G, B. Alpha is deliberately ignored. */
export function mse(a: PlainImage, b: PlainImage): number {
  assertSameShape(a, b);
  const da = a.data;
  const db = b.data;
  const n = a.width * a.height;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const dr = da[o]! - db[o]!;
    const dg = da[o + 1]! - db[o + 1]!;
    const dbl = da[o + 2]! - db[o + 2]!;
    sum += dr * dr + dg * dg + dbl * dbl;
  }
  return sum / (n * 3);
}

/** `10 * log10(255^2 / MSE)`. */
export function psnrFromMse(value: number): number {
  if (value <= 0) return Infinity;
  return 10 * Math.log10((255 * 255) / value);
}

export function psnr(a: PlainImage, b: PlainImage): number {
  return psnrFromMse(mse(a, b));
}

const K1 = 0.01;
const K2 = 0.03;
const L = 255;
const C1 = (K1 * L) ** 2;
const C2 = (K2 * L) ** 2;
const WINDOW = 8;

/** Rec. 709 luma, matching what the eye weighs most. */
function luma(data: Uint8ClampedArray | Uint8Array, offset: number): number {
  return 0.2126 * data[offset]! + 0.7152 * data[offset + 1]! + 0.0722 * data[offset + 2]!;
}

/**
 * SSIM over non-overlapping 8x8 windows, averaged across the image.
 * Partial windows at the right/bottom edge are included at their real size.
 */
export function ssim(a: PlainImage, b: PlainImage): number {
  assertSameShape(a, b);
  const { width, height } = a;
  if (width === 0 || height === 0) return 1;

  const da = a.data;
  const db = b.data;
  let total = 0;
  let windows = 0;

  for (let wy = 0; wy < height; wy += WINDOW) {
    const yEnd = Math.min(wy + WINDOW, height);
    for (let wx = 0; wx < width; wx += WINDOW) {
      const xEnd = Math.min(wx + WINDOW, width);
      const n = (xEnd - wx) * (yEnd - wy);
      if (n === 0) continue;

      let sa = 0;
      let sb = 0;
      let saa = 0;
      let sbb = 0;
      let sab = 0;

      for (let y = wy; y < yEnd; y++) {
        let o = (y * width + wx) * 4;
        for (let x = wx; x < xEnd; x++, o += 4) {
          const la = luma(da, o);
          const lb = luma(db, o);
          sa += la;
          sb += lb;
          saa += la * la;
          sbb += lb * lb;
          sab += la * lb;
        }
      }

      const ma = sa / n;
      const mb = sb / n;
      const va = saa / n - ma * ma;
      const vb = sbb / n - mb * mb;
      const cov = sab / n - ma * mb;

      const num = (2 * ma * mb + C1) * (2 * cov + C2);
      const den = (ma * ma + mb * mb + C1) * (va + vb + C2);
      total += den === 0 ? 1 : num / den;
      windows++;
    }
  }

  return windows === 0 ? 1 : total / windows;
}

export function compare(a: PlainImage, b: PlainImage): Metrics {
  const m = mse(a, b);
  return { mse: m, psnr: psnrFromMse(m), ssim: ssim(a, b) };
}

/**
 * `|A - B|` per channel with a gain multiplier, rendered as an opaque
 * greyscale-neutral RGBA buffer. Colour is preserved so chroma-only artefacts
 * stay visible.
 */
export function diffMap(a: PlainImage, b: PlainImage, gain = 1): Uint8ClampedArray {
  assertSameShape(a, b);
  const n = a.width * a.height;
  const out = new Uint8ClampedArray(n * 4);
  const da = a.data;
  const db = b.data;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[o] = Math.abs(da[o]! - db[o]!) * gain;
    out[o + 1] = Math.abs(da[o + 1]! - db[o + 1]!) * gain;
    out[o + 2] = Math.abs(da[o + 2]! - db[o + 2]!) * gain;
    out[o + 3] = 255;
  }
  return out;
}

/** Bits per pixel of an encoded blob. */
export function bitsPerPixel(bytes: number, width: number, height: number): number {
  const px = width * height;
  return px > 0 ? (bytes * 8) / px : 0;
}
