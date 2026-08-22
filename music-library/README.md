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

`template.html` is the page shell the pipeline builds from. Generated and
personal data files (`liked_music_deduped.csv`, `art_cache.json`,
`library.html`) also land in this folder and are gitignored.
