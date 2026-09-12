#!/usr/bin/env python3
"""Recover when each song was added to the library, as a real timestamp.

The YouTube Music export the rest of the pipeline runs on carries no dates --
its columns are title, artist, album, duration and video ids, and that is all.
Nor does Google hand one back: Takeout has no 'Liked Music' export, likes made
in YouTube Music never enter the 'Liked videos' playlist, and the YouTube Music
API offers only a_to_z, z_to_a and recently_added.

A position in that liked list is not an answer. It is not a fact about a song:
unlike one thing and every position after it shifts, so a stored rank is wrong
the moment the library changes and cannot be merged or compared across imports.
Only an instant survives that, so only instants are collected here -- and songs
no instant can be found for stay undated rather than being given a plausible
one.

  --dates watched    (default) the first time each song was played, from watch
                     history, standing in for when it was liked. A different
                     fact -- you can play something for years before liking it
                     -- but for music found and liked in one sitting the two are
                     within days, and it is the only real date usually left.

  --dates playlists  the playlist export's add timestamps. Real when they
                     survive, which is rarely; see the warnings it prints.

  python3 liked_at.py ~/Downloads/takeout-20260911.zip
  python3 liked_at.py ~/Downloads/takeout-*.zip --user alon --sql > /tmp/dates.sql

Writes ../liked_at.json, keyed by the video id `items.identifiers` already
stores, which `build.py` and `to_d1.py` pick up on their own. `--sql` instead
emits UPDATEs against a library already in D1, so a backfill does not mean
regenerating artwork and tracklists first.
"""
import argparse, csv, datetime, io, json, os, re, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.dirname(HERE)          # data lives one level above the scripts
sys.path.insert(0, HERE)
from to_d1 import q, user_id  # noqa: E402  -- one definition of the id scheme

CSV_PATH = os.environ.get("MUSIC_CSV", os.path.join(DATA, "liked_music_deduped.csv"))
OUT = os.environ.get("MUSIC_LIKED_AT", os.path.join(DATA, "liked_at.json"))

# Takeout writes 'Video ID' and 'Playlist Video Creation Timestamp'. Matched
# loosely because the exact spelling has changed between export versions.
VIDEO_RE = re.compile(r"video\s*_?\s*id", re.I)
TIME_RE = re.compile(r"time\s*_?\s*stamp|creation\s*_?\s*time", re.I)
# The liked playlist, in whatever the account's interface language calls it.
LIKED_RE = re.compile(r"liked|favourit|favorit|אהבתי|לייק", re.I)

NOW = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def csv_sources(root):
    """(label, text) for every CSV in a Takeout -- directory or .zip alike."""
    if os.path.isdir(root):
        for dirpath, _dirs, files in os.walk(root):
            for f in sorted(files):
                if f.lower().endswith(".csv"):
                    p = os.path.join(dirpath, f)
                    with io.open(p, encoding="utf-8-sig", errors="replace") as fh:
                        yield os.path.relpath(p, root), fh.read()
    elif zipfile.is_zipfile(root):
        with zipfile.ZipFile(root) as z:
            for n in sorted(z.namelist()):
                if n.lower().endswith(".csv"):
                    yield n, z.read(n).decode("utf-8-sig", "replace")
    else:
        raise SystemExit(f"not a Takeout directory or .zip: {root}")


def read_html(root, name):
    if os.path.isdir(root):
        for dirpath, _dirs, files in os.walk(root):
            for f in files:
                if f.lower() == name:
                    return io.open(os.path.join(dirpath, f),
                                   encoding="utf-8", errors="replace").read()
    elif zipfile.is_zipfile(root):
        with zipfile.ZipFile(root) as z:
            hit = [n for n in z.namelist() if n.lower().endswith(name)]
            if hit:
                return z.read(hit[0]).decode("utf-8", "replace")
    return None


# --------------------------------------------------------------- watch history

# One entry: a link to the video, then the moment it was watched.
WATCH_RE = re.compile(
    r'watch\?v=([\w-]{11})".*?<br>([A-Z][a-z]{2} \d{1,2}, \d{4}, [\d:]+\s*[AP]M [A-Z]+)', re.S)


def parse_watch(raw):
    """'Sep 11, 2026, 1:36:38 PM IDT'. The zone abbreviation is dropped rather
    than resolved: these are local wall-clock times whose only use is ordering
    and display to the person who made them, so an hour either way is noise."""
    try:
        return datetime.datetime.strptime(
            re.sub(r"\s+[A-Z]{3,4}$", "", raw.strip()).replace(" ", " "),
            "%b %d, %Y, %I:%M:%S %p")
    except ValueError:
        return None


def from_watch_history(root):
    """First play of each video. Earliest, never the latest, so a song replayed
    today keeps the date it arrived."""
    html = read_html(root, "watch-history.html")
    if html is None:
        raise SystemExit(
            "no watch-history.html in that Takeout -- re-export with 'history'\n"
            "ticked under YouTube and YouTube Music")
    dates, n = {}, 0
    for vid, when in WATCH_RE.findall(html):
        d = parse_watch(when)
        if not d:
            continue
        n += 1
        iso = d.strftime("%Y-%m-%dT%H:%M:%SZ")
        if vid not in dates or iso < dates[vid]:
            dates[vid] = iso
    print(f"  {n} plays over {len(dates)} distinct videos", file=sys.stderr)
    if dates:
        span = sorted(dates.values())
        print(f"  first-heard dates span {span[0][:10]} -> {span[-1][:10]}",
              file=sys.stderr)
        print("  note: watch history is a rolling window, not a lifetime -- it "
              "dates\n        recent likes well and older ones not at all",
              file=sys.stderr)
    return "watch-history", dates


# ------------------------------------------------------------ playlist exports

def parse_ts(raw):
    """Takeout has written several shapes over the years. Normalise to a single
    UTC ISO-8601 string, which sorts correctly as plain text and so needs no
    date type on either side of the wire."""
    s = (raw or "").strip()
    if not s:
        return None
    s = re.sub(r"\s+UTC$", "Z", s)
    s = s.replace(" ", "T", 1) if re.match(r"^\d{4}-\d\d-\d\d ", s) else s
    try:
        dt = datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def playlist_files(root):
    """Every CSV that actually carries a video id next to a timestamp. A
    Takeout holds dozens of unrelated CSVs; this is the shape that matters."""
    found = []
    for label, text in csv_sources(root):
        rdr = csv.DictReader(io.StringIO(text))
        cols = rdr.fieldnames or []
        vcol = next((c for c in cols if VIDEO_RE.search(c)), None)
        tcol = next((c for c in cols if TIME_RE.search(c)), None)
        if not vcol or not tcol:
            continue
        pairs = [(v, t) for v, t in
                 (((r.get(vcol) or "").strip(), parse_ts(r.get(tcol))) for r in rdr)
                 if v and t]
        if pairs:
            found.append((label, pairs))
    return found


def choose(found, wanted):
    """Pick the liked playlist, and say so out loud rather than guessing
    quietly -- picking the wrong file would date every song plausibly and
    wrongly, which is worse than failing."""
    if wanted:
        hit = [f for f in found if wanted.lower() in f[0].lower()]
        if not hit:
            raise SystemExit(f"no playlist file matching {wanted!r}")
        return hit
    hit = [f for f in found if LIKED_RE.search(os.path.basename(f[0]))]
    if hit:
        return hit
    if len(found) == 1:
        return found
    print("Could not tell which playlist holds your likes. Found:", file=sys.stderr)
    for label, pairs in found:
        print(f"  {label}  ({len(pairs)} entries)", file=sys.stderr)
    raise SystemExit("re-run with --playlist <part of the filename>, or --any")


def from_playlists(root, wanted, use_any):
    found = playlist_files(root)
    if not found:
        raise SystemExit(
            "no playlist CSV with timestamps in that Takeout -- re-export with\n"
            "'playlist videos' ticked under YouTube and YouTube Music")
    dates = {}
    for label, pairs in (found if use_any else choose(found, wanted)):
        print(f"  {label}: {len(pairs)} entries", file=sys.stderr)
        for vid, ts in pairs:                 # earliest wins: re-adding a song
            if vid not in dates or ts < dates[vid]:   # must not restate its age
                dates[vid] = ts
    print(f"  {len(dates)} distinct videos dated", file=sys.stderr)

    # A bulk playlist rewrite stamps thousands of entries within seconds of each
    # other. Those dates are real but meaningless, and silently importing them
    # would order the library by an event that has nothing to do with liking.
    spread = sorted(set(dates.values()))
    if len(spread) > 1 and len(dates) > 100:
        lo = datetime.datetime.fromisoformat(spread[0].replace("Z", "+00:00"))
        hi = datetime.datetime.fromisoformat(spread[-1].replace("Z", "+00:00"))
        if (hi - lo).total_seconds() < 86400:
            print(f"  warning: every date falls within {hi - lo} of {spread[0]} "
                  f"({len(spread)} distinct values). That is a bulk playlist "
                  f"rewrite, not your like history -- do not import it",
                  file=sys.stderr)
    return "takeout-playlists", dates


# ----------------------------------------------------------------------- shared

def earliest(video_ids, dates):
    """One library row can carry several uploads of the same song; the date
    that matters is the earliest, when the song first arrived."""
    vals = [dates[v] for v in (video_ids or "").split(";") if v and v in dates]
    return min(vals) if vals else None


def coverage(dates):
    """How much of the actual library this accounts for. A silent 4% match rate
    would otherwise look exactly like a working import."""
    if not os.path.exists(CSV_PATH):
        return
    rows = list(csv.DictReader(io.open(CSV_PATH, encoding="utf-8-sig")))
    hit = sum(1 for r in rows if earliest(r.get("videoIds"), dates))
    n = len(rows) or 1
    print(f"  library coverage: {hit}/{len(rows)} songs dated "
          f"({100.0 * hit / n:.1f}%); the rest stay undated and sort last",
          file=sys.stderr)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("takeout", help="a Takeout directory or .zip")
    ap.add_argument("--dates", choices=("watched", "playlists"), default="watched",
                    help="which record to take the timestamps from")
    ap.add_argument("--playlist", default=None,
                    help="part of the playlist filename, if the guess is wrong")
    ap.add_argument("--any", action="store_true",
                    help="merge every playlist, not just the liked one")
    ap.add_argument("--sql", action="store_true",
                    help="emit UPDATEs for a library already in D1")
    ap.add_argument("--user", default="alon", help="handle, for --sql")
    a = ap.parse_args()

    src, dates = (from_playlists(a.takeout, a.playlist, a.any) if a.dates == "playlists"
                  else from_watch_history(a.takeout))
    coverage(dates)

    if not a.sql:
        with io.open(OUT, "w", encoding="utf-8") as fh:
            json.dump({"source": src, "generated": NOW, "dates": dates},
                      fh, ensure_ascii=False, sort_keys=True)
        print(f"wrote {OUT}  ({len(dates)} videos, from {src})", file=sys.stderr)
        return

    # Item ids are positional in the CSV, exactly as to_d1.py assigns them, so
    # a backfill lands on the same rows a full re-import would have written.
    if not os.path.exists(CSV_PATH):
        raise SystemExit(f"--sql needs the library CSV at {CSV_PATH}")
    uid = user_id(a.user)
    rows = list(csv.DictReader(io.open(CSV_PATH, encoding="utf-8-sig")))
    n_set = 0
    sys.stdout.write(f"-- liked_at backfill for {a.user}, from {src}\n")
    for n, r in enumerate(rows):
        ts = earliest(r.get("videoIds"), dates)
        if not ts:
            continue
        n_set += 1
        sys.stdout.write(
            f"UPDATE items SET liked_at={q(ts)} WHERE id={q(f'i_{uid}_{n}')};\n")
    print(f"  {n_set} UPDATE statements", file=sys.stderr)


if __name__ == "__main__":
    main()
