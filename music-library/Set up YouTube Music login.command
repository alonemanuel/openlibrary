#!/bin/bash
# One-time: lets the library put thumbs-up on YouTube Music.
#
# Your session headers are pasted by YOU into the prompt below and saved to
#   ~/AlonPersonal/musiclib/browser.json
# outside Google Drive on purpose — that file contains your login cookies and
# must never sync anywhere. Nobody else reads it; the local server uses it to
# call YouTube Music on your behalf.
set -e
PY="$HOME/AlonPersonal/musiclib/venv/bin/python"
if [ ! -x "$PY" ]; then
  echo "Missing: $PY"
  echo "Create it with:  python3 -m venv ~/AlonPersonal/musiclib/venv && ~/AlonPersonal/musiclib/venv/bin/pip install ytmusicapi"
  read -r -p "Press return to close."; exit 1
fi
mkdir -p "$HOME/AlonPersonal/musiclib"

cat <<'TXT'
────────────────────────────────────────────────────────────────────
Connect the library to YouTube Music

 1. Open  https://music.youtube.com  in Chrome, signed in.
 2. Open DevTools (Cmd-Option-I) and click the Network tab.
 3. Click anything on the page so requests appear.
 4. Find a POST request to a URL containing  /youtubei/v1/
 5. Right-click it → Copy → Copy request headers.
 6. Paste here, then press Return and Ctrl-D on a blank line.

Nothing is uploaded. It is written only to
  ~/AlonPersonal/musiclib/browser.json
────────────────────────────────────────────────────────────────────
TXT

"$PY" -m ytmusicapi browser --file "$HOME/AlonPersonal/musiclib/browser.json"
chmod 600 "$HOME/AlonPersonal/musiclib/browser.json"

echo
"$PY" - <<'PYEOF'
import os
from ytmusicapi import YTMusic
p = os.path.expanduser("~/AlonPersonal/musiclib/browser.json")
try:
    yt = YTMusic(p)
    n = len(yt.get_liked_songs(limit=1).get("tracks", []))
    print("Connected. YouTube Music responded to an authenticated request.")
except Exception as e:
    print("Saved, but the check failed:", e)
    print("Re-run this and make sure you copied headers from a /youtubei/v1/ POST.")
PYEOF
echo
read -r -p "Done — press return to close."
