#!/usr/bin/env python3
"""Fetch album covers + artist photos from Deezer's public API, cache to JSON.

Read-only against the CSV. Writes only to the scratchpad cache file.
Resumable: re-running skips anything already in the cache.
"""
import csv, json, os, sys, time, unicodedata, urllib.parse, urllib.request, collections
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
CSV = os.environ.get(
    "MUSIC_CSV",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                 "liked_music_deduped.csv"))
CACHE = os.path.join(HERE, "art_cache.json")

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 music-library-page/1.0"

# Deezer tolerates bursts but throttles ~50 req/5s. Keep a global token pace.
_lock = threading.Lock()
_last = [0.0]
MIN_INTERVAL = 0.11  # ~9 req/s


def paced_get(url, tries=4):
    for attempt in range(tries):
        with _lock:
            wait = MIN_INTERVAL - (time.time() - _last[0])
            if wait > 0:
                time.sleep(wait)
            _last[0] = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=20) as r:
                data = json.loads(r.read().decode("utf-8"))
            if isinstance(data, dict) and data.get("error"):
                code = str(data["error"].get("code", ""))
                if code == "4":  # quota
                    time.sleep(2 + attempt * 2)
                    continue
                return None
            return data
        except Exception:
            time.sleep(1 + attempt * 1.5)
    return None


def norm(s):
    return " ".join((s or "").strip().split())


# md5 of the empty string — Deezer's "no image" placeholder hash in every CDN URL.
BLANK = "d41d8cd98f00b204e9800998ecf8427e"


def real_img(url):
    """None for Deezer's blank-image placeholder, else the url."""
    return None if (not url or BLANK in url) else url


def _key(s):
    """Comparison key: strip diacritics + non-alphanumerics, casefold.

    Diacritic folding matters — Deezer often returns 'Ali Farka Toure' for
    'Ali Farka Touré', which would otherwise read as a mismatch.
    """
    s = unicodedata.normalize("NFKD", (s or "").casefold())
    return "".join(c for c in s if c.isalnum() and not unicodedata.combining(c))


def close_enough(a, b):
    ka, kb = _key(a), _key(b)
    if not ka or not kb:
        return False
    return ka == kb or ka in kb or kb in ka


def fetch_album(artist, album):
    q = urllib.parse.quote(f'artist:"{artist}" album:"{album}"')
    d = paced_get(f"https://api.deezer.com/search/album?q={q}&limit=1")
    strict = bool(d and d.get("data"))
    if not strict:
        # Looser retry, but only trust it if the returned artist actually matches.
        q2 = urllib.parse.quote(f"{album} {artist}")
        d = paced_get(f"https://api.deezer.com/search/album?q={q2}&limit=5")
        if not d or not d.get("data"):
            return None
        cand = next((c for c in d["data"]
                     if close_enough((c.get("artist") or {}).get("name"), artist)), None)
        if cand is None:
            return None
        d = {"data": [cand]}
    a = d["data"][0]
    cover = real_img(a.get("cover_big") or a.get("cover_medium"))
    if not cover:
        return None
    return {
        "cover": cover,
        "cover_sm": real_img(a.get("cover_medium") or a.get("cover_small")) or cover,
        "dz_artist": (a.get("artist") or {}).get("name"),
        "dz_title": a.get("title"),
        "link": a.get("link"),
        "loose": not strict,
    }


def fetch_artist(artist):
    q = urllib.parse.quote(artist)
    d = paced_get(f"https://api.deezer.com/search/artist?q={q}&limit=5")
    if not d or not d.get("data"):
        return None
    # Only ever accept a name match. Falling back to "first result with a photo"
    # puts a stranger's face on labels/stations (e.g. KEXP) — a gradient is better.
    cands = d["data"]
    pick = next((c for c in cands
                 if close_enough(c.get("name"), artist)
                 and real_img(c.get("picture_big"))), None)
    if pick is None:
        return None
    pic = real_img(pick.get("picture_big") or pick.get("picture_medium"))
    if not pic:
        return None
    return {
        "pic": pic,
        "pic_sm": real_img(pick.get("picture_medium") or pick.get("picture_small")) or pic,
        "dz_name": pick.get("name"),
        "fans": pick.get("nb_fan"),
        "link": pick.get("link"),
        "exact": close_enough(pick.get("name"), artist),
    }


def main():
    rows = list(csv.DictReader(open(CSV, encoding="utf-8-sig")))
    artists, albums = set(), set()
    for r in rows:
        ar, al = norm(r.get("artist")), norm(r.get("album"))
        if ar:
            artists.add(ar)
        if al and ar:
            albums.add((ar, al))

    cache = {"artists": {}, "albums": {}}
    if os.path.exists(CACHE):
        cache = json.load(open(CACHE, encoding="utf-8"))
        cache.setdefault("artists", {})
        cache.setdefault("albums", {})

    todo_ar = [a for a in sorted(artists) if a not in cache["artists"]]
    todo_al = [k for k in sorted(albums) if f"{k[0]}␟{k[1]}" not in cache["albums"]]
    print(f"artists: {len(artists)} total, {len(todo_ar)} to fetch", flush=True)
    print(f"albums : {len(albums)} total, {len(todo_al)} to fetch", flush=True)

    done = [0]
    total = len(todo_ar) + len(todo_al)

    def save():
        tmp = CACHE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False)
        os.replace(tmp, CACHE)

    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {}
        for a in todo_ar:
            futs[ex.submit(fetch_artist, a)] = ("artist", a)
        for ar, al in todo_al:
            futs[ex.submit(fetch_album, ar, al)] = ("album", (ar, al))
        for fut in as_completed(futs):
            kind, key = futs[fut]
            try:
                res = fut.result()
            except Exception:
                res = None
            if kind == "artist":
                cache["artists"][key] = res
            else:
                cache["albums"][f"{key[0]}␟{key[1]}"] = res
            done[0] += 1
            if done[0] % 200 == 0:
                save()
                print(f"  {done[0]}/{total}", flush=True)

    save()
    hit_ar = sum(1 for v in cache["artists"].values() if v and v.get("pic"))
    hit_al = sum(1 for v in cache["albums"].values() if v and v.get("cover"))
    print(f"DONE. artist photos: {hit_ar}/{len(cache['artists'])}  album covers: {hit_al}/{len(cache['albums'])}")


if __name__ == "__main__":
    main()
