#!/usr/bin/env python3
"""Emit the library as SQL for D1, splitting global metadata from user data.

The page currently ships its whole dataset inlined in the HTML, which is fine
for one person and impossible for several. This writes the same content as
rows: cover art, tracklists and name translations shared by everyone, and the
liked songs owned by one user.

  python3 to_d1.py --user alon > /tmp/library.sql
  wrangler d1 execute openlibrary --remote --file /tmp/library.sql
"""
import argparse, datetime, hashlib, io, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from slug import slug  # noqa: E402

NOW = datetime.datetime.now(datetime.timezone.utc).isoformat()
NONLAT = re.compile(r"[֐-׿؀-ۿ]")


def q(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def norm_key(*parts):
    """Identity for shared rows. Casing and accents must not fork a row, or
    one person's 'BONOBO' stops hitting another's 'Bonobo'."""
    import unicodedata
    s = "␟".join(p or "" for p in parts)
    s = unicodedata.normalize("NFKD", s.casefold())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return "name:" + re.sub(r"\s+", " ", s).strip()


MAX_STMT = 60_000          # D1 raises SQLITE_TOOBIG well before 100 KB


def batched(rows, table, cols, size=None):
    """Multi-row INSERTs budgeted by bytes, not row count — a row holding a
    long Deezer URL is several times the size of a bare tracklist entry."""
    head = f"INSERT OR REPLACE INTO {table} ({','.join(cols)}) VALUES\n"
    buf, used = [], 0
    for r in rows:
        piece = "(" + ",".join(q(v) for v in r) + ")"
        if buf and used + len(piece) > MAX_STMT:
            yield head + ",\n".join(buf) + ";"
            buf, used = [], 0
        buf.append(piece)
        used += len(piece) + 2
    if buf:
        yield head + ",\n".join(buf) + ";"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", default="alon")
    ap.add_argument("--email", default=None)
    ap.add_argument("--html", default=os.path.join(os.path.dirname(HERE), "library.html"))
    a = ap.parse_args()

    html = io.open(a.html, encoding="utf-8").read()
    data = json.loads(re.search(r"const DATA = (\{.*?\});\n", html, re.S).group(1))
    A, AL, S = data["artists"], data["albums"], data["songs"]
    KINDS = data["kinds"]

    def unpack(p, size):
        if not p:
            return None
        i = p.find(":")
        if i < 0 or not p[:i].isdigit():
            return p
        return (f"https://cdn-images.dzcdn.net/images/{KINDS[int(p[:i])]}/"
                f"{p[i+1:]}/{size}x{size}-000000-80-0-0.jpg")

    out = [f"-- generated {NOW}", "PRAGMA defer_foreign_keys = true;"]

    # users.email and password_hash are NOT NULL. This row is an import
    # placeholder — the password hash is deliberately unusable, so the account
    # can only be claimed by setting a real credential through the app.
    uid = "u_" + hashlib.sha1(a.user.encode()).hexdigest()[:12]
    out.append(
        "INSERT OR IGNORE INTO users "
        "(id, email, handle, display_name, password_hash, created_at, library_visibility) "
        f"VALUES ({q(uid)},{q(a.email or a.user + '@local.invalid')},{q(a.user)},"
        f"{q(a.user)},{q('!import-no-login')},{q(NOW)},{q('private')});")

    # ---- global: artists + albums ----
    assets, akey, alkey = [], {}, {}
    for i, ar in enumerate(A):
        k = norm_key("artist", ar[0])
        akey[i] = k
        assets.append([k, "artist", ar[0], ar[6], None, "deezer",
                       unpack(ar[1], 500), None, None, NOW,
                       unpack(ar[2], 250), ar[5] or None])
    for i, al in enumerate(AL):
        k = norm_key("album", A[al[1]][0], al[0])
        alkey[i] = k
        rt = {0: "album", 1: "single", 2: "ep", 3: "compilation"}.get(al[5])
        assets.append([k, "album", al[0], al[7], None, "deezer",
                       unpack(al[2], 500), rt, al[4], NOW,
                       unpack(al[3], 250), None])
    cols = ["music_key", "kind", "display_name", "slug", "image_key",
            "image_source", "source_url", "release_type", "n_tracks", "checked_at",
            "image_sm_url", "latin_name"]
    out += list(batched(assets, "media_assets", cols))

    # ---- global: official tracklists ----
    tracks = []
    for i, al in enumerate(AL):
        for pos, t in enumerate(al[6] or [], 1):
            tracks.append([alkey[i], pos, t[0], t[1] or 0, None])
    out += list(batched(tracks, "release_tracks",
                        ["music_key", "position", "title", "seconds", "isrc"]))

    # ---- global: curated romanisations ----
    npath = os.path.join(HERE, "names.json")
    if os.path.exists(npath):
        names = [[k, v, 1] for k, v in json.load(io.open(npath, encoding="utf-8")).items()]
        out += list(batched(names, "name_translations",
                            ["source_name", "english", "reviewed"]))

    # ---- per-user: the liked songs ----
    # build.py already paired liked songs to official positions using the
    # tiered matcher; reuse that rather than re-deriving it at request time.
    pos_of = {}
    for ai, al in enumerate(AL):
        for pos, row in enumerate(al[6] or [], 1):
            if row[2] is not None and row[2] >= 0:
                pos_of[row[2]] = pos

    items = []
    for n, s in enumerate(S):
        credit = ", ".join(A[x][0] for x in (s[5] or []) if x >= 0)
        ident = {"videoId": s[4], "seconds": s[3]}
        items.append([
            f"i_{uid}_{n}", uid, "music", s[0], credit, None, "liked", None,
            "[]", "", json.dumps(ident, ensure_ascii=False),
            None, "ytmusic", "private", NOW, NOW, None,
            alkey.get(s[2]) if s[2] is not None and s[2] >= 0 else None,
            pos_of.get(n),
        ])
    out += list(batched(items, "items", [
        "id", "user_id", "media_type", "title", "creators", "year", "status",
        "rating", "tags", "notes", "identifiers", "cover_url", "source",
        "visibility", "created_at", "updated_at", "deleted_at", "music_key",
        "track_pos"]))

    links = []
    for n, s_ in enumerate(S):
        for pos, ai in enumerate(s_[5] or []):
            if ai >= 0:
                links.append([f"i_{uid}_{n}", akey[ai], pos])
    out += list(batched(links, "item_artists", ["item_id", "music_key", "position"]))

    alinks, seen_al = [], set()
    for n, s_ in enumerate(S):
        if s_[2] is None or s_[2] < 0:
            continue
        for pos, ai in enumerate(s_[5] or []):
            if ai < 0:
                continue
            pair = (alkey[s_[2]], akey[ai])
            if pair in seen_al:
                continue
            seen_al.add(pair)
            alinks.append([pair[0], pair[1], pos])
    out += list(batched(alinks, "album_artists", ["album_key", "artist_key", "position"]))


    sys.stdout.write("\n".join(out) + "\n")
    print(f"-- media_assets {len(assets)} · release_tracks {len(tracks)} · "
          f"items {len(items)} · item_artists {len(links)} · album_artists {len(alinks)}",
          file=sys.stderr)


if __name__ == "__main__":
    main()
