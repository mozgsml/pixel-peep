import { describe, expect, it, vi } from 'vitest';
import { Store } from '../src/core/store.ts';

describe('Store', () => {
  it('notifies subscribers with the new and previous state', () => {
    const store = new Store({ count: 0 });
    const seen: Array<[number, number]> = [];
    store.subscribe((s, prev) => seen.push([s.count, prev.count]));
    store.set({ count: 1 });
    expect(seen).toEqual([[1, 0]]);
  });

  it('ignores a patch that changes nothing', () => {
    const store = new Store({ count: 0 });
    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ count: 0 });
    expect(listener).not.toHaveBeenCalled();
  });

  it('accepts a reducer', () => {
    const store = new Store({ count: 1 });
    store.set((s) => ({ count: s.count + 1 }));
    expect(store.state.count).toBe(2);
  });

  it('coalesces re-entrant updates instead of recursing', () => {
    const store = new Store({ a: 0, b: 0 });
    let calls = 0;
    store.subscribe((s) => {
      calls++;
      if (s.a === 1 && s.b === 0) store.set({ b: 1 });
    });
    store.set({ a: 1 });
    expect(store.state).toEqual({ a: 1, b: 1 });
    expect(calls).toBeLessThan(5);
  });

  it('unsubscribes', () => {
    const store = new Store({ count: 0 });
    const listener = vi.fn();
    const off = store.subscribe(listener);
    off();
    store.set({ count: 1 });
    expect(listener).not.toHaveBeenCalled();
  });

  it('watch fires only on a selected change', () => {
    const store = new Store({ a: 0, b: 0 });
    const listener = vi.fn();
    store.watch((s) => s.a, listener);
    store.set({ b: 5 });
    expect(listener).not.toHaveBeenCalled();
    store.set({ a: 2 });
    expect(listener).toHaveBeenCalledWith(2, 0);
  });
});
