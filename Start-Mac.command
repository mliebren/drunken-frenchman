#!/bin/bash
# Drunken Frenchman — Mac launcher. Double-click this file in Finder.
# It looks for something that can host the game (Node, Python, or the Ruby that ships with older macOS)
# and, if none is found, simply opens the game straight from the folder.
cd "$(dirname "$0")" || exit 1
PORT=8765
clear
echo "  Drunken Frenchman"
echo "  -----------------"

# Downloaded files carry a "quarantine" flag that makes macOS nag; clear it for this folder (harmless if it fails).
xattr -dr com.apple.quarantine . 2>/dev/null

# 1) Node.js
if command -v node >/dev/null 2>&1; then
  exec node server.js "$PORT"
fi

# 2) Python 3 (skip Apple's placeholder, which pops up an installer dialog when there is no developer tools install)
PY="$(command -v python3 2>/dev/null)"
if [ -n "$PY" ] && { [ "$PY" != "/usr/bin/python3" ] || xcode-select -p >/dev/null 2>&1; }; then
  exec "$PY" serve.py "$PORT"
fi

# 3) Ruby's built-in web server (present on many Macs)
if [ -x /usr/bin/ruby ]; then
  echo "  Running at http://localhost:$PORT   (close this window to stop)"
  ( sleep 1; open "http://localhost:$PORT" ) &
  exec /usr/bin/ruby -run -ehttpd public -p"$PORT" -b127.0.0.1
fi

# 4) Last resort: the game also runs straight from the file, no server needed.
echo "  No web server tool found, opening the game directly instead."
open "public/index.html"
