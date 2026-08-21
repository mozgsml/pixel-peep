import { type CodecAdapter, bool, num, throwIfAborted } from './types.ts';

/**
 * libwebp. Option names from node_modules/@jsquash/webp/codec/enc/webp_enc.d.ts;
 * the numeric flags are libwebp's own 0/1 integers, not booleans.
 *
 * `exact: 1` is mandatory in lossless mode. Without it libwebp is free to
 * rewrite RGB under fully transparent pixels, which silently corrupts the
 * metrics of anything with an alpha channel.
 *
 * libwebp's `near_lossless` is a strength where 100 means "off"; the control is
 * inverted so that 0 reads as "off" to a human.
 */
export const adapter: CodecAdapter = {
  id: 'webp',
  label: 'WebP',
  mime: 'image/webp',
  extension: 'webp',
  lossless: 'optional',
  note: 'libwebp',
  params: [
    {
      kind: 'range',
      key: 'quality',
      label: 'param.quality',
      min: 0,
      max: 100,
      step: 1,
      default: 80,
      enabledWhen: (p) => p['lossless'] !== true,
    },
    { kind: 'toggle', key: 'lossless', label: 'param.lossless', default: false },
    {
      kind: 'range',
      key: 'nearLossless',
      label: 'Near-lossless',
      min: 0,
      max: 100,
      step: 5,
      default: 0,
      hint: 'param.sharpYuv.hint',
      enabledWhen: (p) => p['lossless'] === true,
    },
    {
      kind: 'range',
      key: 'method',
      label: 'param.effort',
      min: 0,
      max: 6,
      step: 1,
      default: 4,
      hint: 'param.effort.webpHint',
    },
  ],

  async encode(image, params, signal) {
    throwIfAborted(signal);
    const { default: encode } = await import('@jsquash/webp/encode');
    throwIfAborted(signal);
    const lossless = bool(params, 'lossless', false);
    const near = num(params, 'nearLossless', 0);
    return encode(image, {
      quality: num(params, 'quality', 80),
      method: num(params, 'method', 4),
      lossless: lossless ? 1 : 0,
      exact: lossless ? 1 : 0,
      near_lossless: lossless && near > 0 ? 100 - near : 100,
    });
  },

  async decode(bytes, signal) {
    throwIfAborted(signal);
    const { default: decode } = await import('@jsquash/webp/decode');
    throwIfAborted(signal);
    return decode(bytes);
  },

  isLossless: (p) => bool(p, 'lossless', false) && num(p, 'nearLossless', 0) === 0,
};
