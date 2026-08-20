import { DEFAULT_FORMAT, REFERENCE_FORMAT, findCodec } from '../codecs/registry.ts';
import { type ParamValue, defaultParams } from '../codecs/types.ts';
import type { AlignMode, Axis, SyncMode } from '../core/geometry.ts';
import type { ImageSource } from '../core/image-source.ts';
import type { Metrics } from '../core/metrics.ts';
import { Store } from '../core/store.ts';

export type Mode = 'codec' | 'photo';
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
  readonly metrics: Metrics | null;
  /** `|result - reference|` at gain 1; amplification is applied at draw time. */
  readonly diff: ImageData | null;
  /** Bumped whenever `result` is replaced, so renderers can drop their caches. */
  readonly revision: number;
}

export interface Notice {
  readonly id: number;
  readonly kind: 'info' | 'warn' | 'error';
  readonly text: string;
}

export interface AppState {
  readonly mode: Mode;
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
  readonly zoomLabel: string;
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
  const panels = [makePanel('', REFERENCE_FORMAT), makePanel('', DEFAULT_FORMAT)];
  return {
    mode: 'codec',
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
    zoomLabel: 'вписать',
  };
}

export type AppStore = Store<AppState>;

export function createStore(devMode: boolean): AppStore {
  return new Store<AppState>(initialState(devMode));
}

export function notice(kind: Notice['kind'], text: string): Notice {
  noticeSeq += 1;
  return { id: noticeSeq, kind, text };
}

/** Source a panel compares against: shared in codec mode, its own in photo mode. */
export function referenceSourceFor(state: AppState, panelIndex: number): ImageSource | undefined {
  const panel = state.panels[panelIndex];
  if (!panel) return undefined;
  return state.sources.find((s) => s.id === panel.sourceId);
}

export function panelSource(state: AppState, panel: PanelState): ImageSource | undefined {
  return state.sources.find((s) => s.id === panel.sourceId);
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
