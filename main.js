/* ==========================================================================
   TUBE TV — main.js
   Слои поверх готовой картинки: фон → экран → свет → зоны → интерфейс.
   Без сборки, без зависимостей. Настройки — в config.js.
   ========================================================================== */
(() => {
'use strict';

const CFG = window.TUBE_TV_CONFIG;
const IMG_W = CFG.image.width, IMG_H = CFG.image.height;
const T = CFG.text;
const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const irand = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const pick2 = pick;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeIn = t => t * t * t;
const midi = n => 440 * Math.pow(2, (n - 69) / 12);
const nowMs = () => performance.now();

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const HOVER = matchMedia('(hover: hover)').matches;
if (REDUCED) document.body.classList.add('reduced');

const state = {
  mode: CFG.startMode || 'day',                        // время суток: day | sunset | evening
  weather: CFG.startWeather || 'clear',                // clear | drizzle | downpour
  scene: null, fx: null, fxFrom: null, fxTo: null, fxT0: 0,
  muted: false,
  ambience: (() => { try { const v = parseFloat(localStorage.getItem('tubetv.room')); if (v >= 0 && v <= 1) return v; } catch (_) {} return CFG.audio.ambienceVolume; })(),
  vent: (() => { try { const v = parseFloat(localStorage.getItem('tubetv.vent')); if (v >= 0 && v <= 1) return v; } catch (_) {} return CFG.audio.windowLevels[CFG.audio.windowStart]; })(),
  tvVolume: CFG.tv.defaultVolume,
  headphones: (() => { try { const v = localStorage.getItem('tubetv.phones'); if (v === '0' || v === '1') return v === '1'; } catch (_) {} return CFG.audio.headphones !== false; })(),
  radioVolume: (() => { try { const v = parseFloat(localStorage.getItem('tubetv.radio')); if (v >= 0 && v <= 1) return v; } catch (_) {} return CFG.radio ? CFG.radio.volume : 0.7; })(),
  calibrating: false,
  firstOnDone: false,
  stage: { left: 0, top: 0, w: 1, h: 1, u: 1 },
};

/* ==========================================================================
   1. РАСКЛАДКА: контейнер с пропорциями картинки, координаты — в процентах
   ========================================================================== */
const stageEl = $('#stage');
const root = document.documentElement;

function layout() {
  const vw = innerWidth, vh = innerHeight;
  const mobile = vw / vh < CFG.layout.mobileMaxAspect;
  const L = mobile ? CFG.layout.mobile : CFG.layout.desktop;
  const kv = L.keepVisible;
  const cover = Math.max(vw / IMG_W, vh / IMG_H);
  const fitKeep = Math.min(vw / (IMG_W * kv.w / 100), vh / (IMG_H * kv.h / 100));
  const s = Math.min(cover, fitKeep);
  const sw = IMG_W * s, sh = IMG_H * s;

  const place = (size, view, focusPct, kStart, kSize) => {
    if (size <= view) return (view - size) / 2;
    const desired = view / 2 - focusPct / 100 * size;
    const lo = Math.max(view - size, view - (kStart + kSize) / 100 * size);
    const hi = Math.min(0, -kStart / 100 * size);
    return lo <= hi ? clamp(desired, lo, hi) : clamp(desired, view - size, 0);
  };
  const left = place(sw, vw, L.focus.x, kv.x, kv.w);
  const top = place(sh, vh, L.focus.y, kv.y, kv.h);

  Object.assign(stageEl.style, { width: sw + 'px', height: sh + 'px' });
  state.stage = { left, top, w: sw, h: sh, u: s };
  stageEl.classList.toggle('letterbox-y', sh < vh - 1 && !Camera.seated);
  stageEl.classList.toggle('letterbox-x', sw < vw - 1 && !Camera.seated);
  root.style.setProperty('--u', s + 'px');
  Camera.apply(false);
  Weather.resize && Weather.ctx && Weather.resize();
  GLRoom.resize();
  Dust.resize();
  Calib.refresh();
}

/* «Камера»: обычный вид или «сесть перед телевизором» — наезд одним transform */
const Camera = {
  seated: false,
  target() {
    const st = state.stage;
    if (!this.seated) return { x: st.left, y: st.top, k: 1 };
    const z = CFG.zones[CFG.seat.zone] || CFG.zones.screen, vw = innerWidth, vh = innerHeight;
    const tw = z.w / 100 * st.w, th = z.h / 100 * st.h;
    const k = Math.max(1, Math.min(CFG.seat.fill * vw / tw, CFG.seat.fill * vh / th));
    const cx = (z.x + z.w / 2) / 100 * st.w, cy = (z.y + z.h / 2) / 100 * st.h;
    return { x: vw / 2 - k * cx, y: vh / 2 - k * cy, k };
  },
  apply(animate) {
    const t = this.target();
    state.zoom = t.k;
    stageEl.classList.toggle('moving', !!animate);
    stageEl.style.transform = `translate3d(${t.x}px, ${t.y}px, 0) scale(${t.k})`;
    root.style.setProperty('--zoom', t.k);
    document.body.classList.toggle('seated', this.seated);
    // видно ли окно с тюлем в кадре (если нет — WebGL его не перерисовывает)
    const w = CFG.zones.window, st = state.stage;
    this.winHidden = this.seated && (t.x + (w.x / 100) * st.w * t.k > innerWidth || t.y + ((w.y + w.h) / 100) * st.h * t.k < 0);
    clearTimeout(this._t);
    if (animate) this._t = setTimeout(() => { stageEl.classList.remove('moving'); TV.resize(); Radio.resize(); Props.resize(); VCR.resize(); }, CFG.seat.durationMs + 60);
    else { TV.resize(); Radio.resize(); Props.clock && Props.resize(); VCR.cv && VCR.resize(); }
  },
  toggle(on = !this.seated) {
    if (on === this.seated) return;
    this.seated = on;
    Zones.hideCaption();
    if (Sound.started) Sound.seat(on);
    if (on) { stageEl.classList.remove('letterbox-y', 'letterbox-x'); BG.loadHires(); this.apply(true); }
    else { this.apply(true); setTimeout(layout, CFG.seat.durationMs + 80); }
    UI.seatLabel();
  },
};

/* Перевод зоны (%) в пиксели исходной картинки */
const zpx = z => ({ x: z.x / 100 * IMG_W, y: z.y / 100 * IMG_H, w: z.w / 100 * IMG_W, h: z.h / 100 * IMG_H });
function placeEl(el, z) {
  el.style.left = z.x + '%'; el.style.top = z.y + '%';
  el.style.width = z.w + '%'; el.style.height = z.h + '%';
}

/* ==========================================================================
   2. СЦЕНА: время суток (торшер) × погода (окно), фон, тюль на ветру
   ========================================================================== */
const sceneOf = (time, weather) => (weather === 'clear' || time === 'evening' || time === 'night') ? time : (weather === 'downpour' ? 'storm' : 'overcast');
const sceneFx = () => {
  const f = Object.assign({}, CFG.light.scenes[state.scene]);
  f.dim = state.mode === 'evening' && state.weather === 'downpour' ? 0.1 : 0;
  return f;
};

/* ==========================================================================
   2a. КОМНАТА НА WebGL
   Одна сцена вместо стопки картинок. Дневная фотография раскладывается на
   «комнату» и карту солнечных пятен (assets/sunmap.webp). На закате старые пятна
   снимаются, а новые рассчитываются: у каждого пикселя есть точка в комнате,
   луч из неё к солнцу проходит окно балконного блока, тюль и листву во дворе.
   Ночью тот же расчёт делается для фонаря во дворе.
   ========================================================================== */
/* «когда браузер освободится» — после загрузки страницы и паузы */
const idle = (fn, delay = 0) => {
  const go = () => setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 4000 }) : fn()), delay);
  if (document.readyState === 'complete') go(); else addEventListener('load', go, { once: true });
};
/* заставка: убираем, как только комната готова (или через 7 с в любом случае) */
const Boot = {
  done() { if (this._d) return; this._d = true; const b = $('#boot'); if (!b) return; b.classList.add('done'); setTimeout(() => b.remove(), 1500); },
};
setTimeout(() => Boot.done(), 7000);
const GLRoom = {
  ok: false, dirty: true,
  cur: { w: [1, 0, 0, 0], n: 0, s: 0, k: 1 }, tw: {},
  wind: { amp: 3, billow: 0, phase: 0 },
  SCENES: ['day', 'evening', 'overcast', 'storm'],

  /* ---------- шейдеры ----------
     Солнце считается честно: у каждого пикселя есть точка в комнате (карта плоскостей assets/geo.png
     + камера), из неё луч идёт к солнцу, пересекает правую стену с балконным блоком (рамы, импосты),
     проходит сквозь тюль (кружево из фото, размытие растёт с расстоянием — полутень от диска солнца
     и рассеяние в ткани) и сквозь крону во дворе. Цвет — по воздушной массе (чем ниже солнце, тем
     краснее и слабее). Лучи в воздухе — объёмный проход в уменьшенном буфере. */
  glsl() {
    const R = CFG.room;
    const f = x => (+x).toFixed(5);
    const ap = R.apertures.map(a => `ap = max(ap, rectA(H, vec4(${f(a[0])}, ${f(a[1])}, ${f(a[2])}, ${f(a[3])}), soft));`).join('\n  ');
    const bars = R.bars.map(b => b[0] === 'z'
      ? `ap *= 1.0 - (1.0 - smoothstep(${f(b[2] / 2)} - soft, ${f(b[2] / 2)} + soft, abs(H.x - (${f(b[1])})))) * step(${f(b[3])}, H.y) * step(H.y, ${f(b[4])});`
      : `ap *= 1.0 - (1.0 - smoothstep(${f(b[2] / 2)} - soft, ${f(b[2] / 2)} + soft, abs(H.y - (${f(b[1])})))) * step(${f(b[3])}, H.x) * step(H.x, ${f(b[4])});`).join('\n  ');
    return `
const float FOC = ${f(R.f)}, CX = ${f(R.cx)}, CY = ${f(R.cy)}, CAMH = ${f(R.camH)}, XR = ${f(R.xr)}, LACEM = ${f(R.laceM)};
float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hsh(i), b = hsh(i + vec2(1.0, 0.0)), c = hsh(i + vec2(0.0, 1.0)), d = hsh(i + vec2(1.0, 1.0));
  return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y; }
float fbm3(vec2 p){ float s = 0.0, a = 0.5, t = 0.0; for (int i = 0; i < 3; i++){ s += a * vn(p); t += a; p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s / t; }
float fbm4(vec2 p){ float s = 0.0, a = 0.5, t = 0.0; for (int i = 0; i < 4; i++){ s += a * vn(p); t += a; p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s / t; }
float rectA(vec2 H, vec4 r, float soft){
  return smoothstep(r.x - soft, r.x + soft, H.x) * smoothstep(-r.y - soft, -r.y + soft, -H.x)
       * smoothstep(r.z - soft, r.z + soft, H.y) * smoothstep(-r.w - soft, -r.w + soft, -H.y);
}
/* проём балконного блока в точке H = (z, высота над полом) на плоскости правой стены */
float aperture(vec2 H, float soft){
  float ap = 0.0;
  ${ap}
  ${bars}
  return ap;
}
/* точка комнаты и нормаль по номеру плоскости */
bool roomPoint(vec2 p, float id, out vec3 P, out vec3 N){
  float Z = 0.0; N = vec3(0.0, 0.0, 1.0);
  if (id < 0.5) return false;
  else if (id < 1.5) Z = 4.0;
  else if (id < 2.5) Z = 4.42;
  else if (id < 3.5) Z = 3.95;
  else if (id < 4.5) Z = 4.22;
  else if (id < 5.5) Z = 4.45;
  else if (id < 6.5) { Z = 3.75; N = vec3(0.0, 0.25, 0.968); }
  else if (id < 7.5) { Z = FOC * CAMH / max(p.y - CY, 0.5); N = vec3(0.0, 1.0, 0.0); }
  else if (id < 8.5) { Z = 2.6 - clamp((p.y - 690.0) / 334.0, 0.0, 1.0) * 1.1; N = vec3(0.123, 0.738, 0.663); }
  else if (id < 9.5) Z = ${f(CFG.vcr ? CFG.vcr.z : 3.62)};                                  // видик: передняя панель
  else { Z = FOC * (CAMH - ${f(CFG.vcr ? CFG.vcr.h : 0.09)}) / max(p.y - CY, 0.5); N = vec3(0.0, 1.0, 0.0); }   // видик: крышка
  P = vec3((p.x - CX) / FOC * Z, -(p.y - CY) / FOC * Z, -Z);
  return true;
}
/* крона во дворе: просветы между деревьями (крупно) и листья (мелко), полутень от диска */
float foliage(vec3 P, vec3 s, float tw, float detail){
  float t = (XR + 6.0 - P.x) / s.x;
  vec2 C = vec2(P.z + t * s.z, P.y + t * s.y + CAMH);
  float gaps = fbm3(C * vec2(0.55, 0.5) + vec2(3.1, 7.7));
  float dens = smoothstep(0.30, 0.55, gaps) * (1.0 - smoothstep(13.0, 16.0, C.y)) * smoothstep(-2.0, 1.5, C.y);
  if (dens < 0.01) return 0.0;
  float sway = sin(uTime * 0.7 + C.y * 0.4) * 0.035 * (0.4 + uGust);
  float n = detail > 0.5 ? fbm4(vec2((C.x + sway) * 4.2, C.y * 4.6)) : fbm3(vec2((C.x + sway) * 4.2, C.y * 4.6));
  float pen = clamp((t - tw) * 0.0093 * 4.4, 0.03, 0.4);
  return dens * smoothstep(0.47 - pen, 0.47 + pen, n) * 0.95;
}
`;
  },

  init() {
    const c = document.createElement('canvas');
    c.className = 'room-gl'; c.setAttribute('aria-hidden', 'true');
    const gl = c.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!gl) return Promise.reject(new Error('no webgl'));
    this.c = c; this.gl = gl;
    c.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost(); });
    const lodExt = gl.getExtension('EXT_shader_texture_lod');
    const VS = 'attribute vec2 a; varying vec2 v; void main(){ v = vec2(a.x * 0.5 + 0.5, 0.5 - a.y * 0.5); gl_Position = vec4(a, 0.0, 1.0); }';
    const HEAD = `${lodExt ? '#extension GL_EXT_shader_texture_lod : enable\n' : ''}precision highp float;
varying vec2 v;
uniform vec2 uImg;
uniform float uTime, uGust;
uniform vec3 uSunD;
`;
    const DBG = /[?&]dbg=light/.test(location.search) ? '#define DBG_LIGHT\n' : '';
    this.holeOK = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) >= 9;     // 9-я текстура: комната без пасхалок
    const HOLE = this.holeOK ? '#define HOLE\n' : '';
    const FS = HEAD + DBG + HOLE + `
#ifdef HOLE
uniform sampler2D uDayP;    // день без пасхалок — под предметом, пока он «в руках»
uniform vec4 uHole;         // прямоугольник предмета (px), z<0 — выключено
#endif
uniform sampler2D uDay, uEve, uOver, uStorm, uSun, uGeo, uLace, uShaft;
uniform vec4 uW;            // веса сцен: день (с солнцем), вечер, морось, ливень
uniform float uNight;       // ночь
uniform vec4 uWin;          // окно: x0, y0, x1, y1 (px)
uniform vec3 uAmb, uSunC, uWinC, uLamp;
uniform float uPhys, uSunK, uShaftK, uAmp, uBillow, uPhase, uRain, uSlant;
${this.glsl()}
float laceAt(vec2 uv, float lod){
${lodExt ? '  return texture2DLodEXT(uLace, uv, lod).r;' : '  return texture2D(uLace, uv, lod - 2.0).r;'}
}
float h11(float n){ return fract(sin(n * 127.1) * 43758.5453); }
float rainLayer(vec2 p, float cw, float len, float speed, float seed){
  p.x += p.y * uSlant;
  float cell = floor(p.x / cw);
  float r = h11(cell + seed), r2 = h11(cell * 1.7 + seed + 3.1);
  float cx = (cell + 0.2 + 0.6 * r) * cw;
  float across = exp(-pow((p.x - cx) / 1.15, 2.0));
  float y = fract(p.y / len - uTime * speed * (0.8 + 0.4 * r2) + r * 7.0);
  float along = smoothstep(0.0, 0.08, y) * (1.0 - smoothstep(0.08, 0.6, y));
  return across * along * step(0.35, r2);
}
vec3 lin(vec3 c){ return pow(max(c, 0.0), vec3(2.2)); }
vec3 gam(vec3 c){ return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
float sunAt(vec2 px){ vec2 uv = px / uImg; float s = texture2D(uSun, uv).r; return 12.0 * s * s; }

/* свет, пришедший в точку P сквозь окно, тюль и листву; s — направление на источник */
float throughWindow(vec3 P, vec3 N, vec3 s, float detail){
  float cosT = dot(N, s);
  if (cosT <= 0.0 || s.x <= 0.001) return 0.0;
  float t = (XR - P.x) / s.x;
  vec2 H = vec2(P.z + t * s.z, P.y + t * s.y + CAMH);
  float soft = max(t * 0.0047, 0.004);
  float ap = aperture(H, soft);
  if (ap < 0.001) return 0.0;
  // тюль: висит у стекла, качается от ветра; на порыве низ приподнимается — свет проходит чище
  vec2 L = H;
  L.x += uAmp * 0.0035 * sin(H.x * 9.0 - uPhase * 0.052 + H.y * 1.3);
  float blur = t * 0.0028 + 0.001;                       // полутень: диск солнца + рассеяние в нитях
  float lod = clamp(log2(blur / (LACEM / 512.0)), 0.0, 8.0);
  float T = pow(laceAt(vec2(L.x, -L.y) / LACEM, lod), 1.9) * 1.3;
  T = mix(T, 1.0, clamp(uBillow / 26.0, 0.0, 1.0) * smoothstep(1.3, 0.25, H.y) * 0.85);
  float occ = foliage(P, s, t, detail);
  return cosT * ap * T * (1.0 - occ);
}

void main(){
  vec2 p = v * uImg;
  // ---- тюль ----
  float ext = 120.0;
  float W = uWin.z - uWin.x, Hh = uWin.w - uWin.y;
  float xn = (p.x - uWin.x) / W, yn = (p.y - uWin.y) / Hh;
  float inside = step(0.0, xn) * step(yn, 1.0) * step(0.0, yn);
  float envW = inside * smoothstep(0.0, 0.14, xn) * (1.0 - smoothstep(0.95, 1.0, xn)) * smoothstep(0.03, 0.75, yn) * (1.0 - smoothstep(0.93, 0.995, yn));
  float k = 6.2831853 / 120.0;
  float ph = uPhase * k;
  float a1 = k * p.x - ph + p.y * 0.010, a2 = 2.0 * k * p.x - 1.3 * ph + p.y * 0.006 + 1.3, a3 = 3.0 * k * p.x + 0.7 * ph + p.y * 0.017 + 0.4;
  float wave = 0.55 * sin(a1) + 0.30 * sin(a2) + 0.15 * sin(a3);
  float slope = (0.55 * cos(a1) + 0.60 * cos(a2) + 0.45 * cos(a3)) * k;
  float dx = uAmp * envW * wave;
  float shade = 1.0 + clamp(slope * uAmp * envW * 2.2, -0.18, 0.18);
  float xe = (p.x - (uWin.x - ext)) / (W + ext), e0 = ext / (W + ext);
  float prof = pow(smoothstep(0.28, 1.0, yn), 2.0) * (1.0 - smoothstep(0.80, 1.0, xe)) * smoothstep(0.0, e0 + 0.14, xe) * step(0.0, xe) * step(yn, 1.0);
  prof *= 0.8 + 0.2 * sin(xe * 9.0 + yn * 3.0 + uTime * 0.6);
  vec2 q = p + vec2(dx + uBillow * prof, -uBillow * 0.22 * prof);
  shade += uBillow * prof * 0.004 * inside;
  vec2 uq = q / uImg;
  float winM = smoothstep(uWin.x - 6.0, uWin.x + 10.0, p.x) * (1.0 - smoothstep(uWin.w - 10.0, uWin.w + 6.0, p.y));
  vec3 col = vec3(0.0);
  vec3 P, N;
  bool room = roomPoint(p, floor(texture2D(uGeo, v).r * 255.0 / 20.0 + 0.5), P, N);
  // ---- день и закат: снимаем «старое» солнце с фотографии и кладём рассчитанное ----
  if (uW.x > 0.001) {
    float Lold = sunAt(q);
    float Lnew = Lold;
    if (uPhys > 0.001) {
      float Lp = room ? throughWindow(P, N, uSunD, 1.0) * uSunK : 0.0;
#ifdef DBG_LIGHT
      gl_FragColor = vec4(vec3(Lp / uSunK), 1.0); return;
#endif
      Lnew = mix(Lold, Lp, uPhys);
    }
    vec3 ratio = mix((uAmb + Lnew * uSunC) / (1.0 + Lold), uWinC, winM);
    vec3 dayc = texture2D(uDay, uq).rgb;
#ifdef HOLE
    if (uHole.z > 0.0 && q.x > uHole.x && q.y > uHole.y && q.x < uHole.x + uHole.z && q.y < uHole.y + uHole.w) dayc = texture2D(uDayP, uq).rgb;
#endif
    vec3 c = lin(dayc) * ratio;
    if (uShaftK > 0.001) c += texture2D(uShaft, v).r * uShaftK * uSunC * vec3(1.0, 0.8, 0.55) * (1.0 - winM * 0.7);
    // мягкое «плечо» вместо жёсткого обреза: в ярком оранжевом пятне красный не упирается в потолок,
    // и рисунок кружева остаётся виден
    vec3 sh = 0.7 + 0.45 * (1.0 - exp(-(c - 0.7) / 0.45));
    c = mix(c, mix(c, sh, step(0.7, c)), uPhys);
    col += uW.x * gam(c);
  }
  if (uW.y > 0.001) col += uW.y * texture2D(uEve, uq).rgb;
  if (uW.z > 0.001) col += uW.z * texture2D(uOver, uq).rgb;
  if (uW.w > 0.001) col += uW.w * texture2D(uStorm, uq).rgb;
  // ---- ночь: торшер погашен; синева из окна, натриевый фонарь во дворе светит снизу сквозь тюль ----
  if (uNight > 0.001) {
    vec3 alb = lin(texture2D(uStorm, uq).rgb);
    vec3 c = alb * vec3(0.07, 0.085, 0.14);
    if (room) {
      vec3 lp = vec3(XR + 7.5, -3.6, -3.3);                 // фонарь: 7,5 м от окна, ниже подоконника
      vec3 d = lp - P; float dist = length(d);
      float Ls = throughWindow(P, N, d / dist, 0.0) * 700.0 / (dist * dist);
      c += alb * Ls * uLamp;
    }
    vec3 wn = alb * (vec3(0.10, 0.13, 0.24) + uLamp * 0.42 * pow(smoothstep(0.3, 1.0, yn), 1.5));
    c = mix(c, wn, winM);
    col += uNight * gam(c);
  }
  col *= shade;
  if (uRain > 0.001) {
    float lumc = dot(col, vec3(0.299, 0.587, 0.114));
    float r = rainLayer(p, 9.0, 260.0, 1.9, 1.0) * 0.55 + rainLayer(p + 37.0, 6.0, 170.0, 2.6, 7.0) * 0.35 + rainLayer(p + 71.0, 14.0, 380.0, 1.4, 13.0) * 0.6;
    float cloud = 0.5 + 0.5 * sin(uTime * 0.23) * sin(uTime * 0.071 + 1.3);
    col *= 1.0 - winM * uRain * (0.10 + 0.10 * cloud);
    col += winM * uRain * r * (0.25 + 0.75 * smoothstep(0.04, 0.5, lumc)) * vec3(0.30, 0.33, 0.37);
  }
  gl_FragColor = vec4(col, 1.0);
}`;
    /* лучи в воздухе: на каждый пиксель — марш по лучу камеры через объём комнаты */
    const FS_SHAFT = HEAD + `
uniform sampler2D uGeo;
${this.glsl()}
void main(){
  vec2 p = v * uImg;
  vec3 P, N;
  float id = floor(texture2D(uGeo, v).r * 255.0 / 20.0 + 0.5);
  float Zs = 6.0;
  if (roomPoint(p, id, P, N)) Zs = min(-P.z, 6.0);
  vec3 d = vec3((p.x - CX) / FOC, -(p.y - CY) / FOC, -1.0);
  float dl = length(d);
  float acc = 0.0;
  float j = hsh(p + fract(uTime * 0.37) * 31.0);
  const int STEPS = 22;
  float z0 = 0.9, dz = (Zs - z0) / float(STEPS);
  for (int i = 0; i < STEPS; i++){
    float z = z0 + (float(i) + j) * dz;
    vec3 Q = d * z;
    if (Q.x > XR || Q.y < -CAMH || Q.y > 2.55 - CAMH) continue;
    float t = (XR - Q.x) / uSunD.x;
    vec2 H = vec2(Q.z + t * uSunD.z, Q.y + t * uSunD.y + CAMH);
    float ap = aperture(H, max(t * 0.0047, 0.012));
    if (ap < 0.001) continue;
    acc += ap * (1.0 - foliage(Q, uSunD, t, 0.0)) * dz * dl;
  }
  float cosA = dot(normalize(d), uSunD), g = 0.35;
  float phase = (1.0 - g * g) / pow(1.0 + g * g + 2.0 * g * cosA, 1.5) / 12.566;
  gl_FragColor = vec4(vec3(clamp(acc * phase * 0.64 * 2.0, 0.0, 1.0)), 1.0);
}`;
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const mk = fs => {
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(prog, 0, 'a');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      return prog;
    };
    this.prog = mk(FS); this.progS = mk(FS_SHAFT);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const U = (prog, names) => { const o = {}; for (const n of names) o[n] = gl.getUniformLocation(prog, n); return o; };
    this.u = U(this.prog, ['uDayP', 'uHole', 'uDay', 'uEve', 'uOver', 'uStorm', 'uSun', 'uGeo', 'uLace', 'uShaft', 'uW', 'uNight', 'uImg', 'uWin', 'uAmb', 'uSunC', 'uWinC', 'uLamp',
      'uPhys', 'uSunK', 'uShaftK', 'uSunD', 'uGust', 'uAmp', 'uBillow', 'uPhase', 'uTime', 'uRain', 'uSlant']);
    this.uS = U(this.progS, ['uGeo', 'uImg', 'uTime', 'uSunD', 'uGust']);
    gl.useProgram(this.progS); gl.uniform2f(this.uS.uImg, IMG_W, IMG_H); gl.uniform1i(this.uS.uGeo, 5);
    gl.useProgram(this.prog); gl.uniform2f(this.u.uImg, IMG_W, IMG_H);
    /* Текстуры грузим по необходимости: сначала только то, что нужно текущей сцене,
       остальное — потом, в фоне. Пока картинки нет, на её месте чёрная заглушка 1×1. */
    this.srcs = { uDay: CFG.backgrounds.day.image, uEve: CFG.backgrounds.evening.image, uOver: CFG.backgrounds.overcast.image,
      uStorm: (CFG.backgrounds.storm || CFG.backgrounds.overcast).image, uSun: CFG.sun.map, uGeo: CFG.room.geo, uLace: CFG.room.lace };
    this.units = Object.keys(this.srcs); this.tex = {}; this.loading = {};
    this.units.forEach((k, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      const near = k === 'uGeo', rep = k === 'uLace';
      for (const [p, val] of [[gl.TEXTURE_MIN_FILTER, near ? gl.NEAREST : gl.LINEAR], [gl.TEXTURE_MAG_FILTER, near ? gl.NEAREST : gl.LINEAR],
        [gl.TEXTURE_WRAP_S, rep ? gl.REPEAT : gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, rep ? gl.REPEAT : gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, val);
      gl.uniform1i(this.u[k], i);
      this.tex[k] = t;
    });
    // буфер для лучей в воздухе (четверть разрешения)
    gl.activeTexture(gl.TEXTURE7);
    this.shaftTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.shaftTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [p, val] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, val);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.shaftTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.uniform1i(this.u.uShaft, 7);
    if (this.holeOK) {
      gl.activeTexture(gl.TEXTURE8); this.texP = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.texP);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      for (const [p, val] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, val);
      gl.uniform1i(this.u.uDayP, 8); gl.uniform4f(this.u.uHole, 0, 0, -1, 0);
    }
    return this.need(state.scene).then(() => { this.ok = true; this.resize(); this.dirty = true; return true; });
  },
  lost() {
    if (!this.ok && !BG.gl) return;
    console.warn('[Tube TV] WebGL-комната потеряла контекст — переходим на картинки');
    this.ok = false; BG.gl = false;
    const bg = $('#bg'); bg.classList.remove('gl'); if (this.c) this.c.remove();
    BG.preloadAll(); BG.rebuildSway();
    const cur = BG.current; BG.current = null; BG.show(cur || state.scene, true);
  },
  /* какие текстуры нужны сцене */
  unitsFor(scene) { return { day: ['uDay', 'uSun'], sunset: ['uDay', 'uSun', 'uGeo', 'uLace'], evening: ['uEve'], overcast: ['uOver'], storm: ['uStorm'], night: ['uStorm', 'uGeo', 'uLace'] }[scene] || []; },
  loadUnit(k) {
    if (this.loading[k]) return this.loading[k];
    const gl = this.gl, i = this.units.indexOf(k), src = this.srcs[k];
    this.imgs = this.imgs || {};
    const scene = ['uDay', 'uEve', 'uOver', 'uStorm'].includes(k) && CFG.vcr;
    return (this.loading[k] = new Promise((res, rej) => {
      const im = new Image(); im.decoding = 'async';
      im.onload = () => {
        const up = async () => {
          let src = im;
          if (scene) {                                  // видеомагнитофон дорисовывается в саму сцену
            try {
              if (k === 'uDay') { await this.loadUnit('uSun').catch(() => {}); }
              const sc = { uDay: 'day', uEve: 'evening', uOver: 'overcast', uStorm: 'storm' }[k];
              const plate = await new Promise(r => { const pl = new Image(); pl.onload = () => r(pl); pl.onerror = () => r(null); pl.src = `assets/eggs/sachet-plate-${sc}.png`; });
              src = VCR.compose(im, k, this.imgs.uSun, plate);
            } catch (e) { console.warn('[Tube TV] видик:', e); src = im; }
          }
          this.imgs[k] = im;
          if (k === 'uDay' && this.holeOK) this.buildPlates(src);
          gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, this.tex[k]);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
          if (k === 'uLace') { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
          this.dirty = true; this.loading[k].done = true; res();
        };
        (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(up);
      };
      im.onerror = () => { delete this.loading[k]; rej(new Error('img ' + src)); };
      im.src = src;
    }));
  },
  need(scene) { return Promise.all(this.unitsFor(scene).map(k => this.loadUnit(k))); },
  /* «день без пасхалок»: на закате, пока предмет в руках, под ним рисуется живой свет, а не застывшая подложка */
  buildPlates(dayCanvas) {
    const cv = document.createElement('canvas'); cv.width = dayCanvas.width || IMG_W; cv.height = dayCanvas.height || IMG_H;
    const g = cv.getContext('2d'); g.drawImage(dayCanvas, 0, 0, cv.width, cv.height);
    const sx = cv.width / IMG_W, sy = cv.height / IMG_H;
    const eggs = CFG.eggs.filter(e => e.sprite);
    let left = eggs.length;
    const upload = () => {
      const gl = this.gl; gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, this.texP);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      this.platesReady = true;
    };
    for (const e of eggs) {
      const im = new Image();
      im.onload = im.onerror = () => {
        if (im.naturalWidth) g.drawImage(im, e.sprite[0] * sx, e.sprite[1] * sy, e.sprite[2] * sx, e.sprite[3] * sy);
        if (--left === 0) upload();
      };
      im.src = Puppets.src(e.id, 'day', true);
    }
  },
  /* предмет «взяли в руки»: GL рисует под ним комнату без него; возвращает вырезку предмета в текущем свете */
  hole(box) {
    if (!this.holeOK || !this.platesReady || !this.ok) return null;
    const gl = this.gl;
    gl.useProgram(this.prog);
    if (!box) { gl.uniform4f(this.u.uHole, 0, 0, -1, 0); this.dirty = true; return null; }
    gl.uniform4f(this.u.uHole, box[0], box[1], box[2], box[3]); this.dirty = true;
    return true;
  },
  /* кусок текущего кадра комнаты (для вырезки предмета в живом свете) */
  grab(box) {
    if (!this.ok || !this.c) return null;
    const k = this.c.width / IMG_W, [x, y, w, h] = box;
    const cv = document.createElement('canvas'); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
    try { cv.getContext('2d').drawImage(this.c, x * k, y * k, w * k, h * k, 0, 0, cv.width, cv.height); return cv; } catch (_) { return null; }
  },
  preloadAll() { return Promise.all(this.units.map(k => this.loadUnit(k).catch(() => {}))); },

  resize() {
    if (!this.c) return;
    const st = state.stage, dpr = Math.min(devicePixelRatio || 1, HOVER ? 2 : 1.5);   // на телефонах — чуть легче
    const w = Math.max(2, Math.round(Math.min(st.w * dpr, IMG_W * 1.25))), h = Math.round(w * IMG_H / IMG_W);
    if (this.c.width !== w || this.c.height !== h) { this.c.width = w; this.c.height = h; this.dirty = true; }
    const sw = Math.max(2, Math.round(w / 4)), shh = Math.max(2, Math.round(h / 4));
    if (this.gl && (this.sw !== sw || this.shh !== shh)) {
      const gl = this.gl; this.sw = sw; this.shh = shh;
      gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, this.shaftTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, sw, shh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this.shaftDirty = true;
    }
  },

  /* ---------- солнце ----------
     s: 0 — день (как на фотографии), 1 — низкое закатное солнце (~5°), дальше — медленно садится.
     Высота и азимут → направление; цвет — пропускание атмосферы по воздушной массе (Kasten–Young). */
  sunState(s) {
    const S = CFG.sun.path;
    const e = s <= 1 ? S.e0 * Math.pow(1 - s, 1.25) + S.e1 * s : S.e1 - (s - 1) * S.drop;
    const a = S.a0 + (S.a1 - S.a0) * Math.min(s, 1) + Math.max(0, s - 1) * 8;
    const er = e * Math.PI / 180, ar = a * Math.PI / 180;
    const dir = [Math.cos(er) * Math.cos(ar), Math.sin(er), Math.cos(er) * Math.sin(ar)];
    const em = Math.max(e, 0.5);
    const m = 1 / (Math.sin(em * Math.PI / 180) + 0.50572 * Math.pow(em + 6.07995, -1.6364));
    const tau = [0.075, 0.16, 0.36];
    let col = tau.map(t => Math.exp(-t * m) / Math.exp(-t * 1.35));
    const mx = Math.max(...col), sm = clamp(s, 0, 1);
    const horizon = smooth(0.6, 3.2, e);
    col = col.map(c => c * (1 + 0.35 * sm) / Math.pow(mx, 0.35) * horizon * CFG.sun.gain);
    return { e, a, dir, col };
  },
  ambient(s) {
    const C = CFG.sun, x = clamp(s, 0, 1);
    const bz = (c0, c1, c2) => c0.map((_, i) => (1 - x) * (1 - x) * c0[i] + 2 * x * (1 - x) * c1[i] + x * x * c2[i]);
    const fade = s > 1 ? 1 - (s - 1) * 1.2 : 1;
    return { amb: bz([1, 1, 1], C.mid.amb, C.amb).map(v => v * fade), win: bz([1, 1, 1], C.mid.win, C.win).map(v => v * fade) };
  },

  target(scene) {
    const c = this.cur;
    return {
      day: { w: [1, 0, 0, 0], n: 0, s: 0, k: 1 }, sunset: { w: [1, 0, 0, 0], n: 0, s: 1, k: 1 },
      evening: { w: [0, 1, 0, 0], n: 0, s: c.s, k: 0.25 },
      night: { w: [0, 0, 0, 0], n: 1, s: c.s, k: 0 },
      overcast: { w: [0, 0, 1, 0], n: 0, s: c.s, k: c.k }, storm: { w: [0, 0, 0, 1], n: 0, s: c.s, k: c.k },
    }[scene];
  },
  go(scene, instant) {
    const T = this.target(scene); if (!T) return;
    if (this.ok && !this.unitsFor(scene).every(k => this.loading[k] && this.loading[k].done)) {
      this.need(scene).then(() => { if (state.scene === scene) this.go(scene, instant); }).catch(() => {});
      return;
    }
    const now = nowMs(), c = this.cur;
    this.scene = scene;
    if (instant) { this.cur = { w: T.w.slice(), n: T.n, s: T.s, k: T.k }; this.tw = {}; this.dirty = true; this.shaftDirty = true; return; }
    const sunMs = Math.abs(T.s - c.s) * (T.s > c.s ? CFG.sun.setMs : CFG.sun.riseMs);
    this.tw = {
      w: { from: c.w.slice(), to: T.w, t0: now, d: CFG.crossfadeMs },
      n: { from: c.n, to: T.n, t0: now, d: CFG.crossfadeMs * 1.4 },
      s: { from: c.s, to: T.s, t0: now, d: Math.max(1, sunMs), ease: 'sun' },
      k: { from: c.k, to: T.k, t0: now, d: CFG.crossfadeMs },
    };
  },
  busy() { return Object.keys(this.tw).length > 0; },
  step(t) {
    const ease = x => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    for (const [key, tw] of Object.entries(this.tw)) {
      const x = clamp((t - tw.t0) / tw.d, 0, 1), e = tw.ease === 'sun' ? 1 - Math.pow(1 - x, 2.2) : ease(x);
      this.cur[key] = Array.isArray(tw.from) ? tw.from.map((f, i) => lerp(f, tw.to[i], e)) : lerp(tw.from, tw.to, e);
      if (x >= 1) delete this.tw[key];
    }
    // на закате солнце продолжает медленно опускаться (за ~4 минуты — ещё на пару градусов)
    if (this.scene === 'sunset' && !this.tw.s && this.cur.s >= 1) {
      const dt = Math.min(0.1, (t - (this._st || t)) / 1000);
      this.cur.s = Math.min(1 + CFG.sun.path.drift, this.cur.s + dt / CFG.sun.path.driftSec * CFG.sun.path.drift);
    }
    this._st = t;
  },

  render(t) {
    if (!this.ok) return;
    const gl = this.gl, u = this.u, c = this.cur;
    const phys = c.w[0] > 0.001 && c.s > 0.001, night = c.n > 0.001;
    const live = phys || night;                      // свет из окна живой: тюль и листва шевелятся
    const full = this.dirty || this.busy();
    if (!full) {
      if (Camera.winHidden && !stageEl.classList.contains('moving') && !live) return;
      const fps = live ? 24 : 30;
      if (!(Weather.level > 0.001) && t - (this._lt || 0) < 1000 / fps - 2) return;
    }
    this._lt = t;
    this.step(t);
    const sun = this.sunState(c.s), A = this.ambient(c.s);
    const w = smooth(0, 0.18, c.s) * (phys ? 1 : 0);
    const time = (t / 1000) % 3600, gust = clamp((state.fx && state.fx.gust) || 0, 0, 1);
    // лучи в воздухе — в уменьшенный буфер, когда солнце движется или шевелится листва (12 раз в секунду)
    const shaftK = phys ? w * CFG.sun.shafts : 0;
    if (shaftK > 0.001 && (this.shaftDirty || this.tw.s || t - (this._sht || 0) > 80)) {
      this._sht = t; this.shaftDirty = false;
      gl.useProgram(this.progS);
      gl.uniform3fv(this.uS.uSunD, sun.dir); gl.uniform1f(this.uS.uTime, time); gl.uniform1f(this.uS.uGust, gust);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.disable(gl.SCISSOR_TEST);
      gl.viewport(0, 0, this.sw, this.shh);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(this.prog);
    }
    gl.uniform4f(u.uW, c.w[0], c.w[1], c.w[2], c.w[3]);
    gl.uniform1f(u.uNight, c.n);
    gl.uniform3fv(u.uAmb, A.amb.map(x => lerp(1, x, smooth(0, 1, Math.min(c.s, 1))))); gl.uniform3fv(u.uSunC, sun.col.map(x => lerp(1, x, w)));
    gl.uniform3fv(u.uWinC, A.win); gl.uniform3fv(u.uLamp, CFG.night.lamp);
    gl.uniform1f(u.uPhys, w); gl.uniform1f(u.uSunK, CFG.sun.k * c.k); gl.uniform1f(u.uShaftK, shaftK);
    gl.uniform3fv(u.uSunD, sun.dir); gl.uniform1f(u.uGust, gust);
    const z = zpx(CFG.zones.window);
    gl.uniform4f(u.uWin, z.x, z.y, z.x + z.w, z.y + z.h);
    gl.uniform1f(u.uAmp, REDUCED ? 0 : this.wind.amp);
    gl.uniform1f(u.uBillow, REDUCED ? 0 : this.wind.billow);
    gl.uniform1f(u.uPhase, this.wind.phase);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uRain, Weather.level || 0);
    gl.uniform1f(u.uSlant, 0.12 + Wind.w * 0.25);
    const W = this.c.width, H = this.c.height, kx = W / IMG_W;
    gl.viewport(0, 0, W, H);
    if (full || live) { gl.disable(gl.SCISSOR_TEST); this.dirty = false; }
    else {                                              // в покое перерисовываем только окно с тюлем
      const x0 = Math.max(0, Math.floor((z.x - 140) * kx)), y1 = Math.ceil((z.y + z.h + 4) * kx);
      gl.enable(gl.SCISSOR_TEST); gl.scissor(x0, H - Math.min(H, y1), W - x0, Math.min(H, y1));
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  },
};

const BG = {
  layers: {}, bds: {}, z: 1, current: null,
  DISP: 90,                                   // общий масштаб смещения; волны и «парус» дозируются коэффициентами
  init() {
    const bg = $('#bg'), bd = $('.backdrop');
    for (const [scene, def] of Object.entries(CFG.backgrounds)) {
      const layer = document.createElement('div');
      layer.className = 'bg-layer is-hidden'; layer.dataset.scene = scene;
      const img = new Image();
      img.dataset.src = def.image; img.alt = ''; img.decoding = 'async'; img.draggable = false;   // src — только когда сцена понадобится
      layer.appendChild(img);
      if (CFG.hires && CFG.hires.images[scene]) {
        if (!this.hiresWrap) { this.hiresWrap = document.createElement('div'); this.hiresWrap.className = 'hires-wrap'; }
        const hr = new Image(); hr.className = 'hires'; hr.alt = ''; hr.decoding = 'async';
        hr.dataset.src = CFG.hires.images[scene]; hr.dataset.scene = scene;
        const [x, y, w, h] = CFG.hires.box;
        Object.assign(hr.style, { left: x / IMG_W * 100 + '%', top: y / IMG_H * 100 + '%', width: w / IMG_W * 100 + '%', height: h / IMG_H * 100 + '%' });
        hr.addEventListener('load', () => hr.classList.add('loaded'));
        this.hiresWrap.appendChild(hr);
      }
      if (def.video) {
        const v = this.video(def.video, def.image);
        v.addEventListener('error', () => { v.remove(); this.addSway(layer, scene); });
        v.addEventListener('playing', () => { img.style.visibility = 'hidden'; }, { once: true });
        layer.appendChild(v);
      } else if (def.windowVideo) {
        const v = this.video(def.windowVideo, null);
        v.className = 'window-video'; placeEl(v, CFG.zones.window);
        v.addEventListener('error', () => { v.remove(); this.addSway(layer, scene); });
        layer.appendChild(v);
      } else this.addSway(layer, scene);
      bg.appendChild(layer); this.layers[scene] = layer;
      const b = document.createElement('div'); b.className = 'bd'; b.dataset.src = def.image; b.style.opacity = 0;
      bd.appendChild(b); this.bds[scene] = b;
    }
    if (this.hiresWrap) bg.appendChild(this.hiresWrap);
  },
  /* WebGL-комната готова: прячем картинки, выключаем SVG-фильтры */
  enableGL() {
    this.gl = true;
    const bg = $('#bg');
    bg.insertBefore(GLRoom.c, this.hiresWrap || null);
    for (const l of Object.values(this.layers)) { const s = l.querySelector('svg.sway'); if (s) s.remove(); }
    GLRoom.go(state.scene, true);
    requestAnimationFrame(() => { GLRoom.c.classList.add('on'); setTimeout(() => bg.classList.add('gl'), 700); requestAnimationFrame(() => Boot.done()); });
  },
  video(src, poster) {
    const v = document.createElement('video');
    Object.assign(v, { src, autoplay: true, muted: true, loop: true, playsInline: true, preload: 'auto' });
    if (poster) v.poster = poster;
    v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
    v.play().catch(() => {});
    return v;
  },
  /* Перекрёстная смена без «провала»: новый слой кладём сверху и проявляем, старый прячем потом */
  show(scene, instant) {
    if (this.current === scene || !this.layers[scene]) return;
    this.current = scene;
    if (this.hiresWrap) for (const h of this.hiresWrap.children) h.classList.toggle('on', h.dataset.scene === scene);
    if (this.gl) GLRoom.go(scene, instant);
    this.load(scene);
    const z = ++this.z;
    for (const [el, others] of [[this.layers[scene], this.layers], [this.bds[scene], this.bds]]) {
      el.classList.remove('is-hidden'); el.style.zIndex = z;
      el.style.transition = 'none'; el.style.opacity = instant ? 1 : 0;
      if (!instant) { void el.offsetWidth; el.style.transition = `opacity ${CFG.crossfadeMs}ms ease`; el.style.opacity = 1; }
    }
    clearTimeout(this._t);
    const hideOthers = () => {
      for (const [s, l] of Object.entries(this.layers)) if (s !== this.current) { l.style.transition = 'none'; l.style.opacity = 0; l.classList.add('is-hidden'); }
      for (const [s, b] of Object.entries(this.bds)) if (s !== this.current) { b.style.transition = 'none'; b.style.opacity = 0; }
    };
    if (instant) hideOthers(); else this._t = setTimeout(hideOthers, CFG.crossfadeMs + 60);
  },
  /* картинка сцены: в WebGL-режиме нужна только размытая подложка, иначе — и сам слой */
  load(scene) {
    const b = this.bds[scene];
    if (b && b.dataset.src) { b.style.backgroundImage = `url("${b.dataset.src}")`; delete b.dataset.src; }
    const img = !this.gl && this.layers[scene] && this.layers[scene].querySelector('img');
    if (img && img.dataset.src) { img.src = img.dataset.src; delete img.dataset.src; img.addEventListener('load', () => { if (!GLRoom.ok) setTimeout(() => !GLRoom.ok && Boot.done(), 1200); }, { once: true }); }
    const si = !this.gl && this.layers[scene] && this.layers[scene].querySelector('svg.sway image[data-href]');
    if (si) { si.setAttribute('href', si.dataset.href); si.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', si.dataset.href); si.removeAttribute('data-href'); }
  },
  preloadAll() { for (const s of Object.keys(this.layers)) this.load(s); },
  loadHires() {
    if (this.hiresWrap) for (const h of this.hiresWrap.children) if (!h.src) h.src = h.dataset.src;
  },

  /* Карта смещения. R — волны по горизонтали, G — подъём подола на порывах.
     Ширина карты кратна периоду, поэтому бегущая волна зацикливается без шва. */
  makeMaps(zw, zh, P, ext = 0) {
    const sx = 0.5, Pp = Math.round(P * sx);
    const w = Math.ceil((zw + ext) * sx / Pp) * Pp + Pp * 2, h = Math.ceil(zh * sx);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); const id = g.createImageData(w, h); const d = id.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = (x / Pp) * Math.PI * 2, yn = y / h;
      const v = 0.55 * Math.sin(k + y * 0.020) + 0.30 * Math.sin(2 * k - y * 0.012 + 1.3) + 0.15 * Math.sin(3 * k + y * 0.034 + 0.4);
      const lift = smooth(0.62, 0.97, yn) * (0.75 + 0.25 * Math.sin(k + 0.7));
      const i = (y * w + x) * 4;
      d[i] = 128 + 127 * clamp(v, -1, 1); d[i + 1] = 128 - 70 * lift; d[i + 2] = 128; d[i + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    const ew = Math.ceil((zw + ext) * sx), ex = Math.round(ext * sx), ew0 = ew - ex;
    const c2 = document.createElement('canvas'); c2.width = ew; c2.height = h;
    const g2 = c2.getContext('2d'); const id2 = g2.createImageData(ew, h); const e = id2.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < ew; x++) {
      const xn = (x - ex) / ew0, yn = y / h;
      const env = xn < 0 ? 0 : smooth(0, 0.14, xn) * (1 - smooth(0.95, 1, xn)) * smooth(0.03, 0.75, yn) * (1 - smooth(0.93, 0.995, yn));
      const i = (y * ew + x) * 4, v = 255 * env;
      e[i] = v; e[i + 1] = v; e[i + 2] = v; e[i + 3] = 255;
    }
    g2.putImageData(id2, 0, 0);
    // «парус»: на порыве подол выгибается внутрь комнаты (влево), верх на карнизе неподвижен,
    // правый край у стены не двигается, по ширине — две волны складок
    // карта шире окна на ext: подол может заходить на тяжёлую штору слева
    const lw = Math.ceil((zw + ext) * sx), e0 = ext / (zw + ext);
    const c3 = document.createElement('canvas'); c3.width = lw; c3.height = h;
    const g3 = c3.getContext('2d'); const id3 = g3.createImageData(lw, h); const l = id3.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < lw; x++) {
      const xn = x / lw, yn = y / h;
      const prof = Math.pow(smooth(0.28, 1, yn), 2) * (1 - smooth(0.8, 1, xn)) * smooth(0, e0 + 0.12, xn);
      const folds = 0.8 + 0.2 * Math.sin(xn * 9 + yn * 3);
      const v = 0.5 + 0.47 * prof * folds;
      const i = (y * ew + x) * 4;
      l[i] = 255 * v; l[i + 1] = 128 + 40 * prof; l[i + 2] = 128; l[i + 3] = 255;
    }
    g3.putImageData(id3, 0, 0);
    // мягкая маска: фильтрованный слой плавно растворяется к краям, чтобы не было шва
    const c4 = document.createElement('canvas'); c4.width = lw; c4.height = h;
    const g4 = c4.getContext('2d'); const id4 = g4.createImageData(lw, h); const q = id4.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < lw; x++) {
      const xn = x / lw, yn = y / h, i = (y * lw + x) * 4;
      q[i] = q[i + 1] = q[i + 2] = 255; q[i + 3] = 255 * smooth(0, e0 * 0.7, xn) * (1 - smooth(0.97, 1, yn));
    }
    g4.putImageData(id4, 0, 0);
    return { wave: c.toDataURL(), env: c2.toDataURL(), lean: c3.toDataURL(), mask: c4.toDataURL(), ww: w / sx, period: Pp / sx };
  },
  addSway(layer, scene) {
    if (REDUCED) return;
    const old = layer.querySelector('svg.sway'); if (old) old.remove();
    const z = zpx(CFG.zones.window);
    const ext = Math.min(z.x, 150);
    if (!this._maps || this._mapsFor !== JSON.stringify(z)) { this._maps = this.makeMaps(z.w, z.h, 120, ext); this._mapsFor = JSON.stringify(z); }
    const m = this._maps, id = 'sway-' + scene, href = CFG.backgrounds[scene].image;
    const svg = `
<svg class="sway" viewBox="0 0 ${IMG_W} ${IMG_H}" preserveAspectRatio="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <filter id="${id}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB"
            x="${z.x - ext}" y="${z.y}" width="${z.w + ext}" height="${z.h}">
      <feImage href="${m.wave}" xlink:href="${m.wave}" x="${z.x - ext}" y="${z.y}" width="${m.ww}" height="${z.h}" preserveAspectRatio="none" result="wave0"/>
      <feOffset in="wave0" dx="0" result="wave"/>
      <feImage href="${m.env}" xlink:href="${m.env}" x="${z.x - ext}" y="${z.y}" width="${z.w + ext}" height="${z.h}" preserveAspectRatio="none" result="env"/>
      <feComposite in="wave" in2="env" operator="arithmetic" k1="0.08" k2="0" k3="-0.04" k4="0.5" result="mapW"/>
      <feImage href="${m.lean}" xlink:href="${m.lean}" x="${z.x - ext}" y="${z.y}" width="${z.w + ext}" height="${z.h}" preserveAspectRatio="none" result="lean"/>
      <feComposite in="mapW" in2="lean" operator="arithmetic" k1="0" k2="1" k3="0" k4="0" result="map0"/>
      <feGaussianBlur in="map0" stdDeviation="2.5" result="map"/>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="${BG.DISP}" xChannelSelector="R" yChannelSelector="G" result="disp"/>
      <feImage href="${m.mask}" xlink:href="${m.mask}" x="${z.x - ext}" y="${z.y}" width="${z.w + ext}" height="${z.h}" preserveAspectRatio="none" result="mask"/>
      <feComposite in="disp" in2="mask" operator="in"/>
    </filter>
  </defs>
  <image data-href="${href}" x="0" y="0" width="${IMG_W}" height="${IMG_H}" preserveAspectRatio="none" filter="url(#${id})"/>
</svg>`;
    layer.insertAdjacentHTML('beforeend', svg);
    layer._off = layer.querySelector('feOffset'); layer._disp = layer.querySelector('feDisplacementMap');
    const comps = layer.querySelectorAll('feComposite'); layer._amp = comps[0]; layer._lean = comps[1];
    const img = layer.querySelector('img');
    if (img && !img.dataset.src) { const g = this.gl; this.gl = false; this.load(scene); this.gl = g; }   // сцена уже загружена — сразу
  },
  rebuildSway() { if (this.gl) return; for (const [s, l] of Object.entries(this.layers)) if (!l.querySelector('video')) this.addSway(l, s); },
};

/* Ветер: тихое дыхание + порывы (нарастают за 1–2 с, держатся, стихают за 3–5 с).
   Двигает тюль, пылинки и звук ветра в окне. В дождь порывы чаще и сильнее. */
const Wind = {
  w: 0.1, phase: 0, gust: null, nextGust: nowMs() + 4000, lastApply: 0,
  power() { return CFG.wind.weather[state.weather] || 1; },
  update(t, dt) {
    const W = CFG.wind, S = this.power();
    if (!this.gust && t > this.nextGust) {
      this.gust = { t0: t, a: rand(...W.attackMs), h: rand(...W.holdMs), d: rand(...W.decayMs), peak: rand(W.gustMin, W.gustMax) * S };
    }
    let g = 0;
    if (this.gust) {
      const q = this.gust, e = t - q.t0;
      if (e < q.a) g = q.peak * (0.5 - 0.5 * Math.cos(Math.PI * e / q.a));
      else if (e < q.a + q.h) g = q.peak * (0.9 + 0.1 * Math.sin(e * 0.009));
      else if (e < q.a + q.h + q.d) g = q.peak * Math.pow(1 - (e - q.a - q.h) / q.d, 1.8);
      else { this.gust = null; this.nextGust = t + rand(...W.everyMs) / S; }
    }
    const base = W.calm * (1 + 0.4 * Math.sin(t * 0.00071) + 0.25 * Math.sin(t * 0.0019));
    const turb = g * 0.12 * Math.sin(t * 0.013) * Math.sin(t * 0.0047);
    this.w = lerp(this.w, base + g + turb, Math.min(1, dt / 120));
    this.phase += dt / 1000 * (10 + 75 * this.w);
    if (t - this.lastApply > 33) {                                    // ~30 к/с для фильтра
      this.lastApply = t;
      const open = 0.25 + 0.75 * clamp(state.vent / 0.7, 0, 1);          // закрытая форточка — ветра почти нет
      const a = ((W.scaleCalm + W.scaleGust * this.w) * open / BG.DISP);   // амплитуда мелких волн
      this.billow = lerp(this.billow || 0, clamp(g / Math.max(0.01, W.gustMax), 0, 1.4) * W.billow * open, Math.min(1, dt / 90));
      const b = this.billow, P = BG._maps ? BG._maps.period : 120;
      const dx = (-(this.phase % P)).toFixed(2);
      for (const l of Object.values(BG.layers)) {
        if (l.classList.contains('is-hidden') || !l._disp) continue;
        l._off.setAttribute('dx', dx);
        l._amp.setAttribute('k1', a.toFixed(4)); l._amp.setAttribute('k3', (-a / 2).toFixed(4));
        // map0 = mapW + b·(lean − 0.5)
        l._lean.setAttribute('k3', b.toFixed(3)); l._lean.setAttribute('k4', (-b / 2).toFixed(3));
      }
      GustLight.set(b);
      GLRoom.wind.amp = a * BG.DISP * 0.5;                 // px
      GLRoom.wind.billow = b * (W.billowPx || 22);          // px
      GLRoom.wind.phase = this.phase;
      Sound.wind(this.w * (0.3 + 0.7 * clamp(state.vent / 0.7, 0, 1)));
    }
  },
};

/* Свет, который врывается в комнату, когда порыв приподнимает тюль */
const GustLight = {
  el: null, v: -1,
  set(b) {
    if (!this.el) this.el = $('#gustLight');
    const k = (state.fx && state.fx.gust || 0) * clamp(b, 0, 1.2);
    const v = k < 0.004 ? 0 : +k.toFixed(3);
    if (v !== this.v) { this.el.style.opacity = v; this.el.style.display = v ? '' : 'none'; this.v = v; }
  },
};

/* Переключение сцены */
function applyScene(instant) {
  state.scene = sceneOf(state.mode, state.weather);
  const b = document.body.classList;
  b.toggle('evening', state.mode === 'evening');
  for (const k of ['day', 'sunset', 'evening', 'night']) b.toggle('time-' + k, state.mode === k);
  for (const k of ['clear', 'drizzle', 'downpour']) b.toggle('weather-' + k, state.weather === k);
  root.style.setProperty('--scene', `url("${CFG.backgrounds[state.scene].image}")`);
  root.style.setProperty('--gust-rgb', (CFG.light.scenes[state.scene].gustColor || [255, 230, 190]).join(','));
  BG.show(state.scene, instant);
  state.fxFrom = Object.assign({}, state.fx || sceneFx()); state.fxTo = sceneFx(); state.fxT0 = instant ? 0 : nowMs();
  if (instant) state.fx = Object.assign({}, state.fxTo);
  Puppets.setMode && Puppets.items && Puppets.setMode(state.scene);
  Radio.setScene(state.scene);
  Sound.setScene();
  Weather.set(state.weather);
  Dust.setScene();
  Zones.refreshLabels();
}
function setMode(time) { if (time === state.mode) return; state.mode = time; applyScene(); }
function setWeather(w) { if (w === state.weather) return; state.weather = w; applyScene(); }
const nextIn = (list, v) => list[(list.indexOf(v) + 1) % list.length];

/* ==========================================================================
   3. ТЕЛЕВИЗОР: «эфир» рисуется в 2D-холст, кинескоп — WebGL-шейдер
   ========================================================================== */
const VERT = `attribute vec2 p; varying vec2 vUv; void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uTime, uSx, uSy, uBoost, uDot, uStatic, uFlicker, uCurv, uScan, uGrain;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main(){
  vec2 c = vUv * 2.0 - 1.0;
  c += c * (c.yx * c.yx) * uCurv;                      // бочка
  vec2 uv = c * 0.5 + 0.5;
  vec2 e = smoothstep(vec2(0.0), vec2(0.015), uv) * smoothstep(vec2(0.0), vec2(0.015), 1.0 - uv);
  float inside = e.x * e.y;

  vec2 d = uv - 0.5;
  vec2 hs = max(vec2(uSx, uSy) * 0.5, vec2(0.0035));
  float m = smoothstep(hs.x + 0.004, hs.x - 0.002, abs(d.x)) * smoothstep(hs.y + 0.004, hs.y - 0.002, abs(d.y));
  m *= step(0.00001, uSx * uSy);
  vec2 suv = clamp(0.5 + d / max(vec2(uSx, uSy), vec2(0.004)), 0.0, 1.0);

  vec3 col = texture2D(uTex, suv).rgb;
  vec3 bl = texture2D(uTex, suv + vec2(0.007, 0.0)).rgb + texture2D(uTex, suv - vec2(0.007, 0.0)).rgb
          + texture2D(uTex, suv + vec2(0.0, 0.009)).rgb + texture2D(uTex, suv - vec2(0.0, 0.009)).rgb;
  col += bl * 0.07;                                    // ореол

  float tf = floor(uTime * 30.0);
  float n = hash(floor(uv * vec2(230.0, 175.0)) + tf * 1.731);
  float band = 0.82 + 0.18 * sin(uv.y * 11.0 + uTime * 7.0);
  float roll = smoothstep(0.0, 0.06, abs(fract(uv.y * 0.9 - uTime * 0.35) - 0.5));
  col = mix(col, vec3(n * band * (0.7 + 0.3 * roll)), uStatic);

  float sl = 0.74 + 0.26 * sin(uv.y * uScan * 6.28318);
  col *= sl;
  col *= 1.0 + uFlicker * (0.03 * sin(uTime * 59.0) + 0.025 * (hash(vec2(tf, 3.0)) - 0.5));
  col += (hash(gl_FragCoord.xy + fract(uTime * 7.0) * 91.0) - 0.5) * uGrain;

  vec2 vv = uv * (1.0 - uv);
  col *= pow(clamp(vv.x * vv.y * 16.0, 0.0, 1.0), 0.3);

  col *= m;
  col = mix(col, vec3(0.95, 0.97, 1.0) * m, clamp(uBoost * 0.35, 0.0, 1.0));
  col *= 1.0 + uBoost * 0.55;

  float dist = length((vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0));
  col += vec3(0.86, 0.92, 1.0) * uDot * (exp(-dist * dist * 1400.0) * 1.8 + exp(-dist * 26.0) * 0.35);

  gl_FragColor = vec4(max(col, 0.0) * inside, 1.0);
}`;

const TV = {
  el: $('#tvScreen'), canvas: $('#tvCanvas'),
  on: false, anim: null, ch: 0, level: 0,
  burstUntil: 0, osdChUntil: 0, osdVolUntil: 0,
  avg: [0.6, 0.65, 0.75], avgLum: 0.5, lastSample: 0,
  t0: nowMs(),

  init() {
    const [cw, chh] = CFG.screen.resolution;
    this.content = document.createElement('canvas');
    this.content.width = cw; this.content.height = chh;
    this.cx = this.content.getContext('2d');
    this.sample = document.createElement('canvas'); this.sample.width = 8; this.sample.height = 6;
    this.sx = this.sample.getContext('2d', { willReadFrequently: true });
    root.style.setProperty('--screen-radius', CFG.screen.radius);
    this.initGL();
  },

  initGL() {
    const gl = this.canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, powerPreference: 'low-power' });
    if (!gl) { this.c2d = this.canvas.getContext('2d'); return; }
    if (!this._lossBound) {                // iOS отбирает WebGL при нехватке памяти — ждём и поднимаем заново
      this._lossBound = true;
      this.canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.gl = null; });
      this.canvas.addEventListener('webglcontextrestored', () => { this.initGL(); this.resize(); });
    }
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    try {
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      this.u = {};
      for (const n of ['uTex', 'uRes', 'uTime', 'uSx', 'uSy', 'uBoost', 'uDot', 'uStatic', 'uFlicker', 'uCurv', 'uScan', 'uGrain']) this.u[n] = gl.getUniformLocation(prog, n);
      gl.uniform1i(this.u.uTex, 0);
      this.gl = gl;
    } catch (err) {
      console.warn('[Tube TV] WebGL недоступен, упрощённый режим:', err);
      this.gl = null;
    }
  },

  resize() {
    placeEl(this.el, CFG.zones.screen); Embed.resize();
    const z = zpx(CFG.zones.screen), u = state.stage.u * (state.zoom || 1);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(z.w * u * dpr)), h = Math.max(2, Math.round(z.h * u * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    if (this.gl) this.gl.viewport(0, 0, w, h);
  },

  channel() { return CFG.channels[this.ch]; },

  /* Анимация включения/выключения: возвращает форму «засветки» */
  shape(t) {
    const a = this.anim;
    if (!a) return this.on ? { sx: 1, sy: 1, boost: 0, dot: 0, st: 0 } : null;
    const p = clamp((t - a.t0) / a.dur, 0, 1);
    let r;
    if (a.type === 'on') {
      if (p < 0.07) r = { sx: 0, sy: 0, boost: 0, dot: 0, st: 0 };
      else if (p < 0.22) { const q = (p - 0.07) / 0.15; r = { sx: easeOut(q), sy: 0.006, boost: 2.6, dot: 0, st: 0 }; }
      else if (p < 0.62) { const q = (p - 0.22) / 0.40; r = { sx: 1, sy: 0.006 + 0.994 * easeOut(q), boost: 2.6 * (1 - q) + 0.35, dot: 0, st: 0.35 * q }; }
      else { const q = (p - 0.62) / 0.38; r = { sx: 1, sy: 1, boost: 0.35 * (1 - q), dot: 0, st: 0.35 * (1 - q) }; }
    } else {
      if (p < 0.28) { const q = p / 0.28; r = { sx: 1, sy: 1 - 0.992 * easeIn(q), boost: 1.6 * q, dot: 0, st: 0 }; }
      else if (p < 0.45) { const q = (p - 0.28) / 0.17; r = { sx: 1 - 0.99 * easeIn(q), sy: 0.008, boost: 1.6 + 1.4 * q, dot: 0, st: 0 }; }
      else { const q = (p - 0.45) / 0.55; r = { sx: 0, sy: 0, boost: 0, dot: Math.pow(1 - q, 1.7) * 1.15, st: 0 }; }
    }
    if (p >= 1) {
      this.anim = null;
      if (!this.on) { this.el.classList.remove('live'); return null; }
    }
    return r;
  },

  powerOn() {
    if (this.on) return;
    this.on = true;
    this.anim = { type: 'on', t0: nowMs(), dur: CFG.tv.powerOnMs };
    this.el.classList.add('live');
    Sound.tvOn();
    clearTimeout(this._aud);
    this._aud = setTimeout(() => { if (this.on) Sound.startChannel(this.channel()); }, CFG.tv.powerOnMs * 0.4);
    this.activateVideo(true);
    UI.onTvOn();
  },
  powerOff() {
    if (!this.on) return;
    this.on = false;
    this.anim = { type: 'off', t0: nowMs(), dur: CFG.tv.powerOffMs };
    clearTimeout(this._aud);
    Sound.tvOff();
    this.activateVideo(false);
  },
  toggle() { this.on ? this.powerOff() : this.powerOn(); },

  setChannel(i) {
    const n = CFG.channels.length;
    this.activateVideo(false);
    this.ch = ((i % n) + n) % n;
    this.burstUntil = nowMs() + CFG.tv.staticBurstMs;
    this.osdChUntil = nowMs() + 2200;
    Sound.channelClick(this.on);
    if (this.on) { Sound.startChannel(this.channel()); this.activateVideo(true); }
  },

  /* ---- видео-каналы: плейлист, новый ролик при каждом переключении ---- */
  clips(ch) { return ch.playlist && ch.playlist.length ? ch.playlist : (ch.src ? [ch.src] : []); },
  nextClip(ch) {
    const list = this.clips(ch); ch._bad = ch._bad || new Set();
    const ok = list.filter(s => !ch._bad.has(s));
    if (!ok.length) return null;
    let pick;
    if (ch.order === 'shuffle') { do pick = pick2(ok); while (ok.length > 1 && pick === ch._cur); }
    else { const i = list.indexOf(ch._cur); for (let k = 1; k <= list.length; k++) { const c = list[(i + k) % list.length]; if (!ch._bad.has(c)) { pick = c; break; } } }
    ch._cur = pick;
    return pick;
  },
  getVideo(ch) {
    if (ch._video) return ch._video;
    const v = document.createElement('video');
    v.playsInline = true; v.preload = 'auto'; v.setAttribute('playsinline', '');
    ch._ok = false;
    v.addEventListener('loadedmetadata', () => {
      if (ch.live && isFinite(v.duration) && v.duration > 4) v.currentTime = (Date.now() / 1000) % (v.duration - 2);
    });
    v.addEventListener('loadeddata', () => { ch._ok = true; });
    v.addEventListener('ended', () => { if (this.on && this.channel() === ch) this.loadClip(ch); });
    v.addEventListener('error', () => {
      ch._ok = false;
      if (ch._cur) ch._bad.add(ch._cur);
      if (this.on && this.channel() === ch && this.clips(ch).some(s => !ch._bad.has(s))) this.loadClip(ch);
    });
    ch._video = v;
    return v;
  },
  loadClip(ch) {
    const v = this.getVideo(ch), src = this.nextClip(ch);
    if (!src) { ch._ok = false; return; }
    ch._ok = false;
    v.loop = this.clips(ch).length === 1;
    v.src = src;
    Sound.routeVideo(ch, v);
    v.play().catch(() => {});
    this.burstUntil = nowMs() + CFG.tv.staticBurstMs;
  },
  activateVideo(on) {
    const ch = this.channel();
    if (ch && ch.type === 'youtube') { if (on && this.on) Embed.play(ch); else Embed.stop(); return; }
    if (ch && ch.type === 'vcr') {                       // видео с кассеты: только если кассета в видике
      Embed.el.classList.toggle('vhs', on && this.on && VCR.loaded);
      if (on && this.on && VCR.loaded) Embed.play(ch); else Embed.stop();
      return;
    }
    if (!ch || ch.type !== 'video') return;
    if (on && this.on) this.loadClip(ch);
    else if (ch._video) ch._video.pause();
  },

  /* ---- отрисовка эфира ---- */
  drawContent(t) {
    const g = this.cx, W = this.content.width, H = this.content.height, ch = this.channel();
    const sec = (t - this.t0) / 1000;
    switch (ch.type) {
      case 'testcard': Channels.testcard(g, W, H, sec, ch); break;
      case 'morning':  Channels.morning(g, W, H, sec, ch); break;
      case 'video': {
        const v = ch._video;
        if (v && ch._ok && v.readyState >= 2) {
          const ar = (v.videoWidth / v.videoHeight) || 4 / 3;
          if (ar > W / H + 0.05) { const h = W / ar; g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.drawImage(v, 0, (H - h) / 2, W, h); }
          else g.drawImage(v, 0, 0, W, H);
        }
        else Channels.noVideo(g, W, H, sec, ch, this.ch + 1);
        break;
      }
      case 'vcr':
        if (!VCR.loaded) { Channels.avBlue(g, W, H, sec); break; }
        // fallthrough — кассета играет, как YouTube-канал
      case 'youtube': {
        if (Embed.failed) { Channels.noVideo(g, W, H, sec, ch, this.ch + 1, Embed.msg); break; }
        g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
        const txt = Embed.screenText();
        if (txt) Channels.tuning(g, W, H, sec, ch, txt);
        break;
      }
      default: g.fillStyle = '#777'; g.fillRect(0, 0, W, H);
    }
    Channels.osd(g, W, H, t, this);
  },

  render(t) {
    const s = this.shape(t);
    Embed.shape(s);
    if (!s) { this.level = 0; return; }
    const ch = this.channel();
    const burst = clamp((this.burstUntil - t) / CFG.tv.staticBurstMs, 0, 1);
    const st = Math.max(ch.type === 'static' ? 1 : 0, burst, s.st);
    if (s.sx * s.sy > 0) this.drawContent(t);

    if (t - this.lastSample > 110) { this.lastSample = t; this.sampleAvg(st); }
    this.level = s.sx * s.sy * (1 + s.boost * 0.5) + s.dot * 0.35;

    const gl = this.gl;
    if (gl) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.content);
      const u = this.u, W = this.canvas.width, H = this.canvas.height;
      gl.uniform2f(u.uRes, W, H);
      gl.uniform1f(u.uTime, ((t - this.t0) / 1000) % 600);   // время по кругу: на iPhone шейдер считает в 16 битах
      gl.uniform1f(u.uSx, s.sx); gl.uniform1f(u.uSy, s.sy);
      gl.uniform1f(u.uBoost, s.boost); gl.uniform1f(u.uDot, s.dot);
      gl.uniform1f(u.uStatic, st);
      gl.uniform1f(u.uFlicker, REDUCED ? 0 : 1);
      gl.uniform1f(u.uCurv, CFG.screen.curvature);
      gl.uniform1f(u.uScan, Math.min(240, H / 2.6));
      const yt = (ch.type === 'youtube' || ch.type === 'vcr') && Embed.showing();
      gl.uniform1f(u.uGrain, (REDUCED ? 0.02 : 0.07) * (yt ? CFG.embed.crt : 1));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else if (this.c2d) {
      const c = this.c2d, W = this.canvas.width, H = this.canvas.height;
      c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
      if (s.sx * s.sy > 0) {
        const w = W * s.sx, h = Math.max(2, H * s.sy);
        c.globalAlpha = 1; c.drawImage(this.content, (W - w) / 2, (H - h) / 2, w, h);
        if (st > 0) { c.globalAlpha = st * 0.8; c.fillStyle = `rgb(${120 + Math.random() * 80 | 0},${120 + Math.random() * 80 | 0},${120 + Math.random() * 80 | 0})`; c.fillRect(0, 0, W, H); }
        c.globalAlpha = 1;
      }
      if (s.dot > 0) { const r = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, H * 0.12);
        r.addColorStop(0, `rgba(230,240,255,${s.dot})`); r.addColorStop(1, 'rgba(230,240,255,0)'); c.fillStyle = r; c.fillRect(0, 0, W, H); }
    }
  },

  /* Средний цвет экрана — для свечения на стене */
  sampleAvg(st) {
    let r = 0.6, g = 0.62, b = 0.68;
    if ((this.channel().type === 'youtube' || this.channel().type === 'vcr') && Embed.showing()) {          // пиксели плеера недоступны — «живое» голубое мерцание
      const k = nowMs() / 1000;
      const v = 0.45 + 0.25 * Math.sin(k * 1.3) * Math.sin(k * 0.37) + 0.1 * Math.random();
      this.avg = [v * 0.85, v * 0.92, v * 1.05]; this.avgLum = v; return;
    }
    try {
      this.sx.drawImage(this.content, 0, 0, 8, 6);
      const d = this.sx.getImageData(0, 0, 8, 6).data;
      let R = 0, G = 0, B = 0;
      for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; }
      const n = d.length / 4 * 255; r = R / n; g = G / n; b = B / n;
    } catch (_) { const c = CFG.light.idleGlowColor; r = c[0] / 255; g = c[1] / 255; b = c[2] / 255; }
    r = lerp(r, 0.6, st); g = lerp(g, 0.62, st); b = lerp(b, 0.68, st);
    this.avg = [r, g, b];
    this.avgLum = 0.299 * r + 0.587 * g + 0.114 * b;
  },
};

/* ---------- содержимое каналов ---------- */
const PIX = '"Press Start 2P", ui-monospace, monospace';
const Channels = {
  _test: null,
  testBase(W, H) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#6f6f6f'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#e8e8e8'; g.lineWidth = 2;
    for (let x = 0; x <= W; x += 30) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke(); }
    for (let y = 0; y <= H; y += 30) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke(); }
    // шашечки по краям
    for (let x = 0; x < W; x += 30) { g.fillStyle = (x / 30) % 2 ? '#111' : '#f2f2f2'; g.fillRect(x, 0, 30, 14); g.fillStyle = (x / 30) % 2 ? '#f2f2f2' : '#111'; g.fillRect(x, H - 14, 30, 14); }
    // угловые круги
    for (const [x, y] of [[62, 66], [W - 62, 66], [62, H - 66], [W - 62, H - 66]]) {
      g.beginPath(); g.arc(x, y, 36, 0, Math.PI * 2); g.fillStyle = '#f2f2f2'; g.fill();
      g.beginPath(); g.arc(x, y, 36, Math.PI / 2, Math.PI * 1.5); g.fillStyle = '#111'; g.fill();
      g.beginPath(); g.arc(x, y, 36, 0, Math.PI * 2); g.lineWidth = 2; g.strokeStyle = '#ddd'; g.stroke();
    }
    // большой круг
    const cx = W / 2, cy = H / 2, R = 152;
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#1b1b1b'; g.fillRect(cx - R, cy - R, R * 2, R * 2);
    const bars = ['#f4f4f4', '#f2e33a', '#3fd6e0', '#43c443', '#d64ad6', '#e23b3b', '#3b4ee2', '#101010'];
    const bw = (R * 2) / bars.length;
    bars.forEach((col, i) => { g.fillStyle = col; g.fillRect(cx - R + i * bw, cy - R, bw + 1, 98); });
    for (let i = 0; i < 6; i++) { const v = Math.round(255 * i / 5); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(cx - R + i * (R * 2 / 6), cy - R + 98, R * 2 / 6 + 1, 30); }
    g.fillStyle = '#0a0a0a'; g.fillRect(cx - R, cy - 26, R * 2, 66);
    let x = cx - R + 10;
    for (const step of [8, 6, 4, 3, 2]) { for (let k = 0; k < 7; k++) { g.fillStyle = k % 2 ? '#111' : '#eee'; g.fillRect(x, cy + 40, step, 32); x += step; } x += 6; }
    g.fillStyle = '#f2f2f2'; g.fillRect(cx + 10, cy + 40, R, 32);
    g.fillStyle = '#c33'; g.fillRect(cx - R, cy + 72, R, R);
    g.fillStyle = '#e9e9e9'; g.fillRect(cx, cy + 72, R, R);
    g.restore();
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.lineWidth = 3; g.strokeStyle = '#f5f5f5'; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(cx, cy - R); g.lineTo(cx, cy - 26); g.moveTo(cx - R, cy + 7); g.lineTo(cx + R, cy + 7); g.stroke();
    return c;
  },
  testcard(g, W, H, sec) {
    if (!this._test) this._test = this.testBase(W, H);
    g.drawImage(this._test, 0, 0);
    const d = new Date(), pad = n => String(n).padStart(2, '0');
    g.fillStyle = '#0a0a0a'; g.fillRect(W / 2 - 120, H / 2 - 22, 240, 54);
    g.fillStyle = '#f6f6f6'; g.font = `24px ${PIX}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`, W / 2, H / 2 + 6);
    g.font = `9px ${PIX}`; g.fillStyle = '#bbb';
    g.fillText(`${pad(d.getDate())}.${pad(d.getMonth() + 1)}`, W / 2, H / 2 - 13);
  },

  morning(g, W, H, sec, ch) {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#5ec8ff'); sky.addColorStop(0.62, '#bfe9ff'); sky.addColorStop(1, '#ffe3a6');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    // солнце с лучами
    const sx = 372, sy = 104 + Math.sin(sec * 0.8) * 5;
    g.save(); g.translate(sx, sy); g.rotate(sec * 0.35);
    g.fillStyle = 'rgba(255, 214, 64, .55)';
    for (let i = 0; i < 12; i++) { g.rotate(Math.PI / 6); g.beginPath(); g.moveTo(-9, 52); g.lineTo(0, 86); g.lineTo(9, 52); g.fill(); }
    g.restore();
    g.beginPath(); g.arc(sx, sy, 46, 0, Math.PI * 2); g.fillStyle = '#ffd23a'; g.fill();
    g.lineWidth = 5; g.strokeStyle = '#ff9a2e'; g.stroke();
    g.fillStyle = '#5a3200'; g.beginPath(); g.arc(sx - 15, sy - 6, 4.5, 0, Math.PI * 2); g.arc(sx + 15, sy - 6, 4.5, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.lineWidth = 4; g.strokeStyle = '#5a3200'; g.arc(sx, sy + 4, 17, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
    // облака
    const cloud = (x, y, s) => { g.fillStyle = '#fff'; g.beginPath();
      g.arc(x, y, 18 * s, 0, 7); g.arc(x + 22 * s, y - 10 * s, 22 * s, 0, 7); g.arc(x + 48 * s, y, 18 * s, 0, 7); g.arc(x + 24 * s, y + 6 * s, 20 * s, 0, 7); g.fill(); };
    [[0.9, 60, 12], [1.2, 118, 18], [0.7, 170, 9]].forEach(([s, y, sp], i) => cloud(((sec * sp + i * 190) % (W + 160)) - 90, y, s));
    // холмы
    g.fillStyle = '#7ed957';
    g.beginPath(); g.moveTo(0, H); for (let x = 0; x <= W; x += 8) g.lineTo(x, 262 + Math.sin(x * 0.012 + 1) * 16); g.lineTo(W, H); g.fill();
    g.fillStyle = '#4fbf3a';
    g.beginPath(); g.moveTo(0, H); for (let x = 0; x <= W; x += 8) g.lineTo(x, 286 + Math.sin(x * 0.018 + 3) * 12); g.lineTo(W, H); g.fill();
    // конфетти «мемфис»
    const shapes = 14;
    for (let i = 0; i < shapes; i++) {
      const px = (i * 97 + sec * (8 + i % 5 * 3)) % (W + 40) - 20;
      const py = 30 + (i * 53) % 220 + Math.sin(sec * 1.3 + i) * 8;
      g.save(); g.translate(px, py); g.rotate(sec * (i % 2 ? 1 : -1) * 0.8 + i);
      g.fillStyle = ['#ff4fa3', '#24c6c8', '#8a5cff', '#ffb300'][i % 4];
      g.strokeStyle = g.fillStyle; g.lineWidth = 3;
      if (i % 3 === 0) { g.beginPath(); g.moveTo(0, -7); g.lineTo(7, 6); g.lineTo(-7, 6); g.closePath(); g.fill(); }
      else if (i % 3 === 1) { g.beginPath(); g.moveTo(-10, 0); g.lineTo(-5, -5); g.lineTo(0, 0); g.lineTo(5, -5); g.lineTo(10, 0); g.stroke(); }
      else { g.beginPath(); g.arc(0, 0, 5, 0, 7); g.fill(); }
      g.restore();
    }
    // заголовок
    const lines = ch.title || ['С ДОБРЫМ', 'УТРОМ!'];
    const pal = ['#ff4fa3', '#ffb300', '#24c6c8', '#8a5cff', '#ff6b3d'];
    g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((line, li) => {
      g.font = `${li ? 52 : 44}px Lobster, "Brush Script MT", cursive`;
      const total = g.measureText(line).width;
      let x = W / 2 - total / 2;
      [...line].forEach((chr, i) => {
        const w = g.measureText(chr).width;
        const y = 150 + li * 56 + Math.sin(sec * 3.2 + i * 0.55 + li) * 6;
        g.lineWidth = 8; g.strokeStyle = '#3a1d5c'; g.strokeText(chr, x + w / 2, y);
        g.fillStyle = pal[(i + li * 2 + Math.floor(sec * 2)) % pal.length]; g.fillText(chr, x + w / 2, y);
        x += w;
      });
    });
    // часы и логотип
    const d = new Date(), pad = n => String(n).padStart(2, '0');
    g.textAlign = 'left'; g.font = `14px ${PIX}`;
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillText(`${pad(d.getHours())}:${pad(d.getMinutes())}`, 20, 30);
    g.fillStyle = '#fff'; g.fillText(`${pad(d.getHours())}:${pad(d.getMinutes())}`, 18, 28);
    g.save(); g.translate(W - 56, 30);
    g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.arc(-26, 0, 9, 0, 7); g.fill();
    g.font = `12px ${PIX}`; g.textAlign = 'left'; g.fillText(ch.logo || 'ЛУЧ', -12, 1);
    g.restore();
    // бегущая строка
    g.fillStyle = '#1d2a8a'; g.fillRect(0, H - 40, W, 30);
    g.fillStyle = '#ffd23a'; g.fillRect(0, H - 40, 70, 30);
    g.fillStyle = '#1d2a8a'; g.font = `10px ${PIX}`; g.textAlign = 'center'; g.fillText('ЛЕТО', 35, H - 25);
    g.save(); g.beginPath(); g.rect(70, H - 40, W - 70, 30); g.clip();
    g.font = `11px ${PIX}`; g.textAlign = 'left'; g.fillStyle = '#fff';
    const text = ch.ticker || '';
    if (!this._tw || this._tt !== text) { this._tw = g.measureText(text + '   ').width; this._tt = text; }
    const off = (sec * 60) % this._tw;
    for (let x = 70 - off; x < W; x += this._tw) g.fillText(text, x, H - 25);
    g.restore();
  },

  /* «поиск сигнала»: снег и надпись, пока плеер грузится */
  tuning(g, W, H, sec, ch, txt) {
    const id = g.createImageData(W / 4 | 0, H / 4 | 0), d = id.data;
    for (let i = 0; i < d.length; i += 4) { const v = 40 + Math.random() * 140; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    if (!this._snow || this._snow.width !== id.width) { this._snow = document.createElement('canvas'); this._snow.width = id.width; this._snow.height = id.height; }
    this._snow.getContext('2d').putImageData(id, 0, 0);
    g.imageSmoothingEnabled = false; g.drawImage(this._snow, 0, 0, W, H); g.imageSmoothingEnabled = true;
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, H / 2 - 30, W, 60);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `14px ${PIX}`; g.fillStyle = '#e8f0ff';
    if (Math.floor(sec * 1.5) % 2 === 0 || REDUCED) g.fillText(txt, W / 2, H / 2 - 6);
    g.font = `8px ${PIX}`; g.fillStyle = '#9fb0d0'; g.fillText(ch.label || '', W / 2, H / 2 + 16);
  },
  /* AV без кассеты — синий экран, как у видика без сигнала */
  avBlue(g, W, H, sec) {
    g.fillStyle = '#1a2fbf'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#e8ecff'; g.font = `${Math.round(H * 0.075)}px "Press Start 2P", monospace`; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText('AV', W * 0.08, H * 0.08);
    if (Math.floor(sec * 1.2) % 2) { g.textAlign = 'center'; g.font = `${Math.round(H * 0.045)}px "Press Start 2P", monospace`; g.fillText('ВСТАВЬТЕ КАССЕТУ', W / 2, H * 0.82); }
  },
  noVideo(g, W, H, sec, ch, num, msg) {
    g.fillStyle = '#1736c4'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#4fff7a'; g.textAlign = 'left'; g.textBaseline = 'top'; g.font = `18px ${PIX}`;
    g.fillText(ch.label || `AV-${num}`, 22, 24);
    g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = `16px ${PIX}`;
    if (Math.floor(sec * 1.2) % 2 === 0 || REDUCED) g.fillText('НЕТ СИГНАЛА', W / 2, H / 2 - 22);
    g.font = `8px ${PIX}`; g.fillStyle = '#cfe0ff';
    if (!msg) g.fillText('положите видео в', W / 2, H / 2 + 14);
    if (msg) { g.fillText(msg, W / 2, H / 2 + 22); return; }
    const list = TV.clips(ch), first = list[0] || 'assets/video/…';
    g.fillText(first.replace(/[^/]+$/, ''), W / 2, H / 2 + 30);
    g.fillText(list.length ? `(${list.length} в плейлисте)` : 'и впишите в config.js', W / 2, H / 2 + 46);
  },

  osd(g, W, H, t, tv) {
    g.textBaseline = 'middle';
    if (t < tv.osdChUntil) {
      g.textAlign = 'right'; g.font = `34px ${PIX}`;
      const txt = String(tv.ch + 1);
      g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.65)'; g.strokeText(txt, W - 24, 44);
      g.fillStyle = '#5dff6e'; g.fillText(txt, W - 24, 44);
    }
    if (t < tv.osdVolUntil) {
      const n = 20, on = Math.round(state.tvVolume * n), x0 = 60, y = H - 66, bw = 15;
      g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(x0 - 12, y - 24, n * bw + 24, 48);
      g.textAlign = 'left'; g.font = `10px ${PIX}`; g.fillStyle = '#5dff6e'; g.fillText('ГРОМКОСТЬ', x0, y - 10);
      for (let i = 0; i < n; i++) { g.fillStyle = i < on ? '#5dff6e' : 'rgba(93,255,110,.2)'; g.fillRect(x0 + i * bw, y + 2, bw - 4, 14); }
    }
  },
};

/* ==========================================================================
   3b. ВСТРОЕННОЕ ВИДЕО (YouTube): официальный плеер под стеклом кинескопа.
   Пиксели чужого плеера браузер не даёт обработать шейдером, поэтому
   «кинескоп» здесь собран из накладок: строки, теневая маска, виньетка,
   отражение комнаты в стекле, мерцание. Включение/выключение и помехи при
   переключении — те же, что у остальных каналов (их рисует WebGL поверх).
   ========================================================================== */
const Embed = {
  el: $('#tvEmbed'), player: null, ready: false, ch: null, loading: null, failed: false, msg: '',
  status: 'idle', ytState: -2, errors: 0, hostIdx: 0, t0: 0,
  hosts: ['https://www.youtube-nocookie.com', 'https://www.youtube.com'],
  log(...a) { console.info('[Tube TV] YouTube:', ...a); },
  init() {
    this.resize();
    const z = zpx(CFG.zones.screen), g = this.el.querySelector('.crt-glass');
    Object.assign(g.style, {
      backgroundSize: `calc(var(--u) * ${IMG_W}) calc(var(--u) * ${IMG_H})`,
      backgroundPosition: `calc(var(--u) * ${-z.x}) calc(var(--u) * ${-z.y})`,
    });
  },
  /* плеер рендерится крупным (YouTube выбирает качество по размеру плеера)
     и уменьшается трансформацией; overscan прячет края кадра с надписями */
  resize() {
    placeEl(this.el, CFG.zones.screen);
    const E = CFG.embed, z = zpx(CFG.zones.screen), u = state.stage.u || 1;
    const W = z.w * u, H = z.h * u, PW = E.playerWidth, PH = PW * 9 / 16;
    const k = Math.max(H / PH, W / PW) * E.overscan;
    this.el.style.setProperty('--yt-w', PW + 'px'); this.el.style.setProperty('--yt-h', PH + 'px');
    this.el.style.setProperty('--yt-k', k.toFixed(4));
    root.style.setProperty('--crt', E.crt);
  },
  source(ch) {
    const s = ch.source || {};
    if (s.playlist) return { list: s.playlist };
    if (s.channel) return { list: 'UU' + s.channel.slice(2) };            // «Загрузки» канала
    if (s.videos && s.videos.length) return { videos: s.videos };
    return null;
  },
  /* что показать на экране, пока видео не идёт */
  screenText() {
    if (this.failed) return null;
    if (this.playing()) return this.visible ? null : 'НАСТРОЙКА…';
    return { loading: 'ПОИСК СИГНАЛА…', starting: 'НАСТРОЙКА…', tap: 'НАЖМИТЕ НА ЭКРАН', skip: 'РОЛИК НЕДОСТУПЕН — ДАЛЬШЕ' }[this.status] || null;
  },
  playing() { return this.status === 'playing'; },
  showing() { return this.playing() && this.visible; },
  api() {
    if (this.loading) return this.loading;
    this.loading = new Promise((res, rej) => {
      if (window.YT && window.YT.Player) return res();
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); res(); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api'; s.async = true; s.onerror = () => rej(new Error('blocked'));
      document.head.appendChild(s);
      setTimeout(() => rej(new Error('timeout')), 12000);
    });
    this.loading.catch(e => { this.log('API не загрузился:', e.message); this.loading = null; });
    return this.loading;
  },
  setStatus(s) {
    if (this.status === s) return;
    this.status = s; this.log('статус', s);
    this.el.classList.toggle('clickable', s === 'tap');
  },
  async play(ch) {
    this.ch = ch; this.failed = false; this.msg = ''; this.errors = 0; this.show(false);
    const s = this.source(ch);
    if (!s) { this.failed = true; this.msg = 'впишите канал в config.js'; return; }
    this.setStatus('loading');
    try { await this.api(); }
    catch (_) { this.failed = true; this.msg = location.protocol === 'file:' ? 'нужен локальный сервер' : 'YouTube недоступен'; this.setStatus('idle'); return; }
    if (this.ch !== ch || !TV.on) return;
    this.el.classList.add('on');
    this.setStatus('starting');
    this.t0 = nowMs();
    if (!this.player) this.create(s);
    else if (this.ready) this.load(s);
    this.watch();
  },
  create(s) {
    const host = document.createElement('div'); host.id = 'ytHost';
    const old = this.el.querySelector('iframe, #ytHost'); if (old) old.remove();
    this.el.prepend(host);
    this.ready = false;
    const hostUrl = this.hosts[this.hostIdx % this.hosts.length];
    this.log('создаю плеер', hostUrl, s);
    // ВАЖНО: для плейлиста поля videoId быть не должно вовсе (даже пустого) — иначе «Invalid video id»
    const opts = {
      width: String(CFG.embed.playerWidth), height: String(Math.round(CFG.embed.playerWidth * 9 / 16)), host: hostUrl,
      playerVars: Object.assign({ autoplay: 1, mute: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, playsinline: 1, rel: 0, cc_load_policy: CFG.embed.captions ? 1 : 0, hl: CFG.embed.lang, cc_lang_pref: CFG.embed.lang },
        s.list ? { listType: 'playlist', list: s.list } : {}, location.protocol.startsWith('http') ? { origin: location.origin } : {}),
      events: {
        onReady: () => {
          this.ready = true; this.log('плеер готов');
          if (!this.ch) { try { this.player.mute(); this.player.pauseVideo(); } catch (_) {} return; }
          // пока плеер готовился, канал могли переключить — тогда грузим уже новый список
          const cur = this.source(this.ch);
          if (cur && (cur.list || null) !== (this._list || null)) this.load(cur); else this.shuffle();
        },
        onStateChange: e => this.onState(e.data),
        onError: e => this.onError(e.data),
      },
    };
    if (s.videos) opts.videoId = pick(s.videos);
    this._list = s.list || null;
    try { this.player = new YT.Player('ytHost', opts); }
    catch (e) { this.log('плеер не создался:', e.message); this.failed = true; this.msg = 'YouTube: ' + e.message; this.setStatus('idle'); }
  },
  load(s) {
    this._list = s.list || null;
    try {
      if (s.list) this.player.loadPlaylist({ list: s.list, listType: 'playlist', index: 0 });
      else this.player.loadVideoById(pick(s.videos));
    } catch (_) {}
    this.shuffle();
  },
  /* состояния YouTube: -1 не начат, 0 закончился, 1 идёт, 2 пауза, 3 буферизация, 5 подготовлен */
  onState(st) {
    this.ytState = st; this.log('состояние', st);
    clearTimeout(this._reveal);
    // канал уже переключили или телевизор выключили, а ролик всё-таки стартовал — глушим
    if (!this.ch || !TV.on) { if (st === 1 || st === 3) try { this.player.mute(); this.player.pauseVideo(); } catch (_) {} this.show(false); return; }
    if (st === 1) {
      this.errors = 0; this.setStatus('playing'); this.syncVolume(); this.noCaptions();
      // YouTube несколько секунд после старта показывает название и кнопки (пауза, вперёд/назад) —
      // держим «настройку», пока они не спрячутся, и только потом открываем картинку
      this._reveal = setTimeout(() => { if (this.ytState === 1) this.show(true); }, CFG.embed.revealDelayMs);
      this.guardEnd();
      if (!this._seeked && this.ch && this.ch.randomStart) {
        this._seeked = true;
        setTimeout(() => { try { const d = this.player.getDuration(); if (d > 90) this.player.seekTo(d * rand(0.05, 0.6), true); } catch (_) {} }, 400);
      }
    }
    else this.show(false);                                             // пауза, буферизация, конец — под снегом
    if (st === 0) { this._seeked = false; this.next(); }
  },
  visible: false,
  show(v) { this.visible = v; this.el.classList.toggle('revealed', v); },
  /* В последние ~20 секунд ролика YouTube выводит заставки «смотрите также» и кнопки —
     уходим на следующий ролик заранее, под «помехи» */
  guardEnd() {
    clearInterval(this._endIv);
    this._endIv = setInterval(() => {
      if (!this.player || this.ytState !== 1 || !this.ch) return;
      try {
        const d = this.player.getDuration(), t = this.player.getCurrentTime();
        if (d > 45 && d - t < (CFG.embed.endGuardSec || 22)) { clearInterval(this._endIv); this.show(false); this._seeked = false; this.next(); }
      } catch (_) {}
    }, 1000);
  },
  noCaptions() {
    if (CFG.embed.captions || !this.player) return;
    try { this.player.unloadModule('captions'); } catch (_) {}
    try { this.player.unloadModule('cc'); } catch (_) {}
    try { this.player.setOption('captions', 'track', {}); } catch (_) {}
  },
  /* 2 — неверный параметр, 5 — ошибка HTML5-плеера, 100 — ролик удалён, 101/150 — владелец запретил встраивание */
  onError(code) {
    this.errors++; this.log('ошибка', code, 'подряд', this.errors);
    if (this.errors >= 6) { this.failed = true; this.msg = `YouTube: ошибка ${code}`; this.setStatus('idle'); return; }
    this.setStatus('skip');
    setTimeout(() => { this._seeked = false; this.next(); }, 700);
  },
  /* если за несколько секунд видео не пошло — пробуем ещё раз, потом просим клик, потом меняем адрес плеера */
  watch() {
    clearTimeout(this._w1); clearTimeout(this._w2); clearTimeout(this._w3);
    const ch = this.ch;
    this._w1 = setTimeout(() => { if (this.ch === ch && !this.playing() && this.ready && !this.failed) { this.log('повторный запуск'); try { this.player.mute(); this.player.playVideo(); } catch (_) {} } }, 5000);
    this._w2 = setTimeout(() => { if (this.ch === ch && !this.playing() && this.ready && !this.failed) this.setStatus('tap'); }, 9000);
    this._w3 = setTimeout(() => {
      if (this.ch !== ch || this.playing() || this.failed) return;
      if (!this.ready || this.ytState === -2) {
        this.hostIdx++; this.log('плеер не ответил, пробую', this.hosts[this.hostIdx % this.hosts.length]);
        const s = this.source(ch); if (s) { this.setStatus('starting'); this.create(s); this.watch(); }
      }
    }, 14000);
  },
  /* клик по экрану (когда браузер не дал запуститься самому) */
  tap() {
    if (!this.player || !this.ready) return false;
    try { this.player.mute(); this.player.playVideo(); } catch (_) {}
    this.setStatus('starting');
    return true;
  },
  shuffle() {
    const ch = this.ch, s = ch && this.source(ch); if (!s || !this.player) return;
    this._seeked = false;
    const go = (tries = 0) => {
      if (this.ch !== ch) return;                          // за это время переключили канал
      try {
        const n = (this.player.getPlaylist && this.player.getPlaylist() || []).length;
        if (s.list && !n && tries < 10) return setTimeout(() => go(tries + 1), 400);   // плейлист ещё грузится
        if (s.list && ch.shuffle !== false && n > 1) this.player.playVideoAt(Math.floor(Math.random() * n));
        else this.player.playVideo();
      } catch (_) {}
    };
    setTimeout(() => go(), 300);
  },
  next() {
    const s = this.ch && this.source(this.ch); if (!s || !this.player) return;
    try {
      if (s.list) { const n = (this.player.getPlaylist() || []).length; this.player.playVideoAt(n > 1 ? Math.floor(Math.random() * n) : 0); }
      else this.player.loadVideoById(pick(s.videos));
    } catch (_) {}
    TV.burstUntil = nowMs() + CFG.tv.staticBurstMs;
  },
  stop() {
    clearInterval(this._endIv);
    this.ch = null; this.el.classList.remove('on'); this.setStatus('idle'); this.show(false);
    clearTimeout(this._w1); clearTimeout(this._w2); clearTimeout(this._w3);
    try { if (this.player && this.ready) this.player.pauseVideo(); } catch (_) {}
  },
  /* звук включаем только когда ролик уже пошёл: беззвучный автозапуск браузеры разрешают всегда */
  syncVolume() {
    if (!this.player || !this.ready) return;
    try {
      if (state.muted || !TV.on || !this.playing()) this.player.mute();
      else { this.player.unMute(); this.player.setVolume(Math.round(state.tvVolume * 100)); }
    } catch (_) {}
  },
  shape(s) {
    const on = !!(s && s.sx * s.sy > 0 && this.ch && !this.failed);
    this.el.style.transform = on ? `scale(${s.sx.toFixed(3)}, ${Math.max(s.sy, 0.006).toFixed(3)})` : 'scale(0)';
    if (this._on !== on) { this.el.style.opacity = on ? 1 : 0; this._on = on; }
  },
};

/* ==========================================================================
   4. СВЕТ: свечение экрана, мигалка сквозь кружево, споры пыли, погода, зерно
   ========================================================================== */
const Light = {
  glowEls: [...document.querySelectorAll('#glow i')],
  cur: [0, 0, 0], sirenRun: null,
  init() {
    placeEl($('#glow'), CFG.zones.glow);
    this.placeSiren();
    root.style.setProperty('--siren-red', CFG.light.sirenRed.join(','));
    root.style.setProperty('--siren-blue', CFG.light.sirenBlue.join(','));
    root.style.setProperty('--grain-opacity', CFG.light.grainOpacity);
    root.style.setProperty('--vig', CFG.light.vignette);
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'); const id = g.createImageData(128, 128);
    for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
    g.putImageData(id, 0, 0);
    root.style.setProperty('--grain-img', `url(${c.toDataURL()})`);
    this.wall = [$('#siren .s-red'), $('#siren .s-blue')];
    this.win = [$('#siren .w-red'), $('#siren .w-blue')];
    this.gobo = $('#siren .gobo');
  },
  placeSiren() {
    const s = CFG.zones.siren, w = CFG.zones.window;
    placeEl($('#siren'), s);
    // блики прямо на тюле — внутри зоны мигалки, в координатах окна
    placeEl($('#siren .s-win'), { x: (w.x - s.x) / s.w * 100, y: (w.y - s.y) / s.h * 100, w: w.w / s.w * 100, h: w.h / s.h * 100 });
  },
  update(t) {
    const fx = state.fx;
    const [r, g, b] = TV.avg;
    const mx = Math.max(r, g, b, 0.001);
    const flick = REDUCED ? 1 : 1 + 0.035 * Math.sin(t * 0.057) + 0.02 * Math.sin(t * 0.0131);
    const I = fx.glow * TV.level * clamp(0.3 + 1.1 * TV.avgLum, 0, 1.25) * flick;
    const target = [I * r / mx, I * g / mx, I * b / mx];
    for (let i = 0; i < 3; i++) {
      this.cur[i] = lerp(this.cur[i], target[i], TV.anim ? 0.35 : 0.12);
      const v = this.cur[i] < 0.002 ? 0 : Math.min(1, this.cur[i]);
      if (this.glowEls[i]._v !== v) { this.glowEls[i].style.opacity = v.toFixed(3); this.glowEls[i]._v = v; }
    }
    this.updateSiren(t);
  },
  siren(startMs, durMs) { this.sirenRun = { t0: startMs, dur: durMs }; $('#siren').classList.add('on'); },
  /* Машина едет за окном слева направо; свет через окно ложится на стену и мебель
     и, как в камере-обскуре, бежит в обратную сторону. Узор тюля — маска «гобо». */
  updateSiren(t) {
    const s = this.sirenRun;
    if (!s) return;
    const x = (t - s.t0) / s.dur;
    if (x < 0) return;
    if (x > 1) { for (const e of [...this.wall, ...this.win]) e.style.opacity = 0; this.sirenRun = null; $('#siren').classList.remove('on'); return; }
    const prox = Math.exp(-Math.pow((x - 0.5) / 0.22, 2));
    const I = state.fx.siren * prox;
    const ph = (t / 1000 * 3.1) % 1, redOn = ph < 0.5, pulse = REDUCED ? 0.7 : 1;
    const ra = I * (redOn ? 1 : 0.1) * pulse, ba = I * (redOn ? 0.1 : 1) * pulse;
    const wallPos = lerp(115, -75, x);                    // на стене — справа налево
    this.wall[0].style.transform = `translate3d(${wallPos}%, 0, 0) rotate(-26deg)`;
    this.wall[1].style.transform = `translate3d(${wallPos + 22}%, 3%, 0) rotate(-26deg)`;
    this.gobo.style.transform = `translate3d(${lerp(6, -6, x)}%, 0, 0)`;
    this.wall[0].style.opacity = (ra * 0.75).toFixed(3); this.wall[1].style.opacity = (ba * 0.75).toFixed(3);
    const winPos = lerp(-70, 120, x);                     // на самом тюле — слева направо
    this.win[0].style.transform = `translate3d(${winPos}%, 0, 0)`;
    this.win[1].style.transform = `translate3d(${winPos - 30}%, 4%, 0)`;
    this.win[0].style.opacity = ra.toFixed(3); this.win[1].style.opacity = ba.toFixed(3);
  },
};

/* Пыль «как споры»: три слоя глубины, медленно плывут во все стороны по мягкому
   вихревому полю, сильнее видны в лучах света, ближние — крупным размытым боке.
   Порывы ветра чуть сносят их. */
const Dust = {
  el: $('#dust'), parts: [], lum: null, lw: 0, lh: 0, sprites: null,
  init() {
    this.ctx = this.el.getContext('2d');
    this.sprites = [this.sprite(32, 0.0), this.sprite(64, 0.35), this.sprite(128, 0.55)];
    const C = CFG.light.spores, k = REDUCED ? 0.5 : 1;
    const add = (n, layer) => { for (let i = 0; i < Math.round(n * k); i++) this.parts.push(this.spawn(layer, true)); };
    add(C.far, 0); add(C.mid, 1); add(C.near, 2);
  },
  sprite(size, soft) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'), r = size / 2;
    const gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, 'rgba(255,244,222,1)');
    gr.addColorStop(soft ? 0.25 : 0.18, `rgba(255,236,205,${soft ? 0.55 : 0.9})`);
    if (soft > 0.5) gr.addColorStop(0.78, 'rgba(255,228,190,0.12)');   // лёгкое кольцо боке
    gr.addColorStop(1, 'rgba(255,228,190,0)');
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    return c;
  },
  spawn(layer, anywhere) {
    const sizes = [[0.5, 1.3], [1.6, 3.2], [7, 15]];
    return { L: layer, x: Math.random(), y: anywhere ? Math.random() : rand(0.2, 1.05), ph: rand(0, 6.28), tw: rand(0.4, 1.3),
      r: rand(...sizes[layer]), drift: rand(0.6, 1.4), seed: rand(0, 100), life: 0, max: rand(12, 30) };
  },
  setScene() {
    const img = new Image();
    img.onload = () => this.buildLum(img);
    img.src = CFG.backgrounds[state.scene].image;
  },
  buildLum(img) {
    const w = 160, h = Math.round(160 * IMG_H / IMG_W);
    try {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h).data, L = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) L[i] = smooth(0.25, 0.85, (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255);
      this.lum = L; this.lw = w; this.lh = h;
    } catch (_) { this.lum = null; }
  },
  resize() {
    placeEl(this.el, CFG.zones.dust);
    const z = zpx(CFG.zones.dust), u = state.stage.u;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    this.el.width = Math.max(2, Math.round(z.w * u * dpr)); this.el.height = Math.max(2, Math.round(z.h * u * dpr));
    this.scale = u * dpr;
  },
  update(t, dt) {
    const vis = state.fx.dust;
    const c = this.ctx, W = this.el.width, H = this.el.height;
    if (vis < 0.02) { if (!this._cleared) { c.clearRect(0, 0, W, H); this._cleared = true; } return; }
    this._cleared = false;
    c.clearRect(0, 0, W, H);
    c.globalCompositeOperation = 'lighter';
    const sp = (REDUCED ? 0.35 : 1) * dt / 1000, T = t * 0.001, wind = Wind.w;
    const z = CFG.zones.dust;
    for (const p of this.parts) {
      const depth = [0.5, 0.85, 1.6][p.L];
      // мягкое вихревое поле: два синуса по x/y с разными фазами
      const fx = Math.sin(p.y * 5.3 + T * 0.13 + p.seed) * 0.6 + Math.sin(p.y * 11 - T * 0.07 + p.seed * 2) * 0.4;
      const fy = Math.cos(p.x * 4.7 - T * 0.11 + p.seed) * 0.6 + Math.cos(p.x * 9 + T * 0.05) * 0.4;
      p.x += (fx * 0.006 * p.drift - wind * 0.022) * depth * sp;
      p.y += (fy * 0.005 * p.drift - 0.0028) * depth * sp;
      p.ph += dt * 0.0009 * p.tw; p.life += sp;
      if (p.y < -0.05 || p.x < -0.05 || p.x > 1.05 || p.y > 1.08 || p.life > p.max) { Object.assign(p, this.spawn(p.L, false)); p.x = Math.random(); continue; }
      let a = 0.12;
      if (this.lum) {
        const gx = (z.x + p.x * z.w) / 100, gy = (z.y + p.y * z.h) / 100;
        const lx = clamp(gx * this.lw | 0, 0, this.lw - 1), ly = clamp(gy * this.lh | 0, 0, this.lh - 1);
        a = 0.1 + 0.9 * this.lum[ly * this.lw + lx];
      }
      const fade = Math.min(1, p.life / 2, (p.max - p.life) / 2);
      a *= (0.55 + 0.45 * Math.sin(p.ph * 2.1)) * fade * vis * [0.75, 0.6, 0.22][p.L];
      if (a < 0.01) continue;
      const r = p.r * this.scale, spr = this.sprites[p.L], d = r * (p.L === 2 ? 2.2 : 3.2);
      c.globalAlpha = Math.min(1, a);
      c.drawImage(spr, p.x * W - d / 2, p.y * H - d / 2, d, d);
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  },
};

/* Погода: дождь за окном (виден сквозь тюль), вспышки молний, общее затемнение */
const Weather = {
  el: $('#rain'), drops: [], beads: [], runs: [], kind: 'clear', level: 0, target: 0, nextBolt: 0,
  init() { this.ctx = this.el.getContext('2d'); this.resize(); },
  resize() {
    placeEl(this.el, CFG.zones.window);
    const z = zpx(CFG.zones.window), u = state.stage.u;
    this.el.width = Math.max(2, Math.round(z.w * u)); this.el.height = Math.max(2, Math.round(z.h * u));
  },
  set(kind) {
    this.kind = kind;
    this.target = { clear: 0, drizzle: 0.35, downpour: 1 }[kind] || 0;
    this.nextBolt = nowMs() + rand(8000, 16000);
  },
  update(t, dt) {
    this.level = lerp(this.level, this.target, Math.min(1, dt / 1500));
    const dim = $('#dim'), dv = (state.fx.dim || 0).toFixed(3);
    if (dim._v !== dv) { dim.style.opacity = dv; dim._v = dv; }
    const c = this.ctx, W = this.el.width, H = this.el.height;
    c.clearRect(0, 0, W, H);
    if (this.level < 0.01) return;
    if (BG.gl) { this.glass(c, W, H, dt); if (this.kind === 'downpour' && t > this.nextBolt && !REDUCED) { this.nextBolt = t + rand(...CFG.weather.lightningEveryMs); this.bolt(); } return; }
    const want = Math.round(this.level * (REDUCED ? 70 : 170));
    while (this.drops.length < want) this.drops.push({ x: Math.random(), y: Math.random(), v: rand(0.9, 1.6), l: rand(0.03, 0.07) });
    if (this.drops.length > want) this.drops.length = want;
    const slant = -0.18 - Wind.w * 0.35;
    c.strokeStyle = 'rgba(225,232,240,0.55)'; c.lineWidth = Math.max(1, W / 220);
    c.beginPath();
    for (const d of this.drops) {
      d.y += d.v * dt / 1000 * (0.9 + this.level * 1.4); d.x += slant * d.v * dt / 1000 * 0.5;
      if (d.y > 1.05) { d.y = -0.08; d.x = Math.random() * 1.2; }
      if (d.x < -0.1) d.x += 1.2;
      const x = d.x * W, y = d.y * H, L = d.l * H * (0.6 + this.level);
      c.moveTo(x, y); c.lineTo(x + slant * L * 0.5, y + L);
    }
    c.stroke();
    this.glass(c, W, H, dt);
    // молнии только в ливень
    if (this.kind === 'downpour' && t > this.nextBolt && !REDUCED) {
      this.nextBolt = t + rand(...CFG.weather.lightningEveryMs);
      this.bolt();
    }
  },
  /* капли на стекле: неподвижные бусины, которые иногда срываются и стекают, оставляя след */
  glass(c, W, H, dt) {
    const L = this.level, k = Math.min(W, H) / 300;
    const wantB = Math.round(L * (REDUCED ? 40 : 90));
    while (this.beads.length < wantB) this.beads.push({ x: Math.random(), y: Math.random() * 0.95, r: rand(1.8, 4.2) });
    if (this.beads.length > wantB) this.beads.length = wantB;
    if (Math.random() < dt / 1000 * (0.3 + 1.8 * L) && this.runs.length < 8) {
      const b = this.beads[Math.floor(Math.random() * this.beads.length)];
      if (b && b.r > 1.2) { this.runs.push({ x: b.x, y: b.y, r: b.r * 1.15, v: 0, trail: [], wob: rand(0, 6) }); b.y = Math.random() * 0.4; b.r = rand(0.6, 1.6); }
    }
    c.save();
    for (const b of this.beads) {
      const x = b.x * W, y = b.y * H, r = b.r * k;
      c.fillStyle = 'rgba(10,14,20,0.45)'; c.beginPath(); c.arc(x, y + r * 0.3, r, 0, 6.283); c.fill();
      c.fillStyle = 'rgba(240,246,252,0.8)'; c.beginPath(); c.arc(x - r * 0.3, y - r * 0.35, r * 0.38, 0, 6.283); c.fill();
    }
    c.lineCap = 'round';
    for (let i = this.runs.length - 1; i >= 0; i--) {
      const d = this.runs[i];
      d.v = Math.min(0.22, d.v + dt / 1000 * 0.35 * (0.6 + Math.random()));
      if (Math.random() < 0.02) d.v *= 0.2;                       // капля «спотыкается»
      d.y += d.v * dt / 1000; d.x += Math.sin(d.y * 40 + d.wob) * 0.0006;
      d.trail.push([d.x, d.y]); if (d.trail.length > 60) d.trail.shift();
      c.strokeStyle = 'rgba(225,235,245,0.22)'; c.lineWidth = d.r * k * 0.7;
      c.beginPath(); d.trail.forEach(([tx, ty], j) => j ? c.lineTo(tx * W, ty * H) : c.moveTo(tx * W, ty * H)); c.stroke();
      const x = d.x * W, y = d.y * H, r = d.r * k;
      c.fillStyle = 'rgba(10,14,20,0.4)'; c.beginPath(); c.ellipse(x, y + r * 0.2, r * 0.9, r * 1.2, 0, 0, 6.283); c.fill();
      c.fillStyle = 'rgba(240,246,252,0.7)'; c.beginPath(); c.arc(x - r * 0.3, y - r * 0.4, r * 0.4, 0, 6.283); c.fill();
      if (d.y > 1.03) this.runs.splice(i, 1);
    }
    c.restore();
  },
  bolt() {
    const f = $('#flash');
    f.animate([{ opacity: 0 }, { opacity: 0.55, offset: 0.05 }, { opacity: 0.1, offset: 0.18 }, { opacity: 0.7, offset: 0.26 }, { opacity: 0, offset: 1 }],
      { duration: 900, easing: 'ease-out' });
    Sound.thunder(rand(0.6, 3.5));
  },
};

/* ==========================================================================
   5. ЗВУК (Web Audio): процедурный, с подменой файлами из /sounds
   ========================================================================== */
const SOUND_NAMES = [
  'room-tone', 'street-day', 'birds', 'children', 'street-evening', 'crickets',
  'frying', 'siren', 'clock', 'door', 'dog', 'dog-far', 'thunder',
  'street-sunset', 'swifts', 'rain-light', 'rain-heavy',
  'tv-on', 'tv-off', 'channel-click', 'tv-static', 'tv-testcard', 'tv-morning',
  'lamp-click', 'egg-sachet', 'egg-tamagotchi', 'egg-brickgame', 'egg-rubik', 'egg-bear', 'egg-cassette', 'egg-figurine', 'egg-teapot',
];
const LOOP_NAMES = new Set(['room-tone', 'street-day', 'birds', 'children', 'street-sunset', 'swifts', 'street-evening', 'crickets', 'rain-light', 'rain-heavy', 'tv-static', 'tv-testcard', 'tv-morning']);

const Sound = {
  ctx: null, files: {}, started: false,

  start() {
    if (!this._p) this._p = this._init();
    else if (this.ctx && this.ctx.state !== 'running' && !document.hidden) this.ctx.resume().catch(() => {});
    return this._p;
  },
  async _init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) {}
    const ctx = this.ctx = new AC();
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    const G = v => { const n = ctx.createGain(); n.gain.value = v; return n; };

    this.master = G(state.muted ? 0 : CFG.audio.master);
    /* «Ламповый» мастер: чуть больше тёплого низа, мягче верх, плавное скругление пиков */
    const warm = this.f('lowshelf', 190); warm.gain.value = 2.5;
    const soft = this.f('highshelf', 7200); soft.gain.value = -3.5;
    const sat = ctx.createWaveShaper(); sat.curve = this.softCurve(1.25); sat.oversample = '2x';
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.25;
    this.master.connect(warm).connect(soft).connect(sat).connect(comp).connect(ctx.destination);

    /* Объём для наушников: слушатель сидит в кресле лицом к телевизору (смотрит в −Z, вправо — +X) */
    this.hrtf = state.headphones;
    this.panners = new Set();
    const L = ctx.listener;
    if (L.positionX) { L.positionX.value = 0; L.positionY.value = 0; L.positionZ.value = 0; L.forwardX.value = 0; L.forwardY.value = 0; L.forwardZ.value = -1; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else if (L.setOrientation) { L.setPosition(0, 0, 0); L.setOrientation(0, 0, -1, 0, 1, 0); }
    // комната: короткий тёплый отзвук (ковры, шкаф, шторы) — в него понемногу уходит всё, что звучит внутри
    this.roomVerb = ctx.createConvolver(); this.roomVerb.buffer = this.makeRoomImpulse(1.3);
    this.roomOut = G(0.26); this.roomVerb.connect(this.roomOut).connect(this.master);

    // улица идёт через «форточку»: громкость + срез верхов, когда она прикрыта
    this.street = this.f('lowpass', 1800 + 9000 * state.vent, 0.5);
    this.amb = G(state.ambience * state.vent); this.amb.connect(this.street).connect(this.master);
    this.street.connect(G(0.12)).connect(this.roomVerb);
    this.inside = G(state.ambience * 0.5); this.inside.connect(this.master); this.inside.connect(G(0.3)).connect(this.roomVerb);
    this.sfx = G(CFG.audio.sfxVolume); this.sfx.connect(this.master); this.sfx.connect(G(0.28)).connect(this.roomVerb);
    // телевизор — точечный источник впереди; когда садимся — он ближе
    this.tv = G(state.tvVolume);
    const hp = this.f('highpass', 160), lp = this.f('lowpass', 6500);
    this.tvPan = this.panner('room', 0, { fixed: true }); this.setPos(this.tvPan, ...this.tvPos(Camera.seated));
    this.tv.connect(hp).connect(lp).connect(this.tvPan).connect(this.master);
    lp.connect(G(0.22)).connect(this.roomVerb);

    this.events = G(1); this.events.connect(this.amb);          // улица: сирена, собаки, дверь в подъезде
    this.home = G(1); this.home.connect(this.inside);            // квартира: кухня, часы

    this.buf = { white: this.makeNoise('white'), pink: this.makeNoise('pink'), brown: this.makeNoise('brown') };
    this.verb = ctx.createConvolver(); this.verb.buffer = this.makeImpulse(2.6, 3.2);
    this.verbOut = G(0.5); this.verb.connect(this.verbOut).connect(this.amb);
    this.stair = ctx.createConvolver(); this.stair.buffer = this.makeImpulse(3.4, 2.4);
    this.stairOut = G(0.7); this.stair.connect(this.stairOut).connect(this.amb);

    this.started = true;
    this.loadFiles();                       // файлы подменят процедурный звук, когда загрузятся
    this.startAmbience();
    Events.start();
  },

  /* ---------- примитивы ---------- */
  g(v = 0) { const n = this.ctx.createGain(); n.gain.value = v; return n; },
  f(type, freq, q = 0.707) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = freq; b.Q.value = q; return b; },
  o(type, freq) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq; return o; },
  /* ---------- пространство ----------
     pan (−1…1, как раньше) превращается в точку вокруг слушателя. Где звук — решает,
     куда он идёт: улица — справа за окном и ниже, кухня — сзади слева, комната — впереди. */
  where(dest) {
    if (dest === this.home) return 'kitchen';
    if (dest === this.events || dest === this.amb || Object.values(this.buses).includes(dest)) return 'street';
    return 'room';
  },
  spot(where, v) {
    v = clamp(v, -1, 1);
    const P = (az, d, y) => { const a = az * Math.PI / 180; return [d * Math.sin(a), y, -d * Math.cos(a)]; };
    if (where === 'street') return P(30 + 55 * (v + 1) / 2, 7, -1.2);          // двор под окном: от «впереди справа» до «справа»
    if (where === 'kitchen') return P(-125 + 15 * v, 5, 0);                    // по коридору, через стену
    return P(v * 60, 2.6, 0.2);                                                 // предметы в комнате
  },
  tvPos(seated) { return seated ? [0, 0.05, -1.15] : [0, -0.15, -2.7]; },
  panner(where, v, { fixed } = {}) {
    const ctx = this.ctx;
    if (!ctx.createPanner) return this.g(1);
    const n = ctx.createPanner();
    n.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
    n.distanceModel = 'inverse'; n.rolloffFactor = 1; n.maxDistance = 200;
    const pos = this.spot(where, v);
    n.refDistance = Math.hypot(...pos) || 1;                    // на своём месте громкость та же, что раньше
    this.setPos(n, ...pos);
    n._where = where;
    // совместимость со старым кодом, который «ведёт» звук через pan.linearRampToValueAtTime
    n.pan = {
      setValueAtTime: (x, t) => this.setPos(n, ...this.spot(where, x), t),
      linearRampToValueAtTime: (x, t) => this.rampPos(n, this.spot(where, x), t),
    };
    this.panners.add(n);
    if (!fixed) setTimeout(() => this.panners.delete(n), 30000);
    return n;
  },
  /* Общие «точки» вокруг слушателя: короткие звуки (птицы, капли, щелчки) не создают
     каждый свой HRTF-узел, а садятся в одну из 9 позиций на своём направлении.
     Узлов получается немного, и они не копятся. */
  spotNode(dest, where, v) {
    if (!this.ctx.createPanner) return dest;
    let m = this._spots.get(dest); if (!m) { m = new Map(); this._spots.set(dest, m); }
    const b = Math.round(clamp(v, -1, 1) * 4), key = where + b;
    let n = m.get(key);
    if (!n) { n = this.panner(where, b / 4, { fixed: true }); n.connect(dest); m.set(key, n); }
    return n;
  },
  _spots: new WeakMap(),
  setPos(n, x, y, z, t) {
    if (n.positionX) { const at = t ?? this.ctx.currentTime; n.positionX.setValueAtTime(x, at); n.positionY.setValueAtTime(y, at); n.positionZ.setValueAtTime(z, at); }
    else if (n.setPosition) n.setPosition(x, y, z);
  },
  rampPos(n, [x, y, z], t) {
    if (n.positionX) { n.positionX.linearRampToValueAtTime(x, t); n.positionY.linearRampToValueAtTime(y, t); n.positionZ.linearRampToValueAtTime(z, t); }
    else if (n.setPosition) setTimeout(() => n.setPosition(x, y, z), Math.max(0, (t - this.ctx.currentTime) * 1000));
  },
  /* наушники: HRTF (объём), колонки — обычная панорама */
  setHeadphones(on) {
    state.headphones = on; this.hrtf = on;
    for (const n of this.panners) try { n.panningModel = on ? 'HRTF' : 'equalpower'; } catch (_) {}
  },
  /* сели к телевизору — звук ТВ приближается */
  seat(on) {
    if (!this.tvPan || !this.tvPan.positionX) return;
    const t = this.ctx.currentTime, [x, y, z] = this.tvPos(on), d = CFG.seat.durationMs / 1000;
    for (const [p, v] of [[this.tvPan.positionX, x], [this.tvPan.positionY, y], [this.tvPan.positionZ, z]]) { p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(v, t + d); }
  },
  p(v, where = 'room') { return this.panner(where, v); },
  out(node, dest, pan) { if (pan == null) { node.connect(dest); return; } node.connect(this.spotNode(dest, this.where(dest), pan)); },
  softCurve(k) { const n = 2048, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / k; } return c; },
  /* импульс маленькой комнаты: ранние отражения + тёплый короткий хвост */
  makeRoomImpulse(sec) {
    const ctx = this.ctx, sr = ctx.sampleRate, len = Math.floor(sec * sr), b = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr, k = 0.18 + 0.75 * Math.min(1, t / 0.4);       // хвост всё темнее
        lp += k * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * Math.exp(-t * 5.2) * (t < 0.006 ? t / 0.006 : 1);
      }
      for (const [ms, a] of [[7, 0.5], [11, 0.35], [17, 0.3], [23, 0.22], [31, 0.16]]) { const i = Math.floor((ms + ch * 1.3) / 1000 * sr); d[i] += a * (ch ? -1 : 1); }
    }
    return b;
  },
  noise(kind = 'white', loop = true) { const s = this.ctx.createBufferSource(); s.buffer = this.buf[kind]; s.loop = loop; s.loopStart = 0; if (loop) s.playbackRate.value = 1; return s; },
  makeNoise(kind, sec = 4) {
    const ctx = this.ctx, len = sec * ctx.sampleRate, b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'white') d[i] = w;
        else if (kind === 'pink') {
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
        } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      }
      // мягкий шов петли
      const fade = 2048; for (let i = 0; i < fade; i++) { const k = i / fade; d[i] = d[i] * k + d[len - fade + i] * (1 - k); }
    }
    return b;
  },
  makeImpulse(sec, decay) {
    const ctx = this.ctx, len = sec * ctx.sampleRate, b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return b;
  },
  /* Короткий тон с экспоненциальным затуханием */
  tone(t, { f, f2, type = 'sine', dur = 0.2, vol = 0.1, attack = 0.004, dest, pan, detune = 0 }) {
    const ctx = this.ctx, o = ctx.createOscillator(), gn = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t + dur);
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn); this.out(gn, dest || this.sfx, pan);
    o.start(t); o.stop(t + dur + 0.05);
    o.onended = () => gn.disconnect();
  },
  /* Короткий шумовой всплеск через фильтр */
  burst(t, { dur = 0.05, vol = 0.2, kind = 'white', type = 'bandpass', f = 2000, q = 1, dest, pan, attack = 0.001 }) {
    const ctx = this.ctx, s = this.noise(kind, false), fl = this.f(type, f, q), gn = ctx.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(gn); this.out(gn, dest || this.sfx, pan);
    const off = Math.random() * 3;
    s.start(t, off, dur + 0.05);
    s.onended = () => gn.disconnect();
  },
  /* Случайно повторяющийся процедурный звук */
  every(minS, maxS, fn) {
    let alive = true, id = 0;
    const tick = () => { if (!alive) return; if (!document.hidden && this.ctx.state === 'running') fn(this.ctx.currentTime + 0.05); id = setTimeout(tick, rand(minS, maxS) * 1000); };
    id = setTimeout(tick, rand(0.2, maxS * 0.6) * 1000);
    return { stop() { alive = false; clearTimeout(id); } };
  },

  /* ---------- файлы из /sounds ----------
     В config.audio.files у имени может быть строка или массив путей —
     тогда каждый раз звучит случайный вариант. Громкость файлов выравнивается. */
  async loadFiles() {
    const map = {};
    if (CFG.audio.autoDetectFiles) for (const n of SOUND_NAMES) map[n] = `${CFG.audio.soundsFolder}${n}.mp3`;
    for (const [k, v] of Object.entries(CFG.audio.files || {})) if (v) map[k] = v;
    if (location.protocol === 'file:') return;
    await Promise.all(Object.entries(map).map(async ([name, urls]) => {
      const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
      const bufs = [];
      for (const url of list) {
        try {
          const r = await fetch(url, { cache: 'force-cache' });
          if (!r.ok) continue;
          const ab = await r.arrayBuffer();
          const b = await new Promise((res, rej) => this.ctx.decodeAudioData(ab, res, rej));
          b._norm = this.normGain(b);
          bufs.push(b);
        } catch (_) { /* нет файла — остаётся процедурный звук */ }
      }
      if (!bufs.length) return;
      this.files[name] = bufs.length === 1 ? bufs[0] : bufs;
      if (LOOP_NAMES.has(name)) this.onFileLoaded(name);
    }));
  },
  /* множитель, приводящий громкую часть файла к общему уровню (−20 dBFS RMS) */
  normGain(b) {
    const d = b.getChannelData(0), step = Math.max(1, Math.floor(d.length / 200000));
    const vals = [];
    for (let i = 0; i < d.length; i += 2048 * step) { let s = 0, n = 0; for (let j = i; j < Math.min(i + 2048, d.length); j += step) { s += d[j] * d[j]; n++; } if (n) vals.push(Math.sqrt(s / n)); }
    vals.sort((a, b2) => a - b2);
    const loud = vals[Math.floor(vals.length * 0.8)] || 0.05;
    return clamp(0.1 / loud, 0.2, 4);
  },
  fileBuf(name) { const f = this.files[name]; return Array.isArray(f) ? pick(f) : f; },
  playFile(name, t, dest, { vol = 1, loop = false, pan, maxDur, fadeOut = 2.5, offset = 0 } = {}) {
    const b = this.fileBuf(name); if (!b) return null;
    const s = this.ctx.createBufferSource(); s.buffer = b; s.loop = loop;
    const gn = this.g(vol * (b._norm || 1)); s.connect(gn); this.out(gn, dest, pan);
    s.start(t, offset);
    let dur = b.duration - offset;
    if (maxDur && !loop && dur > maxDur) {
      dur = maxDur;
      gn.gain.setValueAtTime(vol * (b._norm || 1), t + dur - fadeOut); gn.gain.linearRampToValueAtTime(0, t + dur); s.stop(t + dur + 0.05);
    }
    s.onended = () => gn.disconnect();
    return { dur, stop(at) { try { gn.gain.setTargetAtTime(0, at, 0.15); s.stop(at + 0.8); } catch (_) {} } };
  },
  /* Петля: файл или процедурная версия */
  loop(name, dest, vol, proc) {
    const file = this.playFile(name, this.ctx.currentTime, dest, { vol, loop: true });
    if (file) return file;
    return proc();
  },
  onFileLoaded(name) {
    if (name === 'room-tone') { this.roomTone && this.roomTone.stop(this.ctx.currentTime); this.roomTone = this.makeRoomTone(); }
    const key = this.groupKey();
    if (this.groups[key]) { this.stopGroup(key); this.startGroup(key); }
    if (name.startsWith('tv-') && TV.on) this.startChannel(TV.channel());
  },

  /* ---------- общая громкость ---------- */
  setMuted(m) {
    state.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : CFG.audio.master, this.ctx.currentTime, 0.06);
    for (const ch of CFG.channels) if (ch._video && !ch._src) ch._video.muted = m;
    Embed.syncVolume();
    Radio.syncMute();
  },
  setAmbience(v) { state.ambience = v; this.applyVent(); },
  /* форточка: улица и события тише/громче, тон комнаты не меняется */
  applyVent() {
    if (!this.amb) return;
    const t = this.ctx.currentTime;
    this.amb.gain.setTargetAtTime(state.ambience * state.vent, t, 0.25);
    if (this.inside) this.inside.gain.setTargetAtTime(state.ambience * 0.5, t, 0.25);
    if (this.street) this.street.frequency.setTargetAtTime(1800 + 9000 * state.vent, t, 0.25);
  },
  ventClick() {
    if (!this.started) return;
    const t = this.ctx.currentTime + 0.01;
    this.burst(t, { dur: 0.05, vol: 0.12, type: 'lowpass', f: 700, pan: 0.6 });
    this.burst(t + 0.03, { dur: 0.02, vol: 0.14, f: 1800, q: 2, pan: 0.6 });
  },
  setTvVolume(v) {
    state.tvVolume = v;
    if (this.tv) this.tv.gain.setTargetAtTime(v, this.ctx.currentTime, 0.04);
    for (const ch of CFG.channels) if (ch._video && !ch._src) ch._video.volume = v;
    Embed.syncVolume();
  },

  /* ---------- фон: группа звуков на каждую сцену ---------- */
  groups: {}, buses: {},
  groupKey() { return state.weather !== 'clear' ? state.weather : state.mode; },
  bus(key) {
    if (!this.buses[key]) { this.buses[key] = this.g(0); this.buses[key].connect(this.amb); }
    return this.buses[key];
  },
  startAmbience() {
    this.roomTone = this.makeRoomTone();
    this.makeWind();
    const key = this.groupKey();
    this.bus(key).gain.value = 1;
    this.startGroup(key);
  },
  makeRoomTone() {
    return this.loop('room-tone', this.inside, 0.5, () => {
      const n = this.noise('brown'), lp = this.f('lowpass', 240), gn = this.g(0.2);
      n.connect(lp).connect(gn).connect(this.inside); n.start(0, Math.random() * 3);
      const hum = this.o('sine', 100), hg = this.g(0.0032); hum.connect(hg).connect(this.inside); hum.start();
      return { stop: at => { gn.gain.setTargetAtTime(0, at, 0.3); hg.gain.setTargetAtTime(0, at, 0.3); n.stop(at + 2); hum.stop(at + 2); } };
    });
  },
  noiseBed(bus, kind, type, f, vol, pan, q = 0.707) {
    const n = this.noise(kind), fl = this.f(type, f, q), gn = this.g(vol);
    n.connect(fl).connect(gn); n.start(0, Math.random() * 3);
    if (pan == null || !this.ctx.createPanner) this.out(gn, bus, pan);
    else {                                                   // широкий фон: левый и правый канал шума — две точки по краям окна
      const sp = this.ctx.createChannelSplitter(2), w = this.where(bus);
      gn.connect(sp);
      for (const [ch, dv] of [[0, -0.45], [1, 0.45]]) sp.connect(this.spotNode(bus, w, pan + dv), ch);
    }
    return { stop: at => { gn.gain.setTargetAtTime(0, at, 0.3); n.stop(at + 2); setTimeout(() => gn.disconnect(), 2600); } };
  },
  startGroup(key) {
    if (this.groups[key]) return;
    const bus = this.bus(key), h = [];
    if (key === 'day') {
      h.push(this.loop('street-day', bus, 0.6, () => this.noiseBed(bus, 'pink', 'lowpass', 700, 0.07, 0.55)));
      h.push(this.loop('birds', bus, 0.7, () => this.every(0.5, 3.4, t => this.bird(t, bus))));
      h.push(this.loop('children', bus, 0.6, () => this.every(2.5, 8.5, t => this.child(t, bus))));
    } else if (key === 'sunset') {
      h.push(this.loop('street-sunset', bus, 0.6, () => this.noiseBed(bus, 'pink', 'lowpass', 600, 0.06, 0.55)));
      h.push(this.loop('swifts', bus, 0.7, () => this.every(4, 11, t => this.swifts(t, bus))));
      h.push(this.every(3, 9, t => this.bird(t, bus)));
      h.push(this.every(6, 14, t => this.child(t, bus)));
    } else if (key === 'evening') {
      h.push(this.loop('street-evening', bus, 0.6, () => this.noiseBed(bus, 'brown', 'lowpass', 380, 0.09, 0.5)));
      h.push(this.loop('crickets', bus, 0.7, () => {
        const cr = [[4400, 0.75, 0.75], [4720, 0.95, 0.62], [4150, 0.45, 1.05]].map(([fr, pan, rate]) =>
          this.every(rate * 0.85, rate * 1.15, t => this.cricket(t, fr, pan, bus)));
        return { stop: () => cr.forEach(c => c.stop()) };
      }));
    } else if (key === 'night') {
      // ночь: двор почти спит — редкие сверчки, далёкая трасса, иногда поезд вдалеке
      h.push(this.noiseBed(bus, 'brown', 'lowpass', 260, 0.05, 0.5));
      h.push(this.loop('crickets', bus, 0.45, () => {
        const cr = [[4400, 0.8, 1.5], [4150, 0.5, 2.3]].map(([fr, pan, rate]) =>
          this.every(rate * 0.8, rate * 1.4, t => this.cricket(t, fr, pan, bus)));
        return { stop: () => cr.forEach(c => c.stop()) };
      }));
      h.push(this.every(70, 160, t => this.train(t, bus)));
    } else if (key === 'drizzle') {
      h.push(this.loop('rain-light', bus, 0.8, () => {
        const a = this.noiseBed(bus, 'pink', 'bandpass', 2600, 0.055, 0.55, 0.5);
        const b = this.noiseBed(bus, 'brown', 'lowpass', 500, 0.05, 0.4);
        const drips = this.every(0.12, 0.6, t => this.drip(t, bus, 0.5));
        return { stop: at => { a.stop(at); b.stop(at); drips.stop(); } };
      }));
    } else if (key === 'downpour') {
      h.push(this.loop('rain-heavy', bus, 0.9, () => {
        const a = this.noiseBed(bus, 'white', 'lowpass', 5200, 0.09, 0.5);
        const b = this.noiseBed(bus, 'pink', 'bandpass', 1400, 0.11, 0.6, 0.6);
        const c = this.noiseBed(bus, 'brown', 'lowpass', 280, 0.12, 0.3);
        const drips = this.every(0.03, 0.14, t => this.drip(t, bus, 1));
        const gutter = this.gutter(bus);
        return { stop: at => { a.stop(at); b.stop(at); c.stop(at); drips.stop(); gutter.stop(at); } };
      }));
    }
    this.groups[key] = h;
  },
  stopGroup(key) {
    const h = this.groups[key]; if (!h) return;
    const at = this.ctx.currentTime;
    h.forEach(x => x && x.stop(at));
    delete this.groups[key];
  },
  setScene() {
    if (!this.started) return;
    const key = this.groupKey(), t = this.ctx.currentTime, d = CFG.crossfadeMs / 1000;
    this.startGroup(key);
    for (const [k, bus] of Object.entries(this.buses)) {
      bus.gain.cancelScheduledValues(t); bus.gain.setValueAtTime(bus.gain.value, t); bus.gain.linearRampToValueAtTime(k === key ? 1 : 0, t + d);
    }
    clearTimeout(this._grpT);
    this._grpT = setTimeout(() => { for (const k of Object.keys(this.groups)) if (k !== this.groupKey()) this.stopGroup(k); }, CFG.crossfadeMs + 300);
  },

  /* ветер в окне: гул + шелест листвы, громкость — от силы порыва */
  makeWind() {
    const n = this.noise('pink'), bp = this.f('bandpass', 500, 0.8), g1 = this.g(0);
    n.connect(bp).connect(g1); this.out(g1, this.amb, 0.65); n.start(0, Math.random() * 3);
    const l = this.noise('white'), hp = this.f('highpass', 3800), g2 = this.g(0);
    l.connect(hp).connect(g2); this.out(g2, this.amb, 0.75); l.start(0, Math.random() * 3);
    this._wind = { bp, g1, g2 };
  },
  wind(w) {
    if (!this.started || !this._wind) return;
    const t = this.ctx.currentTime, W = this._wind, k = state.mode === 'evening' ? 0.7 : state.mode === 'night' ? 0.55 : 1;
    W.g1.gain.setTargetAtTime((0.008 + 0.075 * Math.pow(w, 1.6)) * k, t, 0.12);
    W.g2.gain.setTargetAtTime((0.002 + 0.05 * w * w) * k * (state.weather === 'clear' ? 1 : 0.6), t, 0.12);
    W.bp.frequency.setTargetAtTime(380 + 900 * w, t, 0.2);
  },
  /* стрижи на закате: стайка визжит и проносится мимо окна */
  swifts(t, bus) {
    const n = irand(2, 5), dir = Math.random() < 0.5 ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const tt = t + i * rand(0.05, 0.25), dur = rand(0.35, 0.7);
      const o = this.o('sawtooth', 6200), fm = this.o('sine', rand(28, 40)), fg = this.g(rand(600, 900));
      fm.connect(fg).connect(o.frequency);
      const bp = this.f('bandpass', 6800, 3), gn = this.g(0), pn = this.p(-dir, 'street');
      o.connect(bp).connect(gn).connect(pn).connect(bus);
      if (pn.pan) { pn.pan.setValueAtTime(clamp(-dir * 0.8 + 0.2, -1, 1), tt); pn.pan.linearRampToValueAtTime(clamp(dir * 0.8 + 0.2, -1, 1), tt + dur); }
      o.frequency.setValueAtTime(rand(5800, 6600), tt); o.frequency.linearRampToValueAtTime(rand(7000, 7800), tt + dur * 0.4); o.frequency.linearRampToValueAtTime(rand(6000, 6600), tt + dur);
      gn.gain.setValueAtTime(0, tt); gn.gain.linearRampToValueAtTime(rand(0.006, 0.014), tt + 0.05); gn.gain.linearRampToValueAtTime(0, tt + dur);
      o.start(tt); fm.start(tt); o.stop(tt + dur + 0.05); fm.stop(tt + dur + 0.05);
      o.onended = () => pn.disconnect();
    }
  },
  /* капли по жестяному отливу за окном */
  drip(t, bus, heavy) {
    const f = rand(1800, 4200);
    this.tone(t, { f, f2: f * 0.8, dur: rand(0.03, 0.07), vol: rand(0.006, 0.02) * (0.6 + heavy), dest: bus, pan: rand(0.4, 1) });
    this.burst(t, { dur: 0.008, vol: rand(0.01, 0.04) * (0.6 + heavy), f: rand(2500, 6000), q: 1.2, dest: bus, pan: rand(0.4, 1) });
  },
  /* поезд далеко за домами: нарастающий гул, перестук колёс, короткий гудок */
  train(t, bus) {
    const dur = rand(14, 20), n = this.noise('brown', true), lp = this.f('lowpass', 180), gn = this.g(0);
    n.connect(lp).connect(gn); this.out(gn, bus, rand(0.3, 1)); n.start(t, Math.random() * 3); n.stop(t + dur + 0.5);
    gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(0.09, t + dur * 0.45); gn.gain.linearRampToValueAtTime(0, t + dur);
    for (let k = 0, tt = t + dur * 0.2; tt < t + dur * 0.85; k++) {
      const v = 0.012 * Math.sin(Math.PI * (tt - t) / dur);
      this.burst(tt, { dur: 0.05, vol: v, type: 'lowpass', f: 420, kind: 'brown', dest: bus, pan: 0.6 });
      this.burst(tt + 0.13, { dur: 0.05, vol: v * 0.8, type: 'lowpass', f: 420, kind: 'brown', dest: bus, pan: 0.6 });
      tt += k % 4 === 3 ? 0.9 : 0.42;
    }
    if (Math.random() < 0.6) { const ht = t + dur * rand(0.3, 0.6); this.tone(ht, { f: 330, type: 'sawtooth', dur: 1.4, vol: 0.006, attack: 0.15, dest: bus, pan: 0.7 }); this.tone(ht, { f: 392, type: 'sawtooth', dur: 1.4, vol: 0.005, attack: 0.15, dest: bus, pan: 0.7 }); }
    setTimeout(() => gn.disconnect(), (dur + 2) * 1000);
  },
  /* водосточная труба во время ливня */
  gutter(bus) {
    const n = this.noise('pink'), bp = this.f('bandpass', 600, 4), gn = this.g(0.05);
    n.connect(bp).connect(gn); this.out(gn, bus, 0.9); n.start(0, Math.random() * 3);
    const lfo = this.o('sine', 3.3), lg = this.g(220); lfo.connect(lg).connect(bp.frequency); lfo.start();
    return { stop: at => { gn.gain.setTargetAtTime(0, at, 0.3); n.stop(at + 2); lfo.stop(at + 2); } };
  },
  /* гром: треск разряда и долгий раскат */
  thunder(delay) {
    if (!this.started) return;
    const t = this.ctx.currentTime + delay;
    if (this.playFile('thunder', t, this.amb, { vol: 0.9, pan: 0.4 })) return;
    const dur = rand(5, 8);
    const n = this.noise('brown', false), lp = this.f('lowpass', 260), gn = this.g(0);
    n.connect(lp).connect(gn); this.out(gn, this.amb, 0.3); gn.connect(this.verb);
    gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(0.9, t + 0.25 + delay * 0.1);
    for (let k = 1; k < 5; k++) gn.gain.linearRampToValueAtTime(rand(0.35, 0.8) * (1 - k / 6), t + k * dur / 6);
    gn.gain.linearRampToValueAtTime(0, t + dur);
    n.loop = true; n.start(t, Math.random() * 3); n.stop(t + dur + 0.1);
    if (delay < 1.5) this.burst(t, { dur: 0.35, vol: 0.25, type: 'lowpass', f: 1800, dest: this.amb, pan: 0.4 });
  },

  bird(t, bus) {
    const pan = rand(0.15, 1), base = rand(2600, 4900), vol = rand(0.018, 0.045), k = Math.random();
    const hp = this.f('highpass', 1600), gn = this.g(1); hp.connect(gn); this.out(gn, bus, pan); gn.connect(this.verb);
    if (k < 0.4) { const n = irand(2, 5); for (let i = 0; i < n; i++) this.tone(t + i * rand(0.09, 0.16), { f: base * rand(0.95, 1.1), f2: base * rand(0.6, 0.8), dur: rand(0.05, 0.09), vol, dest: hp }); }
    else if (k < 0.72) { const n = irand(6, 13); for (let i = 0; i < n; i++) this.tone(t + i * 0.047, { f: base, f2: base * 1.16, dur: 0.035, vol: vol * 0.8, dest: hp }); }
    else { this.tone(t, { f: base * 0.7, f2: base * 0.92, dur: 0.22, vol, attack: 0.02, dest: hp }); this.tone(t + 0.29, { f: base * 0.92, f2: base * 0.64, dur: 0.26, vol, attack: 0.02, dest: hp }); }
    setTimeout(() => gn.disconnect(), 2500);
  },
  child(t, bus) {
    const ctx = this.ctx, pan = rand(0.3, 0.95);
    const lp = this.f('lowpass', 1700), gn = this.g(rand(0.012, 0.026));
    lp.connect(gn); this.out(gn, bus, pan); gn.connect(this.verb);
    const laugh = Math.random() < 0.3;
    const syl = laugh ? irand(4, 6) : irand(1, 3);
    let tt = t;
    const f1 = this.f('bandpass', rand(700, 1000), 5), f2 = this.f('bandpass', rand(1300, 2300), 7);
    f1.connect(lp); f2.connect(lp);
    for (let s = 0; s < syl; s++) {
      const dur = laugh ? rand(0.08, 0.12) : rand(0.2, 0.45);
      const f0 = laugh ? 520 - s * 25 : rand(320, 520);
      const env = ctx.createGain(); env.gain.value = 0; env.connect(f1); env.connect(f2);
      for (const det of [0, 9]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = det;
        o.frequency.setValueAtTime(f0, tt);
        o.frequency.linearRampToValueAtTime(f0 * rand(1.08, 1.35), tt + dur * 0.4);
        o.frequency.linearRampToValueAtTime(f0 * rand(0.75, 0.95), tt + dur);
        o.connect(env); o.start(tt); o.stop(tt + dur + 0.05);
      }
      env.gain.setValueAtTime(0, tt); env.gain.linearRampToValueAtTime(1, tt + 0.03);
      env.gain.linearRampToValueAtTime(0.75, tt + dur * 0.7); env.gain.linearRampToValueAtTime(0, tt + dur);
      tt += dur + (laugh ? 0.04 : rand(0.06, 0.16));
    }
    setTimeout(() => gn.disconnect(), (tt - t) * 1000 + 3000);
  },
  cricket(t, fr, pan, bus) {
    const o = this.o('sine', fr * rand(0.99, 1.01)), gn = this.g(0);
    o.connect(gn); this.out(gn, bus, pan);
    const pulses = irand(3, 4), v = 0.011;
    for (let i = 0; i < pulses; i++) { const s = t + i * 0.046; gn.gain.setValueAtTime(0, s); gn.gain.linearRampToValueAtTime(v, s + 0.006); gn.gain.linearRampToValueAtTime(0, s + 0.03); }
    o.start(t); o.stop(t + pulses * 0.046 + 0.06);
    o.onended = () => gn.disconnect();
  },

  /* ---------- события ---------- */
  /* Яичница на кухне: слышно через коридор и полуоткрытую дверь.
     Основа — плотный «треск масла» (тысячи микрощелчков, заранее посчитанных в буфер),
     дальше — стена: срез верхов, тёплая середина, короткое эхо кухни. */
  makeCrackle(sec = 6) {
    const ctx = this.ctx, sr = ctx.sampleRate, len = Math.floor(sec * sr);
    const b = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let env = 0.5, target = 0.5;
      for (let i = 0; i < len; i++) {                               // тихая «подушка» шипения
        if (i % 2400 === 0) target = 0.35 + Math.random() * 0.5;
        env += (target - env) * 0.0004;
        d[i] = (Math.random() * 2 - 1) * 0.05 * env;
      }
      const pop = (at, amp, L, tone) => {                          // один щелчок масла
        let ph = Math.random() * 6.28;
        for (let j = 0; j < L && at + j < len; j++) {
          const e = Math.exp(-j / (L * 0.28));
          ph += tone;
          d[at + j] += amp * e * ((Math.random() * 2 - 1) * 0.7 + Math.sin(ph) * 0.3);
        }
      };
      const n1 = Math.floor(sec * 420);                            // мелкий треск
      for (let k = 0; k < n1; k++) pop(Math.floor(Math.random() * len), Math.pow(Math.random(), 2.2) * 0.45, 6 + Math.random() * 40, 0.3 + Math.random() * 0.9);
      const n2 = Math.floor(sec * 7);                              // крупные «плевки»
      for (let k = 0; k < n2; k++) pop(Math.floor(Math.random() * len), 0.5 + Math.random() * 0.4, 120 + Math.random() * 380, 0.08 + Math.random() * 0.2);
      const fade = 4096;                                           // бесшовная петля
      for (let i = 0; i < fade; i++) { const k = i / fade; d[i] = d[i] * k + d[len - fade + i] * (1 - k); }
    }
    return b;
  },
  /* «Из другой комнаты»: срез верхов двумя фильтрами, тёплая середина, короткое эхо кухни */
  throughWall(pan = -0.55, cutoff = 1700, dest = this.events) {
    this.kitchenVerb();
    const inp = this.g(1), hp = this.f('highpass', 140), w1 = this.f('lowpass', cutoff, 0.6), w2 = this.f('lowpass', cutoff * 1.4, 0.5), body = this.f('peaking', 380, 0.9);
    body.gain.value = 4;
    inp.connect(hp).connect(w1).connect(w2).connect(body);
    body.connect(this.spotNode(dest, 'kitchen', pan));
    const room = this.g(0.55); body.connect(room).connect(this.kitchenVerb());
    return { inp, done: () => { inp.disconnect(); body.disconnect(); room.disconnect(); } };
  },
  /* эхо кухни — одно на всё, подключается один раз */
  kitchenVerb() {
    if (!this._kitchen) {
      this._kitchen = this.ctx.createConvolver(); this._kitchen.buffer = this.makeImpulse(0.7, 4.5);
      this._kitchen.connect(this.spotNode(this.home, 'kitchen', -0.55));
    }
    return this._kitchen;
  },
  frying(t) {
    if (this.files.frying) {
      const W = this.throughWall(-0.55, CFG.audio.kitchenCutoff || 1700, this.home);
      const f = this.playFile('frying', t, W.inp, { vol: CFG.audio.fryingVolume ?? 0.3, maxDur: rand(15, 20), fadeOut: 3 });
      setTimeout(W.done, (f.dur + 2) * 1000);
      return f.dur;
    }
    if (!this._crackle) this._crackle = this.makeCrackle();
    const dur = rand(14, 18);
    // «стена»: два низкочастотных фильтра подряд + тёплая середина
    const out = this.g(0), wall1 = this.f('lowpass', 1700, 0.6), wall2 = this.f('lowpass', 2400, 0.5), body = this.f('peaking', 380, 0.9);
    body.gain.value = 4;
    const hp = this.f('highpass', 140);
    out.connect(hp).connect(wall1).connect(wall2).connect(body);
    body.connect(this.spotNode(this.home, 'kitchen', -0.55));
    const room = this.g(0.55); body.connect(room).connect(this.kitchenVerb());
    out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.75, t + 2.2);
    out.gain.setValueAtTime(0.75, t + dur - 3); out.gain.linearRampToValueAtTime(0, t + dur);
    // треск масла; сковородку то двигают, то нет — громкость «дышит»
    const cr = this.ctx.createBufferSource(); cr.buffer = this._crackle; cr.loop = true;
    cr.playbackRate.value = rand(0.92, 1.05);
    const cg = this.g(0.85); cr.connect(cg).connect(out);
    const l1 = this.o('sine', 0.23), lg = this.g(0.18); l1.connect(lg).connect(cg.gain);
    cr.start(t, Math.random() * 5); l1.start(t); cr.stop(t + dur + 0.2); l1.stop(t + dur + 0.2);
    // яйцо падает на сковороду: шипение вспыхивает и оседает
    const sw = this.ctx.createBufferSource(); sw.buffer = this._crackle; sw.playbackRate.value = 1.35;
    const sg = this.g(0); sw.connect(sg).connect(out);
    sg.gain.setValueAtTime(0, t + 1.0); sg.gain.linearRampToValueAtTime(1.1, t + 1.15); sg.gain.exponentialRampToValueAtTime(0.01, t + 4.5);
    sw.start(t + 1.0, Math.random() * 3, 3.6);
    this.burst(t + 0.9, { dur: 0.04, vol: 0.18, type: 'bandpass', f: 900, q: 1.5, dest: out });       // скорлупа о край
    // глухие стуки лопатки и пара шагов посудой
    for (let gI = 0; gI < 3; gI++) {
      let tt = t + rand(3, dur - 3);
      for (let k = 0, n2 = irand(2, 3); k < n2; k++) {
        this.tone(tt, { f: rand(520, 700), type: 'triangle', dur: 0.12, vol: 0.12, dest: out });
        this.tone(tt, { f: rand(1300, 1600), type: 'sine', dur: 0.07, vol: 0.035, dest: out });
        this.burst(tt, { dur: 0.02, vol: 0.12, type: 'lowpass', f: 1200, dest: out });
        tt += rand(0.22, 0.38);
      }
    }
    this.burst(t + rand(5, dur - 4), { dur: 0.25, vol: 0.12, type: 'lowpass', f: 500, kind: 'brown', dest: out });   // поставили сковороду на конфорку
    setTimeout(() => { out.disconnect(); room.disconnect(); }, (dur + 2) * 1000);
    return dur;
  },
  siren(t) {
    const sb = this.fileBuf('siren'), fileT = sb ? sb.duration : null;
    const T = fileT || 11;
    const pn = this.p(-1, 'street');
    if (pn.positionX) { this.setPos(pn, 3, -4, -40, t); this.rampPos(pn, [8, -4, 2], t + T * 0.5); this.rampPos(pn, [14, -4, 40], t + T); pn.refDistance = 9; }
    else if (pn.pan) { pn.pan.setValueAtTime(-1, t); pn.pan.linearRampToValueAtTime(1, t + T); }
    const glass = this.f('lowpass', 3800);
    glass.connect(pn).connect(this.events); glass.connect(this.verb);
    const N = 256, prox = new Float32Array(N), dop = new Float32Array(N);
    for (let i = 0; i < N; i++) { const x = i / (N - 1); prox[i] = 0.015 + 0.6 * Math.exp(-Math.pow((x - 0.5) / 0.2, 2)); dop[i] = 115 * Math.tanh(-(x - 0.5) / 0.07); }
    const pg = this.g(0); pg.connect(glass);
    pg.gain.setValueCurveAtTime(prox, t, T);
    if (fileT) {
      const s = this.ctx.createBufferSource(); s.buffer = sb; const ng = this.g(sb._norm || 1); s.connect(ng).connect(pg); s.start(t);
    } else {
      const lfo = this.o('triangle', 0.55), lg = this.g(320); lfo.connect(lg);
      const sBus = this.f('bandpass', 1250, 0.9), sg = this.g(0.55); sBus.connect(sg).connect(pg);
      for (const [type, v] of [['square', 0.16], ['sawtooth', 0.12]]) {
        const o = this.o(type, 960), og = this.g(v);
        lg.connect(o.frequency); o.detune.setValueCurveAtTime(dop, t, T);
        o.connect(og).connect(sBus); o.start(t); o.stop(t + T + 0.1);
      }
      lfo.start(t); lfo.stop(t + T + 0.1);
      // мотор и шины
      const en = this.noise('brown'), elp = this.f('lowpass', 220), eg = this.g(0.9);
      en.connect(elp).connect(eg).connect(pg); en.start(t, Math.random() * 3); en.stop(t + T + 0.1);
      const saw = this.o('sawtooth', 46), slp = this.f('lowpass', 140), sgg = this.g(0.22);
      saw.detune.setValueCurveAtTime(dop, t, T); saw.connect(slp).connect(sgg).connect(pg); saw.start(t); saw.stop(t + T + 0.1);
      const ti = this.noise('pink'), tbp = this.f('bandpass', 900, 0.6), tg = this.g(0.3);
      ti.connect(tbp).connect(tg).connect(pg); ti.start(t, Math.random() * 3); ti.stop(t + T + 0.1);
    }
    setTimeout(() => { pg.disconnect(); glass.disconnect(); }, (T + 1) * 1000);
    return T;
  },
  clock(t) {
    const f = this.playFile('clock', t, this.home, { vol: 0.8, pan: -0.3 }); if (f) return f.dur;
    const n = irand(9, 13);
    for (let i = 0; i < n; i++) {
      const tt = t + i * 1.0, v = 0.22 * Math.min(1, (i + 1) / 3, (n - i) / 3);
      this.burst(tt, { dur: 0.014, vol: v, f: i % 2 ? 2300 : 3200, q: 4, dest: this.home, pan: -0.3 });
      this.tone(tt, { f: i % 2 ? 1700 : 2100, dur: 0.03, vol: v * 0.25, dest: this.home, pan: -0.3 });
    }
    return n;
  },
  door(t) {
    const f = this.playFile('door', t, this.events, { vol: 0.9, pan: 0.2 }); if (f) return f.dur;
    const lp = this.f('lowpass', 950), gn = this.g(1);
    lp.connect(gn); this.out(gn, this.events, 0.15); gn.connect(this.stair);
    this.tone(t, { f: 78, f2: 36, dur: 0.55, vol: 0.55, dest: lp });
    this.burst(t, { dur: 0.2, vol: 0.5, type: 'lowpass', f: 650, dest: lp, kind: 'brown' });
    this.burst(t + 0.02, { dur: 0.06, vol: 0.25, type: 'bandpass', f: 1400, q: 1.5, dest: lp });
    this.burst(t + 0.42, { dur: 0.02, vol: 0.12, f: 2500, q: 3, dest: lp });
    setTimeout(() => gn.disconnect(), 6000);
    return 3.5;
  },
  dog(t) {
    const f = this.playFile('dog', t, this.events, { vol: 0.8, pan: 0.7 }); if (f) return f.dur;
    const lp = this.f('lowpass', 2300), gn = this.g(1), f1 = this.f('bandpass', 780, 1.4), f2 = this.f('bandpass', 1550, 2);
    f1.connect(lp); f2.connect(lp); lp.connect(gn); this.out(gn, this.events, 0.72); gn.connect(this.verb);
    let tt = t;
    for (let s = 0; s < 2; s++) {
      for (let b = 0, n = irand(2, 4); b < n; b++) {
        const env = this.g(0); env.connect(f1); env.connect(f2);
        const o = this.o('sawtooth', 560); o.frequency.setValueAtTime(rand(520, 600), tt); o.frequency.exponentialRampToValueAtTime(rand(300, 360), tt + 0.14);
        o.connect(env); o.start(tt); o.stop(tt + 0.2);
        env.gain.setValueAtTime(0, tt); env.gain.linearRampToValueAtTime(0.3, tt + 0.012); env.gain.exponentialRampToValueAtTime(0.001, tt + 0.17);
        this.burst(tt, { dur: 0.12, vol: 0.12, f: 1100, q: 0.8, dest: f1 });
        tt += rand(0.32, 0.55);
      }
      tt += rand(1.1, 1.8);
    }
    setTimeout(() => gn.disconnect(), (tt - t + 4) * 1000);
    return tt - t;
  },
  /* собака далеко во дворе: тише, глуше, с эхом от соседних домов */
  dogFar(t) {
    const f = this.playFile('dog-far', t, this.events, { vol: 0.35, pan: 0.85 }); if (f) return f.dur;
    const lp = this.f('lowpass', 1100), gn = this.g(0.55), f1 = this.f('bandpass', 700, 1.4), f2 = this.f('bandpass', 1300, 2);
    const echo = this.ctx.createDelay(1); echo.delayTime.value = rand(0.24, 0.34);
    const fb = this.g(0.28), eg = this.g(0.45);
    f1.connect(lp); f2.connect(lp); lp.connect(gn); this.out(gn, this.events, rand(0.6, 0.95)); gn.connect(this.verb);
    gn.connect(echo); echo.connect(fb).connect(echo); echo.connect(eg); this.out(eg, this.events, -0.2);
    let tt = t;
    for (let b = 0, n = irand(3, 6); b < n; b++) {
      const env = this.g(0); env.connect(f1); env.connect(f2);
      const o = this.o('sawtooth', 480); o.frequency.setValueAtTime(rand(460, 540), tt); o.frequency.exponentialRampToValueAtTime(rand(280, 330), tt + 0.15);
      o.connect(env); o.start(tt); o.stop(tt + 0.22);
      env.gain.setValueAtTime(0, tt); env.gain.linearRampToValueAtTime(0.16, tt + 0.015); env.gain.exponentialRampToValueAtTime(0.001, tt + 0.18);
      tt += rand(0.45, 0.8);
    }
    setTimeout(() => { gn.disconnect(); eg.disconnect(); fb.disconnect(); }, (tt - t + 5) * 1000);
    return tt - t;
  },

  /* ---------- телевизор ---------- */
  tvOn() {
    if (!this.started) return;
    const t = this.ctx.currentTime + 0.02;
    if (!this.playFile('tv-on', t, this.sfx)) {
      this.burst(t, { dur: 0.016, vol: 0.5, type: 'highpass', f: 900 });
      this.tone(t, { f: 95, f2: 55, dur: 0.09, vol: 0.28 });
      // размагничивание: гул с затуханием + треск статики
      const o = this.o('square', 50), lp = this.f('lowpass', 380), gn = this.g(0);
      o.connect(lp).connect(gn).connect(this.sfx);
      gn.gain.setValueAtTime(0, t + 0.05); gn.gain.linearRampToValueAtTime(0.16, t + 0.12); gn.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
      o.start(t + 0.05); o.stop(t + 1.4);
      this.burst(t + 0.18, { dur: 0.35, vol: 0.06, type: 'highpass', f: 4000 });
    }
    this.whine(true);
  },
  tvOff() {
    if (!this.started) return;
    const t = this.ctx.currentTime + 0.02;
    this.stopChannel();
    if (!this.playFile('tv-off', t, this.sfx)) {
      this.burst(t, { dur: 0.016, vol: 0.45, type: 'highpass', f: 900 });
      this.tone(t, { f: 85, f2: 50, dur: 0.08, vol: 0.22 });
      this.tone(t + 0.05, { f: 1400, f2: 90, dur: 0.35, vol: 0.02 });
    }
    this.whine(false);
  },
  whine(on) {
    const t = this.ctx.currentTime;
    if (on && !this._whine) {
      const o = this.o('sine', CFG.tv.whineHz), gn = this.g(0);
      o.connect(gn).connect(this.sfx); o.start();
      gn.gain.setTargetAtTime(CFG.tv.whineVolume, t + 0.3, 0.4);
      this._whine = { o, gn };
    } else if (!on && this._whine) {
      const w = this._whine; this._whine = null;
      w.gn.gain.setTargetAtTime(0, t, 0.08); w.o.stop(t + 0.6);
    }
  },
  channelClick(tvOn) {
    if (!this.started) return;
    const t = this.ctx.currentTime + 0.01;
    if (!this.playFile('channel-click', t, this.sfx)) {
      this.burst(t, { dur: 0.025, vol: 0.4, f: 1800, q: 1.5 });
      this.tone(t, { f: 150, f2: 90, type: 'triangle', dur: 0.05, vol: 0.25 });
    }
    if (tvOn) this.burst(t + 0.01, { dur: CFG.tv.staticBurstMs / 1000, vol: 0.32, type: 'highpass', f: 300, dest: this.tv, attack: 0.01 });
  },
  knobTick() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    if (this._lastTick && t - this._lastTick < 0.05) return;
    this._lastTick = t;
    this.burst(t, { dur: 0.008, vol: 0.08, f: 3000, q: 2 });
  },
  stopChannel() {
    if (this._chan) { this._chan.stop(this.ctx.currentTime); this._chan = null; }
  },
  startChannel(ch) {
    if (!this.started) return;
    this.stopChannel();
    const tv = this.tv;
    if (ch.type === 'testcard') {
      this._chan = this.loop('tv-testcard', tv, 0.8, () => {
        const o = this.o('sine', ch.toneHz || 1000), gn = this.g(0);
        o.connect(gn).connect(tv); o.start(); gn.gain.setTargetAtTime(ch.toneVolume ?? 0.035, this.ctx.currentTime, 0.05);
        return { stop: at => { gn.gain.setTargetAtTime(0, at, 0.03); o.stop(at + 0.3); } };
      });
    } else if (ch.type === 'static') {
      this._chan = this.loop('tv-static', tv, 0.8, () => {
        const n = this.noise('white'), hp = this.f('highpass', 350), lp = this.f('lowpass', 7500), gn = this.g(0);
        n.connect(hp).connect(lp).connect(gn).connect(tv); n.start(0, Math.random() * 3);
        gn.gain.setTargetAtTime(ch.hissVolume ?? 0.22, this.ctx.currentTime, 0.03);
        const cr = this.every(0.05, 0.4, t => this.burst(t, { dur: 0.004, vol: rand(0.05, 0.2), f: rand(1500, 5000), dest: tv }));
        return { stop: at => { cr.stop(); gn.gain.setTargetAtTime(0, at, 0.03); n.stop(at + 0.3); } };
      });
    } else if (ch.type === 'morning') {
      this._chan = this.loop('tv-morning', tv, 0.8, () => this.morningMusic(tv, ch.musicVolume ?? 0.32));
    } else if (ch.type === 'video') {
      this._chan = null;  // звук идёт из самого видео
    }
  },
  routeVideo(ch, v) {
    if (!this.started || ch._src || ch._srcFailed) { v.muted = state.muted; return; }
    try { ch._src = this.ctx.createMediaElementSource(v); ch._src.connect(this.tv); }
    catch (_) { ch._srcFailed = true; v.volume = state.tvVolume; v.muted = state.muted; }
  },

  /* Бодрая утренняя музыка: C – Am – F – G, 112 bpm (оригинальная мелодия) */
  morningMusic(dest, vol) {
    const ctx = this.ctx, mg = this.g(vol); mg.connect(dest);
    const step = 60 / 112 / 4;
    const prog = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]];
    const lead = [
      76, 0, 79, 0, 84, 0, 79, 0, 81, 0, 79, 0, 76, 0, 0, 0,
      72, 0, 76, 0, 81, 0, 79, 0, 76, 0, 72, 0, 74, 0, 0, 0,
      77, 0, 81, 0, 84, 0, 81, 0, 79, 0, 77, 0, 76, 0, 0, 0,
      74, 0, 79, 0, 83, 0, 81, 0, 79, 0, 0, 0, 0, 0, 0, 0,
    ];
    const leadLp = this.f('lowpass', 3200); leadLp.connect(mg);
    const padLp = this.f('lowpass', 2000); padLp.connect(mg);
    let next = ctx.currentTime + 0.08, i = 0, alive = true;
    const playStep = (k, t) => {
      const bar = k >> 4, s = k & 15, chord = prog[bar];
      if (s % 4 === 0) this.tone(t, { f: 150, f2: 42, dur: 0.22, vol: 0.5, dest: mg });
      if (s === 4 || s === 12) { this.burst(t, { dur: 0.14, vol: 0.22, f: 1900, q: 0.7, dest: mg }); this.tone(t, { f: 190, f2: 140, dur: 0.08, vol: 0.12, dest: mg }); }
      if (s % 2 === 1) this.burst(t, { dur: 0.035, vol: 0.06, type: 'highpass', f: 7500, dest: mg });
      if (s % 2 === 0) this.tone(t, { f: midi(chord[0] - 24 + (s % 4 === 2 ? 12 : 0)), type: 'triangle', dur: step * 1.8, vol: 0.2, attack: 0.005, dest: mg });
      if (s === 2 || s === 6 || s === 10 || s === 14) for (const n of chord) { this.tone(t, { f: midi(n), type: 'square', dur: step * 1.3, vol: 0.022, dest: padLp, detune: -6 }); this.tone(t, { f: midi(n), type: 'square', dur: step * 1.3, vol: 0.018, dest: padLp, detune: 7 }); }
      if (lead[k]) this.tone(t, { f: midi(lead[k]), type: 'square', dur: step * 1.85, vol: 0.05, attack: 0.006, dest: leadLp });
    };
    const tick = () => { if (!alive) return; while (next < ctx.currentTime + 0.25) { playStep(i, next); next += step; i = (i + 1) % 64; } };
    const iv = setInterval(tick, 45); tick();
    return { stop: at => { alive = false; clearInterval(iv); mg.gain.setTargetAtTime(0, at, 0.04); setTimeout(() => mg.disconnect(), 800); } };
  },

  /* ---------- пасхалки и щелчки ---------- */
  windowLatch() {
    if (!this.started) return;
    const t = this.ctx.currentTime + 0.01;
    if (this.playFile('window-latch', t, this.sfx, { pan: 0.8 })) return;
    this.burst(t, { dur: 0.03, vol: 0.25, f: 1300, q: 2, pan: 0.8 });
    this.tone(t + 0.02, { f: 900, f2: 700, type: 'triangle', dur: 0.06, vol: 0.06, pan: 0.8 });
    this.burst(t + 0.12, { dur: 0.05, vol: 0.18, type: 'lowpass', f: 900, pan: 0.8 });
  },
  lampClick() {
    if (!this.started) return;
    const t = this.ctx.currentTime + 0.01;
    if (this.playFile('lamp-click', t, this.sfx)) return;
    this.burst(t, { dur: 0.012, vol: 0.32, f: 2200, q: 2, pan: -0.7 });
    this.burst(t + 0.075, { dur: 0.012, vol: 0.26, f: 1500, q: 2, pan: -0.7 });
    this.tone(t + 0.075, { f: 260, type: 'triangle', dur: 0.035, vol: 0.08, pan: -0.7 });
  },
  egg(name, pan = 0.2) {
    if (!this.started) return;
    const t = this.ctx.currentTime + 0.02, d = this.sfx;
    if (this.playFile(name, t, d, { pan })) return;
    const fn = this.eggs[name]; if (fn) fn.call(this, t, d, pan);
  },
  eggs: {
    'egg-sachet'(t, d, pan) {
      const n = this.noise('pink', false), bp = this.f('bandpass', 380, 3), gn = this.g(0);
      n.connect(bp).connect(gn); this.out(gn, d, pan);
      bp.frequency.setValueAtTime(380, t); bp.frequency.exponentialRampToValueAtTime(1150, t + 2.4);
      gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(0.55, t + 0.15); gn.gain.setValueAtTime(0.55, t + 2.1); gn.gain.linearRampToValueAtTime(0, t + 2.6);
      const lfo = this.o('sine', 11), lg = this.g(0.18); lfo.connect(lg).connect(gn.gain); lfo.start(t); lfo.stop(t + 2.7);
      n.start(t, Math.random(), 2.7);
      for (let i = 0; i < 95; i++) this.tone(t + rand(1.2, 4.2), { f: rand(3000, 9000), dur: rand(0.006, 0.016), vol: rand(0.01, 0.05), dest: d, pan });
      const h = this.noise('white', false), hh = this.f('highpass', 6000), hg = this.g(0);
      h.connect(hh).connect(hg); this.out(hg, d, pan);
      hg.gain.setValueAtTime(0, t + 1.2); hg.gain.linearRampToValueAtTime(0.06, t + 1.6); hg.gain.linearRampToValueAtTime(0, t + 4.3);
      h.start(t + 1.2, 0, 3.2);
    },
    'egg-tamagotchi'(t, d, pan) {
      for (let i = 0; i < 3; i++) this.tone(t + i * 0.12, { f: 4096, type: 'square', dur: 0.06, vol: 0.045, attack: 0.001, dest: d, pan });
      [2637, 3136, 3951, 5274].forEach((f, i) => this.tone(t + 0.5 + i * 0.09, { f, type: 'square', dur: 0.08, vol: 0.04, attack: 0.001, dest: d, pan }));
    },
    'egg-brickgame'(t, d, pan) {
      const mel = [72, 76, 79, 84, 83, 79, 76, 79, 81, 77, 74, 77, 79, 0, 79, 84];
      const bass = [48, 0, 55, 0, 53, 0, 50, 0];
      mel.forEach((n, i) => n && this.tone(t + i * 0.11, { f: midi(n), type: 'square', dur: 0.1, vol: 0.04, attack: 0.002, dest: d, pan }));
      bass.forEach((n, i) => n && this.tone(t + i * 0.22, { f: midi(n), type: 'triangle', dur: 0.2, vol: 0.12, dest: d, pan }));
      [84, 88, 91, 96].forEach((n, i) => this.tone(t + 1.85 + i * 0.06, { f: midi(n), type: 'square', dur: 0.08, vol: 0.035, attack: 0.002, dest: d, pan }));
    },
    'egg-rubik'(t, d, pan) {
      let tt = t;
      for (let i = 0, n = irand(4, 6); i < n; i++) {
        for (const off of [0, 0.034]) {
          this.burst(tt + off, { dur: 0.012, vol: 0.38, f: rand(2200, 3800), q: 2.5, dest: d, pan });
          this.tone(tt + off, { f: rand(900, 1300), type: 'triangle', dur: 0.03, vol: 0.07, dest: d, pan });
        }
        tt += rand(0.17, 0.3);
      }
    },
    'egg-rubik-turn'(t, d, pan) {
      for (const off of [0, 0.034]) {
        this.burst(t + off, { dur: 0.012, vol: 0.38, f: rand(2200, 3800), q: 2.5, dest: d, pan });
        this.tone(t + off, { f: rand(900, 1300), type: 'triangle', dur: 0.03, vol: 0.07, dest: d, pan });
      }
    },
    'egg-bear'(t, d, pan) {
      const bp = this.f('bandpass', 520, 2.2), lp = this.f('lowpass', 1100), gn = this.g(0);
      bp.connect(lp).connect(gn); this.out(gn, d, pan);
      gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(0.45, t + 0.12); gn.gain.linearRampToValueAtTime(0.35, t + 0.7); gn.gain.linearRampToValueAtTime(0, t + 1.1);
      const vib = this.o('sine', 6), vg = this.g(7); vib.connect(vg);
      for (const det of [0, 14]) {
        const o = this.o('sawtooth', 230); o.detune.value = det;
        o.frequency.setValueAtTime(230, t); o.frequency.linearRampToValueAtTime(150, t + 1.05);
        vg.connect(o.frequency); o.connect(bp); o.start(t); o.stop(t + 1.15);
      }
      vib.start(t); vib.stop(t + 1.15);
    },
    'egg-cassette'(t, d, pan) {
      let tt = t, gap = 0.09;
      while (tt < t + 2.6) {
        this.burst(tt, { dur: 0.006, vol: rand(0.1, 0.2), f: 2600, q: 3, dest: d, pan });
        tt += gap; gap = tt < t + 1.6 ? Math.max(0.035, gap * 0.93) : gap * 1.12;
      }
      const n = this.noise('white', false), bp = this.f('bandpass', 3500, 1), gn = this.g(0);
      n.connect(bp).connect(gn); this.out(gn, d, pan);
      gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(0.03, t + 0.4); gn.gain.linearRampToValueAtTime(0, t + 2.7);
      n.start(t, 0, 2.8);
      this.tone(t + rand(0.5, 1.8), { f: 1800, f2: 2100, dur: 0.15, vol: 0.01, dest: d, pan });
    },
    'egg-figurine'(t, d, pan) {
      const notes = [84, 88, 91, 88, 86, 84, 83, 86, 89, 86, 84, 79, 84];
      let tt = t, gap = 0.3;
      const gn = this.g(1); this.out(gn, d, pan); gn.connect(this.verb);
      notes.forEach((n, i) => {
        const f = midi(n);
        this.tone(tt, { f, dur: 1.4, vol: 0.07, attack: 0.002, dest: gn });
        this.tone(tt, { f: f * 2, dur: 0.6, vol: 0.02, attack: 0.002, dest: gn });
        this.tone(tt, { f: f * 3.01, dur: 0.3, vol: 0.01, attack: 0.002, dest: gn });
        tt += gap; if (i > 8) gap *= 1.14;
      });
      setTimeout(() => gn.disconnect(), 8000);
    },
    'egg-teapot'(t, d, pan) {
      [0, 0.35, 0.62].forEach(off => {
        const f = rand(2600, 3200);
        this.tone(t + off, { f, dur: 0.5, vol: 0.08, attack: 0.001, dest: d, pan });
        this.tone(t + off, { f: f * 2.71, dur: 0.25, vol: 0.04, attack: 0.001, dest: d, pan });
        this.tone(t + off, { f: f * 5.2, dur: 0.12, vol: 0.02, attack: 0.001, dest: d, pan });
        this.burst(t + off, { dur: 0.004, vol: 0.1, f: 5000, dest: d, pan });
      });
      for (let i = 0; i < 5; i++) this.burst(t + 1.0 + i * rand(0.05, 0.08), { dur: 0.006, vol: 0.09, f: 3600, q: 3, dest: d, pan });
    },
  },
};

/* ==========================================================================
   6. СЛУЧАЙНЫЕ СОБЫТИЯ: 40–120 с, без повторов подряд,
      яичница и сирена — гарантированно чаще, чем раз в mustWithinSec
   ========================================================================== */
const Events = {
  last: null, lastAt: {}, timer: 0, nextAt: 0, started: false,
  must() { return CFG.events.mustHappen || {}; },               // { событие: не реже, чем раз в N секунд }
  start() {
    if (this.started) return;
    this.started = true;
    const now = nowMs() / 1000;
    // первая яичница — в первые ~1,5 минуты, первая сирена — позже
    for (const [k, win] of Object.entries(this.must())) this.lastAt[k] = now - win + (k === 'frying' ? 95 : win * 0.65);
    this.schedule(rand(...CFG.events.firstDelaySec));
  },
  schedule(gap) {
    const E = CFG.events, now = nowMs() / 1000;
    if (gap == null) gap = rand(E.minIntervalSec, E.maxIntervalSec);
    const dl = Object.entries(this.must()).map(([k, win]) => (this.lastAt[k] ?? now) + win);
    const deadline = dl.length ? Math.min(...dl) : Infinity;
    if (now + gap > deadline) gap = Math.max(deadline - now, 15);
    clearTimeout(this.timer);
    this.nextAt = now + gap;
    this.timer = setTimeout(() => this.fire(), gap * 1000);
  },
  fire() {
    const E = CFG.events, now = nowMs() / 1000;
    if (document.hidden || !Sound.started || Sound.ctx.state !== 'running') { this.schedule(20); return; }
    const urgent = Object.entries(this.must()).filter(([m]) => m !== this.last)
      .map(([m, win]) => ({ m, slack: (this.lastAt[m] ?? now) + win - now }))
      .sort((a, b) => a.slack - b.slack);
    let id;
    if (urgent.length && urgent[0].slack < E.maxIntervalSec) id = urgent[0].m;
    else {
      const pool = Object.entries(E.weights).filter(([k]) => k !== this.last && Sound[k]);
      let r = Math.random() * pool.reduce((s, [, w]) => s + w, 0);
      for (const [k, w] of pool) { r -= w; if (r <= 0) { id = k; break; } }
      id = id || pool[0][0];
    }
    this.play(id);
    this.schedule();
  },
  play(id) {
    if (!Sound.started || !Sound[id]) return;
    const t = Sound.ctx.currentTime + 0.05;
    const dur = Sound[id](t);
    if (id === 'siren') Light.siren(nowMs() + 50, dur * 1000);
    this.last = id; this.lastAt[id] = nowMs() / 1000;
    Calib.log(`событие: ${id}`);
  },
};

/* ==========================================================================
   7. КЛИКАБЕЛЬНЫЕ ЗОНЫ И ПАСХАЛКИ
   ========================================================================== */
/* Форточка — регулятор уличного шума, спрятанный в интерьере */
const Vent = {
  index() { const L = CFG.audio.windowLevels; let best = 0; L.forEach((v, i) => { if (Math.abs(v - state.vent) < Math.abs(L[best] - state.vent)) best = i; }); return best; },
  set(v, quiet) {
    state.vent = clamp(Math.round(v * 100) / 100, 0, 1);
    try { localStorage.setItem('tubetv.vent', String(state.vent)); } catch (_) {}
    Sound.applyVent();
    Zones.refreshLabels();
    if (!quiet) UI.toast(T.drapeNow[this.index()], 2200);
  },
  cycle() {
    const L = CFG.audio.windowLevels, i = (this.index() + 1) % L.length;
    Sound.ventClick(); this.set(L[i]);
  },
};

const Zones = {
  wrap: $('#zones'), cap: $('#caption'), els: {},
  knobAngle: { channelKnob: 0, volumeKnob: 0 },
  defs() {
    return [
      { id: 'power', cls: 'power', pad: 0.25, label: () => T.power },
      { id: 'channelKnob', cls: 'knob channel', pad: 0, label: () => T.channelKnob },
      { id: 'volumeKnob', cls: 'knob volume', pad: 0, label: () => T.volumeKnob },
      { id: 'lamp', cls: 'lamp', pad: 0.05, label: () => T.lamp[nextIn(CFG.timeCycle, state.mode)] },
      { id: 'window', cls: 'window', pad: 0, label: () => T.weatherNext[nextIn(CFG.weatherCycle, state.weather)] },
      { id: 'drape', cls: 'drape', pad: 0, label: () => T.drape[Vent.index()] },
      ...(CFG.radio ? [{ id: 'radio', cls: 'radio', pad: 0.04, label: () => Radio.label() }] : []),
      ...(CFG.vcr ? [{ id: 'vcr', cls: 'prop-zone', pad: 0.04, label: () => VCR.label() }] : []),
      ...(CFG.props ? [{ id: 'clock', cls: 'prop-zone', pad: 0.05, label: () => Props.clockLabel() }, { id: 'calendar', cls: 'prop-zone', pad: 0.05, label: () => Props.calLabel() }] : []),
      ...CFG.eggs.map(e => ({ id: e.id, cls: 'egg' + (e.eveningOnly ? ' evening-only' : ''), pad: 0.22, label: () => e.label, egg: e })),
    ];
  },
  init() {
    for (const d of this.defs()) {
      if (!CFG.zones[d.id]) { console.warn('[Tube TV] нет зоны', d.id); continue; }
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'hot ' + d.cls; el.dataset.id = d.id;
      el.setAttribute('aria-label', d.label());
      el.innerHTML = '<span class="halo"></span><span class="crop"></span>';
      el._def = d;
      this.wrap.appendChild(el);
      this.els[d.id] = el;
      this.bind(el, d);
    }
    this.apply();
  },
  apply() {
    for (const [id, el] of Object.entries(this.els)) {
      const z = CFG.zones[id]; placeEl(el, z);
      const pad = el._def.pad, crop = el.querySelector('.crop'), p = zpx(z);
      const cx = p.x - p.w * pad, cy = p.y - p.h * pad;
      Object.assign(crop.style, {
        left: (-pad * 100) + '%', top: (-pad * 100) + '%', width: (100 + pad * 200) + '%', height: (100 + pad * 200) + '%',
        backgroundSize: `calc(var(--u) * ${IMG_W}) calc(var(--u) * ${IMG_H})`,
        backgroundPosition: `calc(var(--u) * ${-cx}) calc(var(--u) * ${-cy})`,
      });
    }
    const ph = $('#powerHint'); placeEl(ph, CFG.zones.power);
  },
  refreshLabels() { for (const el of Object.values(this.els)) el.setAttribute('aria-label', el._def.label()); },

  showCaption(el, ms, below = false) {
    const z = CFG.zones[el.dataset.id];
    this.cap.textContent = el._def.label();
    this.cap.style.left = (z.x + z.w / 2) + '%';
    this.cap.style.top = (below ? z.y + z.h : Math.max(z.y, 4)) + '%';
    this.cap.classList.toggle('below', below);
    this.cap.classList.add('show');
    clearTimeout(this._capT);
    if (ms) this._capT = setTimeout(() => this.cap.classList.remove('show'), ms);
  },
  hideCaption() { this.cap.classList.remove('show'); },

  bind(el, d) {
    el.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { this.showCaption(el, 0, el.classList.contains('active') && !!(d.egg && d.egg.fx)); if (d.egg) Puppets.hover(d.id, true); } });
    el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { this.hideCaption(); if (d.egg) Puppets.hover(d.id, false); } });
    el.addEventListener('focus', () => { this.showCaption(el); if (d.egg) Puppets.hover(d.id, true); });
    el.addEventListener('blur', () => { this.hideCaption(); if (d.egg) Puppets.hover(d.id, false); });
    if (d.id === 'volumeKnob') return this.bindVolume(el);
    if (d.id === 'radio') el.addEventListener('wheel', e => { e.preventDefault(); Radio.setVolume(state.radioVolume + (e.deltaY < 0 ? 0.05 : -0.05)); }, { passive: false });
    if (d.id === 'drape') el.addEventListener('wheel', e => { e.preventDefault(); Sound.start(); Vent.set(state.vent + (e.deltaY < 0 ? 0.04 : -0.04), true); this.showCaption(el); }, { passive: false });
    if (d.id === 'channelKnob') {
      el.addEventListener('wheel', e => {
        e.preventDefault();
        const t = nowMs(); if (this._wheelT && t - this._wheelT < 260) return; this._wheelT = t;
        this.turnChannel(e.deltaY > 0 ? 1 : -1);
      }, { passive: false });
      el.addEventListener('contextmenu', e => { e.preventDefault(); this.turnChannel(-1); });
    }
    el.addEventListener('click', async e => {
      if (d.id === 'radio') { Radio.click(); if (!HOVER) this.showCaption(el, 2600); return; }   // без ожиданий: Safari пускает звук только прямо в щелчке
      await Sound.start();
      const below = !!(d.egg && d.egg.fx);           // эффект поднимается вверх — подпись уводим вниз
      if (!HOVER || below) this.showCaption(el, HOVER ? 0 : 1800, below);
      this.activate(d, e);
    });
  },

  async activate(d, e) {
    const el = this.els[d.id];
    if (d.id === 'power') {
      el.querySelector('.crop').animate([{ transform: 'scale(1)' }, { transform: 'scale(.9) translateY(4%)' }, { transform: 'scale(1)' }], { duration: 180 });
      TV.toggle();
    } else if (d.id === 'channelKnob') {
      this.turnChannel(e && e.shiftKey ? -1 : 1);
    } else if (d.id === 'lamp') {
      Sound.lampClick();
      setMode(nextIn(CFG.timeCycle, state.mode));
      if (HOVER && el.matches(':hover')) this.showCaption(el);
    } else if (d.id === 'drape') {
      Vent.cycle();
      if (HOVER && el.matches(':hover')) this.showCaption(el);
    } else if (d.id === 'window') {
      Sound.windowLatch();
      setWeather(nextIn(CFG.weatherCycle, state.weather));
      UI.toast(T.weatherNow[state.weather], 2600);
      if (HOVER && el.matches(':hover')) this.showCaption(el);
    } else if (d.id === 'radio') {
      Radio.click();
    } else if (d.id === 'clock') {
      Props.ring();
    } else if (d.id === 'vcr') {
      VCR.click();
    } else if (d.id === 'calendar') {
      Props.tear();
    } else if (d.egg) {
      this.playEgg(d.egg, el);
    }
  },

  turnChannel(dir) {
    Sound.start();
    this.knobAngle.channelKnob += dir * 30;
    const crop = this.els.channelKnob.querySelector('.crop');
    crop.style.transition = 'transform .14s cubic-bezier(.3,1.6,.5,1)';
    crop.style.transform = `rotate(${this.knobAngle.channelKnob}deg)`;
    TV.setChannel(TV.ch + dir);
  },

  bindVolume(el) {
    const crop = el.querySelector('.crop');
    const setVol = v => {
      v = clamp(Math.round(v * 100) / 100, 0, 1);
      if (v === state.tvVolume) return;
      Sound.setTvVolume(v); Sound.knobTick();
      const mx = $('#mxTv'); if (mx) mx.value = v;
      crop.style.transform = `rotate(${(v - CFG.tv.defaultVolume) * 270}deg)`;
      TV.osdVolUntil = nowMs() + 1600;
    };
    el.addEventListener('wheel', e => {
      e.preventDefault(); Sound.start();
      setVol(state.tvVolume + (e.deltaY < 0 ? 1 : -1) * CFG.tv.volumeStep);
    }, { passive: false });
    let drag = null;
    el.addEventListener('pointerdown', e => {
      Sound.start();
      drag = { x: e.clientX, y: e.clientY, v: state.tvVolume, moved: false };
      el.setPointerCapture(e.pointerId); el.classList.add('dragging');
    });
    el.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = drag.y - e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      setVol(drag.v + (dy + dx) / 160);
    });
    const end = () => {
      if (drag && !drag.moved) { TV.osdVolUntil = nowMs() + 1600; if (!HOVER) this.showCaption(el, 1600); }
      drag = null; el.classList.remove('dragging');
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', e => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); setVol(state.tvVolume + CFG.tv.volumeStep); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); setVol(state.tvVolume - CFG.tv.volumeStep); }
    });
  },

  playEgg(egg, el) {
    if (Puppets.busy(egg.id)) return;
    const z = CFG.zones[egg.id];
    const pan = clamp((z.x + z.w / 2 - 50) / 50, -1, 1);
    // у кубика щелчки звучат на каждом повороте грани; файл egg-rubik, если он есть, играет целиком
    if (egg.anim !== 'cube' || Sound.files[egg.sound]) Sound.egg(egg.sound, pan);
    el.classList.add('active');
    const done = Puppets.items[egg.id] ? Puppets.play(egg.id) : wait(800);
    done.then(() => el.classList.remove('active'));
    if (egg.fx) FX[egg.fx] && FX[egg.fx](z);
  },
};

/* ==========================================================================
   7b. ОБЪЁМНЫЕ ПАСХАЛКИ
   Каждый предмет вырезан из картинки (assets/eggs/<id>-<mode>.png), а под ним
   лежит «чистая подложка» (<id>-plate-<mode>.png). В покое слой невидим и
   совпадает с фоном пиксель в пиксель; при клике предмет двигается в 3D
   (perspective + rotateX/Y), а подложка закрывает место, где он стоял.
   ========================================================================== */
const wa = (el, frames, opts) => el.animate(frames, Object.assign({ fill: 'none' }, opts)).finished.catch(() => {});
const wait = ms => new Promise(r => setTimeout(r, ms));
const shade = (hex, k, warm = 0) => {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = r * k + warm * 18; g = g * k + warm * 6; b = b * k - warm * 10;
  return `rgb(${clamp(r, 0, 255) | 0},${clamp(g, 0, 255) | 0},${clamp(b, 0, 255) | 0})`;
};

const Puppets = {
  items: {},
  init() {
    this.wrap = document.createElement('div');
    this.wrap.className = 'puppets';
    stageEl.insertBefore(this.wrap, $('#zones'));
    for (const egg of CFG.eggs) {
      if (!egg.sprite) continue;
      const [x, y, w, h] = egg.sprite;
      const el = document.createElement('div');
      el.className = 'puppet'; el.dataset.id = egg.id;
      Object.assign(el.style, { left: x / IMG_W * 100 + '%', top: y / IMG_H * 100 + '%', width: w / IMG_W * 100 + '%', height: h / IMG_H * 100 + '%' });
      el.innerHTML = '<img class="plate" alt=""><span class="shadow"></span>' +
        '<div class="body"><img class="sprite" alt=""><img class="glow-sprite" alt=""><span class="sheen"><i></i></span></div>';
      this.wrap.appendChild(el);
      const p = { egg, el, body: el.querySelector('.body'), sprite: el.querySelector('.sprite'), box: egg.sprite };
      this.items[egg.id] = p;
      this.extras(p);
    }
    this.mode = state.scene;
    idle(() => this.wake(), 1500);
  },
  wake() { if (this.live) return; this.live = true; this.setMode(this.mode || state.scene); },
  /* перед анимацией: картинки предмета загружены и раскодированы (не дольше 1,5 с) */
  ensure(p) {
    this.wake();
    const imgs = [p.sprite, p.el.querySelector('.plate')];
    const dec = im => im.complete && im.naturalWidth ? Promise.resolve() : (im.decode ? im.decode().catch(() => {}) : new Promise(r => { im.onload = im.onerror = r; }));
    return Promise.race([Promise.all(imgs.map(dec)), wait(1500)]);
  },
  src(id, mode, plate) { return `assets/eggs/${id}-${plate ? 'plate-' : ''}${mode}.png`; },
  /* Картинки предметов грузим не сразу, а когда страница уже показалась (или по первому наведению) */
  setMode(mode) {
    this.mode = mode;
    if (!this.live) return;
    for (const p of Object.values(this.items)) {
      const id = p.egg.id, cut = id === 'sachet' ? Pack.spriteURL(mode) : this.src(id, mode);
      p.el.querySelector('.plate').src = this.src(id, mode, true);
      p.sprite.src = cut;
      if (p.sides) for (const s of p.sides) s.src = cut;
      p.el.querySelector('.glow-sprite').src = cut;
      p.el.style.setProperty('--cut', `url("${cut}")`);
      if (p.tt) p.tt.dirty = true;
      if (p.cube) p.cube.dirty = true;
    }
  },
  hover(id, on) { const p = this.items[id]; if (on) this.wake(); if (p) p.el.classList.toggle('hover', on); },
  busy(id) { const p = this.items[id]; return !!(p && p.busy); },
  /* пиксели картинки → проценты коробки предмета */
  rel(p, px, py) { return [(px - p.box[0]) / p.box[2] * 100, (py - p.box[1]) / p.box[3] * 100]; },

  extras(p) {
    const e = p.egg;
    /* толщина: несколько затемнённых копий силуэта позади — при повороте видно ребро предмета */
    if (e.depth) {
      const n = Math.max(3, Math.min(8, Math.round(e.depth / 1.5)));
      const frag = document.createDocumentFragment();
      for (let i = n; i >= 1; i--) {
        const s = document.createElement('img'); s.className = 'side'; s.alt = '';
        s.style.transform = `translateZ(calc(var(--u) * ${(-e.depth * i / n).toFixed(2)})) scale(.95)`;   // чуть меньше: мягкий край вырезки не даёт тёмного контура
        s.style.filter = `brightness(${(0.6 - 0.18 * i / n).toFixed(2)}) saturate(.85)`;
        frag.appendChild(s);
      }
      p.body.insertBefore(frag, p.sprite);
      p.sides = [...p.body.querySelectorAll('.side')];
    }
    if (e.lcd) {
      const c = document.createElement('canvas'); c.className = 'lcd'; c.width = 100; c.height = 100;
      const [lx, ly] = this.rel(p, e.lcd[0], e.lcd[1]);
      Object.assign(c.style, { left: lx + '%', top: ly + '%', width: e.lcd[2] / p.box[2] * 100 + '%', height: e.lcd[3] / p.box[3] * 100 + '%' });
      p.body.appendChild(c); p.lcd = c;
    }
    if (e.reels) {
      p.reels = e.reels.map(([rx, ry]) => {
        const r = document.createElement('span'); r.className = 'reel';
        const [cx, cy] = this.rel(p, rx, ry), d = e.reelRadius * 2;
        Object.assign(r.style, { left: cx + '%', top: cy + '%', width: d / p.box[2] * 100 + '%', height: d / p.box[3] * 100 + '%' });
        r.innerHTML = '<svg viewBox="-10 -10 20 20" aria-hidden="true"><circle r="8.6" fill="none" stroke="rgba(235,225,205,.55)" stroke-width="1.6"/>' +
          [0, 60, 120, 180, 240, 300].map(a => `<rect x="-1.1" y="-6.6" width="2.2" height="3.2" rx=".5" fill="rgba(240,232,214,.8)" transform="rotate(${a})"/>`).join('') +
          '<circle r="3.4" fill="rgba(30,24,20,.55)"/></svg>';
        p.body.appendChild(r);
        return r;
      });
    }
  },

  async play(id) {
    const p = this.items[id];
    if (!p || p.busy) return;
    p.busy = true;
    await this.ensure(p);
    // на закате свет живой (солнце садится, тюль колышет пятна): вырезку берём из текущего кадра,
    // а под предметом WebGL рисует комнату без него — никаких застывших прямоугольников
    let live = false;
    if (BG.gl && state.scene === 'sunset' && GLRoom.holeOK && GLRoom.platesReady) {
      const fr = GLRoom.grab(p.box), mask = p.alpha || (p.alpha = await this.maskOf(p));
      if (fr && mask) {
        const g = fr.getContext('2d'); g.globalCompositeOperation = 'destination-in'; g.drawImage(mask, 0, 0, fr.width, fr.height);
        const url = fr.toDataURL();
        p.sprite.src = url; if (p.sides) for (const sd of p.sides) sd.src = url;
        await new Promise(r => p.sprite.complete ? r() : (p.sprite.onload = r));
        if (p.tt) p.tt.dirty = true;
        GLRoom.hole(p.box); live = true; p.el.classList.add('gl-hole');
      }
    }
    p.el.classList.add('anim');
    try { await (this.anims[p.egg.anim] || this.anims.rattle3d).call(this, p); }
    catch (err) { console.warn('[Tube TV] анимация', id, err); }
    p.body.style.transform = '';
    p.el.classList.remove('anim', 'no-sprite');
    if (live) { GLRoom.hole(null); p.el.classList.remove('gl-hole'); this.setMode(this.mode); }
    p.busy = false;
  },
  /* маска предмета — альфа дневной вырезки */
  maskOf(p) {
    return new Promise(r => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = p.egg.id === 'sachet' ? Pack.spriteURL('day') : this.src(p.egg.id, 'day'); });
  },

  sheen(p, dur, delay = 0) {
    const s = p.el.querySelector('.sheen'), i = s.firstChild;
    wa(s, [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: dur, delay });
    return wa(i, [{ transform: 'translateX(0) skewX(-12deg)' }, { transform: 'translateX(420%) skewX(-12deg)' }], { duration: dur, delay, easing: 'ease-in-out' });
  },
  lift(p, dur, frames) {
    return wa(p.el.querySelector('.shadow'), frames || [{ opacity: 0, transform: 'scale(1)' }, { opacity: 0.85, transform: 'scale(.82)', offset: 0.25 }, { opacity: 0.85, transform: 'scale(.82)', offset: 0.75 }, { opacity: 0, transform: 'scale(1)' }], { duration: dur });
  },
  /* набор ключевых кадров с одинаковым списком функций — так WAAPI интерполирует честно */
  k(list) { return list.map(([o, ty, rx, ry, rz, s = 1]) => ({ offset: o, transform: `translateY(${ty}%) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${s})` })); },

  anims: {
    /* пакетик: берём в руку, встряхиваем, поворачиваем к свету */
    async shake3d(p) {
      p.body.style.transformOrigin = '50% 88%';
      const d = REDUCED ? 900 : 1800;
      this.lift(p, d); this.sheen(p, d * 0.7, d * 0.15);
      await wa(p.body, this.k([
        [0, 0, 0, 0, 0], [0.12, -8, 6, -26, -4], [0.24, -10, 4, 22, 5], [0.36, -10, 6, -20, -4], [0.48, -9, 4, 16, 3],
        [0.62, -8, 5, -10, -2], [0.78, -4, 2, 6, 1], [1, 0, 0, 0, 0]]), { duration: d, easing: 'ease-in-out' });
    },
    /* тамагочи: крутится на цепочке */
    async twirl(p) {
      p.body.style.transformOrigin = '40% 46%';
      const d = REDUCED ? 1000 : 2100;
      this.sheen(p, d * 0.6, 120);
      await wa(p.body, this.k([
        [0, 0, 0, 0, 0], [0.1, -3, 0, 38, 6, 1.04], [0.25, -3, 0, -32, -5, 1.04], [0.42, -2, 0, 22, 3, 1.02],
        [0.6, -1, 0, -13, -2], [0.78, 0, 0, 6, 1], [1, 0, 0, 0, 0]]), { duration: d, easing: 'ease-out' });
    },
    /* брик-гейм: поднимаем, наклоняем экраном к себе, на экране падают кирпичики */
    async pickup(p) {
      p.body.style.transformOrigin = '50% 96%';
      const d = REDUCED ? 1600 : 2700;
      this.lift(p, d);
      const lcd = this.lcdRun(p, d * 0.78, d * 0.1);
      await Promise.all([lcd, wa(p.body, this.k([
        [0, 0, 0, 0, 0], [0.12, -7, 18, -6, 0, 1.04], [0.3, -7, 16, -4, -1.5, 1.04], [0.4, -7.5, 17, -5, 1.2, 1.04],
        [0.55, -7, 16, -4, -1, 1.04], [0.7, -7.5, 18, -6, 1, 1.04], [0.88, -3, 6, -2, 0, 1.01], [1, 0, 0, 0, 0]]), { duration: d, easing: 'ease-in-out' })]);
    },
    /* мишка: качается на попе, как неваляшка, — и рычит */
    async rock(p) {
      p.body.style.transformOrigin = '50% 93%';
      const d = REDUCED ? 1000 : 2000;
      this.lift(p, d, [{ opacity: 0 }, { opacity: 0.5, offset: 0.2 }, { opacity: 0 }]);
      await wa(p.body, this.k([
        [0, 0, 0, 0, 0, 1], [0.08, 0, 0, 0, 0, 0.97], [0.22, 0, 4, -10, -9, 1], [0.4, 0, -3, 9, 7], [0.56, 0, 2, -6, -5],
        [0.7, 0, -1, 4, 3], [0.84, 0, 0, -2, -1.4], [1, 0, 0, 0, 0]]), { duration: d, easing: 'ease-in-out' });
    },
    /* кассета: перемотка карандашом — катушки крутятся */
    async rewind(p) {
      p.body.style.transformOrigin = '40% 60%';
      const d = REDUCED ? 1400 : 2700;
      const spin = (p.reels || []).map((r, i) => wa(r, [{ transform: 'translate(-50%,-50%) rotate(0deg)' }, { transform: `translate(-50%,-50%) rotate(${i ? -1260 : -1440}deg)` }],
        { duration: d * 0.9, delay: d * 0.05, easing: 'cubic-bezier(.5,0,.3,1)' }));
      this.sheen(p, d * 0.5, d * 0.25);
      await Promise.all([...spin, wa(p.body, this.k([
        [0, 0, 0, 0, 0], [0.12, -4, 12, 8, -2], [0.3, -4, 12, 8, 1.2], [0.45, -4.5, 12, 9, -1.2], [0.6, -4, 12, 8, 1.2],
        [0.75, -4.5, 12, 9, -1], [0.9, -1.5, 4, 3, 0], [1, 0, 0, 0, 0]]), { duration: d, easing: 'ease-in-out' })]);
    },
    /* чайник: крышка дребезжит, сам чуть поворачивается */
    async rattle3d(p) {
      p.body.style.transformOrigin = '50% 92%';
      await wa(p.body, this.k([
        [0, 0, 0, 0, 0], [0.12, -1, 0, -8, -2.5], [0.26, -1.5, 0, 7, 2.2], [0.4, -1, 0, -6, -2], [0.54, -1, 0, 5, 1.6],
        [0.7, -0.5, 0, -3, -1], [0.85, 0, 0, 1.5, 0.5], [1, 0, 0, 0, 0]]), { duration: REDUCED ? 600 : 1100, easing: 'ease-out' });
    },
    /* кубик Рубика: подменяется настоящим 3D-кубом, крутит грани и возвращается */
    async cube(p) {
      const c = this.buildCube(p);
      const turn = () => Sound.egg('egg-rubik-turn', 0.4);
      c.wrap.style.opacity = '0'; c.wrap.hidden = false;
      await wa(c.wrap, [{ opacity: 0 }, { opacity: 1 }], { duration: 140, fill: 'forwards' });
      c.wrap.style.opacity = '1';
      p.el.classList.add('no-sprite');
      const yaw = p.egg.cube.yaw;
      const pose = (ty, rx, ry) => `translateY(${ty}em) rotateX(${rx}deg) rotateY(${ry}deg)`;
      const base = pose(0, 0, yaw), tilt = pose(-0.55, -24, yaw + 24);
      const sp = REDUCED ? 1.6 : 1;
      await wa(c.cube, [{ transform: base }, { transform: tilt }], { duration: 420 * sp, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' });
      c.cube.style.transform = tilt;
      for (const [layer, axis, ang] of [['top', 'Y', 90], ['top', 'Y', 0], ['right', 'X', -90], ['right', 'X', 0]]) {
        turn(); await this.twist(c, layer, axis, ang, 230 * sp); await wait(60);
      }
      await wa(c.cube, [{ transform: tilt }, { transform: base }], { duration: 420 * sp, easing: 'cubic-bezier(.4,0,.3,1)', fill: 'forwards' });
      c.cube.style.transform = base;
      p.el.classList.remove('no-sprite');
      await wa(c.wrap, [{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' });
      c.wrap.hidden = true;
    },
    /* статуэтка: настоящий поворот вокруг оси (цилиндрическая проекция в WebGL) */
    async turntable(p) {
      const tt = this.ttSetup(p);
      if (!tt || !this.ttUpload(p)) {                       // запасной вариант без WebGL
        p.body.style.transformOrigin = '50% 96%';
        await wa(p.body, this.k([[0, 0, 0, 0, 0], [0.25, -2, 0, 40, 0], [0.5, 0, 0, -38, 0], [0.75, -2, 0, 30, 0], [1, 0, 0, 0, 0]]), { duration: 5000, easing: 'ease-in-out' });
        return;
      }
      this.ttResize(p);
      this.ttDraw(p, 0);
      tt.c.style.opacity = '0'; tt.c.hidden = false;
      await wa(tt.c, [{ opacity: 0 }, { opacity: 1 }], { duration: 240, fill: 'forwards' });   // фото → модель без скачка
      tt.c.style.opacity = '1';
      p.el.classList.add('no-sprite');
      const d = REDUCED ? 4200 : 6200, t0 = nowMs(), turns = REDUCED ? 1 : 1;
      await new Promise(res => {
        const step = () => {
          const k = clamp((nowMs() - t0) / d, 0, 1);
          const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;   // easeInOutCubic
          this.ttDraw(p, e * Math.PI * 2 * turns);
          tt.c.style.transform = `translateY(${-Math.sin(k * Math.PI) * 3}%)`;
          if (k < 1) requestAnimationFrame(step); else res();
        };
        requestAnimationFrame(step);
      });
      p.el.classList.remove('no-sprite');
      await wa(tt.c, [{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' });
      tt.c.hidden = true; tt.c.style.transform = ''; tt.c.style.opacity = '';
    },
  },

  /* ---------- кубик ---------- */
  buildCube(p) {
    const cfg = p.egg.cube;
    if (p.cube && !p.cube.dirty) return p.cube;
    if (p.cube) p.cube.wrap.remove();
    const light = { day: 0.95, sunset: 0.82, overcast: 0.6, storm: 0.45, evening: 0.6, night: 0.22 }[state.scene] || 0.9;
    const warm = { day: 1, sunset: 1.5, overcast: 0.2, storm: 0, evening: 0.6 }[state.scene] ?? 1;
    const wrap = document.createElement('div'); wrap.className = 'cube-wrap'; wrap.hidden = true;
    const [cx, cy] = this.rel(p, cfg.center[0], cfg.center[1]);
    Object.assign(wrap.style, { left: cx + '%', top: cy + '%', fontSize: `calc(var(--u) * ${cfg.size / 3})` });
    const cube = document.createElement('div'); cube.className = 'cube3d';
    cube.style.transform = `translateY(0em) rotateX(0deg) rotateY(${cfg.yaw}deg)`;
    wrap.appendChild(cube);
    const pal = ['#e2c02c', '#3f8f48', '#3a5fb0', '#dcd6cc', '#d0614c', '#c8682e'];
    const rnd = () => pal[Math.floor(Math.random() * pal.length)];
    const faces = { front: [0, 0, 1, 1.0], back: [180, 0, -1, 0.55], right: [90, 0, 1, 0.72], left: [-90, 0, 1, 0.8], top: [0, 90, 1, 1.08], bottom: [0, -90, 1, 0.5] };
    const cubies = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const cb = document.createElement('div'); cb.className = 'cubie';
      cb._pos = [i, j, k];
      cb._base = `translate3d(${i}em, ${j}em, ${k}em)`;
      cb.style.transform = `rotateX(0deg) rotateY(0deg) ${cb._base}`;
      for (const [name, [ry, rx, , lum]] of Object.entries(faces)) {
        const outer = (name === 'front' && k === 1) || (name === 'back' && k === -1) || (name === 'right' && i === 1) ||
                      (name === 'left' && i === -1) || (name === 'top' && j === -1) || (name === 'bottom' && j === 1);
        const f = document.createElement('i');
        f.style.transform = `rotateY(${ry}deg) rotateX(${rx}deg) translateZ(.5em)`;
        if (outer) {
          let col = rnd();
          if (name === 'front') col = cfg.front[(j + 1) * 3 + (i + 1)];
          if (name === 'left') col = cfg.left[(j + 1) * 3 + (k + 1)];
          f.innerHTML = `<b style="background:${shade(col, lum * light, warm)}"></b>`;
        }
        cb.appendChild(f);
      }
      cube.appendChild(cb); cubies.push(cb);
    }
    p.el.appendChild(wrap);
    p.cube = { wrap, cube, cubies, dirty: false };
    return p.cube;
  },
  twist(c, layer, axis, ang, dur) {
    const sel = layer === 'top' ? cb => cb._pos[1] === -1 : cb => cb._pos[0] === 1;
    const fn = a => axis === 'Y' ? `rotateX(0deg) rotateY(${a}deg)` : `rotateX(${a}deg) rotateY(0deg)`;
    return Promise.all(c.cubies.filter(sel).map(cb => {
      const from = cb._ang || 0; cb._ang = ang;
      cb.style.transform = `${fn(ang)} ${cb._base}`;
      return wa(cb, [{ transform: `${fn(from)} ${cb._base}` }, { transform: `${fn(ang)} ${cb._base}` }], { duration: dur, easing: 'cubic-bezier(.5,0,.3,1.25)' });
    }));
  },

  /* ---------- экран брик-гейма ---------- */
  lcdRun(p, dur, delay) {
    const c = p.lcd; if (!c) return Promise.resolve();
    const g = c.getContext('2d'), N = 10, cs = 10;
    const well = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => y >= 8 && x !== 4 && x !== 5 ? 1 : 0));
    const piece = [[0, 0], [1, 0], [0, 1], [1, 1]];                 // «квадрат» падает в щель
    const draw = (py, flash) => {
      g.fillStyle = '#9fae86'; g.fillRect(0, 0, 100, 100);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        let on = well[y][x];
        if (piece.some(([dx, dy]) => x === 4 + dx && y === py + dy)) on = 1;
        if (flash && y >= 8) on = flash % 2;
        g.fillStyle = on ? '#2a311f' : 'rgba(42,49,31,.1)';
        g.fillRect(x * cs + 1, y * cs + 1, cs - 2, cs - 2);
      }
    };
    return new Promise(res => setTimeout(() => {
      c.classList.add('on'); draw(-2, 0);
      const steps = 9, flashes = 4, total = steps + flashes + 2, dt = dur / total; let i = 0;
      const iv = setInterval(() => {
        i++;
        if (i <= steps) draw(i - 2, 0);
        else if (i <= steps + flashes) draw(7, i - steps);
        else { clearInterval(iv); c.classList.remove('on'); res(); }
      }, dt);
    }, delay));
  },

  /* ---------- статуэтка: настоящая 3D-модель ----------
     Фарфоровая девочка с корзинкой собрана из поля расстояний (подставка, юбка колоколом со складками
     и оборкой, фартук, лиф с рукавами-фонариками, голова, капор, руки, корзинка с цветами) и рисуется
     трассировкой лучей: мягкие тени, затенение в складках, блик глазури. Лицевая сторона дополнительно
     «расписана» самой фотографией — лицо, цветы, складки остаются те же, что на картинке. */
  ttSetup(p) {
    if (p.tt) return p.tt.gl ? p.tt : null;
    const c = document.createElement('canvas'); c.className = 'tt'; c.hidden = true;
    p.el.appendChild(c);
    const gl = c.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false });
    p.tt = { c, gl: null, dirty: true };
    if (!gl) return null;
    c.addEventListener('webglcontextlost', e => { e.preventDefault(); c.remove(); if (p.tt && p.tt.c === c) p.tt = null; });
    const VS = 'attribute vec2 a; varying vec2 v; void main(){ v = a * 0.5 + 0.5; v.y = 1.0 - v.y; gl_Position = vec4(a, 0.0, 1.0); }';
    const FS = `
precision highp float;
varying vec2 v;
uniform sampler2D uPhoto;        // вырезка статуэтки из фото (RGBA)
uniform float uTheta, uPhotoW;   // угол поворота, сила росписи с фото
uniform vec3 uKey, uAmbT, uAmbB, uKeyC;   // свет: направление, небо/пол, цвет ключевого
uniform vec4 uBox;               // как модельные координаты ложатся на холст: (масштаб x, масштаб y, сдвиг x, сдвиг y)
uniform vec4 uPh;                // проекция фото: px на единицу, центр x (px), низ y (px)
uniform vec2 uPhSize;            // размер фото, px
float sdSph(vec3 p, float r){ return length(p) - r; }
float sdEll(vec3 p, vec3 r){ float k0 = length(p / r), k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / k1; }
float sdCap(vec3 p, vec3 a, vec3 b, float r){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
/* юбка: тело вращения с профилем r(y) и складками */
float skirt(vec3 p, float y0, float y1, float r0, float r1, float cx0, float cx1, float folds, float fa){
  float t = clamp((p.y - y0) / (y1 - y0), 0.0, 1.0);
  float cx = mix(cx0, cx1, t);
  vec2 q = vec2(p.x - cx, p.z * 1.18);
  float ang = atan(q.y, q.x);
  float r = mix(r0, r1, pow(t, 0.85)) + fa * (1.0 - t) * sin(ang * folds) + fa * 0.4 * sin(ang * folds * 2.0 + 1.3) * (1.0 - t);
  float d = length(q) - r;
  float dy = max(y0 - p.y, p.y - y1);
  return max(d * 0.8, dy);
}
vec2 map(vec3 p){
  // подставка: невысокий овальный цоколь с фаской
  vec2 q = vec2(length(p.xz * vec2(1.0, 1.3)) - 0.15, p.y - 0.035);
  float base = min(max(q.x, abs(q.y) - 0.035), 0.0) + length(max(vec2(q.x, abs(q.y) - 0.035), 0.0)) - 0.01;
  vec2 m = vec2(base, 1.0);
  // нижняя юбка — колоколом, с глубокими складками и оборкой по подолу
  float sk = skirt(p, 0.055, 0.37, 0.178, 0.118, -0.008, 0.03, 9.0, 0.016);
  float ruffle = skirt(p, 0.055, 0.09, 0.19, 0.18, -0.008, -0.004, 23.0, 0.008);
  // фартук-верхняя юбка до середины
  float ap = skirt(p, 0.32, 0.575, 0.142, 0.092, 0.035, 0.025, 7.0, 0.01);
  float dress = smin(smin(sk, ruffle, 0.01), ap, 0.015);
  if (dress < m.x) m = vec2(dress, 2.0);
  // лиф: сужается к талии, грудь чуть вперёд
  vec3 tp = p - vec3(0.018, 0.665, 0.0);
  float w = mix(0.07, 0.092, smoothstep(-0.09, 0.07, tp.y));
  float torso = sdEll(tp, vec3(w, 0.11, 0.062));
  // рукава-фонарики
  float puffL = sdSph(p - vec3(-0.072, 0.735, 0.0), 0.04);
  float puffR = sdSph(p - vec3(0.105, 0.73, 0.008), 0.038);
  torso = smin(torso, min(puffL, puffR), 0.02);
  if (torso < m.x) m = vec2(torso, 3.0);
  float neck = sdCap(p, vec3(0.012, 0.75, 0.0), vec3(0.01, 0.82, 0.006), 0.026);
  float head = sdEll(p - vec3(0.014, 0.862, 0.014), vec3(0.064, 0.072, 0.066));
  float nose = sdSph(p - vec3(0.03, 0.86, 0.078), 0.012);
  float face = smin(smin(neck, head, 0.02), nose, 0.012);
  if (face < m.x) m = vec2(face, 4.0);
  // волосы и шляпка-капор: облегает голову, поля приподняты справа
  float hair = sdEll(p - vec3(0.0, 0.88, -0.022), vec3(0.074, 0.07, 0.07));
  vec3 hp = p - vec3(0.018, 0.928, 0.0);
  float c = cos(-0.22), s = sin(-0.22); hp.xy = mat2(c, -s, s, c) * hp.xy;
  float crown = sdEll(hp - vec3(0.0, 0.01, -0.01), vec3(0.075, 0.045, 0.072));
  float brim = max(sdEll(hp, vec3(0.112, 0.016, 0.1)), -sdEll(hp - vec3(0.0, -0.03, 0.0), vec3(0.08, 0.04, 0.075)));
  float hh = smin(hair, smin(crown, brim, 0.01), 0.012);
  if (hh < m.x) m = vec2(hh, 5.0);
  // руки: левая вдоль тела к бедру, правая держит корзинку
  float armL = sdCap(p, vec3(-0.08, 0.73, 0.0), vec3(-0.072, 0.63, 0.03), 0.022);
  armL = smin(armL, sdCap(p, vec3(-0.072, 0.63, 0.03), vec3(-0.045, 0.565, 0.062), 0.019), 0.012);
  float armR = smin(sdCap(p, vec3(0.108, 0.725, 0.01), vec3(0.122, 0.665, 0.05), 0.02), sdCap(p, vec3(0.122, 0.665, 0.05), vec3(0.1, 0.655, 0.085), 0.017), 0.01);
  float arms = min(armL, armR);
  if (arms < m.x) m = vec2(arms, 6.0);
  float hand = sdEll(p - vec3(-0.04, 0.553, 0.07), vec3(0.022, 0.026, 0.02));
  if (hand < m.x) m = vec2(hand, 4.0);
  // корзинка с цветами
  vec3 bp = p - vec3(0.122, 0.635, 0.07);
  float bowl = max(sdEll(bp, vec3(0.082, 0.046, 0.058)), bp.y - 0.008);
  bowl = max(bowl, -sdEll(bp - vec3(0.0, 0.01, 0.0), vec3(0.07, 0.04, 0.048)));
  float flowers = sdEll(bp - vec3(0.0, 0.012, 0.0), vec3(0.07, 0.026, 0.05)) - 0.006 * sin(bp.x * 120.0) * sin(bp.z * 110.0);
  float basket = min(bowl, flowers);
  if (basket < m.x) m = vec2(basket, bowl < flowers ? 7.0 : 8.0);
  return m;
}
vec3 nrm(vec3 p){ vec2 e = vec2(0.0015, 0.0); return normalize(vec3(map(p + e.xyy).x - map(p - e.xyy).x, map(p + e.yxy).x - map(p - e.yxy).x, map(p + e.yyx).x - map(p - e.yyx).x)); }
float hsh(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
vec3 albedo(float id, vec3 p){
  vec3 porc = vec3(0.93, 0.91, 0.86);
  if (id < 1.5) return porc * 0.96;
  if (id < 2.5) { float band = smoothstep(0.345, 0.335, p.y) * smoothstep(0.315, 0.328, p.y); vec3 d = mix(porc, vec3(0.80, 0.83, 0.87), 0.3 * smoothstep(0.37, 0.1, p.y)); return mix(d, vec3(0.90, 0.78, 0.58), band * 0.8); }
  if (id < 3.5) return mix(porc, vec3(0.86, 0.88, 0.92), 0.4);
  if (id < 4.5) return vec3(0.96, 0.85, 0.77);
  if (id < 5.5) return vec3(0.86, 0.68, 0.38);
  if (id < 6.5) return mix(porc, vec3(0.88, 0.89, 0.93), 0.3);
  if (id < 7.5) return vec3(0.74, 0.56, 0.32);
  float r = hsh(floor(p * 90.0));
  return r < 0.4 ? vec3(0.95, 0.78, 0.30) : r < 0.65 ? vec3(0.86, 0.42, 0.40) : r < 0.85 ? vec3(0.52, 0.66, 0.38) : vec3(0.95, 0.93, 0.88);
}
float ao(vec3 p, vec3 n){ float o = 0.0, w = 1.0; for (int i = 1; i <= 5; i++){ float h = 0.012 * float(i); o += w * (h - map(p + n * h).x); w *= 0.6; } return clamp(1.0 - 4.0 * o, 0.0, 1.0); }
float shadow(vec3 p, vec3 l){ float r = 1.0, t = 0.01; for (int i = 0; i < 24; i++){ float h = map(p + l * t).x; r = min(r, 10.0 * h / t); t += clamp(h, 0.006, 0.05); if (r < 0.02 || t > 0.6) break; } return clamp(r, 0.0, 1.0); }
void main(){
  vec2 m = vec2((v.x - uBox.z) / uBox.x, (1.0 - v.y - uBox.w) / uBox.y);    // модельные x, y
  float c = cos(uTheta), s = sin(uTheta);
  mat3 R = mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);                     // поворот вокруг вертикали
  mat3 Ri = mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
  vec3 ro = R * vec3(m.x, m.y, 1.0), rd = R * vec3(0.0, 0.0, -1.0);
  float t = 0.0, id = -1.0;
  for (int i = 0; i < 72; i++){ vec2 h = map(ro + rd * t); if (h.x < 0.0008){ id = h.y; break; } t += h.x * 0.9; if (t > 2.0) break; }
  if (id < 0.0){ gl_FragColor = vec4(0.0); return; }
  vec3 p = ro + rd * t, n = nrm(p);
  vec3 alb = albedo(id, p);
  // роспись с фотографии на лицевой стороне (в системе самой фигурки)
  vec2 ph = vec2(uPh.y + p.x * uPh.x, uPh.z - p.y * uPh.x) / uPhSize;
  vec4 photo = texture2D(uPhoto, vec2(ph.x, ph.y));
  float front = smoothstep(0.15, 0.75, n.z) * photo.a * uPhotoW;
  // освещение в мире: ключевой свет сцены, небо/пол, фарфоровая глазурь
  vec3 nw = R * n, vw = -rd;
  vec3 L = normalize(uKey);
  float dif = max(dot(nw, L), 0.0) * shadow(p, Ri * L);
  vec3 amb = mix(uAmbB, uAmbT, nw.y * 0.5 + 0.5);
  float o = ao(p, n);
  vec3 col = alb * (amb * o + uKeyC * dif);
  vec3 H = normalize(L + vw);
  float spec = pow(max(dot(nw, H), 0.0), 60.0) * (0.35 + 0.65 * dif);
  float fres = pow(1.0 - max(dot(nw, vw), 0.0), 4.0);
  col += uKeyC * spec * 0.55 + amb * fres * 0.18;
  // фото уже содержит свет сцены — смешиваем с ним в лицевой зоне
  vec3 phc = photo.rgb / max(photo.a, 0.001);
  col = mix(col, phc * (0.75 + 0.5 * dif) + uKeyC * spec * 0.3, front);
  gl_FragColor = vec4(col, 1.0);
}`;
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    try {
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.bindAttribLocation(prog, 0, 'a'); gl.linkProgram(prog); gl.useProgram(prog);
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const U = n => gl.getUniformLocation(prog, n);
      p.tt.u = { theta: U('uTheta'), photoW: U('uPhotoW'), key: U('uKey'), ambT: U('uAmbT'), ambB: U('uAmbB'), keyC: U('uKeyC'), box: U('uBox'), ph: U('uPh'), phSize: U('uPhSize') };
      p.tt.tex = gl.createTexture();
      gl.uniform1i(U('uPhoto'), 0);
      // модель: 1 ед. = 95 px фото, низ подставки — y = 112 px, ось — x = 37.5 px (в коробке 75×123)
      const [, , bw, bh] = p.box, F = CFG.figurine || {}, unit = F.unitPx || 95, cx = F.axisX || 37.5, by = F.baseY || 112;
      gl.uniform4f(p.tt.u.box, unit / bw, unit / bh, cx / bw, (bh - by) / bh);
      gl.uniform4f(p.tt.u.ph, unit, cx, by, 0); gl.uniform2f(p.tt.u.phSize, bw, bh);
      p.tt.gl = gl;
      return p.tt;
    } catch (err) { console.warn('[Tube TV] статуэтка:', err); return null; }
  },
  /* фото → текстура; средний цвет фото задаёт экспозицию и тон света модели в этой сцене */
  ttUpload(p) {
    const tt = p.tt, gl = tt.gl;
    if (!tt.dirty) return true;
    const img = p.sprite;
    if (!img.complete || !img.naturalWidth) return false;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tt.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    let C = [0.6, 0.55, 0.5];
    try {
      const cv = document.createElement('canvas'); cv.width = 32; cv.height = 48;
      const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, 32, 48);
      const d = g.getImageData(0, 0, 32, 48).data; let r = 0, gg = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
      if (n) C = [r / n / 255, gg / n / 255, b / n / 255].map(x => Math.pow(x, 2.2));
    } catch (_) {}
    // свет по сцене: откуда ключевой (днём — окно справа, вечером — торшер слева, ночью — экран спереди)
    const K = { day: [0.7, 0.45, 0.55], sunset: [0.85, 0.22, 0.48], evening: [-0.8, 0.35, 0.5], overcast: [0.5, 0.6, 0.6], storm: [0.4, 0.6, 0.7], night: [0.0, 0.1, 1.0] }[state.scene] || [0.6, 0.5, 0.6];
    const T = { day: [1.0, 0.95, 0.85], sunset: [1.15, 0.8, 0.55], evening: [1.1, 0.88, 0.62], overcast: [0.92, 0.97, 1.05], storm: [0.88, 0.95, 1.08], night: [0.8, 0.9, 1.25] }[state.scene] || [1, 1, 1];
    const g2 = x => Math.pow(x, 1 / 2.2);
    const base = C.map(g2), lum = base[0] * 0.3 + base[1] * 0.59 + base[2] * 0.11;
    const k = lum / 0.62;                                           // модель при k=1 даёт яркость ~0.62
    gl.uniform3fv(tt.u.key, K);
    gl.uniform3fv(tt.u.ambT, T.map(t => 0.58 * k * t));
    gl.uniform3fv(tt.u.ambB, T.map(t => 0.3 * k * t));
    gl.uniform3fv(tt.u.keyC, T.map(t => 0.62 * k * t));
    tt.dirty = false;
    return true;
  },
  ttResize(p) {
    const r = p.el.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
    if (p.tt.c.width !== w || p.tt.c.height !== h) { p.tt.c.width = w; p.tt.c.height = h; }
    p.tt.gl.viewport(0, 0, w, h);
  },
  ttDraw(p, theta) {
    if (!p.tt || !p.tt.gl) return;
    const gl = p.tt.gl;
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(p.tt.u.theta, theta);
    // роспись с фото сильнее, когда фигурка смотрит на нас, — в начале и в конце совпадает с картинкой
    const away = Math.min(Math.abs(theta % (Math.PI * 2)), Math.PI * 2 - Math.abs(theta % (Math.PI * 2)));
    gl.uniform1f(p.tt.u.photoW, 0.55 + 0.4 * (1 - smooth(0, 0.6, away)));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  },
};

/* ==========================================================================
   7c. РАДИОТОЧКА
   Трёхпрограммный громкоговоритель стоит на телевизоре слева. Нарисован кодом
   (корпус, ткань, клавиши, ручка) и освещается так же, как комната в каждой сцене.
   Звук — записи старых передач из Internet Archive, через «проводной» фильтр,
   в объёме: из угла ниши, с отзвуком комнаты.
   ========================================================================== */
const Radio = {
  prog: -1, light: null, lightTo: null, lightT0: 0,
  // освещение ниши в каждой сцене: цвет света и откуда он (−1 слева … +1 справа)
  LIGHT: {
    day:      { c: [0.53, 0.46, 0.37], dir: 0.55 },
    sunset:   { c: [0.50, 0.35, 0.25], dir: 0.8 },
    evening:  { c: [0.40, 0.27, 0.15], dir: -0.9 },
    night:    { c: [0.09, 0.10, 0.15], dir: 0.4 },
    overcast: { c: [0.29, 0.28, 0.29], dir: 0.3 },
    storm:    { c: [0.19, 0.19, 0.21], dir: 0.3 },
  },
  init() {
    const R = CFG.radio; if (!R) return;
    const [x, y, w, h] = R.box, m = { l: 14, t: 14, r: 12, b: 8 };
    this.geo = { x: x - m.l, y: y - m.t, w: w + m.l + m.r, h: h + m.t + m.b, m, bw: w, bh: h };
    const el = this.el = document.createElement('div'); el.className = 'radio-pt';
    Object.assign(el.style, { left: this.geo.x / IMG_W * 100 + '%', top: this.geo.y / IMG_H * 100 + '%', width: this.geo.w / IMG_W * 100 + '%', height: this.geo.h / IMG_H * 100 + '%' });
    el.innerHTML = '<canvas></canvas><i class="radio-glow"></i>';
    stageEl.insertBefore(el, $('#glow'));                 // под слоями света: его тоже освещает экран, мигалка, вспышка
    this.cv = el.querySelector('canvas'); this.g = this.cv.getContext('2d');
    this.light = this.sceneLight(state.scene);
    this.resize();
    addEventListener('resize', () => this.resize());
  },
  sceneLight(scene) { const L = this.LIGHT[scene] || this.LIGHT.day; return { c: L.c.slice(), dir: L.dir }; },
  setScene(scene) {
    if (!this.el) return;
    this.lightFrom = { c: this.light.c.slice(), dir: this.light.dir }; this.lightTo = this.sceneLight(scene); this.lightT0 = nowMs();
  },
  resize() {
    if (!this.cv) return;
    const k = Math.min(4, state.stage.u * (devicePixelRatio || 1) * (Camera.seated ? state.zoom || 1 : 1));
    const W = Math.round(this.geo.w * k), H = Math.round(this.geo.h * k);
    if (this.cv.width !== W || this.cv.height !== H) { this.cv.width = W; this.cv.height = H; }
    this.k = k; this.draw();
  },
  update(t) {
    if (!this.lightTo) return;
    const e = smooth(0, 1, clamp((t - this.lightT0) / CFG.crossfadeMs, 0, 1));
    this.light = { c: this.lightFrom.c.map((v, i) => lerp(v, this.lightTo.c[i], e)), dir: lerp(this.lightFrom.dir, this.lightTo.dir, e) };
    this.draw();
    if (e >= 1) this.lightTo = null;
  },

  /* ---------- рисунок ---------- */
  draw() {
    const g = this.g, k = this.k, G = this.geo, L = this.light; if (!g || !k) return;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, this.cv.width, this.cv.height);
    g.setTransform(k, 0, 0, k, G.m.l * k, G.m.t * k);           // единицы — пиксели картинки, (0,0) — левый верх передней панели
    const W = G.bw, H = G.bh, top = 6, side = 3;              // видно чуть сверху и чуть справа
    const lum = (L.c[0] * 0.3 + L.c[1] * 0.59 + L.c[2] * 0.11);
    const lit = (rgb, s = 1) => `rgb(${rgb.map((v, i) => clamp(Math.round(v * L.c[i] * s), 0, 255)).join(',')})`;
    const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    const on = this.prog >= 0;

    // тени: на заднюю стенку ниши (от света сбоку) и под корпусом на крышку телевизора
    g.save();
    g.shadowColor = `rgba(8,4,2,${0.55 - 0.15 * Math.abs(L.dir)})`; g.shadowBlur = 9 * k; g.shadowOffsetX = -L.dir * 7 * k; g.shadowOffsetY = -2 * k;
    g.fillStyle = 'rgba(0,0,0,1)'; rr(2, 2, W - 4, H - 6, 4); g.fill();
    g.restore();
    g.clearRect(-1, -top - 1, W + side + 2, H + top + 2);       // сама коробка закроет это место
    g.save(); g.globalAlpha = 0.6;
    const cs = g.createRadialGradient(W / 2, H, 2, W / 2, H, W * 0.62);
    cs.addColorStop(0, 'rgba(10,5,2,.85)'); cs.addColorStop(1, 'rgba(10,5,2,0)');
    g.fillStyle = cs; g.scale(1, 0.12); g.fillRect(-12, (H - 30) / 0.12, W + 24, 60 / 0.12); g.restore();

    // провод: из-за корпуса вниз, за телевизор
    g.save(); g.strokeStyle = lit([60, 52, 46]); g.lineWidth = 1.5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(2, H - 10); g.bezierCurveTo(-6, H - 6, -8, H + 2, -12, H + 6); g.stroke(); g.restore();

    const IVORY = [232, 220, 192], IVORY_D = [196, 182, 152];
    // правый бок (виден чуть-чуть)
    g.fillStyle = lit(IVORY_D, 0.72 + 0.2 * Math.max(0, L.dir));
    g.beginPath(); g.moveTo(W - 1, 3); g.lineTo(W + side, -top + 3); g.lineTo(W + side, H - top + 1); g.lineTo(W - 1, H - 1); g.closePath(); g.fill();
    // крышка
    g.fillStyle = lit(IVORY, 1.06);
    g.beginPath(); g.moveTo(3, 0); g.lineTo(W - 3, 0); g.lineTo(W + side - 2, -top); g.lineTo(side + 2, -top); g.closePath(); g.fill();
    // клавиши программ на крышке (справа); нажатая — ниже и темнее
    for (let i = 0; i < 3; i++) {
      const kx = W - 34 + i * 10 + side * 0.4, down = on && this.prog === i;
      const ky = -top + 1.5, kh = top - 2.5, rise = down ? 0.4 : 2;
      g.fillStyle = lit([214, 204, 182], down ? 0.7 : 1.0); g.fillRect(kx, ky - rise, 8, kh + rise * 0.4);
      g.fillStyle = lit([250, 244, 228], down ? 0.75 : 1.12); g.fillRect(kx, ky - rise, 8, 1.4);
      g.fillStyle = 'rgba(40,25,10,.35)'; g.fillRect(kx, ky - rise + kh + rise * 0.4, 8, 0.8);
    }
    // передняя панель
    const body = g.createLinearGradient(0, 0, 0, H);
    body.addColorStop(0, lit(IVORY, 1.02)); body.addColorStop(0.55, lit(IVORY, 0.93)); body.addColorStop(1, lit(IVORY_D, 0.78));
    g.fillStyle = body; rr(0, 0, W, H, 4.5); g.fill();
    // ткань громкоговорителя
    const gx = 5, gy = 5, gw = W * 0.64, gh = H - 13;
    g.save(); rr(gx, gy, gw, gh, 3); g.clip();
    g.fillStyle = lit([150, 116, 78]); g.fillRect(gx, gy, gw, gh);
    g.globalAlpha = 0.5; g.lineWidth = 0.35;
    for (let yy = gy; yy < gy + gh; yy += 0.9) { g.strokeStyle = lit((yy * 7 | 0) % 2 ? [176, 140, 98] : [120, 90, 60]); g.beginPath(); g.moveTo(gx, yy); g.lineTo(gx + gw, yy); g.stroke(); }
    g.globalAlpha = 0.28;
    for (let xx = gx; xx < gx + gw; xx += 0.9) { g.strokeStyle = lit([96, 72, 46]); g.beginPath(); g.moveTo(xx, gy); g.lineTo(xx, gy + gh); g.stroke(); }
    g.globalAlpha = 1;
    // вертикальные планки поверх ткани
    for (let i = 1; i < 9; i++) { const xx = gx + gw * i / 9; g.fillStyle = lit([196, 180, 148], 0.9); g.fillRect(xx - 0.55, gy, 1.1, gh); g.fillStyle = 'rgba(30,18,8,.28)'; g.fillRect(xx + 0.55, gy, 0.5, gh); }
    const vg = g.createRadialGradient(gx + gw / 2, gy + gh / 2, gh * 0.2, gx + gw / 2, gy + gh / 2, gw * 0.7);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(20,10,4,.45)'); g.fillStyle = vg; g.fillRect(gx, gy, gw, gh);
    g.restore();
    g.strokeStyle = 'rgba(40,24,10,.5)'; g.lineWidth = 0.8; rr(gx, gy, gw, gh, 3); g.stroke();
    // латунная полоска под тканью
    const brass = g.createLinearGradient(gx, 0, gx + gw, 0);
    brass.addColorStop(0, lit([150, 112, 50])); brass.addColorStop(0.5, lit([236, 196, 110], 1.1)); brass.addColorStop(1, lit([150, 112, 50]));
    g.fillStyle = brass; g.fillRect(gx, gy + gh + 2.2, gw, 1.6);
    // шкала программ
    const dx = gx + gw + 5, dw = W - dx - 5, dy = 6, dh = 17;
    g.fillStyle = on ? '#1b0f05' : lit([40, 34, 30]); rr(dx, dy, dw, dh, 2); g.fill();
    if (on) {
      const amb = g.createRadialGradient(dx + dw / 2, dy + dh / 2, 1, dx + dw / 2, dy + dh / 2, dw * 0.8);
      amb.addColorStop(0, 'rgba(255,190,90,.95)'); amb.addColorStop(1, 'rgba(200,90,20,.55)');
      g.fillStyle = amb; rr(dx + 0.8, dy + 0.8, dw - 1.6, dh - 1.6, 1.5); g.fill();
    }
    g.font = `bold 5.2px "Neucha", "Arial Narrow", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < 3; i++) {
      const cx = dx + dw * (i + 0.5) / 3;
      g.fillStyle = on ? (this.prog === i ? '#3a1504' : 'rgba(70,30,6,.55)') : lit([150, 140, 120]);
      g.fillText(['1', '2', '3'][i], cx, dy + dh * 0.42);
      if (on && this.prog === i) { g.fillStyle = '#c42a10'; g.fillRect(cx - 2.2, dy + dh - 4.4, 4.4, 1.6); }
    }
    // стекло шкалы
    const gl = g.createLinearGradient(dx, dy, dx, dy + dh); gl.addColorStop(0, `rgba(255,255,255,${0.22 * lum + 0.04})`); gl.addColorStop(0.45, 'rgba(255,255,255,0)');
    g.fillStyle = gl; rr(dx, dy, dw, dh, 2); g.fill();
    // ручка громкости
    const kx = dx + dw / 2, ky = H - 20, kr = 8.2;
    g.save();
    g.shadowColor = 'rgba(20,10,4,.55)'; g.shadowBlur = 3 * k; g.shadowOffsetX = -L.dir * 1.6 * k; g.shadowOffsetY = 1.2 * k;
    g.fillStyle = lit([190, 176, 150]); g.beginPath(); g.arc(kx, ky, kr, 0, Math.PI * 2); g.fill(); g.restore();
    for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2; g.strokeStyle = i % 2 ? lit([150, 136, 112]) : lit([222, 210, 186]); g.lineWidth = 0.7; g.beginPath(); g.moveTo(kx + Math.cos(a) * (kr - 1.3), ky + Math.sin(a) * (kr - 1.3)); g.lineTo(kx + Math.cos(a) * kr, ky + Math.sin(a) * kr); g.stroke(); }
    const kg = g.createRadialGradient(kx + L.dir * -2.5, ky - 3, 0.5, kx, ky, kr * 0.9);
    kg.addColorStop(0, lit([252, 246, 230], 1.15)); kg.addColorStop(1, lit([200, 186, 160], 0.9));
    g.fillStyle = kg; g.beginPath(); g.arc(kx, ky, kr - 1.6, 0, Math.PI * 2); g.fill();
    const va = (-135 + 270 * state.radioVolume) * Math.PI / 180;
    g.strokeStyle = lit([80, 60, 40]); g.lineWidth = 1.1; g.lineCap = 'round';
    g.beginPath(); g.moveTo(kx + Math.sin(va) * 1.5, ky - Math.cos(va) * 1.5); g.lineTo(kx + Math.sin(va) * (kr - 2.6), ky - Math.cos(va) * (kr - 2.6)); g.stroke();
    // свет сбоку: одна сторона ярче, блик по ребру
    g.save(); rr(0, 0, W, H, 4.5); g.clip();
    const side1 = g.createLinearGradient(0, 0, W, 0), a1 = 0.16 * lum / 0.5;
    side1.addColorStop(0, L.dir < 0 ? `rgba(255,236,200,${a1})` : `rgba(0,0,0,${a1 * 0.9})`);
    side1.addColorStop(0.5, 'rgba(0,0,0,0)');
    side1.addColorStop(1, L.dir > 0 ? `rgba(255,236,200,${a1})` : `rgba(0,0,0,${a1 * 0.9})`);
    g.globalCompositeOperation = 'soft-light'; g.fillStyle = side1; g.fillRect(0, 0, W, H);
    g.restore();
    g.strokeStyle = `rgba(255,248,230,${0.18 + 0.4 * lum})`; g.lineWidth = 0.7;
    g.beginPath(); g.moveTo(4, 0.5); g.lineTo(W - 4, 0.5); g.stroke();
    g.strokeStyle = 'rgba(30,18,8,.4)'; g.beginPath(); g.moveTo(4, H - 0.4); g.lineTo(W - 4, H - 0.4); g.stroke();
    // ножки
    g.fillStyle = 'rgba(18,10,5,.9)'; g.fillRect(8, H - 0.5, 9, 1.6); g.fillRect(W - 17, H - 0.5, 9, 1.6);
    // зерно и лёгкая потёртость пластика — как у всего на фотографии
    if (!this.noise) {
      const n = document.createElement('canvas'); n.width = n.height = 96; const ng = n.getContext('2d'), id = ng.createImageData(96, 96);
      for (let i = 0; i < id.data.length; i += 4) { const v = 128 + (Math.random() - 0.5) * 120; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
      ng.putImageData(id, 0, 0); this.noise = n;
    }
    g.save(); g.globalCompositeOperation = 'source-atop'; g.globalAlpha = 0.09 * clamp(lum * 2, 0.1, 1);   // только поверх уже нарисованного
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = g.createPattern(this.noise, 'repeat');
    g.beginPath(); g.rect(0, 0, this.cv.width, this.cv.height); g.fill();
    g.restore();
  },

  /* ---------- звук ---------- */
  label() {
    const T = CFG.text;
    if (this.prog < 0) return T.radioOff;
    if (this.needTap) return T.radioTap;
    const now = CFG.radio.programs[this.prog].name + (this.title ? ' — ' + this.title : '') + (this.loading ? ', ' + T.radioTuning : '');
    return (this.prog === CFG.radio.programs.length - 1 ? T.radioLast : T.radioNext).replace('{now}', now);
  },
  /* Всё, что запускает звук, делаем прямо в обработчике клика, без ожиданий:
     Safari разрешает play() только «внутри» жеста пользователя. */
  click() {
    Sound.start();
    if (this.needTap && this.au) {                     // браузер не дал запуститься — этот щелчок просто запускает
      this.needTap = false; this.tryPlay(); this.refresh(); return;
    }
    const n = CFG.radio.programs.length;
    this.select(this.prog + 1 >= n ? -1 : this.prog + 1);
  },
  key() {                                          // щелчок клавиши
    if (!Sound.started) return;
    const t = Sound.ctx.currentTime + 0.01, pan = -0.25;
    Sound.burst(t, { dur: 0.03, vol: 0.22, type: 'bandpass', f: 1700, q: 1.4, pan });
    Sound.burst(t + 0.045, { dur: 0.02, vol: 0.12, type: 'bandpass', f: 2600, q: 2, pan });
    Sound.tone(t, { f: 180, f2: 90, dur: 0.06, vol: 0.06, pan });
  },
  chain() {                                       // «проводной» звук: узкая полоса, маленький динамик, лёгкий перегруз
    if (this._chain || !Sound.started) return this._chain;
    const S = Sound, ctx = S.ctx;
    const inp = S.g(1), hp = S.f('highpass', 170, 0.8), lp = S.f('lowpass', 5200, 0.7), box = S.f('peaking', 950, 1.1), low = S.f('peaking', 260, 1.2);
    box.gain.value = 4; low.gain.value = 2.5;
    const sat = ctx.createWaveShaper(); sat.curve = S.softCurve(1.8); sat.oversample = '2x';
    const vol = S.g(0), pan = S.panner('room', 0, { fixed: true });
    S.setPos(pan, -0.55, 0.32, -2.6);                     // ниша: чуть левее и выше телевизора
    pan.refDistance = 2.7;
    inp.connect(hp).connect(low).connect(box).connect(lp).connect(sat).connect(vol).connect(pan).connect(S.master);
    vol.connect(S.g(0.38)).connect(S.roomVerb);
    // тихий фон трансляционной сети: 50 Гц и чуть-чуть шипения
    const hum = S.o('sine', 50), hg = S.g(0); hum.connect(hg).connect(inp); hum.start();
    const hiss = S.noise('pink'), hf = S.f('bandpass', 3000, 0.6), hs = S.g(0); hiss.connect(hf).connect(hs).connect(inp); hiss.start(0, Math.random() * 3);
    return (this._chain = { inp, vol, hg, hs });
  },
  /* звук готов (AudioContext поднят) — подключаем элемент к фильтру и включаем фон сети */
  wire() {
    if (!Sound.started) return;
    const c = this.chain();
    if (this.au && this.au._cors && !this.au._src) {
      try { this.au._src = Sound.ctx.createMediaElementSource(this.au); this.au._src.connect(c.inp); }
      catch (_) { this.au._src = null; }
    }
    this.bed(this.prog >= 0);
    this.fade(this.prog >= 0 && !this.loading ? 1 : 0, 0.4);
  },
  bed(on) {
    const c = this.chain(); if (!c) return;
    const t = Sound.ctx.currentTime;
    c.hg.gain.setTargetAtTime(on ? 0.006 : 0, t, 0.08); c.hs.gain.setTargetAtTime(on ? 0.012 : 0, t, 0.08);
  },
  setVolume(v) {
    state.radioVolume = clamp(v, 0, 1);
    try { localStorage.setItem('tubetv.radio', String(state.radioVolume)); } catch (_) {}
    if (this._chain && this.prog >= 0 && !this.loading) this._chain.vol.gain.setTargetAtTime(state.radioVolume * 1.15, Sound.ctx.currentTime, 0.05);
    this.syncMute();
    const mx = $('#mxRadio'); if (mx && +mx.value !== state.radioVolume) mx.value = state.radioVolume;
    this.draw();
  },
  /* простой элемент (без CORS) не проходит через Web Audio: громкость и «без звука» — у него самого.
     На iPhone volume у элемента только для чтения, поэтому выключаем через muted. */
  syncMute() {
    const a = this.au; if (!a || a._cors) return;
    a.muted = state.muted;
    try { a.volume = state.radioVolume; } catch (_) {}
  },
  /* Аудиоэлемент: сначала — с CORS (звук идёт через фильтр динамика и объём);
     если архив его не отдаст — обычный элемент без обработки. */
  audio() {
    if (this.au) return this.au;
    const a = new Audio(); a.preload = 'auto';
    a._cors = !this.noCors;
    if (a._cors) a.crossOrigin = 'anonymous';
    a.addEventListener('ended', () => this.au === a && this.next(true));
    a.addEventListener('playing', () => { if (this.au !== a) return; this.loading = false; this.fails = 0; if (!a._cors) this.plainOk = true; this.fade(1, 0.6); this.refresh(); });
    a.addEventListener('waiting', () => { if (this.au !== a) return; this.loading = true; this.refresh(); });
    a.addEventListener('error', () => this.au === a && this.onError());
    this.au = a;
    this.syncMute(); this.wire();
    return a;
  },
  drop() {
    const a = this.au; if (!a) return;
    this.au = null;
    try { a.pause(); a.removeAttribute('src'); a.load(); } catch (_) {}
    if (a._src) try { a._src.disconnect(); } catch (_) {}
  },
  onError() {
    if (this.prog < 0) return;
    this.fails = (this.fails || 0) + 1;
    const cors = this.au && this.au._cors;
    if (cors && !this.plainOk && !this.triedPlain) {
      // возможно, сервер не прислал CORS — пробуем ту же запись обычным элементом
      this.triedPlain = true; this.noCors = true; this.drop();
      return this.start(this.cur, true);
    }
    if (!cors && !this.plainOk) { this.noCors = false; this.triedPlain = false; }   // и так не играет — дело не в CORS, возвращаемся к полному звуку
    if (this.fails < 4) { this.drop(); return setTimeout(() => this.prog >= 0 && this.next(false), 700); }
    this.loading = false; this.refresh();
    UI.toast(CFG.text.radioFail, 4000);
  },
  select(i) {
    this.key();
    this.prog = i; this.fails = 0; this.needTap = false;
    this.draw(); this.el && this.el.classList.toggle('on', i >= 0);
    document.body.classList.toggle('radio-on', i >= 0);
    if (i < 0) {
      this.title = ''; this.loading = false;
      const a = this.au;
      if (a) { this.fade(0, 0.25); setTimeout(() => { if (this.prog < 0) a.pause(); }, 400); }
      this.bed(false); this.refresh();
      return;
    }
    if (!Sound.started) Sound.start().then(() => this.wire());
    this.bed(true);
    this.next(false);
  },
  fade(to, sec) {
    if (this._chain) this._chain.vol.gain.setTargetAtTime(to * state.radioVolume * 1.15, Sound.ctx.currentTime, Math.max(0.01, sec / 3));
  },
  next(sequential) {
    const P = CFG.radio.programs[this.prog]; if (!P) return;
    let idx;
    if (sequential && this.idx != null) idx = (this.idx + 1) % P.items.length;
    else { idx = irand(0, P.items.length - 1); if (P.items.length > 1 && idx === this.idx && this.lastProg === this.prog) idx = (idx + 1) % P.items.length; }
    this.idx = idx; this.lastProg = this.prog;
    this.start(P.items[idx], !sequential);
  },
  start(it, seekRandom) {
    this.cur = it;
    const a = this.audio(), url = CFG.radio.base + it.u.split('/').map(encodeURIComponent).join('/');
    this.title = it.t; this.loading = true; this.refresh();
    this.fade(0, 0.05);
    if (a._onMeta) a.removeEventListener('loadedmetadata', a._onMeta);
    a._onMeta = () => {
      a.removeEventListener('loadedmetadata', a._onMeta); a._onMeta = null;
      if (seekRandom && isFinite(a.duration) && a.duration > 240) {
        const span = a.duration - 120;
        try { a.currentTime = (it.long ? rand(0.05, 0.92) : rand(0, 0.6)) * span; } catch (_) {}
      }
    };
    a.addEventListener('loadedmetadata', a._onMeta);
    a.src = url;
    this.tryPlay();
  },
  tryPlay() {
    const a = this.au; if (!a) return;
    const p = a.play();
    if (p && p.catch) p.catch(err => {
      if (this.au !== a || this.prog < 0) return;
      if (err && err.name === 'NotAllowedError') { this.needTap = true; this.loading = false; this.refresh(); if (Zones.els.radio) Zones.showCaption(Zones.els.radio, 3500); }
    });
  },
  refresh() {
    const z = Zones.els && Zones.els.radio; if (!z) return;
    z.setAttribute('aria-label', this.label());
    if (HOVER && z.matches(':hover')) Zones.showCaption(z);
  },
};

/* ==========================================================================
   7d. БУДИЛЬНИК И ОТРЫВНОЙ КАЛЕНДАРЬ
   Оба нарисованы кодом и освещены так же, как радиоточка (свет ниши по сцене).
   Будильник на телевизоре справа показывает настоящее время и звенит по щелчку;
   календарик висит на гвоздике в нише — сегодняшнее число, только год 1995-й;
   листок можно оторвать.
   ========================================================================== */
const MONTHS = ['ЯНВАРЬ', 'ФЕВРАЛЬ', 'МАРТ', 'АПРЕЛЬ', 'МАЙ', 'ИЮНЬ', 'ИЮЛЬ', 'АВГУСТ', 'СЕНТЯБРЬ', 'ОКТЯБРЬ', 'НОЯБРЬ', 'ДЕКАБРЬ'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['ВОСКРЕСЕНЬЕ', 'ПОНЕДЕЛЬНИК', 'ВТОРНИК', 'СРЕДА', 'ЧЕТВЕРГ', 'ПЯТНИЦА', 'СУББОТА'];
/* восход и заход солнца в Москве (формулы NOAA, точность ±2 мин) */
function sunTimes(date, lat = 55.75, lon = 37.62, tz = 3) {
  const rad = Math.PI / 180, start = Date.UTC(date.getFullYear(), 0, 0);
  const N = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - start) / 864e5);
  const g = 2 * Math.PI / 365 * (N - 1);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = Math.acos(Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(dec)) - Math.tan(lat * rad) * Math.tan(dec)) / rad;
  const fmt = m => { m = (m + 1440) % 1440; return `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`; };
  return { rise: fmt(720 - 4 * (lon + ha) - eq + tz * 60), set: fmt(720 - 4 * (lon - ha) - eq + tz * 60) };
}

const Props = {
  init() {
    this.clock = this.mk('clock', CFG.props.clock.box, 'prop-clock');
    this.cal = this.mk('calendar', CFG.props.calendar.box, 'prop-cal');
    this.day = this.day || this.today();
    this.resize();
    addEventListener('resize', () => this.resize());
    this._sec = -1;
  },
  mk(id, box, cls) {
    const [x, y, w, h] = box;
    const el = document.createElement('div'); el.className = 'prop ' + cls;
    Object.assign(el.style, { left: x / IMG_W * 100 + '%', top: y / IMG_H * 100 + '%', width: w / IMG_W * 100 + '%', height: h / IMG_H * 100 + '%' });
    el.innerHTML = '<canvas></canvas>';
    stageEl.insertBefore(el, $('#glow'));
    const cv = el.querySelector('canvas');
    return { id, el, cv, g: cv.getContext('2d'), box };
  },
  resize() {
    const k = Math.min(4, state.stage.u * (devicePixelRatio || 1) * (Camera.seated ? state.zoom || 1 : 1));
    for (const o of [this.clock, this.cal]) {
      if (!o) continue;
      const W = Math.round(o.box[2] * k), H = Math.round(o.box[3] * k);
      if (o.cv.width !== W || o.cv.height !== H) { o.cv.width = W; o.cv.height = H; }
      o.k = k;
    }
    this.draw(true);
  },
  update(t) {
    const s = Math.floor(Date.now() / 1000);
    const relit = !!Radio.lightTo;                          // свет сцены меняется — перерисовываем
    if (s !== this._sec || relit) { this._sec = s; this.drawClock(); if (relit) this.drawCal(); if (!relit) this.tick(); }
  },
  draw() { this.drawClock(); this.drawCal(); },
  L() { return Radio.light || { c: [0.5, 0.45, 0.4], dir: 0.5 }; },
  lit(rgb, s = 1) { const L = this.L(); return `rgb(${rgb.map((v, i) => clamp(Math.round(v * L.c[i] * s), 0, 255)).join(',')})`; },

  /* ---------- будильник ---------- */
  drawClock() {
    const o = this.clock; if (!o) return;
    const g = o.g, k = o.k, L = this.L(), lum = L.c[0] * 0.3 + L.c[1] * 0.59 + L.c[2] * 0.11;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, o.cv.width, o.cv.height);
    const sh = this.shake || 0, jx = sh ? (Math.random() - 0.5) * 1.6 * sh : 0, jr = sh ? (Math.random() - 0.5) * 0.05 * sh : 0;
    g.setTransform(k, 0, 0, k, (44 + jx) * k, 50 * k); g.rotate(jr);
    const R = 26, lit = (c, s) => this.lit(c, s);
    // тень на стенку и на крышку телевизора
    g.save(); g.shadowColor = 'rgba(8,4,2,.55)'; g.shadowBlur = 8 * k; g.shadowOffsetX = -L.dir * 6 * k; g.shadowOffsetY = 1 * k;
    g.fillStyle = '#000'; g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill(); g.restore();
    g.clearRect(-R - 1, -R - 1, 2 * R + 2, 2 * R + 2);
    g.save(); g.globalAlpha = 0.55; const cs = g.createRadialGradient(0, R + 9, 1, 0, R + 9, 30); cs.addColorStop(0, 'rgba(10,5,2,.9)'); cs.addColorStop(1, 'rgba(10,5,2,0)');
    g.fillStyle = cs; g.scale(1, 0.18); g.fillRect(-34, (R + 2) / 0.18, 68, 14 / 0.18); g.restore();
    // ножки
    for (const s of [-1, 1]) { g.fillStyle = lit([200, 200, 205], 0.9); g.beginPath(); g.ellipse(s * 15, R + 4, 4, 3, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = lit([120, 120, 125]); g.fillRect(s * 15 - 1.5, R - 2, 3, 5); }
    // звонки-чашки и молоточек
    const chrome = (x0, y0, r) => { const gr = g.createRadialGradient(x0 - r * 0.35 * (L.dir < 0 ? 1 : -1), y0 - r * 0.4, r * 0.1, x0, y0, r);
      gr.addColorStop(0, lit([255, 255, 255], 1.25)); gr.addColorStop(0.45, lit([190, 192, 200])); gr.addColorStop(1, lit([70, 72, 80])); return gr; };
    for (const s of [-1, 1]) {
      const bx = s * 17, by = -R - 3;
      g.fillStyle = lit([150, 150, 155]); g.fillRect(bx - 1, by + 6, 2, 6);
      g.fillStyle = chrome(bx, by, 12); g.beginPath(); g.arc(bx, by + 3, 11.5, Math.PI, 0); g.closePath(); g.fill();
      g.fillStyle = lit([90, 90, 98]); g.fillRect(bx - 11.5, by + 2.4, 23, 1.2);
      g.fillStyle = lit([235, 235, 240], 1.1); g.beginPath(); g.arc(bx, by - 8.5, 1.6, 0, Math.PI * 2); g.fill();
    }
    const hammer = this.ringing ? Math.sin(nowMs() / 18) * 5 : 0;
    g.strokeStyle = lit([160, 160, 168]); g.lineWidth = 1.4; g.beginPath(); g.moveTo(0, -R + 2); g.lineTo(hammer, -R - 9); g.stroke();
    g.fillStyle = lit([200, 200, 208]); g.beginPath(); g.arc(hammer, -R - 9.5, 2, 0, Math.PI * 2); g.fill();
    // ручка-дужка
    g.strokeStyle = chrome(0, -R - 14, 18); g.lineWidth = 2.2; g.beginPath(); g.ellipse(0, -R - 4, 13, 12, 0, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
    // корпус — красная эмаль
    const body = g.createRadialGradient(-L.dir * 9, -12, 3, 0, 0, R * 1.05);
    body.addColorStop(0, lit([235, 70, 52], 1.15)); body.addColorStop(0.6, lit([168, 30, 26])); body.addColorStop(1, lit([90, 14, 12]));
    g.fillStyle = body; g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
    // ободок
    g.lineWidth = 3; g.strokeStyle = chrome(0, 0, R); g.beginPath(); g.arc(0, 0, R - 2.6, 0, Math.PI * 2); g.stroke();
    // циферблат
    const dial = g.createRadialGradient(-4, -6, 2, 0, 0, R - 4);
    dial.addColorStop(0, lit([252, 248, 236], 1.08)); dial.addColorStop(1, lit([214, 206, 186]));
    g.fillStyle = dial; g.beginPath(); g.arc(0, 0, R - 4.2, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 60; i++) {
      const a = i / 60 * Math.PI * 2, big = i % 5 === 0, r0 = big ? R - 8.4 : R - 6.6;
      g.strokeStyle = lit([30, 26, 22]); g.lineWidth = big ? 1.1 : 0.45;
      g.beginPath(); g.moveTo(Math.sin(a) * r0, -Math.cos(a) * r0); g.lineTo(Math.sin(a) * (R - 5.4), -Math.cos(a) * (R - 5.4)); g.stroke();
    }
    g.fillStyle = lit([28, 24, 20]); g.font = `bold 6.4px "Arial Narrow", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [n, a] of [[12, 0], [3, 90], [6, 180], [9, 270]]) { const r = R - 12.5, ar = a * Math.PI / 180; g.fillText(String(n), Math.sin(ar) * r, -Math.cos(ar) * r + 0.3); }
    g.font = `3px Arial, sans-serif`; g.fillStyle = lit([120, 40, 30]); g.fillText('17 КАМНЕЙ', 0, 7);
    // стрелки: настоящее время
    const now = new Date(), sec = now.getSeconds(), min = now.getMinutes() + sec / 60, hr = (now.getHours() % 12) + min / 60;
    const hand = (ang, len, wdt, col, tail = 3) => { g.save(); g.rotate(ang); g.fillStyle = col; g.beginPath(); g.moveTo(-wdt / 2, tail); g.lineTo(-wdt * 0.32, -len); g.lineTo(0, -len - 1.6); g.lineTo(wdt * 0.32, -len); g.lineTo(wdt / 2, tail); g.closePath(); g.fill(); g.restore(); };
    g.save(); g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 1.5 * k; g.shadowOffsetX = -L.dir * 1 * k; g.shadowOffsetY = 0.8 * k;
    hand(-0.6, 9, 1.4, lit([200, 160, 60]), 2);                                   // стрелка будильника — на 6:55
    hand(hr / 12 * Math.PI * 2, 10.5, 2.4, lit([22, 20, 18]));
    hand(min / 60 * Math.PI * 2, 15.5, 1.8, lit([22, 20, 18]));
    g.save(); g.rotate(sec / 60 * Math.PI * 2); g.strokeStyle = lit([200, 30, 24], 1.1); g.lineWidth = 0.5; g.beginPath(); g.moveTo(0, 4); g.lineTo(0, -17.5); g.stroke(); g.restore();
    g.restore();
    g.fillStyle = lit([60, 55, 50]); g.beginPath(); g.arc(0, 0, 1.3, 0, Math.PI * 2); g.fill();
    // стекло: блик
    g.save(); g.beginPath(); g.arc(0, 0, R - 4.2, 0, Math.PI * 2); g.clip();
    const gl = g.createLinearGradient(-R, -R, R * 0.2, R * 0.4); gl.addColorStop(0, `rgba(255,255,255,${0.32 * lum + 0.05})`); gl.addColorStop(0.45, 'rgba(255,255,255,0)');
    g.fillStyle = gl; g.fillRect(-R, -R, 2 * R, 2 * R); g.restore();
    g.strokeStyle = `rgba(255,250,240,${0.25 + 0.5 * lum})`; g.lineWidth = 0.8; g.beginPath(); g.arc(0, 0, R - 0.6, Math.PI * (L.dir < 0 ? 1.05 : 1.6), Math.PI * (L.dir < 0 ? 1.5 : 1.95)); g.stroke();
  },
  tick() {
    if (!Sound.started || this.ringing || document.hidden) return;
    const t = Sound.ctx.currentTime + 0.01, n = state.mode === 'night' ? 1 : state.mode === 'evening' ? 0.7 : 0.45;
    Sound.burst(t, { dur: 0.008, vol: 0.05 * n, type: 'bandpass', f: (this._sec & 1) ? 3600 : 4300, q: 6, dest: Sound.sfx, pan: 0.3 });
  },
  ring() {
    if (this.ringing) return;
    this.ringing = true; Sound.start();
    const dur = 2.6, t0 = nowMs();
    if (Sound.started) {
      const t = Sound.ctx.currentTime + 0.02, pan = 0.3;
      for (let i = 0; i < dur * 22; i++) {                  // молоточек бьёт по двум чашкам ~22 раза в секунду
        const tt = t + i / 22, a = i % 2 ? 2620 : 3180, v = 0.05 * (1 - smooth(dur - 0.4, dur, i / 22));
        Sound.tone(tt, { f: a, dur: 0.12, vol: v, dest: Sound.sfx, pan });
        Sound.tone(tt, { f: a * 2.76, dur: 0.05, vol: v * 0.35, dest: Sound.sfx, pan });
        Sound.burst(tt, { dur: 0.004, vol: v * 0.8, f: 5200, q: 2, dest: Sound.sfx, pan });
      }
    }
    const step = () => {
      const k = (nowMs() - t0) / 1000;
      this.shake = k < dur ? 1 - smooth(dur - 0.5, dur, k) : 0;
      this.drawClock();
      if (k < dur) requestAnimationFrame(step); else { this.ringing = false; this.shake = 0; this.drawClock(); }
    };
    requestAnimationFrame(step);
  },
  clockLabel() { const n = new Date(); return `Будильник. Сейчас ${n.getHours()}:${String(n.getMinutes()).padStart(2, '0')} — щёлкните, чтобы проверить звонок`; },

  /* ---------- отрывной календарь ---------- */
  drawCal(target, date) {
    const o = this.cal; if (!o) return;
    const g = target || o.g, k = o.k, L = this.L(), lit = (c, s) => this.lit(c, s);
    const W = o.box[2], H = o.box[3];
    if (!target) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, o.cv.width, o.cv.height); }
    g.setTransform(k, 0, 0, k, 0, 0);
    const d = date || this.day, sunday = d.getDay() === 0, red = sunday || (d.getMonth() === 0 && d.getDate() <= 2);
    const bx = 6, by = 8, bw = W - 12, bh = H - 14;
    if (!target) {
      // тень на стенку
      g.save(); g.shadowColor = 'rgba(8,4,2,.5)'; g.shadowBlur = 5 * k; g.shadowOffsetX = -L.dir * 3 * k; g.shadowOffsetY = 2 * k;
      g.fillStyle = '#000'; g.fillRect(bx, by, bw, bh); g.restore();
      // картонная основа — бордовая, с золотым тиснением
      g.fillStyle = lit([120, 30, 34]); g.fillRect(bx, by, bw, bh);
      g.strokeStyle = lit([210, 168, 80]); g.lineWidth = 0.6; g.strokeRect(bx + 2, by + 2, bw - 4, 13);
      g.fillStyle = lit([226, 186, 96]); g.font = `bold 4.6px "Arial Narrow", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('1995', bx + bw / 2, by + 8.8);
      // гвоздик и дырочка
      g.fillStyle = lit([40, 30, 26]); g.beginPath(); g.arc(W / 2, 4.5, 1.6, 0, Math.PI * 2); g.fill();
      g.fillStyle = lit([200, 200, 205], 1.2); g.beginPath(); g.arc(W / 2 - 0.4, 4.1, 0.7, 0, Math.PI * 2); g.fill();
      g.strokeStyle = lit([30, 22, 18]); g.lineWidth = 0.5; g.beginPath(); g.moveTo(W / 2, 5); g.lineTo(bx + bw / 2 - 6, by + 0.5); g.moveTo(W / 2, 5); g.lineTo(bx + bw / 2 + 6, by + 0.5); g.stroke();
      // торцы стопки листков
      for (let i = 0; i < 5; i++) { g.fillStyle = lit(i % 2 ? [205, 200, 186] : [232, 228, 214]); g.fillRect(bx + 4, by + bh - 3.6 + i * 0.7, bw - 8, 0.7); }
    }
    // верхний листок
    const px = bx + 4, py = by + 18, pw = bw - 8, ph = bh - 22;
    const paper = g.createLinearGradient(px, py, px + pw, py + ph);
    paper.addColorStop(0, lit([248, 244, 232], 1.05)); paper.addColorStop(1, lit([226, 220, 204]));
    g.fillStyle = paper; g.fillRect(px, py, pw, ph);
    g.strokeStyle = lit([180, 172, 156]); g.lineWidth = 0.3; g.strokeRect(px, py, pw, ph);
    const ink = red ? lit([196, 30, 30], 1.1) : lit([26, 24, 22]);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = lit([196, 30, 30], 1.1); g.font = `bold 4.2px "Arial Narrow", Arial, sans-serif`;
    g.fillText(MONTHS[d.getMonth()], px + pw / 2, py + 4.2);
    g.fillStyle = ink; g.font = `bold 19px "Arial Narrow", "Times New Roman", serif`;
    g.fillText(String(d.getDate()), px + pw / 2, py + ph / 2 + 0.5);
    g.font = `bold 3.6px "Arial Narrow", Arial, sans-serif`;
    g.fillText(WEEKDAYS[d.getDay()], px + pw / 2, py + ph - 7.4);
    const st = sunTimes(d);
    g.fillStyle = lit([90, 84, 76]); g.font = `2.6px Arial, sans-serif`;
    g.fillText(`восх. ${st.rise}  зах. ${st.set}`, px + pw / 2, py + ph - 3);
  },
  today() { const now = new Date(); return new Date(1995, now.getMonth(), now.getDate()); },
  calLabel() {
    const d = this.day || (this.day = this.today()), st = sunTimes(d);
    return `Отрывной календарь: ${d.getDate()} ${MONTHS_GEN[d.getMonth()]} 1995, ${WEEKDAYS[d.getDay()].toLowerCase()}. Восход ${st.rise}, заход ${st.set}. Щёлкните — оторвать листок`;
  },
  tear() {
    if (this.tearing) return;
    this.tearing = true; Sound.start();
    const o = this.cal, k = o.k;
    // листок — отдельный холст, который отрывается и падает
    const sheet = document.createElement('canvas'); sheet.width = o.cv.width; sheet.height = o.cv.height; sheet.className = 'cal-sheet';
    this.drawCal(sheet.getContext('2d'), this.day);
    o.el.appendChild(sheet);
    if (Sound.started) {                                     // шорох и треск рвущейся бумаги
      const t = Sound.ctx.currentTime + 0.01;
      for (let i = 0; i < 9; i++) Sound.burst(t + i * 0.018 + Math.random() * 0.01, { dur: 0.02, vol: 0.05 + Math.random() * 0.05, type: 'bandpass', f: 2500 + Math.random() * 3000, q: 1.2, dest: Sound.sfx, pan: 0.15 });
      Sound.burst(t + 0.2, { dur: 0.35, vol: 0.03, type: 'highpass', f: 3000, dest: Sound.sfx, pan: 0.1 });
    }
    this.day = new Date(this.day.getFullYear(), this.day.getMonth(), this.day.getDate() + 1);
    this.drawCal();
    const dir = Math.random() < 0.5 ? -1 : 1;
    wa(sheet, [
      { transform: 'translate(0,0) rotate(0deg)', opacity: 1, offset: 0 },
      { transform: `translate(${dir * 6}%, -6%) rotate(${dir * 8}deg)`, opacity: 1, offset: 0.18 },
      { transform: `translate(${dir * 40}%, 160%) rotate(${dir * 70}deg)`, opacity: 0.9, offset: 0.8 },
      { transform: `translate(${dir * 55}%, 240%) rotate(${dir * 95}deg)`, opacity: 0, offset: 1 },
    ], { duration: 1500, easing: 'cubic-bezier(.3,.1,.6,1)' }).then(() => { sheet.remove(); this.tearing = false; });
    Zones.refreshLabels();
    const z = Zones.els.calendar; if (z) Zones.showCaption(z, 3200);
  },
};

/* ==========================================================================
   7e. ВИДЕОМАГНИТОФОН
   Стоит на полу под телевизором. Корпус дорисовывается прямо в картинки сцен
   (до загрузки в WebGL), поэтому его освещает тот же расчёт, что и комнату:
   на закате по нему ползут те же пятна, ночью — фонарь. Сверху — только то,
   что светится само: табло и кассета, которая въезжает в щель.
   ========================================================================== */
const VCR = {
  loaded: false,
  /* 3D-коробка (метры, камера в начале координат): x0..x1, высота h1, перед z0, зад z1 */
  box() { const B = CFG.vcr; return { x0: B.x - B.w / 2, x1: B.x + B.w / 2, h1: B.h, z0: -B.z, z1: -(B.z + B.d) }; },
  proj(x, h, z) { const R = CFG.room; return [R.cx + R.f * x / -z, R.cy - R.f * (h - R.camH) / -z]; },
  rects() {
    const b = this.box();
    const fl = this.proj(b.x0, b.h1, b.z0), fr = this.proj(b.x1, 0, b.z0);
    const tl = this.proj(b.x0, b.h1, b.z1), tr = this.proj(b.x1, b.h1, b.z1);
    return { front: [fl[0], fl[1], fr[0] - fl[0], fr[1] - fl[1]], top: [fl, [fr[0], fl[1]], tr, tl] };
  },
  /* корпус в «альбедо» (без света): передняя панель и крышка */
  paint(g, E) {
    const { front: [x, y, w, h], top } = this.rects();
    const c = (rgb, k = 1) => `rgb(${rgb.map((v, i) => clamp(Math.round(255 * Math.pow(Math.pow(v / 255, 2.2) * E[i] * k, 1 / 2.2)), 0, 255)).join(',')})`;
    // тень на пол вокруг (контактная)
    g.save();
    const sh = g.createRadialGradient(x + w / 2, y + h, 2, x + w / 2, y + h, w * 0.62);
    sh.addColorStop(0, 'rgba(0,0,0,.55)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sh; g.translate(0, y + h); g.scale(1, 0.16); g.fillRect(x - 30, -60, w + 60, 120); g.restore();
    // крышка
    g.fillStyle = c([62, 62, 66], 1.15);
    g.beginPath(); g.moveTo(...top[0]); g.lineTo(...top[1]); g.lineTo(...top[2]); g.lineTo(...top[3]); g.closePath(); g.fill();
    g.strokeStyle = c([40, 40, 44]); g.lineWidth = 0.6;
    for (let i = 0; i < 9; i++) {                     // решётка вентиляции у заднего края
      const t = 0.18 + i * 0.075, a = lerp2(top[3], top[0], 0.15), b = lerp2(top[2], top[1], 0.15);
      const p0 = lerp2(top[3], top[2], t), p1 = lerp2(a, b, t);
      g.beginPath(); g.moveTo(...p0); g.lineTo(...p1); g.stroke();
    }
    // передняя панель
    const gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, c([88, 88, 94])); gr.addColorStop(0.12, c([58, 58, 63])); gr.addColorStop(1, c([36, 36, 40]));
    g.fillStyle = gr; g.fillRect(x, y, w, h);
    g.fillStyle = c([170, 170, 178], 1.1); g.fillRect(x, y + h * 0.1, w, 0.8);          // хромированная линия
    // кассетоприёмник
    const sx = x + w * 0.06, sy = y + h * 0.24, sw = w * 0.44, shh = h * 0.34;
    g.fillStyle = c([14, 14, 16]); g.fillRect(sx, sy, sw, shh);
    g.fillStyle = c([150, 150, 158]); g.fillRect(sx, sy, sw, 0.7);
    g.fillStyle = c([26, 26, 30]); g.fillRect(sx + 1, sy + shh * 0.45, sw - 2, 0.6);
    // надписи
    g.fillStyle = c([226, 226, 230], 1.1); g.font = `bold ${h * 0.2}px "Arial Narrow", Arial, sans-serif`; g.textBaseline = 'middle';
    g.fillText('ЛУЧ', sx, y + h * 0.79);
    g.fillStyle = c([150, 150, 160]); g.font = `${h * 0.11}px Arial, sans-serif`;
    g.fillText('VIDEO  HQ  4 HEAD', sx + w * 0.11, y + h * 0.8);
    // окно табло (само светится — рисуется поверх отдельно)
    const dx = x + w * 0.56, dy = y + h * 0.2, dw = w * 0.36, dh = h * 0.32;
    g.fillStyle = c([10, 14, 14]); g.fillRect(dx, dy, dw, dh);
    g.fillStyle = c([120, 120, 128]); g.fillRect(dx, dy + dh, dw, 0.5);
    // кнопки
    const labels = ['◀◀', '▶', '■', '▶▶', '⏏'];
    for (let i = 0; i < 5; i++) {
      const bx = dx + i * dw / 5 + 0.8, bw = dw / 5 - 1.6, by = y + h * 0.64, bh = h * 0.16;
      g.fillStyle = c([176, 176, 184], 1.05); g.fillRect(bx, by, bw, bh);
      g.fillStyle = c([90, 90, 98]); g.fillRect(bx, by + bh - 0.6, bw, 0.6);
      g.fillStyle = c([40, 40, 44]); g.font = `${bh * 0.8}px Arial, sans-serif`; g.textAlign = 'center';
      g.fillText(labels[i], bx + bw / 2, by + bh * 0.55); g.textAlign = 'left';
    }
    // кнопка питания
    g.fillStyle = c([180, 180, 186]); g.fillRect(x + w * 0.52, y + h * 0.26, w * 0.025, h * 0.14);
    // ножки
    g.fillStyle = c([20, 20, 22]); g.fillRect(x + w * 0.05, y + h - 1.2, w * 0.1, 1.2); g.fillRect(x + w * 0.85, y + h - 1.2, w * 0.1, 1.2);
  },
  /* Дорисовать видик и пачку драже в картинку сцены. Для дня — с учётом «старого солнца»:
     там, где на фото лежало пятно, предмет тоже в пятне (×(1+Lold)); потом расчёт это пятно снимет. */
  compose(img, unit, sunImg, plate) {
    const scene = { uDay: 'day', uEve: 'evening', uOver: 'overcast', uStorm: 'storm' }[unit];
    const E = CFG.vcr.light[scene] || [0.4, 0.4, 0.4];
    const cv = document.createElement('canvas'); cv.width = img.naturalWidth || IMG_W; cv.height = img.naturalHeight || IMG_H;
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0, cv.width, cv.height);
    g.save(); g.scale(cv.width / IMG_W, cv.height / IMG_H);
    if (plate && plate.complete && plate.naturalWidth) g.drawImage(plate, 936, 414, 71, 104);   // старой пачки больше нет
    const layer = document.createElement('canvas'); layer.width = IMG_W; layer.height = IMG_H;
    const lg = layer.getContext('2d', { willReadFrequently: true });
    this.paint(lg, E);
    lg.save(); lg.translate(936, 414); lg.globalAlpha = 0.9; Pack.draw(lg, 1, Pack.LIGHT[scene] || Pack.LIGHT.day, scene === 'evening' ? -1 : 0.6); lg.restore();   // за стеклом витрины — отражения чуть проступают
    if (unit === 'uDay' && sunImg) {
      const sm = document.createElement('canvas'); sm.width = IMG_W; sm.height = IMG_H;
      const sg = sm.getContext('2d', { willReadFrequently: true }); sg.drawImage(sunImg, 0, 0, IMG_W, IMG_H);
      const { front: [x, y, w, h] } = this.rects();
      for (const [sx, sy, sw, shh] of [[Math.floor(x - 40), Math.floor(y - 30), Math.ceil(w + 80), Math.ceil(h + 50)], [930, 408, 84, 116]]) {
        try {
          const L = sg.getImageData(sx, sy, sw, shh).data, P = lg.getImageData(sx, sy, sw, shh);
          for (let i = 0; i < P.data.length; i += 4) {
            if (!P.data[i + 3]) continue;
            const v = L[i] / 255, k = Math.pow(1 + 12 * v * v, 1 / 2.2);
            P.data[i] = Math.min(255, P.data[i] * k); P.data[i + 1] = Math.min(255, P.data[i + 1] * k); P.data[i + 2] = Math.min(255, P.data[i + 2] * k);
          }
          lg.putImageData(P, sx, sy);
        } catch (_) {}
      }
    }
    g.drawImage(layer, 0, 0);
    g.restore();
    return cv;
  },
  /* ---------- живые части: табло и кассета ---------- */
  init() {
    if (!CFG.vcr) return;
    const { front: [x, y, w, h] } = this.rects();
    this.r = { x, y, w, h };
    const el = this.el = document.createElement('div'); el.className = 'vcr-live';
    const pad = 4;
    Object.assign(el.style, { left: (x - pad) / IMG_W * 100 + '%', top: (y - 30) / IMG_H * 100 + '%', width: (w + 2 * pad) / IMG_W * 100 + '%', height: (h + 30 + pad) / IMG_H * 100 + '%' });
    el.innerHTML = '<canvas></canvas>';
    stageEl.insertBefore(el, $('#glow'));
    this.cv = el.querySelector('canvas'); this.g = this.cv.getContext('2d');
    this.geo = { x: x - pad, y: y - 30, w: w + 2 * pad, h: h + 30 + pad };
    this.resize(); addEventListener('resize', () => this.resize());
    this.mode = 'clock'; this.counter = 0; this.p = 0; this.cas = 0;
  },
  resize() {
    if (!this.cv) return;
    const k = Math.min(4, state.stage.u * (devicePixelRatio || 1) * (Camera.seated ? state.zoom || 1 : 1));
    const W = Math.round(this.geo.w * k), H = Math.round(this.geo.h * k);
    if (this.cv.width !== W || this.cv.height !== H) { this.cv.width = W; this.cv.height = H; }
    this.k = k; this.draw();
  },
  update(t) {
    if (!this.cv) return;
    const s = Math.floor(t / 500);
    if (s !== this._s || this.anim) { this._s = s; this.draw(t); }
  },
  draw(t = nowMs()) {
    const g = this.g, k = this.k, { x, y, w, h } = this.r; if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, this.cv.width, this.cv.height);
    g.setTransform(k, 0, 0, k, -this.geo.x * k, -this.geo.y * k);
    // табло: зелёно-голубые люминесцентные цифры
    const dx = x + w * 0.56, dy = y + h * 0.2, dw = w * 0.36, dh = h * 0.32;
    const n = new Date(); let txt;
    if (this.mode === 'load') txt = 'LOAD';
    else if (this.mode === 'eject') txt = 'EJECT';
    else if (this.mode === 'play') { const c = Math.floor(this.counter + (t - this.t0) / 1000); txt = `▶ ${Math.floor(c / 3600)}:${String(Math.floor(c / 60) % 60).padStart(2, '0')}:${String(c % 60).padStart(2, '0')}`; }
    else txt = (n.getSeconds() % 2 ? `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}` : `${String(n.getHours()).padStart(2, '0')} ${String(n.getMinutes()).padStart(2, '0')}`);
    const dim = state.mode === 'night' || state.mode === 'evening' ? 1 : 0.8;
    g.save(); g.beginPath(); g.rect(dx, dy, dw, dh); g.clip();
    g.font = `bold ${dh * 0.72}px "Press Start 2P", monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = `rgba(90,255,230,${0.9 * dim})`; g.shadowBlur = 3 * k;
    g.fillStyle = `rgba(150,255,235,${0.92 * dim})`; g.fillText(txt, dx + dw / 2, dy + dh / 2 + 0.3);
    g.restore();
    // кассета: в щели виден её торец с наклейкой; пока не задвинута — торчит из щели к нам
    if (this.cas > 0.001) {
      const sx = x + w * 0.06, sy = y + h * 0.24, sw = w * 0.44, shh = h * 0.34, p = this.p;
      const L = Radio.light ? Radio.light.c : [0.4, 0.4, 0.4];
      const lc = (rgb, kk = 1.6) => `rgb(${rgb.map((v, i) => clamp(Math.round(v * L[i] * kk), 0, 255)).join(',')})`;
      g.save(); g.globalAlpha = this.cas;
      const ex = p * 7, cx0 = sx + sw * 0.05, cw = sw * 0.9;
      g.fillStyle = lc([30, 30, 33]); g.fillRect(cx0 - ex * 0.15, sy + shh * 0.12, cw + ex * 0.3, shh * 0.76 + ex);          // корпус кассеты
      g.fillStyle = lc([70, 70, 76]); g.fillRect(cx0 - ex * 0.15, sy + shh * 0.12, cw + ex * 0.3, Math.max(0.6, ex * 0.35)); // верхняя грань
      g.fillStyle = lc([236, 230, 206]); g.fillRect(cx0 + cw * 0.18, sy + shh * 0.3 + ex * 0.4, cw * 0.64, shh * 0.34);    // наклейка
      g.fillStyle = lc([60, 50, 160]); g.font = `${shh * 0.26}px "Neucha", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('ЭФИР-95', cx0 + cw / 2, sy + shh * 0.47 + ex * 0.4);
      g.restore();
    }
  },
  label() { return this.loaded ? 'Видеомагнитофон: идёт кассета. Щёлкните — достать' : 'Видеомагнитофон. Щёлкните — вставить кассету'; },
  async click() {
    await Sound.start();
    if (this.busy) return; this.busy = true;
    const mech = (t, f, d, v) => Sound.burst(t, { dur: d, vol: v, type: 'bandpass', f, q: 1.5, dest: Sound.sfx, pan: -0.05 });
    if (!this.loaded) {
      // вставляем: кассета торчит из щели → её затягивает, щелчок, мотор; табло LOAD → ▶
      this.mode = 'load'; this.cas = 1; this.p = 1; this.draw();
      if (Sound.started) { const t = Sound.ctx.currentTime; mech(t + 0.05, 900, 0.06, 0.3); mech(t + 0.3, 300, 0.8, 0.08); mech(t + 1.15, 1400, 0.05, 0.22); }
      await this.tween('p', 1, 0, 1000);
      await wait(700);
      this.loaded = true; this.mode = 'play'; this.cas = 0; this.t0 = nowMs(); this.counter = Math.floor(rand(60, 2400)); this.draw();   // шторка щели закрылась
      const vi = CFG.channels.findIndex(c => c.type === 'vcr');
      if (!TV.on) { TV.powerOn(); if (vi >= 0) setTimeout(() => TV.setChannel(vi), CFG.tv.powerOnMs + 200); }
      else if (vi >= 0) { if (TV.ch !== vi) TV.setChannel(vi); else { TV.activateVideo(false); TV.activateVideo(true); } }
    } else {
      this.mode = 'eject'; this.loaded = false; this.cas = 1; this.p = 0; this.draw();
      if (Sound.started) { const t = Sound.ctx.currentTime; mech(t, 300, 0.6, 0.08); mech(t + 0.7, 1100, 0.06, 0.25); }
      if (TV.channel().type === 'vcr') { TV.activateVideo(false); TV.activateVideo(true); }
      await this.tween('p', 0, 1, 800);
      await wait(1100);
      await this.tween('cas', 1, 0, 400);                    // кассету забрали
      this.mode = 'clock'; this.p = 0; this.draw();
    }
    this.busy = false;
    Zones.refreshLabels();
  },
  tween(key, a, b, ms) {
    return new Promise(res => {
      const t0 = nowMs(); this.anim = true;
      const st = () => { const k = clamp((nowMs() - t0) / ms, 0, 1), e = k * k * (3 - 2 * k); this[key] = lerp(a, b, e); this.draw(); if (k < 1) requestAnimationFrame(st); else { this.anim = false; res(); } };
      requestAnimationFrame(st);
    });
  },
};
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/* ==========================================================================
   7f. ПАЧКА ДРАЖЕ (вместо размытой упаковки на полке)
   Своя, придуманная упаковка 90-х: фольгированный пакетик с гребешками швов,
   надпись «ДРАЖЕ», рассыпь цветных конфет, звёздочка «НОВИНКА!». Рисуется кодом
   в нужном свете каждой сцены — и в картинку комнаты, и как вырезка для анимации.
   ========================================================================== */
const Pack = {
  LIGHT: {    // во сколько раз (линейно) свет на полке по сценам
    day: [0.5, 0.48, 0.44], sunset: [0.5, 0.35, 0.25], evening: [0.4, 0.29, 0.19], overcast: [0.2, 0.22, 0.24],
    storm: [0.16, 0.175, 0.2], night: [0.012, 0.014, 0.022],
  },
  urls: {},
  /* рисуем в коробке вырезки 71×104 (пиксели картинки), k — масштаб */
  draw(g, k, E, glossDir = 0.6) {
    const c = (rgb, m = 1) => `rgb(${rgb.map((v, i) => clamp(Math.round(255 * Math.pow(Math.pow(v / 255, 2.2) * E[i] * m, 1 / 2.2)), 0, 255)).join(',')})`;
    g.save(); g.scale(k, k);
    const x = 13, y = 13, w = 46, h = 79;
    // форма: пухлый пакет — бока чуть выгнуты, сверху и снизу зубчатые швы
    const body = () => {
      g.beginPath();
      g.moveTo(x + 1, y + 6);
      g.quadraticCurveTo(x - 1.5, y + h / 2, x + 1, y + h - 6);
      g.lineTo(x + w - 1, y + h - 6);
      g.quadraticCurveTo(x + w + 1.5, y + h / 2, x + w - 1, y + 6);
      g.closePath();
    };
    // тень на стенку витрины
    g.save(); g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 4 * k; g.shadowOffsetX = -2 * k; g.shadowOffsetY = 1 * k;
    g.fillStyle = '#000'; body(); g.fill(); g.restore();
    // фон — фиолетово-синий градиент
    g.save(); body(); g.clip();
    const bg = g.createLinearGradient(x, y, x + w * 0.4, y + h);
    bg.addColorStop(0, c([120, 40, 150])); bg.addColorStop(0.55, c([40, 50, 170])); bg.addColorStop(1, c([20, 30, 110]));
    g.fillStyle = bg; g.fillRect(x - 3, y, w + 6, h);
    // лучи-«взрыв» за надписью
    g.globalAlpha = 0.18; g.fillStyle = c([255, 230, 120]);
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.beginPath(); g.moveTo(x + w / 2, y + 30); g.lineTo(x + w / 2 + Math.cos(a) * 40, y + 30 + Math.sin(a) * 40); g.lineTo(x + w / 2 + Math.cos(a + 0.18) * 40, y + 30 + Math.sin(a + 0.18) * 40); g.closePath(); g.fill(); }
    g.globalAlpha = 1;
    // надпись
    g.save(); g.translate(x + w / 2, y + 25); g.rotate(-0.12);
    g.font = `900 12.5px "Arial Black", "Arial", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = 3.2; g.strokeStyle = c([150, 20, 30]); g.strokeText('ДРАЖЕ', 0, 0);
    const tg = g.createLinearGradient(0, -6, 0, 6); tg.addColorStop(0, c([255, 245, 140], 1.1)); tg.addColorStop(1, c([255, 170, 30]));
    g.fillStyle = tg; g.fillText('ДРАЖЕ', 0, 0);
    g.font = `bold 4.6px "Arial Narrow", Arial, sans-serif`; g.fillStyle = c([255, 255, 255]); g.fillText('фруктовое ассорти', 0, 9);
    g.restore();
    // рассыпь драже: блестящие «линзочки»
    const cols = [[230, 40, 40], [250, 200, 30], [60, 170, 60], [240, 120, 20], [150, 60, 200], [240, 240, 240]];
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 16; i++) {
      const cx = x + 6 + rnd() * (w - 12), cy = y + 44 + rnd() * 26, r = 3 + rnd() * 1.6, a = rnd() * Math.PI;
      g.save(); g.translate(cx, cy); g.rotate(a);
      g.fillStyle = c(cols[i % cols.length]); g.beginPath(); g.ellipse(0, 0, r, r * 0.72, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = c([255, 255, 255], 1.2); g.globalAlpha = 0.7; g.beginPath(); g.ellipse(-r * 0.3, -r * 0.25, r * 0.35, r * 0.18, -0.4, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    // долька апельсина и вишенка
    g.fillStyle = c([250, 150, 30]); g.beginPath(); g.arc(x + w - 9, y + 66, 6, Math.PI, 0); g.fill();
    g.strokeStyle = c([255, 230, 170]); g.lineWidth = 0.6; for (let i = 1; i < 6; i++) { const a = Math.PI + i * Math.PI / 6; g.beginPath(); g.moveTo(x + w - 9, y + 66); g.lineTo(x + w - 9 + Math.cos(a) * 5.2, y + 66 + Math.sin(a) * 5.2); g.stroke(); }
    g.fillStyle = c([190, 20, 40]); g.beginPath(); g.arc(x + 9, y + 72, 3.2, 0, Math.PI * 2); g.arc(x + 14, y + 73.5, 3, 0, Math.PI * 2); g.fill();
    g.strokeStyle = c([60, 120, 40]); g.lineWidth = 0.7; g.beginPath(); g.moveTo(x + 9, y + 69); g.quadraticCurveTo(x + 12, y + 63, x + 15, y + 65); g.moveTo(x + 14, y + 70.5); g.lineTo(x + 15, y + 65); g.stroke();
    // звёздочка «НОВИНКА!»
    g.save(); g.translate(x + w - 9, y + 11); g.rotate(0.3);
    g.fillStyle = c([240, 30, 40]); g.beginPath();
    for (let i = 0; i < 16; i++) { const r = i % 2 ? 4.2 : 7, a = i / 16 * Math.PI * 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill();
    g.fillStyle = c([255, 255, 255]); g.font = `bold 2.6px Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('НОВИНКА!', 0, 0.2);
    g.restore();
    g.fillStyle = c([230, 230, 240]); g.font = `bold 3.4px Arial, sans-serif`; g.textAlign = 'left'; g.fillText('40 г', x + 4, y + h - 9.5);
    // фольга: блики и складки
    const gl = g.createLinearGradient(x, 0, x + w, 0);
    const a0 = glossDir > 0 ? 0.62 : 0.2;
    gl.addColorStop(0, 'rgba(255,255,255,0)'); gl.addColorStop(a0 - 0.1, 'rgba(255,255,255,0)'); gl.addColorStop(a0, `rgba(255,255,255,${0.32 * Math.min(1, E[1] * 2)})`); gl.addColorStop(a0 + 0.08, 'rgba(255,255,255,0)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gl; g.fillRect(x - 3, y, w + 6, h);
    const sh = g.createLinearGradient(x, 0, x + w, 0); sh.addColorStop(0, 'rgba(0,0,0,.35)'); sh.addColorStop(0.15, 'rgba(0,0,0,0)'); sh.addColorStop(0.85, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.4)');
    g.fillStyle = sh; g.fillRect(x - 3, y, w + 6, h);
    g.restore();
    // зубчатые швы сверху и снизу (серебристая фольга)
    for (const [sy, dir] of [[y, 1], [y + h - 7, -1]]) {
      g.fillStyle = c([200, 200, 210], 0.95);
      g.beginPath(); g.moveTo(x + 0.5, sy + (dir > 0 ? 7 : 0));
      for (let i = 0; i <= 18; i++) g.lineTo(x + 0.5 + i * (w - 1) / 18, sy + (dir > 0 ? (i % 2 ? 0 : 1.6) : (i % 2 ? 7 : 5.4)));
      g.lineTo(x + w - 0.5, sy + (dir > 0 ? 7 : 0)); g.closePath(); g.fill();
      g.strokeStyle = c([150, 150, 160]); g.lineWidth = 0.3;
      for (let i = 1; i < 18; i++) { const xx = x + 0.5 + i * (w - 1) / 18; g.beginPath(); g.moveTo(xx, sy + 1.6); g.lineTo(xx, sy + 5.4); g.stroke(); }
    }
    g.restore();
  },
  /* вырезка для анимации (×3 для чёткости) */
  spriteURL(scene) {
    if (this.urls[scene]) return this.urls[scene];
    const k = 3, cv = document.createElement('canvas'); cv.width = 71 * k; cv.height = 104 * k;
    this.draw(cv.getContext('2d'), k, this.LIGHT[scene] || this.LIGHT.day, scene === 'evening' ? -1 : 0.6);
    return (this.urls[scene] = cv.toDataURL('image/png'));
  },
  /* в картинку сцены: сначала «чистая подложка» поверх старой пачки, потом новая пачка */
  compose(g, plate, scene, sunK) {
    const [bx, by] = [936, 414];
    if (plate && plate.complete && plate.naturalWidth) g.drawImage(plate, bx, by, 71, 104);
    g.save(); g.translate(bx, by);
    const E = (this.LIGHT[scene] || this.LIGHT.day).map(v => v * (sunK || 1));
    this.draw(g, 1, E, scene === 'evening' ? -1 : 0.6);
    g.restore();
  },
};

/* ---------- микро-эффекты ---------- */
const FX = {
  wrap: $('#fx'),
  px(z) { const s = state.stage; return { x: z.x / 100 * s.w, y: z.y / 100 * s.h, w: z.w / 100 * s.w, h: z.h / 100 * s.h, u: s.u }; },
  add(cls, x, y, html = '') { const el = document.createElement('div'); el.className = cls; el.style.left = x + 'px'; el.style.top = y + 'px'; el.innerHTML = html; this.wrap.appendChild(el); return el; },
  run(el, frames, opts) { const a = el.animate(frames, opts); a.onfinish = () => el.remove(); return a; },
  /* драже подпрыгивают над пачкой и падают обратно */
  candies(z) {
    const p = this.px(z), cols = ['#e63a3a', '#f5c623', '#3fae4a', '#f07a1c', '#9446d0', '#f2f2f2'];
    for (let i = 0; i < 9; i++) {
      const el = this.add('candy-fx', p.x + rand(0.3, 0.7) * p.w, p.y + p.h * 0.12);
      el.style.background = `radial-gradient(circle at 35% 30%, rgba(255,255,255,.85) 0 18%, ${cols[i % cols.length]} 22%)`;
      const dx = rand(-16, 16) * p.u, up = -rand(14, 30) * p.u, delay = rand(250, 1300), d = rand(700, 1000);
      this.run(el, [
        { transform: 'translate(0,0) scale(.6)', opacity: 0 },
        { transform: `translate(${dx * 0.5}px, ${up}px) scale(1) rotate(${rand(-90, 90)}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dx}px, ${p.h * 0.1}px) scale(.8) rotate(${rand(-180, 180)}deg)`, opacity: 0 },
      ], { duration: d, delay, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'backwards' });
    }
  },
  bubbles(z) {
    const p = this.px(z);
    for (let i = 0; i < 12; i++) {
      const el = this.add('bubble-fx', p.x + rand(0.25, 0.75) * p.w, p.y + p.h * 0.25);
      const dx = rand(-14, 14) * p.u, dy = -rand(35, 70) * p.u, sc = rand(0.6, 1.4);
      this.run(el, [{ transform: `translate(0,0) scale(${sc * 0.5})`, opacity: 0 }, { opacity: 0.95, offset: 0.2 }, { transform: `translate(${dx}px, ${dy}px) scale(${sc})`, opacity: 0 }],
        { duration: rand(1300, 2300), delay: rand(1100, 3200), easing: 'ease-out', fill: 'backwards' });
    }
  },
  notes(z) {
    const p = this.px(z);
    for (let i = 0; i < 6; i++) {
      const el = this.add('note-fx', p.x + rand(0.2, 0.8) * p.w, p.y, i % 3 ? '♪' : '♫');
      const dx = rand(-18, 18) * p.u, dy = -rand(30, 55) * p.u;
      this.run(el, [{ transform: 'translate(0,0) scale(.6)', opacity: 0 }, { opacity: 1, offset: 0.2 }, { transform: `translate(${dx}px, ${dy}px) scale(1)`, opacity: 0 }],
        { duration: 1400, delay: i * 260, easing: 'ease-out', fill: 'backwards' });
    }
  },
  sparkle(z) {
    const p = this.px(z);
    for (let i = 0; i < 14; i++) {
      const el = this.add('spark-fx', p.x + rand(-0.2, 1.2) * p.w, p.y + rand(0, 0.9) * p.h);
      this.run(el, [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.3)', opacity: 1, offset: 0.4 }, { transform: 'scale(0)', opacity: 0 }],
        { duration: rand(700, 1100), delay: rand(0, 4600), fill: 'backwards' });
    }
  },
  steam(z) {
    const p = this.px(z);
    for (let i = 0; i < 4; i++) {
      const el = this.add('steam-fx', p.x + p.w * rand(0.35, 0.6), p.y + p.h * 0.05);
      const dx = rand(-10, 10) * p.u;
      this.run(el, [{ transform: 'translate(0,0) scale(.5)', opacity: 0 }, { opacity: 0.9, offset: 0.3 }, { transform: `translate(${dx}px, ${-45 * p.u}px) scale(1.4)`, opacity: 0 }],
        { duration: 2600, delay: i * 450, easing: 'ease-out', fill: 'backwards' });
    }
  },
  pet(z) {
    if (this._pet) return;
    const p = this.px(z);
    const rows = [
      '....XX....XX....',
      '...XOOX..XOOX...',
      '...XOOOXXOOOX...',
      '..XOOOOOOOOOOX..',
      '.XOOOOOOOOOOOOX.',
      '.XOOEOOOOOOEOOX.',
      '.XOOEOOOOOOEOOX.',
      '.XOPOOOMMOOOPOX.',
      '.XOOOOOOOOOOOOX.',
      '..XOOOOOOOOOOX..',
      '...XXOOOOOOXX...',
      '....XOX..XOX....',
      '....XX....XX....',
    ];
    const col = { X: '#3a2f52', O: '#ffe0f2', E: '#3a2f52', P: '#ff8fb8', M: '#3a2f52' };
    const c = document.createElement('canvas'); c.width = 16; c.height = 13;
    const g = c.getContext('2d');
    rows.forEach((r, y) => [...r].forEach((ch, x) => { if (col[ch]) { g.fillStyle = col[ch]; g.fillRect(x, y, 1, 1); } }));
    c.className = 'pet-fx';
    const size = 30 * p.u;
    c.style.left = (p.x + p.w / 2 - size / 2) + 'px'; c.style.top = (p.y + p.h * 0.45 - size / 2) + 'px';
    this.wrap.appendChild(c); this._pet = c;
    const up = -48 * p.u;
    const a = c.animate([
      { transform: 'translateY(0) scale(.1)', opacity: 0 },
      { transform: `translateY(${up}px) scale(1.15)`, opacity: 1, offset: 0.12 },
      { transform: `translateY(${up}px) scale(1)`, offset: 0.2 },
      { transform: `translateY(${up - 10 * p.u}px)`, offset: 0.32 },
      { transform: `translateY(${up}px)`, offset: 0.42 },
      { transform: `translateY(${up - 10 * p.u}px)`, offset: 0.54 },
      { transform: `translateY(${up}px)`, offset: 0.64 },
      { transform: `translateY(${up}px)`, opacity: 1, offset: 0.85 },
      { transform: `translateY(${up - 6 * p.u}px) scale(.8)`, opacity: 0 },
    ], { duration: 3800, easing: 'ease-out' });
    a.onfinish = () => { c.remove(); this._pet = null; };
    const h = this.add('heart-fx', p.x + p.w * 0.75, p.y - 30 * p.u, '♥');
    h.style.color = '#ff7ab0';
    this.run(h, [{ transform: 'translateY(0) scale(.4)', opacity: 0 }, { transform: `translateY(${-14 * p.u}px) scale(1)`, opacity: 1, offset: 0.4 }, { transform: `translateY(${-28 * p.u}px)`, opacity: 0 }],
      { duration: 1400, delay: 900, fill: 'backwards' });
  },
};

/* ==========================================================================
   8. ИНТЕРФЕЙС: звук, подсказки
   ========================================================================== */
const UI = {
  init() {
    const intro = $('#intro'); intro.textContent = T.intro;
    setTimeout(() => intro.classList.add('show'), 700);
    $('#powerHint .bubble').textContent = T.powerHint;
    const tv = $('#mxTv'), room = $('#mxRoom'), radio = $('#mxRadio');
    tv.value = state.tvVolume; room.value = state.ambience;
    if (radio) { radio.value = state.radioVolume; radio.addEventListener('input', () => { Sound.start(); Radio.setVolume(+radio.value); }); }
    const ph = $('#phonesBtn');
    if (ph) {
      const sync = () => { ph.setAttribute('aria-pressed', String(state.headphones)); ph.classList.toggle('on', state.headphones); ph.title = state.headphones ? T.phonesOn : T.phonesOff; };
      sync();
      ph.addEventListener('click', async () => {
        await Sound.start(); Sound.setHeadphones(!state.headphones); sync();
        try { localStorage.setItem('tubetv.phones', state.headphones ? '1' : '0'); } catch (_) {}
        this.toast(state.headphones ? T.phonesOn : T.phonesOff, 2200);
      });
    }
    tv.addEventListener('input', () => { Sound.start(); Sound.setTvVolume(+tv.value); TV.osdVolUntil = nowMs() + 1200; });
    room.addEventListener('input', () => { Sound.start(); Sound.setAmbience(+room.value); try { localStorage.setItem('tubetv.room', room.value); } catch (_) {} });
    const mute = $('#muteBtn');
    mute.addEventListener('click', async () => { await Sound.start(); this.setMuted(!state.muted); });
    $('#seatBtn').addEventListener('click', () => { Sound.start(); Camera.toggle(); });
    this.seatLabel();
    $('#ver').textContent = 'v' + (CFG.version || '');
  },
  seatLabel() {
    const b = $('#seatBtn'), on = Camera.seated;
    b.querySelector('.long').textContent = on ? T.stand : T.seat;
    b.querySelector('.short').textContent = on ? T.stand : 'Сесть';
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? T.stand : T.seat);
  },
  setMuted(m) {
    Sound.setMuted(m);
    const b = $('#muteBtn');
    b.setAttribute('aria-pressed', String(m));
    b.setAttribute('aria-label', m ? 'Включить звук' : 'Выключить звук');
  },
  onTvOn() {
    $('#powerHint').classList.add('off');
    $('#intro').classList.remove('show');
    if (!state.firstOnDone) {
      state.firstOnDone = true;
      setTimeout(() => this.toast(T.afterOn, 7000), CFG.tv.powerOnMs + 400);
    }
  },
  toast(text, ms) {
    const t = $('#toast'); t.textContent = text; t.classList.add('show');
    clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('show'), ms);
  },
};

/* ==========================================================================
   9. КАЛИБРОВКА (клавиша D)
   ========================================================================== */
const LAYER_ZONES = new Set(['screen', 'tvBody', 'window', 'siren', 'dust', 'glow']);
const Calib = {
  el: $('#calib'), panel: $('#calibPanel'), boxes: {}, sel: null,
  toggle(on = !state.calibrating) {
    state.calibrating = on;
    document.body.classList.toggle('calibrating', on);
    this.el.hidden = !on; this.panel.hidden = !on;
    if (on) { this.build(); this._iv = setInterval(() => this.tick(), 1000); this.tick(); }
    else { clearInterval(this._iv); this.el.innerHTML = ''; this.boxes = {}; }
  },
  build() {
    this.el.innerHTML = '';
    for (const k of Object.keys(CFG.zones)) {
      const b = document.createElement('div');
      b.className = 'cz' + (LAYER_ZONES.has(k) ? ' layerz' : '');
      b.innerHTML = `<span>${k}</span><i class="hdl"></i>`;
      b.dataset.k = k;
      this.el.appendChild(b); this.boxes[k] = b;
      placeEl(b, CFG.zones[k]);
      this.bindBox(b, k);
    }
    if (!this._panelBound) {
      this._panelBound = true;
      this.panel.addEventListener('click', e => {
        const btn = e.target.closest('button'); if (!btn) return;
        if (btn.dataset.act === 'copy') this.copy();
        if (btn.dataset.act === 'mode') { Sound.start(); setMode(state.mode === 'day' ? 'evening' : 'day'); }
        if (btn.dataset.act === 'tv') { Sound.start().then(() => TV.toggle()); }
        if (btn.dataset.ev) { Sound.start().then(() => { Events.started || Events.start(); Events.play(btn.dataset.ev); }); }
      });
    }
  },
  bindBox(b, k) {
    let st = null;
    b.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      this.select(k);
      st = { x: e.clientX, y: e.clientY, z: { ...CFG.zones[k] }, resize: e.target.classList.contains('hdl') };
      b.setPointerCapture(e.pointerId);
    });
    b.addEventListener('pointermove', e => {
      if (!st) return;
      const zk = state.zoom || 1;
      const dx = (e.clientX - st.x) / (state.stage.w * zk) * 100, dy = (e.clientY - st.y) / (state.stage.h * zk) * 100;
      const z = CFG.zones[k], r = v => Math.round(v * 100) / 100;
      if (st.resize) { z.w = r(Math.max(0.3, st.z.w + dx)); z.h = r(Math.max(0.3, st.z.h + dy)); }
      else { z.x = r(st.z.x + dx); z.y = r(st.z.y + dy); }
      this.changed(k);
    });
    const end = () => { if (st) { st = null; if (k === 'window') BG.rebuildSway(); if (k === 'dust') Dust.resize(); } };
    b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end);
  },
  select(k) {
    this.sel = k;
    for (const [kk, b] of Object.entries(this.boxes)) b.classList.toggle('sel', kk === k);
    this.showSel();
  },
  showSel() {
    const z = CFG.zones[this.sel]; if (!z) return;
    this.panel.querySelector('.cp-sel').textContent = `${this.sel}: x ${z.x} · y ${z.y} · w ${z.w} · h ${z.h}`;
  },
  changed(k) {
    placeEl(this.boxes[k], CFG.zones[k]);
    if (k === 'screen') TV.resize();
    else if (k === 'glow') placeEl($('#glow'), CFG.zones.glow);
    else if (k === 'siren') Light.placeSiren();
    else if (k === 'window') { Zones.apply(); Light.placeSiren(); Weather.resize(); }
    else if (k === 'dust') placeEl(Dust.el, CFG.zones.dust);
    else Zones.apply();
    this.showSel();
    clearTimeout(this._sw);
    if (k === 'window') this._sw = setTimeout(() => BG.rebuildSway(), 300);
  },
  nudge(e) {
    if (!this.sel) return false;
    const map = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!map) return false;
    const step = e.shiftKey ? 1 : 0.1, z = CFG.zones[this.sel], r = v => Math.round(v * 100) / 100;
    if (e.altKey) { z.w = r(Math.max(0.3, z.w + map[0] * step)); z.h = r(Math.max(0.3, z.h + map[1] * step)); }
    else { z.x = r(z.x + map[0] * step); z.y = r(z.y + map[1] * step); }
    this.changed(this.sel);
    if (this.sel === 'dust') Dust.resize();
    return true;
  },
  json() {
    const keys = Object.keys(CFG.zones), pad = Math.max(...keys.map(k => k.length)) + 3;
    const n = v => Number(v.toFixed(2));
    const lines = keys.map(k => { const z = CFG.zones[k];
      return `    ${(`"${k}":`).padEnd(pad + 1)} { "x": ${n(z.x)}, "y": ${n(z.y)}, "w": ${n(z.w)}, "h": ${n(z.h)} }`; });
    return `  "zones": {\n${lines.join(',\n')}\n  },`;
  },
  async copy() {
    const text = this.json(), ta = this.panel.querySelector('.cp-out');
    ta.value = text;
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; }
    catch (_) { ta.focus(); ta.select(); try { ok = document.execCommand('copy'); } catch (__) {} }
    this.log(ok ? 'конфиг скопирован — вставьте вместо блока zones в config.js' : 'скопируйте текст из поля вручную');
  },
  tick() {
    const left = Math.max(0, Math.round(Events.nextAt - nowMs() / 1000));
    const next = this.panel.querySelector('.cp-next');
    if (next) next.textContent = (Events.started ? `следующее событие через ~${left} с` : 'события начнутся после первого клика') + (this._msg ? ` · ${this._msg}` : '');
  },
  log(msg) { this._msg = msg; if (state.calibrating) this.tick(); },
  refresh() { if (state.calibrating) for (const k of Object.keys(this.boxes)) placeEl(this.boxes[k], CFG.zones[k]); },
};

/* ==========================================================================
   10. ЗАПУСК
   ========================================================================== */
function init() {
  root.style.setProperty('--xfade', CFG.crossfadeMs + 'ms');
  root.style.setProperty('--seat-ms', CFG.seat.durationMs + 'ms');
  state.scene = sceneOf(state.mode, state.weather);
  BG.init();
  try {
    GLRoom.init().then(() => { BG.enableGL(); idle(() => GLRoom.preloadAll(), 2500); })
      .catch(err => { console.warn('[Tube TV] WebGL-комната недоступна, работают картинки:', err.message); idle(() => BG.preloadAll(), 2500); });
  } catch (err) { console.warn('[Tube TV] WebGL-комната:', err.message); idle(() => BG.preloadAll(), 2500); }
  TV.init();
  Embed.init();
  Light.init();
  Dust.init();
  Weather.init();
  Zones.init();
  Puppets.init();
  Radio.init();
  Props.init();
  VCR.init();
  UI.init();
  applyScene(true);
  layout();
  addEventListener('resize', layout);
  // фокус с клавиатуры (Tab) может «прокрутить» контейнер с overflow:hidden — возвращаем на место
  for (const el of [$('#app'), stageEl]) el.addEventListener('scroll', () => { el.scrollLeft = 0; el.scrollTop = 0; });
  addEventListener('orientationchange', () => setTimeout(layout, 200));

  // Клик по экрану, когда браузер не дал видео запуститься самому
  stageEl.addEventListener('click', e => {
    if (Embed.status !== 'tap' || state.calibrating) return;
    const r = stageEl.getBoundingClientRect(), z = CFG.zones.screen;
    const x = (e.clientX - r.left) / r.width * 100, y = (e.clientY - r.top) / r.height * 100;
    if (x > z.x && x < z.x + z.w && y > z.y && y < z.y + z.h) Embed.tap();
  });

  // Двойной клик по экрану — сесть / встать
  stageEl.addEventListener('dblclick', e => {
    if (state.calibrating) return;
    const r = stageEl.getBoundingClientRect(), z = CFG.zones.screen;
    const x = (e.clientX - r.left) / r.width * 100, y = (e.clientY - r.top) / r.height * 100;
    if (x > z.x && x < z.x + z.w && y > z.y && y < z.y + z.h) Camera.toggle();
  });

  // Первый жест пользователя будит звук (ограничения автозапуска в браузерах)
  addEventListener('pointerdown', () => Sound.start(), { once: true, capture: true });

  addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('textarea, input')) return;
    if (state.calibrating && Calib.nudge(e)) { e.preventDefault(); return; }
    if (e.key === 'd' || e.key === 'D' || e.key === 'в' || e.key === 'В') Calib.toggle();
    if (e.key === 'm' || e.key === 'M' || e.key === 'ь' || e.key === 'Ь') Sound.start().then(() => UI.setMuted(!state.muted));
    if ('sSыЫ'.includes(e.key) && e.key.length === 1) { Sound.start(); Camera.toggle(); }
    if (e.key === 'Escape' && Camera.seated) Camera.toggle(false);
  });

  document.addEventListener('visibilitychange', () => {
    if (!Sound.ctx) return;
    if (document.hidden) Sound.ctx.suspend().catch(() => {});
    else Sound.ctx.resume().catch(() => {});
  });

  // Шрифты для экранной графики
  if (document.fonts && document.fonts.load) {
    Promise.all([document.fonts.load(`16px "Press Start 2P"`), document.fonts.load(`40px Lobster`)]).catch(() => {});
  }

  let last = nowMs();
  const frame = t => {
    // не чаще 60 кадров в секунду: на экранах 120 Гц (MacBook Pro, iPad) иначе вдвое больше работы
    if (t - last < 14) { requestAnimationFrame(frame); return; }
    const dt = Math.min(64, t - last); last = t;
    if (state.fxT0) {
      const k = smooth(0, 1, clamp((t - state.fxT0) / CFG.crossfadeMs, 0, 1));
      for (const key of Object.keys(state.fxTo)) if (typeof state.fxTo[key] === 'number') state.fx[key] = lerp(state.fxFrom[key] || 0, state.fxTo[key], k);
      if (k >= 1) state.fxT0 = 0;
    }
    Wind.update(t, dt);
    if (BG.gl) {
      GLRoom.render(t);
      const busy = GLRoom.busy();
      if (busy !== BG._busy && BG.hiresWrap) { BG._busy = busy; BG.hiresWrap.classList.toggle('busy', busy); }
    }
    TV.render(t);
    Light.update(t);
    Dust.update(t, dt);
    Weather.update(t, dt);
    Radio.update(t);
    Props.update(t);
    VCR.update(t);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  window.TubeTV = { GLRoom, BG, TV, Sound, Events, setMode, setWeather, Calib, Puppets, Camera, Embed, Wind, Weather, Radio, Props, VCR, state, CFG };   // для отладки из консоли
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
