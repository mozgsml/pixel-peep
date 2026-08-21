import { describe, expect, it, vi } from 'vitest';
import { WorkerPool } from '../src/workers/pool.ts';
import type { HostEnvelope } from '../src/workers/protocol.ts';

/**
 * A stand-in worker that never finishes on its own, so the tests can control
 * exactly when a task completes and observe what the pool does meanwhile.
 */
class FakeWorker implements Pick<Worker, 'postMessage' | 'terminate' | 'addEventListener' | 'removeEventListener'> {
  static instances: FakeWorker[] = [];
  readonly received: HostEnvelope[] = [];
  #listeners = new Map<string, Set<(event: unknown) => void>>();
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: HostEnvelope): void {
    this.received.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set());
    this.#listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.#listeners.get(type)?.delete(listener);
  }

  emit(data: unknown): void {
    for (const listener of this.#listeners.get('message') ?? []) listener({ data });
  }

  get running(): number | null {
    const last = this.received.filter((m) => m.type === 'run').at(-1);
    return last && last.type === 'run' ? last.id : null;
  }
}

function makePool(size: number): WorkerPool {
  FakeWorker.instances = [];
  return new WorkerPool(size, () => new FakeWorker() as unknown as Worker);
}

const request = { kind: 'metrics' as const, a: raw(), b: raw() };

function raw() {
  return { data: new ArrayBuffer(4), width: 1, height: 1 };
}

/** Fire-and-forget task whose rejection on teardown is expected. */
function fire(pool: WorkerPool): Promise<unknown> {
  return pool.run(request).catch(() => undefined);
}

describe('WorkerPool', () => {
  it('spawns workers lazily, up to its size', async () => {
    const pool = makePool(2);
    expect(FakeWorker.instances).toHaveLength(0);

    fire(pool);
    fire(pool);
    fire(pool);
    expect(FakeWorker.instances).toHaveLength(2);
    expect(pool.pending).toBe(3);
    pool.terminate();
  });

  it('routes each result back to its own caller', async () => {
    const pool = makePool(1);
    const first = pool.run<{ psnr: number }>(request);
    const worker = FakeWorker.instances[0]!;
    worker.emit({ type: 'result', id: worker.running, payload: { psnr: 42 } });
    await expect(first).resolves.toEqual({ psnr: 42 });
    pool.terminate();
  });

  it('rejects with the worker error', async () => {
    const pool = makePool(1);
    const task = pool.run(request);
    const worker = FakeWorker.instances[0]!;
    worker.emit({ type: 'error', id: worker.running, name: 'Error', message: 'the codec fell over' });
    await expect(task).rejects.toThrow('the codec fell over');
    pool.terminate();
  });

  it('drops a queued task the moment it is aborted, without ever starting it', async () => {
    const pool = makePool(1);
    fire(pool);
    const controller = new AbortController();
    const queued = pool.run(request, { signal: controller.signal });

    const worker = FakeWorker.instances[0]!;
    expect(worker.received.filter((m) => m.type === 'run')).toHaveLength(1);

    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.received.filter((m) => m.type === 'run')).toHaveLength(1);
    pool.terminate();
  });

  it('rejects immediately for an already aborted signal', async () => {
    const pool = makePool(1);
    const controller = new AbortController();
    controller.abort();
    await expect(pool.run(request, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.instances).toHaveLength(0);
    pool.terminate();
  });

  it('tells the worker to cancel a task that is already running', async () => {
    const pool = makePool(1);
    const controller = new AbortController();
    const task = pool.run(request, { signal: controller.signal });
    const worker = FakeWorker.instances[0]!;
    const id = worker.running;

    controller.abort();
    expect(worker.received).toContainEqual({ type: 'cancel', id });

    worker.emit({ type: 'error', id, name: 'AbortError', message: 'Aborted' });
    await expect(task).rejects.toMatchObject({ name: 'AbortError' });
    pool.terminate();
  });

  it('does not accumulate a queue when a slider is dragged', async () => {
    // Every new request for the same panel aborts the previous one, which is
    // what keeps a dragged slider from queueing dozens of dead encodes.
    const pool = makePool(1);
    const results: Promise<unknown>[] = [];
    let controller = new AbortController();

    for (let i = 0; i < 20; i++) {
      controller.abort();
      controller = new AbortController();
      const task = pool.run(request, { signal: controller.signal }).catch(() => 'aborted');
      results.push(task);
    }

    await Promise.all(results.slice(0, 19));
    expect(pool.pending).toBeLessThanOrEqual(2);
    pool.terminate();
  });

  it('frees the slot for the next task once one finishes', async () => {
    const pool = makePool(1);
    const first = pool.run(request);
    fire(pool);
    const worker = FakeWorker.instances[0]!;
    const firstId = worker.running;

    worker.emit({ type: 'result', id: firstId, payload: 1 });
    await first;
    expect(worker.received.filter((m) => m.type === 'run')).toHaveLength(2);
    pool.terminate();
  });

  it('ignores the ready handshake', async () => {
    const pool = makePool(1);
    const listener = vi.fn();
    const task = pool.run(request).then(listener);
    FakeWorker.instances[0]!.emit({ type: 'ready' });
    expect(listener).not.toHaveBeenCalled();
    pool.terminate();
    await expect(task).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('terminates every worker and rejects the backlog', async () => {
    const pool = makePool(2);
    fire(pool);
    fire(pool);
    const running = pool.run(request);
    const queued = pool.run(request);
    pool.terminate();
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.instances.every((w) => w.terminated)).toBe(true);
  });
});
