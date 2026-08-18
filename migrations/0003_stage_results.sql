-- Per-rider stage results, parsed from the same HTML already fetched for
-- stage_profiles (Stage.results() reads from the same page as
-- Stage.climbs()/profile_score()) - no extra scraping needed.

CREATE TABLE IF NOT EXISTS stage_results (
    id                      SERIAL PRIMARY KEY,
    stage_profile_id        INT NOT NULL REFERENCES stage_profiles (id) ON DELETE CASCADE,
    rank                    INT,
    rider_name              TEXT,
    rider_url               TEXT,
    team_name               TEXT,
    status                  TEXT,
    finish_time_seconds     INT,
    gap_seconds             INT,
    UNIQUE (stage_profile_id, rank)
);

CREATE INDEX IF NOT EXISTS idx_stage_results_stage_profile ON stage_results (stage_profile_id);
CREATE INDEX IF NOT EXISTS idx_stage_results_rider_url ON stage_results (rider_url);

-- Coarse scenario classification derived from the results' gap pattern
-- (see scraping/pcs_parser.py:classify_victory) - approximate, not a
-- source of truth, kept as a queryable convenience column.
ALTER TABLE stage_profiles ADD COLUMN IF NOT EXISTS victory_type TEXT;
ALTER TABLE stage_profiles ADD COLUMN IF NOT EXISTS winner_group_size INT;
