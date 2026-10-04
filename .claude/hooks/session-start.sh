#!/bin/bash
# Старт облачной сессии Claude Code: зависимости video/ (Playwright, локальные three.js и Tone.js),
# чтобы сразу работали make test и make stills. Локально ничего не делает.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR/video"
npm install --no-audit --no-fund

# Chromium обычно уже есть в образе (PLAYWRIGHT_BROWSERS_PATH); если нет — скачать
if ! node -e "require('fs').accessSync(require('playwright').chromium.executablePath())" 2>/dev/null; then
  npx playwright install chromium
fi
