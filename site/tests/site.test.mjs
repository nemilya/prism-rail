/* Сайт по языкам: словари согласованы, страницы собираются, ссылки ведут на существующие файлы,
 * симулятор переведён целиком, автовыбор языка (site/lang.js) выбирает и уводит как задумано. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { ROOT, render } from '../../tools/site.mjs';

const { files, data } = await render();
const CYR = /[А-Яа-яЁё]/;

test('страницы: симулятор и «О проекте» на каждом языке, lang.js, sitemap.xml', () => {
  assert.deepEqual(Object.keys(files).sort(),
    ['about/index.html', 'index.html', 'lang.js', 'ru/about/index.html', 'ru/index.html', 'sitemap.xml']);
  for (const [f, html] of Object.entries(files)) {
    if (!f.endsWith('.html')) continue;
    const lang = f.startsWith('ru/') ? 'ru' : 'en';
    assert.match(html, new RegExp(`<html lang="${lang}">`), f);
    assert.doesNotMatch(html, /\{\{[\w.]+\}\}/, `${f}: не подставлен ключ`);
    for (const l of ['en', 'ru', 'x-default']) assert.match(html, new RegExp(`hreflang="${l}" href="https://`), `${f}: hreflang ${l}`);
  }
});

test('английская «О проекте» — без русского текста (кроме названия языка в переключателе)', () => {
  const html = files['about/index.html']
    .replace(/data-suggest="[^"]*"|data-go="[^"]*"|data-close="[^"]*"|title="Русский"/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(html, CYR, html.match(/.{0,40}[А-Яа-яЁё].{0,40}/)?.[0]);
});

test('относительные ссылки страниц ведут на существующие файлы (media/ — веб-ролик, его кладёт make dist)', () => {
  for (const [f, html] of Object.entries(files)) {
    if (!f.endsWith('.html')) continue;
    for (const [, url] of html.matchAll(/(?:href|src|poster|data-href)="([^"]+)"/g)) {
      if (/^(https?:|data:|#|mailto:)/.test(url) || url.startsWith('?')) continue;
      const clean = url.replace(/[?#].*$/, '').replace(/&amp;.*$/, '');
      let target = path.posix.normalize(path.posix.join(path.posix.dirname(f), clean));
      if (target.startsWith('..')) assert.fail(`${f}: ${url} выходит за корень сайта`);
      if (target.startsWith('media/')) continue;
      if (target.endsWith('/') || target === '.') target = path.posix.join(target, 'index.html');
      assert.ok(target in files || fs.existsSync(path.join(ROOT, target)), `${f}: ${url} → ${target}`);
    }
  }
});

test('«О проекте»: главы и время в ссылках — из ролика, плашка «тестовый ролик»', () => {
  for (const f of ['about/index.html', 'ru/about/index.html']) {
    const html = files[f];
    const items = [...html.matchAll(/<li><a href="#video" data-t="([\d.]+)">/g)].map((m) => +m[1]);
    assert.equal(items.length, data.film.scenes.length - 1, f);
    assert.ok(items.every((t, i) => !i || t > items[i - 1]), `${f}: главы по порядку`);
    assert.match(html, /<p class="disclaimer">[^<]*Claude Opus[^<]*<\/p>/, f);
  }
});

// ---------------------------------------------------------------- симулятор: перевод интерфейса
const SIM = fs.readFileSync(path.join(ROOT, 'sim', 'index.html'), 'utf8');
const RU = new Function(`return ${SIM.match(/var RU = (\{[\s\S]*?\n {2}\});/)[1]}`)();

test('симулятор: вся разметка интерфейса на английском и есть в словаре RU', () => {
  const body = SIM.slice(SIM.indexOf('<body>'), SIM.indexOf('<script>')).replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(body, CYR);
  const texts = [...body.matchAll(/>([^<>]+)</g)].map((m) => m[1].trim())
    .concat([...body.matchAll(/(?:title|aria-label)="([^"]+)"/g)].map((m) => m[1]))
    .filter((s) => /[A-Za-z]{2}/.test(s) && !/^Prism Rail$/.test(s));
  const missing = [...new Set(texts)].filter((s) => !(s in RU) && s !== 'Camera: cinema');
  assert.deepEqual(missing, [], 'нет перевода в RU (sim/index.html)');
});

test('симулятор: каждая строка t(…) в коде есть в RU, в RU нет лишних ключей', () => {
  const code = SIM.slice(SIM.indexOf("'use strict';"));
  const calls = [...code.matchAll(/\bt\('((?:[^'\\]|\\.)*)'\)/g)].map((m) => m[1]);
  const paused = ['Resume', 'Pause', 'Sound on', 'Sound off'];  // t(cond ? 'a' : 'b')
  for (const s of calls) assert.ok(s in RU, `t('${s}')`);
  for (const k of Object.keys(RU)) assert.ok(SIM.includes(`>${k}<`) || SIM.includes(`"${k}"`) || SIM.includes(`'${k}'`) || SIM.includes(`>${k} <`) || paused.includes(k), `лишний ключ RU: «${k}»`);
});

// ---------------------------------------------------------------- автовыбор языка (site/lang.js)
const LANG = fs.readFileSync(path.join(ROOT, 'site', 'lang.js'), 'utf8');
const AVAIL = ['en', 'ru'];
const HREF = { en: './', ru: 'ru/' };
function run({ page = 'en', saved = null, langs = ['en-US'], tz = 'Europe/Berlin', ua = 'Mozilla/5.0', referrer = '', origin = 'https://x.example' } = {}) {
  let to = null;
  const links = AVAIL.map((c) => ({ hreflang: c, getAttribute: () => HREF[c] }));
  const ctx = {
    document: { documentElement: { lang: page }, referrer, querySelectorAll: () => links },
    navigator: { languages: langs, language: langs[0], userAgent: ua },
    localStorage: { getItem: () => saved },
    location: { origin, search: '', hash: '#clover.300.spectrum.40.10.lumen-482', replace: (u) => { to = u; } },
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: tz }) }) },
    URL,
  };
  vm.runInNewContext(LANG, ctx);
  return { to, site: ctx.prismSite };
}
const pick = (o) => run().site.pick({ available: AVAIL, ...o });

test('выбор языка: явный → язык браузера → страна по поясу → en', () => {
  assert.equal(pick({ saved: 'en', langs: ['ru-RU'], tz: 'Europe/Moscow' }), 'en');
  assert.equal(pick({ saved: 'xx', langs: ['ru-RU'] }), 'ru');
  assert.equal(pick({ langs: ['ru-RU'], tz: 'America/New_York' }), 'ru');
  assert.equal(pick({ langs: ['en-GB'], tz: 'Europe/Moscow' }), 'ru');
  assert.equal(pick({ langs: ['en-US'], tz: 'Asia/Almaty' }), 'ru');
  assert.equal(pick({ langs: ['de-DE'], tz: 'Europe/Berlin' }), 'en');
  assert.equal(pick({ langs: ['uk-UA'], tz: 'Europe/Kyiv' }), 'en');
  assert.equal(pick({ langs: [], tz: '' }), 'en');
  for (const tz of Object.keys(run().site.TZ)) {
    // опечатка в имени пояса — RangeError
    assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: tz }), tz);
  }
});

test('уводим только с основной страницы, только человека снаружи, код сцены — с собой', () => {
  assert.equal(run({ langs: ['ru-RU'] }).to, 'ru/#clover.300.spectrum.40.10.lumen-482');
  assert.equal(run({ langs: ['ru-RU'], ua: 'Googlebot/2.1' }).to, null, 'бот');
  assert.equal(run({ langs: ['ru-RU'], referrer: 'https://x.example/about/' }).to, null, 'переход внутри сайта');
  assert.equal(run({ langs: ['ru-RU'], referrer: 'https://google.com/' }).to, 'ru/#clover.300.spectrum.40.10.lumen-482');
  assert.equal(run({ page: 'ru', langs: ['en-US'] }).to, null, 'с /ru/ не уводим');
  assert.equal(run({ page: 'ru', langs: ['en-US'] }).site.current, 'en', 'но плашку предложим');
  assert.equal(run({ langs: ['ru-RU'], saved: 'en' }).to, null, 'выбрал сам');
});
