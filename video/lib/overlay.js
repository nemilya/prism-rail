/* Графика поверх кадра: «доска» (тёмно-синий фон чертежа), линии мелом, которые рисуются
 * на глазах, стрелки, дуги углов, подписи от руки, формулы, плашки с числами, титры, субтитры.
 * Всё — функции видимости p (0…1) и времени, без часов и случайности: «дрожание» мела —
 * из синусов координат. Размеры — в пикселях кадра 1080p (умножаются на env.u).
 * Шрифты — video/fonts/ (Inter — интерфейс, Caveat — от руки, Source Serif 4 — формулы). */
export const UI = 'Inter, system-ui, sans-serif';
export const HAND = 'Caveat, "Comic Sans MS", cursive';
export const SERIF = '"Source Serif 4", Georgia, serif';

export const C = {
  board: '#070c1a', chalk: '#e8eeff', dim: 'rgba(232, 238, 255, .38)', faint: 'rgba(232, 238, 255, .12)',
  accent: '#9aa8ff', warm: '#ffc76b', glass: 'rgba(140, 190, 255, .10)', ink: '#0b0f1c',
};

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const seg = (t, a, b) => clamp((t - a) / (b - a));
export const E = {
  out: (k) => 1 - (1 - clamp(k)) ** 3,
  inOut: (k) => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; },
  back: (k) => { k = clamp(k); const c = 1.7; return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2; },
};
/** видимость в интервале [a, b) сцены с плавным входом и выходом за f секунд */
export const shown = (lt, a, b = Infinity, f = 0.35) => Math.min(seg(lt, a, a + f), b === Infinity ? 1 : 1 - seg(lt, b - f, b));
const rad = (d) => (d * Math.PI) / 180;
export const deg = rad;

// ---------------------------------------------------------------- цвет
/** Длина волны, нм → [r, g, b] 0…1 (видимый спектр, кусочно-линейная аппроксимация с гаммой) */
export function wl(l) {
  let r = 0; let g = 0; let b = 0;
  if (l < 440) { r = -(l - 440) / 60; b = 1; } else if (l < 490) { g = (l - 440) / 50; b = 1; } else if (l < 510) { g = 1; b = -(l - 510) / 20; } else if (l < 580) { r = (l - 510) / 70; g = 1; } else if (l < 645) { r = 1; g = -(l - 645) / 65; } else r = 1;
  const f = l < 420 ? 0.3 + (0.7 * (l - 380)) / 40 : l > 680 ? 0.3 + (0.7 * (750 - l)) / 70 : 1;
  return [r, g, b].map((c) => clamp(c * f) ** 0.8);
}
export const rgb = (c, a = 1) => `rgba(${Math.round(clamp(c[0]) * 255)}, ${Math.round(clamp(c[1]) * 255)}, ${Math.round(clamp(c[2]) * 255)}, ${a})`;
export const wlCss = (l, a = 1) => rgb(wl(l), a);

// ---------------------------------------------------------------- фон и затемнения
/** Затемнение/высветление всего кадра */
export function fade(ctx, env, color, a) {
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha = clamp(a);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, env.W, env.H);
  ctx.restore();
}

/** «Доска»: глубокий синий, мягкая виньетка и едва заметная сетка, как на чертеже */
export function board(ctx, env, a = 1) {
  if (a <= 0) return;
  const { W, H, u } = env;
  ctx.save();
  ctx.globalAlpha = clamp(a);
  const g = ctx.createRadialGradient(W * 0.45, H * 0.42, 0, W * 0.45, H * 0.42, Math.hypot(W, H) * 0.62);
  g.addColorStop(0, '#13204a');
  g.addColorStop(0.55, '#0b1330');
  g.addColorStop(1, '#04060e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(160, 185, 255, .045)';
  ctx.lineWidth = 1.2 * u;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 60 * u) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = 0; y <= H; y += 60 * u) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  ctx.restore();
}

/** Мягкое затемнение снизу — чтобы титры читались на любом фоне */
export function scrim(ctx, env, a = 1, h = 0.42) {
  if (a <= 0) return;
  ctx.save();
  const g = ctx.createLinearGradient(0, env.H * (1 - h), 0, env.H);
  g.addColorStop(0, 'rgba(0, 0, 0, 0)');
  g.addColorStop(1, `rgba(0, 0, 0, ${0.55 * a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, env.H * (1 - h), env.W, env.H * h);
  ctx.restore();
}

// ---------------------------------------------------------------- линии мелом
/** точка дизайна (1080p, по центру кадра) → пиксели. Дизайн-кадр 1920×1080, центр — середина */
export function px(env, x, y) {
  return { x: env.W / 2 + (x - 960) * env.u, y: env.H / 2 + (y - 540) * env.u };
}
export const pxs = (env, pts) => pts.map((p) => (p.x === undefined ? px(env, p[0], p[1]) : p));

function lengths(pts) {
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return acc;
}
/** Ломаная → n точек на равных расстояниях (для перетекания одной фигуры в другую) */
export function resample(pts, n) {
  const acc = lengths(pts);
  const total = acc.at(-1) || 1;
  const out = [];
  let j = 1;
  for (let i = 0; i < n; i++) {
    const d = (total * i) / (n - 1);
    while (j < pts.length - 1 && acc[j] < d) j++;
    const k = (d - acc[j - 1]) / (acc[j] - acc[j - 1] || 1);
    out.push({ x: lerp(pts[j - 1].x, pts[j].x, clamp(k)), y: lerp(pts[j - 1].y, pts[j].y, clamp(k)) });
  }
  return out;
}
/** Перетекание: две ломаные (уже в пикселях) → промежуточная */
export function morph(a, b, k, n = 64) {
  const A = resample(a, n);
  const B = resample(b, n);
  const e = E.inOut(k);
  return A.map((p, i) => ({ x: lerp(p.x, B[i].x, e), y: lerp(p.y, B[i].y, e) }));
}
/** Начало ломаной длиной p от всей (0…1) */
function partial(pts, p) {
  if (p >= 1) return pts;
  const acc = lengths(pts);
  const d = acc.at(-1) * clamp(p);
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (acc[i] <= d) { out.push(pts[i]); continue; }
    const k = (d - acc[i - 1]) / (acc[i] - acc[i - 1] || 1);
    out.push({ x: lerp(pts[i - 1].x, pts[i].x, k), y: lerp(pts[i - 1].y, pts[i].y, k) });
    break;
  }
  return out;
}

/** Линия мелом: рисуется на глазах (p — доля длины), со свечением и светлой «головкой» мела.
 * pts — [{x,y}] в пикселях или [[x,y]] в дизайн-координатах. */
export function chalk(ctx, env, pts0, p, { color = C.chalk, width = 4, glow = 14, dash = null, alpha = 1, head = true, arrow = false } = {}) {
  if (p <= 0 || alpha <= 0 || pts0.length < 2) return;
  const u = env.u;
  const pts = partial(pxs(env, pts0), p);
  ctx.save();
  ctx.globalAlpha = clamp(alpha);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = width * u;
  ctx.shadowColor = color;
  ctx.shadowBlur = glow * u;
  if (dash) ctx.setLineDash(dash.map((d) => d * u));
  ctx.beginPath();
  // мел чуть дрожит: смещение по нормали из синусов координат (детерминировано)
  pts.forEach((q, i) => {
    const j = Math.sin(q.x * 0.071 + q.y * 0.053) * 0.6 * u;
    if (i) ctx.lineTo(q.x + j, q.y - j); else ctx.moveTo(q.x, q.y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  const end = pts.at(-1);
  const prev = pts.length > 1 ? pts.at(-2) : pts[0];
  if (arrow && p >= 0.98) {
    const a = Math.atan2(end.y - prev.y, end.x - prev.x);
    ctx.beginPath();
    for (const s of [-1, 1]) { ctx.moveTo(end.x, end.y); ctx.lineTo(end.x - Math.cos(a + s * 0.42) * 22 * u, end.y - Math.sin(a + s * 0.42) * 22 * u); }
    ctx.stroke();
  }
  if (head && p < 0.995) {
    ctx.fillStyle = '#fff';
    ctx.shadowBlur = 22 * u;
    ctx.beginPath();
    ctx.arc(end.x, end.y, width * 0.9 * u, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Луч света: широкое мягкое свечение + яркая сердцевина (цвет — css) */
export function ray(ctx, env, pts, p, color = '#fff', { width = 5, alpha = 1, arrow = true } = {}) {
  chalk(ctx, env, pts, p, { color, width: width * 3.2, glow: 30, alpha: alpha * 0.22, head: false });
  chalk(ctx, env, pts, p, { color, width, glow: 18, alpha, arrow });
}

/** Дуга угла с центром O (дизайн), от угла a0 до a1 (радианы, экранные: 0 — вправо, +π/2 — вниз) */
export function angle(ctx, env, O, a0, a1, r, label, p, { color = C.chalk, size = 46, off = 1.45 } = {}) {
  if (p <= 0) return;
  const pts = [];
  const n = 28;
  for (let i = 0; i <= n; i++) {
    const a = lerp(a0, a1, i / n);
    pts.push([O[0] + Math.cos(a) * r, O[1] + Math.sin(a) * r]);
  }
  chalk(ctx, env, pts, E.out(seg(p, 0, 0.7)), { color, width: 3, glow: 8, head: false });
  if (label) {
    const am = (a0 + a1) / 2;
    formula(ctx, env, label, O[0] + Math.cos(am) * r * off, O[1] + Math.sin(am) * r * off + size * 0.32, { size, color, align: 'center' }, seg(p, 0.4, 1));
  }
}

// ---------------------------------------------------------------- текст
/** Подпись от руки (Caveat): проявляется слева направо */
export function hand(ctx, env, text, x, y, p, { size = 52, color = C.chalk, align = 'left', glow = 10 } = {}) {
  if (p <= 0) return;
  const u = env.u;
  const P = px(env, x, y);
  ctx.save();
  ctx.font = `700 ${size * u}px ${HAND}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  const lines = String(text).split('\n');
  const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const left = align === 'center' ? P.x - tw / 2 : align === 'right' ? P.x - tw : P.x;
  ctx.beginPath();
  ctx.rect(left - 20 * u, P.y - size * u * 1.2, (tw + 40 * u) * E.out(p), size * u * (lines.length + 0.6));
  ctx.clip();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = glow * u;
  lines.forEach((l, i) => ctx.fillText(l, P.x, P.y + i * size * 1.02 * u));
  ctx.restore();
}

/* Формулы: маленький TeX. a_1 a_{12} — индекс, a^2 — степень, \sqrt{…} — корень (рисуется линией),
 * (...) и прочее — как есть. Одиночные латинские и греческие буквы — курсивом, слова (sin, нм) — прямо. */
const WORD = /^(sin|cos|tg|нм|°)$/;
function parse(src) {
  const out = [];
  let i = 0;
  const group = () => {
    if (src[i] === '{') {
      let d = 0; const s = i;
      for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) break; }
      i++;
      return parse(src.slice(s + 1, i - 1));
    }
    return parse(src[i++]);
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === '_' || ch === '^') { i++; out.push({ t: ch === '_' ? 'sub' : 'sup', k: group() }); continue; }
    if (src.startsWith('\\sqrt', i)) { i += 5; out.push({ t: 'sqrt', k: group() }); continue; }
    const m = /^[A-Za-zА-Яа-яё]+/.exec(src.slice(i));
    if (m) { out.push({ t: 'w', s: m[0] }); i += m[0].length; continue; }
    out.push({ t: 'c', s: ch }); i++;
  }
  return out;
}
function layout(ctx, nodes, size, x, y, ops) {
  for (const n of nodes) {
    if (n.t === 'sub' || n.t === 'sup') {
      x = layout(ctx, n.k, size * 0.62, x + size * 0.02, y + (n.t === 'sub' ? size * 0.24 : -size * 0.42), ops);
      continue;
    }
    if (n.t === 'sqrt') {
      const x0 = x;
      const inner = [];
      const x1 = layout(ctx, n.k, size, x0 + size * 0.62, y, inner);
      ops.push({ line: [[x0, y - size * 0.32], [x0 + size * 0.16, y - size * 0.4], [x0 + size * 0.34, y + size * 0.12], [x0 + size * 0.52, y - size * 0.84], [x1 + size * 0.06, y - size * 0.84]], w: size * 0.055 });
      ops.push(...inner);
      x = x1 + size * 0.12;
      continue;
    }
    const s = n.s;
    const italic = n.t === 'w' ? s.length === 1 && /[A-Za-z]/.test(s) && !WORD.test(s) : /[α-ωΑ-Ω]/.test(s);
    const font = `${italic ? 'italic ' : ''}400 ${size}px ${SERIF}`;
    ctx.font = font;
    const pad = /[=+−·→≈×]/.test(s) ? size * 0.22 : 0;
    ops.push({ text: s, x: x + pad, y, font });
    x += ctx.measureText(s).width + pad * 2 + (italic ? size * 0.04 : 0);
  }
  return x;
}
/** Формула (дизайн-координаты x, y — базовая линия): проявляется слева направо, как будто пишется */
export function formula(ctx, env, src, x, y, { size = 64, color = C.chalk, align = 'left', glow = 12 } = {}, p = 1) {
  if (p <= 0) return 0;
  const u = env.u;
  const P = px(env, x, y);
  ctx.save();
  const ops = [];
  const w = layout(ctx, parse(src), size * u, 0, 0, ops);
  const left = align === 'center' ? P.x - w / 2 : align === 'right' ? P.x - w : P.x;
  ctx.beginPath();
  ctx.rect(left - 10 * u, P.y - size * u * 1.3, (w + 20 * u) * E.inOut(p), size * u * 2);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = glow * u;
  ctx.textBaseline = 'alphabetic';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const o of ops) {
    if (o.line) {
      ctx.lineWidth = o.w;
      ctx.beginPath();
      o.line.forEach(([lx, ly], i) => (i ? ctx.lineTo(left + lx, P.y + ly) : ctx.moveTo(left + lx, P.y + ly)));
      ctx.stroke();
    } else {
      ctx.font = o.font;
      ctx.fillText(o.text, left + o.x, P.y + o.y);
    }
  }
  ctx.restore();
  return w / u;
}

/** Плашка-факт на тёмном стекле: строки [{text|formula, color}], x, y — левый верх (дизайн) */
export function plate(ctx, env, x, y, w, h, p, draw) {
  if (p <= 0) return;
  const u = env.u;
  const P = px(env, x, y);
  ctx.save();
  ctx.globalAlpha = E.out(p);
  ctx.fillStyle = 'rgba(8, 12, 26, .72)';
  ctx.strokeStyle = 'rgba(200, 212, 255, .22)';
  ctx.lineWidth = 1.5 * u;
  ctx.beginPath();
  ctx.roundRect(P.x, P.y + (1 - E.out(p)) * 14 * u, w * u, h * u, 22 * u);
  ctx.fill();
  ctx.stroke();
  draw?.();
  ctx.restore();
}

/** Шкала спектра 380…720 нм с меткой λ (дизайн-координаты) */
export function spectrumBar(ctx, env, x, y, w, h, p, mark = null, { from = 400, to = 700, labels = true } = {}) {
  if (p <= 0) return;
  const u = env.u;
  const P = px(env, x, y);
  ctx.save();
  ctx.globalAlpha = E.out(p);
  const g = ctx.createLinearGradient(P.x, 0, P.x + w * u, 0);
  for (let i = 0; i <= 30; i++) g.addColorStop(i / 30, wlCss(from + ((to - from) * i) / 30));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(P.x, P.y, w * u * E.inOut(p), h * u, (h / 2) * u);
  ctx.fill();
  if (labels) {
    ctx.font = `500 ${22 * u}px ${UI}`;
    ctx.fillStyle = C.dim;
    ctx.textAlign = 'left';
    ctx.fillText(`${from} нм`, P.x, P.y + h * u + 30 * u);
    ctx.textAlign = 'right';
    ctx.fillText(`${to} нм`, P.x + w * u, P.y + h * u + 30 * u);
  }
  if (mark !== null && p > 0.6) {
    const mx = P.x + ((mark - from) / (to - from)) * w * u;
    ctx.fillStyle = '#fff';
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 12 * u;
    ctx.beginPath();
    ctx.moveTo(mx, P.y - 6 * u); ctx.lineTo(mx - 12 * u, P.y - 26 * u); ctx.lineTo(mx + 12 * u, P.y - 26 * u);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(mx - 1.5 * u, P.y, 3 * u, h * u);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- титры
/** Большой заголовок слева внизу: kicker (мелко), title, sub */
export function title(ctx, env, { kicker, title: tt, sub }, p) {
  if (p <= 0) return;
  const u = env.u;
  const x = 110 * u;
  const y = env.H - (130 + (env.subs ? 70 : 0)) * u + (1 - E.out(p)) * 30 * u;
  ctx.save();
  ctx.globalAlpha = E.out(p);
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0, 0, 0, .6)';
  ctx.shadowBlur = 30 * u;
  ctx.fillStyle = '#fff';
  if (sub) { ctx.font = `400 ${40 * u}px ${UI}`; ctx.fillStyle = 'rgba(255,255,255,.82)'; ctx.fillText(sub, x, y); }
  ctx.fillStyle = '#fff';
  ctx.font = `600 ${112 * u}px ${SERIF}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${-2 * u}px`;
  ctx.fillText(tt, x - 4 * u, y - 66 * u);
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${6 * u}px`;
  if (kicker) {
    ctx.font = `600 ${26 * u}px ${UI}`;
    const g = ctx.createLinearGradient(x, 0, x + 360 * u, 0);
    ['#5ee7ff', '#8b9cff', '#d68bff', '#ff8fb1', '#ffc76b'].forEach((c, i) => g.addColorStop(i / 4, c));
    ctx.fillStyle = g;
    ctx.fillText(kicker.toUpperCase(), x, y - 206 * u);
  }
  ctx.restore();
}

/** Вшитые субтитры (по манифесту озвучки): одна-две строки внизу по центру */
export function subtitle(ctx, env, cue, t) {
  if (!cue) return;
  const u = env.u;
  const p = Math.min(seg(t, cue.t0, cue.t0 + 0.15), 1 - seg(t, cue.t1, cue.t1 + 0.15));
  if (p <= 0) return;
  ctx.save();
  ctx.font = `500 ${40 * u}px ${UI}`;
  const maxW = env.W * (env.portrait ? 0.86 : 0.7);
  const words = cue.text.split(' ');
  const lines = [''];
  for (const w of words) {
    const tryL = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${w}` : w;
    if (ctx.measureText(tryL).width > maxW && lines[lines.length - 1]) lines.push(w);
    else lines[lines.length - 1] = tryL;
  }
  const lh = 54 * u;
  const y0 = env.H - (env.portrait ? 330 : 60) * u - lh * lines.length;
  ctx.globalAlpha = p;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => {
    const w = ctx.measureText(l).width + 36 * u;
    ctx.fillStyle = 'rgba(4, 6, 14, .74)';
    ctx.beginPath();
    ctx.roundRect(env.W / 2 - w / 2, y0 + i * lh, w, lh - 4 * u, 10 * u);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(l, env.W / 2, y0 + i * lh + 6 * u);
  });
  ctx.restore();
}
