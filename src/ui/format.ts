import { t } from '../i18n/index.ts';

/** Formatting helpers. Every number in the interface goes through here. */

const NBSP = ' ';

/** Units live in the catalogue, so a locale can move them or change the space. */
function unit(key: string, value: string): string {
  return t(key, { value }).replace(' ', NBSP);
}

export function bytes(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value < 1024) return unit('unit.bytes', String(value));
  if (value < 1024 * 1024) return unit('unit.kilobytes', (value / 1024).toFixed(value < 10 * 1024 ? 1 : 0));
  return unit('unit.megabytes', (value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 2 : 1));
}

export function percent(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value >= 100) return `${value.toFixed(0)}%`;
  if (value >= 10) return `${value.toFixed(1)}%`;
  return `${value.toFixed(2)}%`;
}

export function psnr(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (!Number.isFinite(value)) return '∞';
  return unit('unit.decibels', value.toFixed(2));
}

export function ssim(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(4);
}

export function ms(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value >= 1000) return unit('unit.seconds', (value / 1000).toFixed(2));
  return unit('unit.milliseconds', value.toFixed(0));
}

export function bpp(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(3)}${NBSP}bpp` : '—';
}

export function magnification(scale: number): string {
  if (!Number.isFinite(scale) || scale <= 0) return '—';
  if (scale >= 1) return `${scale < 10 ? scale.toFixed(scale % 1 === 0 ? 0 : 1) : scale.toFixed(0)}:1`;
  return `${Math.round(scale * 100)}%`;
}

export function dimensions(width: number, height: number): string {
  return `${width}${NBSP}×${NBSP}${height}`;
}

export function megapixels(width: number, height: number): string {
  return unit('unit.megapixels', ((width * height) / 1e6).toFixed(1));
}
