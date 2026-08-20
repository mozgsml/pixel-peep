import { type CodecAdapter, bool, num, str, throwIfAborted } from './types.ts';

/**
 * libavif. Option names from node_modules/@jsquash/avif/codec/enc/avif_enc.d.ts
 * plus the `lossless` flag added by the @jsquash wrapper.
 *
 * `speed` is libaom's effort knob and runs the other way round from every other
 * codec here (0 = slowest/best), so the control is inverted into an "effort"
 * value that grows with quality of compression.
 *
 * `subsample`: 1 = 4:2:0, 3 = 4:4:4.
 */
export const adapter: CodecAdapter = {
  id: 'avif',
  label: 'AVIF',
  mime: 'image/avif',
  extension: 'avif',
  lossless: 'optional',
  note: 'libavif / AOM',
  params: [
    {
      kind: 'range',
      key: 'quality',
      label: 'Качество',
      min: 0,
      max: 100,
      step: 1,
      default: 50,
      enabledWhen: (p) => p['lossless'] !== true,
    },
    { kind: 'toggle', key: 'lossless', label: 'Без потерь', default: false },
    {
      kind: 'select',
      key: 'subsampling',
      label: 'Цветность',
      options: [
        { value: '420', label: '4:2:0' },
        { value: '444', label: '4:4:4' },
      ],
      default: '420',
      enabledWhen: (p) => p['lossless'] !== true,
    },
    {
      kind: 'range',
      key: 'effort',
      label: 'Усилие',
      min: 0,
      max: 10,
      step: 1,
      default: 4,
      hint: 'Больше — заметно медленнее. 10 может занять минуты на полном размере',
    },
  ],

  async encode(image, params, signal) {
    throwIfAborted(signal);
    const { default: encode } = await import('@jsquash/avif/encode');
    throwIfAborted(signal);
    const lossless = bool(params, 'lossless', false);
    return encode(image, {
      quality: num(params, 'quality', 50),
      lossless,
      // libaom speed: 0 slowest .. 10 fastest.
      speed: 10 - num(params, 'effort', 4),
      subsample: str(params, 'subsampling', '420') === '444' ? 3 : 1,
      bitDepth: 8,
    });
  },

  async decode(bytes, signal) {
    throwIfAborted(signal);
    const { default: decode } = await import('@jsquash/avif/decode');
    throwIfAborted(signal);
    const result = await decode(bytes);
    if (!result) throw new Error('AVIF: декодер вернул пустой результат');
    return result;
  },

  isLossless: (p) => bool(p, 'lossless', false),
};
