import type { Notice } from '../app/state.ts';
import { el } from './dom.ts';

/** Non-blocking messages. No modals: they hide the thing being compared. */
export class NoticeBar {
  readonly root = el('div', { class: 'notices', role: 'status', 'aria-live': 'polite' });
  #rendered = new Map<number, HTMLElement>();
  #onDismiss: (id: number) => void;

  constructor(onDismiss: (id: number) => void) {
    this.#onDismiss = onDismiss;
  }

  update(notices: readonly Notice[]): void {
    const seen = new Set(notices.map((n) => n.id));
    for (const [id, node] of this.#rendered) {
      if (!seen.has(id)) {
        node.remove();
        this.#rendered.delete(id);
      }
    }
    for (const item of notices) {
      if (this.#rendered.has(item.id)) continue;
      const close = el('button', { type: 'button', class: 'notice-close', 'aria-label': 'Скрыть' }, '×');
      close.addEventListener('click', () => this.#onDismiss(item.id));
      const node = el('div', { class: `notice notice-${item.kind}` }, el('span', {}, item.text), close);
      this.#rendered.set(item.id, node);
      this.root.appendChild(node);
    }
  }
}
