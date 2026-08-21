import { context2d, createCanvas } from '../render/downscale.ts';
import type { DemoImage } from '../ui/empty-state.ts';

/**
 * Locally generated test targets, so the tool is usable before the user has
 * found a file. Each one leans on a different codec weakness: hard edges and
 * chroma, smooth gradients and banding, dense high-frequency texture.
 *
 * Generated rather than shipped: the repository stays small and nothing is
 * fetched at runtime.
 */

function make(name: string, label: string, paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): DemoImage {
  return {
    name,
    label,
    draw(width, height) {
      const canvas = createCanvas(width, height);
      const ctx = context2d(canvas) as CanvasRenderingContext2D;
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, width, height);
      paint(ctx, width, height);
      const image = ctx.getImageData(0, 0, width, height);
      canvas.width = 0;
      canvas.height = 0;
      return image;
    },
  };
}

/** Deterministic noise so a demo image is byte-identical between reloads. */
function hashNoise(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const target = make('target.png', 'demo.target', (ctx, w, h) => {
  ctx.fillStyle = '#0f0f0f';
  ctx.fillRect(0, 0, w, h);

  // Radial spokes: the classic resolution wedge.
  const cx = w * 0.28;
  const cy = h * 0.5;
  const r = Math.min(w, h) * 0.38;
  for (let i = 0; i < 72; i++) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, (i / 36) * Math.PI, ((i + 1) / 36) * Math.PI);
    ctx.closePath();
    ctx.fillStyle = i % 2 === 0 ? '#f2f2f2' : '#101010';
    ctx.fill();
  }

  // Saturated edges — where 4:2:0 chroma decimation shows up first.
  const colours = ['#e02020', '#20a020', '#2040e0', '#e0c020', '#c020c0', '#20c0c0'];
  const bw = w * 0.42 / colours.length;
  colours.forEach((colour, i) => {
    ctx.fillStyle = colour;
    ctx.fillRect(w * 0.55 + i * bw, h * 0.08, bw, h * 0.26);
  });

  // Fine checkerboards at several pitches.
  for (let block = 0; block < 4; block++) {
    const pitch = 1 << block;
    const x0 = w * 0.55 + block * (w * 0.105);
    const y0 = h * 0.4;
    const size = Math.min(w * 0.095, h * 0.22);
    for (let y = 0; y < size; y += pitch) {
      for (let x = 0; x < size; x += pitch) {
        ctx.fillStyle = ((x / pitch + y / pitch) | 0) % 2 === 0 ? '#ffffff' : '#000000';
        ctx.fillRect(x0 + x, y0 + y, pitch, pitch);
      }
    }
  }

  // Grey ramp for banding.
  const ramp = ctx.createLinearGradient(w * 0.55, 0, w * 0.98, 0);
  ramp.addColorStop(0, '#000');
  ramp.addColorStop(1, '#fff');
  ctx.fillStyle = ramp;
  ctx.fillRect(w * 0.55, h * 0.68, w * 0.43, h * 0.24);

  ctx.fillStyle = '#e8e8e8';
  ctx.font = `${Math.round(h * 0.035)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText('pixel peep · test target', w * 0.05, h * 0.95);
});

const gradient = make('gradient.png', 'demo.gradient', (ctx, w, h) => {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#12213f');
  sky.addColorStop(0.45, '#3d5a86');
  sky.addColorStop(0.72, '#c98f63');
  sky.addColorStop(1, '#2a1b16');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const glow = ctx.createRadialGradient(w * 0.7, h * 0.66, 0, w * 0.7, h * 0.66, Math.min(w, h) * 0.5);
  glow.addColorStop(0, 'rgba(255,220,170,0.85)');
  glow.addColorStop(1, 'rgba(255,220,170,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // A whisper of grain: without it the gradient bands even before encoding.
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const n = (hashNoise(x, y, 7) - 0.5) * 3;
      data[o] = Math.max(0, Math.min(255, data[o]! + n));
      data[o + 1] = Math.max(0, Math.min(255, data[o + 1]! + n));
      data[o + 2] = Math.max(0, Math.min(255, data[o + 2]! + n));
    }
  }
  ctx.putImageData(image, 0, 0);
});

const texture = make('texture.png', 'demo.texture', (ctx, w, h) => {
  const image = ctx.createImageData(w, h);
  const data = image.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const fine = hashNoise(x, y, 3);
      const coarse = hashNoise(x >> 4, y >> 4, 11);
      const weave = 0.5 + 0.5 * Math.sin(x * 0.6) * Math.sin(y * 0.6);
      const base = 40 + coarse * 150 + weave * 30;
      data[o] = base + fine * 45;
      data[o + 1] = base * 0.92 + fine * 40;
      data[o + 2] = base * 0.78 + fine * 35;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = Math.max(1, h * 0.004);
  for (let i = 0; i < 9; i++) {
    ctx.beginPath();
    ctx.moveTo(w * 0.05, h * (0.1 + i * 0.1));
    ctx.bezierCurveTo(w * 0.35, h * (0.05 + i * 0.1), w * 0.65, h * (0.15 + i * 0.1), w * 0.95, h * (0.1 + i * 0.1));
    ctx.stroke();
  }
});

export const DEMOS: readonly DemoImage[] = [target, gradient, texture];

export const DEMO_SIZE = { width: 1800, height: 1200 } as const;

/** Renders a demo target and hands it back as a real PNG file. */
export async function demoToFile(demo: DemoImage): Promise<File> {
  const image = demo.draw(DEMO_SIZE.width, DEMO_SIZE.height);
  const canvas = createCanvas(image.width, image.height);
  context2d(canvas).putImageData(image, 0, 0);

  const blob =
    canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob({ type: 'image/png' })
      : await new Promise<Blob>((resolve, reject) =>
          (canvas as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
        );

  canvas.width = 0;
  canvas.height = 0;
  return new File([blob], demo.name, { type: 'image/png' });
}
