#!/usr/bin/env python3
"""Save a YouTube Music session from whatever DevTools will give you.

ytmusicapi wants raw `key: value` request headers, but Chrome dropped "Copy
request headers" -- recent versions offer only Copy as cURL / PowerShell /
fetch. So take any of those and pull the headers back out.

Reads the clipboard by default, so the copied request never has to be pasted
anywhere: the cookie in it *is* the Google login, and pasting it into a chat
window or a shell history is how it leaks.

  # DevTools > Network > filter 'youtubei' > right-click a browse/next
  # request > Copy > Copy as cURL. Then:
  python3 ytm_login.py

Nothing is printed but header names. The session is written to
~/AlonPersonal/musiclib/browser.json (0600) and verified with one request.
"""
import os
import re
import subprocess
import sys

_legacy = os.path.expanduser("~/AlonPersonal/musiclib")
STATE = os.environ.get("MUSICLIB_HOME") or (
    _legacy if os.path.isdir(_legacy) else os.path.expanduser("~/.musiclib"))
AUTH = os.path.join(STATE, "browser.json")

# -H 'key: value' / -H "key: value", and the -b flag Chrome uses for cookies.
CURL_H = re.compile(r"""-H\s+(['"])(.*?)\1""", re.S)
CURL_B = re.compile(r"""(?:^|\s)-b\s+(['"])(.*?)\1""", re.S)
# PowerShell's -Headers @{ "key"="value" }
PWSH_H = re.compile(r'"([\w-]+)"\s*=\s*"(.*?)"(?=\s*\n|\s*})', re.S)


def headers_from(text):
    """Accept cURL, PowerShell or already-raw headers. Pseudo-headers (:method
    and friends) are dropped: ytmusicapi skips them anyway and they are not
    real headers."""
    out = {}
    for _q, item in CURL_H.findall(text):
        if ": " in item:
            k, v = item.split(": ", 1)
            out[k.strip().lower()] = v
    for _q, cookie in CURL_B.findall(text):
        out.setdefault("cookie", cookie)
    if not out:
        for k, v in PWSH_H.findall(text):
            out[k.strip().lower()] = v.replace('`"', '"')
    if not out:                                   # already raw "key: value"
        for line in text.splitlines():
            if ": " in line and not line.startswith(":"):
                k, v = line.split(": ", 1)
                out[k.strip().lower()] = v.strip()
    return {k: v for k, v in out.items() if not k.startswith(":")}


def main():
    raw = (sys.stdin.read() if not sys.stdin.isatty()
           else subprocess.run(["pbpaste"], capture_output=True, text=True).stdout)
    if not raw.strip():
        raise SystemExit("clipboard is empty -- copy the request first "
                         "(Network > right-click > Copy > Copy as cURL)")

    h = headers_from(raw)
    print(f"  parsed {len(h)} headers: {', '.join(sorted(h)[:8])}"
          f"{' ...' if len(h) > 8 else ''}")

    if "cookie" not in h:
        raise SystemExit(
            "no cookie header in what you copied.\n"
            "  - 'Copy as PowerShell' leaves cookies out entirely; use Copy as cURL\n"
            "  - a googlevideo.com/videoplayback request carries no session either;\n"
            "    filter the Network tab for 'youtubei' and copy a browse or next call")
    if "authorization" not in h:
        raise SystemExit(
            "no authorization header -- that request was not an authenticated API\n"
            "call. Filter for 'youtubei' and pick a browse or next request, not\n"
            "log_event (an ad blocker usually kills those before they are sent).")
    # Normally present on youtubei calls; ytmusicapi refuses without it, and
    # account 0 is the signed-in one unless several are multiplexed in one tab.
    if "x-goog-authuser" not in h:
        print("  note: no x-goog-authuser header; assuming account 0")
        h["x-goog-authuser"] = "0"

    os.makedirs(STATE, exist_ok=True)
    from ytmusicapi import YTMusic, setup
    setup(filepath=AUTH, headers_raw="\n".join(f"{k}: {v}" for k, v in h.items()))
    os.chmod(AUTH, 0o600)

    r = YTMusic(AUTH).get_liked_songs(limit=1)
    print(f"  connected: '{r.get('title')}' reports {r.get('trackCount')} songs")
    print(f"wrote {AUTH}")


if __name__ == "__main__":
    main()
