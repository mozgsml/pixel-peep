import {
  type AlignMode,
  type Axis,
  type LayoutOptions,
  type PanelBox,
  type PanelGeometry,
  type SyncMode,
  type ViewState,
  clampLeaderCentre,
  layoutGeometry,
  panelFits,
  spreadFrameCentre,
  panBy,
  scaleForZoom,
  zoomAtCursor,
  zoomForScale,
} from './geometry.ts';

/**
 * Shared zoom/pan state for every panel. DOM-free on purpose: the interface
 * layer feeds it pointer deltas and reads geometry back out.
 */
export class Viewport {
  #view: ViewState = { z: 0, u: 0.5, v: 0.5 };
  #boxes: PanelBox[] = [];
  #sync: SyncMode = 'mirror';
  #align: AlignMode = 'contain';
  #axis: Axis = 'x';
  #gap = 0;
  #listeners = new Set<() => void>();

  /**
   * `z` may exceed 1: past 1:1 the same geometric curve keeps working, which is
   * exactly what you want when hunting for ringing around an edge.
   */
  static readonly MIN_Z = -0.35;
  static readonly MAX_Z = 3;

  get view(): ViewState {
    return this.#view;
  }

  get options(): LayoutOptions {
    return { sync: this.#sync, align: this.#align, axis: this.#axis, gap: this.#gap };
  }

  get sync(): SyncMode {
    return this.#sync;
  }

  get align(): AlignMode {
    return this.#align;
  }

  get axis(): Axis {
    return this.#axis;
  }

  get boxes(): readonly PanelBox[] {
    return this.#boxes;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    for (const listener of [...this.#listeners]) listener();
  }

  setBoxes(boxes: PanelBox[]): void {
    this.#boxes = boxes;
    this.#reclamp();
    this.#emit();
  }

  setSync(sync: SyncMode): void {
    if (this.#sync === sync) return;
    this.#sync = sync;
    // Entering `continuous` at a zoom where one panel already holds the whole
    // frame would otherwise leave the rest of the row on empty background —
    // the one arrangement of the mode that shows nothing. Share the frame out
    // instead, so switching lands on a view that reads across the divider.
    if (sync === 'continuous') {
      const spread = spreadFrameCentre(this.#boxes, this.#view, this.options);
      this.#view = { z: this.#view.z, u: spread.u, v: spread.v };
    }
    this.#reclamp();
    this.#emit();
  }

  setAlign(align: AlignMode): void {
    if (this.#align === align) return;
    this.#align = align;
    this.#reclamp();
    this.#emit();
  }

  setAxis(axis: Axis): void {
    if (this.#axis === axis) return;
    this.#axis = axis;
    this.#emit();
  }

  /** Splitter thickness in CSS pixels; `continuous` skips the image behind it. */
  setGap(gap: number): void {
    if (this.#gap === gap) return;
    this.#gap = gap;
    this.#emit();
  }

  geometry(): PanelGeometry[] {
    return layoutGeometry(this.#boxes, this.#view, this.options);
  }

  /**
   * At `z = 1` alignment is ignored and every panel is strictly 1:1 — the whole
   * point of the position being 1 on the slider.
   */
  effectiveAlign(): AlignMode {
    return this.#align;
  }

  zoomTo(z: number, index = 0, cursor: { x: number; y: number } | null = null): void {
    const nextZ = Math.min(Viewport.MAX_Z, Math.max(Viewport.MIN_Z, z));
    if (this.#boxes.length === 0) {
      this.#view = { ...this.#view, z: nextZ };
      this.#emit();
      return;
    }
    this.#view = zoomAtCursor({
      boxes: this.#boxes,
      view: this.#view,
      opts: this.options,
      index,
      cursor,
      nextZ,
    });
    this.#emit();
  }

  zoomBy(delta: number, index = 0, cursor: { x: number; y: number } | null = null): void {
    this.zoomTo(this.#view.z + delta, index, cursor);
  }

  pan(dx: number, dy: number, index = 0): void {
    if (this.#boxes.length === 0) return;
    this.#view = panBy({ boxes: this.#boxes, view: this.#view, opts: this.options, index, dx, dy });
    this.#emit();
  }

  /** Pan in fractions of the panel, for arrow keys. */
  panByFraction(fx: number, fy: number, index = 0): void {
    const box = this.#boxes[index] ?? this.#boxes[0];
    if (!box) return;
    this.pan(fx * box.panel.width, fy * box.panel.height, index);
  }

  reset(): void {
    this.#view = { z: 0, u: 0.5, v: 0.5 };
    this.#emit();
  }

  /** Double-click behaviour: toggle between "whole image" and "actual pixels". */
  toggleFit(index = 0, cursor: { x: number; y: number } | null = null): void {
    const target = this.#view.z > 0.5 ? 0 : 1;
    this.zoomTo(target, index, cursor);
  }

  /** Current magnification of a panel, as a plain multiplier. */
  scaleOf(index: number): number {
    if (!this.#boxes[index]) return 1;
    return scaleForZoom(panelFits(this.#boxes, this.#align)[index]!, this.#view.z);
  }

  /** `z` that would show panel `index` at an exact magnification. */
  zoomForMagnification(index: number, magnification: number): number {
    if (!this.#boxes[index]) return this.#view.z;
    return zoomForScale(panelFits(this.#boxes, this.#align)[index]!, magnification);
  }

  #reclamp(): void {
    if (!this.#boxes[0]) return;
    const point = clampLeaderCentre(this.#boxes, this.#view, this.options);
    this.#view = { z: this.#view.z, u: point.u, v: point.v };
  }
}
