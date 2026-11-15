"""Candidate HFM server-clock conversion for the experimental DEMO bridge.

HFM publishes GMT+2 winter / GMT+3 summer, last Sundays Mar/Oct. Europe/Helsinki
is a *candidate* mapping, not confirmation of the server's transition hour or
historical rules. Current HFM demo tick, candle and deal times were checked on
15 Nov 2026. Broker completeness, DST and end-to-end execution remain unproven.
Never use with a real account or rely on it as a guaranteed risk control.
"""
import datetime as dt
import math
from dataclasses import dataclass
from zoneinfo import ZoneInfo

UTC = dt.timezone.utc
NY = ZoneInfo('America/New_York')
HFM_CANDIDATE = ZoneInfo('Europe/Helsinki')


class ClockUncertain(ValueError):
    pass


def aware_utc(value):
    if not isinstance(value, dt.datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ClockUncertain('waktu UTC harus timezone-aware')
    return value.astimezone(UTC)


def offset_at(instant):
    return aware_utc(instant).astimezone(HFM_CANDIDATE).utcoffset()


@dataclass(frozen=True)
class ClockWindow:
    start: dt.datetime
    end: dt.datetime
    offset: dt.timedelta

    @classmethod
    def candidate(cls, start, end):
        start, end = aware_utc(start), aware_utc(end)
        if start > end or end - start > dt.timedelta(days=2):
            raise ClockUncertain('rentang waktu tidak valid atau terlalu panjang')
        # Conservative exclusion around *candidate* DST transitions. This is
        # not a substitute for proving the broker uses the candidate timezone.
        begin = start - dt.timedelta(hours=48)
        finish = end + dt.timedelta(hours=48)
        expected = offset_at(start)
        probe = begin
        while probe <= finish:
            if offset_at(probe) != expected:
                raise ClockUncertain('terlalu dekat perubahan waktu server')
            probe += dt.timedelta(minutes=30)
        if offset_at(finish) != expected:
            raise ClockUncertain('terlalu dekat perubahan waktu server')
        return cls(start, end, expected)

    def to_mt5_query(self, instant):
        instant = aware_utc(instant)
        if not self.start <= instant <= self.end:
            raise ClockUncertain('waktu di luar rentang yang diuji')
        # This intentionally encodes broker wall time as UTC for the API,
        # matching only the empirical HFM demo test; not a universal MT5 rule.
        return instant + self.offset

    def from_mt5_seconds(self, raw):
        if not math.isfinite(float(raw)):
            raise ClockUncertain('timestamp tidak valid')
        instant = dt.datetime.fromtimestamp(float(raw), UTC) - self.offset
        if not self.start <= instant <= self.end:
            raise ClockUncertain('timestamp di luar rentang yang diuji')
        return instant


def ny_day_window(now):
    now = aware_utc(now)
    local = now.astimezone(NY)
    start = dt.datetime.combine(local.date(), dt.time.min, tzinfo=NY).astimezone(UTC)
    return ClockWindow.candidate(start, now)


def filtered_daily_deals(mt5, now):
    """Candidate NY-day history read only; caller must reconcile cash/account."""
    window = ny_day_window(now)
    deals = mt5.history_deals_get(window.to_mt5_query(window.start), window.to_mt5_query(window.end))
    if deals is None:
        raise ClockUncertain('query riwayat gagal')
    result = []
    for deal in deals:
        try:
            instant = window.from_mt5_seconds(deal.time)
        except (ClockUncertain, OverflowError, OSError, ValueError):
            raise ClockUncertain('riwayat mengandung timestamp di luar rentang atau tidak valid')
        if instant < window.end:
            result.append(deal)
    return window, result


def candidate_quote_age(raw_timestamp, now):
    now = aware_utc(now)
    # Widen by five minutes to allow checking a stale tick instead of treating
    # out-of-window as valid. Larger deviations fail closed.
    window = ClockWindow.candidate(now - dt.timedelta(minutes=5), now + dt.timedelta(seconds=5))
    tick_time = window.from_mt5_seconds(raw_timestamp)
    age = (now - tick_time).total_seconds()
    if age < -5 or age > 20:
        raise ClockUncertain('quote masa depan atau kedaluwarsa')
    return age
