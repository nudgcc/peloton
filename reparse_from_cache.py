#!/usr/bin/env python3
"""Re-parse already-synced stages from their cached raw_pages HTML.

Useful after a pcs_parser.py change (e.g. adding a new extracted field):
re-run the parser against history without re-fetching anything from
procyclingstats.com, since the raw HTML was already saved by
sync_pcs_data.py (see scraping/db.py:save_raw_page). No throttling needed
- this never touches the network.

Usage:
    python reparse_from_cache.py
    python reparse_from_cache.py --dry-run
"""

from __future__ import annotations

import argparse
import gzip
import logging

from dotenv import load_dotenv

from scraping import db
from scraping.pcs_parser import get_stage_profile

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("reparse_from_cache")


def main() -> None:
    load_dotenv()

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="Parse but do not write to Postgres")
    args = parser.parse_args()

    with db.get_connection() as conn:
        with conn.cursor() as cur:
            # Latest snapshot per URL only - raw_pages can hold history.
            cur.execute(
                """
                SELECT DISTINCT ON (url) url, html_gzip
                FROM raw_pages
                ORDER BY url, fetched_at DESC
                """
            )
            rows = cur.fetchall()

        logger.info("Reparsing %d cached pages.", len(rows))
        ok, failed = 0, 0
        for url, html_gzip in rows:
            html = gzip.decompress(html_gzip).decode("utf-8")
            try:
                profile = get_stage_profile(url, html)
            except Exception as exc:  # noqa: BLE001
                logger.error("Parse failed for %s: %s", url, exc)
                failed += 1
                continue

            if args.dry_run:
                logger.info(
                    "[dry-run] %s -> victory_type=%s winner_group_size=%s",
                    url, profile.get("victory_type"), profile.get("winner_group_size"),
                )
                ok += 1
                continue

            try:
                # race_name/season/stage_number aren't in raw HTML - keep
                # whatever's already stored for those by not overwriting
                # them; upsert_stage_profile requires them so read them back.
                cur = conn.cursor()
                cur.execute(
                    "SELECT race_name, season, stage_number FROM stage_profiles WHERE pcs_url = %s",
                    (url,),
                )
                existing = cur.fetchone()
                if existing:
                    profile["race_name"], profile["season"], profile["stage_number"] = existing
                db.upsert_stage_profile(conn, profile)
                ok += 1
            except Exception as exc:  # noqa: BLE001
                logger.error("Upsert failed for %s: %s", url, exc)
                conn.rollback()
                failed += 1

        logger.info("Done. %d reparsed, %d failed.", ok, failed)


if __name__ == "__main__":
    main()
