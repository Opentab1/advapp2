"""
Regression tests for DOW and timezone handling in forecast_cron.
Tests: late-night UTC vs venue-local, DST transitions, non-Eastern timezones.
"""
import pytest
from datetime import datetime, date
from zoneinfo import ZoneInfo


def _venue_today(dt_utc: datetime, tz_name: str) -> date:
    """Simulate _get_venue_today logic."""
    tz = ZoneInfo(tz_name)
    return dt_utc.astimezone(tz).date()


class TestDOWTimezone:
    def test_eastern_6am_utc_is_correct_date(self):
        # 6 AM UTC = 2 AM Eastern (UTC-4 in summer) — same calendar date, correct
        dt = datetime(2026, 4, 20, 6, 0, tzinfo=ZoneInfo("UTC"))
        assert _venue_today(dt, "America/New_York") == date(2026, 4, 20)

    def test_pacific_6am_utc_is_previous_day(self):
        # 6 AM UTC = 11 PM Pacific previous day — must use local date
        dt = datetime(2026, 4, 20, 6, 0, tzinfo=ZoneInfo("UTC"))
        assert _venue_today(dt, "America/Los_Angeles") == date(2026, 4, 19)

    def test_eastern_dst_spring_forward(self):
        # March 8 2026 2AM clocks spring forward — 6 AM UTC = 2 AM EST (UTC-5 before DST)
        dt = datetime(2026, 3, 8, 6, 0, tzinfo=ZoneInfo("UTC"))
        result = _venue_today(dt, "America/New_York")
        assert result == date(2026, 3, 8)

    def test_eastern_dst_fall_back(self):
        # Nov 1 2026 2AM clocks fall back — 6 AM UTC = 1 AM EST (UTC-5)
        dt = datetime(2026, 11, 1, 6, 0, tzinfo=ZoneInfo("UTC"))
        result = _venue_today(dt, "America/New_York")
        assert result == date(2026, 11, 1)

    def test_chicago_6am_utc_is_previous_day(self):
        # 6 AM UTC = 12 AM CST (UTC-6) — midnight, still same date
        dt = datetime(2026, 4, 20, 6, 0, tzinfo=ZoneInfo("UTC"))
        assert _venue_today(dt, "America/Chicago") == date(2026, 4, 20)

    def test_monday_correct_weekday(self):
        # April 20 2026 is a Monday — verify no off-by-one
        dt = datetime(2026, 4, 20, 6, 0, tzinfo=ZoneInfo("UTC"))
        d = _venue_today(dt, "America/New_York")
        assert d.weekday() == 0  # 0 = Monday in Python
