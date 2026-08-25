import type { Notice } from '../app/state.ts';
import { t } from '../i18n/index.ts';
import { el, setText } from './dom.ts';

/** Non-blocking messages. No modals: they hide the thing being compared. */
export class NoticeBar {
  readonly root = el('div', { class: 'notices', role: 'status', 'aria-live': 'polite' });
  #rendered = new Map<
    number,
    { node: HTMLElement; text: HTMLElement; close: HTMLElement; action: HTMLButtonElement | null }
  >();
  #onDismiss: (id: number) => void;
  #onAction: (actionId: string, noticeId: number) => void;

  constructor(onDismiss: (id: number) => void, onAction: (actionId: string, noticeId: number) => void) {
    this.#onDismiss = onDismiss;
    this.#onAction = onAction;
  }

  update(notices: readonly Notice[]): void {
    const seen = new Set(notices.map((n) => n.id));
    for (const [id, entry] of this.#rendered) {
      if (!seen.has(id)) {
        entry.node.remove();
        this.#rendered.delete(id);
      }
    }

    for (const item of notices) {
      let entry = this.#rendered.get(item.id);
      if (!entry) {
        const close = el('button', { type: 'button', class: 'notice-close' }, '×');
        close.addEventListener('click', () => this.#onDismiss(item.id));
        const text = el('span', {});
        // The choice sits with the message that prompted it, not in a menu.
        const action = item.action
          ? el('button', { type: 'button', class: 'button button-quiet notice-action' })
          : null;
        if (action) {
          const actionId = item.action!.id;
          action.addEventListener('click', () => this.#onAction(actionId, item.id));
        }
        const node = el('div', { class: `notice notice-${item.kind}` }, text, action, close);
        entry = { node, text, close, action };
        this.#rendered.set(item.id, entry);
        this.root.appendChild(node);
      }
      // Re-resolved on every render so a locale switch reaches open notices.
      setText(entry.text, t(item.key, item.vars));
      if (entry.action && item.action) setText(entry.action, t(item.action.label));
      entry.close.setAttribute('aria-label', t('notice.dismiss'));
    }
  }
}
