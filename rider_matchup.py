#!/usr/bin/env python3
"""Cross-reference a race's startlist against riders' history on twin stages.

Ties together the two things this session added: find_similar_stages
(knn_prototype.py) gives the k historical stages most similar to a target
profile; this script then looks at who actually finished well on those
stages, and filters that down to only riders present on a given race's
startlist (race_startlists, from sync_startlists.py) - "who on today's
startlist has a track record on this kind of terrain".

Usage:
    python rider_matchup.py --stage-url race/tour-de-france/2024/stage-4 \
        --startlist tour-de-france:2025
"""

from __future__ import annotations

import argparse

import pandas as pd
from dotenv import load_dotenv

from knn_prototype import find_similar_stages, load_stage_vectors
from scraping import db


def get_startlist(conn, slug: str, season: int) -> pd.DataFrame:
    return pd.read_sql(
        """
        SELECT rider_name, rider_url, team_name
        FROM race_startlists
        WHERE race_slug = %(slug)s AND season = %(season)s
        """,
        conn,
        params={"slug": slug, "season": season},
    )


def get_top_finishes(conn, stage_ids: list[int], top_n: int = 10) -> pd.DataFrame:
    return pd.read_sql(
        """
        SELECT sr.rider_url, sr.rider_name, sr.rank, sr.stage_profile_id
        FROM stage_results sr
        WHERE sr.stage_profile_id = ANY(%(ids)s) AND sr.rank <= %(top_n)s
        """,
        conn,
        params={"ids": stage_ids, "top_n": top_n},
    )


def main() -> None:
    load_dotenv()

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--stage-url", required=True, help="Target stage's pcs_url")
    parser.add_argument("--startlist", required=True, help="slug:season of the race whose startlist to check, e.g. tour-de-france:2025")
    parser.add_argument("--k", type=int, default=10, help="Number of twin stages to look at (default: 10)")
    parser.add_argument("--top-n", type=int, default=10, help="Count finishes ranked this high or better (default: 10)")
    args = parser.parse_args()

    slug, season = args.startlist.split(":")
    season = int(season)

    df = load_stage_vectors()
    neighbors = find_similar_stages(df, args.stage_url, k=args.k)
    print(f"Twin stages considered: {len(neighbors)}")

    with db.get_connection() as conn:
        startlist = get_startlist(conn, slug, season)
        if startlist.empty:
            print(f"No startlist synced for {slug}:{season} - run sync_startlists.py first.")
            return

        finishes = get_top_finishes(conn, neighbors["id"].tolist(), args.top_n)

    if finishes.empty:
        print("No top finishes found among the twin stages.")
        return

    on_startlist = finishes.merge(startlist, on="rider_url", suffixes=("", "_startlist"))

    summary = (
        on_startlist.groupby(["rider_url", "rider_name"])
        .agg(appearances=("stage_profile_id", "count"), best_rank=("rank", "min"), avg_rank=("rank", "mean"))
        .reset_index()
        .merge(startlist[["rider_url", "team_name"]], on="rider_url")
        .sort_values(["appearances", "avg_rank"], ascending=[False, True])
    )

    print(f"\nRiders on {slug} {season}'s startlist with a top-{args.top_n} finish on a twin stage:")
    for _, row in summary.head(15).iterrows():
        print(
            f"  {row['rider_name']:28s} {row['team_name']:35s} "
            f"appearances={row['appearances']} best={row['best_rank']} avg={row['avg_rank']:.1f}"
        )


if __name__ == "__main__":
    main()
