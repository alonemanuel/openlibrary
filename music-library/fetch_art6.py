#!/usr/bin/env python3
"""Artist photo pass 6 — the acts that only existed inside a collaboration.

Splitting 'Vibe Ish, Roisha' into two artists creates ~950 acts that were never
looked up, because the cache is keyed by the whole credit. Same strict rule as
every other pass: the Deezer name must match, or the tile stays a gradient.
"""
import csv, json, os, sys, urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_art2 as f2
from credits import split_credit

CACHE = f2.CACHE
CSV = f2.CSV


def exact_artist(name):
    d = f2.paced_get("https://api.deezer.com/search/artist?q="
                     + urllib.parse.quote(name) + "&limit=8")
    for c in (d or {}).get("data", []):
        if f2.key(c.get("name")) != f2.key(name):
            continue
        pic = f2.real_img(c.get("picture_big") or c.get("picture_medium"))
        if pic:
            return {"pic": pic,
                    "pic_sm": f2.real_img(c.get("picture_medium")) or pic,
                    "dz_name": c.get("name"), "fans": c.get("nb_fan"),
                    "exact": True, "via": "credit-member"}
    return None


def main():
    cache = json.load(open(CACHE, encoding="utf-8"))
    ac = cache["artists"]

    def dz_knows_whole(name):
        v = ac.get(name) or {}
        return (v.get("dz_name") or "").strip().casefold() == (name or "").strip().casefold()

    rows = list(csv.DictReader(open(CSV, encoding="utf-8-sig")))
    nm = lambda s: " ".join((s or "").strip().split())
    credits = {nm(r["artist"]) for r in rows if nm(r["artist"])}

    members = set()
    for c in credits:
        for m in split_credit(c, dz_knows_whole):
            members.add(m)

    todo = sorted(m for m in members
                  if not (ac.get(m) or {}).get("pic") and len(m) > 1)
    print(f"{len(members)} acts after splitting; {len(todo)} without a photo", flush=True)

    def save():
        with open(CACHE + ".tmp", "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False)
        os.replace(CACHE + ".tmp", CACHE)

    found = 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(exact_artist, m): m for m in todo}
        for i, fut in enumerate(as_completed(futs), 1):
            m = futs[fut]
            try:
                r = fut.result()
            except Exception:
                r = None
            if r:
                ac[m] = r
                found += 1
            if i % 200 == 0:
                save(); print(f"  {i}/{len(todo)}  found {found}", flush=True)
    save()
    have = sum(1 for v in ac.values() if v and v.get("pic"))
    print(f"DONE. found {found}; cache now holds {have} photos")


if __name__ == "__main__":
    main()
