#!/usr/bin/env python3
"""Sync race startlists (who's registered, not who finished) into Postgres.

Usage:
    python sync_startlists.py --races tour-de-france:2025,giro-d-italia:2025
    python sync_startlists.py --dry-run --races tour-de-france:2025
    python sync_startlists.py            # syncs every race in races_config.py
"""

from __future__ import annotations

import argparse
import logging
import random
import time

from dotenv import load_dotenv

from scraping import db
from scraping.pcs_fetcher import PCSFetcher
from scraping.pcs_parser import get_race_name, get_race_startlist
from scraping.races_config import RACES_TO_SYNC, race_url

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("sync_startlists")

THROTTLE_MIN_SECONDS = 2
THROTTLE_MAX_SECONDS = 5


def sync_one(fetcher: PCSFetcher, slug: str, season: int, dry_run: bool) -> bool:
    url = race_url(slug, season) + "/startlist"
    try:
        html = fetcher.fetch(url)
    except Exception as exc:  # noqa: BLE001
        logger.error("Fetch failed for %s: %s", url, exc)
        if not dry_run:
            with db.get_connection() as conn:
                db.log_failure(conn, url, f"fetch error: {exc}", source="startlist")
        return False

    try:
        riders = get_race_startlist(url, html)
        race_name = get_race_name(url, html)
    except Exception as exc:  # noqa: BLE001
        logger.error("Parse failed for %s: %s", url, exc)
        if not dry_run:
            with db.get_connection() as conn:
                db.log_failure(conn, url, f"parse error: {exc}", source="startlist")
        return False

    if dry_run:
        logger.info("[dry-run] %s -> %d riders (race_name=%r)", url, len(riders), race_name)
        return True

    with db.get_connection() as conn:
        db.save_raw_page(conn, url, html)
        written = db.upsert_race_startlist(conn, slug, season, race_name, riders)
    logger.info("%s -> %d riders synced", url, written)
    return True


def main() -> None:
    load_dotenv()

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--races",
        help="Comma-separated slug:season pairs, e.g. tour-de-france:2025,giro-d-italia:2025",
    )
    args = parser.parse_args()

    if args.races:
        races = []
        for pair in args.races.split(","):
            slug, season = pair.split(":")
            races.append({"slug": slug, "season": int(season)})
    else:
        races = RACES_TO_SYNC

    ok, failed = 0, 0
    with PCSFetcher() as fetcher:
        for race in races:
            success = sync_one(fetcher, race["slug"], race["season"], args.dry_run)
            ok += success
            failed += not success
            time.sleep(random.uniform(THROTTLE_MIN_SECONDS, THROTTLE_MAX_SECONDS))

    logger.info("Done. %d synced, %d failed.", ok, failed)


if __name__ == "__main__":
    main()
