/* Ролик → MP4 (H.264 + AAC) через Chromium + ffmpeg (из nemilya/n-dacha, video/scripts).
 * По умолчанию — форматы ролика (film.formats, обычно только 16:9), 720p:
 * out/<id>/<id>-<lang>-16x9-720p.mp4
 *
 *   make video FILM=refraction                                       # MP4 со звуком
 *   node video/scripts/video-render.mjs refraction ru --size 1080    # 1920×1080
 *   node video/scripts/video-render.mjs refraction ru --stills 3,12.5,40   # только PNG-кадры (проверка)
 *   node video/scripts/video-render.mjs refraction ru --subs   # с вшитыми субтитрами → <id>-<lang>-subs.mp4
 *   node video/scripts/video-render.mjs refraction ru --mute   # без звука, даже если озвучка есть
 *   node video/scripts/video-render.mjs refraction --poster    # только обложки poster-<lang>.jpg
 *   node video/scripts/video-render.mjs refraction ru --from 40 --to 60   # кусок ролика (черновик сцены)
 *
 * Кадры детерминированы: плеер в режиме ?render, для каждого кадра window.__video.seek(t)
 * и снимок экрана. 3D-кадр рисует симулятор sim/index.html?embed (WebGL; без видеокарты —
 * программно, SwiftShader, ~1 с на кадр в 720p). 25 кадров/с; FPS=30 — плавнее, дольше.
 *
 * Чтобы не перегревать ноутбук (кодирование x264 занимает все ядра):
 *   на Mac по умолчанию — аппаратный кодек VideoToolbox, процессор почти свободен (ENC=sw — x264)
 *   ENC=hw      — аппаратный кодек и на Linux/Windows (NVIDIA NVENC)
 *   THREADS=2   — ffmpeg (x264) не больше 2 потоков
 *   PAUSE=40    — пауза между кадрами, мс
 *   GPU=1 PAUSE=30 node video/scripts/video-render.mjs kd1-promo ru --format portrait */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { HW_ENC, OUT as OUT_ROOT, VIDEO, launch, rel, serve } from './browser.mjs';
import { cli } from './video-cli.mjs';

const FPS = Number(process.env.FPS || 25);
const PAUSE = Number(process.env.PAUSE || 0);
/** кодек: аппаратный (Mac по умолчанию, ENC=hw) или x264 (ENC=sw); битрейт аппаратного — по размеру кадра */
function videoCodec(pixels) {
  const threads = process.env.THREADS ? ['-threads', process.env.THREADS] : [];
  if (HW_ENC) {
    const rate = `${Math.round((pixels / 921600) * 4)}M`; // 4 Мбит/с на 1280×720 (для рассылки — make share)
    return process.platform === 'darwin'
      ? ['-c:v', 'h264_videotoolbox', '-b:v', rate, '-allow_sw', '1', '-realtime', '0']
      : ['-c:v', 'h264_nvenc', '-preset', 'p5', '-b:v', rate];
  }
  return ['-c:v', 'libx264', '-preset', process.env.THREADS ? 'medium' : 'slow', '-crf', '19', ...threads];
}
const { films, langs, opt } = await cli({ stills: '', mute: false, poster: false, subs: false, from: '', to: '', size: '720', format: '' });
const stills = opt.stills ? opt.stills.split(',').map(Number) : null;
const SIZE = Number(opt.size) || 720;
const formatsOf = (film) => (!opt.format ? film.formats ?? ['landscape']
  : opt.format === 'both' ? ['landscape', 'portrait'] : [opt.format === 'portrait' ? 'portrait' : 'landscape']);
const dims = (f) => { const l = Math.round((SIZE * 16) / 9 / 2) * 2; return f === 'portrait' ? [SIZE, l, '9x16'] : [l, SIZE, '16x9']; };

const { server, base } = await serve();
globalThis.__fontBase = base;
const { browser, page } = await launch({ width: 1280, height: 720 });
const cdp = await page.context().newCDPSession(page);
const grab = async () => Buffer.from((await cdp.send('Page.captureScreenshot',
  { format: 'jpeg', quality: 95, optimizeForSpeed: true })).data, 'base64');

for (const film of films) {
  const OUT = join(OUT_ROOT, film.id);
  mkdirSync(OUT, { recursive: true });
  for (const lang of langs.length ? langs : Object.keys(film.i18n)) for (const format of formatsOf(film)) {
    const [W, H, fname] = dims(format);
    const tag = `${lang}-${fname}-${SIZE}p`;
    await page.setViewportSize({ width: W, height: H });
    await page.goto(`${base}video/index.html?render&film=${film.id}&lang=${lang}&format=${format}&size=${SIZE}${opt.subs ? '&subs=1' : '&subs=0'}`);
    await page.waitForFunction(() => window.__video?.ready, null, { timeout: 180000 });
    const { duration, poster: posterT } = await page.evaluate(() => window.__video);

    if (stills) {
      const files = [];
      for (const t of stills) {
        await page.evaluate((x) => window.__video.seek(x), t);
        const f = join(OUT, `still-${tag}-${String(t).replace('.', '_')}.png`);
        await page.screenshot({ path: f });
        files.push(f);
      }
      // контактный лист: все кадры одной картинкой, по порядку времени (удобно смотреть разом)
      const sheet = join(OUT, `still-${tag}-sheet.png`);
      const cols = Math.min(files.length, W > H ? 3 : 5);
      const list = join(OUT, `still-${tag}-list.txt`);
      writeFileSync(list, files.map((f) => `file '${f}'`).join('\n'));
      const tw = W > H ? 640 : 300;
      spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
        '-vf', `scale=${tw}:-2,pad=iw+6:ih+6:3:3:white,tile=${cols}x${Math.ceil(files.length / cols)}`, '-frames:v', '1', sheet]);
      rmSync(list, { force: true });
      console.log(`${film.id} ${tag}: ${stills.length} кадров → ${rel(OUT)}/still-${tag}-*.png, все вместе: ${rel(sheet)}`);
      continue;
    }
    const poster = async () => {
      await page.evaluate((x) => window.__video.seek(x), posterT);
      await page.screenshot({ path: join(OUT, `poster-${lang}-${fname}.jpg`), type: 'jpeg', quality: 88 });
    };
    if (opt.poster) {
      await poster();
      console.log(`${film.id} ${tag}: обложка → ${rel(OUT)}/poster-${lang}-${fname}.jpg`);
      continue;
    }

    const t0s = opt.from ? Number(opt.from) : 0;
    const t1s = opt.to ? Math.min(Number(opt.to), duration) : duration;
    const part = t0s > 0 || t1s < duration;
    const file = join(OUT, `${film.id}-${tag}${opt.subs ? '-subs' : ''}${part ? `-${t0s}-${t1s}` : ''}.mp4`);
    // звук (make voice) — вторым входом; плеер уже растянул таймлайн под озвучку
    const voice = join(VIDEO, 'films', film.id, 'voice', `${lang}.m4a`);
    const audioIn = existsSync(voice) && !opt.mute
      ? ['-ss', String(t0s), '-i', voice, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '160k', '-af', 'apad', '-shortest'] : [];
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-',
      ...audioIn, ...videoCodec(W * H), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file],
    { stdio: ['pipe', 'inherit', 'inherit'] });
    const i0 = Math.round(t0s * FPS);
    const n = Math.round(t1s * FPS);
    const t0 = Date.now();
    for (let i = i0; i < n; i++) {
      await page.evaluate((x) => window.__video.seek(x), i / FPS);
      const buf = await grab();
      if (!ff.stdin.write(buf)) await new Promise((ok) => ff.stdin.once('drain', ok));
      if (PAUSE) await new Promise((ok) => setTimeout(ok, PAUSE));
      if ((i - i0) % FPS === 0) {
        const el = (Date.now() - t0) / 1000;
        const left = (el / (i - i0 + 1)) * (n - i);
        process.stdout.write(`\r${film.id} ${tag}: ${Math.round(((i - i0) / (n - i0)) * 100)}%, осталось ~${Math.ceil(left / 60)} мин   `);
      }
    }
    ff.stdin.end();
    await new Promise((ok, fail) => ff.on('close', (c) => (c ? fail(new Error(`ffmpeg ${c}`)) : ok())));
    if (!part) await poster();
    console.log(`\r${film.id} ${tag}: ${n - i0} кадров${audioIn.length ? ' + звук' : ''} за ${Math.round((Date.now() - t0) / 1000)} с → ${rel(file)}`);
  }
}
await browser.close();
server.close();
