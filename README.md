# Music library

Your liked songs, as a library you own — browsable by song, album and artist,
with artwork, official tracklists and one-click playback.

The list itself came out of YouTube Music as a CSV export. Everything here
exists so that it stays *yours*: the catalogue is rebuilt offline by scripts you
can read, the site serves it back to you behind your own Google sign-in, and you
can take the whole thing out again as CSV whenever you like.

## Two independent halves

- **`worker/`** — the production site: a Cloudflare Worker (TypeScript) that
  serves each signed-in user their library from D1. This is what deploys on
  every push to `main` (`.github/workflows/deploy.yml`). It never runs anything
  from `pipeline/`.
- **`pipeline/`** — the offline build pipeline: Python scripts that turn a
  liked-songs CSV export into artwork caches, a self-contained `library.html`,
  and the SQL that loads D1 (`to_d1.py`). Runs on your machine, standard library
  only. See [`pipeline/README.md`](pipeline/README.md).

`worker/public/index.html` is the page, and the single source of truth for it.
`build.py` injects data into a copy of it for the offline page; the Worker
injects a signed-in user's library at request time. **The file on disk must keep
its `/*__DATA__*/null` placeholder intact** — deploy CI fails if a library is
ever baked into the shell.

```
worker/         the deployed site
  index.ts        auth, sessions, and the D1 -> page query
  public/         index.html (the app) + login.html
  wrangler.toml   bindings: D1, R2, Google client id
pipeline/       offline Python build (see its own README)
migrations/     the D1 schema, forward-only
scripts/        dev helpers
```

## Running it

```bash
npm install
npm run lint          # ESLint over the Worker
npm run typecheck     # tsc, Worker only
npm test              # unit tests, no network required
npm run dev           # wrangler dev, against the live D1
```

Deploys happen in CI, which pins its own wrangler version; there is no deploy
script here on purpose.

To exercise the signed-in path locally without going through Google, mint a
session cookie with the same HMAC the Worker uses:

```bash
node scripts/mint-session.mjs "$SESSION_SECRET" you@example.com
```

## How sign-in works

Nothing about a library is reachable without a verified Google identity.

1. `/api/config` hands the page the Google client id; the browser does the
   Google sign-in and posts the resulting ID token to `/api/session`.
2. The Worker verifies that token properly — signature against Google's JWKS,
   issuer, audience and expiry — then looks the email up in `users`. **No row,
   no session**: signing in with Google does not create an account, so finding
   the URL gets you nothing.
3. What it sets is its own HMAC-signed cookie (`HttpOnly`, `Secure`,
   `SameSite=Lax`, 30 days), because Google's ID token expires hourly.

Two things keep that from being decorative:

- `run_worker_first = true` in `worker/wrangler.toml`. Cloudflare serves static
  assets *before* the Worker by default, which would hand `index.html` — and
  with it the whole library — to anyone. CI asserts this flag is still set.
- The deploy workflow smoke-tests production after every push: a signed-out
  `GET /` must answer 401 and must not contain library data.

## Data model

One D1 database, split between per-user rows and a shared metadata cache:

| Table | What it holds |
| --- | --- |
| `users` | one row per person who may sign in |
| `items` | a user's liked songs, linked to shared metadata by `music_key` |
| `item_artists` | song → artists, many-to-many (a credit names several acts) |
| `media_assets` | shared albums and artists: names, slugs, artwork, release type |
| `release_tracks` | official running order, so unliked tracks render greyed |
| `album_artists` | album → artists |
| `resolutions`, `name_translations` | pipeline caches: lookups and romanisations |

The metadata is shared deliberately: one person's cover fetch benefits everyone,
and per-user rows reference it rather than duplicating it. `music_key` is the
best identifier available for a thing — `isrc:`, `upc:`, `mbid:`, or a
normalised `name:` fallback for YouTube-only uploads that were never released.

Migrations are forward-only and live in `migrations/`. Artwork is mirrored into
R2 (`music-art`), content-addressed and served with a one-year cache header.

## Exporting your library

Every view has an **Export CSV** button in the header. It downloads exactly what
you are looking at — the current tab, the current search, in the order shown —
so the songs list, one artist's discography and "everything" are all a click
apart.

| Tab | Columns |
| --- | --- |
| Songs | `title, artists, album, album_artist, duration, seconds, youtube_video_id` |
| Albums | `album, artist, liked_tracks, total_tracks, release_type` |
| Artists | `artist, latin_name, liked_tracks, albums` |

Files are named for what is in them — `songs.csv`, `albums-bonobo.csv` — and are
UTF-8 with a BOM and CRLF line endings, so Hebrew titles survive a double-click
into Excel. Values starting with `=`, `+`, `-` or `@` are prefixed with an
apostrophe so a spreadsheet cannot execute a song title as a formula.

The export is built in the browser from the library the page already holds, so
it costs no extra request, needs no new permission, and works identically in the
offline `library.html` that `pipeline/build.py` generates.
