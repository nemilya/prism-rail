/* Общий разбор аргументов скриптов видео:
 *   node video/scripts/video-<x>.mjs <film>|all [<lang> …] [--opt value] [--flag]
 * film — id из video/films/index.js или all (все ролики); без него скрипт показывает список
 * роликов и выходит. Языки — коды из i18n ролика (по умолчанию все).
 * opts — {имя: значение по умолчанию}; булевы — флаги без значения. */
import { basename } from 'node:path';

import FILMS from '../films/index.js';

// какой make-цели соответствует скрипт — для подсказки
const TARGET = { 'video-voice.mjs': 'voice', 'video-render.mjs': 'video', 'video-sound.mjs': 'sound' };

/** список роликов и как запустить — когда ролик не указан или указан неверно */
function usage(problem) {
  const target = TARGET[basename(process.argv[1] || '')] || 'video';
  const w = Math.max(...FILMS.map((f) => f.id.length));
  console.error(`${problem}

Ролики (films/index.js):`);
  for (const f of FILMS) console.error(`  ${f.id.padEnd(w)}  ${f.title || ''}`);
  console.error(`
Например:  make ${target} FILM=${FILMS.at(-1).id}      все сразу:  make ${target} FILM=all`);
  process.exit(1);
}

export async function cli(opts = {}) {
  const args = process.argv.slice(2);
  const opt = { ...opts };
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2);
    if (typeof opts[k] === 'boolean' || !(k in opts)) opt[k] = true;
    else opt[k] = args[++i];
  }
  const ids = FILMS.map((f) => f.id);
  let pick = ids;
  if (pos[0] === 'all') pos.shift();
  else if (ids.includes(pos[0])) pick = [pos.shift()];
  else if (!pos.length || /^[a-z]{2,3}$/.test(pos[0])) usage('Какой ролик? Укажите FILM=<id>.');
  else usage(`Нет ролика «${pos[0]}».`);
  const films = [];
  for (const id of pick) {
    const { default: film } = await import(`../films/${id}/film.js`);
    films.push(film);
  }
  return { films, langs: pos, opt };
}
