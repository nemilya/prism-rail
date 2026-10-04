/* Ролик «Откуда в темноте радуга» — обучающий, по симулятору Prism Rail (сценарий — video/SCRIPT-refraction.md).
 * Сцена: shots(lt, env) — что снимает 3D-камера симулятора, look — как положить кадр (фильтр,
 * прозрачность), draw(ctx, lt, env) — чертежи мелом, формулы, подписи поверх.
 * Камера и движение тележки — в долях длительности сцены (растягиваются под голос), события —
 * от реплик: env.cue(k).t0 / .t1 (секунды сцены). Из тех же моментов — звуки (sfx).
 *
 * Чертежи — в дизайн-координатах кадра 1920×1080 (overlay.px), экранные: x вправо, y вниз.
 * 3D — координаты симулятора: 1 = 1 м, y вверх, центр комнаты — (0, 0, 0). */
import { memo } from '../../lib/engine.js';
import {
  C, E, angle, board, chalk, clamp, deg, fade, formula, hand, lerp, morph, plate, px, ray, rgb, scrim, seg, shown,
  spectrumBar, title, wl, wlCss,
} from '../../lib/overlay.js';
import { beside, blend, overview } from '../../lib/rigs.js';
import I18N from './i18n.js';

// ---------------------------------------------------------------- сцена симулятора
const CODE = 'clover.300.spectrum.40.10.lumen-482'; // пресет «Референс»
const SIM = { code: CODE, smoke: 0.45, intensity: 1, bloom: 1.15, grain: 0.5, cone: 14, pitch: -1, yaw: 0, front: true, scan: false, quality: 'high' };
const SPEED = 0.25; // м/с — как в симуляторе по умолчанию
const S_HOOK = 2.2; // откуда тележка стартует в первой сцене, м пути

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const norm3 = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const cam = (pos, target, fov = 50) => ({ pos, target, fov });

/** Одно стекло для сцен 2–3: крупное, ярко в луче близко к тележке, отражённый блик рядом на полу,
 * и чуть дальше по пути оно всё ещё в луче, но под другим углом (цвет плывёт).
 * Перебор пути тележки один раз (memo) — детерминированно, сцена всегда одна и та же. */
const GLASS_DS = 0.07; // м — насколько тележка проезжает дальше в сцене 2
function pickGlass(sim) {
  return memo('glass-pick', () => {
    const L = sim.length(CODE);
    let best = null;
    for (let s = 0; s < L; s += 0.03) {
      for (const h of sim.hits({ ...SIM, s }, 6)) {
        const g = sim.glass(h.gi);
        const dr = dist3(h.o, h.reflHit);
        if (h.reflGlass >= 0 || h.reflHit[1] > 0.01 || dr < 0.25 || dr > 0.9) continue;
        if (g.h < 0.35 || h.dist < 0.2 || h.dist > 0.5 || h.b < 0.85) continue;
        if (h.theta < 38 || h.theta > 55 || h.l0 < 540 || h.l0 > 640) continue;
        const later = sim.hits({ ...SIM, s: s + GLASS_DS }, 12).find((x) => x.gi === h.gi);
        if (!later || later.b < 0.4 || Math.abs(later.theta - h.theta) < 12) continue;
        const score = h.b * g.h * (1 - Math.abs(h.theta - 46) / 30);
        if (!best || score > best.score) best = { score, s, gi: h.gi, hit: h, later };
      }
    }
    if (!best) throw new Error('не нашлось стекла для сцены «Одно стекло» — поменяйте CODE или условия pickGlass');
    return best;
  });
}
/** путь тележки в сцене 2: подъезжает к стеклу, потом чуть дальше — угол меняется */
function glassS(pk, lt, env) {
  const k1 = E.inOut(seg(lt, 0, env.cue(0).t0 + 0.5));
  const k2 = E.inOut(seg(lt, env.cue(3).t0, env.cue(3).t1));
  return pk.s - 0.06 * (1 - k1) + GLASS_DS * k2;
}
/** камера со стороны прожектора, чуть сверху: видно лицо стекла, падающий и отражённый лучи,
 * прошедший уходит сквозь стекло дальше */
function glassCam(sim, pk) {
  return memo('glass-cam', () => {
    const h = pk.hit;
    let nl = norm3([h.n[0], 0, h.n[2]]);
    if (nl[0] * h.d[0] + nl[2] * h.d[2] > 0) nl = nl.map((x) => -x); // к прожектору
    const r = norm3([h.r[0], 0, h.r[2]]);
    const d = norm3([h.d[0], 0, h.d[2]]);
    const mid = norm3([d[0] + r[0], 0, d[2] + r[2]]);
    const pos = [h.o[0] + nl[0] * 0.42 - mid[0] * 0.22, 0.78, h.o[2] + nl[2] * 0.42 - mid[2] * 0.22];
    const target = [h.o[0] + mid[0] * 0.1 + nl[0] * 0.08, 0.0, h.o[2] + mid[2] * 0.1 + nl[2] * 0.08];
    return cam(pos, target, 55);
  });
}
/** куда показывать подписи: отражённый блик (если рядом) и точка на прошедшем луче */
const reflAt = (h) => (dist3(h.o, h.reflEnd) < 1 ? h.reflEnd : h.o.map((v, i) => v + h.r[i] * 0.4));
const transAt = (h) => h.o.map((v, i) => v + h.d[i] * 0.45);

// ---------------------------------------------------------------- геометрия чертежей (дизайн 1920×1080)
/* преломление: граница y = 600, точка падения O; углы — от нормали */
const O = [600, 600];
const RAY = 430;
const sinv = (x) => Math.asin(clamp(x, -1, 1));
function snell(t1, n2 = 1.5) {
  const t2 = sinv(Math.sin(t1) / n2);
  return {
    t1, t2,
    inc: [[O[0] - Math.sin(t1) * RAY, O[1] - Math.cos(t1) * RAY], O],
    refl: [O, [O[0] + Math.sin(t1) * RAY * 0.7, O[1] - Math.cos(t1) * RAY * 0.7]],
    refr: [O, [O[0] + Math.sin(t2) * RAY, O[1] + Math.cos(t2) * RAY]],
  };
}
const BOUND = [[110, 600], [1090, 600]];

/* призма: равносторонняя, вершиной вверх */
const PR = { c: [560, 600], s: 470 };
const prH = (PR.s * Math.sqrt(3)) / 2;
const PA = [PR.c[0], PR.c[1] - (prH * 2) / 3];
const PB = [PR.c[0] - PR.s / 2, PR.c[1] + prH / 3];
const PC = [PR.c[0] + PR.s / 2, PR.c[1] + prH / 3];
/** BK7 (Коши): n = A + B/λ², λ в мкм; на рисунке разброс увеличен ×5 */
const nBK7 = (l) => 1.5046 + 0.0042 / (l / 1000) ** 2;
const nDraw = (l) => 1.52 + 5 * (nBK7(l) - nBK7(550));
function refract2(d, n, eta) {
  const ci = -(d[0] * n[0] + d[1] * n[1]);
  const k = 1 - eta * eta * (1 - ci * ci);
  if (k < 0) return null;
  const s = eta * ci - Math.sqrt(k);
  return [eta * d[0] + s * n[0], eta * d[1] + s * n[1]];
}
function hitSeg(p, d, a, b) {
  const ex = b[0] - a[0]; const ey = b[1] - a[1];
  const den = d[0] * ey - d[1] * ex;
  if (Math.abs(den) < 1e-9) return null;
  const wx = a[0] - p[0]; const wy = a[1] - p[1];
  const t = (wx * ey - wy * ex) / den;
  const s = (wx * d[1] - wy * d[0]) / den;
  return t > 1e-6 && s >= 0 && s <= 1 ? [p[0] + d[0] * t, p[1] + d[1] * t] : null;
}
const unit2 = (v) => { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; };
/** ход луча через призму для длины волны l: [вход, точка на левой грани, точка на правой, конец] */
const prismPath = (l) => memo(`prism|${l}`, () => {
  const nOut = unit2([PA[1] - PB[1], -(PA[0] - PB[0])]); // наружная нормаль левой грани (влево-вверх)
  const E0 = [lerp(PB[0], PA[0], 0.5), lerp(PB[1], PA[1], 0.5)];
  const inc = deg(48); // угол падения ≈ минимальное отклонение
  const ang = Math.atan2(-nOut[1], -nOut[0]) - inc; // направление луча: −нормаль, повёрнутое на inc
  const d0 = [Math.cos(ang), Math.sin(ang)];
  const start = [E0[0] - d0[0] * 520, E0[1] - d0[1] * 520];
  const n = nDraw(l);
  const t = refract2(d0, nOut, 1 / n);
  const P2 = hitSeg(E0, t, PA, PC);
  const nOut2 = unit2([PC[1] - PA[1], -(PC[0] - PA[0])]); // наружная нормаль правой грани
  const ex = refract2(t, [-nOut2[0], -nOut2[1]], n);
  return { start, E0, P2, end: [P2[0] + ex[0] * 560, P2[1] + ex[1] * 560], d0 };
});
const SPECTRUM = [410, 450, 480, 520, 560, 590, 620, 660];
/** цвет длины волны, высветленный — для подписей на тёмно-синем */
const light = (l) => rgb(wl(l).map((x) => 0.4 + 0.6 * x));

/* капля: луч входит, преломляется, отражается от задней стенки, выходит */
const DROP = { c: [780, 400], r: 220 };
function dropPath(n) {
  const nb = 1.337;
  const ci = Math.sqrt((nb * nb - 1) / 3);
  const si = Math.sqrt(1 - ci * ci);
  const P1n = [-ci, -si];
  const t = refract2([1, 0], P1n, 1 / n);
  const ch = -2 * (P1n[0] * t[0] + P1n[1] * t[1]);
  const P2n = [P1n[0] + t[0] * ch, P1n[1] + t[1] * ch];
  const dn = t[0] * P2n[0] + t[1] * P2n[1];
  const r = [t[0] - 2 * dn * P2n[0], t[1] - 2 * dn * P2n[1]];
  const ch2 = -2 * (P2n[0] * r[0] + P2n[1] * r[1]);
  const P3n = [P2n[0] + r[0] * ch2, P2n[1] + r[1] * ch2];
  const e = refract2(r, [-P3n[0], -P3n[1]], n);
  const at = (q) => [DROP.c[0] + q[0] * DROP.r, DROP.c[1] + q[1] * DROP.r];
  const P3 = at(P3n);
  return { P1: at(P1n), P2: at(P2n), P3, out: [P3[0] + e[0] * 560, P3[1] + e[1] * 560], e, dev: Math.acos(-e[0]) };
}

/* дихроичное стекло в разрезе */
const DG = { x0: 200, x1: 1120, top: 560, layers: 8, lh: 6, sub: 130 };
const DO = [600, DG.top];
const L0 = 620; // λ₀ стекла на чертеже: красное
const lpeak = (l0, th, n = 1.6) => l0 * Math.sqrt(1 - (Math.sin(th) / n) ** 2);
function complement(c) {
  const t = c.map((x) => 1 - x * 0.92);
  const m = Math.max(...t, 1e-4);
  return t.map((x) => x / m);
}

/** Сцена 8: какое стекло подписывать в момент lt (сетка 0,1 с). Углы до 60° — дальше модель
 * уводит пик в ультрафиолет. Чистая функция длительности сцены (memo) — кадры повторяются. */
/** откуда тележка едет в сцене 8: отрезок трассы ~5 м, где стёкла чаще всего попадают в луч */
function sBack(sim) {
  return memo('back-s', () => {
    const L = sim.length(CODE);
    const step = 0.1;
    const lit = [];
    for (let s = 0; s < L; s += step) lit.push(sim.hits({ ...SIM, s }, 12).some((x) => x.theta < 60 && x.b > 0.45) ? 1 : 0);
    const win = Math.round(5 / step);
    let best = 0; let bestSum = -1;
    for (let i = 0; i < lit.length; i++) {
      let sum = 0;
      for (let k = 0; k < win; k++) sum += lit[(i + k) % lit.length];
      if (sum > bestSum) { bestSum = sum; best = i; }
    }
    return best * step;
  });
}
function backPick(env) {
  const S0 = sBack(env.sim);
  return memo(`back-pick|${env.dur}`, () => {
    const out = [];
    let cur = -1;
    for (let i = 0; i <= Math.round(env.dur / 0.1); i++) {
      const list = env.sim.hits({ ...SIM, s: S0 + i * 0.1 * SPEED }, 12).filter((x) => x.theta < 60);
      let h = list.find((x) => x.gi === cur && x.b > 0.2);
      if (!h) { h = list.find((x) => x.b > 0.45) ?? null; cur = h ? h.gi : -1; }
      out.push(h);
    }
    // короткие провалы (< 0,6 с) заполняем предыдущим стеклом — плашка не мигает
    for (let i = 1; i < out.length; i++) if (!out[i] && out.slice(i, i + 6).some(Boolean)) out[i] = out[i - 1];
    return out;
  });
}

// ---------------------------------------------------------------- сцены
const SCENES = [
  {
    id: 'hook', dur: 12, xf: 0,
    shots(lt, env) {
      const s = S_HOOK + lt * SPEED;
      const k = E.inOut(lt / env.dur);
      const a = beside(env.sim, CODE, s, { side: -1, dist: 0.4, back: 0.2, y: 0.075 });
      const b = beside(env.sim, CODE, s, { side: -1, dist: 0.62, back: 0.5, y: 0.16, ahead: 0.6 });
      return [{ state: { ...SIM, s, time: lt, speed: SPEED, cam: blend(a, b, k) } }];
    },
    draw(ctx, lt, env) {
      const p = shown(lt, env.cue(0).t1 + 0.2, env.dur - 0.2, 0.8);
      scrim(ctx, env, p, 0.5);
      title(ctx, env, env.T.hook, p);
      fade(ctx, env, '#000', 1 - seg(lt, 0, 1.6));
    },
    sfx: (c) => [[0.2, 'swell', 3], [c.cue(0).t1 + 0.2, 'chime']],
  },
  {
    id: 'glass', dur: 10, tail: 1.2,
    shots(lt, env) {
      const pk = pickGlass(env.sim);
      const s = glassS(pk, lt, env);
      return [{ state: { ...SIM, s, time: 20 + lt, speed: 0.06, cam: glassCam(env.sim, pk) } }];
    },
    draw(ctx, lt, env) {
      const pk = pickGlass(env.sim);
      const T = env.T.glass;
      const s = glassS(pk, lt, env);
      const h = env.sim.hits({ ...SIM, s }, 32).find((x) => x.gi === pk.gi);
      if (!h) return;
      const on = shown(lt, env.cue(1).t0, Infinity, 0.6);
      const label = (to, text, color, dx, dy, p) => {
        const P = env.at(to);
        if (!P?.front) return;
        const x = 960 + (P.x - env.W / 2) / env.u;
        const y = 540 + (P.y - env.H / 2) / env.u;
        chalk(ctx, env, [[x + dx * 0.82, y + dy * 0.82 + 10], [x + dx * 0.1, y + dy * 0.1]], E.out(seg(p, 0, 0.6)), { color, width: 3.5, glow: 10, arrow: true, head: false });
        hand(ctx, env, text, x + dx, y + dy, seg(p, 0.3, 1), { color, size: 64, align: dx < 0 ? 'right' : 'left' });
      };
      label(reflAt(h), T.refl, rgb(h.cr.map((x) => 0.35 + 0.65 * x)), -200, -110, on);
      label(transAt(h), T.trans, rgb(h.ct.map((x) => 0.35 + 0.65 * x)), 170, -120, shown(lt, env.cue(1).t0 + 1.4, Infinity, 0.6));
      const pa = shown(lt, env.cue(3).t0 + 0.4, Infinity, 0.6);
      const G = env.at([h.o[0], h.o[1] + 0.12, h.o[2]]);
      if (G?.front) hand(ctx, env, T.angle, 960 + (G.x - env.W / 2) / env.u + 60, 540 + (G.y - env.H / 2) / env.u - 120, pa, { size: 56, color: C.warm });
    },
    sfx: (c) => [[c.cue(0).t0 + 0.4, 'bell', 2], [c.cue(1).t0, 'draw', 0.7], [c.cue(1).t0 + 1.4, 'draw', 0.7], [c.cue(3).t0 + 0.4, 'draw', 0.9]],
  },
  {
    // стоп-кадр: кадр замирает, гаснет, линии обводят стекло и лучи и перетекают в чертёж
    id: 'freeze', dur: 7.6, xf: 0,
    shots(lt, env) {
      const pk = pickGlass(env.sim);
      const s = pk.s + GLASS_DS; // кадр, на котором закончилась сцена 2
      return [{ state: { ...SIM, s, time: 20 + env.chapters[1].dur, speed: 0.06, cam: glassCam(env.sim, pk) } }];
    },
    look(lt) {
      const k = E.inOut(seg(lt, 0.1, 2.2));
      return { filter: `saturate(${1 - 0.85 * k}) brightness(${1 - 0.7 * k})`, alpha: 1 - E.inOut(seg(lt, 4.2, 5.4)) };
    },
    draw(ctx, lt, env) {
      const pk = pickGlass(env.sim);
      const h = env.sim.hits({ ...SIM, s: pk.s + GLASS_DS }, 32).find((x) => x.gi === pk.gi) ?? pk.hit;
      const g = env.sim.glass(pk.gi);
      const light = h.o.map((v, i) => v - h.d[i] * h.dist);
      const P = (p) => env.at(p);
      // контуры по настоящей геометрии (в пикселях) → схема преломления
      board(ctx, env, E.inOut(seg(lt, 4.0, 5.6)));
      const draw = E.inOut(seg(lt, 0.9, 3.4));
      const mk = seg(lt, 5.0, 7.4);
      const sch = snell(deg(50));
      const toPx = (pts) => pts.map(([x, y]) => px(env, x, y));
      const pairs = [
        { a: [...g.verts, g.verts[0]].map(P), b: toPx([BOUND[0], BOUND[1], BOUND[0]]), color: C.dim, w: 3 },
        { a: [P(light), P(h.o)], b: toPx(sch.inc), color: '#fff', w: 5, ray: true },
        { a: [P(h.o), P(reflAt(h))], b: toPx(sch.refl), color: rgb(h.cr.map((x) => 0.4 + 0.6 * x)), w: 4, ray: true, to: 'rgba(255,255,255,.45)' },
        { a: [P(h.o), P(transAt(h).map((v, i) => v + h.d[i] * 0.5))], b: toPx(sch.refr), color: rgb(h.ct.map((x) => 0.4 + 0.6 * x)), w: 4, ray: true, to: '#fff' },
      ];
      for (const q of pairs) {
        if (q.a.some((p) => !p?.front)) continue;
        const pts = mk > 0 ? morph(q.a, q.b, mk) : q.a;
        const color = mk > 0.5 && q.to ? q.to : q.color;
        if (q.ray) ray(ctx, env, pts, draw, color, { width: q.w, arrow: false });
        else chalk(ctx, env, pts, draw, { color: mk > 0.5 ? C.chalk : '#fff', width: q.w, glow: 12 });
      }
    },
    sfx: () => [[0.1, 'freeze'], [0.9, 'draw', 2.4], [5.0, 'whoosh']],
  },
  {
    id: 'snell', dur: 10, xf: 0, tail: 1.6,
    draw(ctx, lt, env) {
      const T = env.T.snell;
      board(ctx, env);
      const c = (k) => env.cue(k);
      // угол падения: 50°, потом качается, пока объясняем закон; n₂: 1,5 → алмаз 2,4 → 1,5
      const swing = seg(lt, c(2).t1 - 1, c(3).t0) * (1 - seg(lt, c(3).t0, c(3).t0 + 1));
      const t1 = deg(50 + 18 * Math.sin((lt - (c(2).t1 - 1)) * 0.9) * swing);
      const nd = E.inOut(seg(lt, c(3).t0 + 0.3, c(3).t0 + 1.8)) * (1 - E.inOut(seg(lt, c(4).t0 + 0.5, c(4).t0 + 2)));
      const n2 = lerp(1.5, 2.4, nd);
      const S = snell(t1, n2);
      // стекло: полупрозрачная заливка ниже границы
      const gp = shown(lt, 0, Infinity, 0.8);
      ctx.save();
      ctx.globalAlpha = gp;
      const a = px(env, BOUND[0][0], 600);
      const b = px(env, BOUND[1][0], 930);
      const grd = ctx.createLinearGradient(0, a.y, 0, b.y);
      grd.addColorStop(0, `rgba(120, 170, 255, ${0.16 + 0.12 * nd})`);
      grd.addColorStop(1, 'rgba(120, 170, 255, 0)');
      ctx.fillStyle = grd;
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.restore();
      chalk(ctx, env, BOUND, 1, { color: C.dim, width: 3 });
      hand(ctx, env, T.air, 140, 565, gp, { color: C.dim, size: 56 });
      hand(ctx, env, nd > 0.5 ? T.diamond : T.glass, 140, 680, gp, { color: nd > 0.5 ? C.warm : C.dim, size: 56 });
      // нормаль
      chalk(ctx, env, [[O[0], 280], [O[0], 920]], E.out(seg(lt, 0.3, 1.6)), { color: C.dim, width: 2.5, dash: [16, 14], glow: 4, head: false });
      hand(ctx, env, T.normal, O[0] + 18, 315, shown(lt, 1.2), { color: C.dim, size: 48 });
      // лучи
      ray(ctx, env, S.inc, 1, '#fff');
      ray(ctx, env, S.refl, 1, 'rgba(255,255,255,.4)', { width: 3, alpha: 0.6 });
      ray(ctx, env, S.refr, 1, '#fff');
      // скорость: «бусины» бегут по лучу — в стекле медленнее и ближе друг к другу
      const pv = shown(lt, c(0).t0 + 0.6, c(1).t1 + 0.6, 0.5);
      if (pv > 0) {
        const bead = (A, B, v, ph) => {
          const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
          for (let k = 0; k < 12; k++) {
            const d = ((lt * v + ph + k * v * 0.55) % (v * 0.55 * 12));
            if (d > L) continue;
            const q = px(env, A[0] + ((B[0] - A[0]) * d) / L, A[1] + ((B[1] - A[1]) * d) / L);
            ctx.save();
            ctx.globalAlpha = pv;
            ctx.fillStyle = '#fff';
            ctx.shadowColor = '#9ab4ff';
            ctx.shadowBlur = 18 * env.u;
            ctx.beginPath();
            ctx.arc(q.x, q.y, 6 * env.u, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        };
        bead(S.inc[0], S.inc[1], 240, 0);
        bead(S.refr[0], S.refr[1], 160, 0);
        hand(ctx, env, T.slow, 150, 800, pv, { color: '#bcd0ff', size: 54 });
      }
      // углы
      const pa = shown(lt, c(2).t0 + 0.3);
      angle(ctx, env, O, -Math.PI / 2 - S.t1, -Math.PI / 2, 120, 'θ_1', pa, { size: 50 });
      angle(ctx, env, O, Math.PI / 2 - S.t2, Math.PI / 2, 120, 'θ_2', shown(lt, c(2).t0 + 1.2), { size: 50 });
      // формула и числа справа
      const pf = seg(lt, c(2).t0 + 0.2, c(2).t0 + 3.2);
      formula(ctx, env, 'n_1 · sin θ_1 = n_2 · sin θ_2', 1160, 380, { size: 60 }, pf);
      formula(ctx, env, `n_1 = 1,00   n_2 = ${n2.toFixed(2).replace('.', ',')}`, 1170, 470, { size: 44, color: C.dim }, shown(lt, c(2).t0 + 2.6, Infinity, 0.6));
      const pn = shown(lt, c(2).t1 - 1.2, Infinity, 0.6);
      const f0 = (x) => `${Math.round((x * 180) / Math.PI)}°`;
      formula(ctx, env, `θ_1 = ${f0(S.t1)}   θ_2 = ${f0(S.t2)}`, 1170, 550, { size: 44, color: '#bcd0ff' }, pn);
      // n = c / v
      const pc = seg(lt, c(4).t0 + 1.2, c(4).t0 + 3.0);
      formula(ctx, env, T.cv, 1170, 720, { size: 64, color: C.warm }, pc);
      hand(ctx, env, T.cvNote, 1174, 795, shown(lt, c(4).t0 + 2.6), { color: C.dim, size: 48 });
    },
    sfx: (c) => [[0.3, 'draw', 1.3], [c.cue(0).t0 + 0.6, 'tick', 0], [c.cue(2).t0 + 0.2, 'draw', 3], [c.cue(3).t0 + 0.3, 'ping'],
      [c.cue(4).t0 + 1.2, 'draw', 1.8]],
  },
  {
    id: 'dispersion', dur: 10, xf: 0.8, tail: 2,
    draw(ctx, lt, env) {
      const T = env.T.disp;
      const c = (k) => env.cue(k);
      board(ctx, env);
      // призма
      const pp = E.inOut(seg(lt, 0.2, 1.6));
      ctx.save();
      ctx.globalAlpha = pp * 0.9;
      const [a, b, cc] = [PA, PB, PC].map(([x, y]) => px(env, x, y));
      const gr = ctx.createLinearGradient(b.x, a.y, cc.x, b.y);
      gr.addColorStop(0, 'rgba(140, 190, 255, .16)');
      gr.addColorStop(1, 'rgba(140, 190, 255, .04)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(cc.x, cc.y); ctx.closePath(); ctx.fill();
      ctx.restore();
      chalk(ctx, env, [PA, PB, PC, PA], pp, { color: C.chalk, width: 3.5, glow: 12 });
      // белый луч до призмы
      const p0 = prismPath(550);
      ray(ctx, env, [p0.start, p0.E0], E.inOut(seg(lt, c(0).t0 + 0.2, c(0).t1)), '#fff', { arrow: false });
      // без дисперсии — один луч (пока вопрос), потом — веер
      const fan = E.inOut(seg(lt, c(2).t0 + 1.0, c(2).t1 - 0.5));
      const single = seg(lt, c(0).t1 - 0.6, c(0).t1 + 0.4) * (1 - fan);
      if (single > 0) {
        const q = prismPath(550);
        ray(ctx, env, [q.E0, q.P2, q.end], single, '#fff', { alpha: 1 - fan });
      }
      if (fan > 0) {
        // заливка веера: от фиолетового до красного
        const v = prismPath(SPECTRUM[0]);
        const r = prismPath(SPECTRUM.at(-1));
        ctx.save();
        ctx.globalAlpha = 0.35 * fan;
        const A = px(env, ...v.P2); const Bv = px(env, ...v.end); const Br = px(env, ...r.end); const Ar = px(env, ...r.P2);
        const gg = ctx.createLinearGradient(Bv.x, Bv.y, Br.x, Br.y);
        SPECTRUM.forEach((l, i) => gg.addColorStop(i / (SPECTRUM.length - 1), wlCss(l)));
        ctx.fillStyle = gg;
        ctx.filter = `blur(${10 * env.u}px)`;
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(Bv.x, Bv.y); ctx.lineTo(Br.x, Br.y); ctx.lineTo(Ar.x, Ar.y); ctx.closePath(); ctx.fill();
        ctx.restore();
        for (const l of SPECTRUM) {
          const q = prismPath(l);
          ray(ctx, env, [q.E0, q.P2, q.end], fan, wlCss(l), { width: 3.2, arrow: false });
        }
      }
      // график n(λ)
      const pg = shown(lt, c(1).t0 + 0.4, Infinity, 0.6);
      if (pg > 0) {
        const gx = 1250; const gy = 150; const gw = 520; const gh = 250;
        const X = (l) => gx + ((l - 400) / 300) * gw;
        const Y = (n) => gy + gh - ((n - 1.505) / 0.03) * gh;
        chalk(ctx, env, [[gx, gy - 10], [gx, gy + gh], [gx + gw + 10, gy + gh]], pg, { color: C.dim, width: 2.5, glow: 4, head: false });
        hand(ctx, env, T.graph, gx, gy - 30, pg, { color: C.dim, size: 44 });
        formula(ctx, env, 'λ', gx + gw + 20, gy + gh + 12, { size: 40, color: C.dim }, pg);
        const pts = [];
        for (let l = 400; l <= 700; l += 10) pts.push([X(l), Y(nBK7(l))]);
        const pc = E.inOut(seg(lt, c(1).t0 + 0.8, c(1).t0 + 3.2));
        for (let i = 0; i < pts.length - 1; i++) {
          const k = clamp(pc * (pts.length - 1) - i);
          if (k > 0) chalk(ctx, env, [pts[i], [lerp(pts[i][0], pts[i + 1][0], k), lerp(pts[i][1], pts[i + 1][1], k)]], 1, { color: wlCss(400 + i * 10), width: 5, glow: 12, head: false });
        }
        hand(ctx, env, T.blue, X(430) + 14, Y(nBK7(430)) - 20, shown(lt, c(1).t0 + 2.6), { color: light(460), size: 44 });
        hand(ctx, env, T.red, X(540), Y(nBK7(660)) - 34, shown(lt, c(1).t0 + 3.6), { color: light(640), size: 44 });
        formula(ctx, env, 'n = n(λ)', 1260, 530, { size: 64 }, seg(lt, c(1).t1 - 1.6, c(1).t1));
      }
      hand(ctx, env, T.newton, 1264, 615, shown(lt, c(3).t0 + 0.2), { color: C.warm, size: 54 });
      formula(ctx, env, T.word, 1260, 720, { size: 66, color: '#fff' }, seg(lt, c(4).t0 + 0.8, c(4).t0 + 2.6));
      hand(ctx, env, T.exag, 1264, 785, shown(lt, c(4).t0 + 4), { color: C.dim, size: 42 });
    },
    sfx: (c) => [[0.2, 'draw', 1.4], [c.cue(1).t0 + 0.8, 'draw', 2.4], [c.cue(2).t0 + 1, 'sparkle', 0], [c.cue(2).t0 + 1.6, 'sparkle', 2],
      [c.cue(4).t0 + 0.8, 'draw', 1.8]],
  },
  {
    id: 'rainbow', dur: 10, xf: 0.8, tail: 3,
    draw(ctx, lt, env) {
      const T = env.T.rain;
      const c = (k) => env.cue(k);
      board(ctx, env);
      // часть 1 — капля крупно; часть 2 — она уезжает в угол, рисуется радуга над горизонтом
      const out = E.inOut(seg(lt, c(3).t0 - 0.4, c(3).t0 + 1.2));
      ctx.save();
      const piv = px(env, 120, 90);
      ctx.translate(piv.x, piv.y);
      ctx.scale(1 - 0.62 * out, 1 - 0.62 * out);
      ctx.translate(-piv.x, -piv.y);
      ctx.globalAlpha = 1 - 0.35 * out;
      const pd = E.inOut(seg(lt, 0.2, 1.8));
      const circ = [];
      for (let i = 0; i <= 72; i++) circ.push([DROP.c[0] + Math.cos((i / 72) * Math.PI * 2 - 2.2) * DROP.r, DROP.c[1] + Math.sin((i / 72) * Math.PI * 2 - 2.2) * DROP.r]);
      chalk(ctx, env, circ, pd, { color: '#9cc8ff', width: 3.5, glow: 14 });
      hand(ctx, env, T.drop, DROP.c[0] + DROP.r + 30, DROP.c[1] + 80, shown(lt, 1.4), { color: C.dim, size: 50 });
      // путь: вход — отражение — выход, по частям второй реплики
      const R = dropPath(1.331); const V = dropPath(1.343);
      const t0 = c(1).t0; const t1 = c(1).t1; const step = (t1 - t0) / 3;
      ray(ctx, env, [[60, R.P1[1]], R.P1], E.inOut(seg(lt, c(0).t0 + 0.4, c(0).t1)), '#fff', { arrow: false });
      hand(ctx, env, T.inSun, 70, R.P1[1] - 26, shown(lt, c(0).t0 + 0.8), { color: C.warm, size: 50 });
      const split = E.inOut(seg(lt, c(2).t0, c(2).t0 + 1.2));
      // внутри капли цвета почти совпадают — рисуем общий путь, а на выходе веер расходится
      const M = dropPath(1.337);
      ray(ctx, env, [M.P1, M.P2], E.inOut(seg(lt, t0 + 0.2, t0 + step)), '#fff', { width: 3.4, arrow: false });
      ray(ctx, env, [M.P2, M.P3], E.inOut(seg(lt, t0 + step, t0 + 2 * step)), '#fff', { width: 3.4, arrow: false });
      const pe = E.inOut(seg(lt, t0 + 2 * step, t1));
      if (split < 1) ray(ctx, env, [M.P3, M.out], pe, '#fff', { width: 3.4, alpha: 1 - split });
      // веер выхода: углы между цветами на рисунке разведены ×4 (настоящая разница — 2°)
      const fanDir = (l) => {
        const k = (l - 410) / (650 - 410);
        const a = Math.PI - lerp(V.dev, R.dev, k);
        const mid = Math.PI - (V.dev + R.dev) / 2;
        const ae = mid + (a - mid) * 4;
        return [Math.cos(ae), Math.sin(ae)];
      };
      if (split > 0) for (const l of [650, 600, 570, 530, 470, 410]) { const e = fanDir(l); ray(ctx, env, [M.P3, [M.P3[0] + e[0] * 520, M.P3[1] + e[1] * 520]], pe, wlCss(l), { width: 3, alpha: split }); }
      hand(ctx, env, T.twice, DROP.c[0] + DROP.r + 30, DROP.c[1] - 40, shown(lt, t1 - 0.6), { color: C.dim, size: 48 });
      // углы от направления «назад к солнцу»
      const pa = shown(lt, c(2).t0 + 1.0);
      if (pa > 0) {
        const M3 = dropPath(1.337).P3;
        chalk(ctx, env, [M3, [M3[0] - 560, M3[1]]], pa, { color: C.dim, width: 2.2, dash: [12, 12], glow: 4, head: false });
        const spread = (dv) => Math.PI - ((V.dev + R.dev) / 2 + (dv - (V.dev + R.dev) / 2) * 4);
        angle(ctx, env, M3, spread(R.dev), Math.PI, 380, '42°', pa, { color: light(650), size: 48, off: 1.12 });
        angle(ctx, env, M3, spread(V.dev), Math.PI, 250, '40°', shown(lt, c(2).t0 + 2.2), { color: light(420), size: 48, off: 1.2 });
        hand(ctx, env, T.exag, M3[0] - 560, M3[1] - 22, shown(lt, c(2).t0 + 3), { color: C.dim, size: 38 });
      }
      ctx.restore();
      // радуга над горизонтом
      const pr = seg(lt, c(3).t0 + 0.4, c(3).t1 + 0.6);
      if (pr > 0) {
        const hz = 860;
        chalk(ctx, env, [[120, hz], [1800, hz]], E.inOut(seg(pr, 0, 0.3)), { color: C.dim, width: 2.5, glow: 4, head: false });
        const bands = [650, 610, 580, 550, 500, 460, 420];
        bands.forEach((l, i) => {
          const r0 = 560 - i * 15;
          const pts = [];
          for (let k = 0; k <= 60; k++) { const a = Math.PI + (k / 60) * Math.PI; pts.push([960 + Math.cos(a) * r0, hz + 40 + Math.sin(a) * r0]); }
          const clip = pts.filter((q) => q[1] <= hz);
          chalk(ctx, env, clip, E.inOut(seg(pr, 0.15 + i * 0.04, 0.75 + i * 0.04)), { color: wlCss(l), width: 10, glow: 18, head: false, alpha: 0.85 });
        });
        hand(ctx, env, T.outside, 1330, 330, shown(lt, c(3).t0 + 2.2), { color: light(650), size: 56 });
        // наблюдатель со спины
        const ob = E.out(seg(pr, 0.5, 0.9));
        chalk(ctx, env, [[960, hz - 10], [960, hz - 62]], ob, { color: C.chalk, width: 4, glow: 6, head: false });
        const head = [];
        for (let k = 0; k <= 24; k++) head.push([960 + Math.cos((k / 24) * Math.PI * 2) * 14, hz - 80 + Math.sin((k / 24) * Math.PI * 2) * 14]);
        chalk(ctx, env, head, ob, { color: C.chalk, width: 4, glow: 6, head: false });
        hand(ctx, env, T.sun, 1010, hz + 76, shown(lt, c(3).t0 + 3.2), { color: C.warm, size: 50 });
      }
    },
    sfx: (c) => [[0.2, 'draw', 1.6], [c.cue(1).t0, 'draw', c.cue(1).t1 - c.cue(1).t0], [c.cue(2).t0, 'sparkle', 1], [c.cue(3).t0 + 0.4, 'swell', 2.5]],
  },
  {
    id: 'dichroic', dur: 10, xf: 0.8, tail: 2.6,
    draw(ctx, lt, env) {
      const T = env.T.dichro;
      const c = (k) => env.cue(k);
      board(ctx, env);
      // угол: 35°, во второй половине — качается 10…60°
      const sw = seg(lt, c(4).t0, c(5).t1);
      const th = deg(sw > 0 ? 35 + 25 * Math.sin((lt - c(4).t0) * 0.55) : 35);
      const lp = lpeak(L0, th);
      const rc = wl(lp);
      const tc = complement(rc);
      // стекло: подложка и слои покрытия
      const pg = E.inOut(seg(lt, 0.2, 1.6));
      ctx.save();
      ctx.globalAlpha = pg;
      const s0 = px(env, DG.x0, DG.top); const s1 = px(env, DG.x1, DG.top + DG.layers * DG.lh + DG.sub);
      ctx.fillStyle = 'rgba(140, 190, 255, .10)';
      ctx.fillRect(s0.x, s0.y, s1.x - s0.x, s1.y - s0.y);
      for (let i = 0; i < DG.layers; i++) {
        ctx.fillStyle = i % 2 ? 'rgba(170, 200, 255, .30)' : 'rgba(255, 210, 170, .22)';
        const y = px(env, 0, DG.top + i * DG.lh).y;
        ctx.fillRect(s0.x, y, s1.x - s0.x, DG.lh * env.u * 0.8);
      }
      ctx.restore();
      chalk(ctx, env, [[DG.x0, DG.top], [DG.x1, DG.top], [DG.x1, DG.top + DG.layers * DG.lh + DG.sub], [DG.x0, DG.top + DG.layers * DG.lh + DG.sub], [DG.x0, DG.top]], pg, { color: C.dim, width: 2.5, glow: 6 });
      hand(ctx, env, T.layers, DG.x0 + 10, DG.top - 26, shown(lt, c(1).t0 + 0.6), { color: '#ffd9b0', size: 46 });
      // лучи
      const R = 440;
      const inc = [[DO[0] - Math.sin(th) * R, DO[1] - Math.cos(th) * R], DO];
      ray(ctx, env, inc, E.inOut(seg(lt, c(0).t0 + 0.6, c(0).t1)), '#fff', { arrow: false });
      const pr = E.inOut(seg(lt, c(1).t0 + 1.2, c(1).t0 + 3.4));
      // отражения от каждого слоя — параллельные тонкие лучи, складываются в один
      for (let i = DG.layers; i >= 1; i--) {
        const x0 = DO[0] + i * 2 * DG.lh * Math.tan(sinv(Math.sin(th) / 1.6));
        ray(ctx, env, [[x0, DO[1]], [x0 + Math.sin(th) * R * 0.85, DO[1] - Math.cos(th) * R * 0.85]], pr, rgb(rc, 0.9), { width: 1.6, arrow: false, alpha: 0.35 });
      }
      const pm = seg(lt, c(1).t0 + 2.6, c(2).t0 + 0.6);
      ray(ctx, env, [DO, [DO[0] + Math.sin(th) * R, DO[1] - Math.cos(th) * R]], pm, rgb(rc));
      // прошедший: преломился в подложке и вышел параллельно падающему
      const ts = sinv(Math.sin(th) / 1.5);
      const yb = DG.top + DG.layers * DG.lh + DG.sub;
      const pIn = [DO[0] + Math.tan(ts) * (yb - DO[1]), yb];
      const pOut = [pIn[0] + Math.sin(th) * 280, yb + Math.cos(th) * 280];
      const pt = seg(lt, c(2).t0 + 0.4, c(2).t0 + 2.6);
      ray(ctx, env, [DO, pIn, pOut], pt, rgb(tc));
      hand(ctx, env, T.refl, DO[0] + Math.sin(th) * R * 0.75 + 30, DO[1] - Math.cos(th) * R * 0.75, shown(lt, c(2).t0 + 0.2), { color: rgb(rc), size: 52 });
      hand(ctx, env, T.trans, pOut[0] + 24, pOut[1] - 20, shown(lt, c(2).t0 + 2.4), { color: rgb(tc.map((x) => 0.35 + 0.65 * x)), size: 52 });
      angle(ctx, env, DO, -Math.PI / 2 - th, -Math.PI / 2, 110, 'θ', shown(lt, c(3).t0 + 0.4), { size: 50 });
      chalk(ctx, env, [[DO[0], DO[1] - 300], [DO[0], DO[1]]], shown(lt, c(3).t0 + 0.2), { color: C.dim, width: 2.2, dash: [12, 12], glow: 4, head: false });
      // врезка: волны в фазе складываются
      const pw = shown(lt, c(1).t0 + 3.4, c(3).t0 + 0.4, 0.6);
      if (pw > 0) {
        const wave = (x, y, w, amp, ph, color, p) => {
          const pts = [];
          for (let k = 0; k <= 60; k++) pts.push([x + (k / 60) * w, y + Math.sin((k / 60) * Math.PI * 4 + ph) * amp]);
          chalk(ctx, env, pts, p, { color, width: 3, glow: 8, head: false, alpha: pw });
        };
        for (let k = 0; k < 3; k++) wave(1270, 210 + k * 46, 200, 16, 0, rgb(rc), E.out(seg(pw, 0.1 * k, 0.6 + 0.1 * k)));
        formula(ctx, env, '→', 1500, 268, { size: 60, color: C.dim }, pw);
        wave(1580, 256, 200, 46, 0, rgb(rc), E.out(seg(pw, 0.5, 1)));
        hand(ctx, env, T.sum, 1270, 384, pw, { color: C.dim, size: 46 });
      }
      // формула, шкала спектра, живые числа
      const pf = seg(lt, c(4).t1 - 2.2, c(4).t1 + 0.6);
      formula(ctx, env, 'λ_{пик} = λ_0 · \\sqrt{1 − (sin θ / n)^2}', 1200, 300, { size: 52 }, pf);
      const pb = shown(lt, c(4).t0 + 0.6, Infinity, 0.6);
      spectrumBar(ctx, env, 1250, 420, 560, 26, pb, lp);
      const f0 = (x) => Math.round(x);
      plate(ctx, env, 1250, 510, 560, 150, shown(lt, c(4).t0 + 1.2), () => {
        formula(ctx, env, `θ = ${f0((th * 180) / Math.PI)}°`, 1290, 580, { size: 50, color: '#fff' });
        formula(ctx, env, `λ_{пик} = ${f0(lp)} нм`, 1290, 638, { size: 44, color: rgb(rc) });
        const sw0 = px(env, 1700, 540);
        ctx.fillStyle = rgb(rc);
        ctx.shadowColor = rgb(rc);
        ctx.shadowBlur = 24 * env.u;
        ctx.beginPath(); ctx.arc(sw0.x, sw0.y + 40 * env.u, 40 * env.u, 0, Math.PI * 2); ctx.fill();
      });
      hand(ctx, env, T.shift, 1254, 745, shown(lt, c(5).t0 + 0.4), { color: C.warm, size: 54 });
      // в конце чертёж гаснет — переход обратно в комнату
      fade(ctx, env, '#000', seg(lt, env.dur - 1.2, env.dur));
    },
    sfx: (c) => [[0.2, 'draw', 1.4], [c.cue(1).t0 + 1.2, 'sparkle', 3], [c.cue(2).t0 + 0.4, 'draw', 2.2], [c.cue(4).t1 - 2.2, 'draw', 2.6],
      [c.cue(5).t0, 'bell', 1]],
  },
  {
    id: 'back', dur: 8, xf: 0.6, tail: 2.5,
    shots(lt, env) {
      const s = sBack(env.sim) + lt * SPEED;
      const k = E.inOut(lt / env.dur);
      const a = beside(env.sim, CODE, s, { side: -1, dist: 0.55, back: 0.25, y: 0.2, ahead: 0.7 });
      const b = beside(env.sim, CODE, s, { side: -1, dist: 0.9, back: 0.7, y: 0.45, ahead: 0.9 });
      return [{ state: { ...SIM, s, time: 60 + lt, speed: SPEED, cam: blend(a, b, k) } }];
    },
    look(lt) {
      const k = E.inOut(seg(lt, 0, 1.6));
      return { filter: `brightness(${0.3 + 0.7 * k}) saturate(${0.2 + 0.8 * k})` };
    },
    draw(ctx, lt, env) {
      // живые числа для стекла в луче: держим его, пока светится, потом — следующее самое яркое
      const h = backPick(env)[Math.min(Math.floor(lt / 0.1), Math.round(env.dur / 0.1))];
      const p = shown(lt, 1.4, env.dur - 0.6, 0.6);
      if (!h || p <= 0) return;
      const rc = wl(h.lpeak);
      const g = env.at([h.o[0], Math.max(h.o[1], 0.06), h.o[2]]);
      if (g?.front) {
        const cx = 960 + (g.x - env.W / 2) / env.u;
        const cy = 540 + (g.y - env.H / 2) / env.u;
        const ring = [];
        for (let i = 0; i <= 40; i++) ring.push([cx + Math.cos((i / 40) * 6.4) * 46, cy + Math.sin((i / 40) * 6.4) * 46]);
        chalk(ctx, env, ring, p, { color: rgb(rc.map((x) => 0.4 + 0.6 * x)), width: 3, glow: 12, head: false });
      }
      plate(ctx, env, 90, 780, 540, 170, p, () => {
        formula(ctx, env, `θ = ${Math.round(h.theta)}°`, 130, 852, { size: 50, color: '#fff' });
        formula(ctx, env, `λ_{пик} = ${Math.round(h.lpeak)} нм`, 130, 912, { size: 44, color: rgb(rc.map((x) => 0.4 + 0.6 * x)) });
        const q = px(env, 560, 865);
        ctx.fillStyle = rgb(rc);
        ctx.shadowColor = rgb(rc);
        ctx.shadowBlur = 24 * env.u;
        ctx.beginPath(); ctx.arc(q.x, q.y, 36 * env.u, 0, Math.PI * 2); ctx.fill();
      });
    },
    sfx: (c) => [[0.2, 'whoosh'], [1.5, 'bell', 0], [4.5, 'bell', 3], [8, 'bell', 1]],
  },
  {
    id: 'end', dur: 8, xf: 0.8,
    shots(lt, env) {
      return [{ state: { ...SIM, s: sBack(env.sim) + 6 + lt * SPEED, time: 90 + lt, cam: overview(1.2 + lt * 0.03, { y: 2.6 }) } }];
    },
    draw(ctx, lt, env) {
      const T = env.T.end;
      const p = shown(lt, env.cue(0).t1 + 0.4, Infinity, 1.0);
      board(ctx, env, 0.94 * p);
      if (p <= 0) return;
      formula(ctx, env, T.title, 960, 330, { size: 120, align: 'center', color: '#fff' }, p);
      T.lines.forEach((l, i) => formula(ctx, env, l, 960, 470 + i * 100, { size: 54, align: 'center', color: i === 2 ? C.warm : C.chalk }, seg(lt, env.cue(0).t1 + 0.8 + i * 0.7, env.cue(0).t1 + 2.2 + i * 0.7)));
      hand(ctx, env, T.cta, 960, 870, shown(lt, env.cue(0).t1 + 3.2), { size: 54, align: 'center', color: '#bcd0ff' });
      hand(ctx, env, T.small, 960, 940, shown(lt, env.cue(0).t1 + 3.8), { size: 36, align: 'center', color: C.dim });
      fade(ctx, env, '#000', seg(lt, env.dur - 1.0, env.dur));
    },
    tail: 5.5,
    sfx: (c) => [[c.cue(0).t1 + 0.4, 'chime']],
  },
];

// ---------------------------------------------------------------- музыка: аккорд на сцену (MIDI), энергия — плотность арпеджио
const SCORE = [
  { pad: [62, 66, 69, 73], bass: 38, arp: [74, 76, 78, 81, 85], energy: 0.35 },
  { pad: [59, 62, 66, 69], bass: 35, arp: [71, 74, 78, 81, 83], energy: 0.45 },
  { pad: [55, 59, 62, 66], bass: 31, arp: [67, 71, 74, 78, 79], energy: 0.2 },
  { pad: [62, 66, 69, 74], bass: 38, arp: [74, 78, 81, 85, 86], energy: 0.5 },
  { pad: [57, 61, 64, 69], bass: 33, arp: [69, 73, 76, 80, 81], energy: 0.6 },
  { pad: [55, 59, 62, 67], bass: 31, arp: [67, 71, 74, 78, 79], energy: 0.55 },
  { pad: [52, 59, 62, 66], bass: 40, arp: [71, 74, 76, 78, 83], energy: 0.6 },
  { pad: [59, 62, 66, 69], bass: 35, arp: [71, 74, 78, 81, 83], energy: 0.45 },
  { pad: [62, 66, 69, 73], bass: 38, arp: [74, 78, 81, 85, 86], energy: 0.3 },
];

export default {
  id: 'refraction',
  formats: ['landscape'],
  scenes: SCENES,
  i18n: I18N,
  score: SCORE,
  /** звуки событий: по списку [секунда сцены, вид, параметр] на сцену; c — { dur, cue(k) } */
  sfx: (envs) => SCENES.map((s, i) => (s.sfx ? s.sfx(envs[i]) : [])),
  poster: (chapters) => chapters[0].start + chapters[0].dur - 1.5,
};
