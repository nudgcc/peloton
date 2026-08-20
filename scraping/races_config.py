"""Static list of races/seasons to sync from procyclingstats.com.

Each entry is discovered at run time via Race.stages() (see
get_race_stage_urls in pcs_parser.py) rather than hardcoding every stage
URL, so adding a race here is enough to pick up all of its stages.

Slugs below were each spot-checked against the live site (real fetch +
Race.stages() call, not guessed) before being added — a couple of
candidates ("benelux-tour", "baloise-belgium-tour") returned 0 stages for
2024, likely a naming mismatch across seasons, and were left out rather
than risk silently-empty syncs.
"""

from __future__ import annotations

# Grand tours - 3 weeks, most data points per race for the k-NN pool.
_GRAND_TOURS = [
    "tour-de-france",
    "giro-d-italia",
    "vuelta-a-espana",
]

# Major one-week WorldTour stage races.
_ONE_WEEK_RACES = [
    "paris-nice",
    "tirreno-adriatico",
    "volta-a-catalunya",
    "itzulia-basque-country",
    "tour-de-romandie",
    "criterium-du-dauphine",
    "tour-de-suisse",
]

# Other WorldTour/ProSeries stage races worth including for volume/variety.
_OTHER_STAGE_RACES = [
    "tour-of-britain",
    "tour-de-pologne",
    "tour-of-oman",
    "uae-tour",
    "volta-ao-algarve",
    "tour-down-under",
    "vuelta-a-burgos",
    "renewi-tour",
    "tour-de-wallonie",
    "tour-de-l-ain",
]

_SEASONS = [2023, 2024, 2025, 2026]

# The only season a scheduled sync needs to re-check (see sync_pcs_data.py
# --season) - past seasons are finished and don't change. Bump this once a
# year; add the new year to _SEASONS above at the same time.
CURRENT_SEASON = 2026

RACES_TO_SYNC = [
    {"slug": slug, "season": season}
    for slug in (_GRAND_TOURS + _ONE_WEEK_RACES + _OTHER_STAGE_RACES)
    for season in _SEASONS
]


def race_url(slug: str, season: int) -> str:
    return f"race/{slug}/{season}"
