/* Страницы сайта по языкам (по образцу nemilya/scantunnel, landing/build.mjs): одна раскладка — свои
 * тексты, свой URL, свой <html lang>, hreflang на все языки. Общее для make dist (tools/dist.mjs)
 * и make play (video/scripts/serve.mjs отдаёт эти же страницы на лету).
 *
 *   <dir>/index.html        симулятор: копия sim/index.html — lang, описание, hreflang, lang.js;
 *                           подписи интерфейса переводит сам симулятор (словарь RU в sim/index.html)
 *   <dir>/about/index.html  «О проекте»: шаблон site/about.html + словарь site/i18n/<code>.mjs;
 *                           главы и длительность — из ролика (таймлайн под озвучку языка)
 *   lang.js, sitemap.xml    автовыбор языка (site/lang.js); карта сайта со всеми языками
 *
 * <dir> — '' у основной локали (en), 'ru' у русской: site/site.mjs.
 * Шаблон: {{key}} — строка из словаря или служебное значение (vars ниже); неизвестный ключ
 * или расхождение ключей между словарями — ошибка сборки. */
import { existsSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { timeline } from '../video/lib/engine.js';

export const ROOT = resolve(import.meta.dirname, '..');
const SITE_DIR = join(ROOT, 'site');

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** site.mjs + словари; fresh — перечитать с диска (make play: правки видны без перезапуска) */
export async function loadSite(fresh = false) {
  const q = fresh ? `?t=${Date.now()}` : '';
  const imp = (f) => import(pathToFileURL(join(SITE_DIR, f)).href + q).then((m) => m.default);
  const site = await imp('site.mjs');
  const dicts = {};
  for (const l of site.locales) dicts[l.code] = await imp(`i18n/${l.code}.mjs`);
  checkKeys(dicts);
  const { default: film } = await import(pathToFileURL(join(ROOT, 'video', 'films', site.film, 'film.js')).href);
  return { site, dicts, film };
}

/** У всех словарей одинаковый набор ключей */
export function checkKeys(dicts) {
  const [base, ...rest] = Object.keys(dicts);
  const want = Object.keys(dicts[base]).sort();
  for (const code of rest) {
    const got = Object.keys(dicts[code]).sort();
    const missing = want.filter((k) => !got.includes(k));
    const extra = got.filter((k) => !want.includes(k));
    if (missing.length || extra.length) throw new Error(`site/i18n/${code}.mjs расходится с ${base}.mjs: нет [${missing}], лишние [${extra}]`);
  }
}

/** каталог страницы от корня сайта: '' | 'ru' | 'about' | 'ru/about' */
const dirOf = (locale, kind) => posix.join(locale.dir || '.', kind === 'about' ? 'about' : '.').replace(/^\.$/, '').replace(/^\.\//, '');
/** относительная ссылка из каталога from в каталог to ('./', '../', 'ru/', '../../about/') */
export function linkBetween(from, to) {
  const r = posix.relative(`/${from}`, `/${to}`);
  return r ? `${r}/` : './';
}
/** путь файла страницы в dist/ */
export const fileOf = (locale, kind) => posix.join(dirOf(locale, kind), 'index.html');

/** Общее для <head>: canonical, hreflang (+ data-href для lang.js и переключателя), lang.js */
function head({ site, dicts }, locale, kind) {
  const here = dirOf(locale, kind);
  const abs = (l) => site.url + (dirOf(l, kind) ? `${dirOf(l, kind)}/` : '');
  const out = [`<link rel="canonical" href="${abs(locale)}">`];
  for (const l of site.locales) {
    const d = dicts[l.code];
    out.push(`<link rel="alternate" hreflang="${l.code}" href="${abs(l)}" data-href="${linkBetween(here, dirOf(l, kind))}" data-suggest="${escAttr(d.suggest)}" data-go="${escAttr(d.suggestGo)}" data-close="${escAttr(d.suggestClose)}">`);
  }
  out.push(`<link rel="alternate" hreflang="x-default" href="${abs(site.locales[0])}">`);
  out.push(`<script src="${linkBetween(here, '')}lang.js"></script>`);
  return out.join('\n');
}

/** Симулятор на языке locale: ссылки ../about/ → ./about/ (страница лежит в корне локали) */
export function renderSim(data, locale) {
  const src = readFileSync(join(ROOT, 'sim', 'index.html'), 'utf8');
  let html = src.replace(/href="\.\.\//g, 'href="');
  if (html === src || /(src|href)="\.\.\//.test(html)) throw new Error('sim/index.html: не нашлись ссылки ../ — проверьте tools/site.mjs');
  const desc = /<meta name="description" content="[^"]*">/;
  if (!/<html lang="en">/.test(html) || !desc.test(html)) throw new Error('sim/index.html: нет <html lang="en"> или <meta name="description">');
  html = html.replace('<html lang="en">', `<html lang="${locale.code}">`)
    .replace(desc, `<meta name="description" content="${escAttr(data.dicts[locale.code]['sim.description'])}">`)
    .replace('</head>', `${head(data, locale, 'sim')}\n</head>`);
  return html;
}

/** Главы ролика на языке lang: таймлайн по озвучке (video/films/<id>/voice/<lang>.json) или по оценке */
export function filmInfo(film, lang) {
  const f = join(ROOT, 'video', 'films', film.id, 'voice', `${lang}.json`);
  const voice = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
  const { chapters, duration } = timeline(film, voice, lang);
  // как в плеере: глава начинается, когда кроссфейд закончился
  const at = chapters.map((c, i) => (i ? Math.round((c.start + c.xf) * 10) / 10 : 0));
  return { at, duration, ids: chapters.map((c) => c.id), voiced: !!voice };
}

export function renderAbout(data, locale) {
  const { site, dicts, film } = data;
  const t = dicts[locale.code];
  const F = film.i18n[locale.code] ?? film.i18n[Object.keys(film.i18n)[0]];
  const lang = film.i18n[locale.code] ? locale.code : Object.keys(film.i18n)[0];
  const here = dirOf(locale, 'about');
  const root = linkBetween(here, '');
  const info = filmInfo(film, lang);
  const time = (id) => info.at[info.ids.indexOf(id)];
  // главы — без финальной карточки
  const chapterItems = info.ids.slice(0, -1).map((id, i) =>
    `<li><a href="#video" data-t="${info.at[i]}"><time>${fmtT(info.at[i])}</time>${F.chapters[i]}</a></li>`).join('\n      ');
  const captions = `video/films/${film.id}/voice/${lang}.vtt`;
  const vars = {
    ...Object.fromEntries(Object.entries(t).filter(([, v]) => typeof v === 'string')),
    lang: locale.code,
    head: head(data, locale, 'about'),
    assets: linkBetween(here, 'about'),
    github: site.github,
    langSwitch: site.locales.map((l) => {
      const cur = l.code === locale.code;
      return `<a href="${linkBetween(here, dirOf(l, 'about'))}" hreflang="${l.code}" lang="${l.code}" data-lang="${l.code}" title="${escAttr(dicts[l.code].langName)}"${cur ? ' aria-current="page"' : ''}>${l.code.toUpperCase()}</a>`;
    }).join(''),
    filmMinutes: `${Math.max(1, Math.round(info.duration / 60))} ${t['hero.minutes']}`,
    media: `${root}media/${film.id}-${lang}`,
    track: existsSync(join(ROOT, captions)) ? `<track kind="captions" srclang="${lang}" label="${escAttr(t['video.captions'])}" src="${root}${captions}">` : '',
    livePlayer: `${root}video/?film=${film.id}&amp;lang=${lang}`,
    chapterItems,
    'video.disclaimer': (F.disclaimer ?? '').replace(/\n/g, ' '),
  };
  for (const id of ['snell', 'dispersion', 'rainbow', 'dichroic']) {
    vars[`t.${id}`] = String(time(id));
    vars[`time.${id}`] = fmtT(time(id));
  }
  const tpl = readFileSync(join(SITE_DIR, 'about.html'), 'utf8');
  return tpl.replace(/\{\{([\w.]+)\}\}/g, (m, key) => {
    if (!(key in vars)) throw new Error(`site/about.html (${locale.code}): нет значения для {{${key}}}`);
    return vars[key];
  });
}

export function sitemap(site) {
  const urls = [];
  for (const kind of ['sim', 'about']) {
    const abs = (l) => site.url + (dirOf(l, kind) ? `${dirOf(l, kind)}/` : '');
    const alt = site.locales.map((l) => `    <xhtml:link rel="alternate" hreflang="${l.code}" href="${abs(l)}"/>`)
      .concat(`    <xhtml:link rel="alternate" hreflang="x-default" href="${abs(site.locales[0])}"/>`).join('\n');
    for (const l of site.locales) urls.push(`  <url>\n    <loc>${abs(l)}</loc>\n${alt}\n  </url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
}

/** Все сгенерированные файлы сайта: { 'index.html': html, 'ru/about/index.html': html, 'lang.js': …, … } */
export async function render(fresh = false) {
  const data = await loadSite(fresh);
  const out = {};
  for (const l of data.site.locales) {
    out[fileOf(l, 'sim')] = renderSim(data, l);
    out[fileOf(l, 'about')] = renderAbout(data, l);
  }
  out['lang.js'] = readFileSync(join(SITE_DIR, 'lang.js'), 'utf8');
  out['sitemap.xml'] = sitemap(data.site);
  return { files: out, data };
}
