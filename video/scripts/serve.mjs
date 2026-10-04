/* Плеер роликов локально: node video/scripts/serve.mjs [порт] → адреса всех роликов из films/index.js.
 * Отдаёт корень репозитория (плееру нужен ../sim/index.html), с Range — иначе Chrome
 * не перематывает звук. Симулятор берёт three.js с cdn.jsdelivr.net — нужен интернет. */
import FILMS from '../films/index.js';
import { serve } from './browser.mjs';

const port = Number(process.argv[2] || 8790);
const { base } = await serve(port);
console.log('Откройте в браузере (Ctrl+C — остановить):\n');
console.log(`  Лендинг\n    ${base}\n`);
for (const f of FILMS) {
  console.log(`  ${f.title}`);
  console.log(`    ${base}video/?film=${f.id}            (&t=40 — с 40-й секунды, &subs=1 — субтитры)`);
}
console.log(`\n  Симулятор\n    ${base}sim/`);
