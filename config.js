/* ============================================================
   TUBE TV — конфигурация
   Всё, что стоит настраивать руками, живёт здесь.
   Координаты зон — в ПРОЦЕНТАХ от исходной картинки (1536×1024):
   x, y — левый верхний угол; w, h — ширина и высота.
   Нажмите D на сайте → режим калибровки → «Скопировать конфиг»
   и вставьте результат вместо блока zones ниже.
   ============================================================ */
window.TUBE_TV_CONFIG = {
  version: '0.7',
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
  },
  startMode: 'day',                            // day | sunset | evening
  startWeather: 'clear',                       // clear | drizzle | downpour
  timeCycle: ['day', 'sunset', 'evening'],     // клик по торшеру
  weatherCycle: ['clear', 'drizzle', 'downpour'],   // клик по окну
  crossfadeMs: 2600,

  /* Солнце: карта пятен и лучей, вырезанная из дневной картинки, и куда она
     уезжает на закате (поворот ang° и растяжение sc вокруг окна px/py, сдвиг tx/ty).
     amb/sun/win — множители цвета комнаты в тени, солнечных пятен и окна на закате;
     mid — «золотой час» посередине. setMs — сколько садится солнце (торшер: день → закат). */
  sun: {
    map: 'assets/sunmap.webp',
    pose: { ang: 8, sc: 1.33, tx: -140, ty: -115, px: 1340, py: 330 },
    amb: [0.50, 0.40, 0.42], sun: [1.35, 0.62, 0.25], win: [1.05, 0.62, 0.35],
    mid: { amb: [0.82, 0.72, 0.66], sun: [1.2, 0.88, 0.58], win: [1.05, 0.84, 0.62] },
    setMs: 7000, riseMs: 4000,
  },

  /* Чёткая (увеличенная нейросетью ×4) версия телевизора и ниши — подгружается,
     когда вы «садитесь перед телевизором». box — где она лежит на картинке, в пикселях. */
  hires: {
    box: [480, 250, 560, 400],
    images: { day: 'assets/hires/tv-day.webp', sunset: 'assets/hires/tv-sunset.webp',
              evening: 'assets/hires/tv-evening.webp', overcast: 'assets/hires/tv-overcast.webp',
              storm: 'assets/hires/tv-storm.webp' },
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
    screen:      { x: 39.91, y: 34.77, w: 15.10, h: 17.87 },
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
    sachet:      { x: 61.65, y: 41.41, w: 3.19,  h: 8.01  },
    tamagotchi:  { x: 65.62, y: 41.41, w: 3.12,  h: 7.81  },
    brickGame:   { x: 69.01, y: 41.50, w: 3.12,  h: 7.62  },
    rubik:       { x: 73.11, y: 45.02, w: 3.19,  h: 4.10  },
    bear:        { x: 61.33, y: 50.00, w: 6.58,  h: 10.94 },
    cassette:    { x: 67.84, y: 53.12, w: 6.18,  h: 7.42  },
    figurine:    { x: 64.58, y: 18.95, w: 3.45,  h: 9.86  },
    teapot:      { x: 19.66, y: 38.38, w: 5.60,  h: 8.01  },
    radio:       { x: 38.93, y: 25.39, w: 7.55,  h: 7.52  },
  },

  /* «Сесть перед телевизором»: камера наезжает так, чтобы зона tvBody
     занимала долю fill от экрана (по меньшей из сторон). Клавиша S, Esc — встать. */
  seat: { zone: 'tvBody', fill: 0.8, durationMs: 1500 },

  /* Встроенный YouTube под стеклом кинескопа.
     crt — сила накладок (строки, маска, мерцание, отражение): 0…1.
     overscan — «заход» картинки за края стекла, как у настоящего кинескопа:
       прячет края кадра с надписями YouTube.
     revealDelayMs — сколько держать «настройку» после старта ролика, пока
       YouTube показывает название и логотип. */
  embed: { crt: 0.1, overscan: 1.2, revealDelayMs: 3200, playerWidth: 1280, captions: false, lang: 'ru' },

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
     type: 'testcard' | 'static' | 'morning' | 'youtube' | 'video'
     Видео-канал: положите ролики в assets/video/ и перечислите их в playlist.
       order: 'sequence' — по порядку, 'shuffle' — случайно без повторов подряд.
       Каждое переключение на канал включает следующий ролик; когда ролик
       кончается, сам начинается следующий.
       live: true — ролик стартует «с середины», как будто эфир шёл без вас. */
  channels: [
    { type: 'testcard', label: 'ТЕСТ', toneHz: 1000, toneVolume: 0.035 },
    { type: 'static',   label: 'ПОМЕХИ', hissVolume: 0.22 },
    { type: 'morning',  label: 'УТРО',
      title: ['С ДОБРЫМ', 'УТРОМ!'],
      logo: 'ЛУЧ',
      ticker: 'Сегодня солнечно, +24° • Не забудьте сделать зарядку! • Далее: мультфильмы и «Почта зрителей» • Лето, каникулы, хорошего дня! •',
      musicVolume: 0.32 },
    /* YouTube-каналы staroetv (официальный плеер, «кинескоп» из накладок).
       source.channel — ID канала (начинается с UC…): YouTube → канал → «Поделиться» →
       «Скопировать идентификатор канала». Тогда играют случайные ролики из «Загрузок».
       Или source.playlist — ID плейлиста (PL…), или source.videos — список ID роликов. */
    { type: 'youtube', label: 'СТАРОЕ ТВ', shuffle: true, randomStart: true,
      source: { channel: 'UCESmUzgr_rfY2VO44PRWqpg' } },   // «Старый телевизор (STAROETV.SU)»
    { type: 'youtube', label: 'АРХИВ', shuffle: true, randomStart: true,
      source: { channel: 'UC67zFUthMqRppJ7Z0ef-F4Q' } },   // «Старый Телевизор» — проверьте, что это нужный канал
    { type: 'video', label: 'AV-1', order: 'shuffle', live: true,
      playlist: ['assets/video/ch-01.mp4', 'assets/video/ch-02.mp4', 'assets/video/ch-03.mp4'] },
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
    ambienceVolume: 0.45,
    fryingVolume: 0.3,       // яичница на кухне    // общий уровень фона (комната, улица, события) — множитель
    /* Форточка (клик по тяжёлой шторе слева от тюля, колёсико — плавно):
       насколько слышна улица. Закрытая форточка ещё и гасит ветер в тюле. */
    windowLevels: [0.12, 0.35, 0.7],   // закрыта / приоткрыта / открыта
    windowStart: 1,                    // индекс в windowLevels при первом заходе
    sfxVolume: 0.8,          // щелчки, пасхалки
    headphones: true,        // объёмный звук (HRTF) по умолчанию; кнопка с наушниками переключает
    soundsFolder: 'sounds/',
    kitchenCutoff: 1700,     // «стена» для яичницы: чем ниже, тем глуше (Гц)
    autoDetectFiles: false,  // true — искать sounds/<имя>.mp3 для всех имён ниже автоматически
    /* Подмена процедурного звука файлом: впишите путь вместо null.
       Петли (фон, каналы) зациклятся сами, события проиграются один раз. */
    files: {
      'room-tone': null,      'street-day': null,  'birds': null,       'children': null,
      'street-evening': null, 'crickets': null,
      'frying': ['sounds/frying-1.mp3', 'sounds/frying-2.mp3'],   // массив — случайный вариант; звучит «через стену»
      'siren': null,          'clock': null,       'door': null,      'dog': null,      'dog-far': null,
      'thunder': null,        'rain-light': null,  'rain-heavy': null,
      'street-sunset': null,  'swifts': null,      'window-latch': null,
      'tv-on': null,          'tv-off': null,      'channel-click': null,
      'tv-testcard': null,    'tv-static': null,   'tv-morning': null,
      'lamp-click': null,
      'egg-sachet': null,     'egg-tamagotchi': null, 'egg-brickgame': null, 'egg-rubik': null,
      'egg-bear': null,       'egg-cassette': null,   'egg-figurine': null,  'egg-teapot': null,
    },
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
    weights: { frying: 3, siren: 1.6, clock: 1, door: 1, dog: 0.6, dogFar: 1.4 },
  },

  /* ---------- ПАСХАЛКИ ----------
     sprite — коробка вырезанного предмета в пикселях исходной картинки [x, y, w, h].
     Вырезки и «чистые подложки» лежат в assets/eggs/<id>-<day|evening>.png
     и <id>-plate-<day|evening>.png. Если двигаете зону в калибровке, sprite не трогайте:
     он привязан к пикселям картинки. */
  eggs: [
    { id: 'sachet',     label: 'Порошковый напиток — «просто добавь воды»', sound: 'egg-sachet',     anim: 'shake3d',  fx: 'bubbles',
      sprite: [936, 414, 71, 104], depth: 4 },
    { id: 'tamagotchi', label: 'Тамагочи. Кажется, он проголодался',         sound: 'egg-tamagotchi', anim: 'twirl',    fx: 'pet',
      sprite: [997, 413, 70, 102], depth: 9 },
    { id: 'brickGame',  label: 'Брик-гейм «9999 игр в 1»',                   sound: 'egg-brickgame',  anim: 'pickup',   fx: 'notes',
      sprite: [1049, 414, 70, 100], depth: 10, lcd: [1070, 431, 26, 26] },
    { id: 'rubik',      label: 'Кубик Рубика. Собрать бы хоть одну грань',   sound: 'egg-rubik',      anim: 'cube',
      sprite: [1112, 450, 71, 64],
      cube: { center: [1147.5, 482.5], size: 34, yaw: 19,
              front: ['#d0614c', '#d9a596', '#e2b22c', '#e3cc8e', '#3f8f48', '#e0a82a', '#dcd6cc', '#e2b040', '#3c8f3e'],
              left:  ['#c8682e', '#b8452f', '#c8682e', '#d0a028', '#c8682e', '#3a5fb0', '#dcd6cc', '#c8682e', '#b8452f'] } },
    { id: 'bear',       label: 'Мишка. Если наклонить — рычит',              sound: 'egg-bear',       anim: 'rock',
      sprite: [931, 501, 124, 134], depth: 14 },
    { id: 'cassette',   label: 'Кассета и карандаш — перемотка по-честному', sound: 'egg-cassette',   anim: 'rewind',
      sprite: [1031, 533, 117, 98], depth: 7, reels: [[1071, 587], [1105, 587]], reelRadius: 4.6 },
    { id: 'figurine',   label: 'Фарфоровая статуэтка. Танцует под шкатулку',   sound: 'egg-figurine',   anim: 'turntable', fx: 'sparkle',
      sprite: [981, 183, 75, 123] },
    { id: 'teapot',     label: 'Сервиз «для гостей»',                        sound: 'egg-teapot',     anim: 'rattle3d',  fx: 'steam',
      sprite: [290, 382, 110, 104] },
  ],

  /* ---------- РАДИОТОЧКА ----------
     Трёхпрограммный громкоговоритель на телевизоре. Клик — следующая программа (1 → 2 → 3 → выкл).
     Звук берётся прямо с серверов Internet Archive (archive.org), ничего не копируется к нам.
     Каждый раз включается случайная запись с случайного места — как будто попали в живой эфир.
     url — ссылка на файл; long: true — длинная запись, начинать с середины. */
  radio: {
    box: [600, 262, 114, 74],       // где стоит, пиксели картинки [x, y, w, h]
    volume: 0.7,
    programs: [
      { name: 'Первая программа', short: 'I', items: [
        { t: '«С добрым утром!» — Всесоюзное радио, 1978', u: 'radio_ussr/004_Всесоюзное радио - Воскресная радиопередача - С добрым утром - 23 (1978 (госпрем.mp3' },
        { t: '«С добрым утром!»', u: 'radio_ussr/005_Радиопередача СССР - С добрым утром.mp3' },
        { t: '«С добрым утром!», декабрь 1965', u: 'radio_ussr/006_Радиопередачи СССР - С добрым утром. 1965 год. декабрь.mp3' },
        { t: '«С добрым утром!» — отдел сатиры и юмора', u: 'radio_ussr/007_Радиопередачи СССР - С добрым утром. Передача отдела сатиры и юмора. Всесоюзное .mp3' },
        { t: '«С добрым утром!», ведущая Тамара Кузина', u: 'radio_ussr/008_Радиопередачи СССР - С добрым утром. Радиопередача. Ведущая Тамара Кузина. Февра.mp3' },
        { t: '«В рабочий полдень» — Андрей Миронов', u: 'radio_ussr/009_Радиопередачи СССР - Андрей Миронов на радио в передаче В рабочий полдень.mp3' },
        { t: '«Вы нам писали» — Всесоюзное радио', u: 'radio_ussr/011_Радиопередачи СССР - Вы нам писали. Программа Всесоюзного радио.mp3' },
      ] },
      { name: 'Маяк', short: 'II', items: [
        { t: 'Новости СССР', u: 'radio_ussr/002_Радио - Новости СССР.mp3', long: true },
        { t: 'Новости и музыка, 1980', u: 'radio_ussr/010_Радиопередачи СССР - Радио СССР. Новости и музыка. 1980 год.mp3', long: true },
        { t: 'Новости и музыка, 1976', u: 'news-and-music-1976-soviet-radio/News and Music 1976 Soviet radio.mp3', long: true },
        { t: 'Советское радио — двенадцать часов эфира', u: 'soviet-radio/Soviet Radio.mp3', long: true },
      ] },
      { name: 'Юность', short: 'III', items: [
        { t: '«Здравствуй, товарищ!» — радиостанция «Юность»', u: 'radio_ussr/012_Радиопередачи СССР - Радиостанция Юность. Передача Здравствуй, товарищ! СССР 198.mp3' },
        { t: '«Вечерний час» — «Юность», 1967', u: 'radio_ussr/013_Радиопередачи СССР - 1967 год. Радиостанция Юность. Вечерний час.mp3', long: true },
        { t: 'Радио СССР — фрагменты передач', u: 'radio_ussr/003_Радио СССР - ( фрагменты передач ).mp3', long: true },
        { t: '«В новогоднюю ночь», 1977', u: 'radio_ussr/014_Радиопередачи СССР - В новогоднюю ночь. Радиопередача. СССР. 1977 год.mp3', long: true },
      ] },
    ],
    base: 'https://archive.org/download/',
  },

  /* ---------- ТЕКСТЫ ---------- */
  text: {
    intro: 'Июнь. Каникулы. Включите телевизор — кнопка внизу справа, под динамиком.',
    powerHint: 'Включить телевизор',
    afterOn: 'Верхняя ручка — каналы, нижняя — громкость. Торшер — день, закат, вечер. Окно — погода. На телевизоре — радиоточка. И приглядитесь к полкам.',
    seat: 'Сесть перед телевизором',
    stand: 'Встать',
    power: 'Кнопка питания',
    channelKnob: 'Переключатель каналов',
    volumeKnob: 'Громкость — колёсико или потяните',
    lamp: { day: 'Торшер — вернуть день', sunset: 'Торшер — дождаться заката', evening: 'Торшер — дождаться вечера' },
    weatherNext: { clear: 'Окно — пусть распогодится', drizzle: 'Окно — пусть моросит', downpour: 'Окно — пусть хлынет ливень' },
    weatherNow: { clear: 'Распогодилось', drizzle: 'Пасмурно, моросит', downpour: 'Ливень' },
    drape: ['Форточка закрыта — открыть чуть-чуть', 'Форточка приоткрыта — открыть настежь', 'Форточка открыта — закрыть'],
    drapeNow: ['Форточку закрыли — тихо', 'Форточку приоткрыли', 'Форточку открыли настежь'],
    radioOff: 'Радиоточка — включить первую программу',
    radioNext: 'Радиоточка: {now}. Щелчок — следующая программа, колёсико — громкость',
    radioLast: 'Радиоточка: {now}. Щелчок — выключить',
    radioTuning: 'настраивается',
    radioFail: 'Архив радио сейчас не отвечает — попробуйте позже',
    phonesOn: 'Объёмный звук для наушников включён',
    phonesOff: 'Обычный стерео-звук (для колонок)',
    mute: 'Звук',
    ambience: 'фон',
  },
};
