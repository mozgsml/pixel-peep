import { t } from '../i18n/index.ts';
import { adapter as avif } from './avif.ts';
import { adapter as debugBlur } from './debug-blur.ts';
import { adapter as jpeg } from './jpeg.ts';
import { adapter as jxl } from './jxl.ts';
import { adapter as original } from './original.ts';
import { adapter as png } from './png.ts';
import { adapter as webp } from './webp.ts';
import type { CodecAdapter, CodecDescriptor } from './types.ts';

/**
 * The registry. One line per format — that is the whole contract.
 *
 * Every adapter keeps its wasm behind a dynamic `import()` inside `encode` /
 * `decode`, so importing this module costs nothing and the codecs are fetched
 * only when a panel actually selects one.
 */
export const codecs: readonly CodecAdapter[] = [original, jpeg, webp, avif, jxl, png, debugBlur];

const byId = new Map(codecs.map((c) => [c.id, c]));

export function getCodec(id: string): CodecAdapter {
  const codec = byId.get(id);
  if (!codec) throw new Error(t('error.unknownFormat', { id }));
  return codec;
}

export function findCodec(id: string): CodecAdapter | undefined {
  return byId.get(id);
}

/** Descriptors for the interface; dev-only formats appear in dev builds. */
export function listCodecs(includeDev: boolean): readonly CodecDescriptor[] {
  return codecs.filter((c) => includeDev || !c.devOnly);
}

export const DEFAULT_FORMAT = 'jpeg';
export const REFERENCE_FORMAT = 'original';
