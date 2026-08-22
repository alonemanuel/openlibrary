#!/usr/bin/env python3
"""Album artwork pass 2: rank candidates properly, capture record_type,
fall back to iTunes when Deezer has nothing.

Fixes the v1 bug where the first Deezer hit was taken blindly — the strict
query for Bonobo / "Black Sands" returns "Black Sands Remixed" first.

Writes albums2 into art_cache.json:
  {cover, cover_sm, dz_artist, dz_title, rtype, ntracks, src, score}
"""
import csv, json, os, time, unicodedata, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.dirname(HERE)                 # data lives one level above the scripts
CSV = os.environ.get("MUSIC_CSV", os.path.join(DATA, "liked_music_deduped.csv"))
CACHE = os.path.join(DATA, "art_cache.json")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) music-library-page/1.0"
BLANK = "d41d8cd98f00b204e9800998ecf8427e"

_lock = threading.Lock(); _last = [0.0]; MIN_INTERVAL = 0.11


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
                data = json.loads(r.read().decode("utf-8", "replace"))
            if isinstance(data, dict) and data.get("error"):
                if str(data["error"].get("code", "")) == "4":
                    time.sleep(2 + attempt * 2); continue
                return None
            return data
        except Exception:
            time.sleep(1 + attempt * 1.5)
    return None


def real_img(u):
    return None if (not u or BLANK in u) else u


def key(s):
    s = unicodedata.normalize("NFKD", (s or "").casefold())
    return "".join(c for c in s if c.isalnum() and not unicodedata.combining(c))


# Editions that are genuinely different releases — never silently accept one
# of these when the library asked for the plain album.
EDITION_WORDS = ("remix", "remixed", "instrumental", "karaoke", "live",
                 "acoustic", "demo", "commentary", "reissue", "tribute",
                 "covers", "cover", "sped", "slowed")


def title_score(want, got):
    """4 exact · 3 same-after-edition-suffix · 2 prefix · 1 contains · 0 no."""
    kw, kg = key(want), key(got)
    if not kw or not kg:
        return 0
    if kw == kg:
        return 4
    extra = kg[len(kw):] if kg.startswith(kw) else (kw[len(kg):] if kw.startswith(kg) else None)
    if extra is not None:
        # One is a prefix of the other. If the tail names a different edition,
        # it's a different record — that's the Black Sands / Black Sands Remixed case.
        if any(w in extra for w in EDITION_WORDS):
            return 0
        return 2
    if kw in kg or kg in kw:
        if any(w in kg and w not in kw for w in EDITION_WORDS):
            return 0
        return 1
    return 0


def artist_ok(want, got):
    kw, kg = key(want), key(got)
    return bool(kw and kg) and (kw == kg or kw in kg or kg in kw)


def best(cands, artist, album):
    """Highest-scoring candidate whose artist matches; ties prefer a real album."""
    scored = []
    for c in cands:
        an = (c.get("artist") or {}).get("name", "")
        if not artist_ok(artist, an):
            continue
        ts = title_score(album, c.get("title", ""))
        if ts == 0:
            continue
        rt = (c.get("record_type") or "").lower()
        scored.append((ts, 1 if rt == "album" else 0, c.get("nb_tracks") or 0, c))
    if not scored:
        return None
    scored.sort(key=lambda x: (x[0], x[1], x[2]), reverse=True)
    return scored[0][0], scored[0][3]


def deezer_album(artist, album):
    seen, cands = set(), []
    for q in (f'artist:"{artist}" album:"{album}"', f"{album} {artist}", album):
        d = paced_get("https://api.deezer.com/search/album?q=" + urllib.parse.quote(q) + "&limit=10")
        for c in (d or {}).get("data", []):
            if c.get("id") not in seen:
                seen.add(c.get("id")); cands.append(c)
        got = best(cands, artist, album)
        if got and got[0] == 4:      # exact title — stop early
            break
    got = best(cands, artist, album)
    if not got:
        return None
    score, a = got
    cover = real_img(a.get("cover_big") or a.get("cover_medium"))
    if not cover:
        return None
    return {
        "cover": cover,
        "cover_sm": real_img(a.get("cover_medium")) or cover,
        "dz_artist": (a.get("artist") or {}).get("name"),
        "dz_title": a.get("title"),
        "rtype": (a.get("record_type") or "").lower() or None,
        "ntracks": a.get("nb_tracks"),
        "src": "deezer",
        "score": score,
    }


def itunes_album(artist, album):
    q = urllib.parse.quote(f"{artist} {album}")
    d = paced_get(f"https://itunes.apple.com/search?term={q}&entity=album&limit=10")
    cands = []
    for r in (d or {}).get("results", []):
        name = (r.get("collectionName") or "")
        # iTunes appends " - Single"/" - EP" to the title; strip before comparing.
        clean = name.rsplit(" - Single", 1)[0].rsplit(" - EP", 1)[0]
        if not artist_ok(artist, r.get("artistName") or ""):
            continue
        ts = title_score(album, clean)
        if ts == 0:
            continue
        cands.append((ts, r, name))
    if not cands:
        return None
    cands.sort(key=lambda x: x[0], reverse=True)
    score, r, name = cands[0]
    art = r.get("artworkUrl100") or ""
    if not art:
        return None
    n = r.get("trackCount") or 0
    rt = "single" if (name.endswith("- Single") or n == 1) else ("ep" if name.endswith("- EP") else "album")
    return {
        "cover": art.replace("100x100bb", "500x500bb"),
        "cover_sm": art.replace("100x100bb", "250x250bb"),
        "dz_artist": r.get("artistName"),
        "dz_title": name,
        "rtype": rt,
        "ntracks": n,
        "src": "itunes",
        "score": score,
    }


def one(artist, album):
    return deezer_album(artist, album) or itunes_album(artist, album)


def main():
    rows = list(csv.DictReader(open(CSV, encoding="utf-8-sig")))
    nm = lambda s: " ".join((s or "").strip().split())
    albums = sorted({(nm(r["artist"]), nm(r["album"]))
                     for r in rows if nm(r["album"]) and nm(r["artist"])})

    cache = json.load(open(CACHE, encoding="utf-8"))
    out = cache.setdefault("albums2", {})
    todo = [k for k in albums if f"{k[0]}␟{k[1]}" not in out]
    print(f"albums: {len(albums)} total, {len(todo)} to fetch", flush=True)

    def save():
        with open(CACHE + ".tmp", "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False)
        os.replace(CACHE + ".tmp", CACHE)

    done = 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(one, ar, al): (ar, al) for ar, al in todo}
        for fut in as_completed(futs):
            ar, al = futs[fut]
            try:
                out[f"{ar}␟{al}"] = fut.result()
            except Exception:
                out[f"{ar}␟{al}"] = None
            done += 1
            if done % 200 == 0:
                save(); print(f"  {done}/{len(todo)}", flush=True)
    save()

    hit = [v for v in out.values() if v]
    print(f"DONE. covers {len(hit)}/{len(out)}")
    print("  by source:", {s: sum(1 for v in hit if v['src'] == s) for s in ('deezer', 'itunes')})
    print("  by type  :", {t: sum(1 for v in hit if v.get('rtype') == t)
                           for t in ('album', 'single', 'ep', 'compilation')})
    print("  exact-title matches:", sum(1 for v in hit if v['score'] == 4))


if __name__ == "__main__":
    main()
