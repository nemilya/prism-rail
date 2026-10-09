/* Озвучка видео: реплики из video/films/<id>/i18n.js (voice) → TTS → voice/<lang>.m4a
 * (одна дорожка: реплики на своих местах таймлайна + музыка и звуки) + манифест <lang>.json
 * с длительностями (по нему движок продлевает сцены и ставит события на реплики) + субтитры <lang>.vtt.
 * Из nemilya/n-dacha (video/scripts/video-voice.mjs); добавлен диалог — свой голос на каждого,
 * кто говорит (третий элемент реплики: he / she).
 *
 *   OPENROUTER_API_KEY=… make voice FILM=refraction                    # один ролик, все языки
 *   node video/scripts/video-voice.mjs refraction ru --engine espeak   # черновик без ключа (espeak-ng), не коммитить
 *   node video/scripts/video-voice.mjs refraction ru --redo 4          # услышали дефект — заново реплики сцены 4 (можно 3,4)
 *
 * Модель, голоса и манера — video/voice.config.json: voice.ru — имя голоса или { he, she };
 * instructions.ru — так же; свои для ролика — films/<id>/voice.config.json
 * (только отличия, scripts/voice-config.mjs). Ключ читается только из окружения
 * и никуда не пишется. Прокси — OPENROUTER_PROXY (socks5h://…, http://…). Реплики
 * кешируются по хешу (текст+голос+модель): перегенерируются только изменённые. */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { cli } from './video-cli.mjs';

const ROOT = resolve(import.meta.dirname, '..');
import { voiceConfig } from './voice-config.mjs';

/** голос и манера того, кто говорит: строка — один голос на всех, объект — { he, she, … } */
const pick = (v, who) => (v && typeof v === 'object' ? v[who] ?? Object.values(v)[0] : v);

// настройки — общие, а при обработке ролика — с его films/<id>/voice.config.json поверх
let CFG = voiceConfig(null);
const { films, langs: LANGS, opt } = await cli({ engine: 'openrouter', redo: '' });
const engine = opt.engine;
const REDO = opt.redo ? opt.redo.split(',').map(Number) : [];

if (engine === 'openrouter' && !process.env.OPENROUTER_API_KEY) {
  console.error('Нет OPENROUTER_API_KEY в окружении. Локально: export OPENROUTER_API_KEY=… или строка\n'
    + 'OPENROUTER_API_KEY = … в local.mk (не в git). В облачной сессии — переменная окружения среды.');
  process.exit(1);
}

const ff = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a]);
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());

// ---------------------------------------------------------------- TTS
/* Прокси: OPENROUTER_PROXY=socks5h://host:1080 (или socks5://, http://, https://,
 * можно с user:pass@). Тогда запрос идёт через curl — он умеет все эти схемы без
 * npm-зависимостей; socks5h — DNS тоже через прокси. Ключ не попадает в аргументы
 * процесса: заголовок передаётся curl через временный конфиг с правами 600. */
const PROXY = process.env.OPENROUTER_PROXY || CFG.proxy || '';

/** POST → {status, type, body: Buffer}; json — строка тела, или form — {поле: значение | {file}} (multipart) */
async function send(url, headers, json, form = null) {
  if (!PROXY) {
    let body = json;
    if (form) {
      body = new FormData();
      for (const [k, v] of Object.entries(form)) {
        if (v.file) body.append(k, new Blob([readFileSync(v.file)]), basename(v.file));
        else body.append(k, v);
      }
    }
    const res = await fetch(url, { method: 'POST', headers, body });
    return { status: res.status, type: res.headers.get('content-type') || '', body: Buffer.from(await res.arrayBuffer()) };
  }
  const tmp = mkdtempSync(join(tmpdir(), 'kd1-voice-'));
  const conf = join(tmp, 'curl.conf');
  const out = join(tmp, 'body');
  const q = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  writeFileSync(conf, [
    `url = ${q(url)}`, `proxy = ${q(PROXY)}`, 'request = "POST"', 'silent', 'show-error',
    'max-time = 180', `output = ${q(out)}`, 'write-out = "%{http_code} %{content_type}"',
    ...(form ? Object.entries(form).map(([k, v]) => `form = ${q(v.file ? `${k}=@${v.file}` : `${k}=${v}`)}`) : ['data-binary = "@-"']),
    ...Object.entries(headers).map(([k, v]) => `header = ${q(`${k}: ${v}`)}`),
  ].join('\n'), { mode: 0o600 });
  try {
    const [code, type = ''] = execFileSync('curl', ['--config', conf], { input: form ? '' : json }).toString().trim().split(' ');
    return { status: Number(code), type, body: existsSync(out) ? readFileSync(out) : Buffer.alloc(0) };
  } catch (e) {
    throw new Error(`curl через прокси ${PROXY.replace(/\/\/[^@/]*@/, '//***@')}: ${e.stderr?.toString().trim() || e.message}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function post(path, body, form = null) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('нет OPENROUTER_API_KEY в окружении (см. video/README.md, «Озвучка»)');
  const headers = { authorization: `Bearer ${key}`, 'x-title': 'n-dacha video' };
  if (!form) headers['content-type'] = 'application/json';
  let res;
  // провайдер перегружен (429, 5xx) — подождать и повторить, до 4 попыток
  for (let attempt = 1; ; attempt++) {
    res = await send(`${CFG.endpoint}${path}`, headers, form ? '' : JSON.stringify(body), form);
    if (!(res.status === 429 || res.status >= 500) || attempt >= 4) break;
    let wait = 5 * attempt;
    try { wait = Math.min(60, JSON.parse(res.body.toString('utf8')).error?.metadata?.retry_after_seconds ?? wait); } catch { /* не JSON */ }
    console.warn(`  … ${path}: HTTP ${res.status}, повтор через ${wait} с`);
    await new Promise((ok) => setTimeout(ok, wait * 1000));
  }
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`${path}: HTTP ${res.status} ${res.body.toString('utf8').slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

/** OpenRouter /audio/speech (TTS-модели): response_format — mp3 | pcm;
 * pcm — сырые s16le, частота в content-type («audio/pcm;rate=24000;channels=1») */
async function viaSpeech(text, lang, who) {
  const res = await post('/audio/speech', {
    model: CFG.model, input: text, voice: pick(CFG.voice[lang], who), response_format: 'pcm',
    instructions: pick(CFG.instructions[lang], who), speed: CFG.speed,
  });
  const rate = Number(/rate=(\d+)/.exec(res.type)?.[1]) || 24000;
  const ch = Number(/channels=(\d+)/.exec(res.type)?.[1]) || 1;
  return /pcm/.test(res.type) || !res.type ? { buf: res.body, fmt: 'pcm16', rate, ch } : { buf: res.body, fmt: 'auto' };
}
/** /chat/completions с modalities: audio → base64 в message.audio.data (стрим pcm16) */
async function viaChat(text, lang, who) {
  const res = await post('/chat/completions', {
    model: CFG.model,
    modalities: ['text', 'audio'],
    audio: { voice: pick(CFG.voice[lang], who), format: 'pcm16' },
    stream: true,
    messages: [
      { role: 'system', content: `${pick(CFG.instructions[lang], who)} Read the user text aloud exactly as written, nothing else.` },
      { role: 'user', content: text },
    ],
  });
  // SSE целиком: data: {...choices[0].delta.audio.data (base64 pcm16)}
  const chunks = [];
  for (const l of res.body.toString('utf8').split('\n')) {
    if (!l.startsWith('data: ') || l.trim() === 'data: [DONE]') continue;
    const a = JSON.parse(l.slice(6)).choices?.[0]?.delta?.audio;
    if (a?.data) chunks.push(Buffer.from(a.data, 'base64'));
  }
  if (!chunks.length) throw new Error('/chat/completions: в ответе нет аудио');
  return { buf: Buffer.concat(chunks), fmt: 'pcm16', rate: 24000, ch: 1 };
}
let api = CFG.api;
async function tts(text, lang, out, who) {
  const tmp = `${out}.raw`;
  if (engine === 'espeak') {
    execFileSync('espeak-ng', ['-v', who === 'she' ? `${lang}+f3` : lang, '-s', '165', '-w', tmp, text]);
    ff('-i', tmp, '-ar', '48000', '-ac', '1', out);
    return;
  }
  let r;
  if (api === 'speech' || api === 'auto') {
    try { r = await viaSpeech(text, lang, who); api = 'speech'; } catch (e) {
      // /chat/completions — только если у провайдера нет /audio/speech
      if (api === 'speech' || ![404, 405].includes(e.status)) throw e;
      api = 'chat';
    }
  }
  if (!r) r = await viaChat(text, lang, who);
  writeFileSync(tmp, r.buf);
  // PCM — с частотой из ответа; MP3 ffmpeg распознает сам
  if (r.fmt === 'pcm16') ff('-f', 's16le', '-ar', String(r.rate), '-ac', String(r.ch), '-i', tmp, '-ar', '48000', '-ac', '1', out);
  else ff('-i', tmp, '-ar', '48000', '-ac', '1', out);
}

// ---------------------------------------------------------------- проверка: распознать и сравнить
/* TTS иногда теряет слова или обрывает фразу (в файле тишина, а слов не хватает) —
 * по громкости это не поймать. Поэтому каждую новую реплику распознаём моделью с
 * аудиовходом и сравниваем с текстом; не совпало — синтезируем заново.
 * Ограничение: срезанный последний звук слова («скане[р]») распознаватель достраивает
 * сам — такое ловится только на слух; тогда --redo <сцена>. */
let VERIFY = { enabled: true, model: 'google/gemini-3.5-transcribe', retries: 3, minScore: 0.85, ...CFG.verify };

const norm = (s) => s.toLowerCase().replace(/ё/g, 'е')
  .replace(/[’']/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
// числительные распознаватель пишет цифрами («500», «6 1/2», «viissada» → «500») — в сравнении их пропускаем
const NUMERAL = /^(ноль|один|одна|два|две|три|четыр|пят|шест|сем|восем|девят|десят|двадцат|тридцат|сорок|девяност|сто|сот|двест|трист|тысяч|миллион|половин|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|half|and|üks|kaks|kolm|neli|viis|kuus|seitse|kaheks|üheks|kümme|sada|saja|tuhat|tuhan|miljon|pool$|ja$)/;
const UNIT = /^(градус|метр|квадрат|сантиметр|сотых|десятых|degree|percent)/;
function lev(x, y) {
  const dp = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return 1 - dp[y.length] / Math.max(x.length, y.length, 1);
}
// окончания распознаются вольно («каждое» → «каждая») — порог мягкий
const near = (w, words) => words.some((g) => lev(w, g) >= 0.6);

/** → {transcript, score, tail, ok}: score — доля слов текста, найденных в распознанном;
 * tail — последнее слово текста есть среди последних распознанных */
async function verify(file, text, lang) {
  const res = await post('/audio/transcriptions', null, { model: VERIFY.model, language: lang, file: { file } });
  const transcript = JSON.parse(res.body.toString('utf8')).text?.trim() ?? '';
  // однобуквенные предлоги и союзы («с», «и») при цифрах распознаватель теряет — не считаем
  // единицы распознаватель сокращает («метров» → «м», «квадратных метров» → «м²») — тоже пропускаем
  const want = norm(text).split(' ').filter((w) => !NUMERAL.test(w) && !UNIT.test(w) && w.length > 1);
  const got = norm(transcript).split(' ').filter((w) => !/\d/.test(w));
  const found = want.filter((w) => near(w, got)).length;
  const score = Math.round((found / Math.max(want.length, 1)) * 100) / 100;
  const tail = near(want.at(-1), got.slice(-2));
  return { transcript, score, tail, ok: score >= VERIFY.minScore && tail };
}

// ---------------------------------------------------------------- сборка дорожки
const { timeline, layout, sceneEnvs } = await import('../lib/engine.js');
const { synth, wav } = await import('../lib/sound.mjs');
let MUSIC;
let FXCFG;

for (const film of films) {
  CFG = voiceConfig(film.id);
  VERIFY = { enabled: true, model: 'google/gemini-3.5-transcribe', retries: 3, minScore: 0.85, ...CFG.verify };
  MUSIC = { enabled: true, gain: -2, duck: true, ...CFG.music };
  FXCFG = { enabled: true, gain: 3, ...CFG.sfx };
  api = CFG.api;
  const I18N = film.i18n;
  const DIR = join(ROOT, 'films', film.id, 'voice');
  const CACHE = join(DIR, 'clips');
  const rel = (p) => p.replace(`${ROOT}/`, 'video/');
  for (const lang of LANGS.length ? LANGS : Object.keys(I18N)) {
    if (!I18N[lang]) { console.warn(`${film.id}: нет языка ${lang}`); continue; }
    if (!CFG.voice[lang]) throw new Error(`voice.config.json: нет голоса для «${lang}» (voice, instructions) — общий или films/${film.id}/`);
    mkdirSync(join(CACHE, lang), { recursive: true });
    const cues = [];
    for (const [scene, lines] of I18N[lang].voice.entries()) {
      const clips = {};
      for (const [, text, who] of lines) {
        const hash = createHash('sha256').update(JSON.stringify([engine, CFG.model, pick(CFG.voice[lang], who), pick(CFG.instructions[lang], who), CFG.speed, text])).digest('hex').slice(0, 12);
        const file = join(CACHE, lang, `${hash}.wav`);
        const check = file.replace(/\.wav$/, '.check.json');
        if (REDO.includes(scene + 1)) { rmSync(file, { force: true }); rmSync(check, { force: true }); }
        const verifying = VERIFY.enabled && engine === 'openrouter';
        for (let attempt = 1; ; attempt++) {
          if (!existsSync(file)) {
            process.stdout.write(`${film.id} ${lang} ${scene + 1} ${who ?? ''}: ${text.slice(0, 50)}…${attempt > 1 ? ` (попытка ${attempt})` : ''}\n`);
            await tts(text, lang, file, who);
          }
          if (!verifying || existsSync(check)) break;
          const v = await verify(file, text, lang);
          if (v.ok) { writeFileSync(check, `${JSON.stringify(v, null, 2)}\n`); break; }
          console.warn(`  ⚠ ${lang} сцена ${scene + 1}: распознано «${v.transcript}» (совпадение ${v.score}${v.tail ? '' : ', оборван конец'})`);
          if (attempt >= VERIFY.retries) {
            writeFileSync(check, `${JSON.stringify(v, null, 2)}\n`);
            console.warn(`  ⚠ оставляю последнюю попытку — переформулируйте реплику или запустите ещё раз (удалите ${rel(check)})`);
            break;
          }
          rmSync(file);
        }
        clips[text] = { dur: Math.round(dur(file) * 100) / 100, clip: `clips/${lang}/${hash}.wav` };
      }
      // раскладка по настоящим длительностям: null — сразу после предыдущей, реплики не наезжают
      for (const c of layout(lines, (text) => clips[text].dur)) cues.push({ scene, ...c, clip: clips[c.text].clip });
    }
    const manifest = { lang, engine, model: engine === 'espeak' ? 'espeak-ng' : CFG.model, voice: CFG.voice[lang], cues };
    // таймлайн считается до синтеза музыки: она подстраивается под продлённые сцены
    const { chapters, duration } = timeline(film, manifest);
    // одна дорожка: каждая реплика с задержкой start сцены + at
    const inputs = cues.flatMap((c) => ['-i', join(DIR, c.clip)]);
    const delays = cues.map((c, i) => `[${i}]adelay=${Math.round((chapters[c.scene].start + c.at) * 1000)}:all=1[a${i}]`);
    // loudnorm всегда выдаёт 192 кГц и держит 3 с упреждающего буфера: без явного aresample
    // в общем графе с музыкой (48 кГц) хвост этого буфера терялся — последние ~2,8 с ролика
    // обрывались в тишину (в et — на полуслове последней реплики)
    const voiceMix = `${delays.join(';')};${cues.map((_, i) => `[a${i}]`).join('')}amix=inputs=${cues.length}:normalize=0,apad=whole_dur=${duration.toFixed(2)},loudnorm=I=${CFG.loudness}:TP=-1.5,aresample=48000`;
    // музыка и звуки событий (scripts/sound-video.mjs) — синтез по тому же таймлайну
    const extra = [];
    if (MUSIC.enabled || FXCFG.enabled) {
      const { music, fx } = synth({ chapters, duration, sfx: film.sfx(sceneEnvs(film, manifest, lang)), score: film.score });
      if (MUSIC.enabled) { wav(join(CACHE, `music-${lang}.wav`), music); extra.push('music'); }
      if (FXCFG.enabled) { wav(join(CACHE, `fx-${lang}.wav`), fx); extra.push('fx'); }
    }
    const extraIn = extra.flatMap((k) => ['-i', join(CACHE, `${k}-${lang}.wav`)]);
    const at = (k) => `[${cues.length + extra.indexOf(k)}]`;
    const chains = [`${voiceMix}${extra.length ? ',asplit=2[v][vs]' : '[v]'}`];
    const outs = ['[v]'];
    if (extra.includes('music')) {
      // эхо для объёма; под голосом музыка приседает (sidechain), в паузах возвращается
      chains.push(`${at('music')}highpass=f=45,aecho=0.8:0.55:110|170:0.22|0.14,volume=${MUSIC.gain}dB[mr]`);
      chains.push(MUSIC.duck ? '[mr][vs]sidechaincompress=threshold=0.015:ratio=5:attack=40:release=600[m]' : '[mr]anull[m]');
      outs.push('[m]');
    } else if (extra.length) chains.push('[vs]anullsink');
    if (extra.includes('fx')) { chains.push(`${at('fx')}aecho=0.6:0.4:70:0.15,volume=${FXCFG.gain}dB[f]`); outs.push('[f]'); }
    chains.push(`${outs.join('')}amix=inputs=${outs.length}:normalize=0,alimiter=limit=0.89:level=false[out]`);
    // паузы без голоса: длинная тишина, а картинка идёт — повод сдвинуть реплики или укоротить сцену
    const spans = cues.map((c) => [chapters[c.scene].start + c.at, chapters[c.scene].start + c.at + c.dur, c.scene]).sort((a, b) => a[0] - b[0]);
    for (let k = 1; k < spans.length; k++) {
      const gap = spans[k][0] - spans[k - 1][1];
      if (gap > 2.5) console.warn(`  ⚠ ${lang}: пауза без голоса ${gap.toFixed(1)} с (${spans[k - 1][1].toFixed(1)}–${spans[k][0].toFixed(1)} с, сцена ${spans[k][2] + 1})`);
    }
    const after = duration - spans.at(-1)[1];
    if (after > 4) console.warn(`  ⚠ ${lang}: после последней реплики ещё ${after.toFixed(1)} с видео`);
    const track = join(DIR, `${lang}.m4a`);
    ff(...inputs, ...extraIn, '-filter_complex', chains.join(';'), '-map', '[out]', '-ar', '48000', '-ac', '1', '-c:a', 'aac', '-b:a', '160k', '-t', duration.toFixed(2), track);
    // проверка: дорожка не должна затихнуть раньше, чем закончилась последняя реплика
    const lastVoice = Math.max(...cues.map((c) => chapters[c.scene].start + c.at + c.dur));
    const sd = spawnSync('ffmpeg', ['-i', track, '-af', 'silencedetect=noise=-60dB:d=0.3', '-f', 'null', '-']).stderr.toString();
    // тишина «до конца»: последний silence_start без silence_end или с концом в самом конце файла
    const starts = [...sd.matchAll(/silence_start: ([\d.]+)/g)].map((x) => Number(x[1]));
    const ends = [...sd.matchAll(/silence_end: ([\d.]+)/g)].map((x) => Number(x[1]));
    const tail = starts.length && (ends.length < starts.length || ends.at(-1) >= duration - 0.1) ? starts.at(-1) : null;
    if (tail !== null && tail < lastVoice - 0.3) {
      throw new Error(`${rel(track)}: звук обрывается на ${tail.toFixed(2)} с, а последняя реплика звучит до ${lastVoice.toFixed(2)} с`);
    }
    // субтитры WebVTT: реплика = титр, время — по таймлайну (для <track> на лендинге)
    const ts = (x) => new Date(Math.round(x * 1000)).toISOString().slice(11, 23);
    const vtt = cues.map((c, i) => {
      const t0 = chapters[c.scene].start + c.at;
      return `${i + 1}\n${ts(t0)} --> ${ts(t0 + c.dur)}\n${c.text}\n`;
    });
    writeFileSync(join(DIR, `${lang}.vtt`), `WEBVTT\n\n${vtt.join('\n')}`);
    writeFileSync(join(DIR, `${lang}.json`), `${JSON.stringify({ ...manifest, duration: Math.round(duration * 100) / 100 }, null, 2)}\n`);
    const grown = chapters.map((c, i) => c.dur - timeline(film, null).chapters[i].dur).map((x, i) => (x > 0.01 ? `${i + 1}:+${x.toFixed(1)}с` : '')).filter(Boolean);
    console.log(`${film.id} ${lang}: ${cues.length} реплик, ролик ${duration.toFixed(1)} с${grown.length ? ` (продлены сцены ${grown.join(' ')})` : ''} → ${rel(track)}`);
  }
}
