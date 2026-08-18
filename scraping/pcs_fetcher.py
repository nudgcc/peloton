"""Fetches raw HTML from procyclingstats.com via a headless browser.

procyclingstats.com sits behind Cloudflare, so plain HTTP requests get
blocked. We drive real Chromium through Playwright and hand the rendered
HTML off to the `procyclingstats` parsing layer (see pcs_parser.py), which
is kept intentionally unaware of how the HTML was obtained.
"""

from __future__ import annotations

import logging
import random
import time
from typing import Optional

from playwright.sync_api import Browser, Page, TimeoutError as PlaywrightTimeoutError, sync_playwright

logger = logging.getLogger(__name__)

BASE_URL = "https://www.procyclingstats.com/"
DEFAULT_TIMEOUT_MS = 20_000
DEFAULT_RETRIES = 3
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def _to_full_url(url_or_path: str) -> str:
    if url_or_path.startswith("http://") or url_or_path.startswith("https://"):
        return url_or_path
    return BASE_URL + url_or_path.lstrip("/")


class PCSFetcher:
    """Reusable browser session for fetching multiple PCS pages.

    Keeping one browser/context alive across a batch of pages avoids the
    cost (and extra Cloudflare exposure) of a fresh browser launch per page.
    Use as a context manager:

        with PCSFetcher() as fetcher:
            html = fetcher.fetch("race/tour-de-france/2024/stage-1")
    """

    def __init__(
        self,
        headless: bool = True,
        timeout_ms: int = DEFAULT_TIMEOUT_MS,
        retries: int = DEFAULT_RETRIES,
    ) -> None:
        self.headless = headless
        self.timeout_ms = timeout_ms
        self.retries = retries
        self._playwright = None
        self._browser: Optional[Browser] = None

    def __enter__(self) -> "PCSFetcher":
        self._playwright = sync_playwright().start()
        self._browser = self._playwright.chromium.launch(headless=self.headless)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        if self._browser is not None:
            self._browser.close()
        if self._playwright is not None:
            self._playwright.stop()

    def fetch(self, url_or_path: str) -> str:
        """Load a procyclingstats.com page and return its final HTML.

        Retries with backoff on timeout, since Cloudflare's interstitial
        challenge can add a few seconds of delay on the first hit.
        """
        assert self._browser is not None, "PCSFetcher must be used as a context manager"
        full_url = _to_full_url(url_or_path)

        last_error: Optional[Exception] = None
        for attempt in range(1, self.retries + 1):
            page: Optional[Page] = None
            try:
                page = self._browser.new_page(user_agent=USER_AGENT)
                page.goto(full_url, timeout=self.timeout_ms, wait_until="domcontentloaded")
                # Cloudflare's JS challenge (when present) resolves within a
                # couple of seconds; wait for a page element that only shows
                # up on the real content, not the interstitial.
                try:
                    page.wait_for_selector("body.no-clone, #wrapper, .page-content", timeout=self.timeout_ms)
                except PlaywrightTimeoutError:
                    page.wait_for_timeout(3000)
                html = page.content()
                if "Just a moment" in html or "cf-browser-verification" in html:
                    raise RuntimeError("Cloudflare challenge page returned instead of real content")
                return html
            except (PlaywrightTimeoutError, RuntimeError) as exc:
                last_error = exc
                logger.warning(
                    "Fetch attempt %d/%d failed for %s: %s", attempt, self.retries, full_url, exc
                )
                if attempt < self.retries:
                    time.sleep(2 * attempt + random.uniform(0, 1))
            finally:
                if page is not None:
                    page.close()

        raise RuntimeError(f"Failed to fetch {full_url} after {self.retries} attempts") from last_error


def fetch_html(url_or_path: str, **kwargs) -> str:
    """Convenience one-off fetch for a single URL (launches its own browser)."""
    with PCSFetcher(**kwargs) as fetcher:
        return fetcher.fetch(url_or_path)
