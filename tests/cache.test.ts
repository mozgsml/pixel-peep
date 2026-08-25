import { describe, expect, it, vi } from 'vitest';
import { LruCache, cacheKey, hashParams } from '../src/core/cache.ts';

const entry = (pixels: number) => ({ pixels });

describe('LruCache', () => {
  it('returns what was stored', () => {
    const cache = new LruCache<{ pixels: number }>(100);
    cache.set('a', entry(10));
    expect(cache.get('a')).toEqual({ pixels: 10 });
    expect(cache.has('a')).toBe(true);
  });

  it('evicts by total pixels, not by entry count', () => {
    const cache = new LruCache<{ pixels: number }>(100);
    cache.set('a', entry(60));
    cache.set('b', entry(60));
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.pixels).toBe(60);

    const many = new LruCache<{ pixels: number }>(100);
    for (let i = 0; i < 20; i++) many.set(`k${i}`, entry(1));
    expect(many.size).toBe(20);
  });

  it('evicts the least recently used', () => {
    const cache = new LruCache<{ pixels: number }>(30);
    cache.set('a', entry(10));
    cache.set('b', entry(10));
    cache.set('c', entry(10));
    cache.get('a');
    cache.set('d', entry(10));
    expect(cache.has('b')).toBe(false);
    expect(cache.has('a')).toBe(true);
  });

  it('keeps a single oversized entry rather than thrashing', () => {
    const cache = new LruCache<{ pixels: number }>(10);
    cache.set('huge', entry(1000));
    expect(cache.get('huge')).toBeDefined();
  });

  it('calls dispose on eviction, replacement and clear', () => {
    const dispose = vi.fn();
    const cache = new LruCache<{ pixels: number }>(20, dispose);
    cache.set('a', entry(10));
    cache.set('a', entry(10));
    expect(dispose).toHaveBeenCalledTimes(1);
    cache.set('b', entry(20));
    expect(dispose).toHaveBeenCalledTimes(2);
    cache.clear();
    expect(dispose).toHaveBeenCalledTimes(3);
    expect(cache.pixels).toBe(0);
  });

  it('prunes by predicate', () => {
    const cache = new LruCache<{ pixels: number }>(1000);
    cache.set('src1|jpeg', entry(1));
    cache.set('src1|webp', entry(1));
    cache.set('src2|jpeg', entry(1));
    expect(cache.prune((key) => key.startsWith('src1|'))).toBe(2);
    expect(cache.keys()).toEqual(['src2|jpeg']);
  });
});

describe('hashParams', () => {
  it('is independent of key order', () => {
    expect(hashParams({ a: 1, b: true })).toBe(hashParams({ b: true, a: 1 }));
  });

  it('separates different values', () => {
    expect(hashParams({ quality: 80 })).not.toBe(hashParams({ quality: 81 }));
  });

  it('builds a key from every dimension that changes the result', () => {
    const a = cacheKey('s1', 'webp', { quality: 80 }, 'full');
    expect(a).not.toBe(cacheKey('s1', 'webp', { quality: 80 }, 'proxy'));
    expect(a).not.toBe(cacheKey('s2', 'webp', { quality: 80 }, 'full'));
    expect(a).not.toBe(cacheKey('s1', 'avif', { quality: 80 }, 'full'));
  });
});

describe('the eviction floor', () => {
  const entry = (pixels: number) => ({ pixels });

  it('evicts down to a single entry when nothing is protected', () => {
    const cache = new LruCache<{ pixels: number }>(100);
    cache.set('a', entry(80));
    cache.set('b', entry(80));
    expect(cache.keys()).toEqual(['b']);
  });

  it('keeps the set its owner says it needs, over budget or not', () => {
    // Evicting something that is on screen saves nothing: it is wanted again
    // on the very next frame. Two panels holding one 24 Mpx frame each came to
    // 64 Mpx against a 60 Mpx ceiling, so one was thrown out and rebuilt every
    // frame — panning went from 33 ms to 250 ms.
    const cache = new LruCache<{ pixels: number }>(100);
    cache.floor = 2;
    cache.set('a', entry(80));
    cache.set('b', entry(80));
    expect(cache.keys()).toEqual(['a', 'b']);
    expect(cache.pixels).toBeGreaterThan(cache.budget);
  });

  it('still evicts whatever is over and above that set', () => {
    const cache = new LruCache<{ pixels: number }>(100);
    cache.floor = 2;
    cache.set('a', entry(50));
    cache.set('b', entry(50));
    cache.set('c', entry(50));
    expect(cache.keys()).toEqual(['b', 'c']);
  });

  it('treats a floor below one as one', () => {
    const cache = new LruCache<{ pixels: number }>(100);
    cache.floor = 0;
    cache.set('a', entry(80));
    cache.set('b', entry(80));
    expect(cache.keys()).toEqual(['b']);
  });
});
