-- Stage profile data scraped from procyclingstats.com

CREATE TABLE IF NOT EXISTS stage_profiles (
    id                  SERIAL PRIMARY KEY,
    pcs_url             TEXT NOT NULL UNIQUE,
    race_name           TEXT,
    season              INT,
    stage_number        TEXT,
    stage_type          TEXT,
    distance_km         NUMERIC(6, 2),
    vertical_meters     INT,
    profile_score       INT,
    profile_icon        TEXT,
    nb_climbs           INT,
    raw_json            JSONB,
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stage_profiles_season ON stage_profiles (season);

CREATE TABLE IF NOT EXISTS stage_climbs (
    id                  SERIAL PRIMARY KEY,
    stage_profile_id    INT NOT NULL REFERENCES stage_profiles (id) ON DELETE CASCADE,
    climb_order         INT NOT NULL,
    climb_name          TEXT,
    climb_url           TEXT,
    category            TEXT,
    length_km           NUMERIC(5, 2),
    steepness_pct       NUMERIC(4, 2),
    top_elevation_m     INT,
    km_before_finish    NUMERIC(5, 2),
    UNIQUE (stage_profile_id, climb_order)
);

CREATE TABLE IF NOT EXISTS sync_failures (
    id              SERIAL PRIMARY KEY,
    source          TEXT NOT NULL DEFAULT 'pcs',
    url             TEXT NOT NULL,
    reason          TEXT NOT NULL,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_failures_url ON sync_failures (url);

-- Keep updated_at fresh on upsert
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stage_profiles_updated_at ON stage_profiles;
CREATE TRIGGER trg_stage_profiles_updated_at
    BEFORE UPDATE ON stage_profiles
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
