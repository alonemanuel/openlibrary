#!/usr/bin/env python3
"""Second pass: drop artist entries the old loose logic accepted, re-check them
under the stricter, diacritic-aware matcher. Anything still unmatched becomes
None (gradient tile) rather than a stranger's face.
"""
import json, os
from concurrent.futures import ThreadPoolExecutor, as_completed
import fetch_art as f

CACHE = f.CACHE
cache = json.load(open(CACHE, encoding="utf-8"))
ar = cache["artists"]

suspect = [k for k, v in ar.items() if v and v.get("exact") is False]
print(f"re-checking {len(suspect)} loosely-matched artists")

fixed = kept = 0
with ThreadPoolExecutor(max_workers=8) as ex:
    futs = {ex.submit(f.fetch_artist, k): k for k in suspect}
    for i, fut in enumerate(as_completed(futs), 1):
        k = futs[fut]
        try:
            res = fut.result()
        except Exception:
            res = None
        ar[k] = res
        if res:
            kept += 1
        else:
            fixed += 1
        if i % 100 == 0:
            print(f"  {i}/{len(suspect)}", flush=True)

with open(CACHE + ".tmp", "w", encoding="utf-8") as fh:
    json.dump(cache, fh, ensure_ascii=False)
os.replace(CACHE + ".tmp", CACHE)
print(f"done. now-matched: {kept}   cleared to gradient: {fixed}")
