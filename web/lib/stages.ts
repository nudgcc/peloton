import { pool } from "./db";

export type Stage = {
  id: number;
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

export type StageFilters = {
  season?: number;
  raceName?: string;
  victoryType?: string;
};

const STAGE_COLUMNS = `id, pcs_url, race_name, season, stage_number,
  distance_km::float8 AS distance_km, vertical_meters, profile_score,
  profile_icon, victory_type, winner_group_size`;

function buildWhere(filters: StageFilters) {
  const clauses = ["distance_km IS NOT NULL"];
  const params: (string | number)[] = [];

  if (filters.season) {
    params.push(filters.season);
    clauses.push(`season = $${params.length}`);
  }
  if (filters.raceName) {
    params.push(filters.raceName);
    clauses.push(`race_name = $${params.length}`);
  }
  if (filters.victoryType) {
    params.push(filters.victoryType);
    clauses.push(`victory_type = $${params.length}`);
  }

  return { where: clauses.join(" AND "), params };
}

export async function getStages(
  filters: StageFilters = {},
  page = 1,
  pageSize = 25
): Promise<{ stages: Stage[]; total: number }> {
  const { where, params } = buildWhere(filters);
  const offset = (page - 1) * pageSize;

  const [{ rows: stages }, { rows: countRows }] = await Promise.all([
    pool.query<Stage>(
      `SELECT ${STAGE_COLUMNS}
       FROM stage_profiles
       WHERE ${where}
       ORDER BY season DESC, race_name ASC, id ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    ),
    pool.query<{ count: string }>(
      `SELECT count(*) FROM stage_profiles WHERE ${where}`,
      params
    ),
  ]);

  return { stages, total: Number(countRows[0].count) };
}

export async function getStageById(id: number): Promise<Stage | null> {
  const { rows } = await pool.query<Stage>(
    `SELECT ${STAGE_COLUMNS} FROM stage_profiles WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export type Climb = {
  climb_order: number;
  climb_name: string | null;
  category: string | null;
  length_km: number | null;
  top_elevation_m: number | null;
  km_before_finish: number | null;
};

export async function getStageClimbs(stageId: number): Promise<Climb[]> {
  const { rows } = await pool.query<Climb>(
    `SELECT climb_order, climb_name, category,
            length_km::float8 AS length_km,
            top_elevation_m,
            km_before_finish::float8 AS km_before_finish
     FROM stage_climbs
     WHERE stage_profile_id = $1
     ORDER BY climb_order ASC`,
    [stageId]
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

export async function getFilterOptions() {
  const [seasons, races, victoryTypes] = await Promise.all([
    pool.query<{ season: number }>(
      `SELECT DISTINCT season FROM stage_profiles WHERE season IS NOT NULL ORDER BY season DESC`
    ),
    pool.query<{ race_name: string }>(
      `SELECT DISTINCT race_name FROM stage_profiles WHERE race_name IS NOT NULL ORDER BY race_name ASC`
    ),
    pool.query<{ victory_type: string }>(
      `SELECT DISTINCT victory_type FROM stage_profiles WHERE victory_type IS NOT NULL ORDER BY victory_type ASC`
    ),
  ]);

  return {
    seasons: seasons.rows.map((r) => r.season),
    races: races.rows.map((r) => r.race_name),
    victoryTypes: victoryTypes.rows.map((r) => r.victory_type),
  };
}
