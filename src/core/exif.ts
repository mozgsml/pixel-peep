/**
 * Just enough EXIF to get orientation right. Pure, no DOM.
 *
 * iPhone photos are the main reason this exists: half of them are stored
 * rotated with only a tag to say so, and a comparison tool that shows them
 * sideways is useless.
 */

/** EXIF orientation, 1..8. 1 means "already upright". */
export type Orientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const TAG_ORIENTATION = 0x0112;

function readTiffOrientation(view: DataView, tiffStart: number): Orientation | null {
  if (tiffStart + 8 > view.byteLength) return null;

  const byteOrder = view.getUint16(tiffStart);
  let little: boolean;
  if (byteOrder === 0x4949) little = true;
  else if (byteOrder === 0x4d4d) little = false;
  else return null;

  if (view.getUint16(tiffStart + 2, little) !== 42) return null;

  const ifdOffset = view.getUint32(tiffStart + 4, little);
  const ifd = tiffStart + ifdOffset;
  if (ifd + 2 > view.byteLength) return null;

  const entries = view.getUint16(ifd, little);
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    if (view.getUint16(entry, little) === TAG_ORIENTATION) {
      const value = view.getUint16(entry + 8, little);
      if (value >= 1 && value <= 8) return value as Orientation;
      return null;
    }
  }
  return null;
}

/** Index of the ASCII marker `Exif\0\0` within the first `limit` bytes. */
function findExifMarker(bytes: Uint8Array, limit: number): number {
  const end = Math.min(bytes.length - 6, limit);
  for (let i = 0; i < end; i++) {
    if (
      bytes[i] === 0x45 &&
      bytes[i + 1] === 0x78 &&
      bytes[i + 2] === 0x69 &&
      bytes[i + 3] === 0x66 &&
      bytes[i + 4] === 0x00 &&
      bytes[i + 5] === 0x00
    ) {
      return i;
    }
  }
  return -1;
}

function jpegOrientation(view: DataView, bytes: Uint8Array): Orientation | null {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
    const length = view.getUint16(offset + 2);
    if (marker === 0xe1 && findExifMarker(bytes.subarray(offset, offset + 12), 12) === 4) {
      return readTiffOrientation(view, offset + 10);
    }
    offset += 2 + length;
  }
  return null;
}

function pngOrientation(view: DataView, bytes: Uint8Array): Orientation | null {
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    if (type === 'eXIf') return readTiffOrientation(view, offset + 8);
    if (type === 'IDAT' || type === 'IEND') break;
    offset += 12 + length;
  }
  return null;
}

/**
 * Reads the orientation tag out of JPEG, PNG, WebP, HEIC/HEIF and AVIF.
 * Anything unparseable falls back to `1`, which is also the correct answer for
 * formats that never carry the tag.
 */
export function readOrientation(buffer: ArrayBuffer): Orientation {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 12) return 1;
  const view = new DataView(buffer);

  try {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      return jpegOrientation(view, bytes) ?? 1;
    }
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return pngOrientation(view, bytes) ?? 1;
    }
    // ISOBMFF (HEIC/AVIF) and RIFF (WebP) both embed a plain `Exif\0\0` block;
    // scanning the header region is more robust than walking every box variant.
    const marker = findExifMarker(bytes, 1 << 20);
    if (marker >= 0) return readTiffOrientation(view, marker + 6) ?? 1;
  } catch {
    return 1;
  }
  return 1;
}

/** Whether the tag swaps width and height. */
export function swapsAxes(orientation: Orientation): boolean {
  return orientation >= 5;
}

/**
 * 2D transform that maps oriented coordinates back onto the stored pixels,
 * expressed as canvas `setTransform` arguments for a `w x h` *oriented* target.
 */
export function orientationTransform(
  orientation: Orientation,
  width: number,
  height: number,
): [number, number, number, number, number, number] {
  switch (orientation) {
    case 2:
      return [-1, 0, 0, 1, width, 0];
    case 3:
      return [-1, 0, 0, -1, width, height];
    case 4:
      return [1, 0, 0, -1, 0, height];
    case 5:
      return [0, 1, 1, 0, 0, 0];
    case 6:
      return [0, 1, -1, 0, width, 0];
    case 7:
      return [0, -1, -1, 0, width, height];
    case 8:
      return [0, -1, 1, 0, 0, height];
    case 1:
    default:
      return [1, 0, 0, 1, 0, 0];
  }
}
