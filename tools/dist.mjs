/* Сайт для выкладки → dist/ (не в git): содержимое папки копируется на хостинг как есть.
 * Языки — как в nemilya/scantunnel: у каждого свой URL, основной (en) — в корне (tools/site.mjs, site/).
 *   index.html, about/        — en: симулятор (стартовая без перехода) и «О проекте»
 *   ru/index.html, ru/about/  — ru: то же по-русски
 *   lang.js, sitemap.xml      — автовыбор языка, карта сайта с hreflang
 *   sim/                      — симулятор по старому адресу (старые ссылки /sim/#код и плеер video/ с ?embed)
 *   about/                    — ещё и картинки, стили и скрипт «О проекте» (общие для языков)
 *   media/                    — веб-версия ролика на каждом языке из out/<id>/web/ (make video + make web);
 *                               нет — «О проекте» ведёт в живой плеер
 *   video/                    — живой плеер (ролик рисуется из симулятора в браузере): только то, что нужно в браузере
 * Все ссылки относительные — сайт работает и из подпапки.
 *
 *   node tools/dist.mjs            # собрать (make dist)
 *   node tools/dist.mjs --serve    # собрать и открыть локально (make preview) */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import FILMS from '../video/films/index.js';
import { ROOT, render } from './site.mjs';

const DIST = join(ROOT, 'dist');
const VIDEO = join(ROOT, 'video');

function files() {
  const list = ['sim/index.html',
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

// страницы по языкам: симулятор и «О проекте» (в репозитории корневой index.html — переход в sim/)
const { files: pages, data } = await render();
for (const [f, body] of Object.entries(pages)) {
  mkdirSync(dirname(join(DIST, f)), { recursive: true });
  writeFileSync(join(DIST, f), body);
}

// веб-версия ролика: «О проекте» ссылается на media/<id>-<lang>.{mp4,jpg}
const missing = [];
for (const { id } of FILMS) {
  const web = join(ROOT, 'out', id, 'web');
  for (const { code } of data.site.locales) {
    const want = [`${id}-${code}.mp4`, `${id}-${code}.jpg`];
    if (want.every((f) => existsSync(join(web, f)))) {
      mkdirSync(join(DIST, 'media'), { recursive: true });
      for (const f of want) copyFileSync(join(web, f), join(DIST, 'media', f));
    } else missing.push([id, code]);
  }
}

const size = readdirSync(DIST, { recursive: true }).reduce((n, f) => {
  const st = statSync(join(DIST, f)); return n + (st.isFile() ? st.size : 0);
}, 0);
console.log(`dist/ готов: ${(size / 1e6).toFixed(1)} МБ — копируйте содержимое папки на хостинг как есть`);
console.log(`  страницы: ${Object.keys(pages).filter((f) => f.endsWith('.html')).join(', ')}`);
if (existsSync(join(DIST, 'media'))) for (const f of readdirSync(join(DIST, 'media'))) console.log(`  media/${f}`);
for (const [id, code] of missing) {
  console.log(`⚠ нет веб-версии ролика ${id} (${code}) в out/${id}/web/ — на странице «О проекте» (${code}) будет живой плеер.`);
  console.log(`  Сделать: make video FILM=${id} LANGS=${code} && make web FILM=${id} LANGS=${code} && make dist`);
}

if (process.argv.includes('--serve')) {
  const { serve } = await import('../video/scripts/browser.mjs');
  const port = Number(process.env.PORT || 8791);
  const { base } = await serve(port, '127.0.0.1', DIST);
  console.log(`\nОткройте: ${base}  (О проекте — ${base}about/, по-русски — ${base}ru/; Ctrl+C — остановить)`);
}
