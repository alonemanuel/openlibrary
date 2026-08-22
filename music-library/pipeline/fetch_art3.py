#!/usr/bin/env python3
"""Album artwork pass 3 — recover the misses from pass 2.

Two causes, both benign:
  * transliteration: Deezer lists 'רביד פלוטניק' as 'Ravid Plotnik', so a
    literal artist comparison can never match across scripts;
  * typos in the export: 'Dudud Tassa' vs Deezer's 'Dudu Tassa'.

Only ever accepts an EXACT album-title match (score 4). On top of that the
artist must either be script-incomparable (Hebrew vs Latin — nothing to
compare, so the exact title carries it) or similar enough to be the same name.
"""
import csv, difflib, json, os, re, sys, unicodedata, urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_art2 as f2

CSV = f2.CSV
CACHE = f2.CACHE
HEB = re.compile(r"[֐-׿]")
ARA = re.compile(r"[؀-ۿ]")
LAT = re.compile(r"[A-Za-z]")


def script(s):
    if HEB.search(s or ""):
        return "he"
    if ARA.search(s or ""):
        return "ar"
    if LAT.search(s or ""):
        return "en"
    return "?"


def artist_plausible(want, got):
    """Same artist, allowing for transliteration and small typos."""
    if f2.artist_ok(want, got):
        return True
    sw, sg = script(want), script(got)
    if sw != sg and "?" not in (sw, sg):
        return True                       # cross-script: exact title decides
    return difflib.SequenceMatcher(None, f2.key(want), f2.key(got)).ratio() >= 0.72


def exact_only(cands, artist, album):
    for c in cands:
        if f2.title_score(album, c.get("title", "")) != 4:
            continue
        if not artist_plausible(artist, (c.get("artist") or {}).get("name", "")):
            continue
        return c
    return None


def recover(artist, album):
    seen, cands = set(), []
    for q in (f"{album} {artist}", album):
        d = f2.paced_get("https://api.deezer.com/search/album?q="
                         + urllib.parse.quote(q) + "&limit=15")
        for c in (d or {}).get("data", []):
            if c.get("id") not in seen:
                seen.add(c["id"]); cands.append(c)
        hit = exact_only(cands, artist, album)
        if hit:
            break
    if not hit:
        return None
    cover = f2.real_img(hit.get("cover_big") or hit.get("cover_medium"))
    if not cover:
        return None
    return {
        "cover": cover,
        "cover_sm": f2.real_img(hit.get("cover_medium")) or cover,
        "dz_artist": (hit.get("artist") or {}).get("name"),
        "dz_title": hit.get("title"),
        "rtype": (hit.get("record_type") or "").lower() or None,
        "ntracks": hit.get("nb_tracks"),
        "src": "deezer-p3",
        "score": 4,
    }


def main():
    cache = json.load(open(CACHE, encoding="utf-8"))
    a2 = cache["albums2"]
    miss = [k for k, v in a2.items() if not v]
    print(f"retrying {len(miss)} albums with no cover", flush=True)

    found = 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {}
        for k in miss:
            ar, al = k.split("␟")
            futs[ex.submit(recover, ar, al)] = k
        for i, fut in enumerate(as_completed(futs), 1):
            k = futs[fut]
            try:
                r = fut.result()
            except Exception:
                r = None
            if r:
                a2[k] = r; found += 1
            if i % 100 == 0:
                print(f"  {i}/{len(miss)}  recovered {found}", flush=True)

    with open(CACHE + ".tmp", "w", encoding="utf-8") as fh:
        json.dump(cache, fh, ensure_ascii=False)
    os.replace(CACHE + ".tmp", CACHE)

    hit = [v for v in a2.values() if v]
    print(f"DONE. recovered {found}; covers now {len(hit)}/{len(a2)}")


if __name__ == "__main__":
    main()
