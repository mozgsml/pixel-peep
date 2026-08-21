import { t } from '../i18n/index.ts';
import { type PanelBox, type PanelGeometry, drawRects } from '../core/geometry.ts';
import { LruCache } from '../core/cache.ts';
import { type AnyContext, MipPyramid } from './downscale.ts';

/** Same neutral grey as the interface — a coloured surround shifts perception. */
export const SURROUND = '#2e2e2e';

/**
 * Uploaded textures, shared between panels.
 *
 * Ownership sits here rather than in the renderer for one reason: the flip test
 * shows panel 0's pixels inside every panel, and rebuilding a mip pyramid on
 * every press of the space bar would defeat the whole point of the flip test.
 */
export class TextureStore {
  #cache: LruCache<{ pixels: number; pyramid: MipPyramid }>;

  // A ceiling, not a working set: `retain()` drops everything not on screen
  // after each frame, so this only bounds a pathological case.
  constructor(budgetPixels = 60_000_000) {
    this.#cache = new LruCache(budgetPixels, (entry) => entry.pyramid.dispose());
  }

  get(key: string, image: ImageData | null): MipPyramid | null {
    if (!image) return null;
    const existing = this.#cache.get(key);
    if (existing) return existing.pyramid;
    const pyramid = MipPyramid.fromImageData(image);
    // Pyramid levels add at most a third on top of the base image.
    this.#cache.set(key, { pixels: Math.round(image.width * image.height * 1.34), pyramid });
    return pyramid;
  }

  /** Keeps only the keys still on screen. */
  retain(keys: Iterable<string>): void {
    const keep = new Set(keys);
    this.#cache.prune((key) => !keep.has(key));
  }

  clear(): void {
    this.#cache.clear();
  }
}

/**
 * Draws one panel.
 *
 * The decoded pixels go into an offscreen canvas exactly once; every frame
 * afterwards is a single `drawImage` with a transform. `putImageData` per frame
 * would cap the whole thing at a few frames a second on a 24 Mpx photo.
 */
export class PanelRenderer {
  readonly canvas: HTMLCanvasElement;
  #ctx: AnyContext;
  #dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) throw new Error(t('error.noContext'));
    this.#ctx = ctx;
  }

  /** Backing store in device pixels, CSS box in CSS pixels. 1:1 must be true. */
  resize(cssWidth: number, cssHeight: number, dpr: number): boolean {
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    const changed = this.canvas.width !== w || this.canvas.height !== h;
    if (changed) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.#dpr = dpr;
    return changed;
  }

  clear(): void {
    const ctx = this.#ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = SURROUND;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * `box.image` is the *logical* image size — the size of the original frame.
   * The texture may be smaller (a proxy-resolution preview); coordinates are
   * rescaled accordingly so panels stay aligned no matter what is loaded.
   */
  draw(pyramid: MipPyramid | null, box: PanelBox, geom: PanelGeometry, filter = 'none'): void {
    this.clear();
    if (!pyramid) return;

    const rects = drawRects(box, geom);
    if (!rects) return;

    const ctx = this.#ctx;
    const dpr = this.#dpr;
    const texture = pyramid.width / Math.max(1, box.image.width);

    // Below 1:1 the pyramid guarantees the final step is never more than a 2x
    // reduction, which the built-in filter handles without aliasing.
    const level = pyramid.levelForScale((geom.scale * dpr) / texture);
    const source = pyramid.level(level);
    const ratio = source.width / Math.max(1, box.image.width);

    // Real pixels get no interpolation. A preview built from a proxy is
    // interpolated on purpose — pretending its enlarged pixels are the truth
    // would be worse than smoothing them.
    const actualPixels = geom.scale * dpr >= 1 && ratio >= 0.999;
    ctx.imageSmoothingEnabled = !actualPixels;
    if (!actualPixels) ctx.imageSmoothingQuality = 'high';

    // Difference-map amplification runs here rather than in the worker, so the
    // gain slider responds instantly instead of recomputing the whole map.
    ctx.filter = filter;

    ctx.drawImage(
      source as CanvasImageSource,
      rects.sx * ratio,
      rects.sy * ratio,
      Math.max(1, rects.sw * ratio),
      Math.max(1, rects.sh * ratio),
      rects.dx * dpr,
      rects.dy * dpr,
      rects.dw * dpr,
      rects.dh * dpr,
    );
    ctx.filter = 'none';
  }
}

/**
 * One `requestAnimationFrame` loop for every panel. Drawing panels on separate
 * frames makes them visibly drift apart while dragging.
 */
export class RenderLoop {
  #dirty = false;
  #running = false;
  #frame = 0;
  readonly #draw: () => void;

  constructor(draw: () => void) {
    this.#draw = draw;
  }

  invalidate(): void {
    this.#dirty = true;
    if (!this.#running) this.start();
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    const tick = () => {
      if (!this.#running) return;
      if (this.#dirty) {
        this.#dirty = false;
        this.#draw();
      }
      this.#frame = requestAnimationFrame(tick);
    };
    this.#frame = requestAnimationFrame(tick);
  }

  stop(): void {
    this.#running = false;
    cancelAnimationFrame(this.#frame);
  }
}
