/* Сайт для выкладки → dist/ (не в git): содержимое папки копируется на хостинг как есть.
 *   index.html     — переход в симулятор (код сцены из #hash сохраняется)
 *   sim/           — симулятор
 *   about/         — «О проекте»: ролик, физика, вдохновение
 *   media/         — веб-версия ролика из out/<id>/web/ (make video + make web); нет — about/ ведёт в живой плеер
 *   video/         — живой плеер (ролик рисуется из симулятора в браузере): только то, что нужно в браузере
 * Все ссылки относительные — сайт работает и из подпапки.
 *
 *   node tools/dist.mjs            # собрать (make dist)
 *   node tools/dist.mjs --serve    # собрать и открыть локально (make preview) */
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import FILMS from '../video/films/index.js';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const VIDEO = join(ROOT, 'video');

function files() {
  const list = ['index.html', 'sim/index.html',
    'video/index.html', 'video/player.js', 'video/player.css', 'video/films/index.js',
    'video/lib/engine.js', 'video/lib/overlay.js', 'video/lib/rigs.js'];
  for (const f of readdirSync(join(ROOT, 'about'))) list.push(`about/${f}`);
  for (const f of readdirSync(join(VIDEO, 'fonts'))) list.push(`video/fonts/${f}`);
  for (const { id } of FILMS) {
    list.push(`video/films/${id}/film.js`, `video/films/${id}/i18n.js`);
    const voice = join(VIDEO, 'films', id, 'voice');
    if (existsSync(voice)) for (const f of readdirSync(voice)) if (/\.(json|m4a|vtt)$/.test(f)) list.push(`video/films/${id}/voice/${f}`);
  }
  return list;
}

rmSync(DIST, { recursive: true, force: true });
for (const f of files()) {
  mkdirSync(dirname(join(DIST, f)), { recursive: true });
  copyFileSync(join(ROOT, f), join(DIST, f));
}

// веб-версия ролика: about/ ссылается на ../media/<id>-ru.{mp4,jpg}
const missing = [];
for (const { id } of FILMS) {
  const web = join(ROOT, 'out', id, 'web');
  const want = [`${id}-ru.mp4`, `${id}-ru.jpg`];
  if (want.every((f) => existsSync(join(web, f)))) {
    mkdirSync(join(DIST, 'media'), { recursive: true });
    for (const f of want) copyFileSync(join(web, f), join(DIST, 'media', f));
  } else missing.push(id);
}

const size = readdirSync(DIST, { recursive: true }).reduce((n, f) => {
  const st = statSync(join(DIST, f)); return n + (st.isFile() ? st.size : 0);
}, 0);
console.log(`dist/ готов: ${(size / 1e6).toFixed(1)} МБ — копируйте содержимое папки на хостинг как есть`);
if (existsSync(join(DIST, 'media'))) for (const f of readdirSync(join(DIST, 'media'))) console.log(`  media/${f}`);
for (const id of missing) {
  console.log(`⚠ нет веб-версии ролика ${id} (out/${id}/web/) — на странице «О проекте» будет живой плеер.`);
  console.log(`  Сделать: make video FILM=${id} && make web FILM=${id} && make dist`);
}

if (process.argv.includes('--serve')) {
  const { serve } = await import('../video/scripts/browser.mjs');
  const port = Number(process.env.PORT || 8791);
  const { base } = await serve(port, '127.0.0.1', DIST);
  console.log(`\nОткройте: ${base}  (О проекте — ${base}about/; Ctrl+C — остановить)`);
}
