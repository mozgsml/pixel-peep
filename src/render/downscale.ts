/**
 * Multi-pass downsampling and mip pyramids.
 *
 * A single-pass browser resize from 6000 px to 900 px aliases badly, and then
 * what you are comparing is the resampler, not the codec. Halving repeatedly
 * keeps every step within the 2x window the built-in filter handles well.
 */

export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
export type AnyContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

const hasOffscreen = typeof OffscreenCanvas !== 'undefined';

export function createCanvas(width: number, height: number): AnyCanvas {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (hasOffscreen) return new OffscreenCanvas(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

export function context2d(canvas: AnyCanvas): AnyContext {
  const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: false }) as AnyContext | null;
  if (!ctx) throw new Error('2D-контекст недоступен');
  return ctx;
}

/** One `putImageData`, once. Every later frame is a `drawImage` of this. */
export function canvasFromImageData(image: ImageData): AnyCanvas {
  const canvas = createCanvas(image.width, image.height);
  context2d(canvas).putImageData(image, 0, 0);
  return canvas;
}

function halve(src: AnyCanvas): AnyCanvas {
  const width = Math.max(1, Math.floor(src.width / 2));
  const height = Math.max(1, Math.floor(src.height / 2));
  const out = createCanvas(width, height);
  const ctx = context2d(out);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src as CanvasImageSource, 0, 0, src.width, src.height, 0, 0, width, height);
  return out;
}

/**
 * Lazily built chain of halved copies. Level `n` is `1 / 2^n` of full size.
 *
 * Total extra cost is bounded by 1/3 of the base image, and it is what makes
 * dragging a 24 Mpx photo at fit-scale stay at 60 fps.
 */
export class MipPyramid {
  #levels: AnyCanvas[];
  readonly width: number;
  readonly height: number;

  constructor(base: AnyCanvas) {
    this.#levels = [base];
    this.width = base.width;
    this.height = base.height;
  }

  static fromImageData(image: ImageData): MipPyramid {
    return new MipPyramid(canvasFromImageData(image));
  }

  get base(): AnyCanvas {
    return this.#levels[0]!;
  }

  /** Pixels currently held by the pyramid, for the memory budget. */
  get pixels(): number {
    return this.#levels.reduce((sum, c) => sum + c.width * c.height, 0);
  }

  /**
   * Coarsest level that is still at least as detailed as `scale` demands, so
   * the final `drawImage` never shrinks by more than 2x.
   */
  levelForScale(scale: number): number {
    if (!Number.isFinite(scale) || scale >= 1) return 0;
    return Math.max(0, Math.floor(Math.log2(1 / scale)));
  }

  level(index: number): AnyCanvas {
    const wanted = Math.max(0, index);
    while (this.#levels.length <= wanted) {
      const prev = this.#levels[this.#levels.length - 1]!;
      if (prev.width <= 1 && prev.height <= 1) break;
      this.#levels.push(halve(prev));
    }
    return this.#levels[Math.min(wanted, this.#levels.length - 1)]!;
  }

  /** Ratio of the returned level to full size (1, 0.5, 0.25, ...). */
  levelScale(index: number): number {
    const level = this.level(index);
    return level.width / this.width;
  }

  /** Frees everything except the base level. */
  trim(): void {
    for (const level of this.#levels.slice(1)) release(level);
    this.#levels = [this.#levels[0]!];
  }

  dispose(): void {
    for (const level of this.#levels) release(level);
    this.#levels = [];
  }
}

function release(canvas: AnyCanvas): void {
  // Zeroing the backing store is the only portable way to hand the memory back
  // before the GC gets round to it.
  canvas.width = 0;
  canvas.height = 0;
}

/** Quality downscale of raw pixels, used to build the working proxy. */
export function downscaleImageData(image: ImageData, targetWidth: number, targetHeight: number): ImageData {
  const tw = Math.max(1, Math.round(targetWidth));
  const th = Math.max(1, Math.round(targetHeight));
  if (tw >= image.width && th >= image.height) return image;

  let current = canvasFromImageData(image);
  const owned: AnyCanvas[] = [current];

  while (current.width / 2 >= tw && current.height / 2 >= th) {
    current = halve(current);
    owned.push(current);
  }

  const out = createCanvas(tw, th);
  const ctx = context2d(out);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(current as CanvasImageSource, 0, 0, current.width, current.height, 0, 0, tw, th);
  const result = ctx.getImageData(0, 0, tw, th);

  for (const canvas of owned) release(canvas);
  release(out);
  return result;
}
