# Open Library

Your books, films and records — in a library you own.

Streaming and catalogue services can remove a title, change a licence, or shut
down, and the list you spent ten years building goes with them. Open Library
keeps that list somewhere you control: your data is written continuously to
storage **you** choose (a Drive folder, Nextcloud, a synced directory) as plain
CSV, backed up here as a second copy, and exportable in full at any moment
without asking anyone's permission.

The rest — ratings, tags, notes, friends' libraries — is the part you actually
enjoy. The point is that none of it is hostage to this app continuing to exist.

## What it does

- **One library for every kind of media** — books, films, TV, music, podcasts
  and games, with status (liked, want to, in progress, finished, dropped),
  0–10 ratings, tags and notes.
- **Sync to storage you own.** Add one or more destinations; every run writes
  the same export bundle: a CSV per media type, a combined `library.csv`, a
  full-fidelity `library.json` and a checksummed manifest.
- **Backups kept here too**, taken daily and on demand, deduplicated by content
  hash, each one downloadable and restorable.
- **Import from wherever you're leaving.** Goodreads and Letterboxd exports work
  as they come; so does any CSV with recognisable columns, and any export this
  app produced.
- **Friends.** Send a request by handle and browse what they've shared. Two
  gates apply: your library-wide setting, then each item's own visibility.
- **Nothing disappears quietly.** Deletes are soft, every change is recorded in
  an append-only log, and removed items stay in your exports flagged with a
  `deleted_at` rather than vanishing from them.
- **Catalogue search without an API key** — Open Library for books, MusicBrainz
  and iTunes for music, iTunes for film and TV. Only metadata is copied in, and
  anything can be added by hand.

## Running it

Requires Node 22.5 or newer (it uses the built-in `node:sqlite`, so there is no
native module to compile).

```bash
npm install
npm run build
npm start                 # http://localhost:8787
```

For development, with the API and the client on separate ports:

```bash
npm run dev:server        # API on :8787
npm run dev:web           # client on :5173, proxying /api
```

Tests:

```bash
npm test                  # 41 tests, no network required
```

### Configuration

Everything has a default; nothing is required.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `8787` | HTTP port |
| `OPENLIB_DATA_DIR` | `./data` | Database, snapshots and the generated key |
| `OPENLIB_SYNC_ROOT` | `<data>/sync` | Root that `local` sync targets write inside |
| `OPENLIB_SECRET_KEY` | generated | 32-byte hex key (or a passphrase) encrypting sync credentials |
| `OPENLIB_SNAPSHOT_INTERVAL_HOURS` | `24` | How often backups are taken |
| `OPENLIB_SYNC_INTERVAL_HOURS` | `6` | How often destinations are pushed to |
| `OPENLIB_OFFLINE` | unset | Set to `1` to disable outbound catalogue lookups |

With Docker:

```bash
docker build -t openlibrary .
docker run -p 8787:8787 \
  -v "$PWD/data:/data" \
  -v "$HOME/Google Drive/Open Library:/sync" \
  -e OPENLIB_SECRET_KEY="$(openssl rand -hex 32)" \
  openlibrary
```

Mounting your Drive or Dropbox folder at `/sync` is the whole trick: create a
`local` sync destination and the CSVs are written straight into storage that
already replicates itself, with no OAuth in the loop.

## Sync destinations

| Type | Setup | Notes |
| --- | --- | --- |
| **Folder on this server** | A folder name, relative to the sync root | Paths are confined to the sync root; writes are atomic (temp file + rename) |
| **Google Drive** | OAuth client id, client secret, refresh token | Creates/reuses a folder and updates the same files each run |
| **WebDAV** | URL, username, password | Nextcloud, ownCloud, Synology, Box |

Credentials are encrypted with AES-256-GCM before being stored and are never
returned by the API — not even to the account that entered them.

<details>
<summary>Getting a Google Drive refresh token</summary>

1. In [Google Cloud Console](https://console.cloud.google.com/), create a
   project and enable the **Google Drive API**.
2. Create an **OAuth client ID** of type *Desktop app*. Note the client id and
   secret.
3. Authorise the scope `https://www.googleapis.com/auth/drive.file` (this grants
   access only to files this app creates — not your whole Drive) and exchange
   the resulting code for a refresh token.
4. Paste all three values into the destination form.

Revoking the app in your Google account stops the sync immediately; nothing
already written is affected.

</details>

## The export format

This is a contract, not an implementation detail. Anything that reads an
Open Library export can rely on it.

`library.csv` and each `<type>.csv` share these columns, in this order:

```
id, media_type, title, creators, year, status, rating, tags, notes,
identifiers, cover_url, source, visibility, created_at, updated_at, deleted_at
```

- `media_type` — `book`, `movie`, `tv`, `music`, `podcast`, `game`
- `status` — `liked`, `want`, `in_progress`, `done`, `dropped`
- `rating` — 0–10 (a Goodreads 5-star rating is doubled on import)
- `tags` — `; `-separated
- `identifiers` — JSON object of external ids (`isbn`, `openlibrary`, `imdb`,
  `musicbrainz`, `isrc`, `goodreads`, …)
- `deleted_at` — set for removed items, which are kept rather than dropped

Values starting with `=`, `+`, `-` or `@` are prefixed with an apostrophe so
spreadsheet apps don't evaluate them as formulas; the importer strips it back.

`library.json` carries the same data with full fidelity plus your profile.
`MANIFEST.json` lists every file with its size and SHA-256.

## How it's put together

```
server/
  src/
    db/          schema + forward-only migrations
    domain/      users, items, friends, snapshots, sync targets, event log
    export/      CSV reader/writer, export bundler, importers
    sync/        engine + one adapter per destination type
    catalog/     Open Library, MusicBrainz, iTunes
    routes/      HTTP surface
  test/          41 tests, driven through the real HTTP stack
web/
  src/           React + Vite client
```

Deliberate choices worth knowing about:

- **SQLite via `node:sqlite`.** No native modules, no database server; the whole
  library is one file you can copy.
- **Soft deletes and an append-only event log.** A bug in this codebase should
  not be able to lose your data, and if something does go missing you can see
  when and how.
- **Snapshots are content-addressed.** Taking one when nothing changed is a
  no-op, so a daily job doesn't produce a heap of identical copies.
- **Restores only add.** Restoring a backup re-creates what's missing and
  updates what it finds, but never removes items added since — and takes a
  safety snapshot first, so a restore is itself undoable.
- **Sync failures are recorded, not thrown away.** One broken destination never
  blocks the others, and the error is visible in the UI.
- **Imports match on identifiers first, then title + year**, so re-importing the
  same file doesn't duplicate anything.

## Notes and limits

- Sessions are cookie-based (`HttpOnly`, `SameSite=Lax`). Run it behind HTTPS in
  production; `NODE_ENV=production` adds the `Secure` flag.
- Catalogue search needs outbound network access. Where it's blocked, search
  degrades to a visible warning and manual entry still works.
- There's no password reset flow yet, and no S3 sync adapter — `sync/targets/`
  is the place to add one.
