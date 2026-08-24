import { type CodecAdapter, bool, loadCodec, num, throwIfAborted } from './types.ts';

/**
 * libjxl. Option names from node_modules/@jsquash/jxl/codec/enc/jxl_enc.d.ts.
 *
 * The 0..100 here is *not* JPEG's scale, and the difference is large enough to
 * mislead. Inside the encoder the number becomes a Butteraugli distance:
 *
 *   distance = 0.1 + (100 − quality) × 0.09        (for quality ≥ 30)
 *
 * Distance is measured in just-noticeable differences, and libjxl calls `-d 1`
 * — quality 90 — visually lossless. Squoosh's default of 75 is distance 2.35,
 * over twice the threshold at which loss becomes visible: fine texture goes,
 * and the file lands near a quarter of the original while JPEG at the same
 * number is still around a half. That reads as a broken slider rather than as
 * a different scale, so this opens at libjxl's own default instead.
 */
export const adapter: CodecAdapter = {
  id: 'jxl',
  label: 'JPEG XL',
  mime: 'image/jxl',
  extension: 'jxl',
  lossless: 'optional',
  note: 'libjxl',
  params: [
    {
      kind: 'range',
      key: 'quality',
      label: 'param.quality',
      min: 0,
      max: 100,
      step: 1,
      default: 90,
      hint: 'param.quality.jxlHint',
      enabledWhen: (p) => p['lossless'] !== true,
    },
    {
      kind: 'toggle',
      key: 'lossless',
      label: 'param.lossless',
      default: false,
      hint: 'param.lossless.jxlHint',
    },
    {
      kind: 'range',
      key: 'effort',
      label: 'param.effort',
      min: 1,
      max: 9,
      step: 1,
      default: 7,
      hint: 'param.effort.jxlHint',
    },
    { kind: 'toggle', key: 'progressive', label: 'param.progressive', default: false },
  ],

  async encode(image, params, signal) {
    throwIfAborted(signal);
    const { default: encode } = await loadCodec('JPEG XL', () => import('@jsquash/jxl/encode'));
    throwIfAborted(signal);
    const lossless = bool(params, 'lossless', false);
    return encode(image, {
      quality: lossless ? 100 : num(params, 'quality', 75),
      lossless,
      effort: num(params, 'effort', 7),
      progressive: bool(params, 'progressive', false),
    });
  },

  async decode(bytes, signal) {
    throwIfAborted(signal);
    const { default: decode } = await loadCodec('JPEG XL', () => import('@jsquash/jxl/decode'));
    throwIfAborted(signal);
    return decode(bytes);
  },

  isLossless: (p) => bool(p, 'lossless', false),
};
