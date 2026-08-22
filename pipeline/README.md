# Music library page — how to rebuild

`../library.html` is generated from `../liked_music_deduped.csv` plus a cached set of
artwork URLs. It's a single self-contained file: open it in a browser, no server needed.

This folder is only the offline build pipeline; the deployed site lives in
`../worker/` and never runs any of this. Data files (the CSV export,
`art_cache.json`, the generated `library.html`) live one level up, in the
repository root — all gitignored.

## Files

| File | What it is |
|---|---|
| `fetch_art.py` | Pass 1 — artist photos from Deezer, cached to `art_cache.json`. Resumable. |
| `repair.py` | Re-checks loosely-matched artists under the stricter matcher. |
| `fetch_art2.py` | Pass 2 — album covers: ranks candidates, records album/single/EP, falls back to iTunes. Writes `albums2`. |
| `fetch_art3.py` | Pass 3 — recovers covers missed by transliteration (`הדג נחש` vs `Hadag Nahash`). |
| `fetch_art4.py` | Pass 4 — artist photos via romanised names learned from album matches. |
| `fetch_art5.py` | Pass 5 — upgrades substring artist matches to exact ones. |
| `fetch_tracks.py` | Official tracklists, so album sheets can grey out unliked tracks. Writes `tracks`. |
| `match.py` | Pairs liked songs to official tracks (exact → feature-stripped → fuzzy). |
| `clean.py` | Title tidying + Hebrew/Latin name splitting. Run it directly to see its test cases. |
| `build.py` | Merges CSV + cache into `../library.html`. |
| `../worker/public/index.html` | The page — single source of truth. `build.py` injects data where `/*__DATA__*/null` appears; the Cloudflare Worker injects a signed-in user's library at request time. The file on disk must keep the placeholder intact (CI enforces this on deploy). |
| `../art_cache.json` | Cached artwork URLs. Only URLs are stored — no images are downloaded. |

## Rebuild after re-exporting your likes

```bash
python3 fetch_art.py     # artist photos
python3 repair.py        # drop loose artist matches
python3 fetch_art2.py    # album covers + release types
python3 fetch_art3.py    # recover covers missed by transliteration
python3 fetch_art4.py    # artist photos via romanised names
python3 fetch_art5.py    # prefer exact artist matches
python3 fetch_tracks.py  # official tracklists
python3 build.py         # regenerates ../library.html
```

Every pass is resumable — re-running only fetches what isn't cached.

Standard library only — nothing to install. Don't create a venv in Google Drive;
the sync client chokes on it.

## How the messy cases are handled

**Wrong covers.** Deezer's first hit is often a different edition — the strict query
for Bonobo / "Black Sands" returns *Black Sands Remixed* first. Candidates are scored
(exact title 4 → prefix 2 → contains 1) and any title whose extra words name a
different edition (remix, live, instrumental, karaoke…) scores 0 and is rejected.

**Wrong faces.** An artist photo is only used when the Deezer name actually matches.
Without that, labels and radio stations (KEXP, Raw Tapes) get a random musician's
face. Unmatched artists fall back to a generated gradient tile.

**Singles vs albums.** Taken from Deezer's `record_type`. The Albums tab shows albums
and compilations by default; singles and EPs are one click away under "Show". A
release that couldn't be identified *and* has only one liked track is treated as a
single, since that's what it almost always is.

**Hebrew / English names.** `דודא - Duda` displays as **דודא** with `Duda` kept
underneath, stored, and searchable — typing "duda" still finds it. Splitting only
happens on an explicit separator (`-`, `|`, `/`, `\`) with one side purely Hebrew or
Arabic and the other purely Latin. Commas and ampersands are never split, because
`Balkan Beat Box, אקווריום` is a collaborator list, not one bilingual name. Variants
that resolve to the same display name are merged into one artist, so `דודא` and
`דודא - Duda` are a single tile rather than two.

**Title cleanup.** Strips YouTube packaging only: `(Official Music Video)`, trailing
`Official Video`, leading track numbers (`03. `), the `#2 - ` series prefix and its
`- 1/10` counterpart. Feature credits, `(Live)`, `(Remix)` and bracketed subtitles are
left alone. It currently rewrites 21 of 9,475 titles — deliberately conservative.
To see exactly what it would change, run `python3 clean.py`.

**Greyed-out tracks.** Album sheets show the full official running order with
unliked tracks dimmed and inert. Two traps here, both guarded against:

* *An album and its lead single share a title*, and Deezer returns the single
  first — so `Habib Galbi` resolved to a 1-track single against 12 liked tracks.
  Pass 2 records the real track count, and the id lookup now uses it to pick the
  right release.
* *`/album/{id}` caps its embedded tracklist at 25.* Short albums hid this;
  Drukqs came back 25 of 30. The `/tracks` sub-resource is paged instead.

`build.py` refuses any tracklist whose length disagrees with the recorded track
count and prints a warning, so a wrong release can't render silently. Liked songs
that match nothing on the official list are appended rather than dropped.

## Playing music

Clicking a track plays it **inside the page** — a bar appears at the bottom and a
small video panel floats above it. Nothing opens a new tab.

* Clicking in **Songs** queues the whole visible (filtered, sorted) list.
* Clicking inside an **album** queues that album in its running order; inside an
  **artist**, all their liked tracks.
* Space = play/pause · Shift+→ / Shift+← = next / previous · 🎞 hides the video
  and keeps the audio · ↗ opens the track on YouTube · Cmd-click a row goes
  straight to YouTube without touching the player.

**Two engines, picked automatically.** Over `http://` the YouTube IFrame API
works and you get a true seek bar and automatic advance on track end. Opened
straight from Finder (`file://`) the browser reports a `null` origin, YouTube
refuses the API handshake, and the page falls back to a plain embed after 6
seconds: playback, play/pause, seek and volume all still work, but the position
is estimated from the track length rather than read from the player.

For the full experience, double-click **`Play Music Library.command`** in the
`music` folder — it serves the folder on localhost and opens the page. Leave the
Terminal window open while listening; closing it stops the server. It binds to
127.0.0.1, so nothing is reachable from outside this Mac.

Some uploaders disable embedding. Those tracks can't play in-page — the player
says so and skips to the next one.

## The local server

`Play Music Library.command` runs `library_build/server.py`, which serves the
folder **and** adds three things a static page can't do:

| Endpoint | Why |
|---|---|
| `GET /api/status` | tells the page which features to switch on |
| `GET /api/resolve?artist=&title=&album=` | YouTube Music search → videoId, so album tracks you never liked can play. Cached, so each track is looked up once. |
| `POST /api/rate {videoId, rating}` | thumbs-up on YouTube Music via `ytmusicapi` |

Bound to 127.0.0.1. Opened as a bare file the page still works — it just hides
liking and greys stay unplayable.

**Runtime state lives in `~/AlonPersonal/musiclib/`, deliberately outside Drive:**

* `browser.json` — your YouTube Music session headers. These are login cookies;
  they must never sync to Google Drive. `chmod 600`.
* `resolved.json` — cached search results.
* `likes.json` — mirror of what's been rated, so the page shows state on load.

`ytmusicapi` lives in a venv at `~/AlonPersonal/musiclib/venv`. It is **not** in
Drive on purpose: a venv is tens of thousands of files and would overwhelm sync.

### Signing in

Run `Set up YouTube Music login.command` once. It walks through copying request
headers out of a logged-in YouTube Music tab. You paste them; they're written
straight to `browser.json` and never leave the machine. Search works without
this — only liking needs it.

If likes stop working, YouTube rotated the session: run it again.

## Playing tracks you never liked

Greyed album tracks have no videoId (the export only ever contained liked
songs). Clicking one asks the server to find it on YouTube Music, appends it to
the in-memory library, and plays it. It stays dimmed until you actually like
it — dimmed means *not liked*, not *not playable*.

YouTube's `listType=search` embed parameter, which would have avoided the server
entirely, no longer resolves: the player cues and reports no title, no duration,
and an empty playlist.

## Deep links

**Display follows the music's own language; anything machine-readable is
English.** Titles and artist names render in Hebrew or Arabic where that's the
name, but URLs, slugs and cache keys are ASCII.

Slugs come from a real English name when one exists — the Latin half of a
bilingual credit, or the romanised name Deezer uses (`רביד פלוטניק` →
`ravid-plotnik`). Only when nothing English is on record do we transliterate
(`עטר מיינר` → `tr-myynr`), which is lossy but deterministic. A four-character
hash is appended only when two slugs would otherwise collide.

Two traps, both guarded in `build.py`:

* Deezer reports the **lead artist** for a collaboration, so using its name as
  an identity collapses `Bootie Brown, Gorillaz` into `gorillaz`. Any credit
  containing a comma, `&`, `feat`, `ft`, `with` or `x` never borrows it.
* The same guard stops a collaboration merging into a solo act — `Cohen & אברי
  ג'י` must not absorb `Cohen`.

Genuine duplicates *are* merged: `הדג נחש` and `Hadag Nahash` are one artist,
matched on a known English name (never a transliteration guess), keeping the
native-script name for display.


Page state lives in `location.hash` — view, search text, sort, filters, and the
open album or artist — so refresh and the back button both hold position. Hash
rather than the History API because pushState paths don't resolve from `file://`.
Albums and artists are addressed by name, not index, so links survive a rebuild
that reorders them.

## Notes on the artwork

- Covers and photos are hotlinked from Deezer's and Apple's CDNs, so artwork needs an
  internet connection. Titles, search, and sorting all work offline.
- Roughly half the CSV rows have no album at all — those songs show their artist's
  photo in the song list and don't appear in the Albums tab.
