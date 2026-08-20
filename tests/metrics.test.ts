import { describe, expect, it } from 'vitest';
import { bitsPerPixel, compare, diffMap, mse, psnr, psnrFromMse, ssim } from '../src/core/metrics.ts';

function image(width: number, height: number, fill: (x: number, y: number) => [number, number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const [r, g, b, a] = fill(x, y);
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = a;
    }
  }
  return { data, width, height };
}

describe('psnr', () => {
  it('is infinite for identical buffers', () => {
    const a = image(16, 16, (x, y) => [x * 7, y * 5, (x + y) * 3, 255]);
    const b = image(16, 16, (x, y) => [x * 7, y * 5, (x + y) * 3, 255]);
    expect(psnr(a, b)).toBe(Infinity);
    expect(mse(a, b)).toBe(0);
  });

  it('matches the closed form for a known constant offset', () => {
    // A uniform error of d on all three channels gives MSE = d^2 exactly.
    for (const d of [1, 2, 5, 10]) {
      const a = image(8, 8, () => [100, 100, 100, 255]);
      const b = image(8, 8, () => [100 + d, 100 + d, 100 + d, 255]);
      expect(mse(a, b)).toBeCloseTo(d * d, 9);
      expect(psnr(a, b)).toBeCloseTo(10 * Math.log10((255 * 255) / (d * d)), 9);
    }
  });

  it('ignores the alpha channel', () => {
    const a = image(8, 8, () => [10, 20, 30, 255]);
    const b = image(8, 8, () => [10, 20, 30, 0]);
    expect(psnr(a, b)).toBe(Infinity);
  });

  it('gives 0 dB for a full-range error', () => {
    const a = image(4, 4, () => [0, 0, 0, 255]);
    const b = image(4, 4, () => [255, 255, 255, 255]);
    expect(psnr(a, b)).toBeCloseTo(0, 9);
  });

  it('psnrFromMse handles the zero case', () => {
    expect(psnrFromMse(0)).toBe(Infinity);
    expect(psnrFromMse(-1)).toBe(Infinity);
  });

  it('rejects mismatched sizes rather than comparing nonsense', () => {
    expect(() => psnr(image(4, 4, () => [0, 0, 0, 255]), image(4, 5, () => [0, 0, 0, 255]))).toThrow(/size mismatch/);
  });
});

describe('ssim', () => {
  it('is 1 for identical images', () => {
    const a = image(32, 32, (x, y) => [(x * 8) % 256, (y * 8) % 256, 128, 255]);
    expect(ssim(a, a)).toBeCloseTo(1, 12);
  });

  it('drops well below 1 for structurally different images', () => {
    const a = image(32, 32, (x) => [x % 2 === 0 ? 255 : 0, x % 2 === 0 ? 255 : 0, x % 2 === 0 ? 255 : 0, 255]);
    const b = image(32, 32, () => [128, 128, 128, 255]);
    expect(ssim(a, b)).toBeLessThan(0.2);
  });

  it('stays high for a small uniform brightness shift — the caveat in the tooltip', () => {
    const a = image(32, 32, (x, y) => [(x * 3 + y) % 256, (x * 3 + y) % 256, (x * 3 + y) % 256, 255]);
    const b = image(32, 32, (x, y) => [((x * 3 + y) % 256) + 4, ((x * 3 + y) % 256) + 4, ((x * 3 + y) % 256) + 4, 255]);
    expect(ssim(a, b)).toBeGreaterThan(0.9);
    expect(psnr(a, b)).toBeLessThan(40);
  });

  it('handles partial windows at the edges', () => {
    const a = image(13, 7, (x, y) => [x * 9, y * 9, 60, 255]);
    expect(ssim(a, a)).toBeCloseTo(1, 12);
  });
});

describe('diffMap', () => {
  it('is zero where the images agree and amplified by gain elsewhere', () => {
    const a = image(4, 4, () => [10, 10, 10, 255]);
    const b = image(4, 4, () => [14, 10, 10, 255]);
    const diff = diffMap(a, b, 10);
    expect(diff[0]).toBe(40);
    expect(diff[1]).toBe(0);
    expect(diff[3]).toBe(255);
  });
});

describe('compare', () => {
  it('returns all three numbers at once', () => {
    const a = image(16, 16, (x) => [x * 15, 40, 80, 255]);
    const result = compare(a, a);
    expect(result.psnr).toBe(Infinity);
    expect(result.ssim).toBeCloseTo(1, 12);
    expect(result.mse).toBe(0);
  });
});

describe('bitsPerPixel', () => {
  it('converts bytes to bpp', () => {
    expect(bitsPerPixel(1000, 100, 10)).toBeCloseTo(8, 9);
    expect(bitsPerPixel(1000, 0, 0)).toBe(0);
  });
});
