/**
 * The decoded original. There is exactly one of these per loaded file, and
 * panels reference it by id — a 24 Mpx photo is 96 MB as `ImageData`, so a
 * second copy is not an option.
 */

export interface ImageSource {
  readonly id: string;
  readonly name: string;
  /** Original bytes, kept so "size of the original" is the size on disk. */
  readonly bytes: ArrayBuffer;
  /** Full size, sRGB 8-bit, EXIF orientation already applied. */
  readonly full: ImageData;
  /** Downscaled copy, at most PROXY_MAX_PIXELS, for responsive previews. */
  readonly proxy: ImageData;
  readonly width: number;
  readonly height: number;
  readonly mime: string;
  /** True when `proxy === full` because the image was already small enough. */
  readonly proxyIsFull: boolean;
}

/** Roughly 2560x1600 — enough for a full-screen preview on a retina laptop. */
export const PROXY_MAX_PIXELS = 4_000_000;

/**
 * Above this, encoding at full size is worth warning about — it can take
 * minutes — but it still happens. Only the wait is unusual, not the risk.
 */
export const LARGE_IMAGE_PIXELS = 40_000_000;

/**
 * Above this the frame is encoded at proxy resolution instead of whole,
 * because encoding it whole risks an out-of-memory kill: 60 Mpx is 240 MB as
 * `ImageData`, and the result decoded back is another 240 MB on top of what
 * the encoder holds internally.
 *
 * Two constants, two different meanings — the one above only predicts a wait.
 * What must never happen again is a *message* claiming one while the code does
 * the other: `notice.largeImage` used to say "proxy mode is on" from its own
 * threshold, so the two could not be moved apart without it becoming a lie.
 */
export const PROXY_ONLY_PIXELS = 60_000_000;

let counter = 0;
export function nextSourceId(): string {
  counter += 1;
  return `src${counter}`;
}

export interface FileTypeInfo {
  readonly mime: string;
  readonly label: string;
  /** Decoders the browser cannot be trusted with. */
  readonly needsWasm: 'heif' | 'jxl' | null;
}

const SIGNATURES: ReadonlyArray<{
  test: (b: Uint8Array) => boolean;
  info: FileTypeInfo;
}> = [
  {
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    info: { mime: 'image/jpeg', label: 'JPEG', needsWasm: null },
  },
  {
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
    info: { mime: 'image/png', label: 'PNG', needsWasm: null },
  },
  {
    test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46,
    info: { mime: 'image/gif', label: 'GIF', needsWasm: null },
  },
  {
    test: (b) => b[0] === 0x42 && b[1] === 0x4d,
    info: { mime: 'image/bmp', label: 'BMP', needsWasm: null },
  },
  {
    test: (b) => b[0] === 0xff && b[1] === 0x0a,
    info: { mime: 'image/jxl', label: 'JPEG XL', needsWasm: 'jxl' },
  },
  {
    test: (b) =>
      b[0] === 0x00 &&
      b[1] === 0x00 &&
      b[2] === 0x00 &&
      b[4] === 0x4a &&
      b[5] === 0x58 &&
      b[6] === 0x4c &&
      b[7] === 0x20,
    info: { mime: 'image/jxl', label: 'JPEG XL', needsWasm: 'jxl' },
  },
];

function brand(bytes: Uint8Array): string {
  if (bytes.length < 12) return '';
  if (!(bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70)) return '';
  return String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
}

/** Sniffs the container from magic bytes; file extensions lie too often. */
export function detectFileType(buffer: ArrayBuffer): FileTypeInfo | null {
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 64));
  for (const sig of SIGNATURES) {
    if (sig.test(bytes)) return sig.info;
  }

  const ftyp = brand(bytes);
  if (ftyp) {
    if (ftyp === 'avif' || ftyp === 'avis') {
      return { mime: 'image/avif', label: 'AVIF', needsWasm: null };
    }
    if (ftyp.startsWith('hei') || ftyp.startsWith('mif') || ftyp.startsWith('msf')) {
      return { mime: 'image/heic', label: 'HEIC', needsWasm: 'heif' };
    }
  }

  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mime: 'image/webp', label: 'WebP', needsWasm: null };
  }

  return null;
}

export const SUPPORTED_INPUT_LABELS = 'JPEG, PNG, WebP, AVIF, GIF, BMP, HEIC/HEIF, JPEG XL';

/** Longest edge that keeps the image under `maxPixels`, preserving aspect. */
export function proxyScale(width: number, height: number, maxPixels = PROXY_MAX_PIXELS): number {
  const pixels = width * height;
  if (pixels <= maxPixels || pixels === 0) return 1;
  return Math.sqrt(maxPixels / pixels);
}
