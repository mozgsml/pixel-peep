import type { CodecDescriptor } from '../codecs/types.ts';
import { bitsPerPixel } from '../core/metrics.ts';
import { PanelRenderer } from '../render/panel-renderer.ts';
import type { AppState, PanelState } from '../app/state.ts';
import { panelSource } from '../app/state.ts';
import { type ParamsView, createParamsView } from './controls.ts';
import { clear, el, setText, toggleClass } from './dom.ts';
import * as fmt from './format.ts';

export interface PanelHost {
  onFormatChange(index: number, formatId: string): void;
  onParamPreview(index: number, key: string, value: string | number | boolean): void;
  onParamCommit(index: number, key: string, value: string | number | boolean): void;
  onActivate(index: number): void;
  onToggleDetails(): void;
  onRetry(index: number): void;
}

const PSNR_TOOLTIP =
  'PSNR плохо коррелирует с восприятием: слегка сдвинутый по яркости кадр получит низкую ' +
  'оценку, а замыленный — высокую. Решение принимается глазами, метрика лишь подсказка.';

/** One panel: format picker, canvas, generated controls, metrics footer. */
export class PanelView {
  readonly root: HTMLElement;
  readonly viewport: HTMLElement;
  readonly renderer: PanelRenderer;
  readonly params: ParamsView;
  readonly paramsHost: HTMLElement;

  #index: number;
  #host: PanelHost;

  #format = el('select', { class: 'format-select', 'aria-label': 'Формат' });
  #note = el('span', { class: 'panel-note' });
  #badge = el('span', { class: 'panel-badge' });
  #overlay = el('div', { class: 'panel-overlay' });
  #size = el('span', { class: 'metric-value', 'data-metric': 'size' });
  #ratio = el('span', { class: 'metric-value', 'data-metric': 'ratio' });
  #psnr = el('span', { class: 'metric-value', 'data-metric': 'psnr' });
  #metricsRow = el('div', { class: 'panel-metrics' });
  #detailsRow = el('dl', { class: 'panel-details' });
  #detailsButton = el('button', { type: 'button', class: 'details-toggle', 'aria-expanded': 'false' }, '⋯');
  #canvas = el('canvas', { class: 'panel-canvas' });
  #outOfFrame = el(
    'div',
    { class: 'panel-outside' },
    'Область продолжения вне кадра — увеличьте масштаб или переключитесь на «Зеркало»',
  );

  #lastSchemaId = '';

  constructor(index: number, host: PanelHost) {
    this.#index = index;
    this.#host = host;

    this.#format.addEventListener('change', () => host.onFormatChange(this.#index, this.#format.value));
    this.#detailsButton.addEventListener('click', () => host.onToggleDetails());

    this.params = createParamsView({
      onPreview: (key, value) => host.onParamPreview(this.#index, key, value),
      onCommit: (key, value) => host.onParamCommit(this.#index, key, value),
    });

    this.viewport = el(
      'div',
      { class: 'panel-view', tabindex: '0', role: 'img', 'aria-label': 'Панель сравнения' },
      this.#canvas,
      this.#outOfFrame,
      this.#overlay,
    );
    this.paramsHost = el('div', { class: 'panel-params' }, this.params.root);

    const metrics = el(
      'div',
      { class: 'panel-metrics-row' },
      metric('Размер', this.#size),
      metric('От оригинала', this.#ratio),
      metric('PSNR', this.#psnr, PSNR_TOOLTIP),
      this.#detailsButton,
    );
    this.#metricsRow.appendChild(metrics);
    this.#metricsRow.appendChild(this.#detailsRow);

    this.root = el(
      'section',
      { class: 'panel', 'data-index': String(index), 'data-testid': 'panel' },
      el('header', { class: 'panel-head' }, this.#format, this.#note, this.#badge),
      this.viewport,
      this.#metricsRow,
      // On narrow screens the layout moves this into the shared sheet.
      this.paramsHost,
    );

    this.root.addEventListener('pointerdown', () => host.onActivate(this.#index), true);
    this.viewport.addEventListener('focus', () => host.onActivate(this.#index));

    this.renderer = new PanelRenderer(this.#canvas);
  }

  get index(): number {
    return this.#index;
  }

  setIndex(index: number): void {
    this.#index = index;
    this.root.dataset['index'] = String(index);
  }

  setFormats(descriptors: readonly CodecDescriptor[]): void {
    const id = descriptors.map((d) => d.id).join(',');
    if (id === this.#lastSchemaId) return;
    this.#lastSchemaId = id;
    clear(this.#format);
    for (const descriptor of descriptors) {
      this.#format.appendChild(el('option', { value: descriptor.id }, descriptor.label));
    }
  }

  update(state: AppState, panel: PanelState, descriptor: CodecDescriptor | undefined): void {
    if (this.#format.value !== panel.formatId) this.#format.value = panel.formatId;
    setText(this.#note, descriptor?.note ?? '');
    this.params.update(descriptor?.params ?? [], panel.params);

    const source = panelSource(state, panel);
    const isReference = panel.formatId === 'original';
    this.root.dataset['status'] = panel.status;
    this.root.dataset['quality'] = panel.result?.quality ?? 'none';
    toggleClass(this.root, 'is-reference', isReference);
    toggleClass(this.root, 'is-active', state.activePanel === this.#index);

    this.viewport.setAttribute(
      'aria-label',
      source
        ? `${descriptor?.label ?? panel.formatId}, ${source.name}, ${source.width}×${source.height}`
        : 'Панель без изображения',
    );

    this.#updateBadge(state, panel);
    this.#updateOverlay(state, panel);

    toggleClass(this.#metricsRow, 'is-hidden', !source);
    this.#detailsRow.hidden = !state.detailsOpen;
    this.#detailsButton.setAttribute('aria-expanded', String(state.detailsOpen));

    if (!source) {
      setText(this.#size, '—');
      setText(this.#ratio, '—');
      setText(this.#psnr, '—');
      return;
    }

    const result = panel.result;
    const originalBytes = source.bytes.byteLength;
    const preview = result?.quality === 'proxy';

    // A preview is measured on the proxy: its byte count is real but is not the
    // size of the final file, so it is marked and the ratio is withheld rather
    // than quietly comparing incomparable numbers.
    setText(this.#size, result ? `${preview ? '≈' : ''}${fmt.bytes(result.size)}` : '…');
    setText(
      this.#ratio,
      result && originalBytes > 0 && !preview ? fmt.percent((result.size / originalBytes) * 100) : result ? '—' : '…',
    );

    if (isReference) setText(this.#psnr, '—');
    else if (panel.metrics) setText(this.#psnr, fmt.psnr(panel.metrics.psnr));
    else setText(this.#psnr, '…');

    if (state.detailsOpen) this.#renderDetails(panel, source.width, source.height, isReference, preview);
  }

  #updateBadge(state: AppState, panel: PanelState): void {
    let text = '';
    if (panel.result?.quality === 'proxy') text = 'предпросмотр';
    if (state.flip && this.#index > 0) text = 'flip';
    setText(this.#badge, text);
    toggleClass(this.#badge, 'is-visible', text !== '');
  }

  #updateOverlay(state: AppState, panel: PanelState): void {
    clear(this.#overlay);
    let visible = false;

    if (panel.status === 'empty' || !panelSource(state, panel)) {
      this.#overlay.appendChild(
        el('div', { class: 'overlay-card overlay-empty' }, state.mode === 'photo' ? 'Перетащите файл сюда' : ''),
      );
      visible = state.mode === 'photo';
    } else if (panel.status === 'error') {
      const card = el(
        'div',
        { class: 'overlay-card overlay-error' },
        el('strong', {}, 'Кодек не справился'),
        el('p', {}, panel.error ?? 'Неизвестная ошибка'),
        el('p', { class: 'overlay-hint' }, 'Попробуйте другие параметры или другой формат.'),
      );
      const retry = el('button', { type: 'button', class: 'button' }, 'Повторить');
      retry.addEventListener('click', () => this.#host.onRetry(this.#index));
      card.appendChild(retry);
      this.#overlay.appendChild(card);
      visible = true;
    } else if (panel.status === 'encoding' && !panel.result) {
      this.#overlay.appendChild(el('div', { class: 'overlay-card overlay-busy' }, el('span', { class: 'spinner' }), 'Кодирование…'));
      visible = true;
    }

    // A busy indicator that replaces the picture would defeat the purpose:
    // the previous result stays on screen while the new one is computed.
    toggleClass(this.root, 'is-busy', panel.status === 'encoding');
    toggleClass(this.#overlay, 'is-visible', visible);
  }

  #renderDetails(panel: PanelState, srcW: number, srcH: number, isReference: boolean, preview: boolean): void {
    clear(this.#detailsRow);
    const result = panel.result;
    const rows: Array<[string, string]> = [];

    rows.push(['Размер кадра', fmt.dimensions(srcW, srcH)]);
    if (result) {
      rows.push(['bpp', fmt.bpp(bitsPerPixel(result.size, result.width, result.height))]);
      rows.push(['Кодирование', fmt.ms(result.encodeMs)]);
      rows.push(['Декодирование', fmt.ms(result.decodeMs)]);
      if (preview) rows.push(['Разрешение', `прокси ${fmt.dimensions(result.width, result.height)}`]);
    }
    if (!isReference && panel.metrics) {
      rows.push(['SSIM', fmt.ssim(panel.metrics.ssim)]);
      rows.push(['MSE', panel.metrics.mse.toFixed(3)]);
    }

    for (const [term, value] of rows) {
      this.#detailsRow.appendChild(el('div', { class: 'detail' }, el('dt', {}, term), el('dd', {}, value)));
    }
  }

  /**
   * In "continuation" mode a trailing panel can end up entirely past the edge
   * of the image. That is what the mode means, but an unexplained grey
   * rectangle reads as a bug, so it says what happened.
   */
  setOutOfFrame(outside: boolean): void {
    toggleClass(this.#outOfFrame, 'is-visible', outside);
  }

  dispose(): void {
    this.root.remove();
  }
}

function metric(label: string, value: HTMLElement, title?: string): HTMLElement {
  const node = el('div', { class: 'metric' }, el('span', { class: 'metric-label' }, label), value);
  if (title) {
    node.title = title;
    node.classList.add('has-tooltip');
  }
  return node;
}
