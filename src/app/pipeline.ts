import { t } from '../i18n/index.ts';
import { REFERENCE_FORMAT } from '../codecs/registry.ts';
import { AbortError, CodecLoadError, type ParamValue } from '../codecs/types.ts';
import { LruCache, cacheKey } from '../core/cache.ts';
import type { ImageSource } from '../core/image-source.ts';
import type { Metrics } from '../core/metrics.ts';
import { WorkerPool } from '../workers/pool.ts';
import { type DiffResponse, type EncodeResponse, type MetricsResponse, fromRaw, toRaw } from '../workers/protocol.ts';
import { type AppStore, type EncodeResult, type ResultQuality, panelSource, updatePanel } from './state.ts';

/** Debounce for slider dragging, as specified. */
const PREVIEW_DEBOUNCE_MS = 200;

/**
 * Cached decoded results, budgeted in pixels rather than in entries: a 24 Mpx
 * result and a proxy thumbnail cost wildly different amounts of memory.
 *
 * 24 Mpx of budget is about 96 MB of `ImageData` — roughly one full-size result
 * plus a handful of proxies. Deliberately modest: a bigger cache makes going
 * back to a previous format instant, but memory, not speed, is what kills the
 * tab on a phone. Going back re-encodes; running out of memory does not
 * recover.
 */
function cacheBudget(): number {
  const memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;
  return Math.max(8_000_000, Math.min(memory * 3_000_000, 24_000_000));
}

interface CacheEntry {
  readonly pixels: number;
  readonly result: EncodeResult;
}

interface PanelJob {
  controller: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
  /** Monotonic token so a late result from an old job is ignored. */
  token: number;
}

export class EncodePipeline {
  readonly #store: AppStore;
  readonly #pool: WorkerPool;
  readonly #cache = new LruCache<CacheEntry>(cacheBudget());
  readonly #jobs = new Map<string, PanelJob>();
  #token = 0;

  constructor(store: AppStore, pool = new WorkerPool()) {
    this.#store = store;
    this.#pool = pool;
  }

  get pool(): WorkerPool {
    return this.#pool;
  }

  /**
   * `preview` debounces and stops at proxy resolution; `final` goes all the way
   * to full size. Either way the previous job for that panel is aborted, so a
   * dragged slider never accumulates a queue.
   */
  schedule(index: number, mode: 'preview' | 'final' = 'final'): void {
    const panel = this.#store.state.panels[index];
    if (!panel) return;

    this.#cancel(panel.id);
    const token = ++this.#token;
    const controller = new AbortController();
    const next: PanelJob = { controller, timer: null, token };
    this.#jobs.set(panel.id, next);

    const start = () => {
      next.timer = null;
      void this.#run(index, mode, next).catch((error: unknown) => {
        if (error instanceof AbortError) return;
        this.#fail(index, next, error);
      });
    };

    // Marked busy here rather than inside `#run`: a dragged slider spends the
    // debounce window doing nothing visible otherwise, and the picture on
    // screen still belongs to the previous settings.
    if (panel.formatId !== REFERENCE_FORMAT && panel.sourceId) {
      this.#store.set((s) => ({ panels: updatePanel(s, index, { status: 'encoding', error: undefined, errorKind: undefined }) }));
    }

    if (mode === 'preview') next.timer = setTimeout(start, PREVIEW_DEBOUNCE_MS);
    else start();
  }

  scheduleAll(mode: 'preview' | 'final' = 'final'): void {
    this.#store.state.panels.forEach((_, index) => this.schedule(index, mode));
  }

  /** Drops cached results for a source that is no longer on screen. */
  releaseSource(sourceId: string): void {
    this.#cache.prune((key) => key.startsWith(`${sourceId}|`));
  }

  clearCache(): void {
    this.#cache.clear();
  }

  dispose(): void {
    for (const id of [...this.#jobs.keys()]) this.#cancel(id);
    this.#cache.clear();
    this.#pool.terminate();
  }

  #cancel(panelId: string): PanelJob | undefined {
    const job = this.#jobs.get(panelId);
    if (!job) return undefined;
    if (job.timer !== null) clearTimeout(job.timer);
    job.controller.abort();
    this.#jobs.delete(panelId);
    return job;
  }

  #isCurrent(index: number, job: PanelJob): boolean {
    const panel = this.#store.state.panels[index];
    return !!panel && this.#jobs.get(panel.id) === job && !job.controller.signal.aborted;
  }

  #fail(index: number, job: PanelJob, error: unknown): void {
    if (!this.#isCurrent(index, job)) return;
    const message = error instanceof Error ? error.message : String(error);
    const errorKind = error instanceof CodecLoadError ? 'load' : 'codec';
    this.#store.set((state) => ({
      panels: updatePanel(state, index, { status: 'error', error: message, errorKind }),
    }));
  }

  /**
   * One retry when the codec bundle did not arrive.
   *
   * The pool has retired the worker that saw the failure, so the second attempt
   * runs in a fresh realm and genuinely re-fetches; retrying in the same one
   * would be answered from the module map without a request. Anything else the
   * codec throws is a real answer about this image and is not retried.
   */
  async #encodeWithRetry(
    source: ImageSource,
    formatId: string,
    params: Readonly<Record<string, ParamValue>>,
    quality: ResultQuality,
    signal: AbortSignal,
  ): Promise<EncodeResult> {
    try {
      return await this.#encode(source, formatId, params, quality, signal);
    } catch (error) {
      if (!(error instanceof CodecLoadError) || signal.aborted) throw error;
      return this.#encode(source, formatId, params, quality, signal);
    }
  }

  async #run(index: number, mode: 'preview' | 'final', job: PanelJob): Promise<void> {
    const state = this.#store.state;
    const panel = state.panels[index];
    if (!panel) return;
    const source = panelSource(state, panel);
    if (!source) {
      this.#store.set((s) => ({ panels: updatePanel(s, index, { status: 'empty', result: null, metrics: null }) }));
      return;
    }

    if (panel.formatId === REFERENCE_FORMAT) {
      this.#publish(index, job, originalResult(source), null, null);
      return;
    }

    // Proxy first for instant feedback, then full size. A cached full result
    // makes the proxy pass pointless, so it is skipped.
    let targets: ResultQuality[];
    if (source.proxyIsFull) {
      // Small enough that the proxy *is* the full image: one pass, no preview.
      targets = ['full'];
    } else if (state.proxyOnly) {
      // Too large to encode at full size without risking an out-of-memory kill.
      targets = ['proxy'];
    } else if (mode === 'preview') {
      targets = ['proxy'];
    } else {
      targets = this.#cached(source, panel.formatId, panel.params, 'full') ? ['full'] : ['proxy', 'full'];
    }

    for (const [step, quality] of targets.entries()) {
      if (!this.#isCurrent(index, job)) throw new AbortError();

      const cached = this.#cached(source, panel.formatId, panel.params, quality);
      const result =
        cached ?? (await this.#encodeWithRetry(source, panel.formatId, panel.params, quality, job.controller.signal));
      if (!this.#isCurrent(index, job)) throw new AbortError();

      // Metrics are measured against the reference at the same resolution;
      // only the full-size pass is reported as authoritative.
      const reference = quality === 'full' ? source.full : source.proxy;
      const metrics =
        result.width === reference.width && result.height === reference.height
          ? await this.#metrics(reference, result.decoded, job.controller.signal)
          : null;
      if (!this.#isCurrent(index, job)) throw new AbortError();

      const diff =
        metrics && this.#store.state.viewMode === 'diff'
          ? await this.#diff(reference, result.decoded, job.controller.signal)
          : null;
      if (!this.#isCurrent(index, job)) throw new AbortError();

      // A proxy pass with a full-size pass still to come is a stopping point,
      // not an answer: publish the picture and the provisional number, but stay
      // marked as working. Reporting `ready` here turned the spinner off and
      // left a preview byte count sitting there looking final — on a large
      // photo for several seconds, and three times off.
      this.#publish(index, job, result, metrics, diff, step < targets.length - 1);
    }

    this.#jobs.delete(panel.id);
  }

  #publish(
    index: number,
    job: PanelJob,
    result: EncodeResult,
    metrics: Metrics | null,
    diff: ImageData | null,
    /** Another pass for this panel is still to come. */
    more = false,
  ): void {
    if (!this.#isCurrent(index, job)) return;
    this.#store.set((state) => ({
      panels: updatePanel(state, index, (panel) => ({
        result,
        metrics,
        diff,
        status: more ? 'encoding' : 'ready',
        error: undefined,
        errorKind: undefined,
        revision: panel.revision + 1,
      })),
    }));
  }

  /**
   * Fills in difference maps for panels that already have a result, without
   * re-encoding anything — switching the view must be instant.
   */
  async ensureDiffs(): Promise<void> {
    const state = this.#store.state;
    await Promise.all(
      state.panels.map(async (panel, index) => {
        if (panel.diff || !panel.result || panel.formatId === REFERENCE_FORMAT) return;
        const source = panelSource(state, panel);
        if (!source) return;
        const reference = panel.result.quality === 'full' ? source.full : source.proxy;
        if (reference.width !== panel.result.width || reference.height !== panel.result.height) return;

        const controller = new AbortController();
        try {
          const diff = await this.#diff(reference, panel.result.decoded, controller.signal);
          const current = this.#store.state.panels[index];
          if (current?.id === panel.id && current.revision === panel.revision) {
            this.#store.set((s) => ({ panels: updatePanel(s, index, { diff }) }));
          }
        } catch {
          // A missing difference map is not worth interrupting anything for.
        }
      }),
    );
  }

  async #diff(reference: ImageData, candidate: ImageData, signal: AbortSignal): Promise<ImageData> {
    const a = toRaw(reference);
    const b = toRaw(candidate);
    const response = await this.#pool.run<DiffResponse>(
      { kind: 'diff', a, b, gain: 1 },
      { signal, transfer: [a.data, b.data] },
    );
    return fromRaw(response.image);
  }

  #cached(
    source: ImageSource,
    formatId: string,
    params: Readonly<Record<string, ParamValue>>,
    quality: ResultQuality,
  ): EncodeResult | undefined {
    return this.#cache.get(cacheKey(source.id, formatId, params, quality))?.result;
  }

  async #encode(
    source: ImageSource,
    formatId: string,
    params: Readonly<Record<string, ParamValue>>,
    quality: ResultQuality,
    signal: AbortSignal,
  ): Promise<EncodeResult> {
    const image = quality === 'full' ? source.full : source.proxy;
    const raw = toRaw(image);
    const response = await this.#pool.run<EncodeResponse>(
      {
        kind: 'encode',
        codecId: formatId,
        params: { ...params },
        image: raw,
        decodeBack: true,
      },
      { signal, transfer: [raw.data] },
    );

    if (!response.decoded) throw new Error(t('error.noPixels'));
    const decoded = fromRaw(response.decoded);
    const result: EncodeResult = {
      bytes: response.bytes,
      size: response.bytes.byteLength,
      decoded,
      encodeMs: response.encodeMs,
      decodeMs: response.decodeMs,
      quality,
      width: decoded.width,
      height: decoded.height,
    };

    this.#cache.set(cacheKey(source.id, formatId, params, quality), {
      pixels: decoded.width * decoded.height,
      result,
    });
    return result;
  }

  async #metrics(reference: ImageData, candidate: ImageData, signal: AbortSignal): Promise<Metrics> {
    const a = toRaw(reference);
    const b = toRaw(candidate);
    const response = await this.#pool.run<MetricsResponse>(
      { kind: 'metrics', a, b },
      { signal, transfer: [a.data, b.data] },
    );
    return response;
  }
}

/** The reference panel: original bytes, original pixels, no metrics. */
function originalResult(source: ImageSource): EncodeResult {
  return {
    bytes: source.bytes,
    size: source.bytes.byteLength,
    decoded: source.full,
    encodeMs: 0,
    decodeMs: 0,
    quality: 'full',
    width: source.width,
    height: source.height,
  };
}
