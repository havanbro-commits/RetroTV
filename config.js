/* ============================================================
   TUBE TV — конфигурация
   Всё, что стоит настраивать руками, живёт здесь.
   Координаты зон — в ПРОЦЕНТАХ от исходной картинки (1536×1024):
   x, y — левый верхний угол; w, h — ширина и высота.
   Нажмите D на сайте → режим калибровки → «Скопировать конфиг»
   и вставьте результат вместо блока zones ниже.
   ============================================================ */
window.TUBE_TV_CONFIG = {
  version: '0.9',
  image: { width: 1536, height: 1024 },

  /* Сцены. Время суток переключает торшер (timeCycle), погоду — клик по окну
     (weatherCycle). В дождь днём и на закате показывается сцена overcast.
     video — полная видео-петля сцены вместо картинки;
     windowVideo — видео только окна с тюлем (кладётся поверх зоны window),
     например 'assets/window-day.mp4'. Пока видео нет — картинка + ветер SVG-фильтром.
     sunset и overcast собраны цветокоррекцией из ваших картинок; если сгенерируете
     свои — просто замените файлы (композиция должна совпадать). */
  backgrounds: {
    day:      { image: 'assets/room-day.webp',      video: null, windowVideo: null },
    sunset:   { image: 'assets/room-sunset.webp',   video: null, windowVideo: null },
    evening:  { image: 'assets/room-evening.webp',  video: null, windowVideo: null },
    overcast: { image: 'assets/room-overcast.webp', video: null, windowVideo: null },   // морось
    storm:    { image: 'assets/room-storm.webp',    video: null, windowVideo: null },   // ливень
    night:    { image: 'assets/room-night.webp',    video: null, windowVideo: null },   // ночь: торшер погашен
  },
  startMode: 'day',                            // day | sunset | evening | night
  startWeather: 'clear',                       // clear | drizzle | downpour
  timeCycle: ['day', 'sunset', 'evening', 'night'],     // клик по торшеру
  weatherCycle: ['clear', 'drizzle', 'downpour'],   // клик по окну
  crossfadeMs: 2600,

  /* Солнце: карта пятен и лучей, вырезанная из дневной картинки, и куда она
     уезжает на закате (поворот ang° и растяжение sc вокруг окна px/py, сдвиг tx/ty).
     amb/sun/win — множители цвета комнаты в тени, солнечных пятен и окна на закате;
     mid — «золотой час» посередине. setMs — сколько садится солнце (торшер: день → закат). */
  sun: {
    map: 'assets/sunmap.webp',      // «старое» солнце дневной фотографии (его снимаем, когда считаем своё)
    /* Путь солнца на закате: высота e (градусы) и азимут a (от нормали окна в комнату).
       e0/a0 — днём, e1/a1 — низкое закатное солнце; drift — насколько ещё садится за driftSec секунд. */
    path: { e0: 45, e1: 5, a0: 22, a1: 38, drop: 12, drift: 0.2, driftSec: 240 },
    k: 5.6,          // яркость рассчитанных пятен (в единицах карты фото)
    gain: 1.0,       // общий множитель цвета солнца
    shafts: 0.16,    // лучи в воздухе
    amb: [0.60, 0.45, 0.40], win: [1.05, 0.62, 0.35],
    mid: { amb: [0.78, 0.66, 0.60], sun: [1.2, 0.88, 0.58], win: [1.05, 0.84, 0.62] },
    setMs: 9000, riseMs: 5000,
  },
  /* Геометрия комнаты для расчёта света: камера (фокус f, главная точка cx/cy в пикселях картинки,
     высота camH над полом, м), правая стена x = xr (м), балконный блок на ней.
     apertures — проёмы [z0, z1, h0, h1] (z — глубина, м, h — высота над полом, м);
     bars — перемычки рам: ['z', z, ширина, h0, h1] вертикальная, ['h', h, ширина, z0, z1] горизонтальная. */
  room: {
    f: 1540, cx: 768, cy: 630, camH: 0.56, xr: 1.1948, laceM: 0.62,
    geo: 'assets/geo.png', lace: 'assets/lace-t.webp',
    apertures: [[-3.95, -3.27, 0.10, 2.36], [-3.17, -2.25, 0.86, 2.36]],
    bars: [['h', 0.95, 0.09, -3.95, -3.27], ['h', 1.90, 0.06, -3.95, -3.27], ['z', -2.71, 0.07, 0.86, 2.36], ['h', 1.90, 0.07, -3.17, -2.25]],
  },
  night: { lamp: [1.0, 0.52, 0.2] },   // натриевый фонарь во дворе

  /* Крупный план для режима «сесть перед телевизором»: отдельный, более подробный кадр
     (1672×941). Он ложится поверх комнаты так, что его кинескоп совпадает с экраном
     в комнате: glass — стекло кинескопа на крупном плане (центр и полуоси, px),
     room — то же стекло на картинке комнаты. knobs — ручки на крупном плане: [x, y, радиус]. */
  closeup: {
    size: [1672, 941],
    glass: { cx: 717.5, cy: 452, a: 247.5, b: 195 },
    room:  { cx: 728,   cy: 446, a: 113.5, b: 87 },
    knobs: { channelKnob: [1058, 305, 33], volumeKnob: [1057, 410, 24], power: [1058, 670, 17] },
    images: { day: 'assets/closeup/close-day.webp', sunset: 'assets/closeup/close-sunset.webp',
              evening: 'assets/closeup/close-evening.webp', overcast: 'assets/closeup/close-overcast.webp',
              storm: 'assets/closeup/close-storm.webp', night: 'assets/closeup/close-night.webp' },
  },

  /* Кадрирование. focus — точка, которую стараемся держать в центре экрана,
     keepVisible — прямоугольник, который никогда не обрезается
     (на телефоне: телевизор + часть окна). */
  layout: {
    desktop: { focus: { x: 50, y: 47 }, keepVisible: { x: 2,  y: 12, w: 96, h: 60 } },
    mobile:  { focus: { x: 62, y: 44 }, keepVisible: { x: 33, y: 15, w: 58, h: 46 } },
    mobileMaxAspect: 1.0,    // ширина/высота окна ниже этого = «мобильная» раскладка
  },

  /* ---------- ЗОНЫ (в % от картинки) ---------- */
  zones: {
    screen:      { x: 39.91, y: 34.86, w: 14.91, h: 17.38 },
    tvBody:      { x: 38.28, y: 32.23, w: 20.96, h: 22.66 },
    drape:       { x: 80.70, y: 4.00,  w: 6.50,  h: 74.00 },
    power:       { x: 56.71, y: 51.86, w: 1.56,  h: 1.46  },
    channelKnob: { x: 56.38, y: 35.55, w: 2.08,  h: 3.03  },
    volumeKnob:  { x: 56.64, y: 40.33, w: 1.56,  h: 2.25  },
    lamp:        { x: 4.43,  y: 20.80, w: 12.96, h: 17.38 },
    window:      { x: 87.37, y: 0.00,  w: 12.63, h: 93.75 },
    siren:       { x: 0.00,  y: 0.00,  w: 100.0, h: 96.00 },
    dust:        { x: 0.00,  y: 0.00,  w: 100.0, h: 100.0 },
    glow:        { x: 16.28, y: 5.86,  w: 62.50, h: 80.08 },
    deer:        { x: 24.09, y: 28.32, w: 4.43,  h: 8.20  },
    brickGame:   { x: 68.29, y: 42.19, w: 4.04,  h: 7.62  },
    rubik:       { x: 73.63, y: 45.70, w: 2.86,  h: 4.10  },
    bear:        { x: 61.33, y: 50.59, w: 6.12,  h: 10.74 },
    cassette:    { x: 67.32, y: 53.52, w: 6.25,  h: 7.62  },
    figurine:    { x: 64.45, y: 19.04, w: 3.52,  h: 10.74 },
    teapot:      { x: 19.73, y: 38.48, w: 5.60,  h: 8.01  },
    sega:        { x: 75.20, y: 80.47, w: 16.67, h: 12.30 },
  },

  /* «Сесть перед телевизором»: камера наезжает так, чтобы зона tvBody
     занимала долю fill от экрана (по меньшей из сторон). Клавиша S, Esc — встать. */
  seat: { zone: 'tvBody', fill: 0.8, durationMs: 1500 },

  /* Видео «под стеклом» (RuTube и запасной режим архива): crt — сила накладок
     кинескопа (строки, маска, мерцание, отражение) 0…1; overscan — «заход» кадра
     за края стекла, как у настоящего кинескопа. */
  embed: { crt: 0.12, overscan: 1.06 },

  /* ---------- ПРИСТАВКА ----------
     Картриджи — свои игры (исходники в carts/src, собраны SGDK). Любой другой файл
     пользователь выбирает сам («Свой картридж…») или просто перетаскивает на страницу. */
  sega: {
    volume: 1.3,                         // громкость приставки в динамике телевизора (игры тише телеэфира)
    frame: [640, 480],                   // размер невидимой рамки эмулятора (кадр 4:3)
    accept: '.md,.bin,.gen,.smd,.68k,.sgd,.zip,.7z',
    carts: [
      { id: 'snake',  title: 'Змейка',           rom: 'carts/snake.bin',  label: 'assets/carts/snake.webp',
        desc: 'Двор, яблоки и золотая груша' },
      { id: 'bricks', title: 'Кирпичики',        rom: 'carts/bricks.bin', label: 'assets/carts/bricks.webp',
        desc: 'Выбей все кирпичи — дальше быстрее' },
      { id: 'patrol', title: 'Звёздный патруль', rom: 'carts/patrol.bin', label: 'assets/carts/patrol.webp',
        desc: 'Защити двор от тарелок' },
    ],
  },

  /* Форма кинескопа поверх зоны screen */
  screen: {
    radius: '10% / 13%',     // скругление углов (CSS border-radius)
    curvature: 0.045,        // бочкообразное искажение картинки
    resolution: [480, 360],  // внутреннее разрешение «эфира»
  },

  /* ---------- ТЕЛЕВИЗОР ---------- */
  tv: {
    powerOnMs: 1150,
    powerOffMs: 950,
    staticBurstMs: 380,
    whineHz: 15625,          // строчная частота PAL — тот самый писк кинескопа
    whineVolume: 0.004,
    defaultVolume: 0.55,     // 0…1, ручка громкости
    volumeStep: 0.05,
  },

  /* Каналы — в порядке переключения ручкой.
     type: 'archive' | 'rutube' | 'video' | 'morning' | 'testcard' | 'static'
     archive — записи Internet Archive (archive.org): видео идёт прямо с серверов архива
       в собственный плеер телевизора — без чужих кнопок и надписей, через шейдер кинескопа.
       items: { id: 'идентификатор записи', file: 'имя файла' } — file можно не писать,
       тогда возьмётся случайный ролик из записи.
     rutube — официальный плеер RuTube в «голом» режиме (без кнопок), items — ID роликов
       (из адреса rutube.ru/video/<ID>/).
     video — свои файлы: items: ['assets/video/1.mp4', …].
     live: true — включаемся «с середины», как будто передача шла и без нас.
     Каждое переключение на канал — следующая запись. */
  channels: [
    { type: 'archive', label: 'АРХИВ', live: true, items: [
      { id: '90stvintros_russia_ort', file: 'Russia, ORT, openings.mp4' },                     // ОРТ: заставки передач 90-х
      { id: '80stvshows_soviet_union_ct_ussr', file: 'Soviet Union, CT USSR, openings.mp4' },  // ЦТ СССР: заставки 80-х
      { id: 'Vremya_24.02.89', file: 'VREMYA_24.02.89.mp4' },                                  // программа «Время», 24 февраля 1989
      { id: '90stvshows_russia_tv6', file: 'Russia, TV-6, openings.mp4' },                    // ТВ-6: заставки
    ] },
    /* file — имя файла в записи (массив — случайный); без file сайт спросит у архива список роликов, match — фильтр по имени.
       Берём H.264-копии (.ia.mp4 — архив сам пережимает их для браузеров). */
    { type: 'archive', label: 'СТАРОЕ ВИДЕО', live: true, items: [
      { id: 'ssr_vhs_1994', file: 'Сам Себе Режиссёр - Избранное (1994).mp4' },                // «Сам себе режиссёр», кассета 1994 года
      { id: 'soviet-animation', file: [                                                         // советская анимация
        'Soviet Animation/Перевал.ia.mp4', 'Soviet Animation/Возвращение.ia.mp4', 'Soviet Animation/Когда-то давно.ia.mp4',
        'Soviet Animation/Ванюша и космический пират.ia.mp4', 'Soviet Animation/Человек ввоздухе..ia.mp4',
        'Soviet Animation/Ночь на Лысой горе.ia.mp4', 'Soviet Animation/Тачанка (Tachanka) .ia.mp4',
        'Soviet Animation/Познавательные мультики_ Машинка времени.ia.mp4',
      ] },
    ] },
    { type: 'rutube', label: 'РЕКЛАМА', live: true, items: [
      '67ccb76315bd7012931c88b37927b0d2', 'f2ab607427ef7a1edce1419890911ddc', '10d1b6de46324f71b6ce078fdf3ffefb',
      'a4b1f12827f2f4704c48904d4211d183', '8a28887d831a4e40e72e43466c586fe9', '53975635b9b8cd4fc8507330c0a5d1e0',
    ] },
    { type: 'rutube', label: 'ТВ СССР', live: true, items: [
      'b93247023f3b7d3f5ed96b3386d98c30', 'd987dbd73d9b1b1c346cc787fc651292', '73b59f96cedb1e12b39f1b5afc4be164',
      'd02c28972a264df1bc4725478bbf8635', 'f37aa7952686316042d76aa383dd77d2', '5538298c21b7c3f993c3b94a3e8553a2',
      'd3e49d694acdfc8548a7d290d08509fe',
    ] },
    { type: 'morning',  label: 'УТРО',
      title: ['С ДОБРЫМ', 'УТРОМ!'],
      logo: 'ЛУЧ',
      ticker: 'Сегодня солнечно, +24° • Не забудьте сделать зарядку! • Далее: мультфильмы и «Почта зрителей» • Лето, каникулы, хорошего дня! •',
      musicVolume: 0.32 },
    { type: 'testcard', label: 'ТЕСТ', toneHz: 1000, toneVolume: 0.035 },
    { type: 'static',   label: 'ПОМЕХИ', hissVolume: 0.22 },
  ],

  /* ---------- СВЕТ ---------- */
  light: {
    /* по сценам: свечение экрана на стене, сила мигалки, видимость пыли */
    scenes: {
      /* gust — сила вспышки света при порыве, gustColor — её цвет */
      day:      { glow: 0.30, siren: 0.50, dust: 1.0,  gust: 0.45, gustColor: [255, 236, 200] },
      sunset:   { glow: 0.50, siren: 0.65, dust: 0.9,  gust: 0.5,  gustColor: [255, 160, 70] },
      overcast: { glow: 0.55, siren: 0.80, dust: 0.2,  gust: 0.10, gustColor: [190, 210, 235] },
      storm:    { glow: 0.70, siren: 0.90, dust: 0.1,  gust: 0.06, gustColor: [170, 195, 230] },
      evening:  { glow: 0.85, siren: 1.0,  dust: 0.14, gust: 0,    gustColor: [255, 220, 170] },
      night:    { glow: 1.35, siren: 1.2,  dust: 0.06, gust: 0.05, gustColor: [255, 150, 70] },
    },
    spores: { far: 70, mid: 26, near: 5 },  // пыль-«споры»: дальний, средний, ближний (боке) слой
    sirenRed:  [255, 40, 40],
    sirenBlue: [40, 90, 255],
    idleGlowColor: [150, 170, 255],
    grainOpacity: 0.07,
    vignette: 0.55,
  },

  /* ---------- ЗВУК ---------- */
  audio: {
    master: 0.9,
    ambienceVolume: 0.45,    // общий уровень фона (комната, улица, события) — множитель
    fryingVolume: 0.55,      // яичница на кухне
    dogVolume: 0.7,          // собака во дворе
    rainVolume: 1.0,         // дождь
    /* Окно (клик по тяжёлой шторе слева от тюля, колёсико — плавно): 0 — закрыто, 1 — настежь.
       Закрытое окно не просто «срезает верхи»: улица переезжает в плоскость стекла,
       проходит в основном низ, растёт доля отзвука комнаты; капли по стеклу и отливу остаются. */
    windowLevels: [0, 0.3, 1],         // закрыто / приоткрыто / открыто
    windowStart: 2,                    // индекс в windowLevels при первом заходе
    sfxVolume: 0.8,          // щелчки, пасхалки
    headphones: true,        // объёмный звук (HRTF) по умолчанию; кнопка с наушниками переключает
    soundsFolder: 'sounds/',
    autoDetectFiles: false,  // true — искать sounds/<имя>.mp3 для всех имён ниже автоматически
    /* Подмена процедурного звука файлом: впишите путь вместо null (массив — случайный вариант).
       Петли (фон, каналы) зациклятся сами, события проиграются один раз. */
    files: {
      'room-tone': null,      'street-day': null,  'birds': null,       'children': null,
      'street-evening': null, 'crickets': null,
      'frying': ['sounds/kitchen-fry-1.mp3', 'sounds/kitchen-fry-2.mp3'],
      'siren': null,          'door': null,
      'dog': ['sounds/dog-1.mp3', 'sounds/dog-3.mp3', 'sounds/dog-5.mp3', 'sounds/dog-7.mp3'],
      'dog-far': ['sounds/dog-2.mp3', 'sounds/dog-4.mp3', 'sounds/dog-6.mp3', 'sounds/dog-8.mp3'],
      'thunder-1': 'sounds/thunder-1.mp3', 'thunder-2': 'sounds/thunder-2.mp3', 'thunder-3': 'sounds/thunder-3.mp3',
      'car-wet': ['sounds/car-wet-1.mp3', 'sounds/car-wet-2.mp3'],
      'rain-wash-light': 'sounds/rain/rain-wash-light.mp3', 'rain-wash-heavy': 'sounds/rain/rain-wash-heavy.mp3',
      'rain-leaves': 'sounds/rain/rain-leaves.mp3', 'rain-puddles': 'sounds/rain/rain-puddles.mp3',
      'rain-gutter': 'sounds/rain/rain-gutter.mp3', 'rain-glass': 'sounds/rain/rain-glass.mp3',
      'rain-sill-light': 'sounds/rain/rain-sill-light.mp3', 'rain-sill-heavy': 'sounds/rain/rain-sill-heavy.mp3',
      'street-sunset': null,  'swifts': null,      'window-latch': null,
      'tv-on': null,          'tv-off': null,      'channel-click': null,
      'tv-testcard': null,    'tv-static': null,   'tv-morning': null,
      'lamp-click': null,
      'egg-deer': null,       'egg-brickgame': null, 'egg-rubik': null,
      'egg-bear': null,       'egg-cassette': null,   'egg-figurine': null,  'egg-teapot': null,
    },
    /* бесшовные петли: файл записан с запасом в 1 с по краям, период — в секундах */
    seamless: { 'rain-wash-light': 24, 'rain-wash-heavy': 24, 'rain-leaves': 24, 'rain-puddles': 24,
                'rain-gutter': 24, 'rain-glass': 24, 'rain-sill-light': 24, 'rain-sill-heavy': 24 },
  },

  /* ---------- ВЕТЕР И ПОГОДА ---------- */
  wind: {
    calm: 0.08,                       // фоновое «дыхание» тюля
    gustMin: 0.45, gustMax: 1.0,      // сила порыва
    attackMs: [1000, 2200], holdMs: [400, 2400], decayMs: [2800, 5200],
    everyMs: [7000, 18000],           // пауза между порывами
    scaleCalm: 4, scaleGust: 18,      // амплитуда мелких волн в тюле (px картинки)
    billowPx: 16,                     // на сколько пикселей порыв уводит подол в комнату (WebGL)
    billow: 1.3,                      // насколько порыв выгибает подол внутрь комнаты (1 ≈ 40 px)
    weather: { clear: 1, drizzle: 1.25, downpour: 1.7 },
  },
  weather: { lightningEveryMs: [14000, 38000] },

  /* ---------- СЛУЧАЙНЫЕ СОБЫТИЯ ---------- */
  events: {
    minIntervalSec: 40,
    maxIntervalSec: 120,
    firstDelaySec: [25, 45],
    mustHappen: { frying: 170, siren: 300 },   // событие: не реже, чем раз в N секунд
    weights: { frying: 3, siren: 1.6, door: 1, dog: 1.0, dogFar: 1.4, carWet: 1.2 },
  },

  /* ---------- ПАСХАЛКИ ----------
     sprite — коробка вырезанного предмета в пикселях исходной картинки [x, y, w, h].
     Вырезки и «чистые подложки» лежат в assets/eggs/<id>-<day|evening>.png
     и <id>-plate-<day|evening>.png. Если двигаете зону в калибровке, sprite не трогайте:
     он привязан к пикселям картинки. */
  figurine: { unitPx: 109, axisX: 30, baseY: 110 },
  eggs: [
    { id: 'deer',       label: 'Олени из фосфора. Днём набирают свет, ночью тихо светятся среди хрусталя', sound: 'egg-deer', anim: 'pickup',
      sprite: [366, 286, 76, 90], depth: 6 },
    { id: 'brickGame',  label: 'Брик-гейм «9999 игр в 1»',                   sound: 'egg-brickgame',  anim: 'pickup',   fx: 'notes',
      sprite: [1046, 429, 68, 84], depth: 10, lcd: [1064, 442, 24, 22] },
    { id: 'rubik',      label: 'Кубик Рубика. Собрать бы хоть одну грань',   sound: 'egg-rubik',      anim: 'cube',
      sprite: [1128, 465, 50, 48],
      cube: { center: [1153, 488], size: 30, yaw: 30,
              front: ['#e0b42a', '#a0802e', '#3f7f48', '#2f5f8f', '#d0702e', '#d8a02a', '#d8c040', '#b8402e', '#a09030'],
              left:  ['#3f7f48', '#8a5a3a', '#a8402e', '#d8a02a', '#c8682e', '#3f7a40', '#dcd6cc', '#2f6a70', '#c8702e'] } },
    { id: 'bear',       label: 'Мишка. Если наклонить — рычит',              sound: 'egg-bear',       anim: 'rock',
      sprite: [938, 513, 102, 118], depth: 14 },
    { id: 'cassette',   label: 'Кассета и карандаш — перемотка по-честному', sound: 'egg-cassette',   anim: 'rewind',
      sprite: [1031, 545, 102, 84], depth: 9, reels: [[1072, 582], [1103, 582]], reelRadius: 4.4 },
    { id: 'figurine',   label: 'Фарфоровая статуэтка. Танцует под шкатулку',   sound: 'egg-figurine',   anim: 'turntable', fx: 'sparkle',
      sprite: [986, 192, 62, 116] },
    { id: 'teapot',     label: 'Сервиз «для гостей»',                        sound: 'egg-teapot',     anim: 'rattle3d',  fx: 'steam',
      sprite: [300, 390, 92, 90] },
  ],

  /* ---------- ТЕКСТЫ ---------- */
  text: {
    intro: 'Июнь. Каникулы. Включите телевизор — кнопка внизу справа, под динамиком.',
    powerHint: 'Включить телевизор',
    afterOn: 'Верхняя ручка — каналы, нижняя — громкость. Торшер — день, закат, вечер, ночь. Окно — погода. Sega на полу — поиграть. И приглядитесь к полкам.',
    seat: 'Сесть перед телевизором',
    stand: 'Встать',
    power: 'Кнопка питания',
    channelKnob: 'Переключатель каналов',
    volumeKnob: 'Громкость — колёсико или потяните',
    lamp: { day: 'Торшер — вернуть день', sunset: 'Торшер — дождаться заката', evening: 'Торшер — дождаться вечера', night: 'Торшер — погасить: пусть светит только телевизор' },
    weatherNext: { clear: 'Окно — пусть распогодится', drizzle: 'Окно — пусть моросит', downpour: 'Окно — пусть хлынет ливень' },
    weatherNow: { clear: 'Распогодилось', drizzle: 'Пасмурно, моросит', downpour: 'Ливень' },
    drape: ['Окно закрыто — приоткрыть', 'Окно приоткрыто — открыть настежь', 'Окно открыто — закрыть'],
    drapeNow: ['Окно закрыли — улица стала глуше, слышно только стекло', 'Окно приоткрыли', 'Окно открыли настежь'],
    rainHint: 'Пошёл дождь. Окно можно закрыть — щёлкните по шторе слева от тюля',
    tapForSound: 'Браузер запустил эфир без звука — нажмите на экран телевизора',
    rtxOn: 'RTX включён: блики и преломления в хрустале',
    rtxOff: 'RTX выключен',
    phonesOn: 'Объёмный звук для наушников включён',
    phonesOff: 'Обычный стерео-звук (для колонок)',
    mute: 'Звук',
    ambience: 'фон',
    segaZone: 'Приставка — вставить картридж',
    segaZoneOn: 'Приставка — картриджи',
    segaTitle: 'Картриджи',
    segaClose: 'Закрыть',
    segaNow: 'Сейчас в приставке: %s',
    segaResume: 'Продолжить',
    segaReset: 'Сначала',
    segaOff: 'Выключить приставку',
    segaOwn: 'Свой картридж…',
    segaOwnDesc: 'Файл .md, .bin, .gen, .smd или .zip — можно перетащить',
    segaKeys: '<b>Клавиатура:</b> <kbd>←</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd> крестовина · <kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> кнопки A B C · <kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd> X Y Z · <kbd>Enter</kbd> Start · <kbd>Esc</kbd> это меню<br><b>Геймпад:</b> подключите и нажмите любую кнопку. Крестовина или стик, три кнопки — A B C, Start, кнопка «домой» — меню',
    segaPadOn: 'Геймпад: %s',
    segaPadOff: 'Геймпад не найден — подключите и нажмите кнопку',
    segaPadGeneric: 'подключён',
    segaHint: 'Стрелки — крестовина, A S D — кнопки, Enter — Start. Esc — меню картриджей',
    segaHintTouch: 'Крестовина слева, кнопки справа. ☰ — меню картриджей',
    segaLoading: 'ЗАГРУЗКА…',
    segaFail: 'Картридж не запустился. Попробуйте другой файл',
    segaBadFile: 'Это не картридж Mega Drive: нужен файл .md, .bin, .gen, .smd или .zip',
    segaScreenFail: 'КАРТРИДЖ НЕ ЧИТАЕТСЯ',
    segaScreenFail2: 'выберите другой — Esc',
  },
};
