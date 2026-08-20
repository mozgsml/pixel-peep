import { type CodecAdapter, bool, num, throwIfAborted } from './types.ts';

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
      label: 'Качество',
      min: 0,
      max: 100,
      step: 1,
      default: 75,
      enabledWhen: (p) => p['lossless'] !== true,
    },
    {
      kind: 'toggle',
      key: 'lossless',
      label: 'Без потерь',
      default: false,
      hint: 'Кодер работает без потерь, но wasm-декодер libjxl округляет через float: единицы отсчётов из тысяч могут отличаться на ±1, поэтому PSNR не покажет ∞',
    },
    {
      kind: 'range',
      key: 'effort',
      label: 'Усилие',
      min: 1,
      max: 9,
      step: 1,
      default: 7,
      hint: 'libjxl effort: 1 — мгновенно и рыхло, 9 — долго и плотно',
    },
    { kind: 'toggle', key: 'progressive', label: 'Прогрессивный', default: false },
  ],

  async encode(image, params, signal) {
    throwIfAborted(signal);
    const { default: encode } = await import('@jsquash/jxl/encode');
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
    const { default: decode } = await import('@jsquash/jxl/decode');
    throwIfAborted(signal);
    return decode(bytes);
  },

  isLossless: (p) => bool(p, 'lossless', false),
};
