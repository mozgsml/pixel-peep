import { t } from '../i18n/index.ts';
import { AbortError } from '../codecs/types.ts';
import type { HostEnvelope, WorkerEnvelope, WorkerRequest } from './protocol.ts';

/**
 * A small pool of codec workers with cancellation of stale work.
 *
 * The rule that matters: a new task for a panel aborts that panel's previous
 * unfinished task. Without it, dragging the quality slider builds a queue of
 * encodes nobody will ever look at, and the interface falls minutes behind.
 *
 * A wasm encode is one synchronous call and cannot be interrupted mid-flight;
 * aborting therefore drops queued tasks immediately and discards the result of
 * a running one. Combined with proxy-sized previews this keeps the interface
 * responsive without paying for a worker restart on every slider tick.
 */

interface Task {
  readonly id: number;
  readonly request: WorkerRequest;
  readonly transfer: Transferable[];
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
  readonly signal: AbortSignal | undefined;
  onAbort?: () => void;
  /** Already resolved or rejected; a later reply is discarded. */
  settled: boolean;
}

interface Slot {
  readonly worker: Worker;
  task: Task | null;
}

export function defaultPoolSize(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, Math.min(cores - 1, 4));
}

export class WorkerPool {
  #slots: Slot[] = [];
  #queue: Task[] = [];
  #nextId = 1;
  #size: number;
  #create: () => Worker;

  constructor(size: number = defaultPoolSize(), create: () => Worker = createCodecWorker) {
    this.#size = Math.max(1, size);
    this.#create = create;
  }

  get size(): number {
    return this.#size;
  }

  get pending(): number {
    return this.#queue.length + this.#slots.filter((s) => s.task !== null).length;
  }

  run<T>(request: WorkerRequest, options: { signal?: AbortSignal; transfer?: Transferable[] } = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new AbortError());
        return;
      }

      const task: Task = {
        id: this.#nextId++,
        request,
        transfer: options.transfer ?? [],
        resolve: resolve as (value: unknown) => void,
        reject,
        signal: options.signal,
        settled: false,
      };

      if (options.signal) {
        task.onAbort = () => this.#abort(task);
        options.signal.addEventListener('abort', task.onAbort, { once: true });
      }

      this.#queue.push(task);
      this.#pump();
    });
  }

  #abort(task: Task): void {
    if (task.settled) return;
    const queued = this.#queue.indexOf(task);
    if (queued >= 0) {
      this.#queue.splice(queued, 1);
      this.#settle(task, () => task.reject(new AbortError()));
      return;
    }
    const slot = this.#slots.find((s) => s.task === task);
    if (slot) {
      // Tell the worker to bail at its next await point. The caller is released
      // straight away: a wasm encode is one uninterruptible call, and making the
      // interface wait for it to finish is exactly the lag we are avoiding. The
      // eventual reply is discarded and only frees the slot.
      slot.worker.postMessage({ type: 'cancel', id: task.id } satisfies HostEnvelope);
      this.#settle(task, () => task.reject(new AbortError()));
    }
  }

  #settle(task: Task, finish: () => void): void {
    if (task.settled) return;
    task.settled = true;
    if (task.onAbort && task.signal) task.signal.removeEventListener('abort', task.onAbort);
    finish();
  }

  #ensureSlot(): Slot | null {
    const idle = this.#slots.find((s) => s.task === null);
    if (idle) return idle;
    if (this.#slots.length >= this.#size) return null;

    const worker = this.#create();
    const slot: Slot = { worker, task: null };
    worker.addEventListener('message', (event: MessageEvent<WorkerEnvelope>) => {
      const message = event.data;
      if (message.type === 'ready') return;
      const task = slot.task;
      if (!task || task.id !== message.id) return;
      slot.task = null;

      this.#settle(task, () => {
        if (message.type === 'result') task.resolve(message.payload);
        else if (message.name === 'AbortError') task.reject(new AbortError(message.message));
        else task.reject(new Error(message.message));
      });

      this.#pump();
    });
    worker.addEventListener('error', (event) => {
      const task = slot.task;
      slot.task = null;
      if (task) this.#settle(task, () => task.reject(new Error(event.message || t('error.workerFailed'))));
      this.#pump();
    });

    this.#slots.push(slot);
    return slot;
  }

  #pump(): void {
    while (this.#queue.length > 0) {
      const slot = this.#ensureSlot();
      if (!slot) return;
      const task = this.#queue.shift()!;
      if (task.signal?.aborted) {
        this.#settle(task, () => task.reject(new AbortError()));
        continue;
      }
      slot.task = task;
      slot.worker.postMessage({ type: 'run', id: task.id, request: task.request } satisfies HostEnvelope, task.transfer);
    }
  }

  terminate(): void {
    for (const slot of this.#slots) {
      slot.worker.terminate();
      // A task that was mid-flight will never report back now.
      const task = slot.task;
      slot.task = null;
      if (task) this.#settle(task, () => task.reject(new AbortError(t('error.poolStopped'))));
    }
    this.#slots = [];
    for (const task of this.#queue) this.#settle(task, () => task.reject(new AbortError()));
    this.#queue = [];
  }
}

export function createCodecWorker(): Worker {
  return new Worker(new URL('./codec.worker.ts', import.meta.url), {
    type: 'module',
    name: 'codec',
  });
}
