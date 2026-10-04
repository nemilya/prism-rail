/* Движок ролика (по образцу nemilya/n-dacha, video/lib/engine.js). Ролик (film) — список сцен;
 * каждая сцена — чистые функции времени:
 *   shots(lt, env) → [{ state, a }]  что снимает 3D-камера симулятора (sim/index.html?embed);
 *                                    [] — сцена без 3D (чистый чертёж)
 *   look(lt, env) → { filter, alpha } как положить 3D-кадр (CSS-фильтр 2D-холста, прозрачность)
 *   draw(ctx, lt, env)               что рисуется поверх (чертежи, формулы, подписи, титры)
 * lt — секунды от начала сцены. Поэтому плеер перематывается в любую точку, а
 * scripts/video-render.mjs снимает одинаковые кадры при каждом запуске. В сценах нельзя
 * Math.random, Date и прочие часы — это проверяет video/tests.
 *
 * 3D-кадр рисует сам симулятор (window.prism в скрытом iframe): одна сцена и для
 * интерактива, и для роликов. Кадр — любой: 1920×1080, 1280×720, вертикальный 720×1280…
 * Графика масштабируется от короткой стороны (env.u = min(w, h) / 1080), env.portrait — вертикальный. */
export const W = 1920;
export const H = 1080;

/** Размер кадра: format — landscape | portrait, size — короткая сторона (720, 1080) */
export function frameSize(format = 'landscape', size = 1080) {
  const long = Math.round((size * 16) / 9 / 2) * 2;
  return format === 'portrait' ? { w: size, h: long } : { w: long, h: size };
}
export const XF = 0.7; // наложение соседних сцен (кроссфейд), с — если у сцены не задан свой xf
export const TAIL = 0.8; // пауза после последней реплики сцены, с

const xfOf = (s) => s.xf ?? XF;

/* Реплики. В i18n.js: voice — по списку на сцену, [секунда от начала сцены | null, текст, кто].
 * null — сразу после предыдущей реплики (через GAP). До озвучки длина реплики оценивается
 * по числу знаков, после — берётся из манифеста voice/<lang>.json (настоящие длительности).
 * События сцен привязаны к репликам (env.cue(k)), поэтому после озвучки всё встаёт по местам. */
export const GAP = 0.35; // пауза между репликами диалога, с
export const CPS = 14; // знаков в секунду — оценка длины реплики до озвучки
export const estDur = (text) => Math.round((0.5 + text.length / CPS) * 100) / 100;

/** раскладка реплик одной сцены: lines — [at|null, text, who], durOf(text, who) → с */
export function layout(lines, durOf) {
  let free = 0;
  return lines.map(([at0, text, who]) => {
    const dur = durOf(text, who);
    const at = Math.round(Math.max(at0 ?? 0, free) * 100) / 100;
    free = at + dur + GAP;
    return { at, dur, text, who };
  });
}

/** все реплики ролика [{scene, at, dur, text, who}]: из манифеста озвучки или оценкой */
export function cues(film, voice, lang = 'ru') {
  if (voice?.cues) return voice.cues;
  return film.i18n[lang].voice.flatMap((lines, scene) => layout(lines, estDur).map((c) => ({ scene, ...c })));
}

/** Таймлайн: базовые длительности сцен продлеваются под озвучку. voice — манифест
 * video/films/<id>/voice/<lang>.json ({cues: [{scene, at, dur}]}, at — от начала сцены).
 * Движения камеры заданы в долях длительности сцены — при продлении они замедляются,
 * а события (формулы, подписи) остаются на своих секундах, привязанных к репликам. */
export function timeline(film, voice, lang = 'ru') {
  const len = film.scenes.map((s) => s.dur);
  for (const c of cues(film, voice, lang)) len[c.scene] = Math.max(len[c.scene], c.at + c.dur + (film.scenes[c.scene].tail ?? TAIL));
  let start = 0;
  const chapters = film.scenes.map((s, i) => {
    if (i) start -= xfOf(s);
    const ch = { id: s.id, start, dur: len[i], xf: i ? xfOf(s) : 0 };
    start += len[i];
    return ch;
  });
  return { chapters, duration: start };
}

/** Для звуков и проверок: по сцене { start, dur, cue(k) } — те же моменты, что видит сцена (env.cue) */
export function sceneEnvs(film, voice, lang = 'ru') {
  const { chapters } = timeline(film, voice, lang);
  const all = cues(film, voice, lang);
  return chapters.map((ch, i) => {
    const list = all.filter((c) => c.scene === i).map((c) => ({ ...c, t0: c.at, t1: c.at + c.dur }));
    return { start: ch.start, dur: ch.dur, cue: (k) => list.at(k) ?? { t0: 0, t1: 0 } };
  });
}

/** Кеш для траекторий камеры и выбранных стёкол (считаются один раз на длительность сцены и формат) */
const cache = new Map();
export function memo(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

/** Реплика озвучки, звучащая в момент t (для вшитых субтитров) */
export function cueAt(voice, chapters, t) {
  for (const c of voice?.cues ?? []) {
    const t0 = chapters[c.scene].start + c.at;
    if (t >= t0 && t <= t0 + c.dur + 0.15) return { text: c.text, t0, t1: t0 + c.dur };
  }
  return null;
}

/** Собрать ролик на холсте w×h → { seek(t), duration, chapters }.
 * sim — window.prism из sim/index.html?embed; overlay — video/lib/overlay.js */
export function mount(canvas, film, lang, sim, overlay, { voice = null, subs = false, w = W, h = H } = {}) {
  const T = film.i18n[lang];
  const { chapters, duration } = timeline(film, voice, lang);
  const all = cues(film, voice, lang);
  const byScene = film.scenes.map((_, i) => all.filter((c) => c.scene === i).map((c) => ({ ...c, t0: c.at, t1: c.at + c.dur })));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const layer = document.createElement('canvas');
  layer.width = w;
  layer.height = h;
  const lctx = layer.getContext('2d');
  const base = {
    T, lang, W: w, H: h, aspect: w / h, portrait: h > w, u: Math.min(w, h) / 1080,
    sim, chapters, duration, subs,
  };

  function drawScene(c, i, t) {
    const ch = chapters[i];
    const lt = t - ch.start;
    const sc = film.scenes[i];
    // env.cue(k) — k-я реплика сцены { t0, t1, text, who } в секундах сцены (k < 0 — с конца)
    const env = { ...base, t, dur: ch.dur, i, cue: (k) => byScene[i].at(k) ?? { t0: 0, t1: 0 } };
    const shots = sc.shots?.(lt, env) ?? [];
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.filter = 'none';
    c.fillStyle = film.bg ?? '#000';
    c.fillRect(0, 0, w, h);
    if (shots.length) {
      const look = sc.look?.(lt, env) ?? {};
      if ((look.alpha ?? 1) > 0.002) {
        c.save();
        c.filter = look.filter || 'none';
        sim.compose(c, w, h, shots.map((s) => ({ ...s, a: (s.a ?? 1) * (look.alpha ?? 1) })));
        c.restore();
      }
    }
    // подписи привязаны к точкам комнаты: env.at([x, y, z]) → пиксели кадра (камера первого снимка)
    const main = shots[0]?.state;
    env.at = (p) => (main ? sim.project(main, p, w, h) : null);
    c.save();
    sc.draw?.(c, lt, env);
    c.restore();
  }

  function seek(t) {
    t = Math.min(Math.max(t, 0), duration);
    let on = chapters.map((_, i) => i).filter((i) => t >= chapters[i].start && t <= chapters[i].start + chapters[i].dur);
    if (!on.length) on = [chapters.length - 1];
    // сцены встык (xf: 0) — на стыке рисуем только следующую, без кроссфейда
    if (on.length > 1 && chapters[on[1]].xf <= 0) on = [on[1]];
    drawScene(ctx, on[0], t);
    if (on.length > 1) {
      // кроссфейд: входящая сцена поверх, прозрачность растёт за xf секунд
      const i = on[1];
      drawScene(lctx, i, t);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = overlay.E.inOut(Math.min(1, Math.max(0, (t - chapters[i].start) / chapters[i].xf)));
      ctx.drawImage(layer, 0, 0);
      ctx.globalAlpha = 1;
    }
    if (subs) overlay.subtitle(ctx, base, cueAt(voice, chapters, t), t);
  }
  return { seek, duration, chapters, T };
}
