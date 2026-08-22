# Music library

Two independent halves:

- **`worker/`** — the production site: a Cloudflare Worker (TypeScript) that
  serves each signed-in user their library from D1. This is what deploys on
  every push to main (`.github/workflows/deploy.yml`). It never runs anything
  from `pipeline/`.
- **`pipeline/`** — the offline build pipeline: Python scripts that turn a
  liked-songs CSV export into artwork caches, a self-contained `library.html`,
  and the SQL that loads D1 (`to_d1.py`). Runs on your machine, standard
  library only. See `pipeline/README.md`.

The page shell is `worker/public/index.html` — the single source of truth.
`build.py` injects data into a copy of it for the offline page; the Worker
injects a signed-in user's library at request time. The file on disk must keep
its `/*__DATA__*/null` placeholder intact (deploy CI enforces this).

Generated and personal data files (`liked_music_deduped.csv`,
`art_cache.json`, `library.html`) land in this folder and are gitignored.
