import type { Axis } from '../core/geometry.ts';
import type { AppState } from '../app/state.ts';
import { el, toggleClass } from './dom.ts';
import type { PanelView } from './panel.ts';

/**
 * Panel grid, draggable splitters, and the narrow-screen controls sheet.
 *
 * The grid is computed from `panels.length` and the layout axis: columns in
 * landscape, rows in portrait. Nothing here counts to two.
 */

const COMPACT_QUERY = '(max-width: 820px)';
const PORTRAIT_QUERY = '(orientation: portrait)';
const SPLITTER_SIZE = 7;

export interface LayoutHost {
  onSplits(splits: number[]): void;
  onActivePanel(index: number): void;
  /** Fires whenever panel boxes may have changed. */
  onResize(): void;
}

export class Layout {
  readonly root: HTMLElement;
  readonly sheet: HTMLElement;

  #host: LayoutHost;
  #panels: PanelView[] = [];
  #splitters: HTMLElement[] = [];
  #axis: Axis = 'x';
  #splits: number[] = [];
  #compact = false;
  #sheetTabs = el('div', { class: 'sheet-tabs', role: 'tablist' });
  #sheetBody = el('div', { class: 'sheet-body' });
  #compactMedia = window.matchMedia(COMPACT_QUERY);
  #portraitMedia = window.matchMedia(PORTRAIT_QUERY);
  #observer: ResizeObserver;

  constructor(host: LayoutHost) {
    this.#host = host;
    this.root = el('div', { class: 'stage' });
    this.sheet = el(
      'div',
      { class: 'sheet' },
      el('div', { class: 'sheet-handle' }),
      this.#sheetTabs,
      this.#sheetBody,
    );

    this.#observer = new ResizeObserver(() => host.onResize());
    this.#observer.observe(this.root);

    this.#compactMedia.addEventListener('change', () => this.#syncCompact());
    this.#portraitMedia.addEventListener('change', () => host.onResize());
  }

  get isCompact(): boolean {
    return this.#compact;
  }

  /** Layout axis derived from screen orientation, unless overridden. */
  autoAxis(): Axis {
    return this.#portraitMedia.matches ? 'y' : 'x';
  }

  setPanels(panels: PanelView[]): void {
    this.#panels = panels;
    this.#splitters = [];
    this.root.replaceChildren();

    panels.forEach((panel, index) => {
      if (index > 0) {
        const splitter = this.#createSplitter(index - 1);
        this.#splitters.push(splitter);
        this.root.appendChild(splitter);
      }
      this.root.appendChild(panel.root);
    });

    this.#splits = panels.map(() => 1 / panels.length);
    this.#syncCompact();
    this.#applyGrid();
  }

  setAxis(axis: Axis): void {
    if (this.#axis === axis) return;
    this.#axis = axis;
    this.#applyGrid();
    this.#host.onResize();
  }

  setSplits(splits: readonly number[]): void {
    this.#splits = [...splits];
    this.#applyGrid();
  }

  update(state: AppState): void {
    this.#sheetTabs.replaceChildren();
    if (!this.#compact) return;
    state.panels.forEach((panel, index) => {
      const tab = el(
        'button',
        {
          type: 'button',
          class: 'sheet-tab',
          role: 'tab',
          'aria-selected': String(state.activePanel === index),
        },
        `${String.fromCharCode(65 + index)} · ${panel.formatId === 'original' ? 'оригинал' : panel.formatId.toUpperCase()}`,
      );
      tab.addEventListener('click', () => this.#host.onActivePanel(index));
      this.#sheetTabs.appendChild(tab);
    });
    this.#mountParams(state.activePanel);
  }

  #mountParams(active: number): void {
    if (!this.#compact) return;
    const panel = this.#panels[active];
    if (!panel) return;
    if (this.#sheetBody.firstChild !== panel.paramsHost) {
      this.#sheetBody.replaceChildren(panel.paramsHost);
    }
  }

  /**
   * Two sets of codec controls do not fit side by side on a phone, so on narrow
   * screens they move into a single sheet with a tab per panel instead of being
   * squeezed by a media query.
   */
  #syncCompact(): void {
    const compact = this.#compactMedia.matches;
    this.#compact = compact;
    document.body.classList.toggle('is-compact', compact);

    for (const panel of this.#panels) {
      if (compact) continue;
      if (panel.paramsHost.parentElement !== panel.root) panel.root.appendChild(panel.paramsHost);
    }
    if (!compact) this.#sheetBody.replaceChildren();
    this.#host.onResize();
  }

  #applyGrid(): void {
    const count = this.#panels.length;
    if (count === 0) return;
    const sizes: string[] = [];
    for (let i = 0; i < count; i++) {
      if (i > 0) sizes.push(`${SPLITTER_SIZE}px`);
      sizes.push(`${(this.#splits[i] ?? 1 / count) * 100}fr`);
    }
    const template = sizes.join(' ');
    this.root.style.gridTemplateColumns = this.#axis === 'x' ? template : '';
    this.root.style.gridTemplateRows = this.#axis === 'y' ? template : '';
    this.root.dataset['axis'] = this.#axis;
    for (const splitter of this.#splitters) toggleClass(splitter, 'is-vertical', this.#axis === 'y');
  }

  #createSplitter(edge: number): HTMLElement {
    const splitter = el('div', {
      class: 'splitter',
      role: 'separator',
      tabindex: '0',
      'aria-label': 'Граница панелей',
    });

    const commit = (fractions: number[]) => {
      this.#splits = fractions;
      this.#applyGrid();
      this.#host.onSplits(fractions);
      this.#host.onResize();
    };

    splitter.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      splitter.setPointerCapture(event.pointerId);
      const rect = this.root.getBoundingClientRect();
      const total = this.#axis === 'x' ? rect.width : rect.height;
      const pairTotal = (this.#splits[edge] ?? 0) + (this.#splits[edge + 1] ?? 0);
      const start = this.#axis === 'x' ? event.clientX - rect.left : event.clientY - rect.top;

      const move = (e: PointerEvent) => {
        const current = this.#axis === 'x' ? e.clientX - rect.left : e.clientY - rect.top;
        const delta = (current - start) / Math.max(1, total);
        const next = [...this.#splits];
        const first = Math.min(pairTotal - 0.08, Math.max(0.08, (this.#splits[edge] ?? 0) + delta));
        next[edge] = first;
        next[edge + 1] = pairTotal - first;
        commit(next);
      };
      const up = () => {
        splitter.releasePointerCapture(event.pointerId);
        splitter.removeEventListener('pointermove', move);
        splitter.removeEventListener('pointerup', up);
      };
      splitter.addEventListener('pointermove', move);
      splitter.addEventListener('pointerup', up);
    });

    splitter.addEventListener('dblclick', () => {
      commit(this.#panels.map(() => 1 / this.#panels.length));
    });

    splitter.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 0.05 : 0.01;
      let delta = 0;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') delta = -step;
      else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') delta = step;
      else if (event.key === 'Home') {
        commit(this.#panels.map(() => 1 / this.#panels.length));
        return;
      } else return;
      event.preventDefault();
      const pairTotal = (this.#splits[edge] ?? 0) + (this.#splits[edge + 1] ?? 0);
      const next = [...this.#splits];
      const first = Math.min(pairTotal - 0.08, Math.max(0.08, (this.#splits[edge] ?? 0) + delta));
      next[edge] = first;
      next[edge + 1] = pairTotal - first;
      commit(next);
    });

    return splitter;
  }

  dispose(): void {
    this.#observer.disconnect();
  }
}
