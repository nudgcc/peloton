"""Postgres access for the PCS sync pipeline."""

from __future__ import annotations

import gzip
import hashlib
import json
import logging
import os
import re
from contextlib import contextmanager
from typing import Iterator, Optional

import psycopg2
import psycopg2.extras
from selectolax.parser import HTMLParser

logger = logging.getLogger(__name__)

# Elements that vary between fetches of an otherwise-unchanged page (ad
# slots, consent banner, tracking/pageload scripts) - stripped before
# hashing so dedup isn't defeated by noise unrelated to the actual content.
_NOISE_SELECTORS = "script, style, #cmpbox, #cmpbox2, [class*='-ad'], [id*='-ad-']"
# PCS renders a per-request "Pageload 0.0xxxs" timer as plain footer text
# (not inside a stripped element above) - also noise, normalized away.
_PAGELOAD_RE = re.compile(r"Pageload \d+\.\d+s")


def _content_fingerprint(html: str) -> str:
    tree = HTMLParser(html)
    for node in tree.css(_NOISE_SELECTORS):
        node.decompose()
    text = (tree.body.text(separator=" ", strip=True) if tree.body else html)
    text = _PAGELOAD_RE.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL environment variable is not set")
    return url


@contextmanager
def get_connection() -> Iterator[psycopg2.extensions.connection]:
    conn = psycopg2.connect(_database_url())
    try:
        yield conn
    finally:
        conn.close()


def upsert_stage_profile(conn, profile: dict) -> int:
    """Insert or update a stage_profiles row, and replace its climbs.

    Returns the stage_profiles.id.
    """
    climbs = profile.get("climbs") or []
    results = profile.get("results") or []
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO stage_profiles (
                pcs_url, race_name, season, stage_number, stage_type,
                distance_km, vertical_meters, profile_score, profile_icon,
                nb_climbs, victory_type, winner_group_size, raw_json, fetched_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
            ON CONFLICT (pcs_url) DO UPDATE SET
                race_name = EXCLUDED.race_name,
                season = EXCLUDED.season,
                stage_number = EXCLUDED.stage_number,
                stage_type = EXCLUDED.stage_type,
                distance_km = EXCLUDED.distance_km,
                vertical_meters = EXCLUDED.vertical_meters,
                profile_score = EXCLUDED.profile_score,
                profile_icon = EXCLUDED.profile_icon,
                nb_climbs = EXCLUDED.nb_climbs,
                victory_type = EXCLUDED.victory_type,
                winner_group_size = EXCLUDED.winner_group_size,
                raw_json = EXCLUDED.raw_json,
                fetched_at = now()
            RETURNING id
            """,
            (
                profile["pcs_url"],
                profile.get("race_name"),
                profile.get("season"),
                profile.get("stage_number"),
                profile.get("stage_type"),
                profile.get("distance"),
                profile.get("vertical_meters"),
                profile.get("profile_score"),
                profile.get("profile_icon"),
                len(climbs),
                profile.get("victory_type"),
                profile.get("winner_group_size"),
                json.dumps(profile, default=str),
            ),
        )
        stage_profile_id = cur.fetchone()[0]

        cur.execute("DELETE FROM stage_climbs WHERE stage_profile_id = %s", (stage_profile_id,))
        if climbs:
            psycopg2.extras.execute_values(
                cur,
                """
                INSERT INTO stage_climbs (
                    stage_profile_id, climb_order, climb_name, climb_url,
                    category, length_km, steepness_pct, top_elevation_m, km_before_finish
                ) VALUES %s
                """,
                [
                    (
                        stage_profile_id,
                        c.get("climb_order"),
                        c.get("climb_name"),
                        c.get("climb_url"),
                        c.get("category"),
                        c.get("length_km"),
                        c.get("steepness_pct"),
                        c.get("top_elevation_m"),
                        c.get("km_before_finish"),
                    )
                    for c in climbs
                ],
            )

        cur.execute("DELETE FROM stage_results WHERE stage_profile_id = %s", (stage_profile_id,))
        if results:
            psycopg2.extras.execute_values(
                cur,
                """
                INSERT INTO stage_results (
                    stage_profile_id, rank, rider_name, rider_url,
                    team_name, status, finish_time_seconds, gap_seconds
                ) VALUES %s
                ON CONFLICT (stage_profile_id, rank) DO NOTHING
                """,
                [
                    (
                        stage_profile_id,
                        r.get("rank"),
                        r.get("rider_name"),
                        r.get("rider_url"),
                        r.get("team_name"),
                        r.get("status"),
                        r.get("finish_time_seconds"),
                        r.get("gap_seconds"),
                    )
                    for r in results
                    if r.get("rank") is not None
                ],
            )
    conn.commit()
    return stage_profile_id


def save_raw_page(conn, url: str, html: str) -> Optional[int]:
    """Persist a gzip'd HTML snapshot, versioned by content hash.

    Skips the insert (returns None) if the most recent snapshot for this
    URL already has the same content fingerprint, so unchanged pages don't
    bloat the table on every re-sync — only actual content changes are
    kept. The fingerprint is computed on the page's visible text with ads/
    scripts/consent-banner stripped, since those vary on every load even
    when the actual stage data hasn't changed; the full original HTML is
    still stored as-is.
    """
    fingerprint = _content_fingerprint(html)

    with conn.cursor() as cur:
        cur.execute(
            "SELECT html_sha256 FROM raw_pages WHERE url = %s ORDER BY fetched_at DESC LIMIT 1",
            (url,),
        )
        row = cur.fetchone()
        if row and row[0] == fingerprint:
            return None

        cur.execute(
            "INSERT INTO raw_pages (url, html_gzip, html_sha256) VALUES (%s, %s, %s) RETURNING id",
            (url, gzip.compress(html.encode("utf-8")), fingerprint),
        )
        raw_page_id = cur.fetchone()[0]
    conn.commit()
    return raw_page_id


def log_failure(conn, url: str, reason: str, source: str = "pcs") -> None:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO sync_failures (source, url, reason) VALUES (%s, %s, %s)",
            (source, url, reason[:2000]),
        )
    conn.commit()
