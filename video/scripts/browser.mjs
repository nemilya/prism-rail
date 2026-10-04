/* Общее для скриптов рендера: статический сервер над корнем репозитория и Chromium
 * с программным WebGL. Внешние запросы sim/index.html подменяются локальными копиями:
 *   cdn.jsdelivr.net/npm/three@0.128.0/…  → video/node_modules/three/…
 *   cdn.jsdelivr.net/npm/tone@14.8.49/…   → video/node_modules/tone/…
 *   fonts.googleapis.com/…                → video/fonts/fonts.css
 * Поэтому рендер не зависит от сети, и кадры одинаковые при каждом запуске. */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';

import { chromium } from 'playwright';

export const VIDEO = resolve(import.meta.dirname, '..');
/** Аппаратный кодек: на macOS по умолчанию (VideoToolbox есть всегда), на остальных — x264.
 * ENC=hw — включить (NVIDIA NVENC на Linux/Windows), ENC=sw — x264 и на Mac. */
export const HW_ENC = process.env.ENC ? process.env.ENC === 'hw' : process.platform === 'darwin';
export const ROOT = resolve(VIDEO, '..');
/** Всё производное (MP4, кадры, обложки, картинки лендинга) — в out/ в корне, не в git */
export const OUT = join(ROOT, 'out');
/** путь для сообщений: от корня репозитория */
export const rel = (p) => p.replace(`${ROOT}/`, '');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.vtt': 'text/vtt',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
};

/** Статика из корня репозитория (или другой папки, например dist/), с Range (иначе Chrome не перематывает MP4 и звук) */
export function serve(port = 0, host = '127.0.0.1', root = ROOT) {
  const server = createServer((req, res) => {
    const p = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    let st;
    try {
      if (!p.startsWith(root)) throw new Error();
      st = statSync(p);
      if (!st.isFile()) throw new Error();
    } catch { res.writeHead(404).end(); return; }
    const type = TYPES[extname(p)] || 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const a = range[1] ? Number(range[1]) : 0;
      const b = range[2] ? Number(range[2]) : st.size - 1;
      res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${b}/${st.size}`, 'content-length': b - a + 1 });
      createReadStream(p, { start: a, end: b }).pipe(res);
      return;
    }
    res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': st.size, 'cache-control': 'no-cache' });
    createReadStream(p).pipe(res);
  });
  return new Promise((ok) => server.listen(port, host, () => ok({ server, base: `http://${host}:${server.address().port}/` })));
}

const NM = join(VIDEO, 'node_modules');

/** Chromium с WebGL и подменой внешних ресурсов.
 * По умолчанию — без окна, WebGL программный (SwiftShader): работает везде, в том числе
 * в облаке без видеокарты, но медленно (~1 с на кадр 720p).
 * На Mac и Windows по умолчанию — обычное окно Chromium и рендер на видеокарте (в разы быстрее,
 * окно не сворачивайте). GPU=0 — программный режим и там; GPU=1 — видеокарта и на Linux (нужен экран). */
const GPU = process.env.GPU ? process.env.GPU === '1' : process.platform === 'darwin' || process.platform === 'win32';
export async function launch({ width = 1920, height = 1080 } = {}) {
  if (!existsSync(join(NM, 'three'))) throw new Error('нет video/node_modules/three — запустите make install');
  const common = ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'];
  console.log(GPU ? 'рендер: видеокарта (окно Chromium — не сворачивайте)' : 'рендер: программный WebGL (SwiftShader) — медленно; на компьютере с экраном: GPU=1');
  const browser = await chromium.launch(GPU
    ? { headless: false, args: common }
    : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...common] })
    .catch((e) => {
      if (/Executable doesn't exist/.test(e.message)) {
        throw new Error('нет браузера для Playwright — в папке video/ выполните: npx playwright install chromium (или make install)');
      }
      throw e;
    });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await context.route(/^https:\/\/cdn\.jsdelivr\.net\/npm\/(three@0\.128\.0|tone@14\.8\.49)\/(.+)$/, (route) => {
    const [, pkg, rel] = /npm\/(three|tone)@[\d.]+\/(.+)$/.exec(route.request().url());
    const dir = join(NM, pkg);
    const file = join(dir, rel);
    if (!file.startsWith(dir) || !existsSync(file)) return route.fulfill({ status: 404 });
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(file) });
  });
  await context.route(/^https:\/\/fonts\.googleapis\.com\//, (route) => route.fulfill({
    status: 200, contentType: 'text/css',
    // пути шрифтов — абсолютные к локальному серверу: base подставляется в page.goto
    body: readFileSync(join(VIDEO, 'fonts', 'fonts.css'), 'utf8').replace(/url\(([^)]+)\)/g, (m, f) => `url(${globalThis.__fontBase || ''}video/fonts/${f})`),
  }));
  await context.route(/^https:\/\/fonts\.gstatic\.com\//, (route) => route.abort());
  const page = await context.newPage();
  page.on('pageerror', (e) => { console.error('pageerror:', e); process.exitCode = 1; });
  page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
  return { browser, context, page };
}
