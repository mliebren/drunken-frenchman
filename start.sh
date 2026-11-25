#!/usr/bin/env bash
# macOS / Linux launcher
cd "$(dirname "$0")"
PORT="${1:-8765}"
if command -v node >/dev/null 2>&1; then exec node server.js "$PORT"
elif command -v python3 >/dev/null 2>&1; then exec python3 serve.py "$PORT"
else echo "Install Node.js (https://nodejs.org) or Python 3 to run the game."; exit 1; fi
