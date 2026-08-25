import { REFERENCE_FORMAT, findCodec, listCodecs } from '../codecs/registry.ts';
import { type ParamValue, defaultParams, normaliseParams } from '../codecs/types.ts';
import { type AlignMode, type Axis, type PanelBox, type SyncMode, drawRects } from '../core/geometry.ts';
import { type ImageSource, SUPPORTED_INPUT_LABELS } from '../core/image-source.ts';
import { Viewport } from '../core/viewport.ts';
import { type Locale, setLocale, t } from '../i18n/index.ts';
import { UnsupportedFileError, loadImageFile } from '../io/decode-file.ts';
import { RenderLoop, TextureStore } from '../render/panel-renderer.ts';
import { el, toggleClass } from '../ui/dom.ts';
import { EmptyState } from '../ui/empty-state.ts';
import { Layout, SPLITTER_SIZE } from '../ui/layout.ts';
import { NoticeBar } from '../ui/notices.ts';
import { PanelView } from '../ui/panel.ts';
import { Toolbar } from '../ui/toolbar.ts';
import { attachViewportInput } from '../ui/viewport-input.ts';
import { DEMOS, demoToFile } from './demos.ts';
import { EncodePipeline } from './pipeline.ts';
import { type AppStore, createStore, notice, panelSource, updatePanel } from './state.ts';

/** Above this the tool works on the proxy only, to stay inside mobile memory. */
const PROXY_ONLY_PIXELS = 40_000_000;

export class App {
  readonly root: HTMLElement;
  readonly store: AppStore;
  readonly viewport = new Viewport();

  #pipeline: EncodePipeline;
  #textures = new TextureStore();
  #panels: PanelView[] = [];
  #layout: Layout;
  #toolbar: Toolbar;
  #notices: NoticeBar;
  #empty: EmptyState;
  #loop: RenderLoop;
  #fileInput: HTMLInputElement;
  /** Panel a file picker or a drop is aimed at; `null` means "every panel". */
  #fileTarget: number | null = null;
  #dropTarget: number | null = null;
  #loading = el('div', { class: 'loading-veil', role: 'status', 'aria-live': 'polite' });
  #loadingText = el('span', { class: 'loading-text' });
  #statusHint = el('span', { class: 'status-hint' });
  #interacting = false;
  #detachers: Array<() => void> = [];

  constructor(devMode: boolean) {
    this.store = createStore(devMode);
    this.#pipeline = new EncodePipeline(this.store);

    this.#toolbar = new Toolbar({
      onOpen: () => this.#pickFiles(null),
      onZoom: (z) => this.viewport.zoomTo(z, this.store.state.activePanel, null),
      onZoomStep: (delta) => this.viewport.zoomBy(delta, this.store.state.activePanel, null),
      onFit: () => this.viewport.zoomTo(0, this.store.state.activePanel, null),
      onActual: () => this.viewport.zoomTo(1, this.store.state.activePanel, null),
      onSync: (sync: SyncMode) => {
        this.viewport.setSync(sync);
        this.store.set({ sync });
      },
      onAlign: (align: AlignMode) => {
        this.viewport.setAlign(align);
        this.store.set({ align });
      },
      onAxis: (axis: Axis | null) => {
        this.store.set({ axisOverride: axis });
        this.#applyAxis();
      },
      onViewMode: (viewMode) => {
        this.store.set({ viewMode });
        if (viewMode === 'diff') void this.#pipeline.ensureDiffs();
      },
      onDiffGain: (diffGain) => {
        // Amplification is a draw-time filter, so nothing is recomputed.
        this.store.set({ diffGain });
        this.#loop.invalidate();
      },
      onLocale: (locale) => this.setLocale(locale),
    });

    this.#layout = new Layout({
      onSplits: (splits) => this.store.set({ splits }),
      onActivePanel: (index) => this.store.set({ activePanel: index }),
      onResize: () => {
        // Rotating the device flips the layout from columns to rows.
        this.#applyAxis();
        this.#measure();
      },
    });

    this.#notices = new NoticeBar((id) =>
      this.store.set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
    );

    this.#empty = new EmptyState(
      () => this.#pickFiles(null),
      (demo) => void this.#openDemo(demo),
      DEMOS,
    );

    this.#fileInput = el('input', {
      type: 'file',
      accept: 'image/*,.heic,.heif,.jxl,.avif',
      multiple: true,
      class: 'visually-hidden',
    });
    this.#fileInput.addEventListener('change', () => {
      const files = [...(this.#fileInput.files ?? [])];
      const target = this.#fileTarget;
      this.#fileInput.value = '';
      this.#fileTarget = null;
      void this.openFiles(files, target ?? undefined);
    });

    this.root = el(
      'div',
      { class: 'app' },
      this.#toolbar.root,
      this.#notices.root,
      el('main', { class: 'stage-wrap' }, this.#layout.root, this.#empty.root, this.#loading),
      this.#layout.sheet,
      el(
        'footer',
        { class: 'statusbar' },
        this.#statusHint,
        el('span', { class: 'build-info' }, `${__BUILD_SHA__} · ${__BUILD_DATE__}`),
      ),
      this.#fileInput,
    );

    this.#loading.append(el('span', { class: 'spinner' }), this.#loadingText);

    this.#loop = new RenderLoop(() => this.#draw());

    this.#buildPanels();
    this.#bindGlobalEvents();

    this.viewport.setGap(SPLITTER_SIZE);
    this.viewport.subscribe(() => {
      this.#loop.invalidate();
      this.#toolbar.update(this.store.state, this.viewport);
    });
    this.store.subscribe(() => this.#render());

    this.#applyAxis();
    this.#applyDocumentLocale();
    this.#render();

    if (!this.store.state.crossOriginIsolated) this.#notify('warn', 'notice.coi');
  }

  // ---------------------------------------------------------------- panels

  #buildPanels(): void {
    for (const detach of this.#detachers) detach();
    this.#detachers = [];
    for (const panel of this.#panels) panel.dispose();

    this.#panels = this.store.state.panels.map((_, index) => {
      const view = new PanelView(index, {
        onFormatChange: (i, formatId) => this.setFormat(i, formatId),
        onParamPreview: (i, key, value) => this.setParam(i, key, value, 'preview'),
        onParamCommit: (i, key, value) => this.setParam(i, key, value, 'final'),
        onActivate: (i) => {
          if (this.store.state.activePanel !== i) this.store.set({ activePanel: i });
        },
        onToggleDetails: () => this.store.set((s) => ({ detailsOpen: !s.detailsOpen })),
        onRetry: (i) => this.#pipeline.schedule(i, 'final'),
        onLoad: (i) => this.#pickFiles(i),
        onDownload: (i) => this.download(i),
      });

      this.#detachers.push(
        attachViewportInput(view.viewport, {
          viewport: this.viewport,
          indexOf: (element) => Number((element.closest('.panel') as HTMLElement | null)?.dataset['index'] ?? 0),
          onInteractionStart: () => this.#setInteracting(true),
          onInteractionEnd: () => this.#setInteracting(false),
        }),
      );
      this.#attachPanelDrop(view, index);
      return view;
    });

    this.#layout.setPanels(this.#panels);
  }

  /** A drop aimed at one panel replaces only that panel's photo. */
  #attachPanelDrop(view: PanelView, index: number): void {
    view.root.addEventListener('dragover', (event) => {
      event.preventDefault();
      this.#dropTarget = index;
      toggleClass(view.root, 'is-drop-target', true);
    });
    view.root.addEventListener('dragleave', () => toggleClass(view.root, 'is-drop-target', false));
    view.root.addEventListener('drop', () => {
      toggleClass(view.root, 'is-drop-target', false);
    });
  }

  // ------------------------------------------------------------- lifecycle

  #bindGlobalEvents(): void {
    window.addEventListener('resize', () => this.#measure());
    window.addEventListener('dragover', (event) => {
      event.preventDefault();
      document.body.classList.add('is-dragover');
    });
    window.addEventListener('dragleave', (event) => {
      if (event.relatedTarget === null) document.body.classList.remove('is-dragover');
    });
    window.addEventListener('drop', (event) => {
      event.preventDefault();
      document.body.classList.remove('is-dragover');
      const files = [...(event.dataTransfer?.files ?? [])];
      const target = this.#dropTarget;
      this.#dropTarget = null;
      void this.openFiles(files, target ?? undefined);
    });

    window.addEventListener('keydown', (event) => this.#onKeyDown(event));
    window.addEventListener('keyup', (event) => this.#onKeyUp(event));
    window.addEventListener('blur', () => {
      if (this.store.state.flip) this.store.set({ flip: false });
    });

    // devicePixelRatio changes when the window moves between screens; "1:1"
    // would silently stop being true.
    const watchDpr = () => {
      const media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      media.addEventListener('change', () => {
        this.#measure();
        watchDpr();
      }, { once: true });
    };
    watchDpr();
  }

  #onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const typing = target?.tagName === 'INPUT' || target?.tagName === 'SELECT' || target?.tagName === 'TEXTAREA';
    const index = this.store.state.activePanel;

    if (event.code === 'Space') {
      // Flip test: no delay, no transition. The eye catches a flicker in one
      // place far better than a difference between two places.
      if (typing) return;
      event.preventDefault();
      if (!event.repeat && !this.store.state.flip) this.store.set({ flip: true });
      return;
    }

    if (typing) return;

    switch (event.key) {
      case '+':
      case '=':
        event.preventDefault();
        this.viewport.zoomBy(0.06, index, null);
        break;
      case '-':
      case '_':
        event.preventDefault();
        this.viewport.zoomBy(-0.06, index, null);
        break;
      case '0':
        event.preventDefault();
        this.viewport.zoomTo(0, index, null);
        break;
      case '1':
        event.preventDefault();
        this.viewport.zoomTo(1, index, null);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.viewport.panByFraction(event.shiftKey ? 0.5 : 0.12, 0, index);
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.viewport.panByFraction(event.shiftKey ? -0.5 : -0.12, 0, index);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.viewport.panByFraction(0, event.shiftKey ? 0.5 : 0.12, index);
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.viewport.panByFraction(0, event.shiftKey ? -0.5 : -0.12, index);
        break;
      default:
        break;
    }
  }

  #onKeyUp(event: KeyboardEvent): void {
    if (event.code === 'Space' && this.store.state.flip) this.store.set({ flip: false });
  }

  #setInteracting(value: boolean): void {
    if (this.#interacting === value) return;
    this.#interacting = value;
    document.body.classList.toggle('is-interacting', value);
  }

  // ------------------------------------------------------------------ files

  #pickFiles(target: number | null): void {
    this.#fileTarget = target;
    this.#fileInput.multiple = target === null;
    this.#fileInput.click();
  }

  /**
   * `targetPanel` undefined means the file belongs to every panel — the usual
   * "one photo, several codecs" case. Several files at once are dealt out to
   * consecutive panels instead, which is how two shots get compared.
   */
  async openFiles(files: File[], targetPanel?: number): Promise<void> {
    const images = files.filter((f) => f.size > 0);
    if (images.length === 0) return;

    // More files than panels would decode images nothing can show, and each
    // one is tens of megabytes of ImageData.
    const panelCount = this.store.state.panels.length;
    const spread = targetPanel === undefined && images.length > 1;
    const first = targetPanel ?? 0;
    const accepted = spread || targetPanel !== undefined ? images.slice(0, panelCount - first) : images.slice(0, 1);

    this.store.set({ loading: accepted[0]!.name });
    try {
      for (let i = 0; i < accepted.length; i++) {
        const file = accepted[i]!;
        const loaded = await loadImageFile(file, file.name);
        for (const warning of loaded.warnings) this.#notify('warn', warning.key, warning.vars);
        this.#adoptSource(loaded.source, spread || targetPanel !== undefined ? first + i : undefined);
      }
    } catch (error) {
      if (error instanceof UnsupportedFileError) {
        this.#notify('error', 'notice.unsupported', {
          message: error.message,
          list: SUPPORTED_INPUT_LABELS,
        });
      } else {
        this.#notifyRaw('error', error instanceof Error ? error.message : String(error));
      }
    } finally {
      this.store.set({ loading: null });
    }
  }

  async #openDemo(demo: (typeof DEMOS)[number]): Promise<void> {
    this.store.set({ loading: t(demo.label) });
    try {
      const file = await demoToFile(demo);
      const loaded = await loadImageFile(file, file.name);
      this.#adoptSource(loaded.source);
    } catch (error) {
      this.#notifyRaw('error', error instanceof Error ? error.message : String(error));
    } finally {
      this.store.set({ loading: null });
    }
  }

  /**
   * Without an index the photo lands in every panel; with one it replaces that
   * panel alone and the others keep theirs.
   */
  #adoptSource(source: ImageSource, panelIndex?: number): void {
    const state = this.store.state;
    const proxyOnly = source.width * source.height > PROXY_ONLY_PIXELS;
    const reset = {
      result: null,
      metrics: null,
      diff: null,
      status: 'idle' as const,
    };

    const panels = state.panels.map((panel, index) => {
      if (panelIndex !== undefined && index !== panelIndex) return panel;
      return { ...panel, ...reset, sourceId: source.id, revision: panel.revision + 1 };
    });

    const keep = new Set(panels.map((p) => p.sourceId));
    const dropped = state.sources.filter((s) => !keep.has(s.id)).map((s) => s.id);

    this.store.set({
      sources: [source, ...state.sources.filter((s) => keep.has(s.id) && s.id !== source.id)],
      panels,
      proxyOnly: panelIndex === undefined ? proxyOnly : proxyOnly || state.proxyOnly,
    });
    for (const id of dropped) this.#pipeline.releaseSource(id);

    if (proxyOnly) {
      this.#notify('warn', 'notice.proxyOnly', {
        megapixels: ((source.width * source.height) / 1e6).toFixed(0),
        width: source.proxy.width,
        height: source.proxy.height,
      });
    }

    this.viewport.reset();
    this.#measure();
    if (panelIndex === undefined) this.#pipeline.scheduleAll('final');
    else this.#pipeline.schedule(panelIndex, 'final');
  }

  /** Saves what the panel is actually showing, under a name that says so. */
  download(index: number): void {
    const state = this.store.state;
    const panel = state.panels[index];
    if (!panel?.result || panel.result.quality !== 'full') return;
    const source = panelSource(state, panel);
    if (!source) return;

    const isReference = panel.formatId === REFERENCE_FORMAT;
    const codec = findCodec(panel.formatId);
    const stem = source.name.replace(/\.[^.]+$/, '') || 'image';
    const name = isReference ? source.name : `${stem}.${codec?.extension ?? 'bin'}`;
    const mime = isReference ? source.mime : (codec?.mime ?? 'application/octet-stream');

    const url = URL.createObjectURL(new Blob([panel.result.bytes], { type: mime }));
    const link = el('a', { href: url, download: name });
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoked on the next tick: Safari needs the URL alive when the click lands.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  // ------------------------------------------------------------------ state

  setLocale(locale: Locale): void {
    if (this.store.state.locale === locale) return;
    setLocale(locale);
    this.store.set({ locale });
    // Labels are baked into the DOM when a control is created, so the pieces
    // that are built once have to be built again.
    this.#toolbar.build();
    this.#empty.build();
    const descriptors = listCodecs(this.store.state.devMode);
    for (const view of this.#panels) view.rebuildFormats(descriptors);
    this.#applyDocumentLocale();
    this.#render();
  }

  #applyDocumentLocale(): void {
    document.documentElement.lang = this.store.state.locale;
    document.title = t('app.title');
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute('content', t('app.description'));
  }

  setFormat(index: number, formatId: string): void {
    const codec = findCodec(formatId);
    if (!codec) return;
    this.store.set({
      panels: updatePanel(this.store.state, index, (panel) => ({
        formatId,
        params: defaultParams(codec.params),
        result: null,
        metrics: null,
        diff: null,
        revision: panel.revision + 1,
      })),
    });
    this.#pipeline.schedule(index, 'final');
  }

  setParam(index: number, key: string, value: ParamValue, mode: 'preview' | 'final'): void {
    const state = this.store.state;
    const panel = state.panels[index];
    if (!panel) return;
    const codec = findCodec(panel.formatId);
    if (!codec) return;

    this.store.set({
      panels: updatePanel(state, index, (p) => ({
        params: normaliseParams(codec.params, { ...p.params, [key]: value }),
      })),
    });
    this.#pipeline.schedule(index, mode);
  }

  #notify(kind: 'info' | 'warn' | 'error', key: string, vars?: Readonly<Record<string, string | number>>): void {
    this.store.set((s) => {
      if (s.notices.some((n) => n.key === key)) return {};
      return { notices: [...s.notices, notice(kind, key, vars)] };
    });
  }

  /** For messages that are already text — codec failures and the like. */
  #notifyRaw(kind: 'info' | 'warn' | 'error', text: string): void {
    this.store.set((s) => {
      if (s.notices.some((n) => n.key === text)) return {};
      return { notices: [...s.notices, notice(kind, text)] };
    });
  }

  // ----------------------------------------------------------------- render

  #applyAxis(): void {
    const axis = this.store.state.axisOverride ?? this.#layout.autoAxis();
    this.store.set({ axis });
    this.viewport.setAxis(axis);
    this.#layout.setAxis(axis);
  }

  /** Feeds current panel and image sizes into the viewport. */
  #measure(): void {
    const state = this.store.state;
    const boxes: PanelBox[] = this.#panels.map((view, index) => {
      const panel = state.panels[index];
      const source = panel ? panelSource(state, panel) : undefined;
      const rect = view.viewport.getBoundingClientRect();
      return {
        image: { width: source?.width ?? 1, height: source?.height ?? 1 },
        panel: { width: Math.max(1, rect.width), height: Math.max(1, rect.height) },
      };
    });
    this.viewport.setBoxes(boxes);

    const dpr = window.devicePixelRatio || 1;
    this.#panels.forEach((view, index) => {
      const box = boxes[index];
      if (box) view.renderer.resize(box.panel.width, box.panel.height, dpr);
    });

    this.#loop.invalidate();
  }

  #render(): void {
    const state = this.store.state;
    const descriptors = listCodecs(state.devMode);

    this.#toolbar.update(state, this.viewport);
    this.#notices.update(state.notices);
    this.#layout.update(state);
    this.#layout.setSplits(state.splits);
    this.#empty.setVisible(state.sources.length === 0 && state.loading === null);
    toggleClass(this.#loading, 'is-visible', state.loading !== null);
    this.#loadingText.textContent = state.loading ? t('loading.decoding', { name: state.loading }) : '';
    this.#statusHint.textContent = t('app.hint');
    toggleClass(this.root, 'is-loading', state.loading !== null);
    toggleClass(this.root, 'is-flipping', state.flip);

    this.#panels.forEach((view, index) => {
      const panel = state.panels[index];
      if (!panel) return;
      view.setFormats(descriptors);
      view.update(state, panel, findCodec(panel.formatId));
    });

    this.#syncChromeHeights();
    this.#measure();
  }

  /**
   * Panels must be exactly the same height, or the two images stop lining up
   * and the whole comparison is off by a few pixels. Control docks differ in
   * height between formats, so the tallest one on screen sets the height for
   * all of them.
   */
  #syncChromeHeights(): void {
    const stage = this.#layout.root;
    if (this.#layout.isCompact) {
      stage.style.removeProperty('--params-height');
      stage.style.removeProperty('--metrics-height');
      return;
    }

    stage.style.setProperty('--params-height', 'auto');
    stage.style.setProperty('--metrics-height', 'auto');

    let params = 0;
    let metrics = 0;
    for (const view of this.#panels) {
      const dock = view.paramsHost.firstElementChild as HTMLElement | null;
      if (dock) params = Math.max(params, dock.offsetHeight);
      const footer = view.root.querySelector('.panel-metrics') as HTMLElement | null;
      if (footer) metrics = Math.max(metrics, footer.offsetHeight);
    }

    stage.style.setProperty('--params-height', `${params}px`);
    stage.style.setProperty('--metrics-height', `${metrics}px`);
  }

  #draw(): void {
    const state = this.store.state;
    const geometry = this.viewport.geometry();
    const boxes = this.viewport.boxes;
    const keys: string[] = [];

    this.#panels.forEach((view, index) => {
      const box = boxes[index];
      if (!box) return;

      // Flip test: every panel temporarily shows the first panel's content.
      const shown = state.flip ? state.panels[0] : state.panels[index];
      const source = shown ? panelSource(state, shown) : undefined;

      const diffMode = state.viewMode === 'diff' && !!shown?.diff;
      const image = diffMode ? shown!.diff : (shown?.result?.decoded ?? source?.full ?? null);
      const key = shown && image ? `${shown.id}:${shown.revision}:${diffMode ? 'd' : shown.result ? 'r' : 's'}` : '';
      if (key) keys.push(key);

      const pyramid = this.#textures.get(key, image);
      const logical = state.flip && source ? { width: source.width, height: source.height } : box.image;
      const filter = diffMode && state.diffGain > 1 ? `brightness(${state.diffGain})` : 'none';
      const geom = geometry[index] ?? geometry[0]!;
      const drawBox = { image: logical, panel: box.panel };
      view.renderer.draw(pyramid, drawBox, geom, filter);
      view.setOutOfFrame(!!pyramid && drawRects(drawBox, geom) === null);

      // A proxy-resolution texture only misleads once its own pixels are being
      // magnified. The frame covers `scale * dpr` device pixels per image pixel
      // and the texture holds `texture` of them, so each texture pixel is drawn
      // `scale * dpr / texture` across; below 1 the browser is shrinking it and
      // the softness is invisible. At 1:1 on a 65% proxy it is already 1.5.
      const texture = pyramid ? pyramid.width / Math.max(1, logical.width) : 1;
      const dpr = window.devicePixelRatio || 1;
      view.setInterpolated(!!pyramid && texture < 0.999 && (geom.scale * dpr) / texture >= 1);
    });

    this.#textures.retain(keys);
  }

  dispose(): void {
    this.#loop.stop();
    this.#pipeline.dispose();
    this.#textures.clear();
    this.#layout.dispose();
    for (const detach of this.#detachers) detach();
  }
}

export function createApp(devMode: boolean): App {
  return new App(devMode);
}
