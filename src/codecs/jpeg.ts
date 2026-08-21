import { type CodecAdapter, bool, num, str, throwIfAborted } from './types.ts';

/**
 * MozJPEG. Option names taken from
 * node_modules/@jsquash/jpeg/codec/enc/mozjpeg_enc.d.ts.
 *
 * `chroma_subsample` is only honoured when `auto_subsample` is off:
 * 1 = 4:4:4 (no chroma decimation), 2 = 4:2:0.
 */
export const adapter: CodecAdapter = {
  id: 'jpeg',
  label: 'JPEG',
  mime: 'image/jpeg',
  extension: 'jpg',
  lossless: false,
  note: 'mozjpeg',
  params: [
    { kind: 'range', key: 'quality', label: 'param.quality', min: 1, max: 100, step: 1, default: 80 },
    {
      kind: 'select',
      key: 'subsampling',
      label: 'param.subsampling',
      options: [
        { value: '420', label: '4:2:0' },
        { value: '444', label: '4:4:4' },
      ],
      default: '420',
      hint: 'param.subsampling.hint',
    },
    { kind: 'toggle', key: 'progressive', label: 'param.progressive', default: true },
  ],

  async encode(image, params, signal) {
    throwIfAborted(signal);
    const { default: encode } = await import('@jsquash/jpeg/encode');
    throwIfAborted(signal);
    return encode(image, {
      quality: num(params, 'quality', 80),
      progressive: bool(params, 'progressive', true),
      auto_subsample: false,
      chroma_subsample: str(params, 'subsampling', '420') === '444' ? 1 : 2,
    });
  },

  async decode(bytes, signal) {
    throwIfAborted(signal);
    const { default: decode } = await import('@jsquash/jpeg/decode');
    throwIfAborted(signal);
    return decode(bytes);
  },

  isLossless: () => false,
};
