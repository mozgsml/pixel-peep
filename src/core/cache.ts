/**
 * LRU keyed by `(sourceId, formatId, hash(params), scale)`.
 *
 * The budget is counted in pixels, not entries: a 24 Mpx result and a 200 px
 * thumbnail cost wildly different amounts of memory, and it is memory — not
 * entry count — that kills mobile Safari.
 */

export interface Sized {
  /** Weight of this entry, in pixels. */
  readonly pixels: number;
}

export class LruCache<V extends Sized> {
  #map = new Map<string, V>();
  #pixels = 0;
  #floor = 1;
  readonly #budget: number;
  readonly #dispose: ((value: V) => void) | undefined;

  constructor(budgetPixels: number, dispose?: (value: V) => void) {
    this.#budget = budgetPixels;
    this.#dispose = dispose;
  }

  get size(): number {
    return this.#map.size;
  }

  get pixels(): number {
    return this.#pixels;
  }

  get budget(): number {
    return this.#budget;
  }

  /**
   * How many entries the budget may never evict below.
   *
   * For a cache of things currently on screen, evicting one of them saves
   * nothing: it is wanted again on the next frame and gets rebuilt. The texture
   * store learned this the hard way — two panels holding one frame each came to
   * 2 × pixels × 1.34, which passed the ceiling at about 22 Mpx, so an ordinary
   * 24 Mpx photograph rebuilt a mip pyramid every single frame and panning fell
   * from 33 ms to 250 ms. The owner sets this to the size of the set it really
   * needs; the budget then bounds only what is left over.
   */
  set floor(entries: number) {
    this.#floor = Math.max(1, entries);
  }

  has(key: string): boolean {
    return this.#map.has(key);
  }

  get(key: string): V | undefined {
    const value = this.#map.get(key);
    if (value === undefined) return undefined;
    // Re-insert to mark as most recently used.
    this.#map.delete(key);
    this.#map.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    const existing = this.#map.get(key);
    if (existing !== undefined) {
      this.#pixels -= existing.pixels;
      this.#map.delete(key);
      this.#dispose?.(existing);
    }
    this.#map.set(key, value);
    this.#pixels += value.pixels;
    this.#evict();
  }

  delete(key: string): boolean {
    const existing = this.#map.get(key);
    if (existing === undefined) return false;
    this.#pixels -= existing.pixels;
    this.#map.delete(key);
    this.#dispose?.(existing);
    return true;
  }

  /** Drop every entry whose key satisfies `predicate`. */
  prune(predicate: (key: string, value: V) => boolean): number {
    let removed = 0;
    for (const [key, value] of [...this.#map]) {
      if (predicate(key, value)) {
        this.delete(key);
        removed++;
      }
    }
    return removed;
  }

  clear(): void {
    for (const value of this.#map.values()) this.#dispose?.(value);
    this.#map.clear();
    this.#pixels = 0;
  }

  keys(): string[] {
    return [...this.#map.keys()];
  }

  #evict(): void {
    // Never evict the entry just written, nor dip below the set the owner says
    // it needs: returning them is better than thrashing.
    while (this.#pixels > this.#budget && this.#map.size > this.#floor) {
      const oldest = this.#map.keys().next();
      if (oldest.done) break;
      this.delete(oldest.value);
    }
  }
}

/** Stable, order-independent hash of a parameter record. */
export function hashParams(params: Record<string, unknown>): string {
  const keys = Object.keys(params).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const value = params[key];
    parts.push(`${key}=${typeof value === 'number' ? +value.toFixed(6) : String(value)}`);
  }
  return parts.join('&');
}

export function cacheKey(
  sourceId: string,
  formatId: string,
  params: Record<string, unknown>,
  scale: string,
): string {
  return `${sourceId}|${formatId}|${scale}|${hashParams(params)}`;
}
