#!/usr/bin/env python3
"""Mirror every cover and artist photo locally, ready to push to object storage.

The cache holds only third-party CDN URLs, which is fine for one person but
fragile for a hosted app — Deezer can block hotlinking or rotate a path. This
downloads each image once, names it by content hash (many albums share art),
and writes a manifest so the build can rewrite URLs to your own bucket.

Downloads land outside any cloud-synced folder: 180 MB of JPEGs would swamp a
Drive client.

    python3 mirror_art.py                 # download + manifest
    aws s3 sync ~/.musiclib/art s3://BUCKET/art --cache-control "public,max-age=31536000,immutable"
    MUSIC_CDN=https://cdn.example.com python3 build.py
"""
import hashlib, json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(os.path.dirname(HERE), "art_cache.json")
OUT = os.environ.get("MUSIC_ART_DIR") or os.path.expanduser("~/.musiclib/art")
MANIFEST = os.path.join(OUT, "manifest.json")
UA = "music-library-mirror/1.0"


def urls_from_cache():
    c = json.load(open(CACHE, encoding="utf-8"))
    seen = set()
    for v in c.get("albums2", {}).values():
        for k in ("cover", "cover_sm"):
            if v and v.get(k):
                seen.add(v[k])
    for v in c.get("artists", {}).values():
        for k in ("pic", "pic_sm"):
            if v and v.get(k):
                seen.add(v[k])
    return sorted(seen)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read(), (r.headers.get("Content-Type") or "image/jpeg")


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = json.load(open(MANIFEST, encoding="utf-8")) if os.path.exists(MANIFEST) else {}
    todo = [u for u in urls_from_cache() if u not in manifest]
    print(f"{len(manifest)} already mirrored; {len(todo)} to fetch", flush=True)

    done = failed = 0
    with ThreadPoolExecutor(max_workers=12) as ex:
        futs = {ex.submit(fetch, u): u for u in todo}
        for i, fut in enumerate(as_completed(futs), 1):
            u = futs[fut]
            try:
                body, ctype = fut.result()
            except Exception:
                failed += 1
                continue
            ext = ".png" if "png" in ctype else ".jpg"
            key = "art/" + hashlib.sha1(body).hexdigest()[:20] + ext
            path = os.path.join(OUT, os.path.basename(key))
            if not os.path.exists(path):
                with open(path, "wb") as f:
                    f.write(body)
            manifest[u] = key
            done += 1
            if i % 250 == 0:
                json.dump(manifest, open(MANIFEST, "w"), indent=0)
                print(f"  {i}/{len(todo)}", flush=True)

    json.dump(manifest, open(MANIFEST, "w"), indent=0)
    files = [f for f in os.listdir(OUT) if f != "manifest.json"]
    size = sum(os.path.getsize(os.path.join(OUT, f)) for f in files)
    uniq = len(set(manifest.values()))
    print(f"\nmirrored {done}, failed {failed}")
    print(f"{len(manifest)} urls -> {uniq} unique images ({len(manifest)-uniq} deduped)")
    print(f"{size/1e6:.0f} MB in {OUT}")
    print(f"S3 at $0.023/GB-month: ${size/1e9*0.023:.3f}/month")


if __name__ == "__main__":
    main()
