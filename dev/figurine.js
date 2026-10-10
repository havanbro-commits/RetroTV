/* Фарфоровая статуэтка «девочка с корзинкой» — настоящая 3D-модель (поле расстояний, ray marching).
   Модельные единицы: высота фигурки = 1, начало — центр низа подставки, y вверх, z к зрителю.
   Передняя сторона дополнительно «расписана» фотографией (проекция спереди), бока и спина — фарфор. */
window.FIG_SHADER = `
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
