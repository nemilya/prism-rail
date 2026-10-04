/* Плеер ролика: играет, перематывает, главы, озвучка, субтитры.
 *   index.html?film=refraction&lang=ru&t=40&subs=1
 *   &format=portrait — вертикальный 9:16, &size=720 — короткая сторона кадра (по умолчанию 1080)
 * 3D-кадр рисует ../sim/index.html?embed в скрытом iframe (window.prism), поверх — графика сцены.
 * Озвучка (films/<id>/voice/<lang>.json + .m4a) необязательна: без неё ролик идёт без звука
 * на базовом таймлайне. Когда дорожка играет, она и есть часы ролика.
 * ?render — режим для scripts/video-render.mjs: только кадр, без управления;
 * window.__video = { ready, duration, chapters, poster, seek(t) }. */
import FILMS from './films/index.js';
import { frameSize, mount } from './lib/engine.js';
import * as overlay from './lib/overlay.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const RENDER = params.has('render');
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  put(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } },
};

const id = FILMS.some((f) => f.id === params.get('film')) ? params.get('film') : FILMS[0].id;
const base = `films/${id}`;
const { default: FILM } = await import(`./${base}/film.js`);
let lang = params.get('lang') || store.get('prism-video-lang') || 'ru';
if (!FILM.i18n[lang]) lang = FILM.i18n.ru ? 'ru' : Object.keys(FILM.i18n)[0];
let subs = params.has('subs') ? params.get('subs') !== '0' : store.get('prism-video-subs') === '1';
const FORMAT = params.get('format') === 'portrait' ? 'portrait' : 'landscape';
const SIZE = Math.min(2160, Math.max(240, Number(params.get('size')) || 1080));
const { w: FW, h: FH } = frameSize(FORMAT, SIZE);
document.documentElement.style.setProperty('--fw', `${FW}px`);
document.documentElement.style.setProperty('--fh', `${FH}px`);
document.documentElement.style.setProperty('--ar', `${FW} / ${FH}`);
if (FORMAT === 'portrait') document.body.classList.add('portrait');

if (RENDER) document.body.classList.add('render');
const stage = $('stage');
let film = null;
let audio = null;
let voice = null;
let muted = store.get('prism-video-muted') === '1';
let t = 0;
let playing = false;
let last = 0;

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const at = (i) => (i ? film.chapters[i].start + film.chapters[i].xf : 0);

/** симулятор: ../sim/index.html?embed в iframe того же сайта → window.prism */
async function loadSim() {
  const frame = $('sim');
  frame.src = '../sim/index.html?embed';
  for (let i = 0; i < 1200; i++) {
    const p = frame.contentWindow?.prism;
    if (p?.ready) return p;
    await new Promise((ok) => setTimeout(ok, 50));
  }
  throw new Error('симулятор не загрузился (нужен three.js с cdn.jsdelivr.net)');
}

async function loadVoice(l) {
  try {
    const res = await fetch(`${base}/voice/${l}.json`);
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

const sim = await loadSim();
await Promise.all(['800 40px Inter', '600 40px Inter', '700 40px Caveat', 'italic 400 40px "Source Serif 4"', '400 40px "Source Serif 4"', '600 40px "Source Serif 4"']
  .map((f) => document.fonts.load(f, 'АаZzθλ₀√')));
$('loading').hidden = true;

async function setLang(l) {
  lang = l;
  document.documentElement.lang = l;
  const T = FILM.i18n[l];
  document.title = T.title;
  voice = await loadVoice(l);
  film = mount(stage, FILM, l, sim, overlay, { voice, subs, w: FW, h: FH });
  if (RENDER) return;
  if (audio) audio.pause();
  audio = voice ? new Audio(`${base}/voice/${l}.m4a`) : null;
  if (audio) { audio.preload = 'auto'; audio.muted = muted; }
  $('sound').hidden = !audio;
  store.put('prism-video-lang', l);
  $('chapters').replaceChildren(...film.chapters.map((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    const n = document.createElement('span');
    n.textContent = fmt(at(i));
    b.append(n, document.createTextNode(T.chapters[i]));
    b.addEventListener('click', () => { go(at(i)); play(true); });
    const li = document.createElement('li');
    li.append(b);
    return li;
  }));
  $('segs').replaceChildren(...film.chapters.map((c, i) => {
    const s = document.createElement('span');
    s.style.setProperty('flex', String(c.dur));
    s.title = T.chapters[i];
    s.append(document.createElement('i'));
    return s;
  }));
  $('scrub').setAttribute('aria-valuemax', String(Math.round(film.duration)));
  soundUi();
  ccUi();
  fsUi();
  go(Math.min(t, film.duration));
  if (playing) play(true);
  else uiPlay();
}

function go(nt, fromAudio = false) {
  t = Math.min(Math.max(nt, 0), film.duration);
  film.seek(t);
  if (RENDER) return;
  if (audio && !fromAudio && Math.abs(audio.currentTime - t) > 0.05) {
    try { audio.currentTime = t; } catch { /* метаданные ещё не загружены */ }
  }
  $('time').textContent = `${fmt(t)} / ${fmt(film.duration)}`;
  $('scrub').setAttribute('aria-valuenow', String(Math.round(t)));
  $('head').style.setProperty('left', `${(t / film.duration) * 100}%`);
  [...$('segs').children].forEach((s, i) => {
    const c = film.chapters[i];
    s.firstChild.style.setProperty('transform', `scaleX(${Math.min(1, Math.max(0, (t - c.start) / c.dur))})`);
  });
  const cur = film.chapters.reduce((a, c, i) => (t >= c.start ? i : a), 0);
  [...$('chapters').children].forEach((li, i) => li.firstChild.classList.toggle('is-on', i === cur));
}

function uiPlay() {
  document.body.classList.toggle('is-playing', playing);
  for (const b of [$('play'), $('bigplay')]) b.setAttribute('aria-label', playing ? 'Пауза' : (t >= film.duration - 0.05 ? 'Сначала' : 'Смотреть'));
}
function play(on) {
  playing = on;
  if (on && t >= film.duration - 0.05) go(0);
  uiPlay();
  if (audio) {
    if (on) {
      audio.currentTime = t;
      audio.play().catch(() => { /* автоплей со звуком запрещён — играем по своим часам */ });
    } else audio.pause();
  }
  last = performance.now();
  if (on) requestAnimationFrame(tick);
}
function tick(now) {
  if (!playing) return;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (audio && !audio.paused && audio.readyState >= 2) go(audio.currentTime, true);
  else go(t + dt);
  if (t >= film.duration) { play(false); return; }
  requestAnimationFrame(tick);
}

function fsUi() {
  const on = !!document.fullscreenElement;
  $('fs').classList.toggle('is-on', on);
  $('fs').title = on ? 'Выйти из полного экрана' : 'На весь экран';
}
async function toggleFs() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $('frame').requestFullscreen();
  } catch { /* полноэкранный режим запрещён */ }
}
function soundUi() {
  $('sound').classList.toggle('is-muted', muted);
  $('sound').title = muted ? 'Включить звук' : 'Выключить звук';
}
function toggleSound() {
  muted = !muted;
  store.put('prism-video-muted', muted ? '1' : '0');
  if (audio) {
    audio.muted = muted;
    if (playing && audio.paused) { audio.currentTime = t; audio.play().catch(() => {}); }
  }
  soundUi();
}
function ccUi() { $('cc').setAttribute('aria-pressed', String(subs)); }
function toggleSubs() {
  subs = !subs;
  store.put('prism-video-subs', subs ? '1' : '0');
  film = mount(stage, FILM, lang, sim, overlay, { voice, subs, w: FW, h: FH });
  ccUi();
  go(t);
}

if (RENDER) {
  window.__video = { ready: false, seek: (x) => go(x) };
  await setLang(lang);
  Object.assign(window.__video, { duration: film.duration, chapters: film.chapters, poster: FILM.poster?.(film.chapters) ?? 0, ready: true });
} else {
  await setLang(lang);
  $('play').addEventListener('click', () => play(!playing));
  $('bigplay').addEventListener('click', () => play(!playing));
  $('sound').addEventListener('click', toggleSound);
  $('cc').addEventListener('click', toggleSubs);
  $('fs').hidden = !document.fullscreenEnabled;
  $('fs').addEventListener('click', toggleFs);
  document.addEventListener('fullscreenchange', fsUi);
  const scrub = $('scrub');
  const toT = (e) => { const r = scrub.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * film.duration; };
  let dragging = false;
  scrub.addEventListener('pointerdown', (e) => { dragging = true; scrub.setPointerCapture(e.pointerId); go(toT(e)); });
  scrub.addEventListener('pointermove', (e) => { if (dragging) go(toT(e)); });
  scrub.addEventListener('pointerup', () => { dragging = false; });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('button, .scrub') && (e.key === ' ' || e.key === 'Enter' || e.key.startsWith('Arrow'))) return;
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); play(!playing); }
    else if (e.key === 'ArrowRight') go(t + 5);
    else if (e.key === 'ArrowLeft') go(t - 5);
    else if (e.key === 'm') toggleSound();
    else if (e.key === 'c') toggleSubs();
    else if (e.key === 'f') toggleFs();
    else if (/^[1-9]$/.test(e.key) && film.chapters[+e.key - 1]) go(at(+e.key - 1));
  });
  go(params.has('t') ? +params.get('t') : 0);
}
