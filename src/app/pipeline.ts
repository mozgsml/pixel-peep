import { t } from '../i18n/index.ts';
import { REFERENCE_FORMAT } from '../codecs/registry.ts';
import { AbortError, CodecLoadError, type ParamValue } from '../codecs/types.ts';
import { LruCache, cacheKey } from '../core/cache.ts';
import type { ImageSource } from '../core/image-source.ts';
import type { Metrics } from '../core/metrics.ts';
import { WorkerPool } from '../workers/pool.ts';
import { type DiffResponse, type EncodeResponse, type MetricsResponse, fromRaw, toRaw } from '../workers/protocol.ts';
import { type AppStore, type EncodeResult, type ResultQuality, panelSource, updatePanel } from './state.ts';

/** Quiet period before a dragged slider starts an encode. */
const DRAG_DEBOUNCE_MS = 200;

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
   * Both modes encode at full size; `dragging` only waits out a short quiet
   * period first, so a slider being moved does not start an encode per tick.
   * Either way the previous job for that panel is aborted, so a dragged slider
   * never accumulates a queue.
   */
  schedule(index: number, mode: 'dragging' | 'final' = 'final'): void {
    const panel = this.#store.state.panels[index];
    if (!panel) return;

    this.#cancel(panel.id);
    const token = ++this.#token;
    const controller = new AbortController();
    const next: PanelJob = { controller, timer: null, token };
    this.#jobs.set(panel.id, next);

    const start = () => {
      next.timer = null;
      void this.#run(index, next).catch((error: unknown) => {
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

    if (mode === 'dragging') next.timer = setTimeout(start, DRAG_DEBOUNCE_MS);
    else start();
  }

  scheduleAll(mode: 'dragging' | 'final' = 'final'): void {
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

  async #run(index: number, job: PanelJob): Promise<void> {
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

    // One pass, at the size the settings ask for. A proxy-resolution preview
    // used to go first so that something appeared sooner, and it was a bad
    // bargain: magnified past its own pixels it shows interpolation rather than
    // the codec's work, and the full pass only starts once it is done — on a
    // 9 Mpx photo the real answer arrived 2.8 seconds later for it. Waiting
    // once, with the panel plainly marked as working, is clearer and quicker.
    //
    // The exception is a frame too large to encode whole without risking an
    // out-of-memory kill. There the reduced copy is the only thing on offer,
    // and the interface says so.
    const targets: ResultQuality[] = state.proxyOnly && !source.proxyIsFull ? ['proxy'] : ['full'];

    const quality = targets[0]!;
    const cached = this.#cached(source, panel.formatId, panel.params, quality);
    const result =
      cached ?? (await this.#encodeWithRetry(source, panel.formatId, panel.params, quality, job.controller.signal));
    if (!this.#isCurrent(index, job)) throw new AbortError();

    // Measured against the reference at the same resolution.
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

    this.#publish(index, job, result, metrics, diff);

    this.#jobs.delete(panel.id);
  }

  #publish(
    index: number,
    job: PanelJob,
    result: EncodeResult,
    metrics: Metrics | null,
    diff: ImageData | null,
  ): void {
    if (!this.#isCurrent(index, job)) return;
    this.#store.set((state) => ({
      panels: updatePanel(state, index, (panel) => ({
        result,
        metrics,
        diff,
        status: 'ready',
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
