/* Страница «О проекте» (about/): главы и ссылки «в ролике с …» перематывают видео; подсветка текущей главы.
 * Нет MP4 в media/ (в dist/ его кладёт make dist из out/<id>/web/) — показываем ссылку на живой плеер video/,
 * и главы открывают его с нужной секунды (&t=). */
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
    for (const a of links) a.href = `../video/?film=refraction&t=${Math.floor(+a.dataset.t)}`;
  }
  const source = clip.querySelector('source');
  source.addEventListener('error', useLivePlayer);
  clip.addEventListener('error', useLivePlayer);
  if (clip.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) useLivePlayer();

  // нет обложки — кадр из симулятора
  const probe = new Image();
  probe.onerror = () => {
    clip.poster = 'hero.jpg';
    live.querySelector('img').src = 'hero.jpg';
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
})();
