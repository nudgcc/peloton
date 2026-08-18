-- Who's registered to start a given race/season - distinct from
-- stage_results (who actually finished a given past stage). Lets a
-- prediction cross-reference "who's racing this edition" against "how have
-- these riders performed historically on similar-profile stages"
-- (see stage_results/stage_profiles, joined by rider_url).

CREATE TABLE IF NOT EXISTS race_startlists (
    id              SERIAL PRIMARY KEY,
    race_slug       TEXT NOT NULL,
    season          INT NOT NULL,
    race_name       TEXT,
    rider_name      TEXT,
    rider_url       TEXT,
    team_name       TEXT,
    team_url        TEXT,
    nationality     TEXT,
    rider_number    INT,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (race_slug, season, rider_url)
);

CREATE INDEX IF NOT EXISTS idx_race_startlists_rider_url ON race_startlists (rider_url);
CREATE INDEX IF NOT EXISTS idx_race_startlists_race ON race_startlists (race_slug, season);
