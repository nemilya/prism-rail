# Ролики Prism Rail

Обучающие ролики по симулятору: настоящие кадры `sim/` + чертежи «мелом», формулы, озвучка диалогом,
синтезированные музыка и звуки. Конвейер перенесён из `nemilya/n-dacha` (`video/`): тот же формат сцен,
озвучки и рендера; 3D-кадр рисует сам симулятор в режиме `sim/index.html?embed` (API `window.prism`).

| ролик | что это | сценарий |
|---|---|---|
| `refraction` | «Откуда в темноте радуга» (en: «A rainbow in the dark»), ~3,5 мин, английский и русский: одно стекло в луче → стоп-кадр уходит в чертёж → преломление и закон Снеллиуса → дисперсия в призме → радуга в капле → дихроичное стекло и сдвиг цвета с углом → обратно в комнату с живыми числами | `SCRIPT-refraction.md` |

```bash
make install                              # Playwright + локальные three.js и Tone.js (в облаке — хук сессии)
make test                                 # тексты, сцены, звуки, детерминизм, API симулятора
make play                                 # плеер: http://127.0.0.1:8790/video/?film=refraction (&t=40, &subs=1)
make stills FILM=refraction T=5,40,90     # пробные кадры + контактный лист out/refraction/still-*-sheet.png
make voice FILM=refraction LANGS=en       # озвучка (нужен OPENROUTER_API_KEY) + музыка и звуки → films/refraction/voice/en.m4a
make video FILM=refraction LANGS=en       # MP4 1280×720 со звуком → out/refraction/refraction-en-16x9-720p.mp4
make video FILM=refraction                # без LANGS — все языки ролика (en, ru)
make video FILM=refraction SIZE=1080      # 1920×1080
make web FILM=refraction                  # лёгкая версия для сайта → out/refraction/web/ (см. ниже)
node video/scripts/video-render.mjs refraction ru --from 40 --to 60   # кусок ролика
node video/scripts/video-voice.mjs refraction ru --engine espeak      # черновой робот-голос для таймингов (не коммитить)
node video/scripts/video-voice.mjs refraction ru --redo 4             # заново реплики сцены 4
```

**Языки.** Тексты и реплики — `films/<id>/i18n.js`, по блоку на язык (ключи и длины списков совпадают — тест);
голоса — `voice.config.json` → `voice.<lang>`, `instructions.<lang>`; подписи плеера — `UI` в `player.js`,
в плеере — кнопки EN / RU, `&lang=`. Пока озвучки языка нет, плеер и рендер идут по оценке длины реплик.
Плашка `disclaimer` («тестовый ролик: проверка Claude Opus, без ревью, как есть») — в первой сцене и на
финальной карточке; таймлайн она не меняет. Подробно — `docs/i18n.md`.

Нужны Node 22 и `ffmpeg`. Без видеокарты (облачный контейнер) WebGL программный: ~0,5–1 с на кадр 720p,
ролик целиком — около часа. На Mac и Windows рендер по умолчанию идёт на видеокарте (окно Chromium
не сворачивать), в разы быстрее; `GPU=0` — программный, `GPU=1` — видеокарта и на Linux.

## Версия для сайта

`make web FILM=<id>` после `make video` кладёт в `out/<id>/web/` файлы с постоянными именами — на них
ссылается лендинг:

| файл | что |
|---|---|
| `<id>-<lang>.mp4` | H.264 720p, CRF 28, AAC 96 кбит/с стерео, `+faststart` — начинает играть до полной загрузки |
| `<id>-<lang>.jpg` | обложка 1280×720 для `poster` у `<video>` |
| `<id>-<lang>.vtt` | субтитры из озвучки для `<track kind="subtitles">` |

Исходник — самый крупный готовый `out/<id>/<id>-<lang>-16x9-<size>p.mp4`. Легче: `make web FILM=<id> CRF=31 HEIGHT=540`.

## Как устроено

```
sim/index.html?embed   симулятор без интерфейса: window.prism.compose / project / cart / hits / glass
video/
├── index.html, player.js, player.css   плеер (и режим ?render для рендера)
├── lib/
│   ├── engine.js     таймлайн (сцены продлеваются под голос), реплики → env.cue(k), кроссфейды
│   ├── overlay.js    «доска», линии мелом, лучи, дуги углов, подписи от руки, формулы, плашки, титры
│   ├── rigs.js       камеры у тележки: beside, onboard, chase, overview, blend
│   └── sound.mjs     синтез музыки и звуков (мел, стеклянный колокольчик, стоп-кадр…)
├── films/refraction/ film.js (сцены), i18n.js (реплики диалога, подписи), voice/ (озвучка, в git)
├── scripts/          browser.mjs (сервер + Chromium), video-voice/render/sound, serve
├── fonts/            Inter, Caveat, Source Serif 4 с греческим (OFL) — кадры не зависят от сети
└── voice.config.json модель, голоса he/she, манера, громкость музыки и звуков
out/<id>/              (в корне, не в git) MP4, обложки, пробные кадры
```

- **Сцена** — `{ id, dur, xf, tail, shots(lt, env), look(lt, env), draw(ctx, lt, env), sfx(c) }`, чистые функции
  времени (без `Math.random` и часов — проверяет `make test`). `shots` — состояние симулятора
  `{ code, s, time, cam, smoke, … }`, где `s` — путь тележки, м; `[]` — сцена без 3D (чистый чертёж).
  `look` — CSS-фильтр и прозрачность 3D-кадра (так кадр «замирает и гаснет» перед чертежом).
- **Реплики** — `i18n.js`, `voice`: по списку на сцену, `[секунда | null, текст, he | she]`; `null` — сразу
  после предыдущей. События сцен привязаны к репликам (`env.cue(k).t0 / .t1`), поэтому после настоящей
  озвучки всё само встаёт по местам. До озвучки длина реплики оценивается по числу знаков.
- **Переход 3D → рисунок**: точки настоящего стекла и лучей проецируются в кадр (`env.at`, `prism.hits`),
  по ним рисуются линии, затем линии перетекают (`overlay.morph`) в схему следующей сцены.
- **Выбор кадров** (какое стекло показать, где на трассе живее) — перебором по симулятору один раз
  (`memo`): детерминированно, сцена всегда одна и та же.

## Озвучка

`scripts/video-voice.mjs` синтезирует каждую реплику (OpenRouter `/audio/speech`, голос по тому, кто
говорит: `voice.config.json` → `voice.ru.he / .she`), проверяет распознаванием, что слова не потерялись,
кеширует в `voice/clips/` (не в git) и сводит одну дорожку с музыкой (приседает под голос) и звуками.
Ключ — только в окружении (`export OPENROUTER_API_KEY=…`) или строкой `OPENROUTER_API_KEY = …` в `local.mk`.
