import { type CodecAdapter, throwIfAborted } from './types.ts';

/**
 * Pseudo-format: hands back the source bytes and the source pixels untouched.
 * Its panel shows the reference, so metrics against it are meaningless and the
 * interface hides them; the reported size is the size of the file on disk.
 *
 * encode/decode are never called by the pipeline for this id — the source is
 * used directly — but they are implemented so the adapter contract holds and
 * the shared round-trip test can run against it like any other codec.
 */
export const adapter: CodecAdapter = {
  id: 'original',
  label: 'codec.original.label',
  mime: 'application/octet-stream',
  extension: 'bin',
  lossless: true,
  note: 'codec.original.note',
  params: [],

  async encode(image, _params, signal) {
    throwIfAborted(signal);
    const copy = new Uint8ClampedArray(image.data);
    const header = new Uint32Array([0x4f524947, image.width, image.height]);
    const out = new Uint8Array(12 + copy.byteLength);
    out.set(new Uint8Array(header.buffer), 0);
    out.set(new Uint8Array(copy.buffer, copy.byteOffset, copy.byteLength), 12);
    return out.buffer;
  },

  async decode(bytes, signal) {
    throwIfAborted(signal);
    const header = new Uint32Array(bytes, 0, 3);
    const width = header[1]!;
    const height = header[2]!;
    const data = new Uint8ClampedArray(bytes.slice(12));
    return new ImageData(data, width, height);
  },

  isLossless: () => true,
};
