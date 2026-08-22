#!/usr/bin/env python3
"""Artist photo pass 4 — recover Hebrew/Arabic artists via romanised names.

'הדג נחש' can never string-match Deezer's 'Hadag Nahash', so pass 1 left those
artists photoless. Two safe bridges to the romanised name:

  1. the Latin half of a bilingual credit ('דודא - Duda' → 'Duda');
  2. the artist name Deezer itself returned on one of their album matches
     ('חומר מקומי' resolved to artist 'Hadag Nahash').

Bridge 2 is the strong one: the name came from Deezer, so requiring an exact
match against it can't drift onto a different act.
"""
import csv, json, os, sys, collections, urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_art as f1
import fetch_art2 as f2
from clean import split_bilingual

CSV = f2.CSV
CACHE = f2.CACHE


def by_name(name, must_equal):
    """Deezer artist search; only accept a candidate whose name matches."""
    d = f2.paced_get("https://api.deezer.com/search/artist?q="
                     + urllib.parse.quote(name) + "&limit=5")
    for c in (d or {}).get("data", []):
        if f2.key(c.get("name")) != f2.key(must_equal):
            continue
        pic = f2.real_img(c.get("picture_big") or c.get("picture_medium"))
        if pic:
            return {"pic": pic,
                    "pic_sm": f2.real_img(c.get("picture_medium")) or pic,
                    "dz_name": c.get("name"), "fans": c.get("nb_fan"),
                    "exact": True, "via": "romanised"}
    return None


def main():
    rows = list(csv.DictReader(open(CSV, encoding="utf-8-sig")))
    nm = lambda s: " ".join((s or "").strip().split())
    cache = json.load(open(CACHE, encoding="utf-8"))
    ac, a2 = cache["artists"], cache["albums2"]

    # Romanised name Deezer used for each raw artist, learned from album matches.
    via_album = {}
    for k, v in a2.items():
        if not v or not v.get("dz_artist"):
            continue
        raw = k.split("␟")[0]
        via_album.setdefault(raw, v["dz_artist"])

    raws = sorted({nm(r["artist"]) for r in rows if nm(r["artist"])})
    todo = []
    for raw in raws:
        cur = ac.get(raw)
        if cur and cur.get("pic"):
            continue
        cand = via_album.get(raw) or (split_bilingual(raw)[1] or "")
        if cand and f2.key(cand) != f2.key(raw):
            todo.append((raw, cand))
    print(f"{len(todo)} photoless artists have a romanised name to try", flush=True)

    found = 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(by_name, cand, cand): raw for raw, cand in todo}
        for i, fut in enumerate(as_completed(futs), 1):
            raw = futs[fut]
            try:
                r = fut.result()
            except Exception:
                r = None
            if r:
                ac[raw] = r; found += 1
            if i % 100 == 0:
                print(f"  {i}/{len(todo)}  recovered {found}", flush=True)

    with open(CACHE + ".tmp", "w", encoding="utf-8") as fh:
        json.dump(cache, fh, ensure_ascii=False)
    os.replace(CACHE + ".tmp", CACHE)
    have = sum(1 for v in ac.values() if v and v.get("pic"))
    print(f"DONE. recovered {found}; artist photos now {have}/{len(ac)}")


if __name__ == "__main__":
    main()
