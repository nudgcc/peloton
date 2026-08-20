import { pool } from "./db";

// TypeScript port of knn_prototype.py (repo root) - same feature vector
// and standardization approach, kept in sync manually since this reads
// the same stage_profiles/stage_climbs tables the Python prototype does.

export type StageVector = {
  id: number;
  pcs_url: string;
  race_name: string | null;
  season: number | null;
  stage_number: string | null;
  distance_km: number;
  vertical_meters: number;
  profile_score: number;
  nb_climbs: number;
  nb_hard_climbs: number;
  max_altitude: number;
  avg_steepness_pct: number;
  km_last_climb_to_finish: number;
  victory_type: string | null;
};

export type Neighbor = FeatureRow & { distance: number };

const FEATURES = [
  "distance_km",
  "vertical_meters",
  "climb_ratio",
  "profile_score",
  "nb_climbs",
  "nb_hard_climbs",
  "max_altitude",
  "avg_steepness_pct",
  "km_last_climb_to_finish",
] as const;

type FeatureRow = StageVector & { climb_ratio: number };

async function loadStageVectors(): Promise<FeatureRow[]> {
  const { rows } = await pool.query<
    Omit<StageVector, "max_altitude" | "avg_steepness_pct" | "km_last_climb_to_finish"> & {
      max_altitude: number | null;
      avg_steepness_pct: number | null;
      km_last_climb_to_finish: number | null;
    }
  >(
    `SELECT
       sp.id, sp.pcs_url, sp.race_name, sp.season, sp.stage_number,
       sp.distance_km::float8 AS distance_km, sp.vertical_meters,
       sp.profile_score, sp.nb_climbs, sp.victory_type,
       agg.nb_hard_climbs, agg.max_altitude, agg.avg_steepness_pct::float8 AS avg_steepness_pct,
       last_climb.km_before_finish AS km_last_climb_to_finish
     FROM stage_profiles sp
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*) FILTER (WHERE category IN ('1', 'HC'))::int AS nb_hard_climbs,
         MAX(top_elevation_m) AS max_altitude,
         AVG(steepness_pct) AS avg_steepness_pct
       FROM stage_climbs WHERE stage_profile_id = sp.id
     ) agg ON true
     LEFT JOIN LATERAL (
       SELECT km_before_finish::float8 AS km_before_finish FROM stage_climbs
       WHERE stage_profile_id = sp.id
       ORDER BY climb_order DESC LIMIT 1
     ) last_climb ON true
     WHERE sp.distance_km IS NOT NULL
       AND sp.vertical_meters IS NOT NULL
       AND sp.profile_score IS NOT NULL`
  );

  return rows
    .map((r) => ({
      ...r,
      climb_ratio: r.vertical_meters / r.distance_km,
      max_altitude: r.max_altitude ?? 0,
      avg_steepness_pct: r.avg_steepness_pct ?? 0,
      km_last_climb_to_finish: r.km_last_climb_to_finish ?? r.distance_km,
    }))
    .filter((r) => Number.isFinite(r.climb_ratio));
}

function standardize(rows: FeatureRow[]): number[][] {
  const means = FEATURES.map(
    (f) => rows.reduce((sum, r) => sum + r[f], 0) / rows.length
  );
  const stds = FEATURES.map((f, i) => {
    const variance =
      rows.reduce((sum, r) => sum + (r[f] - means[i]) ** 2, 0) / rows.length;
    return Math.sqrt(variance) || 1; // avoid divide-by-zero for constant features
  });

  return rows.map((r) =>
    FEATURES.map((f, i) => (r[f] - means[i]) / stds[i])
  );
}

function euclideanDistance(a: number[], b: number[]): number {
  return Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0));
}

// Axes chosen for the stage's "readout" radar: broad coverage of the
// feature vector without crowding a 6-spoke chart (profile_score is a
// PCS-derived composite of several of these, and nb_climbs/
// km_last_climb_to_finish read better as plain numbers than radar spokes).
export const RADAR_FEATURES = [
  "distance_km",
  "vertical_meters",
  "climb_ratio",
  "nb_hard_climbs",
  "max_altitude",
  "avg_steepness_pct",
] as const;

export type RadarAxis = {
  feature: (typeof RADAR_FEATURES)[number];
  percentile: number;
  value: number;
};

function percentileOf(values: number[], value: number): number {
  if (values.length <= 1) return 50;
  const countBelow = values.filter((v) => v < value).length;
  return Math.round((countBelow / (values.length - 1)) * 100);
}

export async function findTwinStages(
  targetId: number,
  k = 8
): Promise<{ target: FeatureRow; neighbors: Neighbor[]; radar: RadarAxis[] } | null> {
  const rows = await loadStageVectors();
  const targetIndex = rows.findIndex((r) => r.id === targetId);
  if (targetIndex === -1) return null;

  const vectors = standardize(rows);
  const targetVector = vectors[targetIndex];

  const neighbors = rows
    .map((r, i) => ({
      ...r,
      distance: euclideanDistance(targetVector, vectors[i]),
    }))
    .filter((r) => r.id !== targetId)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, k);

  const target = rows[targetIndex];
  const radar: RadarAxis[] = RADAR_FEATURES.map((feature) => ({
    feature,
    value: target[feature],
    percentile: percentileOf(
      rows.map((r) => r[feature]),
      target[feature]
    ),
  }));

  return { target, neighbors, radar };
}

export function scenarioBaseRates(
  neighbors: Neighbor[]
): { victory_type: string; rate: number; count: number }[] {
  const classified = neighbors.filter((n) => n.victory_type);
  if (classified.length === 0) return [];

  const counts = new Map<string, number>();
  for (const n of classified) {
    counts.set(n.victory_type!, (counts.get(n.victory_type!) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([victory_type, count]) => ({
      victory_type,
      count,
      rate: count / classified.length,
    }))
    .sort((a, b) => b.count - a.count);
}
