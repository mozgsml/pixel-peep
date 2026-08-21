import { type CodecAdapter, num, throwIfAborted } from './types.ts';

/**
 * A fake codec whose only job is to prove the plumbing.
 *
 * It exists to verify the "add a format" checklist: this file plus one line in
 * the registry, and it must show up in the interface with its own generated
 * controls, its own worker task, cache entry and metrics — with no edit
 * anywhere else. It is hidden behind the development flag.
 *
 * The container is deliberately real: box blur, then quantisation, then
 * run-length encoding. The reported size is therefore an honest byte count that
 * genuinely responds to the controls, not a made-up number.
 */

const MAGIC = 0x44424c52; // "DBLR"

function boxBlur(src: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  if (radius <= 0) return new Uint8ClampedArray(src);
  const tmp = new Uint8ClampedArray(src.length);
  const out = new Uint8ClampedArray(src.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.min(width - 1, Math.max(0, x + k));
        const o = (y * width + xx) * 4;
        r += src[o]!;
        g += src[o + 1]!;
        b += src[o + 2]!;
        a += src[o + 3]!;
        n++;
      }
      const o = (y * width + x) * 4;
      tmp[o] = r / n;
      tmp[o + 1] = g / n;
      tmp[o + 2] = b / n;
      tmp[o + 3] = a / n;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.min(height - 1, Math.max(0, y + k));
        const o = (yy * width + x) * 4;
        r += tmp[o]!;
        g += tmp[o + 1]!;
        b += tmp[o + 2]!;
        a += tmp[o + 3]!;
        n++;
      }
      const o = (y * width + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  return out;
}

export const adapter: CodecAdapter = {
  id: 'debug-blur',
  label: 'Debug blur',
  mime: 'application/x-debug-blur',
  extension: 'dblr',
  lossless: false,
  devOnly: true,
  note: 'codec.debugBlur.note',
  params: [
    { kind: 'range', key: 'radius', label: 'param.radius', min: 0, max: 12, step: 1, default: 2 },
    {
      kind: 'range',
      key: 'levels',
      label: 'param.levels',
      min: 2,
      max: 256,
      step: 1,
      default: 64,
      hint: 'param.levels.hint',
    },
  ],

  async encode(image, params, signal) {
    throwIfAborted(signal);
    const radius = Math.round(num(params, 'radius', 2));
    const levels = Math.max(2, Math.round(num(params, 'levels', 64)));
    const step = 255 / (levels - 1);

    const blurred = boxBlur(image.data, image.width, image.height, radius);
    throwIfAborted(signal);

    const count = image.width * image.height;
    const quantised = new Uint8Array(count * 4);
    for (let i = 0; i < count * 4; i++) {
      quantised[i] = Math.round(Math.round(blurred[i]! / step) * step);
    }

    // Worst case is one run per pixel; the buffer is trimmed at the end.
    const body = new Uint8Array(count * 6);
    let w = 0;
    let i = 0;
    while (i < count) {
      const o = i * 4;
      let run = 1;
      while (
        run < 0xffff &&
        i + run < count &&
        quantised[(i + run) * 4] === quantised[o] &&
        quantised[(i + run) * 4 + 1] === quantised[o + 1] &&
        quantised[(i + run) * 4 + 2] === quantised[o + 2] &&
        quantised[(i + run) * 4 + 3] === quantised[o + 3]
      ) {
        run++;
      }
      body[w++] = run & 0xff;
      body[w++] = run >> 8;
      body[w++] = quantised[o]!;
      body[w++] = quantised[o + 1]!;
      body[w++] = quantised[o + 2]!;
      body[w++] = quantised[o + 3]!;
      i += run;
    }

    const out = new ArrayBuffer(16 + w);
    const view = new DataView(out);
    view.setUint32(0, MAGIC);
    view.setUint32(4, image.width);
    view.setUint32(8, image.height);
    view.setUint32(12, w);
    new Uint8Array(out, 16).set(body.subarray(0, w));
    return out;
  },

  async decode(bytes, signal) {
    throwIfAborted(signal);
    const view = new DataView(bytes);
    if (view.getUint32(0) !== MAGIC) throw new Error('debug-blur: wrong container');
    const width = view.getUint32(4);
    const height = view.getUint32(8);
    const length = view.getUint32(12);
    const body = new Uint8Array(bytes, 16, length);

    const data = new Uint8ClampedArray(width * height * 4);
    let p = 0;
    let px = 0;
    while (p + 5 < body.length) {
      const run = body[p]! | (body[p + 1]! << 8);
      const r = body[p + 2]!;
      const g = body[p + 3]!;
      const b = body[p + 4]!;
      const a = body[p + 5]!;
      p += 6;
      for (let k = 0; k < run && px < width * height; k++, px++) {
        const o = px * 4;
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        data[o + 3] = a;
      }
    }
    return new ImageData(data, width, height);
  },

  isLossless: () => false,
};
