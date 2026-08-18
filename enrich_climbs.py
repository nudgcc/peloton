#!/usr/bin/env python3
"""Backfill stage_climbs.length_km/steepness_pct/top_elevation_m/km_before_finish.

Stage.climbs() (used by the main sync) only has name/url/category - the
physical stats live on a separate per-race page (RaceClimbs, at
"race/{slug}/{season}/route/climbs"). A climb's length/steepness/elevation
is a property of the climb itself, not of which race featured it, so
matching is done globally by climb_url rather than scoped to one race.

Usage:
    python enrich_climbs.py
    python enrich_climbs.py --dry-run
"""

from __future__ import annotations

import argparse
import logging
import random
import time

from dotenv import load_dotenv
import psycopg2.extras

from scraping import db
from scraping.pcs_fetcher import PCSFetcher
from scraping.pcs_parser import get_race_climbs
from scraping.races_config import RACES_TO_SYNC, race_url

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("enrich_climbs")

THROTTLE_MIN_SECONDS = 2
THROTTLE_MAX_SECONDS = 5


def collect_climb_details(fetcher: PCSFetcher, dry_run: bool) -> dict[str, dict]:
    """Fetch every configured race's climbs page, merged into one
    climb_url -> {length_km, steepness_pct, top_elevation_m, km_before_finish} map.

    A fresh short-lived DB connection is opened per page (rather than one
    held open for the whole ~10+ minute loop) - Neon closes idle
    connections, and this loop's fetch+throttle gaps are long enough to
    trip that.
    """
    details: dict[str, dict] = {}
    for race in RACES_TO_SYNC:
        url = race_url(race["slug"], race["season"]) + "/route/climbs"
        try:
            html = fetcher.fetch(url)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Fetch failed for %s: %s", url, exc)
            if not dry_run:
                with db.get_connection() as conn:
                    db.log_failure(conn, url, f"fetch error: {exc}", source="enrich_climbs")
            time.sleep(random.uniform(THROTTLE_MIN_SECONDS, THROTTLE_MAX_SECONDS))
            continue

        if not dry_run:
            with db.get_connection() as conn:
                db.save_raw_page(conn, url, html)

        try:
            climbs = get_race_climbs(url, html)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Parse failed for %s: %s", url, exc)
            climbs = []

        for climb in climbs:
            climb_url = climb.get("climb_url")
            if climb_url:
                details[climb_url] = climb

        logger.info("%s -> %d climbs (total known: %d)", url, len(climbs), len(details))
        time.sleep(random.uniform(THROTTLE_MIN_SECONDS, THROTTLE_MAX_SECONDS))

    return details


def apply_updates(conn, details: dict[str, dict]) -> int:
    """Returns the count of distinct climb_urls matched, not affected rows.

    execute_values batches large VALUES lists into multiple UPDATE
    statements (default page_size=100); cur.rowcount only reflects the
    last batch, so it isn't a reliable total here. Query stage_climbs
    directly if you need the true affected-row count.
    """
    if not details:
        return 0

    with conn.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            """
            UPDATE stage_climbs AS sc SET
                length_km = data.length_km,
                steepness_pct = data.steepness_pct,
                top_elevation_m = data.top_elevation_m,
                km_before_finish = data.km_before_finish
            FROM (VALUES %s) AS data (climb_url, length_km, steepness_pct, top_elevation_m, km_before_finish)
            WHERE sc.climb_url = data.climb_url
            """,
            [
                (
                    climb_url,
                    d.get("length_km"),
                    d.get("steepness_pct"),
                    d.get("top_elevation_m"),
                    d.get("km_before_finish"),
                )
                for climb_url, d in details.items()
            ],
            page_size=len(details) or 1,
        )
    conn.commit()
    return len(details)


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="Fetch and parse but do not write to Postgres")
    args = parser.parse_args()

    with PCSFetcher() as fetcher:
        details = collect_climb_details(fetcher, args.dry_run)

    logger.info("Collected physical stats for %d distinct climbs.", len(details))

    if args.dry_run:
        sample = list(details.items())[:5]
        for climb_url, d in sample:
            logger.info("[dry-run] %s -> %s", climb_url, d)
        return

    with db.get_connection() as conn:
        updated = apply_updates(conn, details)
    logger.info("Updated %d stage_climbs rows.", updated)


if __name__ == "__main__":
    main()
