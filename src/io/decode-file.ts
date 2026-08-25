import { t } from '../i18n/index.ts';
import { orientationTransform, readOrientation, swapsAxes } from '../core/exif.ts';
import {
  type ImageSource,
  PROXY_MAX_PIXELS,
  detectFileType,
  nextSourceId,
  proxyScale,
} from '../core/image-source.ts';
import { loadCodec } from '../codecs/types.ts';
import { context2d, createCanvas, downscaleImageData } from '../render/downscale.ts';

export class UnsupportedFileError extends Error {
  constructor(public readonly fileName: string) {
    super(t('error.unrecognisedFile', { name: fileName }));
    this.name = 'UnsupportedFileError';
  }
}

/** Raw pixels straight out of a decoder, before orientation is applied. */
async function decodeNative(buffer: ArrayBuffer, mime: string): Promise<ImageData> {
  const blob = new Blob([buffer], { type: mime });
  // `imageOrientation: 'none'` is explicit on purpose: browsers disagree on the
  // default, and orientation is applied by us so every format behaves alike.
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'none' });
  try {
    const canvas = createCanvas(bitmap.width, bitmap.height);
    const ctx = context2d(canvas);
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

async function decodeHeif(buffer: ArrayBuffer): Promise<ImageData> {
  const { default: factory } = await loadCodec('HEIC', () => import('libheif-js/libheif-wasm/libheif-bundle.mjs'));
  const libheif = factory();
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(buffer);
  const image = images.find((i) => i.is_primary()) ?? images[0];
  if (!image) throw new Error(t('error.heicNoImages'));

  const width = image.get_width();
  const height = image.get_height();
  const target = { data: new Uint8ClampedArray(width * height * 4), width, height };

  await new Promise<void>((resolve, reject) => {
    image.display(target, (result) => {
      if (!result) reject(new Error(t('error.heicDecode')));
      else resolve();
    });
  });
  image.free?.();

  return new ImageData(target.data, width, height);
}

async function decodeJxl(buffer: ArrayBuffer): Promise<ImageData> {
  const { default: decode } = await loadCodec('JPEG XL', () => import('@jsquash/jxl/decode'));
  return decode(buffer);
}

/** Bakes the EXIF rotation into the pixels so nothing downstream must care. */
function applyOrientation(image: ImageData, orientation: number): ImageData {
  if (orientation === 1) return image;

  const swap = swapsAxes(orientation as 1);
  const width = swap ? image.height : image.width;
  const height = swap ? image.width : image.height;

  const source = createCanvas(image.width, image.height);
  context2d(source).putImageData(image, 0, 0);

  const out = createCanvas(width, height);
  const ctx = context2d(out);
  const t = orientationTransform(orientation as 1, width, height);
  ctx.setTransform(t[0], t[1], t[2], t[3], t[4], t[5]);
  ctx.drawImage(source as CanvasImageSource, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const result = ctx.getImageData(0, 0, width, height);
  source.width = 0;
  source.height = 0;
  out.width = 0;
  out.height = 0;
  return result;
}

/** A message key plus its values, resolved by the interface at render time. */
export interface LoadWarning {
  readonly key: string;
  readonly vars?: Readonly<Record<string, string | number>>;
}

export interface LoadedFile {
  readonly source: ImageSource;
  /** Warnings worth surfacing without blocking the user. */
  readonly warnings: LoadWarning[];
}

export async function loadImageFile(file: File | Blob, name: string): Promise<LoadedFile> {
  const buffer = await file.arrayBuffer();
  const type = detectFileType(buffer);
  if (!type) throw new UnsupportedFileError(name);

  const warnings: LoadWarning[] = [];

  let raw: ImageData;
  if (type.needsWasm === 'heif') {
    raw = await decodeHeif(buffer);
  } else if (type.needsWasm === 'jxl') {
    raw = await decodeJxl(buffer);
  } else {
    try {
      raw = await decodeNative(buffer, type.mime);
    } catch (error) {
      throw new Error(
        t('error.decodeFailed', {
          label: type.label,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  const full = applyOrientation(raw, readOrientation(buffer));
  const scale = proxyScale(full.width, full.height, PROXY_MAX_PIXELS);
  const proxy =
    scale >= 1
      ? full
      : downscaleImageData(full, Math.round(full.width * scale), Math.round(full.height * scale));

  return {
    source: {
      id: nextSourceId(),
      name,
      bytes: buffer,
      full,
      proxy,
      width: full.width,
      height: full.height,
      mime: type.mime,
      proxyIsFull: proxy === full,
    },
    warnings,
  };
}
