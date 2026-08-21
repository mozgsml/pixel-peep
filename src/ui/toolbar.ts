import type { AlignMode, Axis, SyncMode } from '../core/geometry.ts';
import { Viewport } from '../core/viewport.ts';
import { LOCALES, type Locale, t } from '../i18n/index.ts';
import { type AppState, type ViewMode, sourcesDiffer } from '../app/state.ts';
import { type Segmented, el, iconButton, segmented, setText, toggleClass } from './dom.ts';
import * as fmt from './format.ts';

export interface ToolbarHost {
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
  onLocale(locale: Locale): void;
}

const ZOOM_STEPS = 200;

/**
 * The top bar.
 *
 * Every label goes through `t()` and the whole bar is rebuilt on a locale
 * change: the controls are cheap, and rebuilding is the only way to keep
 * `title`/`aria-label` honest without threading a setter through each one.
 */
export class Toolbar {
  readonly root = el('header', { class: 'topbar' });

  #host: ToolbarHost;

  #sync!: Segmented<SyncMode>;
  #align!: Segmented<AlignMode>;
  #axis!: Segmented<'auto' | 'x' | 'y'>;
  #view!: Segmented<ViewMode>;
  #locale!: Segmented<Locale>;
  #zoomInput!: HTMLInputElement;
  #zoomValue!: HTMLElement;
  #gain!: HTMLInputElement;
  #gainValue!: HTMLElement;
  #alignGroup!: HTMLElement;
  #viewGroup!: HTMLElement;

  constructor(host: ToolbarHost) {
    this.#host = host;
    this.build();
  }

  /** Re-creates the contents in the current locale. `root` stays the same node. */
  build(): void {
    const host = this.#host;

    this.#sync = segmented<SyncMode>(
      [
        { value: 'mirror', label: t('toolbar.sync.mirror'), title: t('toolbar.sync.mirrorTitle') },
        { value: 'continuous', label: t('toolbar.sync.continuous'), title: t('toolbar.sync.continuousTitle') },
      ],
      'mirror',
      host.onSync,
      t('toolbar.sync.label'),
    );

    this.#align = segmented<AlignMode>(
      [
        { value: 'contain', label: t('toolbar.align.contain'), title: t('toolbar.align.containTitle') },
        { value: 'width', label: t('toolbar.align.width'), title: t('toolbar.align.widthTitle') },
        { value: 'height', label: t('toolbar.align.height'), title: t('toolbar.align.heightTitle') },
      ],
      'contain',
      host.onAlign,
      t('toolbar.align.label'),
    );

    this.#axis = segmented<'auto' | 'x' | 'y'>(
      [
        { value: 'auto', label: t('toolbar.axis.auto'), title: t('toolbar.axis.autoTitle') },
        { value: 'x', label: t('toolbar.axis.x'), title: t('toolbar.axis.xTitle') },
        { value: 'y', label: t('toolbar.axis.y'), title: t('toolbar.axis.yTitle') },
      ],
      'auto',
      (value) => host.onAxis(value === 'auto' ? null : value),
      t('toolbar.axis.label'),
    );

    this.#view = segmented<ViewMode>(
      [
        { value: 'result', label: t('toolbar.view.result'), title: t('toolbar.view.resultTitle') },
        { value: 'diff', label: t('toolbar.view.diff'), title: t('toolbar.view.diffTitle') },
      ],
      'result',
      host.onViewMode,
      t('toolbar.view.label'),
    );

    this.#locale = segmented<Locale>(
      LOCALES.map((l) => ({ value: l.id, label: l.short, title: l.label })),
      LOCALES[0].id,
      host.onLocale,
      t('toolbar.group.language'),
    );

    this.#zoomInput = el('input', {
      type: 'range',
      class: 'zoom-range',
      min: '0',
      max: String(ZOOM_STEPS),
      step: '1',
      'aria-label': t('toolbar.zoom'),
    });
    this.#zoomInput.addEventListener('input', () => host.onZoom(sliderToZoom(Number(this.#zoomInput.value))));

    this.#zoomValue = el('span', { class: 'zoom-value' });

    this.#gain = el('input', {
      type: 'range',
      class: 'gain-range',
      min: '1',
      max: '32',
      step: '1',
      'aria-label': t('toolbar.gain.label'),
    });
    this.#gain.addEventListener('input', () => host.onDiffGain(Number(this.#gain.value)));
    this.#gainValue = el('span', { class: 'gain-value' });

    const open = el(
      'button',
      { type: 'button', class: 'button button-primary', title: t('toolbar.openTitle') },
      t('toolbar.open'),
    );
    open.addEventListener('click', host.onOpen);

    this.#alignGroup = group(t('toolbar.group.align'), this.#align.root);
    this.#viewGroup = group(
      t('toolbar.group.view'),
      this.#view.root,
      el('span', { class: 'gain-control' }, this.#gain, this.#gainValue),
    );

    this.root.replaceChildren(
      el(
        'div',
        { class: 'topbar-left' },
        el(
          'div',
          { class: 'brand' },
          el('span', { class: 'brand-mark' }),
          el('span', { class: 'brand-name' }, t('brand.name')),
        ),
        open,
      ),
      el(
        'div',
        { class: 'topbar-centre' },
        el(
          'div',
          { class: 'zoom-control' },
          iconButton(t('toolbar.zoomOut'), '−', () => host.onZoomStep(-0.06)),
          this.#zoomInput,
          iconButton(t('toolbar.zoomIn'), '+', () => host.onZoomStep(0.06)),
          this.#zoomValue,
          el(
            'span',
            { class: 'zoom-presets' },
            textButton(t('toolbar.fit'), host.onFit, t('toolbar.fitTitle')),
            textButton(t('toolbar.actual'), host.onActual, t('toolbar.actualTitle')),
          ),
        ),
      ),
      el(
        'div',
        { class: 'topbar-right' },
        this.#viewGroup,
        group(t('toolbar.group.pan'), this.#sync.root),
        this.#alignGroup,
        group(t('toolbar.group.layout'), this.#axis.root),
        group(t('toolbar.group.language'), this.#locale.root),
        githubLink(),
      ),
    );
  }

  update(state: AppState, viewport: Viewport): void {
    this.#sync.setValue(state.sync);
    this.#align.setValue(state.align);
    this.#axis.setValue(state.axisOverride ?? 'auto');
    this.#locale.setValue(state.locale);

    // Alignment only means something when the panels hold frames of different
    // sizes; with one photo in both it is noise, so it disappears.
    toggleClass(this.#alignGroup, 'is-hidden', !sourcesDiffer(state));

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

function githubLink(): HTMLElement {
  const label = t('toolbar.github');
  const link = el('a', {
    class: 'icon-button github-link',
    href: __REPO_URL__,
    target: '_blank',
    rel: 'noreferrer noopener',
    title: label,
    'aria-label': label,
  });
  // Inline so the mark survives without a network request under a strict CSP.
  link.innerHTML =
    '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" fill="currentColor">' +
    '<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 ' +
    '0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 ' +
    '1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 ' +
    '0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 ' +
    '2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 ' +
    '0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';
  return link;
}

function sliderToZoom(value: number): number {
  const t = value / ZOOM_STEPS;
  return Viewport.MIN_Z + t * (Viewport.MAX_Z - Viewport.MIN_Z);
}

function zoomToSlider(z: number): number {
  const t = (z - Viewport.MIN_Z) / (Viewport.MAX_Z - Viewport.MIN_Z);
  return Math.round(Math.min(1, Math.max(0, t)) * ZOOM_STEPS);
}
