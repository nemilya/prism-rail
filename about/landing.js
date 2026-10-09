/* Страница «О проекте» (шаблон site/about.html, по языкам — tools/site.mjs): главы и ссылки «в ролике с …»
 * перематывают видео; подсветка текущей главы. Нет MP4 в media/ (в dist/ его кладёт make dist из
 * out/<id>/web/) — показываем ссылку на живой плеер video/, и главы открывают его с нужной секунды (&t=).
 * Язык: клик по EN / RU запоминается (prism-lang); если lang.js выбрал другой язык, чем у страницы, —
 * плашка «Эта страница есть на …» (с основной страницы lang.js уводит сам, см. site/lang.js). */
(() => {
  const clip = document.getElementById('clip');
  const live = document.getElementById('live');
  const links = [...document.querySelectorAll('[data-t]')];
  const chapters = [...document.querySelectorAll('#chapters a')];
  let offline = false;

  function useLivePlayer() {
    if (offline) return;
    offline = true;
    clip.hidden = true;
    live.hidden = false;
    for (const a of links) a.href = `${live.getAttribute('href')}&t=${Math.floor(+a.dataset.t)}`;
  }
  const source = clip.querySelector('source');
  source.addEventListener('error', useLivePlayer);
  clip.addEventListener('error', useLivePlayer);
  if (clip.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) useLivePlayer();

  // нет обложки — кадр из симулятора
  const probe = new Image();
  const hero = document.querySelector('.hero__bg').getAttribute('src');
  probe.onerror = () => {
    clip.poster = hero;
    live.querySelector('img').src = hero;
  };
  probe.src = clip.getAttribute('poster');

  for (const a of links) {
    a.addEventListener('click', (e) => {
      if (offline) return;
      e.preventDefault();
      document.getElementById('video').scrollIntoView({ behavior: 'smooth', block: 'start' });
      clip.currentTime = +a.dataset.t;
      clip.play().catch(() => {});
    });
  }

  clip.addEventListener('timeupdate', () => {
    const t = clip.currentTime;
    let cur = 0;
    chapters.forEach((a, i) => { if (t >= +a.dataset.t - 0.05) cur = i; });
    chapters.forEach((a, i) => a.classList.toggle('on', i === cur && (t > 0 || !clip.paused)));
  });

  // язык: явный выбор запоминается — по нему lang.js больше не уводит и не предлагает другой язык
  const KEY = window.prismSite?.KEY || 'prism-lang';
  const remember = (code) => { try { localStorage.setItem(KEY, code); } catch { /* приватный режим */ } };
  for (const a of document.querySelectorAll('.langs a[data-lang]')) a.addEventListener('click', () => remember(a.dataset.lang));

  const page = document.documentElement.lang;
  const want = window.prismSite?.current;
  const alt = want && want !== page && document.querySelector(`link[rel="alternate"][hreflang="${want}"][data-suggest]`);
  if (alt) {
    const bar = document.createElement('div');
    bar.className = 'suggest';
    bar.lang = want;
    const text = document.createElement('span');
    text.textContent = alt.dataset.suggest;
    const go = document.createElement('a');
    go.className = 'suggest__go';
    go.href = alt.dataset.href + location.hash;
    go.textContent = alt.dataset.go;
    go.addEventListener('click', () => remember(want));
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'suggest__close';
    close.setAttribute('aria-label', alt.dataset.close);
    close.textContent = '×';
    close.addEventListener('click', () => { remember(page); bar.remove(); });
    bar.append(text, go, close);
    document.body.prepend(bar);
  }
})();
