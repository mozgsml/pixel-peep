/// <reference lib="webworker" />
import { getCodec } from '../codecs/registry.ts';
import { AbortError, CodecLoadError } from '../codecs/types.ts';
import { compare, diffMap } from '../core/metrics.ts';
import {
  type DiffResponse,
  type EncodeResponse,
  type HostEnvelope,
  type MetricsResponse,
  type WorkerRequest,
  fromRaw,
  toRaw,
} from './protocol.ts';

const controllers = new Map<number, AbortController>();

async function handle(request: WorkerRequest, signal: AbortSignal): Promise<{ payload: unknown; transfer: Transferable[] }> {
  switch (request.kind) {
    case 'encode': {
      const codec = getCodec(request.codecId);
      const image = fromRaw(request.image);
      const t0 = performance.now();
      const bytes = await codec.encode(image, request.params, signal);
      const t1 = performance.now();

      let decoded = null;
      let decodeMs = 0;
      if (request.decodeBack) {
        const decodedImage = await codec.decode(bytes.slice(0), signal);
        decodeMs = performance.now() - t1;
        decoded = toRaw(decodedImage);
      }

      const payload: EncodeResponse = { bytes, decoded, encodeMs: t1 - t0, decodeMs };
      const transfer: Transferable[] = [bytes];
      if (decoded) transfer.push(decoded.data);
      return { payload, transfer };
    }

    case 'decode': {
      const codec = getCodec(request.codecId);
      const t0 = performance.now();
      const image = await codec.decode(request.bytes, signal);
      const raw = toRaw(image);
      return { payload: { image: raw, decodeMs: performance.now() - t0 }, transfer: [raw.data] };
    }

    case 'metrics': {
      const payload: MetricsResponse = compare(fromRaw(request.a), fromRaw(request.b));
      return { payload, transfer: [] };
    }

    case 'diff': {
      const a = fromRaw(request.a);
      const b = fromRaw(request.b);
      const data = diffMap(a, b, request.gain);
      const raw = { data: data.buffer as ArrayBuffer, width: a.width, height: a.height };
      const payload: DiffResponse = { image: raw };
      return { payload, transfer: [raw.data] };
    }
  }
}

self.addEventListener('message', (event: MessageEvent<HostEnvelope>) => {
  const message = event.data;

  if (message.type === 'cancel') {
    controllers.get(message.id)?.abort();
    controllers.delete(message.id);
    return;
  }

  const controller = new AbortController();
  controllers.set(message.id, controller);

  handle(message.request, controller.signal)
    .then(({ payload, transfer }) => {
      if (controller.signal.aborted) {
        self.postMessage({ type: 'error', id: message.id, message: 'Aborted', name: 'AbortError' });
        return;
      }
      self.postMessage({ type: 'result', id: message.id, payload }, transfer);
    })
    .catch((error: unknown) => {
      // The name travels to the host so the pool can tell a codec that refused
      // the image from one whose bundle never arrived — only the latter makes
      // this worker unusable for that codec from now on.
      const name =
        error instanceof AbortError || controller.signal.aborted
          ? 'AbortError'
          : error instanceof CodecLoadError
            ? 'CodecLoadError'
            : 'Error';
      self.postMessage({
        type: 'error',
        id: message.id,
        name,
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof CodecLoadError ? { codec: error.codec } : {}),
      });
    })
    .finally(() => {
      controllers.delete(message.id);
    });
});

self.postMessage({ type: 'ready' });
