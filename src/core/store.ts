/**
 * ~80 lines of observable state. Everything heavy is drawn imperatively into a
 * canvas; only the interface chrome needs reactivity, so a framework would be
 * pure overhead here.
 */

export type Listener<T> = (state: T, prev: T) => void;
export type Unsubscribe = () => void;

export class Store<T extends object> {
  #state: T;
  #listeners = new Set<Listener<T>>();
  #depth = 0;
  #pending: T | null = null;

  constructor(initial: T) {
    this.#state = initial;
  }

  get state(): T {
    return this.#state;
  }

  /** Replace state with a shallow patch, or with the result of a reducer. */
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void {
    const delta = typeof patch === 'function' ? patch(this.#state) : patch;
    if (!delta) return;
    let changed = false;
    for (const key of Object.keys(delta) as (keyof T)[]) {
      if (!Object.is(this.#state[key], delta[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;

    const prev = this.#state;
    this.#state = { ...this.#state, ...delta };

    // Re-entrant sets (a listener that dispatches) are coalesced into one
    // extra notification instead of recursing.
    if (this.#depth > 0) {
      this.#pending = prev;
      return;
    }
    this.#notify(prev);
  }

  #notify(prev: T): void {
    this.#depth++;
    try {
      for (const listener of [...this.#listeners]) listener(this.#state, prev);
    } finally {
      this.#depth--;
    }
    if (this.#depth === 0 && this.#pending) {
      const p = this.#pending;
      this.#pending = null;
      this.#notify(p);
    }
  }

  subscribe(listener: Listener<T>): Unsubscribe {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Fire `listener` only when `select` produces a different value. */
  watch<S>(select: (s: T) => S, listener: (value: S, prev: S) => void, equals = Object.is): Unsubscribe {
    let last = select(this.#state);
    return this.subscribe((s) => {
      const next = select(s);
      if (!equals(next, last)) {
        const prev = last;
        last = next;
        listener(next, prev);
      }
    });
  }
}
