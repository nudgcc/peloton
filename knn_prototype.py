#!/usr/bin/env python3
"""Proof of concept: find historical "twin stages" for a given stage.

Given a stage's profile (distance, elevation, climb difficulty), finds the
k most similar stages from the synced history using scikit-learn's
NearestNeighbors. This is the foundational similarity search the rest of
the prediction pipeline (scenario probabilities, favorite riders) will be
built on top of later — this script only answers "are the neighbors it
finds actually plausible?".

Usage:
    python knn_prototype.py --stage-url race/tour-de-france/2024/stage-15
    python knn_prototype.py --stage-url race/tour-de-france/2024/stage-15 --k 5
"""

from __future__ import annotations

import argparse

import pandas as pd
from dotenv import load_dotenv
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler

from scraping import db

FEATURE_COLUMNS = [
    "distance_km",
    "vertical_meters",
    "climb_ratio",       # vertical_meters per km - how "mountainous" the stage is
    "profile_score",
    "nb_climbs",
    "nb_hard_climbs",    # category 1 or HC climbs
]


def load_stage_vectors() -> pd.DataFrame:
    """Pull every synced stage into a feature DataFrame.

    nb_hard_climbs comes from a join against stage_climbs rather than a
    stored column, since it's a derived count, not raw scraped data.
    """
    query = """
        SELECT
            sp.id,
            sp.pcs_url,
            sp.race_name,
            sp.season,
            sp.stage_number,
            sp.distance_km,
            sp.vertical_meters,
            sp.profile_score,
            sp.profile_icon,
            sp.nb_climbs,
            sp.victory_type,
            COUNT(sc.id) FILTER (WHERE sc.category IN ('1', 'HC')) AS nb_hard_climbs
        FROM stage_profiles sp
        LEFT JOIN stage_climbs sc ON sc.stage_profile_id = sp.id
        WHERE sp.distance_km IS NOT NULL
          AND sp.vertical_meters IS NOT NULL
          AND sp.profile_score IS NOT NULL
        GROUP BY sp.id
    """
    with db.get_connection() as conn:
        df = pd.read_sql(query, conn)

    df["climb_ratio"] = df["vertical_meters"] / df["distance_km"].replace(0, pd.NA)
    df = df.dropna(subset=FEATURE_COLUMNS)
    return df.reset_index(drop=True)


def find_similar_stages(df: pd.DataFrame, target_pcs_url: str, k: int = 8) -> pd.DataFrame:
    """Return the k nearest neighbor stages to `target_pcs_url` (excluding itself)."""
    if target_pcs_url not in df["pcs_url"].values:
        raise ValueError(f"{target_pcs_url} not found among synced stages")

    scaler = StandardScaler()
    vectors = scaler.fit_transform(df[FEATURE_COLUMNS])

    target_idx = df.index[df["pcs_url"] == target_pcs_url][0]

    # k+1 because the target stage itself is always its own nearest neighbor.
    nn = NearestNeighbors(n_neighbors=min(k + 1, len(df)), metric="euclidean")
    nn.fit(vectors)
    distances, indices = nn.kneighbors(vectors[target_idx].reshape(1, -1))

    result = df.iloc[indices[0]].copy()
    result["distance"] = distances[0]
    result = result[result["pcs_url"] != target_pcs_url]
    return result.head(k)


def main() -> None:
    load_dotenv()

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--stage-url", required=True, help="pcs_url of the target stage, e.g. race/tour-de-france/2024/stage-15")
    parser.add_argument("--k", type=int, default=8, help="Number of neighbor stages to return (default: 8)")
    args = parser.parse_args()

    df = load_stage_vectors()
    print(f"Loaded {len(df)} stages with complete profile data.\n")

    target = df[df["pcs_url"] == args.stage_url].iloc[0]
    print(f"Target: {target['race_name']} {target['season']} stage {target['stage_number']} ({target['pcs_url']})")
    print(
        f"  distance={target['distance_km']}km  vertical={target['vertical_meters']}m  "
        f"climb_ratio={target['climb_ratio']:.1f}m/km  profile_score={target['profile_score']}  "
        f"nb_climbs={target['nb_climbs']} (hard={target['nb_hard_climbs']})\n"
    )

    neighbors = find_similar_stages(df, args.stage_url, k=args.k)
    print(f"Top {len(neighbors)} twin stages:")
    for _, row in neighbors.iterrows():
        print(
            f"  [{row['distance']:.2f}] {row['race_name']} {row['season']} stage {row['stage_number']} "
            f"- distance={row['distance_km']}km vertical={row['vertical_meters']}m "
            f"profile_score={row['profile_score']} hard_climbs={row['nb_hard_climbs']} "
            f"victory_type={row['victory_type']} "
            f"({row['pcs_url']})"
        )

    classified = neighbors.dropna(subset=["victory_type"])
    if len(classified):
        print(f"\nScenario base rates among {len(classified)}/{len(neighbors)} classified twins:")
        rates = classified["victory_type"].value_counts(normalize=True).sort_values(ascending=False)
        for victory_type, rate in rates.items():
            print(f"  {victory_type:22s} {rate:.0%}")
    else:
        print("\nNo classified twins (missing results data) - can't compute scenario base rates.")


if __name__ == "__main__":
    main()
