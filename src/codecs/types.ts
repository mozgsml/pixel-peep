/**
 * Everything the rest of the application is allowed to know about a format.
 *
 * Adding a format must stay a four-step job:
 *   1. npm i <codec package>
 *   2. create src/codecs/<id>.ts implementing CodecAdapter
 *   3. add one line to registry.ts
 *   4. add the round-trip test to the shared table
 *
 * Controls, the format dropdown, lazy wasm loading, caching, metrics and worker
 * plumbing all derive from the declarations below. There is no `switch` on
 * format id anywhere outside this directory.
 */

import { t } from '../i18n/index.ts';

export type ParamValue = number | boolean | string;

interface ParamBase {
  readonly key: string;
  readonly label: string;
  /** Optional short note rendered as a tooltip. */
  readonly hint?: string;
  /**
   * Hide/disable this control depending on the other parameters — e.g. quality
   * is meaningless once `lossless` is on. Lives in the codec file so the UI
   * stays generic.
   */
  readonly enabledWhen?: (params: Readonly<Record<string, ParamValue>>) => boolean;
}

export type ParamSchema = ReadonlyArray<
  | (ParamBase & {
      kind: 'range';
      min: number;
      max: number;
      step: number;
      default: number;
      /** Suffix rendered after the value, e.g. `%`. */
      unit?: string;
    })
  | (ParamBase & { kind: 'toggle'; default: boolean })
  | (ParamBase & {
      kind: 'select';
      options: ReadonlyArray<{ value: string; label: string }>;
      default: string;
    })
>;

export interface CodecDescriptor {
  readonly id: string;
  readonly label: string;
  readonly mime: string;
  readonly extension: string;
  readonly lossless: boolean | 'optional';
  readonly params: ParamSchema;
  /** Hidden from the format list unless development mode is on. */
  readonly devOnly?: boolean;
  /** Short line shown under the format name. */
  readonly note?: string;
}

export interface CodecAdapter extends CodecDescriptor {
  encode(
    image: ImageData,
    params: Readonly<Record<string, ParamValue>>,
    signal: AbortSignal,
  ): Promise<ArrayBuffer>;
  decode(bytes: ArrayBuffer, signal: AbortSignal): Promise<ImageData>;
  /** True when the current parameters produce a mathematically lossless file. */
  isLossless?(params: Readonly<Record<string, ParamValue>>): boolean;
}

export class AbortError extends Error {
  constructor(message = 'Aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new AbortError();
}

/**
 * A codec's wasm bundle could not be downloaded.
 *
 * Worth its own type because it is the one codec failure that is nobody's
 * fault and clears up by itself: a dropped request on a lazily loaded chunk.
 * It also cannot be retried in place — a rejected dynamic import is recorded
 * in the realm's module map, so every later `import()` of the same specifier
 * rejects from cache without touching the network. The only cure is a fresh
 * realm, which is why the pool throws the worker away when it sees this.
 */
export class CodecLoadError extends Error {
  constructor(
    readonly codec: string,
    options?: { cause?: unknown },
  ) {
    super(t('error.codecDownload', { codec }), options);
    this.name = 'CodecLoadError';
  }
}

/**
 * Wraps the lazy `import()` of a codec so a network failure is distinguishable
 * from the codec genuinely rejecting the image.
 */
export async function loadCodec<T>(label: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (cause) {
    throw new CodecLoadError(label, { cause });
  }
}

/** Default parameter record derived straight from a schema. */
export function defaultParams(schema: ParamSchema): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const item of schema) out[item.key] = item.default;
  return out;
}

/** Coerce a stored record to the schema, filling gaps with defaults. */
export function normaliseParams(
  schema: ParamSchema,
  params: Readonly<Record<string, unknown>>,
): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const item of schema) {
    const raw = params[item.key];
    switch (item.kind) {
      case 'range': {
        const n = typeof raw === 'number' ? raw : Number(raw);
        out[item.key] = Number.isFinite(n) ? Math.min(item.max, Math.max(item.min, n)) : item.default;
        break;
      }
      case 'toggle':
        out[item.key] = typeof raw === 'boolean' ? raw : item.default;
        break;
      case 'select': {
        const s = String(raw);
        out[item.key] = item.options.some((o) => o.value === s) ? s : item.default;
        break;
      }
    }
  }
  return out;
}

export function num(params: Readonly<Record<string, ParamValue>>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function bool(params: Readonly<Record<string, ParamValue>>, key: string, fallback: boolean): boolean {
  const v = params[key];
  return typeof v === 'boolean' ? v : fallback;
}

export function str(params: Readonly<Record<string, ParamValue>>, key: string, fallback: string): string {
  const v = params[key];
  return typeof v === 'string' ? v : fallback;
}
