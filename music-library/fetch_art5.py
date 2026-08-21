#!/usr/bin/env python3
"""Artist photo pass 5 — upgrade substring matches to exact ones.

Pass 1 accepted any name containing the artist, so 'רביד פלוטניק' landed on the
collaboration entry 'טדי נגוסה ,רביד פלוטניק'. Re-search and take the exact
name when Deezer has one; otherwise keep what we already have.
"""
import json, os, sys, urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_art2 as f2

CACHE = f2.CACHE


def exact(name):
    d = f2.paced_get("https://api.deezer.com/search/artist?q="
                     + urllib.parse.quote(name) + "&limit=10")
    for c in (d or {}).get("data", []):
        if f2.key(c.get("name")) != f2.key(name):
            continue
        pic = f2.real_img(c.get("picture_big") or c.get("picture_medium"))
        if pic:
            return {"pic": pic, "pic_sm": f2.real_img(c.get("picture_medium")) or pic,
                    "dz_name": c.get("name"), "fans": c.get("nb_fan"),
                    "exact": True, "via": "exact-upgrade"}
    return None


cache = json.load(open(CACHE, encoding="utf-8"))
ac = cache["artists"]
todo = [k for k, v in ac.items()
        if v and v.get("pic") and f2.key(v.get("dz_name")) != f2.key(k)]
print(f"{len(todo)} artists sitting on a non-exact name match")

up = 0
with ThreadPoolExecutor(max_workers=8) as ex:
    futs = {ex.submit(exact, k): k for k in todo}
    for i, fut in enumerate(as_completed(futs), 1):
        k = futs[fut]
        try:
            r = fut.result()
        except Exception:
            r = None
        if r:
            ac[k] = r; up += 1
        if i % 100 == 0:
            print(f"  {i}/{len(todo)}  upgraded {up}", flush=True)

with open(CACHE + ".tmp", "w", encoding="utf-8") as fh:
    json.dump(cache, fh, ensure_ascii=False)
os.replace(CACHE + ".tmp", CACHE)
have = sum(1 for v in ac.values() if v and v.get("pic"))
print(f"DONE. upgraded {up}; artist photos {have}/{len(ac)}")
