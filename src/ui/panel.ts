import type { CodecDescriptor } from '../codecs/types.ts';
import { bitsPerPixel } from '../core/metrics.ts';
import { t } from '../i18n/index.ts';
import { PanelRenderer } from '../render/panel-renderer.ts';
import type { AppState, PanelState } from '../app/state.ts';
import { panelSource } from '../app/state.ts';
import { type ParamsView, createParamsView } from './controls.ts';
import { attachTooltip, clear, el, setText, toggleClass } from './dom.ts';
import * as fmt from './format.ts';

export interface PanelHost {
  onFormatChange(index: number, formatId: string): void;
  onParamPreview(index: number, key: string, value: string | number | boolean): void;
  onParamCommit(index: number, key: string, value: string | number | boolean): void;
  onActivate(index: number): void;
  onToggleDetails(): void;
  onRetry(index: number): void;
  /** Open a file picker that fills this panel only. */
  onLoad(index: number): void;
  onDownload(index: number): void;
}

/** One panel: format picker, canvas, generated controls, metrics footer. */
export class PanelView {
  readonly root: HTMLElement;
  readonly viewport: HTMLElement;
  readonly renderer: PanelRenderer;
  readonly params: ParamsView;
  readonly paramsHost: HTMLElement;

  #index: number;
  #host: PanelHost;

  #format = el('select', { class: 'format-select' });
  #note = el('span', { class: 'panel-note' });
  #badge = el('span', { class: 'panel-badge' });
  #busyText = el('span', { class: 'panel-busy-text' });
  #busy = el(
    'span',
    { class: 'panel-busy', role: 'status' },
    el('span', { class: 'spinner spinner-small' }),
    this.#busyText,
  );
  #load = el('button', { type: 'button', class: 'button button-quiet panel-load' });
  #download = el('button', { type: 'button', class: 'button button-quiet panel-download' });
  #overlay = el('div', { class: 'panel-overlay' });
  #size = el('span', { class: 'metric-value', 'data-metric': 'size' });
  #ratio = el('span', { class: 'metric-value', 'data-metric': 'ratio' });
  #psnr = el('span', { class: 'metric-value', 'data-metric': 'psnr' });
  #reduced = el('span', { class: 'metric-value', 'data-metric': 'reduced' });
  #sizeLabel = el('span', { class: 'metric-label' });
  #reducedLabel = el('span', { class: 'metric-label' });
  #reducedMetric!: HTMLElement;
  #ratioLabel = el('span', { class: 'metric-label' });
  #psnrLabel = el('span', { class: 'metric-label' });
  #psnrMetric: HTMLElement;
  #metricsRow = el('div', { class: 'panel-metrics' });
  #detailsRow = el('dl', { class: 'panel-details' });
  #detailsButton = el('button', { type: 'button', class: 'details-toggle', 'aria-expanded': 'false' }, '⋯');
  #canvas = el('canvas', { class: 'panel-canvas' });
  #outOfFrame = el('div', { class: 'panel-outside' });
  #interpolated = el('div', { class: 'panel-outside panel-interpolated' });

  #lastSchemaId = '';
  #lastFormats: readonly CodecDescriptor[] = [];

  constructor(index: number, host: PanelHost) {
    this.#index = index;
    this.#host = host;

    this.#format.addEventListener('change', () => host.onFormatChange(this.#index, this.#format.value));
    this.#detailsButton.addEventListener('click', () => host.onToggleDetails());
    this.#load.addEventListener('click', () => host.onLoad(this.#index));
    this.#download.addEventListener('click', () => host.onDownload(this.#index));

    this.params = createParamsView({
      onPreview: (key, value) => host.onParamPreview(this.#index, key, value),
      onCommit: (key, value) => host.onParamCommit(this.#index, key, value),
    });

    this.viewport = el(
      'div',
      { class: 'panel-view', tabindex: '0', role: 'img' },
      this.#canvas,
      this.#outOfFrame,
      this.#interpolated,
      this.#overlay,
    );
    this.paramsHost = el('div', { class: 'panel-params' }, this.params.root);

    this.#psnrMetric = metric(this.#psnrLabel, this.#psnr);
    this.#psnrMetric.classList.add('has-tooltip');
    attachTooltip(this.#psnrMetric, () => t('panel.psnrTooltip'));

    this.#reducedMetric = metric(this.#reducedLabel, this.#reduced);

    const metrics = el(
      'div',
      { class: 'panel-metrics-row' },
      metric(this.#sizeLabel, this.#size),
      this.#reducedMetric,
      metric(this.#ratioLabel, this.#ratio),
      this.#psnrMetric,
      el('div', { class: 'panel-actions' }, this.#busy, this.#download, this.#detailsButton),
    );
    this.#metricsRow.appendChild(metrics);
    this.#metricsRow.appendChild(this.#detailsRow);

    this.root = el(
      'section',
      { class: 'panel', 'data-index': String(index), 'data-testid': 'panel' },
      el(
        'header',
        { class: 'panel-head' },
        this.#format,
        this.#note,
        el('div', { class: 'panel-head-actions' }, this.#badge, this.#load),
      ),
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
    if (id === this.#lastSchemaId && descriptors === this.#lastFormats) return;
    this.#lastSchemaId = id;
    this.#lastFormats = descriptors;
    const selected = this.#format.value;
    clear(this.#format);
    for (const descriptor of descriptors) {
      this.#format.appendChild(el('option', { value: descriptor.id }, t(descriptor.label)));
    }
    if (selected) this.#format.value = selected;
  }

  /** Called when the locale changes: option labels are baked into the DOM. */
  rebuildFormats(descriptors: readonly CodecDescriptor[]): void {
    this.#lastSchemaId = '';
    this.setFormats(descriptors);
  }

  update(state: AppState, panel: PanelState, descriptor: CodecDescriptor | undefined): void {
    if (this.#format.value !== panel.formatId) this.#format.value = panel.formatId;
    this.#format.setAttribute('aria-label', t('panel.format'));
    setText(this.#note, descriptor?.note ? t(descriptor.note) : '');
    this.params.update(descriptor?.params ?? [], panel.params);

    setText(this.#load, t('panel.load'));
    this.#load.title = t('panel.loadTitle');
    setText(this.#sizeLabel, t('panel.metric.size'));
    setText(this.#reducedLabel, t('panel.metric.reduced'));
    setText(this.#ratioLabel, t('panel.metric.ratio'));
    setText(this.#psnrLabel, t('panel.metric.psnr'));
    this.#detailsButton.title = t('panel.details');
    setText(this.#outOfFrame, t('panel.outOfFrame'));
    setText(this.#interpolated, t('panel.interpolated'));

    const source = panelSource(state, panel);
    const isReference = panel.formatId === 'original';
    this.root.dataset['status'] = panel.status;
    this.root.dataset['quality'] = panel.result?.quality ?? 'none';
    toggleClass(this.root, 'is-reference', isReference);
    toggleClass(this.root, 'is-active', state.activePanel === this.#index);

    this.viewport.setAttribute(
      'aria-label',
      source
        ? t('panel.aria.image', {
            format: t(descriptor?.label ?? panel.formatId),
            name: source.name,
            width: source.width,
            height: source.height,
          })
        : t('panel.aria.empty'),
    );

    this.#updateBadge(state, panel);
    this.#updateOverlay(state, panel);
    this.#updateDownload(panel, isReference);

    // The point of a busy indicator here is a slider being dragged: the picture
    // stays, so without this nothing on screen says a new encode is running.
    toggleClass(this.#busy, 'is-visible', panel.status === 'encoding');
    this.#busy.setAttribute('aria-label', t('panel.overlay.busy'));
    setText(this.#busyText, t('panel.overlay.busy'));

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
    // Every figure in this row describes the frame that was actually encoded.
    // When that is a reduced copy, the row has to say so where the numbers are,
    // not only with a badge up in the header.
    toggleClass(this.#reducedMetric, 'is-hidden', !preview);
    setText(this.#reduced, preview && result ? fmt.dimensions(result.width, result.height) : '');
    setText(
      this.#ratio,
      result && originalBytes > 0 && !preview ? fmt.percent((result.size / originalBytes) * 100) : result ? '—' : '…',
    );

    if (isReference) setText(this.#psnr, '—');
    else if (panel.metrics) setText(this.#psnr, fmt.psnr(panel.metrics.psnr));
    else setText(this.#psnr, '…');

    if (state.detailsOpen) this.#renderDetails(panel, source.width, source.height, isReference, preview);
  }

  /**
   * Saving a preview would hand over a downscaled file under a full-size name,
   * so the button waits for the full-resolution pass.
   */
  #updateDownload(panel: PanelState, isReference: boolean): void {
    const ready = !!panel.result && panel.result.quality === 'full';
    setText(this.#download, t('panel.download'));
    this.#download.title = isReference ? t('panel.downloadOriginal') : t('panel.downloadTitle');
    this.#download.disabled = !ready;
    toggleClass(this.#download, 'is-hidden', !panel.result);
  }

  #updateBadge(state: AppState, panel: PanelState): void {
    let text = '';
    if (panel.result?.quality === 'proxy') text = t('panel.badge.preview');
    if (state.flip && this.#index > 0) text = t('panel.badge.flip');
    setText(this.#badge, text);
    toggleClass(this.#badge, 'is-visible', text !== '');
  }

  #updateOverlay(state: AppState, panel: PanelState): void {
    clear(this.#overlay);
    let visible = false;

    if (panel.status === 'empty' || !panelSource(state, panel)) {
      this.#overlay.appendChild(el('div', { class: 'overlay-card overlay-empty' }, t('panel.overlay.drop')));
      visible = true;
    } else if (panel.status === 'error') {
      const card = el(
        'div',
        { class: 'overlay-card overlay-error' },
        el(
          'strong',
          {},
          t(panel.errorKind === 'load' ? 'panel.overlay.loadErrorTitle' : 'panel.overlay.errorTitle'),
        ),
        el('p', {}, panel.error ?? t('panel.overlay.errorUnknown')),
        el(
          'p',
          { class: 'overlay-hint' },
          t(panel.errorKind === 'load' ? 'panel.overlay.loadErrorHint' : 'panel.overlay.errorHint'),
        ),
      );
      const retry = el('button', { type: 'button', class: 'button' }, t('panel.overlay.retry'));
      retry.addEventListener('click', () => this.#host.onRetry(this.#index));
      card.appendChild(retry);
      this.#overlay.appendChild(card);
      visible = true;
    } else if (panel.status === 'encoding') {
      this.#overlay.appendChild(
        el('div', { class: 'overlay-card overlay-busy' }, el('span', { class: 'spinner' }), t('panel.overlay.busy')),
      );
      visible = true;
    }

    // The previous result stays on screen while the new one is computed — the
    // indicator sits above it rather than replacing it, and is deliberately not
    // centred: see the note on `.overlay-busy`.
    toggleClass(this.root, 'is-busy', panel.status === 'encoding');
    toggleClass(this.#overlay, 'is-visible', visible);
  }

  #renderDetails(panel: PanelState, srcW: number, srcH: number, isReference: boolean, preview: boolean): void {
    clear(this.#detailsRow);
    const result = panel.result;
    const rows: Array<[string, string]> = [];

    rows.push([t('panel.detail.frameSize'), fmt.dimensions(srcW, srcH)]);
    if (result) {
      rows.push([t('panel.detail.bpp'), fmt.bpp(bitsPerPixel(result.size, result.width, result.height))]);
      rows.push([t('panel.detail.encode'), fmt.ms(result.encodeMs)]);
      rows.push([t('panel.detail.decode'), fmt.ms(result.decodeMs)]);
      if (preview) {
        rows.push([
          t('panel.detail.resolution'),
          t('panel.detail.proxy', { size: fmt.dimensions(result.width, result.height) }),
        ]);
      }
    }
    if (!isReference && panel.metrics) {
      rows.push([t('panel.detail.ssim'), fmt.ssim(panel.metrics.ssim)]);
      rows.push([t('panel.detail.mse'), panel.metrics.mse.toFixed(3)]);
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

  /**
   * A preview is encoded at proxy resolution, so magnifying it shows
   * interpolation rather than the codec's own pixels — and next to a panel
   * drawing real pixels at the same zoom it reads as though the codec had
   * smeared the picture. Say what is actually on screen.
   */
  setInterpolated(on: boolean): void {
    toggleClass(this.#interpolated, 'is-visible', on);
  }

  dispose(): void {
    this.root.remove();
  }
}

function metric(label: HTMLElement, value: HTMLElement): HTMLElement {
  return el('div', { class: 'metric' }, label, value);
}
