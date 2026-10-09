/* Настройки сайта (tools/site.mjs → make dist / make play).
 *
 * Локали: первая — основная (корень сайта, x-default), остальные — в своих подпапках:
 *   /           симулятор (en)     /about/     «О проекте» (en)
 *   /ru/        симулятор (ru)     /ru/about/  «О проекте» (ru)
 * url — адрес сайта со слешем на конце: из него canonical, hreflang и sitemap.xml.
 * Все ссылки между страницами — относительные, сайт работает и из другой подпапки. */
export default {
  url: 'https://nemilya.me/projects/prism-rail/',
  locales: [
    { code: 'en', dir: '' },
    { code: 'ru', dir: 'ru' },
  ],
  github: 'https://github.com/nemilya/prism-rail',
  film: 'refraction', // ролик на странице «О проекте» (video/films/<id>/)
};
