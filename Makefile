# Prism Rail: симулятор (sim/), ролики (video/), будущий лендинг — в корне. Все команды — отсюда.
# Нужны Node 22 и ffmpeg; Chromium ставит Playwright (make install). Подробно — video/README.md.
-include local.mk
export OPENROUTER_API_KEY OPENROUTER_PROXY

FILM ?=
LANGS ?=
SIZE ?= 720
S = video/scripts

.PHONY: help install play test voice sound video web stills subs poster clean-out

help:  ## список целей
	@grep -hE '^[a-z-]+:.*##' $(MAKEFILE_LIST) | sed 's/:.*## /\t/'
	@echo
	@echo 'Какой ролик — FILM=<id> (обязателен для voice, sound, video, web, stills, subs, poster):'
	@node -e "import('./video/films/index.js').then(m=>m.default.forEach(f=>console.log('  FILM='+f.id+'\t'+f.title)))"
	@echo
	@echo 'Пример: make stills FILM=refraction T=5,40,90 && make voice FILM=refraction && make video FILM=refraction \&\& make web FILM=refraction'

install:  ## Playwright, Chromium и локальные копии three.js и Tone.js (в video/node_modules)
	cd video && npm install --no-audit --no-fund && npx playwright install chromium

play:  ## симулятор и плеер роликов локально: http://127.0.0.1:8790/sim/ и /video/
	node $(S)/serve.mjs 8790

test:  ## тексты, сцены, звуки, детерминизм, API симулятора
	node --test 'video/tests/*.test.mjs'

voice:  ## озвучка диалога + музыка и звуки → video/films/<id>/voice/<lang>.m4a (FILM=<id>; нужен OPENROUTER_API_KEY)
	@node $(S)/video-voice.mjs $(FILM) $(LANGS)

sound:  ## черновик музыки и звуков без голоса → video/films/<id>/voice/clips/{music,fx}-<lang>.wav
	@node $(S)/video-sound.mjs $(FILM) $(LANGS)

video:  ## MP4 со звуком → out/<id>/ (FILM=<id>; SIZE=720|1080)
	@node $(S)/video-render.mjs $(FILM) $(LANGS) --size $(SIZE)

web:  ## лёгкая версия для сайта → out/<id>/web/<id>-<lang>.{mp4,jpg,vtt} (720p, CRF 28; CRF=31 HEIGHT=540 — легче)
	@node $(S)/web.mjs $(FILM) $(LANGS) $(if $(CRF),--crf $(CRF)) $(if $(HEIGHT),--height $(HEIGHT))

stills:  ## пробные кадры + контактный лист → out/<id>/still-*-sheet.png (FILM=<id> T=10,40,95)
	@node $(S)/video-render.mjs $(FILM) $(LANGS) --size $(SIZE) --stills "$(T)"

subs:  ## то же с вшитыми субтитрами → out/<id>/…-subs.mp4
	@node $(S)/video-render.mjs $(FILM) $(LANGS) --size $(SIZE) --subs

poster:  ## только обложки → out/<id>/poster-<lang>-<формат>.jpg
	@node $(S)/video-render.mjs $(FILM) $(LANGS) --size $(SIZE) --poster

clean-out:  ## удалить out/ — все MP4 и кадры (пересобираются долго)
	rm -rf out

.PHONY: dist preview deploy
dist:  ## сайт для выкладки → dist/ (симулятор, «О проекте», плеер; веб-ролик — из out/<id>/web/, make web)
	node tools/dist.mjs

preview:  ## собрать dist/ и открыть локально: http://127.0.0.1:8791/
	node tools/dist.mjs --serve

deploy: dist  ## выложить dist/ (DEPLOY=user@host:/путь/ — в local.mk), rsync --delete
	@test -n "$(DEPLOY)" || { echo 'укажите DEPLOY=user@host:/путь/ (например, в local.mk)'; exit 1; }
	rsync -avz --delete --exclude .DS_Store dist/ $(DEPLOY)
