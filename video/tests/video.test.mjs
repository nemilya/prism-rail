/* Видео: словари согласованы, сцены детерминированы, звуки внутри сцен, диалог озвучен
 * известными голосами, симулятор отдаёт API для съёмки и не потерял синтаксис. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import FILMS from '../films/index.js';
import { cues, layout, sceneEnvs, timeline } from '../lib/engine.js';
import { FX_KINDS } from '../lib/sound.mjs';
import { voiceConfig } from '../scripts/voice-config.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SIM = fs.readFileSync(path.join(ROOT, '..', 'sim', 'index.html'), 'utf8');

function shape(v) {
  if (Array.isArray(v)) return v.map(shape);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)]));
  return typeof v;
}
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

for (const { id } of FILMS) {
  const { default: film } = await import(`../films/${id}/film.js`);
  const langs = Object.keys(film.i18n);

  test(`${id}: у всех языков одинаковые ключи и длины списков`, () => {
    for (const l of langs) assert.deepEqual(shape(film.i18n[l]), shape(film.i18n.ru), l);
  });

  test(`${id}: по главе и списку реплик на сцену, аккорд на сцену`, () => {
    for (const l of langs) {
      assert.equal(film.i18n[l].chapters.length, film.scenes.length, l);
      assert.equal(film.i18n[l].voice.length, film.scenes.length, l);
    }
    assert.equal(film.score.length, film.scenes.length);
  });

  test(`${id}: у каждого, кто говорит, есть голос и манера`, () => {
    const cfg = voiceConfig(id);
    for (const l of langs) {
      const who = new Set(film.i18n[l].voice.flat().map(([, , w]) => w));
      for (const w of who) {
        const v = cfg.voice[l]; const ins = cfg.instructions[l];
        assert.ok(typeof v === 'string' || v?.[w], `voice.config.json: голос ${l}/${w}`);
        assert.ok(typeof ins === 'string' || ins?.[w], `voice.config.json: манера ${l}/${w}`);
      }
    }
  });

  test(`${id}: звуковые события — внутри сцены и известного вида`, () => {
    const envs = sceneEnvs(film, null);
    film.sfx(envs).forEach((list, i) => {
      for (const [t, kind] of list) {
        assert.ok(t >= 0 && t <= envs[i].dur, `сцена ${i + 1}: ${kind} @ ${t}`);
        assert.ok(FX_KINDS.includes(kind), `сцена ${i + 1}: неизвестный звук ${kind}`);
      }
    });
  });

  test(`${id}: реплики сцены не наезжают друг на друга и укладываются в сцену`, () => {
    const { chapters } = timeline(film, null);
    const list = cues(film, null);
    for (let k = 1; k < list.length; k++) {
      const a = list[k - 1]; const b = list[k];
      if (a.scene === b.scene) assert.ok(b.at >= a.at + a.dur, `сцена ${b.scene + 1}: «${b.text.slice(0, 30)}…»`);
    }
    for (const c of list) assert.ok(c.at + c.dur <= chapters[c.scene].dur, `сцена ${c.scene + 1} короче реплики`);
  });

  test(`${id}: сцены детерминированы — без Math.random, Date и часов`, () => {
    const src = strip(fs.readFileSync(path.join(ROOT, 'films', id, 'film.js'), 'utf8'));
    assert.doesNotMatch(src, /Math\.random|Date\.now|new Date|performance\.now/);
  });

  test(`${id}: манифест озвучки (если есть) совпадает с текстом и не черновой`, () => {
    for (const l of langs) {
      const f = path.join(ROOT, 'films', id, 'voice', `${l}.json`);
      if (!fs.existsSync(f)) continue;
      const m = JSON.parse(fs.readFileSync(f, 'utf8'));
      assert.notEqual(m.engine, 'espeak', `${l}: черновая озвучка espeak — не коммитить, пересоберите make voice`);
      const want = film.i18n[l].voice.flatMap((lines) => lines.map(([, text]) => text));
      assert.deepEqual(m.cues.map((c) => c.text), want, `${l}: текст поменялся — пересоберите make voice`);
    }
  });
}

test('раскладка реплик: null — сразу после предыдущей, явное время не раньше конца предыдущей', () => {
  const out = layout([[1, 'a', 'he'], [null, 'b', 'she'], [2, 'c', 'he']], () => 2);
  assert.deepEqual(out.map((c) => c.at), [1, 3.35, 5.7]);
});

test('движок и графика детерминированы', () => {
  for (const f of ['lib/engine.js', 'lib/overlay.js', 'lib/rigs.js']) {
    assert.doesNotMatch(strip(fs.readFileSync(path.join(ROOT, f), 'utf8')), /Math\.random|Date\.now|new Date|performance\.now/, f);
  }
});

test('sim/index.html: основной скрипт без синтаксических ошибок, есть API для съёмки', () => {
  const m = SIM.match(/<script>\n(\(function \(\) \{[\s\S]*?\}\)\(\);)\n<\/script>/);
  assert.ok(m, 'не нашёл основной <script> sim/index.html');
  assert.doesNotThrow(() => new Function(m[1]));
  for (const k of ['window.prism', 'compose(ctx, w, h, shots)', 'project(state, p, w, h)', 'hits(state', '?embed']) assert.ok(SIM.includes(k), k);
});

test('корневой index.html ведёт в симулятор и сохраняет код сцены', () => {
  const root = fs.readFileSync(path.join(ROOT, '..', 'index.html'), 'utf8');
  assert.match(root, /location\.replace\('sim\/' \+ location\.search \+ location\.hash\)/);
});
