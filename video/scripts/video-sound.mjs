/* Черновик музыки и звуков без голоса — послушать и подстроить:
 *   node video/scripts/video-sound.mjs refraction ru → video/films/<id>/voice/clips/{music,fx}-<lang>.wav
 * Таймлайн — из манифеста озвучки, если он есть (сцены продлены под голос). */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { sceneEnvs, timeline } from '../lib/engine.js';
import { synth, wav } from '../lib/sound.mjs';
import { cli } from './video-cli.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const { films, langs } = await cli();
for (const film of films) {
  const dir = join(ROOT, 'films', film.id, 'voice');
  mkdirSync(join(dir, 'clips'), { recursive: true });
  for (const lang of langs.length ? langs : ['ru']) {
    const mf = join(dir, `${lang}.json`);
    const voice = existsSync(mf) ? JSON.parse(readFileSync(mf, 'utf8')) : null;
    const tl = timeline(film, voice, lang);
    const t0 = Date.now();
    const { music, fx, events } = synth({ ...tl, sfx: film.sfx(sceneEnvs(film, voice, lang)), score: film.score });
    wav(join(dir, 'clips', `music-${lang}.wav`), music);
    wav(join(dir, 'clips', `fx-${lang}.wav`), fx);
    console.log(`${film.id} ${lang}: ${tl.duration.toFixed(1)} с, ${events.length} звуков, ${Date.now() - t0} мс → ${dir.replace(`${ROOT}/`, 'video/')}/clips/{music,fx}-${lang}.wav`);
  }
}
