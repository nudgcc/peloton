# peloton.cc — procyclingstats data pipeline

Fetches race/stage profile data (distance, elevation, profile score,
climbs) from [procyclingstats.com](https://www.procyclingstats.com) for the
k-NN performance model, and stores it in Postgres.

## Architecture

- [`scraping/pcs_fetcher.py`](scraping/pcs_fetcher.py) — drives headless
  Chromium (Playwright) to load a procyclingstats.com page and return its
  rendered HTML. procyclingstats.com sits behind Cloudflare, so this is the
  only piece allowed to talk to the network.
- [`scraping/pcs_parser.py`](scraping/pcs_parser.py) — feeds that HTML into
  the [`procyclingstats`](https://pypi.org/project/procyclingstats/) package
  (`html=..., update_html=False`, so it never makes its own request) and
  returns plain dicts.
- [`scraping/db.py`](scraping/db.py) — upserts parsed data into Postgres.
- [`sync_pcs_data.py`](sync_pcs_data.py) — orchestrates: discover stages →
  fetch → parse → upsert, sequentially, with a 2-5s randomized delay
  between requests. Fetch/parse/DB failures are logged to the
  `sync_failures` table (or printed in `--dry-run`) instead of aborting the
  whole batch.

The fetcher and parser are decoupled on purpose: either can be swapped
(e.g. a different anti-bot approach, or a different scraping library)
without touching the other.

## Setup

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium

cp .env.example .env   # adjust DATABASE_URL if needed
docker compose up -d   # starts Postgres and applies migrations/*.sql
```

`docker compose up` runs everything in `migrations/` on first boot via
Postgres's `docker-entrypoint-initdb.d`. If you're pointing at an existing
database instead, apply the migration manually:

```bash
psql "$DATABASE_URL" -f migrations/0001_pcs_stage_profiles.sql
```

## Which races get synced

Edit [`scraping/races_config.py`](scraping/races_config.py) — each entry is
a `{slug, season}` pair (e.g. `tour-de-france`, `2025`); all of that race's
stages are discovered automatically via `Race.stages()`.

## Manual test run

Dry-run a single real stage (no DB writes, just fetch + parse + print):

```bash
python sync_pcs_data.py --dry-run --stage-url race/tour-de-france/2025/stage-1
```

Expected output looks like:

```
INFO [dry-run] Parsed race/tour-de-france/2025/stage-1: {'pcs_url': 'race/tour-de-france/2025/stage-1', 'distance': 184.9, 'vertical_meters': 2200, 'profile_score': 87, 'profile_icon': 'p3', ...}
INFO [dry-run] 4 climbs
```

To actually write it to Postgres, drop `--dry-run`. To sync a full race:

```bash
python sync_pcs_data.py --races tour-de-france:2025
```

With no arguments, it syncs everything listed in `races_config.py`:

```bash
python sync_pcs_data.py
```

## GitHub Actions

[`.github/workflows/sync_pcs_data.yml`](.github/workflows/sync_pcs_data.yml)
runs the sync daily. Set the `DATABASE_URL` repository secret. Trigger it
manually from the Actions tab with the `dry_run` input checked to test
without writing to the database.

## Schema

- `stage_profiles` — one row per stage, unique on `pcs_url`. `raw_json`
  keeps the full parsed payload for fields not worth their own column.
- `stage_climbs` — normalized climbs per stage (name, url, category), FK'd
  to `stage_profiles` with cascade delete; replaced wholesale on every
  re-sync of a stage. `length_km`/`steepness_pct`/`top_elevation_m`/
  `km_before_finish` are reserved but currently always NULL: PCS's
  `Stage.climbs()` doesn't carry that data, only `RaceClimbs()` does (a
  separate, race-level, name-keyed table — see `get_race_climbs()` in
  `pcs_parser.py`). Joining the two by climb name is a possible follow-up.
- `sync_failures` — append-only log of fetch/parse/DB errors (`url`,
  `reason`, `occurred_at`) so failed stages can be identified and replayed.
