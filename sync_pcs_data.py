#!/usr/bin/env python3
"""Sync stage profile data from procyclingstats.com into Postgres.

Usage:
    python sync_pcs_data.py --dry-run
    python sync_pcs_data.py --stage-url race/tour-de-france/2024/stage-1
    python sync_pcs_data.py --races tour-de-france:2024,giro-d-italia:2024
    python sync_pcs_data.py                     # syncs scraping/races_config.py
"""

from __future__ import annotations

import argparse
import contextlib
import logging
import random
import re
import time
from typing import Optional

from dotenv import load_dotenv

from scraping import db
from scraping.pcs_fetcher import PCSFetcher
from scraping.pcs_parser import get_race_name, get_race_stage_urls, get_stage_profile
from scraping.races_config import RACES_TO_SYNC, race_url

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("sync_pcs_data")

THROTTLE_MIN_SECONDS = 2
THROTTLE_MAX_SECONDS = 5


def throttle() -> None:
    time.sleep(random.uniform(THROTTLE_MIN_SECONDS, THROTTLE_MAX_SECONDS))


def parse_stage_meta(stage_url: str, race_name: Optional[str] = None) -> dict:
    """Extract season / stage number from the URL; race name from the page itself.

    The stage URL's own slug is a poor source for race_name - PCS sometimes
    links a race's stages under a different slug than its index page (see
    get_race_name's docstring), so `race_name` should be passed in from the
    race-level discovery step whenever available. It's only guessed from
    the URL as a last resort (e.g. --stage-url with no discovery context).
    """
    match = re.match(r"race/([^/]+)/(\d{4})/(?:stage-)?(.+)", stage_url)
    if not match:
        return {}
    slug, season, stage_number = match.groups()
    return {
        "race_name": race_name or slug.replace("-", " ").title(),
        "season": int(season),
        "stage_number": stage_number,
    }


def sync_stage(fetcher: PCSFetcher, conn, stage_url: str, dry_run: bool, race_name: Optional[str] = None) -> bool:
    try:
        html = fetcher.fetch(stage_url)
    except Exception as exc:  # noqa: BLE001
        logger.error("Fetch failed for %s: %s", stage_url, exc)
        if not dry_run:
            db.log_failure(conn, stage_url, f"fetch error: {exc}")
        return False

    if not dry_run:
        # Save the raw snapshot before parsing, so a future PCS HTML change
        # can be reparsed from history instead of requiring a re-scrape.
        try:
            db.save_raw_page(conn, stage_url, html)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to save raw page for %s: %s", stage_url, exc)
            conn.rollback()

    try:
        profile = get_stage_profile(stage_url, html)
        profile.update(parse_stage_meta(stage_url, race_name=race_name))
    except Exception as exc:  # noqa: BLE001
        logger.error("Parse failed for %s: %s", stage_url, exc)
        if not dry_run:
            db.log_failure(conn, stage_url, f"parse error: {exc}")
        return False

    if dry_run:
        logger.info("[dry-run] Parsed %s: %s", stage_url, {k: v for k, v in profile.items() if k != "climbs"})
        logger.info("[dry-run] %d climbs", len(profile.get("climbs") or []))
        return True

    try:
        stage_profile_id = db.upsert_stage_profile(conn, profile)
        logger.info("Upserted stage_profiles.id=%s for %s", stage_profile_id, stage_url)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.error("DB upsert failed for %s: %s", stage_url, exc)
        conn.rollback()
        db.log_failure(conn, stage_url, f"db error: {exc}")
        return False


def discover_race(fetcher: PCSFetcher, slug: str, season: int) -> tuple[list[str], Optional[str]]:
    """Returns (stage_urls, race_name) - race_name read from the page itself."""
    url = race_url(slug, season)
    try:
        html = fetcher.fetch(url)
        return get_race_stage_urls(url, html), get_race_name(url, html)
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to discover stages for %s: %s", url, exc)
        return [], None


def main() -> None:
    load_dotenv()

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="Fetch and parse but do not write to Postgres")
    parser.add_argument("--stage-url", help="Sync a single stage URL/path, e.g. race/tour-de-france/2024/stage-1")
    parser.add_argument(
        "--races",
        help="Comma-separated slug:season pairs to sync instead of scraping/races_config.py, "
        "e.g. tour-de-france:2024,giro-d-italia:2024",
    )
    args = parser.parse_args()

    with contextlib.ExitStack() as stack:
        conn = None if args.dry_run else stack.enter_context(db.get_connection())
        fetcher = stack.enter_context(PCSFetcher())

        if args.stage_url:
            sync_stage(fetcher, conn, args.stage_url, args.dry_run)
            return

        if args.races:
            races = []
            for pair in args.races.split(","):
                slug, season = pair.split(":")
                races.append({"slug": slug, "season": int(season)})
        else:
            races = RACES_TO_SYNC

        total_ok, total_fail = 0, 0
        for race in races:
            stage_urls, race_name = discover_race(fetcher, race["slug"], race["season"])
            logger.info(
                "Discovered %d stages for %s %s (race_name=%r)",
                len(stage_urls), race["slug"], race["season"], race_name,
            )
            for stage_url in stage_urls:
                ok = sync_stage(fetcher, conn, stage_url, args.dry_run, race_name=race_name)
                total_ok += ok
                total_fail += not ok
                throttle()

        logger.info("Done. %d stages synced, %d failures.", total_ok, total_fail)


if __name__ == "__main__":
    main()
