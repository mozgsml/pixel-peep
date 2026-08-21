import { SUPPORTED_INPUT_LABELS } from '../core/image-source.ts';
import { t } from '../i18n/index.ts';
import { el } from './dom.ts';

export interface DemoImage {
  readonly name: string;
  /** Message key; resolved at render time so it follows the locale. */
  readonly label: string;
  readonly draw: (width: number, height: number) => ImageData;
}

/**
 * First screen. An empty tool that only says "drop a file" is a dead end, so a
 * couple of synthetic targets are generated locally — they exercise exactly the
 * things codecs fail at: hard edges, fine texture, smooth gradients.
 */
export class EmptyState {
  readonly root = el('div', { class: 'empty-state' });

  #onOpen: () => void;
  #onDemo: (demo: DemoImage) => void;
  #demos: readonly DemoImage[];

  constructor(onOpen: () => void, onDemo: (demo: DemoImage) => void, demos: readonly DemoImage[]) {
    this.#onOpen = onOpen;
    this.#onDemo = onDemo;
    this.#demos = demos;
    this.build();
  }

  /** Re-creates the contents in the current locale. `root` stays the same node. */
  build(): void {
    const buttons = el('div', { class: 'empty-demos' });
    for (const demo of this.#demos) {
      const button = el('button', { type: 'button', class: 'button button-quiet' }, t(demo.label));
      button.addEventListener('click', () => this.#onDemo(demo));
      buttons.appendChild(button);
    }

    const open = el('button', { type: 'button', class: 'button button-primary' }, t('empty.open'));
    open.addEventListener('click', this.#onOpen);

    this.root.replaceChildren(
      el(
        'div',
        { class: 'empty-card' },
        el('h1', {}, t('empty.title')),
        el('p', {}, t('empty.body')),
        open,
        el('p', { class: 'empty-formats' }, t('empty.formats', { list: SUPPORTED_INPUT_LABELS })),
        el('div', { class: 'empty-divider' }),
        el('p', { class: 'empty-label' }, t('empty.demoLabel')),
        buttons,
      ),
    );
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('is-visible', visible);
  }
}
