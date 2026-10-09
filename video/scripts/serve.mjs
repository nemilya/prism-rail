/* Сайт и плеер роликов локально: node video/scripts/serve.mjs [порт] → адреса страниц и роликов.
 * Отдаёт корень репозитория (плееру нужен ../sim/index.html), с Range — иначе Chrome
 * не перематывает звук. Страницы по языкам (симулятор и «О проекте», tools/site.mjs) собираются
 * на каждый запрос — правки site/ и sim/ видны после обновления страницы.
 * Симулятор берёт three.js с cdn.jsdelivr.net — нужен интернет. */
import { render } from '../../tools/site.mjs';
import FILMS from '../films/index.js';
import { serve } from './browser.mjs';

const port = Number(process.argv[2] || 8790);
const { base } = await serve(port, undefined, undefined, async () => (await render(true)).files);
console.log('Откройте в браузере (Ctrl+C — остановить):\n');
console.log(`  Симулятор — стартовая страница\n    ${base}            по-русски: ${base}ru/\n`);
console.log(`  О проекте: ролик, физика, вдохновение\n    ${base}about/      по-русски: ${base}ru/about/\n`);
for (const f of FILMS) {
  console.log(`  ${f.title}`);
  console.log(`    ${base}video/?film=${f.id}            (&lang=ru — по-русски, &t=40 — с 40-й секунды, &subs=1 — субтитры)`);
}
console.log(`\n  Симулятор без обёртки сайта\n    ${base}sim/        (?lang=ru — по-русски)`);
