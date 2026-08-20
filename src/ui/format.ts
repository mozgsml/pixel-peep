/** Formatting helpers. Every number in the interface goes through here. */

const nbsp = ' ';

export function bytes(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value < 1024) return `${value}${nbsp}Б`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)}${nbsp}КБ`;
  return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 2 : 1)}${nbsp}МБ`;
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
  return `${value.toFixed(2)}${nbsp}дБ`;
}

export function ssim(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(4);
}

export function ms(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value >= 1000) return `${(value / 1000).toFixed(2)}${nbsp}с`;
  return `${value.toFixed(0)}${nbsp}мс`;
}

export function bpp(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(3)}${nbsp}bpp` : '—';
}

export function magnification(scale: number): string {
  if (!Number.isFinite(scale) || scale <= 0) return '—';
  if (scale >= 1) return `${scale < 10 ? scale.toFixed(scale % 1 === 0 ? 0 : 1) : scale.toFixed(0)}:1`;
  return `${Math.round(scale * 100)}%`;
}

export function dimensions(width: number, height: number): string {
  return `${width}${nbsp}×${nbsp}${height}`;
}

export function megapixels(width: number, height: number): string {
  return `${((width * height) / 1e6).toFixed(1)}${nbsp}Мп`;
}
