import { type CodecAdapter, bool, num, throwIfAborted } from './types.ts';

/**
 * PNG via oxipng. Always mathematically lossless, so it is not a competitor
 * here — it is the control sample. PSNR against the original must come out as
 * `Infinity`; if it does not, the pipeline is broken, not the codec.
 */
export const adapter: CodecAdapter = {
  id: 'png',
  label: 'PNG',
  mime: 'image/png',
  extension: 'png',
  lossless: true,
  note: 'oxipng — контрольный формат, PSNR = ∞',
  params: [
    {
      kind: 'range',
      key: 'level',
      label: 'Оптимизация',
      min: 0,
      max: 6,
      step: 1,
      default: 2,
      hint: 'Влияет только на размер и время, пиксели не меняются',
    },
    { kind: 'toggle', key: 'interlace', label: 'Interlace', default: false },
  ],

  async encode(image, params, signal) {
    throwIfAborted(signal);
    const { default: optimise } = await import('@jsquash/oxipng/optimise');
    throwIfAborted(signal);
    return optimise(image, {
      level: num(params, 'level', 2),
      interlace: bool(params, 'interlace', false),
      optimiseAlpha: false,
    });
  },

  async decode(bytes, signal) {
    throwIfAborted(signal);
    const { default: decode } = await import('@jsquash/png/decode');
    throwIfAborted(signal);
    return decode(bytes);
  },

  isLossless: () => true,
};
