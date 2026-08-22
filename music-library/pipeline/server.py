#!/usr/bin/env python3
"""Local app server for the music library page.

Serves the folder and adds three endpoints the static page can't do alone:

  GET  /api/status                      is rating available, is search available
  GET  /api/resolve?artist=&title=      YouTube Music search -> videoId, so tracks
                                        you never liked (no id in the export) can play
  POST /api/rate  {videoId, rating}     thumbs up/down on YouTube Music

Runtime state lives in $MUSICLIB_HOME (default ~/.musiclib), never in
cloud-synced storage:
  browser.json   your YouTube Music session headers — cookies, so it must not sync
  resolved.json  cache of search results, one lookup per track ever
  likes.json     mirror of what we've rated, so the page can show hearts offline

Binds 127.0.0.1 only.
"""
import json, os, re, sys, threading, urllib.parse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
WEBROOT = os.path.abspath(os.path.join(HERE, ".."))          # the music/ folder
_legacy = os.path.expanduser("~/AlonPersonal/musiclib")
STATE = os.environ.get("MUSICLIB_HOME") or (
    _legacy if os.path.isdir(_legacy) else os.path.expanduser("~/.musiclib"))
AUTH = os.path.join(STATE, "browser.json")
RESOLVED = os.path.join(STATE, "resolved.json")
LIKES = os.path.join(STATE, "likes.json")

os.makedirs(STATE, exist_ok=True)
_lock = threading.Lock()


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def save(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


resolved = load(RESOLVED, {})
likes = load(LIKES, {})

try:
    from ytmusicapi import YTMusic
except ImportError:
    YTMusic = None

_anon = None      # search: no auth needed
_auth = None      # rating: needs your session


def anon():
    global _anon
    if _anon is None and YTMusic:
        _anon = YTMusic()
    return _anon


def authed():
    global _auth
    if _auth is None and YTMusic and os.path.exists(AUTH):
        _auth = YTMusic(AUTH)
    return _auth


def norm(s):
    return re.sub(r"\s+", " ", (s or "")).strip()


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *a):
        if "/api/" in (self.path or ""):
            sys.stderr.write("  %s\n" % (fmt % a))

    # ---------- helpers ----------
    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        # The page may be opened from file://, whose origin is "null".
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    # ---------- routes ----------
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == "/api/status":
            return self.send_json({
                "search": bool(YTMusic),
                "rate": bool(YTMusic and os.path.exists(AUTH)),
                "likes": likes,
            })
        if u.path == "/api/resolve":
            return self.api_resolve(urllib.parse.parse_qs(u.query))
        return super().do_GET()

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if u.path != "/api/rate":
            return self.send_json({"error": "not found"}, 404)
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self.send_json({"error": "bad request"}, 400)
        return self.api_rate(body)

    def api_resolve(self, q):
        artist = norm((q.get("artist") or [""])[0])
        title = norm((q.get("title") or [""])[0])
        album = norm((q.get("album") or [""])[0])
        if not title:
            return self.send_json({"error": "title required"}, 400)

        key = f"{artist}␟{title}␟{album}"
        with _lock:
            if key in resolved:
                return self.send_json({"cached": True, **(resolved[key] or {"videoId": None})})

        yt = anon()
        if not yt:
            return self.send_json({"error": "ytmusicapi not installed"}, 503)

        hit = None
        for query in (f"{title} {artist}".strip(), f"{title} {album} {artist}".strip(), title):
            try:
                res = yt.search(query, filter="songs", limit=5) or []
            except Exception as e:
                return self.send_json({"error": f"search failed: {e}"}, 502)
            for r in res:
                if not r.get("videoId"):
                    continue
                hit = {"videoId": r["videoId"], "title": r.get("title"),
                       "artist": ", ".join(a["name"] for a in r.get("artists", []) if a.get("name")),
                       "duration": r.get("duration")}
                break
            if hit:
                break

        with _lock:
            resolved[key] = hit
            save(RESOLVED, resolved)
        return self.send_json({"cached": False, **(hit or {"videoId": None})})

    def api_rate(self, body):
        vid = norm(body.get("videoId"))
        rating = (body.get("rating") or "LIKE").upper()
        if not vid or rating not in ("LIKE", "DISLIKE", "INDIFFERENT"):
            return self.send_json({"error": "bad request"}, 400)
        yt = authed()
        if not yt:
            return self.send_json({
                "error": "not signed in",
                "hint": "run 'Set up YouTube Music login.command' in the music folder",
            }, 401)
        try:
            yt.rate_song(vid, rating)
        except Exception as e:
            return self.send_json({"error": f"rating failed: {e}"}, 502)
        with _lock:
            if rating == "INDIFFERENT":
                likes.pop(vid, None)
            else:
                likes[vid] = rating
            save(LIKES, likes)
        return self.send_json({"ok": True, "videoId": vid, "rating": rating})


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    os.chdir(WEBROOT)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=WEBROOT))
    print(f"  library     http://localhost:{port}/library.html")
    print(f"  search      {'ready' if YTMusic else 'ytmusicapi missing'}")
    print(f"  rating      {'ready' if (YTMusic and os.path.exists(AUTH)) else 'not signed in'}")
    print("  Leave this window open while you listen. Close it to stop.\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
