import { SUPPORTED_INPUT_LABELS } from '../core/image-source.ts';
import { el } from './dom.ts';

export interface DemoImage {
  readonly name: string;
  readonly label: string;
  readonly draw: (width: number, height: number) => ImageData;
}

/**
 * First screen. An empty tool that only says "drop a file" is a dead end, so a
 * couple of synthetic targets are generated locally — they exercise exactly the
 * things codecs fail at: hard edges, fine texture, smooth gradients.
 */
export class EmptyState {
  readonly root: HTMLElement;

  constructor(onOpen: () => void, onDemo: (demo: DemoImage) => void, demos: readonly DemoImage[]) {
    const buttons = el('div', { class: 'empty-demos' });
    for (const demo of demos) {
      const button = el('button', { type: 'button', class: 'button button-quiet' }, demo.label);
      button.addEventListener('click', () => onDemo(demo));
      buttons.appendChild(button);
    }

    const open = el('button', { type: 'button', class: 'button button-primary' }, 'Выбрать файл');
    open.addEventListener('click', onOpen);

    this.root = el(
      'div',
      { class: 'empty-state' },
      el(
        'div',
        { class: 'empty-card' },
        el('h1', {}, 'До какого качества можно сжимать'),
        el(
          'p',
          {},
          'Перетащите снимок в окно — или откройте его кнопкой. Файлы никуда не отправляются, ' +
            'всё кодирование идёт прямо в браузере.',
        ),
        open,
        el('p', { class: 'empty-formats' }, `Поддерживаются: ${SUPPORTED_INPUT_LABELS}`),
        el('div', { class: 'empty-divider' }),
        el('p', { class: 'empty-label' }, 'Или начните с тестовой мишени'),
        buttons,
      ),
    );
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('is-visible', visible);
  }
}
