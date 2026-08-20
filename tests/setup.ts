/**
 * Node has no `ImageData` and no way for emscripten glue to `fetch` a local
 * `.wasm`, so both are provided here. The codecs themselves are the real ones:
 * the round-trip tests genuinely encode and decode.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll } from 'vitest';

class NodeImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly colorSpace = 'srgb' as const;

  constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
    if (typeof dataOrWidth === 'number') {
      this.width = dataOrWidth;
      this.height = widthOrHeight;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = dataOrWidth;
      this.width = widthOrHeight;
      this.height = height ?? dataOrWidth.length / 4 / widthOrHeight;
    }
  }
}

if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as { ImageData?: unknown }).ImageData = NodeImageData;
}

function wasm(relative: string): Uint8Array<ArrayBuffer> {
  const buffer = readFileSync(resolve(process.cwd(), 'node_modules/@jsquash', relative));
  return new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}

async function compile(relative: string): Promise<WebAssembly.Module> {
  return WebAssembly.compile(wasm(relative));
}

/**
 * Pre-initialise every codec with a locally compiled module. Adapters call the
 * same @jsquash entry points, find them already initialised and skip the fetch
 * that node cannot serve.
 */
export async function initCodecs(): Promise<void> {
  const { simd } = await import('wasm-feature-detect');
  const hasSimd = await simd();

  const [jpegEnc, jpegDec] = await Promise.all([
    import('@jsquash/jpeg/encode'),
    import('@jsquash/jpeg/decode'),
  ]);
  await jpegEnc.init(await compile('jpeg/codec/enc/mozjpeg_enc.wasm'));
  await jpegDec.init(await compile('jpeg/codec/dec/mozjpeg_dec.wasm'));

  const [webpEnc, webpDec] = await Promise.all([
    import('@jsquash/webp/encode'),
    import('@jsquash/webp/decode'),
  ]);
  await webpEnc.init(await compile(hasSimd ? 'webp/codec/enc/webp_enc_simd.wasm' : 'webp/codec/enc/webp_enc.wasm'));
  await webpDec.init(await compile('webp/codec/dec/webp_dec.wasm'));

  const [avifEnc, avifDec] = await Promise.all([
    import('@jsquash/avif/encode'),
    import('@jsquash/avif/decode'),
  ]);
  await avifEnc.init(await compile('avif/codec/enc/avif_enc.wasm'));
  await avifDec.init(await compile('avif/codec/dec/avif_dec.wasm'));

  const [jxlEnc, jxlDec] = await Promise.all([
    import('@jsquash/jxl/encode'),
    import('@jsquash/jxl/decode'),
  ]);
  await jxlEnc.init(await compile('jxl/codec/enc/jxl_enc.wasm'));
  await jxlDec.init(await compile('jxl/codec/dec/jxl_dec.wasm'));

  const pngDec = await import('@jsquash/png/decode');
  await pngDec.init(wasm('png/codec/pkg/squoosh_png_bg.wasm'));

  const oxipng = await import('@jsquash/oxipng/optimise');
  await oxipng.init(wasm('oxipng/codec/pkg/squoosh_oxipng_bg.wasm'));
}

let ready: Promise<void> | null = null;

export function codecsReady(): Promise<void> {
  ready ??= initCodecs();
  return ready;
}

beforeAll(() => {
  // Cheap for the pure tests; the codec suite awaits `codecsReady()` itself.
});
