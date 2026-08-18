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
  victory_type: string | null;
};

export type Neighbor = StageVector & { distance: number };

const FEATURES = [
  "distance_km",
  "vertical_meters",
  "climb_ratio",
  "profile_score",
  "nb_climbs",
  "nb_hard_climbs",
] as const;

type FeatureRow = StageVector & { climb_ratio: number };

async function loadStageVectors(): Promise<FeatureRow[]> {
  const { rows } = await pool.query<StageVector>(
    `SELECT
       sp.id, sp.pcs_url, sp.race_name, sp.season, sp.stage_number,
       sp.distance_km::float8 AS distance_km, sp.vertical_meters,
       sp.profile_score, sp.nb_climbs, sp.victory_type,
       COUNT(sc.id) FILTER (WHERE sc.category IN ('1', 'HC'))::int AS nb_hard_climbs
     FROM stage_profiles sp
     LEFT JOIN stage_climbs sc ON sc.stage_profile_id = sp.id
     WHERE sp.distance_km IS NOT NULL
       AND sp.vertical_meters IS NOT NULL
       AND sp.profile_score IS NOT NULL
     GROUP BY sp.id`
  );

  return rows
    .map((r) => ({ ...r, climb_ratio: r.vertical_meters / r.distance_km }))
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

export async function findTwinStages(
  targetId: number,
  k = 8
): Promise<{ target: FeatureRow; neighbors: Neighbor[] } | null> {
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

  return { target: rows[targetIndex], neighbors };
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
