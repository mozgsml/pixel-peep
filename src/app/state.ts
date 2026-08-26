import { REFERENCE_FORMAT, findCodec } from '../codecs/registry.ts';
import { type ParamValue, defaultParams } from '../codecs/types.ts';
import type { AlignMode, Axis, SyncMode } from '../core/geometry.ts';
import type { ImageSource } from '../core/image-source.ts';
import type { Metrics } from '../core/metrics.ts';
import { type Locale, getLocale } from '../i18n/index.ts';
import { Store } from '../core/store.ts';

export type PanelStatus = 'empty' | 'idle' | 'encoding' | 'ready' | 'error';
export type ResultQuality = 'proxy' | 'full';

export interface EncodeResult {
  readonly bytes: ArrayBuffer;
  readonly size: number;
  readonly decoded: ImageData;
  readonly encodeMs: number;
  readonly decodeMs: number;
  readonly quality: ResultQuality;
  readonly width: number;
  readonly height: number;
}

export type ViewMode = 'result' | 'diff';

export interface PanelState {
  readonly id: string;
  readonly sourceId: string;
  readonly formatId: string;
  readonly params: Readonly<Record<string, ParamValue>>;
  readonly result: EncodeResult | null;
  readonly status: PanelStatus;
  readonly error?: string;
  /**
   * `load` — the codec bundle never arrived; retrying is the cure.
   * `capacity` — the codec ran out of room on a frame this size; nothing the
   * user can change will help, so no retry is offered.
   */
  readonly errorKind?: 'load' | 'codec' | 'capacity';
  readonly metrics: Metrics | null;
  /** `|result - reference|` at gain 1; amplification is applied at draw time. */
  readonly diff: ImageData | null;
  /** Bumped whenever `result` is replaced, so renderers can drop their caches. */
  readonly revision: number;
}

/** Messages are stored as a key plus values, so they follow a locale switch. */
export interface Notice {
  readonly id: number;
  readonly kind: 'info' | 'warn' | 'error';
  readonly key: string;
  readonly vars?: Readonly<Record<string, string | number>>;
  /**
   * A choice offered alongside the message. `id` is what the app acts on,
   * `label` is a message key. A notice that only informs has none.
   */
  readonly action?: { readonly id: string; readonly label: string };
}

export interface AppState {
  readonly locale: Locale;
  readonly sources: readonly ImageSource[];
  readonly panels: readonly PanelState[];
  /** Panel whose controls are on screen on narrow layouts. */
  readonly activePanel: number;
  readonly sync: SyncMode;
  readonly align: AlignMode;
  readonly axisOverride: Axis | null;
  readonly axis: Axis;
  readonly splits: readonly number[];
  /** Space held down: every panel shows the first panel's content. */
  readonly flip: boolean;
  readonly detailsOpen: boolean;
  readonly viewMode: ViewMode;
  /** Amplification of the difference map, applied as a draw-time filter. */
  readonly diffGain: number;
  readonly devMode: boolean;
  readonly loading: string | null;
  readonly notices: readonly Notice[];
  readonly crossOriginIsolated: boolean;
  /** Encoding at proxy resolution because the source is very large. */
  readonly proxyOnly: boolean;
}

/** v1 ships two panels, but nothing below assumes the number two. */
export const PANEL_COUNT = 2;

let panelSeq = 0;
let noticeSeq = 0;

export function makePanel(sourceId: string, formatId: string): PanelState {
  panelSeq += 1;
  const codec = findCodec(formatId);
  return {
    id: `panel${panelSeq}`,
    sourceId,
    formatId,
    params: codec ? defaultParams(codec.params) : {},
    result: null,
    status: sourceId ? 'idle' : 'empty',
    metrics: null,
    diff: null,
    revision: 0,
  };
}

export function initialState(devMode: boolean): AppState {
  // Both panels open on the original. Starting the second one on a format
  // means every load pays for an encode nobody asked for before anything can
  // be looked at — and on a large frame that is the slowest thing the tool
  // does. Picking a format is one click, and it is the user's click.
  const panels = [makePanel('', REFERENCE_FORMAT), makePanel('', REFERENCE_FORMAT)];
  return {
    locale: getLocale(),
    sources: [],
    panels,
    activePanel: 1,
    sync: 'mirror',
    align: 'contain',
    axisOverride: null,
    axis: 'x',
    splits: panels.map(() => 1 / panels.length),
    flip: false,
    detailsOpen: false,
    viewMode: 'result',
    diffGain: 4,
    devMode,
    loading: null,
    notices: [],
    crossOriginIsolated: typeof globalThis.crossOriginIsolated === 'boolean' ? globalThis.crossOriginIsolated : false,
    proxyOnly: false,
  };
}

export type AppStore = Store<AppState>;

export function createStore(devMode: boolean): AppStore {
  return new Store<AppState>(initialState(devMode));
}

export function notice(
  kind: Notice['kind'],
  key: string,
  vars?: Readonly<Record<string, string | number>>,
  action?: Notice['action'],
): Notice {
  noticeSeq += 1;
  return { id: noticeSeq, kind, key, vars, action };
}

export function panelSource(state: AppState, panel: PanelState): ImageSource | undefined {
  return state.sources.find((s) => s.id === panel.sourceId);
}

/**
 * True when the panels hold frames of different pixel dimensions. Alignment
 * only means anything then, so the control is hidden the rest of the time.
 */
export function sourcesDiffer(state: AppState): boolean {
  const sizes = state.panels
    .map((panel) => panelSource(state, panel))
    .filter((source): source is ImageSource => !!source)
    .map((source) => `${source.width}x${source.height}`);
  return new Set(sizes).size > 1;
}

export function updatePanel(
  state: AppState,
  index: number,
  patch: Partial<PanelState> | ((p: PanelState) => Partial<PanelState>),
): PanelState[] {
  return state.panels.map((panel, i) => {
    if (i !== index) return panel;
    const delta = typeof patch === 'function' ? patch(panel) : patch;
    return { ...panel, ...delta };
  });
}
