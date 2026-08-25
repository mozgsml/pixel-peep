import { describe, expect, it } from 'vitest';
import {
  LARGE_IMAGE_PIXELS,
  PROXY_MAX_PIXELS,
  detectFileType,
  nextSourceId,
  proxyScale,
} from '../src/core/image-source.ts';

function buffer(bytes: number[], length = bytes.length): ArrayBuffer {
  const out = new Uint8Array(Math.max(length, bytes.length));
  out.set(bytes);
  return out.buffer;
}

function ftyp(brand: string): ArrayBuffer {
  const out = new Uint8Array(32);
  out.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70], 0);
  for (let i = 0; i < 4; i++) out[8 + i] = brand.charCodeAt(i);
  return out.buffer;
}

describe('detectFileType', () => {
  it('recognises the formats the browser can decode itself', () => {
    expect(detectFileType(buffer([0xff, 0xd8, 0xff, 0xe0], 32))?.mime).toBe('image/jpeg');
    expect(detectFileType(buffer([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 32))?.mime).toBe('image/png');
    expect(detectFileType(buffer([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 32))?.mime).toBe('image/gif');
    expect(detectFileType(buffer([0x42, 0x4d], 32))?.mime).toBe('image/bmp');
    expect(detectFileType(ftyp('avif'))?.mime).toBe('image/avif');
  });

  it('recognises WebP inside its RIFF wrapper', () => {
    const out = new Uint8Array(32);
    out.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(detectFileType(out.buffer)?.mime).toBe('image/webp');
  });

  it('flags the formats that need a wasm decoder', () => {
    expect(detectFileType(ftyp('heic'))?.needsWasm).toBe('heif');
    expect(detectFileType(ftyp('mif1'))?.needsWasm).toBe('heif');
    expect(detectFileType(buffer([0xff, 0x0a], 32))?.needsWasm).toBe('jxl');
    expect(detectFileType(buffer([0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20], 32))?.needsWasm).toBe('jxl');
  });

  it('trusts magic bytes, not extensions, and reports the unknown as unknown', () => {
    expect(detectFileType(buffer([1, 2, 3, 4, 5, 6, 7, 8], 32))).toBeNull();
    expect(detectFileType(new Uint8Array(4).buffer)).toBeNull();
  });
});

describe('proxyScale', () => {
  it('leaves small images alone', () => {
    expect(proxyScale(1000, 1000)).toBe(1);
    expect(proxyScale(0, 0)).toBe(1);
  });

  it('lands exactly on the pixel budget for large images', () => {
    const scale = proxyScale(6000, 4000);
    const pixels = 6000 * scale * (4000 * scale);
    expect(pixels).toBeCloseTo(PROXY_MAX_PIXELS, 0);
    expect(scale).toBeLessThan(1);
  });

  it('preserves the aspect ratio', () => {
    const scale = proxyScale(8000, 2000);
    expect((8000 * scale) / (2000 * scale)).toBeCloseTo(4, 9);
  });
});

describe('nextSourceId', () => {
  it('never repeats', () => {
    const ids = new Set([nextSourceId(), nextSourceId(), nextSourceId()]);
    expect(ids.size).toBe(3);
  });
});

describe('the size threshold', () => {
  it('is one number, used in one place', () => {
    // It was two: this file and `app.ts`, both spelling out the same value,
    // with the warning shown on load speaking for both. Moving either one on
    // its own turned that message into a lie. Whatever needs the threshold
    // imports this.
    expect(LARGE_IMAGE_PIXELS).toBe(60_000_000);
  });

  it('leaves a frame at the threshold with a copy worth having', () => {
    // 60 Mpx as ImageData is 240 MB, and the result decoded back is 240 MB
    // more, which is what the guard exists to avoid. The copy has to be far
    // smaller than that.
    const side = Math.round(Math.sqrt(LARGE_IMAGE_PIXELS));
    const scale = proxyScale(side, side);
    expect(scale).toBeLessThan(1);
    expect(Math.round(side * scale) ** 2).toBeLessThanOrEqual(PROXY_MAX_PIXELS * 1.01);
  });
});
