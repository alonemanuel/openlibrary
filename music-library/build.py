#!/usr/bin/env python3
"""Build the music library page from the CSV + the artwork cache.

Reads:  liked_music_deduped.csv  (read-only)
        art_cache.json           (artists + albums2)
Writes: library.html
"""
import csv, json, os, re, collections, datetime, sys, unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from clean import clean_title, split_bilingual
from match import match_album
from slug import slug, short_hash, unique_slugs
from credits import split_credit

HERE = os.path.dirname(os.path.abspath(__file__))
CSV = os.environ.get(
    "MUSIC_CSV",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                 "liked_music_deduped.csv"))
CACHE = os.path.join(HERE, "art_cache.json")
NAMES = os.path.join(HERE, "names.json")     # curated Hebrew/Arabic -> English
# The deployed Worker shell is the single source of truth for the page. The
# offline build injects DATA into a copy of it; the Worker injects a signed-in
# user's library into the same file at request time. Keep it data-free on disk
# (the deploy CI asserts the /*__DATA__*/null placeholder is intact).
TEMPLATE = os.path.join(HERE, "worker", "public", "index.html")
# Alongside the export, one level up from the scripts.
OUT = os.environ.get("MUSIC_OUT") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "library.html")

DZ_RE = re.compile(r"https://(?:e-)?cdn-images\.dzcdn\.net/images/([a-z]+)/([0-9a-f]+)/")
KINDS = ["cover", "artist", "misc", "playlist", "user", "talk"]
# 0 album · 1 single · 2 ep · 3 compilation · 4 unknown
RTYPE = {"album": 0, "single": 1, "ep": 2, "compile": 3, "compilation": 3}


# Serve mirrored art from our own bucket when MUSIC_CDN is set, so the page
# stops depending on Deezer's CDN staying reachable and un-hotlink-blocked.
# Anything that failed to mirror keeps its original URL rather than 404ing.
CDN = (os.environ.get("MUSIC_CDN") or "").rstrip("/")
_MANIFEST = os.environ.get("MUSIC_ART_MANIFEST") or os.path.expanduser(
    "~/.musiclib/art/manifest.json")
MIRROR = (json.load(open(_MANIFEST, encoding="utf-8"))
          if (CDN and os.path.exists(_MANIFEST)) else {})


def pack_url(url):
    if not url:
        return ""
    if CDN:
        key = MIRROR.get(url)
        if key:
            return CDN + "/" + key
    m = DZ_RE.match(url)
    if not m:
        return url                       # iTunes URLs stay verbatim
    kind, h = m.group(1), m.group(2)
    return f"{KINDS.index(kind)}:{h}" if kind in KINDS else url


def norm(s):
    return " ".join((s or "").strip().split())


LATIN = re.compile(r"[A-Za-z]")
NONLATIN = re.compile(r"[\u0590-\u05ff\u0600-\u06ff]")


def is_latin(s):
    """Latin letters and no Hebrew/Arabic — usable as an English name as-is."""
    return bool(s) and bool(LATIN.search(s)) and not NONLATIN.search(s)


# Deezer collapses a collaboration credit to its lead artist and files odd
# releases under these — useless as an identity for the credit we actually have.
JUNK_DZ = {"various artists", "various", "unknown artist", "va", "soundtrack",
           "original soundtrack", "traditional"}


COLLAB = re.compile(r"[,&]|\bfeat\.?\b|\bft\.?\b|\bwith\b|\bx\b", re.I)


def is_collab(name):
    """A credit naming several acts. Deezer reports only the lead artist for
    these, so its name must never stand in for the whole credit."""
    return bool(COLLAB.search(name or ""))


def known_english(display, latin, dz_name):
    """An English name we actually know — never a transliteration guess."""
    if is_latin(display):
        return display                      # already English; use it verbatim
    if latin:
        return latin
    if (is_latin(dz_name) and not is_collab(display)
            and dz_name.strip().casefold() not in JUNK_DZ):
        return dz_name
    return ""


NAMES_MAP = json.load(open(NAMES, encoding="utf-8")) if os.path.exists(NAMES) else {}


def english_name(display, latin, dz_name):
    """Slug source: the real English name if we have one, else transliteration.

    Display order matters — a credit like 'Bootie Brown, Gorillaz' is already
    English and must not be replaced by Deezer's lead artist ('Gorillaz'), or
    every collaboration would collide with the headliner.
    """
    # A curated name beats transliteration but not a name the artist uses
    # themselves, so it sits between the two.
    return (slug(known_english(display, latin, dz_name))
            or slug(NAMES_MAP.get(display, ""))
            or slug(display))


def secs(d):
    if not d:
        return 0
    p = [int(x) for x in d.split(":")]
    while len(p) < 3:
        p.insert(0, 0)
    return p[0] * 3600 + p[1] * 60 + p[2]


def main():
    rows = list(csv.DictReader(open(CSV, encoding="utf-8-sig")))
    cache = json.load(open(CACHE, encoding="utf-8"))
    ac = cache.get("artists", {})
    alc = cache.get("albums2", {}) or {}
    legacy = cache.get("albums", {})
    tlists = cache.get("tracks", {}) or {}

    # Merge artists that render to the same display name — 'דודא' and
    # 'דודא - Duda' are one artist, and after the bilingual split they'd
    # otherwise sit in the grid as two tiles.
    dz_artist_of = {}
    for k, v in alc.items():
        if v and v.get("dz_artist") and is_latin(v["dz_artist"]):
            dz_artist_of.setdefault(k.split("␟")[0], v["dz_artist"])

    def dz_knows_whole(name):
        """Deezer lists the entire credit as one artist -> it's a band."""
        v = ac.get(name) or {}
        return (v.get("dz_name") or "").strip().casefold() == (name or "").strip().casefold()

    raw_names = {norm(r.get("artist")) for r in rows if norm(r.get("artist"))}
    # 'Vibe Ish, Roisha' is two acts; 'Tyler, The Creator' is one. Everything
    # downstream works on the resolved member list, not the raw credit.
    credit_members = {raw: (split_credit(raw, dz_knows_whole) or [raw])
                      for raw in raw_names}
    member_names = {m for ms in credit_members.values() for m in ms}
    n_split = sum(1 for ms in credit_members.values() if len(ms) > 1)

    merged = {}                       # display -> {"latin","pic","pic_sm","raws"}
    for raw in sorted(member_names):
        disp, latin = split_bilingual(raw)
        info = ac.get(raw) or {}
        m = merged.setdefault(disp, {"latin": "", "pic": "", "pic_sm": "",
                                     "raws": [], "dz": ""})
        m["raws"].append(raw)
        if latin and not m["latin"]:
            m["latin"] = latin
        # `raw` is a member name here, so ac[raw] describes that act — either
        # from the original pass (it's also a credit on its own) or from the
        # member pass. Combined-credit entries are keyed by the whole credit
        # string and are simply never looked up.
        for cand in (info.get("dz_name"), dz_artist_of.get(raw)):
            if cand and is_latin(cand) and not m["dz"]:
                m["dz"] = cand
        if info.get("pic") and not m["pic"]:
            m["pic"], m["pic_sm"] = info["pic"], info.get("pic_sm") or info["pic"]
    use_count = collections.Counter()
    for r in rows:
        rn = norm(r.get("artist"))
        if rn:
            use_count[rn] += 1

    def fold_key(x):
        """Casing and accents don't make a different artist."""
        x = unicodedata.normalize("NFKD", norm(x).casefold())
        return "".join(c for c in x if not unicodedata.combining(c))

    def merge_case_variants():
        """'MF Doom'/'MF DOOM', 'JAY-Z'/'JAŸ-Z' — keep the spelling used most."""
        weight = {d: sum(use_count.get(r, 0) for r in m["raws"]) for d, m in merged.items()}
        groups = collections.defaultdict(list)
        for d in merged:
            groups[fold_key(d)].append(d)
        n = 0
        for _, variants in groups.items():
            if len(variants) < 2:
                continue
            keep = max(variants, key=lambda d: (
                weight.get(d, 0),
                fold_key(merged[d]["dz"]) == fold_key(d),
                d))
            for d in variants:
                if d == keep:
                    continue
                m, t = merged.pop(d), merged[keep]
                t["raws"] += m["raws"]
                t["latin"] = t["latin"] or m["latin"]
                t["dz"] = t["dz"] or m["dz"]
                if not t["pic"]:
                    t["pic"], t["pic_sm"] = m["pic"], m["pic_sm"]
                n += 1
        return n

    n_case = merge_case_variants()

    # 'הדג נחש' and 'Hadag Nahash' are the same act listed twice. Merge only on
    # an exact match of a *known* English name — never on a transliteration.
    latin_key = {}
    for d in merged:
        if is_latin(d):
            latin_key.setdefault(norm(d).casefold(), d)
    alias = {}
    for d, m in list(merged.items()):
        if is_latin(d) or is_collab(d):     # never fold a collab into a solo act
            continue
        en = known_english(d, m["latin"], m["dz"]) or NAMES_MAP.get(d, "")
        tgt = latin_key.get(norm(en).casefold()) if en else None
        if tgt and tgt != d:
            alias[tgt] = d                     # keep the native-script display
    n_alias = 0
    for src, dst in alias.items():
        if src not in merged:
            continue
        m, t = merged.pop(src), merged[dst]
        t["raws"] += m["raws"]
        t["latin"] = t["latin"] or m["latin"]
        t["dz"] = t["dz"] or m["dz"]
        if not t["pic"]:
            t["pic"], t["pic_sm"] = m["pic"], m["pic_sm"]
        n_alias += 1

    n_case += merge_case_variants()      # a survivor may now have a case twin

    disp_of = {raw: d for d, m in merged.items() for raw in m["raws"]}
    n_merged = sum(len(m["raws"]) - 1 for m in merged.values())

    credit_members = {c: [disp_of.get(m, m) for m in ms]
                      for c, ms in credit_members.items()}

    artist_ix, artists = {}, []
    album_ix, albums, alb_ckey = {}, [], []
    songs = []
    ACCT = {"personal": 0, "gsuite": 1, "both": 2}
    n_clean = 0

    for r in rows:
        raw_title = norm(r.get("title"))
        title, changed = clean_title(raw_title)
        n_clean += bool(changed)
        raw_ar = norm(r.get("artist"))
        al = norm(r.get("album"))
        dur = norm(r.get("duration"))
        vid = norm(r.get("videoIds"))
        acct = ACCT.get(norm(r.get("account")), 2)
        ytm = 1 if norm(r.get("in_ytmusic")) == "yes" else 0

        ais = []
        for member in (credit_members.get(raw_ar) or []):
            disp = disp_of.get(member)
            if disp is None:
                continue
            if disp not in artist_ix:
                artist_ix[disp] = len(artists)
                m = merged[disp]
                artists.append([disp, pack_url(m["pic"]), pack_url(m["pic_sm"]),
                                0, 0, m["latin"], ""])
            ix = artist_ix[disp]
            if ix not in ais:
                ais.append(ix)
        ai = ais[0] if ais else -1        # album is filed under the lead act

        li = -1
        if al and ai >= 0:
            k = (ai, al)
            if k not in album_ix:
                album_ix[k] = len(albums)
                # The artwork cache is keyed by the raw credit, so try that
                # first, then every raw spelling of the acts it names.
                cand_keys = [raw_ar]
                for member in (credit_members.get(raw_ar) or []):
                    d2 = disp_of.get(member)
                    if d2:
                        cand_keys += merged[d2]["raws"]
                info, ckey = None, None
                seen_k = set()
                for rn in [k for k in cand_keys if not (k in seen_k or seen_k.add(k))]:
                    k2 = f"{rn}␟{al}"
                    info = alc.get(k2) or legacy.get(k2)
                    if info:
                        ckey = k2
                        break
                info = info or {}
                rt = RTYPE.get((info.get("rtype") or ""), 4)
                albums.append([al, ai, pack_url(info.get("cover")),
                               pack_url(info.get("cover_sm")), 0, rt, None, "",
                               info.get("dz_title") or ""])
                alb_ckey.append(ckey)
            li = album_ix[k]

        songs.append([title, ai, li, secs(dur), vid, acct, ytm, ais])

    alb_tracks = collections.Counter(s[2] for s in songs if s[2] >= 0)
    art_tracks = collections.Counter(a for s in songs for a in s[7])
    # An album shows on every credited artist's page, not only the lead's.
    art_albums = collections.defaultdict(set)
    for s_ in songs:
        if s_[2] >= 0:
            for a in s_[7]:
                art_albums[a].add(s_[2])
    for i, a in enumerate(albums):
        a[4] = alb_tracks.get(i, 0)
    for i, a in enumerate(artists):
        a[3] = art_tracks.get(i, 0)
        a[4] = len(art_albums.get(i, ()))

    # Official tracklists: [title, seconds, likedSongIdx | -1]. Liked songs that
    # aren't on the official list are appended so nothing disappears from view.
    by_album = collections.defaultdict(list)
    for si, s_ in enumerate(songs):
        if s_[2] >= 0:
            by_album[s_[2]].append((si, s_[0]))

    n_tl = n_grey = n_extra = 0
    suspect = []
    for i, a in enumerate(albums):
        ck = alb_ckey[i]
        tl = tlists.get(ck) if ck else None
        official = (tl or {}).get("t")
        liked = by_album.get(i, [])
        if not official:
            continue
        # Guard: the tracklist must be the release pass 2 measured. A shorter one
        # means we resolved to the single or hit a paginated response.
        want_n = ((alc.get(ck) or {}).get("ntracks")) or 0
        if want_n and len(official) != want_n:
            suspect.append((a[0], len(official), want_n))
            continue
        if len(official) < len(liked):
            suspect.append((a[0], len(official), len(liked)))
            continue
        assigned, leftover = match_album(liked, official)
        rows = [[t[0], t[1], assigned.get(j, -1)] for j, t in enumerate(official)]
        for si in leftover:
            rows.append([songs[si][0], songs[si][3], si])
        a[6] = rows
        n_tl += 1
        n_grey += sum(1 for r in rows if r[2] < 0)
        n_extra += len(leftover)

    # A release we only hold one track from, that nobody identified as a real
    # album, is a single in all but name — keep it out of the Albums grid.
    for a in albums:
        if a[5] == 4 and a[4] == 1:
            a[5] = 1

    # URLs are ASCII English: real Latin name where one exists, transliteration
    # otherwise, disambiguated with a short hash only when two collide.
    # Assign slugs biggest-first so the artist you actually listen to gets the
    # clean name and a one-off guest credit takes the suffix.
    ar_order = sorted(range(len(artists)), key=lambda i: (-artists[i][3], artists[i][0]))
    ar_slug_of = dict(zip(ar_order, unique_slugs(
        ar_order,
        keyfn=lambda i: artists[i][0],
        base_fn=lambda i: english_name(artists[i][0], artists[i][5],
                                       merged[artists[i][0]]["dz"]))))
    ar_slugs = [ar_slug_of[i] for i in range(len(artists))]
    for i, sg in enumerate(ar_slugs):
        artists[i][6] = sg

    al_slugs = unique_slugs(
        list(range(len(albums))),
        keyfn=lambda i: artists[albums[i][1]][0] + "\u241f" + albums[i][0],
        base_fn=lambda i: (ar_slugs[albums[i][1]] + "--"
                           + (slug(albums[i][8] if is_latin(albums[i][8]) else "")
                              or slug(NAMES_MAP.get(albums[i][0], ""))
                              or slug(albums[i][0])
                              or "album")))
    for i, sg in enumerate(al_slugs):
        albums[i][7] = sg
        del albums[i][8]                       # dz_title was only needed here

    data = {"songs": songs, "artists": artists, "albums": albums,
            "kinds": KINDS, "built": datetime.date.today().isoformat(),
            "src": "liked_music_deduped.csv"}

    html = open(TEMPLATE, encoding="utf-8").read()
    html = html.replace("/*__DATA__*/null",
                        json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)

    tc = collections.Counter(a[5] for a in albums)
    names = {0: "album", 1: "single", 2: "EP", 3: "compilation", 4: "unknown"}
    print(f"songs   : {len(songs)}  ({n_clean} titles tidied)")
    print(f"credits : {n_split} split into multiple artists")
    print(f"artists : {len(artists)}  ({sum(1 for a in artists if a[1])} photos, "
          f"{sum(1 for a in artists if a[5])} with a stored Latin name, "
          f"{n_merged} duplicate name variants merged, {n_alias} Latin/native pairs, "
          f"{n_case} case variants)")
    print(f"albums  : {len(albums)}  ({sum(1 for a in albums if a[2])} covers, "
          f"{n_tl} with official tracklists)")
    print(f"  greyed unliked tracks: {n_grey}   liked-but-not-on-tracklist: {n_extra}")
    if suspect:
        print(f"  !! {len(suspect)} tracklists rejected as the wrong release "
              f"(shown without a tracklist): {suspect[:5]}")
    print("  types :", {names[k]: v for k, v in sorted(tc.items())})
    print(f"out     : {OUT}  ({os.path.getsize(OUT)/1e6:.2f} MB)")


if __name__ == "__main__":
    main()
