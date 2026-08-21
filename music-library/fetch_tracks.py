#!/usr/bin/env python3
"""Fetch official tracklists so album sheets can show unliked tracks greyed out.

Pass 2/3 recorded which release each album resolved to but not its id, so this
re-finds the id by matching against the stored dz_title/dz_artist (we already
know the right answer — this is verification, not a fresh search), then pulls
the full tracklist.

Writes cache["tracks"][key] = {"id":…, "src":…, "t":[[title, seconds], …]}
in album order.
"""
import json, os, sys, urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_art2 as f2

CACHE = f2.CACHE


def dz_id(artist, album, want_title, want_artist, want_n, want_rtype):
    """Re-locate the album on Deezer; only accept the release we already matched.

    Title alone is not enough: an album and its lead single share a name, and
    the single sorts first ('Habib Galbi' returns the 1-track single before the
    12-track album). Pass 2 recorded the real track count, so use it to pick.
    """
    seen, cands = set(), []
    for q in (f'artist:"{artist}" album:"{album}"', f"{album} {artist}", album):
        d = f2.paced_get("https://api.deezer.com/search/album?q="
                         + urllib.parse.quote(q) + "&limit=15")
        for c in (d or {}).get("data", []):
            if c.get("id") in seen:
                continue
            if f2.key(c.get("title")) != f2.key(want_title):
                continue
            if want_artist and f2.key((c.get("artist") or {}).get("name")) != f2.key(want_artist):
                continue
            seen.add(c["id"]); cands.append(c)
        if cands and any((c.get("nb_tracks") or 0) == want_n for c in cands):
            break
    if not cands:
        return None
    cands.sort(key=lambda c: (
        (c.get("nb_tracks") or 0) == want_n,                              # the release pass 2 saw
        (c.get("record_type") or "").lower() == (want_rtype or ""),
        c.get("nb_tracks") or 0,
    ), reverse=True)
    return cands[0].get("id")


def dz_tracks(aid):
    """/album/{id} caps its embedded tracklist at 25; the /tracks sub-resource
    takes a limit, and we page it anyway for the rare very long compilation."""
    out, index = [], 0
    while True:
        d = f2.paced_get(f"https://api.deezer.com/album/{aid}/tracks"
                         f"?limit=300&index={index}")
        rows = (d or {}).get("data") or []
        for t in rows:
            ttl = t.get("title") or ""
            if ttl:
                out.append([ttl, t.get("duration") or 0])
        if not d or not d.get("next") or not rows:
            break
        index += len(rows)
        if index > 2000:
            break
    return out or None


def itunes_tracks(artist, album, want_title):
    """iTunes-sourced albums: find the collection, then list its songs."""
    q = urllib.parse.quote(f"{artist} {album}")
    d = f2.paced_get(f"https://itunes.apple.com/search?term={q}&entity=album&limit=10")
    cid = None
    for r in (d or {}).get("results", []):
        if f2.key(r.get("collectionName")) == f2.key(want_title):
            cid = r.get("collectionId"); break
    if not cid:
        return None, None
    d = f2.paced_get(f"https://itunes.apple.com/lookup?id={cid}&entity=song&limit=200")
    out = []
    for r in (d or {}).get("results", []):
        if r.get("wrapperType") == "track" and r.get("trackName"):
            out.append([r["trackName"], round((r.get("trackTimeMillis") or 0) / 1000)])
    return cid, (out or None)


def one(key, info):
    artist, album = key.split("␟")
    want_title = info.get("dz_title") or album
    if info.get("src") == "itunes":
        cid, tr = itunes_tracks(artist, album, want_title)
        return {"id": cid, "src": "itunes", "t": tr} if tr else None
    aid = dz_id(artist, album, want_title, info.get("dz_artist"),
                info.get("ntracks") or 0, (info.get("rtype") or "").lower())
    if not aid:
        return None
    tr = dz_tracks(aid)
    return {"id": aid, "src": "deezer", "t": tr} if tr else None


def main():
    cache = json.load(open(CACHE, encoding="utf-8"))
    a2 = cache["albums2"]
    tracks = cache.setdefault("tracks", {})
    todo = [(k, v) for k, v in a2.items() if v and v.get("cover") and k not in tracks]
    print(f"fetching tracklists for {len(todo)} albums", flush=True)

    def save():
        with open(CACHE + ".tmp", "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False)
        os.replace(CACHE + ".tmp", CACHE)

    got = 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(one, k, v): k for k, v in todo}
        for i, fut in enumerate(as_completed(futs), 1):
            k = futs[fut]
            try:
                r = fut.result()
            except Exception:
                r = None
            tracks[k] = r
            got += bool(r)
            if i % 200 == 0:
                save(); print(f"  {i}/{len(todo)}  got {got}", flush=True)
    save()
    have = [v for v in tracks.values() if v]
    total = sum(len(v["t"]) for v in have)
    print(f"DONE. tracklists {len(have)}/{len(tracks)}  ({total} official tracks)")


if __name__ == "__main__":
    main()
