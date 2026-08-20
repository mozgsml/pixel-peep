import type { AlignMode, Axis, SyncMode } from '../core/geometry.ts';
import { Viewport } from '../core/viewport.ts';
import type { AppState, Mode, ViewMode } from '../app/state.ts';
import { type Segmented, el, iconButton, segmented, setText, toggleClass } from './dom.ts';
import * as fmt from './format.ts';

export interface ToolbarHost {
  onMode(mode: Mode): void;
  onOpen(): void;
  onZoom(z: number): void;
  onZoomStep(delta: number): void;
  onFit(): void;
  onActual(): void;
  onSync(sync: SyncMode): void;
  onAlign(align: AlignMode): void;
  onAxis(axis: Axis | null): void;
  onViewMode(mode: ViewMode): void;
  onDiffGain(gain: number): void;
}

const ZOOM_STEPS = 200;

export class Toolbar {
  readonly root: HTMLElement;

  #mode: Segmented<Mode>;
  #sync: Segmented<SyncMode>;
  #align: Segmented<AlignMode>;
  #axis: Segmented<'auto' | 'x' | 'y'>;
  #zoomInput = el('input', {
    type: 'range',
    class: 'zoom-range',
    min: '0',
    max: String(ZOOM_STEPS),
    step: '1',
    'aria-label': 'Масштаб',
  });
  #zoomValue = el('span', { class: 'zoom-value' });
  #alignGroup: HTMLElement;
  #view: Segmented<ViewMode>;
  #viewGroup: HTMLElement;
  #gain = el('input', {
    type: 'range',
    class: 'gain-range',
    min: '1',
    max: '32',
    step: '1',
    'aria-label': 'Усиление разницы',
  });
  #gainValue = el('span', { class: 'gain-value' });

  constructor(host: ToolbarHost) {
    this.#mode = segmented<Mode>(
      [
        { value: 'codec', label: 'Кодек', title: 'Один снимок, разные форматы' },
        { value: 'photo', label: 'Фото', title: 'Разные снимки, одни настройки' },
      ],
      'codec',
      host.onMode,
      'Режим сравнения',
    );

    this.#sync = segmented<SyncMode>(
      [
        { value: 'mirror', label: 'Зеркало', title: 'Один фрагмент показан дважды' },
        { value: 'continuous', label: 'Продолжение', title: 'Вторая панель продолжает первую' },
      ],
      'mirror',
      host.onSync,
      'Синхронизация панорамы',
    );

    this.#align = segmented<AlignMode>(
      [
        { value: 'contain', label: 'Вписать' },
        { value: 'width', label: 'Ширина' },
        { value: 'height', label: 'Высота' },
      ],
      'contain',
      host.onAlign,
      'Выравнивание разных размеров',
    );

    this.#axis = segmented<'auto' | 'x' | 'y'>(
      [
        { value: 'auto', label: 'Авто', title: 'По ориентации экрана' },
        { value: 'x', label: '▮▮', title: 'Панели рядом' },
        { value: 'y', label: '▬', title: 'Панели друг под другом' },
      ],
      'auto',
      (value) => host.onAxis(value === 'auto' ? null : value),
      'Раскладка панелей',
    );

    this.#view = segmented<ViewMode>(
      [
        { value: 'result', label: 'Результат', title: 'Декодированный результат кодирования' },
        { value: 'diff', label: 'Разница', title: '|результат − оригинал| с усилением' },
      ],
      'result',
      host.onViewMode,
      'Что показывать',
    );

    this.#gain.addEventListener('input', () => host.onDiffGain(Number(this.#gain.value)));

    this.#zoomInput.addEventListener('input', () => {
      host.onZoom(sliderToZoom(Number(this.#zoomInput.value)));
    });

    const open = el('button', { type: 'button', class: 'button button-primary' }, 'Открыть…');
    open.addEventListener('click', host.onOpen);

    this.#alignGroup = group('Выравнивание', this.#align.root);
    this.#viewGroup = group('Вид', this.#view.root, el('span', { class: 'gain-control' }, this.#gain, this.#gainValue));

    this.root = el(
      'header',
      { class: 'topbar' },
      el(
        'div',
        { class: 'topbar-left' },
        el('div', { class: 'brand' }, el('span', { class: 'brand-mark' }), el('span', { class: 'brand-name' }, 'Pixel Peep')),
        open,
        group('Режим', this.#mode.root),
      ),
      el(
        'div',
        { class: 'topbar-centre' },
        el(
          'div',
          { class: 'zoom-control' },
          iconButton('Уменьшить', '−', () => host.onZoomStep(-0.06)),
          this.#zoomInput,
          iconButton('Увеличить', '+', () => host.onZoomStep(0.06)),
          this.#zoomValue,
          el('span', { class: 'zoom-presets' },
            textButton('Вписать', host.onFit, 'Клавиша 0'),
            textButton('1:1', host.onActual, 'Клавиша 1'),
          ),
        ),
      ),
      el(
        'div',
        { class: 'topbar-right' },
        this.#viewGroup,
        group('Панорама', this.#sync.root),
        this.#alignGroup,
        group('Раскладка', this.#axis.root),
      ),
    );
  }

  update(state: AppState, viewport: Viewport): void {
    this.#mode.setValue(state.mode);
    this.#sync.setValue(state.sync);
    this.#align.setValue(state.align);
    this.#axis.setValue(state.axisOverride ?? 'auto');

    // Alignment only means something when the panels hold different images.
    const alignRelevant = state.mode === 'photo';
    toggleClass(this.#alignGroup, 'is-hidden', !alignRelevant);

    const hasSource = state.sources.length > 0;
    const slider = zoomToSlider(viewport.view.z);
    if (document.activeElement !== this.#zoomInput) this.#zoomInput.value = String(slider);
    // Without an image there is nothing to be a magnification *of*.
    setText(this.#zoomValue, hasSource ? fmt.magnification(viewport.scaleOf(0)) : '—');

    this.#view.setValue(state.viewMode);
    this.#viewGroup.classList.toggle('show-gain', state.viewMode === 'diff');
    if (document.activeElement !== this.#gain) this.#gain.value = String(state.diffGain);
    setText(this.#gainValue, `×${state.diffGain}`);

    this.#sync.setDisabled(!hasSource);
    this.#align.setDisabled(!hasSource);
    this.#view.setDisabled(!hasSource);
    this.#zoomInput.disabled = !hasSource;
    this.root.classList.toggle('no-source', !hasSource);
  }
}

function group(label: string, ...children: HTMLElement[]): HTMLElement {
  return el('div', { class: 'toolbar-group' }, el('span', { class: 'toolbar-label' }, label), ...children);
}

function textButton(label: string, onClick: () => void, title?: string): HTMLButtonElement {
  const button = el('button', { type: 'button', class: 'button button-quiet', title: title ?? label }, label);
  button.addEventListener('click', onClick);
  return button;
}

function sliderToZoom(value: number): number {
  const t = value / ZOOM_STEPS;
  return Viewport.MIN_Z + t * (Viewport.MAX_Z - Viewport.MIN_Z);
}

function zoomToSlider(z: number): number {
  const t = (z - Viewport.MIN_Z) / (Viewport.MAX_Z - Viewport.MIN_Z);
  return Math.round(Math.min(1, Math.max(0, t)) * ZOOM_STEPS);
}
