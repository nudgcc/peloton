import { pool } from "./db";

export type Stage = {
  pcs_url: string;
  race_name: string | null;
  season: number | null;
  stage_number: string | null;
  distance_km: number | null;
  vertical_meters: number | null;
  profile_score: number | null;
  profile_icon: string | null;
  victory_type: string | null;
  winner_group_size: number | null;
};

export async function getStages(limit = 30): Promise<Stage[]> {
  const { rows } = await pool.query<Stage>(
    `SELECT pcs_url, race_name, season, stage_number, distance_km,
            vertical_meters, profile_score, profile_icon,
            victory_type, winner_group_size
     FROM stage_profiles
     WHERE distance_km IS NOT NULL
     ORDER BY season DESC, race_name ASC, id ASC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function getStats() {
  const { rows } = await pool.query<{
    stage_count: string;
    race_count: string;
    season_min: number;
    season_max: number;
  }>(
    `SELECT
       count(*) AS stage_count,
       count(DISTINCT race_name) AS race_count,
       min(season) AS season_min,
       max(season) AS season_max
     FROM stage_profiles`
  );
  return rows[0];
}
