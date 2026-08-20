import type { ParamValue } from '../codecs/types.ts';

/** ImageData reduced to something structured-cloneable and transferable. */
export interface RawImage {
  readonly data: ArrayBuffer;
  readonly width: number;
  readonly height: number;
}

export function toRaw(image: ImageData): RawImage {
  const copy = image.data.slice();
  return { data: copy.buffer as ArrayBuffer, width: image.width, height: image.height };
}

export function fromRaw(raw: RawImage): ImageData {
  return new ImageData(new Uint8ClampedArray(raw.data), raw.width, raw.height);
}

export interface EncodeRequest {
  readonly kind: 'encode';
  readonly codecId: string;
  readonly params: Record<string, ParamValue>;
  readonly image: RawImage;
  /** Decode the result back to pixels in the same task, saving a round trip. */
  readonly decodeBack: boolean;
}

export interface DecodeRequest {
  readonly kind: 'decode';
  readonly codecId: string;
  readonly bytes: ArrayBuffer;
}

export interface MetricsRequest {
  readonly kind: 'metrics';
  readonly a: RawImage;
  readonly b: RawImage;
}

export interface DiffRequest {
  readonly kind: 'diff';
  readonly a: RawImage;
  readonly b: RawImage;
  readonly gain: number;
}

export type WorkerRequest = EncodeRequest | DecodeRequest | MetricsRequest | DiffRequest;

export interface EncodeResponse {
  readonly bytes: ArrayBuffer;
  readonly decoded: RawImage | null;
  readonly encodeMs: number;
  readonly decodeMs: number;
}

export interface DecodeResponse {
  readonly image: RawImage;
  readonly decodeMs: number;
}

export interface MetricsResponse {
  readonly psnr: number;
  readonly ssim: number;
  readonly mse: number;
}

export interface DiffResponse {
  readonly image: RawImage;
}

export type WorkerEnvelope =
  | { readonly type: 'ready' }
  | { readonly type: 'result'; readonly id: number; readonly payload: unknown; readonly transfer?: number }
  | { readonly type: 'error'; readonly id: number; readonly message: string; readonly name: string };

export type HostEnvelope =
  | { readonly type: 'run'; readonly id: number; readonly request: WorkerRequest }
  | { readonly type: 'cancel'; readonly id: number };
