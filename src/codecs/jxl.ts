import { type CodecAdapter, bool, loadCodec, num, throwIfAborted } from './types.ts';

/**
 * libjxl. Option names from node_modules/@jsquash/jxl/codec/enc/jxl_enc.d.ts.
 * `quality` is mapped to Butteraugli distance inside the codec wrapper, so the
 * 0..100 scale here stays comparable with the other formats.
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
      default: 75,
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
