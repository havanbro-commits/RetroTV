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
  ambience: CFG.audio.ambienceVolume,
  tvVolume: CFG.tv.defaultVolume,
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
    clearTimeout(this._t);
    if (animate) this._t = setTimeout(() => { stageEl.classList.remove('moving'); TV.resize(); }, CFG.seat.durationMs + 60);
    else TV.resize();
  },
  toggle(on = !this.seated) {
    if (on === this.seated) return;
    this.seated = on;
    Zones.hideCaption();
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
const sceneOf = (time, weather) => (weather !== 'clear' && time !== 'evening') ? 'overcast' : time;
const sceneFx = () => {
  const f = Object.assign({}, CFG.light.scenes[state.scene]);
  f.dim = (state.mode === 'sunset' && state.weather !== 'clear' ? 0.22 : 0) + (state.weather === 'downpour' ? 0.12 : 0);
  return f;
};

const BG = {
  layers: {}, bds: {}, z: 1, current: null,
  init() {
    const bg = $('#bg'), bd = $('.backdrop');
    for (const [scene, def] of Object.entries(CFG.backgrounds)) {
      const layer = document.createElement('div');
      layer.className = 'bg-layer is-hidden'; layer.dataset.scene = scene;
      const img = new Image();
      img.src = def.image; img.alt = ''; img.decoding = 'async'; img.draggable = false;
      layer.appendChild(img);
      if (CFG.hires && CFG.hires.images[scene]) {
        const hr = new Image(); hr.className = 'hires'; hr.alt = ''; hr.decoding = 'async';
        hr.dataset.src = CFG.hires.images[scene];
        const [x, y, w, h] = CFG.hires.box;
        Object.assign(hr.style, { left: x / IMG_W * 100 + '%', top: y / IMG_H * 100 + '%', width: w / IMG_W * 100 + '%', height: h / IMG_H * 100 + '%' });
        hr.addEventListener('load', () => hr.classList.add('loaded'));
        layer.appendChild(hr);
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
      const b = document.createElement('div'); b.className = 'bd'; b.style.backgroundImage = `url("${def.image}")`; b.style.opacity = 0;
      bd.appendChild(b); this.bds[scene] = b;
    }
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
  loadHires() {
    for (const l of Object.values(this.layers)) { const h = l.querySelector('.hires'); if (h && !h.src) h.src = h.dataset.src; }
  },

  /* Карта смещения. R — волны по горизонтали, G — подъём подола на порывах.
     Ширина карты кратна периоду, поэтому бегущая волна зацикливается без шва. */
  makeMaps(zw, zh, P) {
    const sx = 0.5, Pp = Math.round(P * sx);
    const w = Math.ceil(zw * sx / Pp) * Pp + Pp * 2, h = Math.ceil(zh * sx);
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
    const ew = Math.ceil(zw * sx);
    const c2 = document.createElement('canvas'); c2.width = ew; c2.height = h;
    const g2 = c2.getContext('2d'); const id2 = g2.createImageData(ew, h); const e = id2.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < ew; x++) {
      const xn = x / ew, yn = y / h;
      const env = smooth(0, 0.14, xn) * (1 - smooth(0.95, 1, xn)) * smooth(0.03, 0.75, yn) * (1 - smooth(0.93, 0.995, yn));
      const i = (y * ew + x) * 4, v = 255 * env;
      e[i] = v; e[i + 1] = v; e[i + 2] = v; e[i + 3] = 255;
    }
    g2.putImageData(id2, 0, 0);
    return { wave: c.toDataURL(), env: c2.toDataURL(), ww: w / sx, period: Pp / sx };
  },
  addSway(layer, scene) {
    if (REDUCED) return;
    const old = layer.querySelector('svg.sway'); if (old) old.remove();
    const z = zpx(CFG.zones.window);
    if (!this._maps || this._mapsFor !== JSON.stringify(z)) { this._maps = this.makeMaps(z.w, z.h, 120); this._mapsFor = JSON.stringify(z); }
    const m = this._maps, id = 'sway-' + scene, href = CFG.backgrounds[scene].image;
    const svg = `
<svg class="sway" viewBox="0 0 ${IMG_W} ${IMG_H}" preserveAspectRatio="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <filter id="${id}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB"
            x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}">
      <feImage href="${m.wave}" xlink:href="${m.wave}" x="${z.x}" y="${z.y}" width="${m.ww}" height="${z.h}" preserveAspectRatio="none" result="wave0"/>
      <feOffset in="wave0" dx="0" result="wave"/>
      <feImage href="${m.env}" xlink:href="${m.env}" x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" preserveAspectRatio="none" result="env"/>
      <feComposite in="wave" in2="env" operator="arithmetic" k1="1" k2="0" k3="-0.5" k4="0.5" result="map0"/>
      <feGaussianBlur in="map0" stdDeviation="2.5" result="map"/>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="6" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>
  <image href="${href}" xlink:href="${href}" x="0" y="0" width="${IMG_W}" height="${IMG_H}" preserveAspectRatio="none" filter="url(#${id})"/>
</svg>`;
    layer.insertAdjacentHTML('beforeend', svg);
    layer._off = layer.querySelector('feOffset'); layer._disp = layer.querySelector('feDisplacementMap');
  },
  rebuildSway() { for (const [s, l] of Object.entries(this.layers)) if (!l.querySelector('video')) this.addSway(l, s); },
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
      const scale = (W.scaleCalm + W.scaleGust * this.w).toFixed(2), P = BG._maps ? BG._maps.period : 120;
      const dx = (-(this.phase % P)).toFixed(2);
      for (const l of Object.values(BG.layers)) {
        if (l.classList.contains('is-hidden') || !l._disp) continue;
        l._disp.setAttribute('scale', scale); l._off.setAttribute('dx', dx);
      }
      Sound.wind(this.w);
    }
  },
};

/* Переключение сцены */
function applyScene(instant) {
  state.scene = sceneOf(state.mode, state.weather);
  const b = document.body.classList;
  b.toggle('evening', state.mode === 'evening');
  for (const k of ['day', 'sunset', 'evening']) b.toggle('time-' + k, state.mode === k);
  for (const k of ['clear', 'drizzle', 'downpour']) b.toggle('weather-' + k, state.weather === k);
  root.style.setProperty('--scene', `url("${CFG.backgrounds[state.scene].image}")`);
  BG.show(state.scene, instant);
  state.fxFrom = Object.assign({}, state.fx || sceneFx()); state.fxTo = sceneFx(); state.fxT0 = instant ? 0 : nowMs();
  if (instant) state.fx = Object.assign({}, state.fxTo);
  Puppets.setMode && Puppets.items && Puppets.setMode(state.scene);
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
precision mediump float;
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
      case 'youtube': {
        if (Embed.failed) { Channels.noVideo(g, W, H, sec, ch, this.ch + 1, Embed.msg); break; }
        g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
        const txt = Embed.screenText();
        if (txt && Embed.status !== 'tap') Channels.tuning(g, W, H, sec, ch, txt);
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
      gl.uniform1f(u.uTime, (t - this.t0) / 1000);
      gl.uniform1f(u.uSx, s.sx); gl.uniform1f(u.uSy, s.sy);
      gl.uniform1f(u.uBoost, s.boost); gl.uniform1f(u.uDot, s.dot);
      gl.uniform1f(u.uStatic, st);
      gl.uniform1f(u.uFlicker, REDUCED ? 0 : 1);
      gl.uniform1f(u.uCurv, CFG.screen.curvature);
      gl.uniform1f(u.uScan, Math.min(240, H / 2.6));
      gl.uniform1f(u.uGrain, REDUCED ? 0.02 : 0.07);
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
    if (this.channel().type === 'youtube' && !Embed.failed) {          // пиксели плеера недоступны — «живое» голубое мерцание
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
    for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 120; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    if (!this._snow || this._snow.width !== id.width) { this._snow = document.createElement('canvas'); this._snow.width = id.width; this._snow.height = id.height; }
    this._snow.getContext('2d').putImageData(id, 0, 0);
    g.imageSmoothingEnabled = false; g.drawImage(this._snow, 0, 0, W, H); g.imageSmoothingEnabled = true;
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, H / 2 - 30, W, 60);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `14px ${PIX}`; g.fillStyle = '#e8f0ff';
    if (Math.floor(sec * 1.5) % 2 === 0 || REDUCED) g.fillText(txt, W / 2, H / 2 - 6);
    g.font = `8px ${PIX}`; g.fillStyle = '#9fb0d0'; g.fillText(ch.label || '', W / 2, H / 2 + 16);
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
  resize() { placeEl(this.el, CFG.zones.screen); },
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
    return { loading: 'ПОИСК СИГНАЛА…', starting: 'НАСТРОЙКА…', tap: 'НАЖМИТЕ НА ЭКРАН', skip: 'РОЛИК НЕДОСТУПЕН — ДАЛЬШЕ' }[this.status] || null;
  },
  playing() { return this.status === 'playing'; },
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
    this.ch = ch; this.failed = false; this.msg = ''; this.errors = 0;
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
    this.player = new YT.Player('ytHost', {
      width: '640', height: '360', host: hostUrl,
      videoId: s.videos ? pick(s.videos) : undefined,
      playerVars: Object.assign({ autoplay: 1, mute: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, playsinline: 1, rel: 0, cc_load_policy: 0 },
        s.list ? { listType: 'playlist', list: s.list } : {}, location.protocol.startsWith('http') ? { origin: location.origin } : {}),
      events: {
        onReady: () => { this.ready = true; this.log('плеер готов'); this.shuffle(); },
        onStateChange: e => this.onState(e.data),
        onError: e => this.onError(e.data),
      },
    });
  },
  load(s) {
    try {
      if (s.list) this.player.loadPlaylist({ list: s.list, listType: 'playlist', index: 0 });
      else this.player.loadVideoById(pick(s.videos));
    } catch (_) {}
    this.shuffle();
  },
  /* состояния YouTube: -1 не начат, 0 закончился, 1 идёт, 2 пауза, 3 буферизация, 5 подготовлен */
  onState(st) {
    this.ytState = st; this.log('состояние', st);
    if (st === 1) {
      this.errors = 0; this.setStatus('playing'); this.syncVolume();
      if (!this._seeked && this.ch && this.ch.randomStart) {
        this._seeked = true;
        setTimeout(() => { try { const d = this.player.getDuration(); if (d > 90) this.player.seekTo(d * rand(0.05, 0.6), true); } catch (_) {} }, 400);
      }
    }
    if (st === 0) { this._seeked = false; this.next(); }
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
    try { this.player.playVideo(); } catch (_) {}
    return true;
  },
  shuffle() {
    const ch = this.ch, s = ch && this.source(ch); if (!s || !this.player) return;
    this._seeked = false;
    const go = (tries = 0) => {
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
    this.ch = null; this.el.classList.remove('on'); this.setStatus('idle');
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
  el: $('#rain'), drops: [], kind: 'clear', level: 0, target: 0, nextBolt: 0,
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
    // молнии только в ливень
    if (this.kind === 'downpour' && t > this.nextBolt && !REDUCED) {
      this.nextBolt = t + rand(...CFG.weather.lightningEveryMs);
      this.bolt();
    }
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
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);

    this.amb = G(state.ambience); this.amb.connect(this.master);
    this.sfx = G(CFG.audio.sfxVolume); this.sfx.connect(this.master);
    this.tv = G(state.tvVolume);
    const hp = this.f('highpass', 160), lp = this.f('lowpass', 6500);
    this.tv.connect(hp).connect(lp).connect(this.master);

    this.events = G(1); this.events.connect(this.amb);

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
  p(v) { if (!this.ctx.createStereoPanner) return this.g(1); const n = this.ctx.createStereoPanner(); n.pan.value = clamp(v, -1, 1); return n; },
  out(node, dest, pan) { if (pan == null) { node.connect(dest); return; } const p = this.p(pan); node.connect(p).connect(dest); },
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
    return clamp(0.1 / loud, 0.2, 12);
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
  },
  setAmbience(v) { state.ambience = v; if (this.amb) this.amb.gain.setTargetAtTime(v, this.ctx.currentTime, 0.08); },
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
    return this.loop('room-tone', this.amb, 0.5, () => {
      const n = this.noise('brown'), lp = this.f('lowpass', 240), gn = this.g(0.2);
      n.connect(lp).connect(gn).connect(this.amb); n.start(0, Math.random() * 3);
      const hum = this.o('sine', 100), hg = this.g(0.0032); hum.connect(hg).connect(this.amb); hum.start();
      return { stop: at => { gn.gain.setTargetAtTime(0, at, 0.3); hg.gain.setTargetAtTime(0, at, 0.3); n.stop(at + 2); hum.stop(at + 2); } };
    });
  },
  noiseBed(bus, kind, type, f, vol, pan, q = 0.707) {
    const n = this.noise(kind), fl = this.f(type, f, q), gn = this.g(vol);
    n.connect(fl).connect(gn); this.out(gn, bus, pan); n.start(0, Math.random() * 3);
    return { stop: at => { gn.gain.setTargetAtTime(0, at, 0.3); n.stop(at + 2); } };
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
    const t = this.ctx.currentTime, W = this._wind, k = state.mode === 'evening' ? 0.7 : 1;
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
      const bp = this.f('bandpass', 6800, 3), gn = this.g(0), pn = this.p(-dir);
      o.connect(bp).connect(gn).connect(pn).connect(bus);
      if (pn.pan) { pn.pan.setValueAtTime(-dir * 0.8 + 0.3, tt); pn.pan.linearRampToValueAtTime(dir * 0.8 + 0.3, tt + dur); }
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
  throughWall(pan = -0.55, cutoff = 1700) {
    if (!this._kitchen) {
      this._kitchen = this.ctx.createConvolver(); this._kitchen.buffer = this.makeImpulse(0.7, 4.5);
      const kp = this.p(pan); this._kitchen.connect(kp).connect(this.events);
    }
    const inp = this.g(1), hp = this.f('highpass', 140), w1 = this.f('lowpass', cutoff, 0.6), w2 = this.f('lowpass', cutoff * 1.4, 0.5), body = this.f('peaking', 380, 0.9);
    body.gain.value = 4;
    inp.connect(hp).connect(w1).connect(w2).connect(body);
    const pn = this.p(pan); body.connect(pn).connect(this.events);
    const room = this.g(0.55); body.connect(room).connect(this._kitchen);
    return { inp, done: () => { inp.disconnect(); body.disconnect(); room.disconnect(); } };
  },
  frying(t) {
    if (this.files.frying) {
      const W = this.throughWall(-0.55, CFG.audio.kitchenCutoff || 1700);
      const f = this.playFile('frying', t, W.inp, { vol: 0.6, maxDur: rand(15, 20), fadeOut: 3 });
      setTimeout(W.done, (f.dur + 2) * 1000);
      return f.dur;
    }
    if (!this._crackle) this._crackle = this.makeCrackle();
    if (!this._kitchen) { this._kitchen = this.ctx.createConvolver(); this._kitchen.buffer = this.makeImpulse(0.7, 4.5); }
    const dur = rand(14, 18);
    // «стена»: два низкочастотных фильтра подряд + тёплая середина
    const out = this.g(0), wall1 = this.f('lowpass', 1700, 0.6), wall2 = this.f('lowpass', 2400, 0.5), body = this.f('peaking', 380, 0.9);
    body.gain.value = 4;
    const hp = this.f('highpass', 140);
    out.connect(hp).connect(wall1).connect(wall2).connect(body);
    const pn = this.p(-0.55); body.connect(pn).connect(this.events);
    const room = this.g(0.55); body.connect(room).connect(this._kitchen).connect(pn);
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
    const pn = this.p(-1);
    if (pn.pan) { pn.pan.setValueAtTime(-1, t); pn.pan.linearRampToValueAtTime(1, t + T); }
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
    const f = this.playFile('clock', t, this.events, { vol: 0.8, pan: -0.3 }); if (f) return f.dur;
    const n = irand(9, 13);
    for (let i = 0; i < n; i++) {
      const tt = t + i * 1.0, v = 0.22 * Math.min(1, (i + 1) / 3, (n - i) / 3);
      this.burst(tt, { dur: 0.014, vol: v, f: i % 2 ? 2300 : 3200, q: 4, dest: this.events, pan: -0.3 });
      this.tone(tt, { f: i % 2 ? 1700 : 2100, dur: 0.03, vol: v * 0.25, dest: this.events, pan: -0.3 });
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
    if (d.id === 'channelKnob') {
      el.addEventListener('wheel', e => {
        e.preventDefault();
        const t = nowMs(); if (this._wheelT && t - this._wheelT < 260) return; this._wheelT = t;
        this.turnChannel(e.deltaY > 0 ? 1 : -1);
      }, { passive: false });
      el.addEventListener('contextmenu', e => { e.preventDefault(); this.turnChannel(-1); });
    }
    el.addEventListener('click', async e => {
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
    } else if (d.id === 'window') {
      Sound.windowLatch();
      setWeather(nextIn(CFG.weatherCycle, state.weather));
      UI.toast(T.weatherNow[state.weather], 2600);
      if (HOVER && el.matches(':hover')) this.showCaption(el);
    } else if (d.egg) {
      if (d.egg.eveningOnly && state.mode !== 'evening') return;
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
    this.setMode(state.mode);
  },
  src(id, mode, plate) { return `assets/eggs/${id}-${plate ? 'plate-' : ''}${mode}.png`; },
  setMode(mode) {
    for (const p of Object.values(this.items)) {
      const id = p.egg.id, cut = this.src(id, mode);
      p.el.querySelector('.plate').src = this.src(id, mode, true);
      p.sprite.src = cut;
      p.el.querySelector('.glow-sprite').src = cut;
      p.el.style.setProperty('--cut', `url("${cut}")`);
      if (p.tt) p.tt.dirty = true;
      if (p.cube) p.cube.dirty = true;
    }
  },
  hover(id, on) { const p = this.items[id]; if (p) p.el.classList.toggle('hover', on); },
  busy(id) { const p = this.items[id]; return !!(p && p.busy); },
  /* пиксели картинки → проценты коробки предмета */
  rel(p, px, py) { return [(px - p.box[0]) / p.box[2] * 100, (py - p.box[1]) / p.box[3] * 100]; },

  extras(p) {
    const e = p.egg;
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
    p.el.classList.add('anim');
    try { await (this.anims[p.egg.anim] || this.anims.rattle3d).call(this, p); }
    catch (err) { console.warn('[Tube TV] анимация', id, err); }
    p.body.style.transform = '';
    p.el.classList.remove('anim', 'no-sprite');
    p.busy = false;
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
      if (!tt || !this.ttUpload(p)) {                       // запасной вариант без WebGL / на file://
        p.body.style.transformOrigin = '50% 96%';
        await wa(p.body, this.k([[0, 0, 0, 0, 0], [0.25, -2, 0, 40, 0], [0.5, 0, 0, -38, 0], [0.75, -2, 0, 30, 0], [1, 0, 0, 0, 0]]), { duration: 5000, easing: 'ease-in-out' });
        return;
      }
      this.ttResize(p);
      tt.c.hidden = false;
      this.ttDraw(p, 0);
      p.el.classList.add('no-sprite');
      const d = REDUCED ? 4200 : 5600, t0 = nowMs();
      await new Promise(res => {
        const step = () => {
          const k = clamp((nowMs() - t0) / d, 0, 1);
          const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;   // easeInOutCubic
          this.ttDraw(p, e * Math.PI * 2);
          tt.c.style.transform = `translateY(${-Math.sin(k * Math.PI) * 3}%)`;
          if (k < 1) requestAnimationFrame(step); else res();
        };
        requestAnimationFrame(step);
      });
      p.el.classList.remove('no-sprite');
      tt.c.hidden = true; tt.c.style.transform = '';
    },
  },

  /* ---------- кубик ---------- */
  buildCube(p) {
    const cfg = p.egg.cube;
    if (p.cube && !p.cube.dirty) return p.cube;
    if (p.cube) p.cube.wrap.remove();
    const light = { day: 0.95, sunset: 0.82, overcast: 0.72, evening: 0.6 }[state.scene] || 0.9;
    const warm = { day: 1, sunset: 1.4, overcast: 0.3, evening: 0.6 }[state.scene] ?? 1;
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

  /* ---------- проигрыватель статуэтки ---------- */
  ttSetup(p) {
    if (p.tt) return p.tt.gl ? p.tt : null;
    const c = document.createElement('canvas'); c.className = 'tt'; c.hidden = true;
    p.el.appendChild(c);
    const gl = c.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true });
    p.tt = { c, gl: null, dirty: true };
    if (!gl) return null;
    const VS = 'attribute vec2 a; varying vec2 v; void main(){ v = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }';
    const FS = `
precision mediump float;
varying vec2 v;
uniform sampler2D uTex, uProf, uRow;
uniform float uTheta, uL, uFront;
float sh(float a){ return 0.42 + 0.58 * max(cos(a - uL), 0.0); }
void main(){
  vec2 uv = vec2(v.x, 1.0 - v.y);
  vec4 pr = texture2D(uProf, vec2(uv.y, 0.5));
  float c = pr.r, r = pr.g;
  if (r < 0.006) { gl_FragColor = vec4(0.0); return; }
  float s = (uv.x - c) / r;
  if (abs(s) > 1.0) { gl_FragColor = vec4(0.0); return; }
  float phi = asin(s);                                   // угол точки поверхности, которую мы видим
  float p0 = mod(phi - uTheta + 3.14159265, 6.2831853) - 3.14159265;  // где эта точка была на фото
  // 1) лицевая сторона: исходная фотография, переложенная на цилиндр
  vec4 tex = texture2D(uTex, vec2(c + r * sin(p0), uv.y), -0.3);
  float pf = abs(p0) > 1.5707963 ? (p0 > 0.0 ? 3.14159265 - p0 : -3.14159265 - p0) : p0;
  tex.rgb *= clamp(sh(phi) / sh(pf), 0.6, 1.45);
  // 2) бока и спина: фарфор — средний цвет строки, освещение, блик, складки юбки
  vec3 base = texture2D(uRow, vec2(uv.y, 0.5)).rgb;
  vec3 N = vec3(sin(phi), 0.0, cos(phi));
  vec3 L = normalize(vec3(sin(uL), 0.25, cos(uL)));
  float dif = max(dot(N, L), 0.0);
  float spec = pow(max(dot(reflect(-L, N), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
  float fold = uv.y > 0.5 ? 0.08 * sin(p0 * 10.0 + uv.y * 7.0) : 0.03 * sin(p0 * 6.0);
  vec3 mat = base * (0.38 + 0.78 * dif) * (1.0 + fold) + vec3(spec * 0.4);
  float w = smoothstep(1.85, 1.35, abs(p0));
  w = mix(1.0, w, uFront);                               // в самом начале и конце — точно как на фото
  vec3 col = mix(mat, tex.rgb, w);
  float a = mix(1.0, tex.a, w);
  float edge = smoothstep(1.0, 0.93, abs(s));
  gl_FragColor = vec4(col * a * edge, a * edge);
}`;
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    try {
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog); gl.useProgram(prog);
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      p.tt.tex = gl.createTexture(); p.tt.prof = gl.createTexture(); p.tt.row = gl.createTexture();
      p.tt.u = { theta: gl.getUniformLocation(prog, 'uTheta'), L: gl.getUniformLocation(prog, 'uL'), front: gl.getUniformLocation(prog, 'uFront') };
      gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);
      gl.uniform1i(gl.getUniformLocation(prog, 'uProf'), 1);
      gl.uniform1i(gl.getUniformLocation(prog, 'uRow'), 2);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      p.tt.gl = gl;
      return p.tt;
    } catch (err) { console.warn('[Tube TV] проигрыватель статуэтки:', err); return null; }
  },
  ttUpload(p) {
    const tt = p.tt, gl = tt.gl;
    if (!tt.dirty) return true;
    const img = p.sprite;
    if (!img.complete || !img.naturalWidth) return false;
    const W = 256, H = 512;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, W, H);
    let d;
    try { d = g.getImageData(0, 0, W, H).data; } catch (_) { return false; }   // file:// — без WebGL-поворота
    const cs = new Float32Array(H), rs = new Float32Array(H), row = new Uint8Array(H * 4);
    for (let y = 0; y < H; y++) {
      let mn = -1, mx = -1, R = 0, G = 0, B = 0, n = 0;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (d[i + 3] > 50) { if (mn < 0) mn = x; mx = x; }
        if (d[i + 3] > 200) { R += d[i]; G += d[i + 1]; B += d[i + 2]; n++; }
      }
      if (mn >= 0) { cs[y] = (mn + mx + 1) / 2 / W; rs[y] = (mx - mn + 1) / 2 / W + 1 / W; }
      if (n) { row[y * 4] = Math.min(255, R / n * 1.18); row[y * 4 + 1] = Math.min(255, G / n * 1.18); row[y * 4 + 2] = Math.min(255, B / n * 1.18); }
      row[y * 4 + 3] = 255;
    }
    const sm = (arr, R) => arr.map((_, i) => { let s = 0, k2 = 0; for (let k = -R; k <= R; k++) { const v = arr[i + k]; if (v > 0) { s += v; k2++; } } return arr[i] > 0 && k2 ? s / k2 : 0; });
    const C = sm(sm(cs, 14), 10), Rr = sm(sm(rs, 6), 4);
    for (let y = 1; y < H; y++) if (!row[y * 4] && row[(y - 1) * 4]) { row[y * 4] = row[(y - 1) * 4]; row[y * 4 + 1] = row[(y - 1) * 4 + 1]; row[y * 4 + 2] = row[(y - 1) * 4 + 2]; }
    // сглаживаем цвет по высоте (иначе мелкие детали дают полосы) и чуть уводим в фарфоровый
    for (let ch = 0; ch < 3; ch++) {
      const src = Array.from({ length: H }, (_, y) => row[y * 4 + ch]);
      for (let y = 0; y < H; y++) {
        let s = 0, n = 0;
        for (let k = -18; k <= 18; k++) { const v = src[y + k]; if (v) { s += v; n++; } }
        if (n) { const lum = (row[y * 4] * 0.3 + row[y * 4 + 1] * 0.59 + row[y * 4 + 2] * 0.11); row[y * 4 + ch] = Math.min(255, (s / n) * 0.75 + lum * 0.25); }
      }
    }
    const prof = new Uint8Array(H * 4);
    for (let y = 0; y < H; y++) { prof[y * 4] = Math.round(C[y] * 255); prof[y * 4 + 1] = Math.round(clamp(Rr[y], 0, 1) * 255); prof[y * 4 + 3] = 255; }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tt.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tt.prof);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, H, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, prof);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tt.row);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, H, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, row);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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
    const gl = p.tt.gl;
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(p.tt.u.theta, theta);
    const away = Math.min(theta, Math.PI * 2 - theta);
    gl.uniform1f(p.tt.u.front, smooth(0, 0.35, away));
    gl.uniform1f(p.tt.u.L, { day: 0.7, sunset: 0.95, overcast: 0.15, evening: -0.9 }[state.scene] ?? 0.7);   // днём свет из окна справа, вечером — торшер слева
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  },
};

/* ---------- микро-эффекты ---------- */
const FX = {
  wrap: $('#fx'),
  px(z) { const s = state.stage; return { x: z.x / 100 * s.w, y: z.y / 100 * s.h, w: z.w / 100 * s.w, h: z.h / 100 * s.h, u: s.u }; },
  add(cls, x, y, html = '') { const el = document.createElement('div'); el.className = cls; el.style.left = x + 'px'; el.style.top = y + 'px'; el.innerHTML = html; this.wrap.appendChild(el); return el; },
  run(el, frames, opts) { const a = el.animate(frames, opts); a.onfinish = () => el.remove(); return a; },
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
    $('.amb-label').textContent = T.ambience;
    const amb = $('#ambVol'); amb.value = state.ambience;
    amb.addEventListener('input', () => { Sound.setAmbience(+amb.value); });
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
  TV.init();
  Embed.init();
  Light.init();
  Dust.init();
  Weather.init();
  Zones.init();
  Puppets.init();
  UI.init();
  applyScene(true);
  layout();
  addEventListener('resize', layout);
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
    const dt = Math.min(64, t - last); last = t;
    if (state.fxT0) {
      const k = smooth(0, 1, clamp((t - state.fxT0) / CFG.crossfadeMs, 0, 1));
      for (const key of Object.keys(state.fxTo)) state.fx[key] = lerp(state.fxFrom[key] || 0, state.fxTo[key], k);
      if (k >= 1) state.fxT0 = 0;
    }
    Wind.update(t, dt);
    TV.render(t);
    Light.update(t);
    Dust.update(t, dt);
    Weather.update(t, dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  window.TubeTV = { TV, Sound, Events, setMode, setWeather, Calib, Puppets, Camera, Embed, Wind, Weather, state, CFG };   // для отладки из консоли
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
