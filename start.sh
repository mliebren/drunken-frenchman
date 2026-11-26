#!/usr/bin/env bash
# Linux launcher (macOS users: use Start-Mac.command; Windows users: Start-Windows.bat)
cd "$(dirname "$0")" || exit 1
PORT="${1:-8765}"
if command -v node >/dev/null 2>&1; then exec node server.js "$PORT"
elif command -v python3 >/dev/null 2>&1; then exec python3 serve.py "$PORT"
else echo "No Node.js or Python 3 found; opening the game straight from the folder."; xdg-open public/index.html 2>/dev/null || echo "Open public/index.html in your browser."; fi
