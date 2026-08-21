#!/bin/bash
# Double-click to start. Serves the library locally and opens it in your browser.
# This is the full experience: real seek bar, auto-advance, playing tracks you
# never liked, and hearting songs straight to YouTube Music.
# Close this Terminal window to stop.
cd "$(dirname "$0")" || exit 1

PY="$HOME/AlonPersonal/musiclib/venv/bin/python"
[ -x "$PY" ] || PY="$(command -v python3)"

PORT=8899
while lsof -i :$PORT >/dev/null 2>&1; do PORT=$((PORT+1)); done

echo "Music library"
( sleep 1.2; open "http://localhost:$PORT/library.html" ) &
exec "$PY" library_build/server.py "$PORT"
