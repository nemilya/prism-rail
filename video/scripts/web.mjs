/* Лёгкая версия ролика для сайта: out/<id>/web/ — постоянные имена, на них ссылается лендинг.
 *
 *   out/<id>/web/<id>-<lang>.mp4   H.264 720p, CRF 28, AAC 96 кбит/с стерео, +faststart (играет до загрузки)
 *   out/<id>/web/<id>-<lang>.jpg   обложка 1280×720 (атрибут poster у <video>)
 *   out/<id>/web/<id>-<lang>.vtt   субтитры из озвучки (<track kind="subtitles">)
 *
 * Исходник — самый крупный готовый MP4 ролика (out/<id>/<id>-<lang>-16x9-<size>p.mp4, без -subs),
 * обложка — out/<id>/poster-<lang>-16x9.jpg; их делает make video. Исходники не меняются.
 *
 *   make web FILM=refraction                  # 720p, CRF 28
 *   make web FILM=refraction CRF=31 HEIGHT=540   # ещё легче
 *
 * --crf: больше — меньше файл и хуже картинка (+3 ≈ на треть меньше; 23 — почти без потерь).
 * Всегда x264 (и на Mac): аппаратный кодек плохо держит низкий битрейт. */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { OUT as OUT_ROOT, VIDEO, rel } from './browser.mjs';
import { cli } from './video-cli.mjs';

const { films, langs, opt } = await cli({ crf: '28', height: '720' });
const CRF = String(opt.crf);
const HEIGHT = Number(opt.height);

const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const mb = (f) => `${(statSync(f).size / 2 ** 20).toFixed(1)} МБ`;

let made = 0;
for (const film of films) {
  const OUT = join(OUT_ROOT, film.id);
  const WEB = join(OUT, 'web');
  for (const lang of langs.length ? langs : Object.keys(film.i18n)) {
    const re = new RegExp(`^${film.id}-${lang}-16x9-(\\d+)p\\.mp4$`);
    const src = (existsSync(OUT) ? readdirSync(OUT) : [])
      .map((f) => [f, Number(f.match(re)?.[1])]).filter(([, p]) => p)
      .sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!src) {
      console.error(`${film.id} ${lang}: нет готового MP4 в ${rel(OUT)}/ — сначала make video FILM=${film.id}`);
      continue;
    }
    mkdirSync(WEB, { recursive: true });
    const base = join(WEB, `${film.id}-${lang}`);
    ff(['-i', join(OUT, src),
      '-vf', `scale=-2:${HEIGHT}:flags=lanczos`, '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF,
      '-tune', 'film', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart', `${base}.mp4`]);
    const poster = join(OUT, `poster-${lang}-16x9.jpg`);
    if (existsSync(poster)) ff(['-i', poster, '-vf', `scale=-2:${HEIGHT}:flags=lanczos`, '-q:v', '4', `${base}.jpg`]);
    else console.warn(`  ⚠ нет обложки ${rel(poster)} — make poster FILM=${film.id}`);
    const vtt = join(VIDEO, 'films', film.id, 'voice', `${lang}.vtt`);
    if (existsSync(vtt)) copyFileSync(vtt, `${base}.vtt`);
    console.log(`${film.id} ${lang}: ${src} (${mb(join(OUT, src))}) → ${rel(base)}.mp4 (${mb(`${base}.mp4`)})`);
    made++;
  }
}
if (!made) process.exit(1);
