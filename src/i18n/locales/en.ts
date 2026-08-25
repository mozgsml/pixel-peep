/**
 * English message catalogue — the source of truth.
 *
 * Adding a string: put it here first, then translate it in the other files in
 * this directory. A locale is allowed to be incomplete; anything missing falls
 * back to the English text below, so a partial translation never breaks the
 * interface.
 *
 * Placeholders are `{name}` and are substituted by `t()`.
 */
export const en = {
  'app.title': 'Pixel Peep — image codec comparison',
  'app.description':
    'Compare image compression formats by eye: two versions of one frame, precise zoom, flip test. Everything runs in the browser.',
  'app.hint': 'Space — flip test · double click — 1:1 · 0 / 1 — fit / 100%',
  'brand.name': 'Pixel Peep',

  'toolbar.open': 'Open…',
  'toolbar.openTitle': 'Load a photo into every panel',
  'toolbar.zoom': 'Zoom',
  'toolbar.zoomIn': 'Zoom in',
  'toolbar.zoomOut': 'Zoom out',
  'toolbar.fit': 'Fit',
  'toolbar.fitTitle': 'Key 0',
  'toolbar.actual': '1:1',
  'toolbar.actualTitle': 'Key 1',
  'toolbar.github': 'Source on GitHub',

  'toolbar.group.view': 'View',
  'toolbar.group.pan': 'Pan',
  'toolbar.group.align': 'Align',
  'toolbar.group.layout': 'Layout',
  'toolbar.group.language': 'Language',

  'toolbar.sync.label': 'Pan synchronisation',
  'toolbar.sync.mirror': 'Mirror',
  'toolbar.sync.mirrorTitle': 'The same fragment shown twice',
  'toolbar.sync.continuous': 'Continue',
  'toolbar.sync.continuousTitle': 'The next panel continues the previous one',

  'toolbar.align.label': 'Alignment for differing sizes',
  'toolbar.align.contain': 'Fit',
  'toolbar.align.containTitle': 'Whole frame inside the panel',
  'toolbar.align.width': 'Width',
  'toolbar.align.widthTitle': 'Match by width — for frames of different aspect ratio',
  'toolbar.align.height': 'Height',
  'toolbar.align.heightTitle': 'Match by height — for frames of different aspect ratio',

  'toolbar.axis.label': 'Panel layout',
  'toolbar.axis.auto': 'Auto',
  'toolbar.axis.autoTitle': 'Follow screen orientation',
  'toolbar.axis.x': '▮▮',
  'toolbar.axis.xTitle': 'Panels side by side',
  'toolbar.axis.y': '▬',
  'toolbar.axis.yTitle': 'Panels stacked',

  'toolbar.view.label': 'What to show',
  'toolbar.view.result': 'Result',
  'toolbar.view.resultTitle': 'The decoded encoding result',
  'toolbar.view.diff': 'Difference',
  'toolbar.view.diffTitle': '|result − original|, amplified',
  'toolbar.gain.label': 'Difference amplification',

  'panel.format': 'Format',
  'panel.source': 'Photo',
  'panel.sourceTitle': 'Which photo this panel shows',
  'panel.load': 'Load…',
  'panel.loadTitle': 'Load a photo into this panel only',
  'panel.aria.panel': 'Comparison panel',
  'panel.aria.empty': 'Panel without an image',
  'panel.aria.image': '{format}, {name}, {width}×{height}',

  'panel.metric.size': 'Size',
  'panel.metric.ratio': 'Of original',
  'panel.metric.psnr': 'PSNR',
  'panel.psnrTooltip':
    'PSNR correlates poorly with perception: a frame shifted slightly in brightness scores low, a blurred one scores high. Judge with your eyes; the metric is only a hint.',
  'panel.details': 'Details',
  'panel.download': 'Save',
  'panel.downloadTitle': 'Download the encoded file',
  'panel.downloadOriginal': 'Download the original file',

  'panel.badge.preview': 'preview',
  'panel.badge.flip': 'flip',

  'panel.overlay.drop': 'Drop a file here',
  'panel.overlay.errorTitle': 'The codec failed',
  'panel.overlay.loadErrorTitle': 'The codec did not download',
  'panel.overlay.errorHint': 'Try different parameters or another format.',
  'panel.overlay.loadErrorHint': 'The codec is downloaded the first time you use it. This looks like a network problem rather than a bad file — retrying usually works.',
  'panel.overlay.errorUnknown': 'Unknown error',
  'panel.overlay.retry': 'Retry',
  'panel.overlay.busy': 'Encoding…',
  'panel.outOfFrame': 'The continuation is outside the frame — drag the picture, zoom in, or switch to “Mirror”',
  'panel.interpolated': 'Preview at reduced resolution — these enlarged pixels are interpolation, not the codec\u2019s own',

  'panel.detail.frameSize': 'Frame size',
  'panel.detail.bpp': 'bpp',
  'panel.detail.encode': 'Encoding',
  'panel.detail.decode': 'Decoding',
  'panel.detail.resolution': 'Resolution',
  'panel.detail.proxy': 'proxy {size}',
  'panel.detail.ssim': 'SSIM',
  'panel.detail.mse': 'MSE',

  'params.empty': 'This format has no parameters',

  'empty.title': 'How far can you compress',
  'empty.body':
    'Drop a photo into the window — or open one with the button. Files are never uploaded anywhere; all encoding happens right in the browser.',
  'empty.open': 'Choose a file',
  'empty.formats': 'Supported: {list}',
  'empty.demoLabel': 'Or start with a test target',

  'notice.dismiss': 'Dismiss',
  'notice.coi':
    'COOP/COEP headers are not set: the page is not isolated, so wasm runs without threads or SIMD. AVIF and JPEG XL will encode many times slower.',
  'notice.proxyOnly':
    'A {megapixels} Mpx frame — working on the {width}×{height} proxy so we do not run out of memory.',
  'notice.unsupported': '{message}. Supported: {list}.',
  'notice.largeImage':
    'A {megapixels} Mpx image — encoding at full size can take minutes and may not fit in memory on mobile. Proxy mode is on.',

  'layout.splitter': 'Panel divider',
  'layout.splitterHint': 'Drag to resize · double click to reset',

  'loading.decoding': 'Decoding {name}…',

  'codec.original.label': 'Original',
  'codec.original.note': 'The source file, not re-encoded',
  'codec.png.note': 'oxipng — the control format, PSNR = ∞',
  'codec.debugBlur.note': 'Dummy codec: proof that a format is one file to add',

  'param.quality': 'Quality',
  'param.subsampling': 'Chroma',
  'param.subsampling.hint':
    '4:4:4 keeps full colour resolution — visible on hard coloured edges',
  'param.progressive': 'Progressive',
  'param.lossless': 'Lossless',
  'param.lossless.jxlHint':
    'The encoder is lossless, but the libjxl wasm decoder rounds through float: a handful of samples out of thousands can differ by ±1, so PSNR will not read ∞',
  'param.effort': 'Effort',
  'param.quality.jxlHint':
    'Not JPEG\u2019s scale. libjxl turns this into a Butteraugli distance — 90 is distance 1.0, which it calls '
    + 'visually lossless; 75 is 2.35, over twice that. The same number means a much smaller file here.',
  'param.effort.jxlHint': 'libjxl effort: 1 — instant and loose, 9 — slow and dense',
  'param.effort.avifHint': 'Higher is markedly slower. 10 can take minutes at full size',
  'param.effort.webpHint': 'Higher is slower and denser',
  'param.sharpYuv.hint':
    '0 — off. Preprocessing that simplifies the data while staying visually identical',
  'param.optimisation': 'Optimisation',
  'param.optimisation.hint': 'Affects only size and time; the pixels do not change',
  'param.radius': 'Radius',
  'param.levels': 'Levels',
  'param.levels.hint': 'Quantisation before RLE — that is where the “file size” comes from',

  'demo.target': 'Target',
  'demo.gradient': 'Gradient',
  'demo.texture': 'Texture',

  'error.unknownFormat': 'Unknown format: {id}',
  'error.noPixels': 'The codec returned no pixels',
  'error.noContext': '2D context is unavailable',
  'error.unrecognisedFile': 'File format not recognised: {name}',
  'error.decodeFailed': 'The browser could not decode {label}: {message}',
  'error.heicNoImages': 'HEIC: the file contains no images',
  'error.heicDecode': 'HEIC: decoding failed',
  'error.avifEmpty': 'AVIF: the decoder returned an empty result',
  'error.codecDownload': 'Could not download the {codec} codec',
  'error.workerFailed': 'Worker error',
  'error.poolStopped': 'Worker pool stopped',

  'unit.bytes': '{value} B',
  'unit.kilobytes': '{value} kB',
  'unit.megabytes': '{value} MB',
  'unit.decibels': '{value} dB',
  'unit.milliseconds': '{value} ms',
  'unit.seconds': '{value} s',
  'unit.megapixels': '{value} Mpx',
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
