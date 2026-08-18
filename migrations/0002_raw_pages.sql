-- Raw HTML snapshots, saved before parsing, so a PCS structure change can
-- be reparsed against history instead of requiring a re-scrape.
-- Only a new row is inserted when the content actually changed (see
-- scraping/db.py:save_raw_page), so this stays a change log, not a
-- full history of every fetch attempt.

CREATE TABLE IF NOT EXISTS raw_pages (
    id              SERIAL PRIMARY KEY,
    url             TEXT NOT NULL,
    html_gzip       BYTEA NOT NULL,
    html_sha256     TEXT NOT NULL,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_raw_pages_url ON raw_pages (url);
CREATE INDEX IF NOT EXISTS idx_raw_pages_url_fetched_at ON raw_pages (url, fetched_at DESC);
