import { describe, expect, it } from 'vitest';
import { type Orientation, orientationTransform, readOrientation, swapsAxes } from '../src/core/exif.ts';

/** Minimal JPEG carrying nothing but an APP1 EXIF block with an orientation. */
function jpegWithOrientation(orientation: number, littleEndian = true): ArrayBuffer {
  const tiff = new Uint8Array(26);
  const view = new DataView(tiff.buffer);
  if (littleEndian) {
    view.setUint16(0, 0x4949);
    view.setUint16(2, 42, true);
    view.setUint32(4, 8, true);
    view.setUint16(8, 1, true); // one entry
    view.setUint16(10, 0x0112, true); // orientation tag
    view.setUint16(12, 3, true); // SHORT
    view.setUint32(14, 1, true);
    view.setUint16(18, orientation, true);
  } else {
    view.setUint16(0, 0x4d4d);
    view.setUint16(2, 42, false);
    view.setUint32(4, 8, false);
    view.setUint16(8, 1, false);
    view.setUint16(10, 0x0112, false);
    view.setUint16(12, 3, false);
    view.setUint32(14, 1, false);
    view.setUint16(18, orientation, false);
  }

  const exifHeader = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
  const payload = new Uint8Array(exifHeader.length + tiff.length);
  payload.set(exifHeader, 0);
  payload.set(tiff, exifHeader.length);

  const out = new Uint8Array(2 + 4 + payload.length + 2);
  out[0] = 0xff;
  out[1] = 0xd8; // SOI
  out[2] = 0xff;
  out[3] = 0xe1; // APP1
  new DataView(out.buffer).setUint16(4, payload.length + 2);
  out.set(payload, 6);
  out[out.length - 2] = 0xff;
  out[out.length - 1] = 0xd9; // EOI
  return out.buffer;
}

/** ISOBMFF-shaped buffer with a bare `Exif\0\0` block, as HEIC files carry. */
function heicWithOrientation(orientation: number): ArrayBuffer {
  const jpeg = new Uint8Array(jpegWithOrientation(orientation));
  const exif = jpeg.slice(6, jpeg.length - 2);
  const out = new Uint8Array(64 + exif.length);
  out.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], 0);
  out.set(exif, 40);
  return out.buffer;
}

describe('readOrientation', () => {
  it('reads every tag value from a JPEG, both byte orders', () => {
    for (let orientation = 1; orientation <= 8; orientation++) {
      expect(readOrientation(jpegWithOrientation(orientation, true))).toBe(orientation);
      expect(readOrientation(jpegWithOrientation(orientation, false))).toBe(orientation);
    }
  });

  it('reads the tag out of an ISOBMFF container', () => {
    expect(readOrientation(heicWithOrientation(6))).toBe(6);
  });

  it('falls back to 1 for files without the tag or with garbage', () => {
    expect(readOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer)).toBe(1);
    expect(readOrientation(new Uint8Array(0).buffer)).toBe(1);
    expect(readOrientation(new Uint8Array(64).fill(0xab).buffer)).toBe(1);
  });

  it('ignores out-of-range tag values', () => {
    expect(readOrientation(jpegWithOrientation(42))).toBe(1);
  });
});

describe('swapsAxes', () => {
  it('is true exactly for the four rotated-by-90 orientations', () => {
    const swapping = ([1, 2, 3, 4, 5, 6, 7, 8] as Orientation[]).filter(swapsAxes);
    expect(swapping).toEqual([5, 6, 7, 8]);
  });
});

describe('orientationTransform', () => {
  /**
   * The transform is given the *oriented* target size and maps the *stored*
   * pixels onto it, which is exactly how `decode-file.ts` uses it.
   */
  const corners = (o: Orientation, storedW: number, storedH: number) => {
    const w = swapsAxes(o) ? storedH : storedW;
    const h = swapsAxes(o) ? storedW : storedH;
    const [a, b, c, d, e, f] = orientationTransform(o, w, h);
    return [
      [e, f],
      [a * storedW + e, b * storedW + f],
      [a * storedW + c * storedH + e, b * storedW + d * storedH + f],
      [c * storedH + e, d * storedH + f],
    ];
  };

  it('is the identity for orientation 1', () => {
    expect(orientationTransform(1, 100, 50)).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('maps the stored image exactly onto the oriented canvas', () => {
    for (const o of [1, 2, 3, 4, 5, 6, 7, 8] as Orientation[]) {
      const w = swapsAxes(o) ? 50 : 100;
      const h = swapsAxes(o) ? 100 : 50;
      const points = corners(o, 100, 50);
      expect(points).toHaveLength(4);
      const xs = points.map((p) => p[0]!);
      const ys = points.map((p) => p[1]!);
      expect(Math.min(...xs)).toBeCloseTo(0, 9);
      expect(Math.max(...xs)).toBeCloseTo(w, 9);
      expect(Math.min(...ys)).toBeCloseTo(0, 9);
      expect(Math.max(...ys)).toBeCloseTo(h, 9);
    }
  });

  it('rotates the stored top-left corner where the tag says', () => {
    // Orientation 6 is "rotate 90 degrees clockwise": the stored top-left
    // corner ends up at the top-right of the displayed frame.
    const [x, y] = corners(6, 100, 50)[0]!;
    expect([x, y]).toEqual([50, 0]);
    // Orientation 3 is a 180 degree turn.
    expect(corners(3, 100, 50)[0]).toEqual([100, 50]);
  });
});
