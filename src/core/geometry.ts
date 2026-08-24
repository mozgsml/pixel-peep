/**
 * Pure zoom/pan mathematics. No DOM, no state, no side effects.
 *
 * Vocabulary
 *  - image space: pixels of the decoded image, `W x H`
 *  - panel space: CSS pixels of the viewport that shows it, `PW x PH`
 *  - normalised space: `(u, v)` in [0,1]^2, the image point sitting at the
 *    centre of the panel. Storing percentages instead of pixels is what makes
 *    synchronising differently sized images free.
 */

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** How `z = 0` frames an image inside its panel. */
export type AlignMode = 'contain' | 'width' | 'height';

/** How panels other than the leader derive their centre. */
export type SyncMode = 'mirror' | 'continuous';

/** Which way the panels are laid out; drives `continuous` panning. */
export type Axis = 'x' | 'y';

export interface Point {
  readonly u: number;
  readonly v: number;
}

export interface ViewState {
  /** Global zoom parameter in [0, 1] (values outside are allowed and useful). */
  readonly z: number;
  /** Centre of the *leader* panel in normalised image coordinates. */
  readonly u: number;
  readonly v: number;
}

export interface PanelBox {
  /** Image size in pixels. */
  readonly image: Size;
  /** Panel size in CSS pixels. */
  readonly panel: Size;
}

export interface PanelGeometry {
  /** Scale at `z = 0`. */
  readonly fit: number;
  /** Image pixels per CSS pixel at the current `z`. */
  readonly scale: number;
  /** Visible fraction of the image along each axis. */
  readonly visW: number;
  readonly visH: number;
  /** Centre of this panel in normalised image coordinates. */
  readonly u: number;
  readonly v: number;
}

const EPS = 1e-9;

/** Guards against zero/NaN sizes so the formulas never produce NaN. */
function safe(n: number): number {
  return Number.isFinite(n) && n > EPS ? n : EPS;
}

export function clamp(value: number, min: number, max: number): number {
  if (max < min) return (min + max) / 2;
  return value < min ? min : value > max ? max : value;
}

/**
 * Scale at which the whole image is visible, per alignment mode.
 * `fit > 1` (image smaller than the panel) is legal and needs no special case:
 * the zoom curve simply runs the other way.
 */
export function fitScale(box: PanelBox, align: AlignMode = 'contain'): number {
  const sw = safe(box.panel.width) / safe(box.image.width);
  const sh = safe(box.panel.height) / safe(box.image.height);
  switch (align) {
    case 'width':
      return sw;
    case 'height':
      return sh;
    case 'contain':
    default:
      return Math.min(sw, sh);
  }
}

/**
 * Fit for every panel — the one function the rest of the code should ask.
 *
 * On top of {@link fitScale} it applies a single rule: **panels holding the
 * same frame share one fit, the smallest of them.**
 *
 * Without it each panel fits independently, and dragging the divider then
 * changes the two fits by different amounts. A 4096×2304 photo in a 27/73
 * split puts the narrow panel's fit against the width and the wide panel's
 * against the height — the same photograph drawn 2.5× larger on one side than
 * on the other. Side-by-side comparison and the flip test both stop meaning
 * anything at that point, which is the entire product.
 *
 * The smallest fit rather than the leader's, so `z = 0` still shows the whole
 * frame in *every* panel and never crops one of them.
 *
 * Panels holding frames of different sizes keep their own fit. That is what
 * the alignment control exists for, and a shared scale there would shrink the
 * smaller frame for no reason.
 */
export function panelFits(boxes: readonly PanelBox[], align: AlignMode = 'contain'): number[] {
  const fits = boxes.map((box) => fitScale(box, align));
  const first = boxes[0];
  if (!first || boxes.length < 2) return fits;

  const sameFrame = boxes.every(
    (box) => box.image.width === first.image.width && box.image.height === first.image.height,
  );
  if (!sameFrame) return fits;

  const shared = Math.min(...fits);
  return fits.map(() => shared);
}

/**
 * Geometric (not linear) interpolation between `fit` and `1:1`.
 *
 *   scale(0) = fit,  scale(1) = 1
 *
 * Linear interpolation makes the wheel feel lumpy: equal wheel deltas must
 * produce equal *ratios* of magnification, not equal differences.
 */
export function scaleForZoom(fit: number, z: number): number {
  return Math.pow(safe(fit), 1 - z);
}

/** Inverse of {@link scaleForZoom}: which `z` yields this scale. */
export function zoomForScale(fit: number, scale: number): number {
  const lf = Math.log(safe(fit));
  if (Math.abs(lf) < EPS) return 0;
  return 1 - Math.log(safe(scale)) / lf;
}

/** Fraction of the image visible along each axis at a given scale. */
export function visibleSpan(box: PanelBox, scale: number): { visW: number; visH: number } {
  return {
    visW: safe(box.panel.width) / (safe(box.image.width) * safe(scale)),
    visH: safe(box.panel.height) / (safe(box.image.height) * safe(scale)),
  };
}

/**
 * Keep the visible window inside the image.
 *
 * When the image is larger than the panel (`vis < 1`) the window is held
 * inside it, so the panel is never part background.
 *
 * When the image already fits (`vis >= 1`) it used to be pinned to the centre,
 * which made a small image impossible to move — and in `continuous` mode it
 * then never reached the next panel at all. It is free to move instead, bounded
 * so that the centre of the panel stays somewhere inside the image: the frame
 * can be nudged aside but never pushed off screen entirely.
 */
export function clampCentre(centre: number, vis: number): number {
  if (vis >= 1) return clamp(centre, 0, 1);
  return clamp(centre, vis / 2, 1 - vis / 2);
}

export function clampPoint(p: Point, visW: number, visH: number): Point {
  return { u: clampCentre(p.u, visW), v: clampCentre(p.v, visH) };
}

/**
 * Normalised image point under a cursor position expressed in panel CSS pixels.
 */
export function pointAtCursor(
  cursor: { x: number; y: number },
  box: PanelBox,
  geom: Pick<PanelGeometry, 'u' | 'v' | 'visW' | 'visH'>,
): Point {
  const fx = cursor.x / safe(box.panel.width) - 0.5;
  const fy = cursor.y / safe(box.panel.height) - 0.5;
  return { u: geom.u + fx * geom.visW, v: geom.v + fy * geom.visH };
}

/**
 * Centre that puts `target` back under `cursor`. The inverse of
 * {@link pointAtCursor}, and the whole trick behind anchored zooming.
 */
export function centreForAnchor(
  target: Point,
  cursor: { x: number; y: number },
  box: PanelBox,
  visW: number,
  visH: number,
): Point {
  const fx = cursor.x / safe(box.panel.width) - 0.5;
  const fy = cursor.y / safe(box.panel.height) - 0.5;
  return { u: target.u - fx * visW, v: target.v - fy * visH };
}

/** Full geometry of a single panel for a given leader centre. */
export function panelGeometry(
  box: PanelBox,
  z: number,
  centre: Point,
  align: AlignMode = 'contain',
): PanelGeometry {
  const fit = fitScale(box, align);
  const scale = scaleForZoom(fit, z);
  const { visW, visH } = visibleSpan(box, scale);
  return { fit, scale, visW, visH, u: centre.u, v: centre.v };
}

export interface LayoutOptions {
  readonly sync: SyncMode;
  readonly align: AlignMode;
  readonly axis: Axis;
  /**
   * Width of the splitter between two panels, in CSS pixels. `continuous`
   * has to skip the image hidden behind it, or the seam is off by exactly
   * those pixels — visibly so once the divider has been dragged.
   */
  readonly gap?: number;
}

/**
 * Geometry for every panel at once.
 *
 * `mirror`     — every panel shares the leader's centre.
 * `continuous` — panel `i+1` starts where panel `i` ended, along the layout
 *                axis: `u_{i+1} = u_i + visW_i/2 + visW_{i+1}/2`.
 *
 * Clamping is applied to the leader only; trailing panels are allowed to run
 * off the edge (they then simply show the edge), which is what "continuation"
 * means.
 */
export function layoutGeometry(
  boxes: readonly PanelBox[],
  view: ViewState,
  opts: LayoutOptions,
): PanelGeometry[] {
  if (boxes.length === 0) return [];

  const fits = panelFits(boxes, opts.align);
  const leaderCentre = clampLeaderCentre(boxes, view, opts);

  const out: PanelGeometry[] = [];
  let prev: PanelGeometry | null = null;

  for (const [index, box] of boxes.entries()) {
    const fit = fits[index]!;
    const scale = scaleForZoom(fit, view.z);
    const { visW, visH } = visibleSpan(box, scale);

    let centre: Point;
    if (prev === null) {
      centre = leaderCentre;
    } else if (opts.sync === 'continuous') {
      const gap = gapSpan(box, scale, opts);
      centre =
        opts.axis === 'x'
          ? { u: prev.u + prev.visW / 2 + gap + visW / 2, v: prev.v }
          : { u: prev.u, v: prev.v + prev.visH / 2 + gap + visH / 2 };
    } else {
      centre = leaderCentre;
    }

    const geom: PanelGeometry = { fit, scale, visW, visH, u: centre.u, v: centre.v };
    out.push(geom);
    prev = geom;
  }

  return out;
}

/**
 * Where the leader's centre is allowed to sit.
 *
 * `mirror` — the leader's window is the only window, so the ordinary rule in
 * {@link clampCentre} applies.
 *
 * `continuous` — the panels are one long viewport laid end to end, and the pan
 * range belongs to the row rather than to the first panel. Clamping the leader
 * alone stopped the drag dead while the trailing panels were still empty: with
 * the whole frame visible in panel 0 the continuation began past the frame's
 * end, and no reachable centre brought it back. The row can now be moved until
 * the frame reaches either end of it, which is what "continue" is supposed to
 * let you follow.
 */
export function clampLeaderCentre(
  boxes: readonly PanelBox[],
  view: ViewState,
  opts: LayoutOptions,
): Point {
  const leaderBox = boxes[0];
  if (!leaderBox) return { u: view.u, v: view.v };

  const fits = panelFits(boxes, opts.align);
  const leaderVis = visibleSpan(leaderBox, scaleForZoom(fits[0]!, view.z));

  if (opts.sync !== 'continuous' || boxes.length < 2) {
    return clampPoint({ u: view.u, v: view.v }, leaderVis.visW, leaderVis.visH);
  }

  // Length of the whole row along the layout axis, in fractions of the image,
  // splitters included.
  let row = 0;
  for (const [index, box] of boxes.entries()) {
    const scale = scaleForZoom(fits[index]!, view.z);
    const vis = visibleSpan(box, scale);
    if (index > 0) row += gapSpan(box, scale, opts);
    row += opts.axis === 'x' ? vis.visW : vis.visH;
  }

  const leaderSpan = opts.axis === 'x' ? leaderVis.visW : leaderVis.visH;
  const centre = opts.axis === 'x' ? view.u : view.v;
  // Bound the row's leading edge so that row and frame overlap along the whole
  // of whichever is shorter: a row narrower than the frame stays inside it, a
  // row wider than the frame keeps the frame inside itself. `1 - row` is
  // negative in the first case and positive in the second, so one pair of
  // bounds covers both. No part of the frame can fall off the ends of the row.
  const start = clamp(centre - leaderSpan / 2, Math.min(0, 1 - row), Math.max(0, 1 - row));
  const along = start + leaderSpan / 2;

  return opts.axis === 'x'
    ? { u: along, v: clampCentre(view.v, leaderVis.visH) }
    : { u: clampCentre(view.u, leaderVis.visW), v: along };
}

/** The splitter, measured in fractions of this panel's image along the axis. */
function gapSpan(box: PanelBox, scale: number, opts: LayoutOptions): number {
  const gap = opts.gap ?? 0;
  if (gap <= 0) return 0;
  const extent = opts.axis === 'x' ? box.image.width : box.image.height;
  return gap / (safe(extent) * safe(scale));
}

/**
 * Turn a desired centre for panel `index` back into a leader centre, so that
 * interaction on any panel drives the whole set. Inverse of the accumulation
 * done by {@link layoutGeometry}.
 */
export function leaderCentreFor(
  boxes: readonly PanelBox[],
  view: ViewState,
  opts: LayoutOptions,
  index: number,
  desired: Point,
): Point {
  if (index <= 0 || opts.sync !== 'continuous') return desired;

  const fits = panelFits(boxes, opts.align);
  let offsetU = 0;
  let offsetV = 0;
  let prevVis: { visW: number; visH: number } | null = null;

  for (let i = 0; i <= index; i++) {
    const box = boxes[i];
    if (!box) break;
    const scale = scaleForZoom(fits[i]!, view.z);
    const vis = visibleSpan(box, scale);
    if (prevVis) {
      const gap = gapSpan(box, scale, opts);
      if (opts.axis === 'x') offsetU += prevVis.visW / 2 + gap + vis.visW / 2;
      else offsetV += prevVis.visH / 2 + gap + vis.visH / 2;
    }
    prevVis = vis;
  }

  return { u: desired.u - offsetU, v: desired.v - offsetV };
}

export interface ZoomRequest {
  readonly boxes: readonly PanelBox[];
  readonly view: ViewState;
  readonly opts: LayoutOptions;
  /** Panel the pointer is over; also the panel the anchor belongs to. */
  readonly index: number;
  /** Cursor position in that panel's CSS pixels. `null` anchors at its centre. */
  readonly cursor: { x: number; y: number } | null;
  readonly nextZ: number;
}

/**
 * Zoom while keeping the image point under the cursor pinned.
 *
 * 1. before changing z, resolve the normalised point under the cursor
 * 2. apply the new z, recompute scale and visible span
 * 3. choose the centre that puts that point back under the cursor
 * 4. translate back to a leader centre (step 4 of the spec is then handled by
 *    `layoutGeometry`, which re-derives the other panels)
 * 5. clamp
 */
export function zoomAtCursor(req: ZoomRequest): ViewState {
  const { boxes, view, opts, index, cursor, nextZ } = req;
  const box = boxes[index] ?? boxes[0];
  if (!box) return { ...view, z: nextZ };

  const before = layoutGeometry(boxes, view, opts)[index];
  if (!before) return { ...view, z: nextZ };

  const anchorCursor = cursor ?? { x: box.panel.width / 2, y: box.panel.height / 2 };
  const target = pointAtCursor(anchorCursor, box, before);

  const nextView: ViewState = { ...view, z: nextZ };
  const fit = panelFits(boxes, opts.align)[index] ?? fitScale(box, opts.align);
  const scale = scaleForZoom(fit, nextZ);
  const { visW, visH } = visibleSpan(box, scale);

  const desired = centreForAnchor(target, anchorCursor, box, visW, visH);
  const leader = leaderCentreFor(boxes, nextView, opts, index, desired);
  const clamped = clampLeaderCentre(boxes, { ...nextView, u: leader.u, v: leader.v }, opts);

  return { z: nextZ, u: clamped.u, v: clamped.v };
}

export interface PanRequest {
  readonly boxes: readonly PanelBox[];
  readonly view: ViewState;
  readonly opts: LayoutOptions;
  readonly index: number;
  /** Pointer movement in panel CSS pixels. */
  readonly dx: number;
  readonly dy: number;
}

/** Drag panning: move the image with the pointer, one panel drives the rest. */
export function panBy(req: PanRequest): ViewState {
  const { boxes, view, opts, index, dx, dy } = req;
  const box = boxes[index] ?? boxes[0];
  if (!box) return view;

  const geom = layoutGeometry(boxes, view, opts)[index];
  if (!geom) return view;

  const desired: Point = {
    u: geom.u - (dx / safe(box.panel.width)) * geom.visW,
    v: geom.v - (dy / safe(box.panel.height)) * geom.visH,
  };

  const leader = leaderCentreFor(boxes, view, opts, index, desired);
  const clamped = clampLeaderCentre(boxes, { ...view, u: leader.u, v: leader.v }, opts);

  return { z: view.z, u: clamped.u, v: clamped.v };
}

/**
 * Source/destination rectangles for `drawImage`.
 *
 * The source rectangle is clipped to the image, and the destination shrinks by
 * the same proportion, so an image smaller than its panel is letterboxed
 * against the panel background instead of being stretched.
 */
export interface DrawRects {
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  readonly dx: number;
  readonly dy: number;
  readonly dw: number;
  readonly dh: number;
}

export function drawRects(box: PanelBox, geom: PanelGeometry): DrawRects | null {
  const W = box.image.width;
  const H = box.image.height;
  const scale = safe(geom.scale);

  const sw = box.panel.width / scale;
  const sh = box.panel.height / scale;
  const sx = geom.u * W - sw / 2;
  const sy = geom.v * H - sh / 2;

  const cx0 = Math.max(0, sx);
  const cy0 = Math.max(0, sy);
  const cx1 = Math.min(W, sx + sw);
  const cy1 = Math.min(H, sy + sh);
  if (cx1 <= cx0 || cy1 <= cy0) return null;

  return {
    sx: cx0,
    sy: cy0,
    sw: cx1 - cx0,
    sh: cy1 - cy0,
    dx: (cx0 - sx) * scale,
    dy: (cy0 - sy) * scale,
    dw: (cx1 - cx0) * scale,
    dh: (cy1 - cy0) * scale,
  };
}

/**
 * Panel rectangles for `n` panels: split by columns in landscape, by rows in
 * portrait. `split` holds the fractional sizes (n-1 draggable separators give
 * n fractions, summing to 1).
 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function splitStage(stage: Size, count: number, axis: Axis, fractions: readonly number[]): Rect[] {
  if (count <= 0) return [];
  const total = fractions.slice(0, count).reduce((a, b) => a + b, 0);
  const norm =
    total > EPS && fractions.length >= count
      ? fractions.slice(0, count).map((f) => f / total)
      : new Array<number>(count).fill(1 / count);

  const rects: Rect[] = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const f = norm[i] ?? 1 / count;
    if (axis === 'x') {
      const w = stage.width * f;
      rects.push({ x: offset, y: 0, width: w, height: stage.height });
      offset += w;
    } else {
      const h = stage.height * f;
      rects.push({ x: 0, y: offset, width: stage.width, height: h });
      offset += h;
    }
  }
  return rects;
}
