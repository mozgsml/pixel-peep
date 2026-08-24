import type { Messages } from './en.ts';

/**
 * Russian translation.
 *
 * `Partial` on purpose: a key added to `en.ts` and not yet translated falls
 * back to English instead of breaking the build. Run `npm test` to see which
 * keys are still missing — the i18n test prints the coverage of every locale.
 */
export const ru: Partial<Messages> = {
  'app.title': 'Pixel Peep — сравнение кодеков',
  'app.description':
    'Сравнение форматов сжатия изображений глазами: два варианта одного кадра, точный зум, flip-тест. Всё считается в браузере.',
  'app.hint': 'Пробел — flip-тест · двойной клик — 1:1 · 0 / 1 — вписать / 100%',
  'brand.name': 'Pixel Peep',

  'toolbar.open': 'Открыть…',
  'toolbar.openTitle': 'Загрузить снимок во все панели',
  'toolbar.zoom': 'Масштаб',
  'toolbar.zoomIn': 'Увеличить',
  'toolbar.zoomOut': 'Уменьшить',
  'toolbar.fit': 'Вписать',
  'toolbar.fitTitle': 'Клавиша 0',
  'toolbar.actual': '1:1',
  'toolbar.actualTitle': 'Клавиша 1',
  'toolbar.github': 'Исходники на GitHub',

  'toolbar.group.view': 'Вид',
  'toolbar.group.pan': 'Панорама',
  'toolbar.group.align': 'Выравнивание',
  'toolbar.group.layout': 'Раскладка',
  'toolbar.group.language': 'Язык',

  'toolbar.sync.label': 'Синхронизация панорамы',
  'toolbar.sync.mirror': 'Зеркало',
  'toolbar.sync.mirrorTitle': 'Один фрагмент показан дважды',
  'toolbar.sync.continuous': 'Продолжение',
  'toolbar.sync.continuousTitle': 'Следующая панель продолжает предыдущую',

  'toolbar.align.label': 'Выравнивание разных размеров',
  'toolbar.align.contain': 'Вписать',
  'toolbar.align.containTitle': 'Кадр целиком внутри панели',
  'toolbar.align.width': 'Ширина',
  'toolbar.align.widthTitle': 'Совместить по ширине — для кадров разного соотношения сторон',
  'toolbar.align.height': 'Высота',
  'toolbar.align.heightTitle': 'Совместить по высоте — для кадров разного соотношения сторон',

  'toolbar.axis.label': 'Раскладка панелей',
  'toolbar.axis.auto': 'Авто',
  'toolbar.axis.autoTitle': 'По ориентации экрана',
  'toolbar.axis.x': '▮▮',
  'toolbar.axis.xTitle': 'Панели рядом',
  'toolbar.axis.y': '▬',
  'toolbar.axis.yTitle': 'Панели друг под другом',

  'toolbar.view.label': 'Что показывать',
  'toolbar.view.result': 'Результат',
  'toolbar.view.resultTitle': 'Декодированный результат кодирования',
  'toolbar.view.diff': 'Разница',
  'toolbar.view.diffTitle': '|результат − оригинал| с усилением',
  'toolbar.gain.label': 'Усиление разницы',

  'panel.format': 'Формат',
  'panel.source': 'Снимок',
  'panel.sourceTitle': 'Какой снимок показывает эта панель',
  'panel.load': 'Загрузить…',
  'panel.loadTitle': 'Загрузить снимок только в эту панель',
  'panel.aria.panel': 'Панель сравнения',
  'panel.aria.empty': 'Панель без изображения',
  'panel.aria.image': '{format}, {name}, {width}×{height}',

  'panel.metric.size': 'Размер',
  'panel.metric.ratio': 'От оригинала',
  'panel.metric.psnr': 'PSNR',
  'panel.psnrTooltip':
    'PSNR плохо коррелирует с восприятием: слегка сдвинутый по яркости кадр получит низкую оценку, а замыленный — высокую. Решение принимается глазами, метрика лишь подсказка.',
  'panel.details': 'Подробности',
  'panel.download': 'Сохранить',
  'panel.downloadTitle': 'Скачать закодированный файл',
  'panel.downloadOriginal': 'Скачать исходный файл',

  'panel.badge.preview': 'предпросмотр',
  'panel.badge.flip': 'flip',

  'panel.overlay.drop': 'Перетащите файл сюда',
  'panel.overlay.errorTitle': 'Кодек не справился',
  'panel.overlay.loadErrorTitle': 'Кодек не скачался',
  'panel.overlay.errorHint': 'Попробуйте другие параметры или другой формат.',
  'panel.overlay.loadErrorHint': 'Кодек скачивается при первом обращении к формату. Похоже на проблему с сетью, а не с файлом — обычно помогает повторная попытка.',
  'panel.overlay.errorUnknown': 'Неизвестная ошибка',
  'panel.overlay.retry': 'Повторить',
  'panel.overlay.busy': 'Кодирование…',
  'panel.outOfFrame': 'Область продолжения вне кадра — сдвиньте картинку, увеличьте масштаб или переключитесь на «Зеркало»',

  'panel.detail.frameSize': 'Размер кадра',
  'panel.detail.bpp': 'bpp',
  'panel.detail.encode': 'Кодирование',
  'panel.detail.decode': 'Декодирование',
  'panel.detail.resolution': 'Разрешение',
  'panel.detail.proxy': 'прокси {size}',
  'panel.detail.ssim': 'SSIM',
  'panel.detail.mse': 'MSE',

  'params.empty': 'У этого формата нет параметров',

  'empty.title': 'До какого качества можно сжимать',
  'empty.body':
    'Перетащите снимок в окно — или откройте его кнопкой. Файлы никуда не отправляются, всё кодирование идёт прямо в браузере.',
  'empty.open': 'Выбрать файл',
  'empty.formats': 'Поддерживаются: {list}',
  'empty.demoLabel': 'Или начните с тестовой мишени',

  'notice.dismiss': 'Скрыть',
  'notice.coi':
    'Заголовки COOP/COEP не настроены: страница не изолирована, wasm работает без потоков и SIMD. AVIF и JPEG XL будут кодироваться в разы медленнее.',
  'notice.proxyOnly':
    'Снимок {megapixels} Мп — работаем на прокси {width}×{height}, чтобы не упереться в память.',
  'notice.unsupported': '{message}. Поддерживаются: {list}.',
  'notice.largeImage':
    'Изображение {megapixels} Мп — кодирование в полном размере может занять минуты и не поместиться в память на мобильных. Включён режим работы на прокси.',

  'layout.splitter': 'Граница панелей',
  'layout.splitterHint': 'Тяните, чтобы изменить размер · двойной клик — сбросить',

  'loading.decoding': 'Декодирую {name}…',

  'codec.original.label': 'Оригинал',
  'codec.original.note': 'Исходный файл без перекодирования',
  'codec.png.note': 'oxipng — контрольный формат, PSNR = ∞',
  'codec.debugBlur.note': 'Фиктивный кодек: проверка того, что формат добавляется одним файлом',

  'param.quality': 'Качество',
  'param.subsampling': 'Цветность',
  'param.subsampling.hint': '4:4:4 сохраняет полное цветовое разрешение — заметно на резких цветных границах',
  'param.progressive': 'Прогрессивный',
  'param.lossless': 'Без потерь',
  'param.lossless.jxlHint':
    'Кодер работает без потерь, но wasm-декодер libjxl округляет через float: единицы отсчётов из тысяч могут отличаться на ±1, поэтому PSNR не покажет ∞',
  'param.effort': 'Усилие',
  'param.quality.jxlHint':
    'Это не шкала JPEG. libjxl переводит число в расстояние Butteraugli: 90 — это 1.0, что сам libjxl '
    + 'называет визуально неотличимым; 75 — это 2.35, вдвое больше. При одном и том же числе файл здесь заметно меньше.',
  'param.effort.jxlHint': 'libjxl effort: 1 — мгновенно и рыхло, 9 — долго и плотно',
  'param.effort.avifHint': 'Больше — заметно медленнее. 10 может занять минуты на полном размере',
  'param.effort.webpHint': 'Больше — медленнее и плотнее',
  'param.sharpYuv.hint': '0 — выключено. Предобработка, которая упрощает данные, оставаясь визуально идентичной',
  'param.optimisation': 'Оптимизация',
  'param.optimisation.hint': 'Влияет только на размер и время, пиксели не меняются',
  'param.radius': 'Радиус',
  'param.levels': 'Градаций',
  'param.levels.hint': 'Квантование перед RLE — отсюда берётся «размер файла»',

  'demo.target': 'Мишень',
  'demo.gradient': 'Градиент',
  'demo.texture': 'Текстура',

  'error.unknownFormat': 'Неизвестный формат: {id}',
  'error.noPixels': 'Кодек не вернул пиксели',
  'error.noContext': '2D-контекст недоступен',
  'error.unrecognisedFile': 'Формат файла не распознан: {name}',
  'error.decodeFailed': 'Браузер не смог декодировать {label}: {message}',
  'error.heicNoImages': 'HEIC: в файле нет изображений',
  'error.heicDecode': 'HEIC: ошибка декодирования',
  'error.avifEmpty': 'AVIF: декодер вернул пустой результат',
  'error.codecDownload': 'Не удалось скачать кодек {codec}',
  'error.workerFailed': 'Ошибка воркера',
  'error.poolStopped': 'Пул воркеров остановлен',

  'unit.bytes': '{value} Б',
  'unit.kilobytes': '{value} КБ',
  'unit.megabytes': '{value} МБ',
  'unit.decibels': '{value} дБ',
  'unit.milliseconds': '{value} мс',
  'unit.seconds': '{value} с',
  'unit.megapixels': '{value} Мп',
};
