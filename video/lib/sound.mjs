/* Музыка и звуки видео — синтез в коде, без сэмплов и лицензий
 * (из nemilya/n-dacha, video/lib/sound.mjs).
 *
 * Музыка: на каждую сцену — аккорд (пэд + бас) из film.score, поверх — мягкое арпеджио;
 * энергия сцены задаёт его плотность. Звуки — короткие события (мел по доске, стеклянный
 * колокольчик, стоп-кадр, «вжух» перехода, финальный аккорд…) на тех же моментах, что и
 * анимация: film.sfx(sceneEnvs) → по списку [секунда сцены, вид, параметр] на сцену.
 * Детерминировано: один и тот же таймлайн → те же сэмплы (шум — из ГПСЧ с зерном).
 * Используется из scripts/video-voice.mjs; черновик отдельно: node scripts/video-sound.mjs <film> ru */
import { writeFileSync } from 'node:fs';

export const SR = 48000;
const TAU = Math.PI * 2;
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BPM = 72;
const STEP = 60 / BPM / 2; // восьмая
const ARP = [0, 2, 1, 3, 2, 4, 1, 3];

/** синусоида (с обертонами) и огибающей в буфер */
function tone(buf, t0, { f, f1 = f, dur, a = 0.1, att = 0.005, dec = dur / 4, partials = [1], phase = 0 }) {
  const i0 = Math.max(0, Math.round(t0 * SR));
  const n = Math.min(buf.length - i0, Math.round(dur * SR));
  let ph = phase;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const k = t / dur;
    const freq = f * (f1 / f) ** k; // экспоненциальный глайд
    ph += TAU * freq / SR;
    const env = clamp(t / att) * Math.exp(-t / dec) * clamp((dur - t) / 0.01);
    let v = 0;
    for (let p = 0; p < partials.length; p++) v += partials[p] * Math.sin(ph * (p + 1));
    buf[i0 + i] += a * env * v;
  }
}
/** шум с огибающей; bright 0..1 — от тёмного (сглаженный) к яркому */
function noise(buf, t0, { dur, a = 0.05, att = 0.01, shape = 'swell', bright = 0.5, seed = 1, grain = 0 }) {
  const r = rng(seed);
  const i0 = Math.max(0, Math.round(t0 * SR));
  const n = Math.min(buf.length - i0, Math.round(dur * SR));
  let lp = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const k = t / dur;
    const w = r() * 2 - 1;
    lp += (w - lp) * 0.08;
    const hp = w - prev;
    prev = w;
    const b = typeof bright === 'function' ? bright(k) : bright;
    let env = shape === 'swell' ? Math.sin(Math.PI * k) ** 2 : clamp(t / att) * Math.exp(-t / (dur / 5));
    // «зернистость» карандаша: амплитуда дрожит штрихами
    if (grain) env *= 0.55 + 0.45 * Math.abs(Math.sin(TAU * grain * t + 3 * Math.sin(TAU * 2.3 * t)));
    buf[i0 + i] += a * env * ((1 - b) * lp * 3 + b * hp * 0.5);
  }
}

// ---------------------------------------------------------------- звуки событий
// (buf, t, arg, seed) → в буфер; arg — параметр из film.sfx (длительность, номер…)
const FX = {
  draw: (b, t, d = 0.8, s) => noise(b, t, { dur: Math.max(0.2, d), a: 0.05, bright: 0.85, seed: s, grain: 9 }),
  pop: (b, t, i = 0) => { const f = mtof(79 + [0, 4, 7][i % 3]); tone(b, t, { f, dur: 0.5, a: 0.07, dec: 0.15, partials: [1, 0.15, 0.25] }); },
  sparkle: (b, t, i = 0) => [0, 1, 2].forEach((k) => tone(b, t + k * 0.05, { f: mtof(91 + [0, 4, 7, 12][(i + k) % 4]), dur: 0.5, a: 0.025, dec: 0.15 })),
  beam: (b, t, d = 0.8, s) => { noise(b, t, { dur: d, a: 0.02, bright: (k) => 0.3 + 0.5 * k, seed: s }); tone(b, t, { f: 440, f1: 880, dur: d, a: 0.015, att: d * 0.6, dec: d * 3 }); },
  ping: (b, t) => { tone(b, t, { f: mtof(88), dur: 1.0, a: 0.06, dec: 0.35, partials: [1, 0, 0.2] }); tone(b, t + 0.07, { f: mtof(95), dur: 1.0, a: 0.04, dec: 0.35 }); },
  tick: (b, t, i = 0) => tone(b, t, { f: mtof(84 + [0, 2, 4, 7, 9][i % 5]), dur: 0.05, a: 0.025, dec: 0.02 }),
  err: (b, t) => { tone(b, t, { f: 196, dur: 0.12, a: 0.11, partials: [1, 0, 0.3] }); tone(b, t + 0.14, { f: 185, dur: 0.16, a: 0.11, partials: [1, 0, 0.3] }); },
  ok: (b, t) => { tone(b, t, { f: mtof(79), dur: 0.5, a: 0.07, dec: 0.18 }); tone(b, t + 0.12, { f: mtof(84), dur: 0.8, a: 0.07, dec: 0.3 }); },
  whoosh: (b, t, p, s) => noise(b, t, { dur: 0.7, a: 0.08, bright: (k) => 0.15 + 0.7 * Math.sin(Math.PI * k), seed: s }),
  // крыша уезжает вверх: нарастающий шорох с подъёмом тона
  lift: (b, t, d = 1.8, s) => { noise(b, t, { dur: d, a: 0.06, bright: (k) => 0.1 + 0.6 * k, seed: s }); tone(b, t, { f: 110, f1: 330, dur: d, a: 0.02, att: d * 0.5, dec: d * 2 }); },
  // выключатель и тёплый «вдох» света
  click: (b, t) => { noise(b, t, { dur: 0.04, a: 0.12, shape: 'hit', bright: 0.9, seed: 7 }); tone(b, t + 0.05, { f: mtof(72), dur: 1.4, a: 0.025, att: 0.3, dec: 0.8, partials: [1, 0.3] }); },
  // мягкий стук двери
  door: (b, t) => { tone(b, t, { f: 90, f1: 60, dur: 0.25, a: 0.16, dec: 0.07, partials: [1, 0.4] }); noise(b, t, { dur: 0.12, a: 0.04, shape: 'hit', bright: 0.2, seed: 11 }); },
  // стеклянный колокольчик: негармонические обертоны, как нота стекла в симуляторе
  bell: (b, t, i = 0) => {
    const f = mtof(81 + [0, 2, 4, 7, 9][i % 5]);
    tone(b, t, { f, dur: 3.2, a: 0.045, att: 0.004, dec: 1.1 });
    tone(b, t, { f: f * 2.76, dur: 1.6, a: 0.018, att: 0.003, dec: 0.4 });
    tone(b, t, { f: f * 5.4, dur: 0.8, a: 0.008, att: 0.002, dec: 0.15 });
  },
  // стоп-кадр: глухой удар и затухающий вниз тон
  freeze: (b, t) => {
    tone(b, t, { f: 70, f1: 45, dur: 0.6, a: 0.16, dec: 0.18, partials: [1, 0.3] });
    tone(b, t, { f: 880, f1: 440, dur: 1.2, a: 0.02, att: 0.01, dec: 0.5 });
    noise(b, t, { dur: 0.5, a: 0.04, shape: 'hit', bright: 0.3, seed: 23 });
  },
  // мягкое нарастание (титр, радуга): шум и квинта
  swell: (b, t, d = 2.5, s) => {
    noise(b, t, { dur: d, a: 0.025, bright: (k) => 0.2 + 0.4 * k, seed: s });
    tone(b, t, { f: mtof(62), dur: d + 1, a: 0.02, att: d * 0.7, dec: d * 2 });
    tone(b, t, { f: mtof(69), dur: d + 1, a: 0.015, att: d * 0.8, dec: d * 2 });
  },
  chime: (b, t) => {
    [65, 69, 72, 77, 84].forEach((m, i) => tone(b, t + i * 0.07, { f: mtof(m), dur: 3.5, a: 0.03, att: 0.02, dec: 1.4, partials: [1, 0.2, 0.05] }));
  },
};
export const FX_KINDS = Object.keys(FX);

// ---------------------------------------------------------------- музыка
function music(buf, chapters, duration, score) {
  const n = buf.length;
  const sceneEnv = (i, t) => {
    const c = chapters[i];
    const fadeIn = i === 0 ? 1 : clamp((t - (c.start - 0.6)) / 1.2);
    const fadeOut = i === chapters.length - 1 ? 1 : clamp((c.start + c.dur + 0.6 - t) / 1.2);
    return fadeIn * fadeOut;
  };
  // пэд и бас — сэмпл за сэмплом в окне каждой сцены
  chapters.forEach((c, i) => {
    const sc = score[i % score.length];
    const t0 = Math.max(0, c.start - 0.6);
    const t1 = Math.min(duration, c.start + c.dur + 0.6);
    const voices = [
      ...sc.pad.flatMap((m, k) => [-4, 4].map((cents) => ({ f: mtof(m) * 2 ** (cents / 1200), a: 0.018, ph: k * 1.3 + cents, parts: [1, 0.2, 0.05] }))),
      { f: mtof(sc.bass), a: 0.09, ph: 0, parts: [1, 0.25, 0.05] },
    ];
    for (let s = Math.round(t0 * SR); s < Math.min(n, Math.round(t1 * SR)); s++) {
      const t = s / SR;
      const env = sceneEnv(i, t);
      if (env <= 0) continue;
      const trem = 0.85 + 0.15 * Math.sin(TAU * 0.13 * t + i);
      let v = 0;
      for (const vo of voices) {
        const ph = TAU * vo.f * t + vo.ph;
        let x = 0;
        for (let p = 0; p < vo.parts.length; p++) x += vo.parts[p] * Math.sin(ph * (p + 1));
        v += vo.a * x;
      }
      buf[s] += v * env * trem;
    }
  });
  // арпеджио по сетке темпа: аккорд — той сцены, что сейчас на экране
  const sceneAt = (t) => chapters.reduce((a, c, i) => (t >= c.start ? i : a), 0);
  const last = chapters[chapters.length - 1];
  for (let step = 0, t = 0.25; t < duration - 0.5; step++, t += STEP) {
    const i = sceneAt(t);
    const sc = score[i % score.length];
    const e = sc.energy;
    const onBeat = step % 2 === 0;
    if (i === chapters.length - 1 && t > last.start + last.dur - 2.5) break; // финал — только аккорд
    if (e < 0.5 && !onBeat) continue; // спокойные сцены — реже, четвертями
    const m = sc.arp[ARP[step % ARP.length]];
    const g = (0.6 + 0.4 * e) * (onBeat ? 1 : 0.7);
    tone(buf, t, { f: mtof(m), dur: 0.9, a: 0.026 * g, att: 0.006, dec: 0.25, partials: [1, 0.3, 0.1] });
  }
  for (let s = 0; s < n; s++) {
    const t = s / SR;
    buf[s] *= clamp(t / 1.0) * clamp((duration - t) / 2.0);
  }
}

/** → { music, fx, events } (Float32Array, моно SR Гц) */
export function synth({ chapters, duration, sfx, score }) {
  const n = Math.ceil(duration * SR);
  const events = [];
  sfx.forEach((list, i) => list.forEach(([at, kind, arg]) => events.push({ t: chapters[i].start + Math.min(at, chapters[i].dur), kind, arg })));
  events.sort((a, b) => a.t - b.t);
  const mus = new Float32Array(n);
  music(mus, chapters, duration, score);
  const fx = new Float32Array(n);
  events.forEach((e, k) => {
    const f = FX[e.kind];
    if (!f) throw new Error(`неизвестный звук: ${e.kind}`);
    f(fx, e.t, e.arg, 1000 + k);
  });
  return { music: mus, fx, events };
}

/** Float32 [-1..1] → WAV 16 бит моно (с мягким ограничением) */
export function wav(path, data) {
  const buf = Buffer.alloc(44 + data.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + data.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i++) buf.writeInt16LE(Math.round(Math.tanh(data[i]) * 32000), 44 + i * 2);
  writeFileSync(path, buf);
}
