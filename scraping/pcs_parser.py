"""Turns raw procyclingstats.com HTML into structured dicts.

This module only knows how to parse HTML that's already been fetched (see
pcs_fetcher.py) — every `procyclingstats` scraper class below is built with
html=<string>, update_html=False so the package never attempts its own
network request, which would be blocked by Cloudflare.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from procyclingstats import Race, RaceClimbs, RaceStartlist, Ranking, Rider, Stage

logger = logging.getLogger(__name__)

# Group size at which we call a shared-time finish a "bunch sprint" rather
# than a small reduced-group sprint - arbitrary but reasonable cutoff, to
# be recalibrated once we can eyeball classifications against real stages.
BUNCH_SPRINT_MIN_GROUP_SIZE = 20


def _safe_call(obj: Any, method_name: str) -> Any:
    """Call a procyclingstats scraper method, swallowing parse errors.

    The package can raise (or return None/garbage) when PCS changes their
    HTML structure. We log and move on rather than let one broken field
    take down the whole stage/race.
    """
    try:
        method = getattr(obj, method_name)
        return method()
    except Exception as exc:  # noqa: BLE001 - intentionally broad, see docstring
        logger.warning("Failed to parse field '%s': %s", method_name, exc)
        return None


def get_stage_profile(url: str, html: str) -> dict:
    """Extract the k-NN-relevant profile fields for a single stage.

    `url` is the procyclingstats path/URL the HTML was fetched from (e.g.
    "race/tour-de-france/2024/stage-1"); it's stored alongside the parsed
    fields so callers can upsert on it.
    """
    stage = Stage(url, html=html, update_html=False)

    profile = {
        "pcs_url": url,
        "distance": _safe_call(stage, "distance"),
        "vertical_meters": _safe_call(stage, "vertical_meters"),
        "profile_score": _safe_call(stage, "profile_score"),
        "profile_icon": _safe_call(stage, "profile_icon"),
        "stage_type": _safe_call(stage, "stage_type"),
        "date": _safe_call(stage, "date"),
        "departure": _safe_call(stage, "departure"),
        "arrival": _safe_call(stage, "arrival"),
        "climbs": get_stage_climbs(url, html),
        "results": get_stage_results(url, html),
    }
    profile["victory_type"], profile["winner_group_size"] = classify_victory(profile["results"])
    return profile


def get_stage_climbs(url: str, html: str) -> list[dict]:
    """Extract categorized climbs for a stage, in course order."""
    stage = Stage(url, html=html, update_html=False)
    raw_climbs = _safe_call(stage, "climbs")
    if not raw_climbs:
        return []

    # Stage.climbs() only exposes name/url/category (+ KOM point scorers) -
    # it does NOT carry length/steepness/elevation. Those live on the
    # separate RaceClimbs endpoint (see get_race_climbs below), which is
    # keyed by climb name rather than by stage, so cross-referencing the two
    # is left to the caller/enrichment step rather than done here.
    climbs = []
    for order, climb in enumerate(raw_climbs, start=1):
        climbs.append(
            {
                "climb_order": order,
                "climb_name": climb.get("climb_name"),
                "climb_url": climb.get("climb_url"),
                "category": climb.get("category"),
            }
        )
    return climbs


def _time_to_seconds(time_str: Optional[str]) -> Optional[int]:
    """Parse a "H:MM:SS" (or "M:SS") PCS time string into total seconds."""
    if not time_str:
        return None
    parts = time_str.split(":")
    try:
        parts = [int(p) for p in parts]
    except ValueError:
        return None
    seconds = 0
    for part in parts:
        seconds = seconds * 60 + part
    return seconds


def get_stage_results(url: str, html: str) -> list[dict]:
    """Extract the stage's finishing order with gaps to the winner.

    `time` from Stage.results() is already an absolute, resolved finish
    time (not a raw "+0:05" gap string) - riders who crossed the line
    together share the exact same value, which is what classify_victory
    relies on to size the winning group.
    """
    stage = Stage(url, html=html, update_html=False)
    raw_results = _safe_call(
        stage, "results"
    )  # all fields; procyclingstats' *args filtering isn't reachable through _safe_call
    if not raw_results:
        return []

    winner_time = None
    for row in raw_results:
        if row.get("rank") == 1:
            winner_time = _time_to_seconds(row.get("time"))
            break

    results = []
    for row in raw_results:
        finish_seconds = _time_to_seconds(row.get("time"))
        gap_seconds = (
            finish_seconds - winner_time if finish_seconds is not None and winner_time is not None else None
        )
        results.append(
            {
                "rank": row.get("rank"),
                "rider_name": row.get("rider_name"),
                "rider_url": row.get("rider_url"),
                "team_name": row.get("team_name"),
                "status": row.get("status"),
                "finish_time_seconds": finish_seconds,
                "gap_seconds": gap_seconds,
            }
        )
    return results


def classify_victory(results: list[dict]) -> tuple[Optional[str], Optional[int]]:
    """Coarse scenario classification from the results' gap pattern.

    Approximation, not ground truth: counts how many finishers share the
    winner's exact time (gap_seconds == 0) as a proxy for "group the winner
    came in with". Doesn't distinguish a breakaway winning alone from a GC
    favorite soloing out of the peloton - both look like winner_group_size
    1 - and time bonuses/photo finishes can blur bunch-sprint boundaries.
    Good enough for k-NN buckets, not for a results page.
    """
    if not results:
        return None, None

    ranked = sorted((r for r in results if r.get("rank") is not None), key=lambda r: r["rank"])
    if not ranked or ranked[0].get("gap_seconds") is None:
        return None, None

    winner_group_size = sum(1 for r in ranked if r.get("gap_seconds") == 0)

    if winner_group_size >= BUNCH_SPRINT_MIN_GROUP_SIZE:
        victory_type = "bunch_sprint"
    elif winner_group_size == 1:
        second_gap = next((r["gap_seconds"] for r in ranked if r["rank"] == 2 and r.get("gap_seconds") is not None), None)
        victory_type = "solo_or_breakaway" if second_gap is None or second_gap >= 20 else "reduced_group_sprint"
    else:
        victory_type = "reduced_group_sprint"

    return victory_type, winner_group_size


def get_race_climbs(url: str, html: str) -> list[dict]:
    """Extract the full climbs table for a race (RaceClimbs endpoint)."""
    race_climbs = RaceClimbs(url, html=html, update_html=False)
    raw_climbs = _safe_call(race_climbs, "climbs") or []
    return [
        {
            "climb_name": c.get("climb_name"),
            "climb_url": c.get("climb_url"),
            "length_km": c.get("length"),
            "steepness_pct": c.get("steepness"),
            "top_elevation_m": c.get("top"),
            "km_before_finish": c.get("km_before_finnish") or c.get("km_before_finish"),
        }
        for c in raw_climbs
    ]


def get_race_startlist(url: str, html: str) -> list[dict]:
    """Who's registered for a race/season - not who finished a stage.

    Distinct from stage_results (see get_stage_results): a startlist
    includes DNS/DNF riders and, for future races, is the only source of
    "who's racing this edition" before any stage has happened.
    """
    startlist = RaceStartlist(url, html=html, update_html=False)
    raw = _safe_call(startlist, "startlist") or []
    return [
        {
            "rider_name": r.get("rider_name"),
            "rider_url": r.get("rider_url"),
            "team_name": r.get("team_name"),
            "team_url": r.get("team_url"),
            "nationality": r.get("nationality"),
            "rider_number": r.get("rider_number"),
        }
        for r in raw
        if r.get("rider_url")
    ]


def get_race_stage_urls(url: str, html: str) -> list[str]:
    """List stage URLs for a race, for discovery-based syncing."""
    race = Race(url, html=html, update_html=False)
    stages = _safe_call(race, "stages") or []
    return [s.get("stage_url") for s in stages if s.get("stage_url")]


def get_race_name(url: str, html: str) -> Optional[str]:
    """The race's real display name (e.g. "Critérium du Dauphiné").

    PCS occasionally links a race's stage pages under a different URL slug
    than the race's own page (e.g. a Critérium du Dauphiné edition whose
    stage URLs live under "tour-auvergne-rhone-alpes/..."). Deriving the
    race name from the *stage* URL's slug would silently mislabel those,
    so callers should prefer this - read from the race index page - over
    guessing from a stage_url path.
    """
    race = Race(url, html=html, update_html=False)
    return _safe_call(race, "name")


def get_rider_profile(url: str, html: str) -> dict:
    rider = Rider(url, html=html, update_html=False)
    return {
        "pcs_url": url,
        "name": _safe_call(rider, "name"),
        "birthdate": _safe_call(rider, "birthdate"),
        "weight": _safe_call(rider, "weight"),
        "height": _safe_call(rider, "height"),
        "nationality": _safe_call(rider, "nationality"),
    }


def get_ranking(url: str, html: str) -> Optional[list[dict]]:
    ranking = Ranking(url, html=html, update_html=False)
    return _safe_call(ranking, "individual_ranking")
