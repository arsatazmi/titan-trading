"""Offline tests only; do not validate actual HFM server or authorize trading."""
import datetime as dt
import unittest
from types import SimpleNamespace as NS
from hfm_clock_research import (UTC, ClockUncertain, ClockWindow, ny_day_window,
                                filtered_daily_deals, candidate_quote_age)


def utc(s): return dt.datetime.fromisoformat(s).replace(tzinfo=UTC)


class ClockResearchTests(unittest.TestCase):
    def test_observed_deal_and_tick_corrected(self):
        now = utc('2026-11-15T00:50:12')
        w = ClockWindow.candidate(now - dt.timedelta(minutes=5), now + dt.timedelta(seconds=5))
        reported = utc('2026-11-15T02:50:14').timestamp()
        self.assertEqual(w.from_mt5_seconds(reported), utc('2026-11-15T00:50:14'))
        self.assertEqual(candidate_quote_age(reported, now), -2)

    def test_summer_offset_changes_with_dst(self):
        t = utc('2026-07-15T12:00:00')
        w = ClockWindow.candidate(t, t + dt.timedelta(hours=1))
        self.assertEqual(w.offset, dt.timedelta(hours=3))
        self.assertEqual(w.to_mt5_query(t), utc('2026-07-15T15:00:00'))
        self.assertEqual(w.from_mt5_seconds(utc('2026-07-15T15:00:00').timestamp()),t)

    def test_winter_query_and_history(self):
        t = utc('2026-11-15T00:51:59')
        w = ny_day_window(t)
        self.assertEqual(w.start, utc('2026-11-14T05:00:00'))
        self.assertEqual(w.to_mt5_query(w.start), utc('2026-11-14T07:00:00'))
        self.assertEqual(w.to_mt5_query(t), utc('2026-11-15T02:51:59'))

    def test_daily_deal_boundary_and_query(self):
        now = utc('2026-11-15T00:51:59')
        start_raw = utc('2026-11-14T07:00:00')
        end_raw = utc('2026-11-15T02:51:59')
        class API:
            def history_deals_get(self,start,end):
                self.args=(start,end)
                return [NS(time=start.timestamp()),NS(time=(end-dt.timedelta(seconds=1)).timestamp()),NS(time=end.timestamp())]
        api=API()
        _, deals=filtered_daily_deals(api,now)
        self.assertEqual(api.args,(start_raw,end_raw))
        self.assertEqual(len(deals),2) # half-open UTC day; not the future endpoint

    def test_api_out_of_range_fails_closed(self):
        now = utc('2026-11-15T00:51:59')
        class API:
            def history_deals_get(self,start,end): return [NS(time=start.timestamp()-1)]
        with self.assertRaises(ClockUncertain): filtered_daily_deals(API(),now)

    def test_history_failure_fails_closed(self):
        class API:
            def history_deals_get(self,*args): return None
        with self.assertRaises(ClockUncertain): filtered_daily_deals(API(),utc('2026-11-15T00:51:59'))

    def test_spring_and_autumn_transition_fail_closed(self):
        for s in ['2026-03-28T12:00:00','2026-03-29T01:00:00',
                  '2026-10-25T01:00:00','2026-10-26T12:00:00']:
            t=utc(s)
            with self.subTest(time=s),self.assertRaises(ClockUncertain):
                ClockWindow.candidate(t,t+dt.timedelta(hours=1))

    def test_far_from_transition_allowed(self):
        for s in ['2026-03-20T12:00:00','2026-04-06T12:00:00',
                  '2026-10-16T12:00:00','2026-11-05T12:00:00']:
            t=utc(s); ClockWindow.candidate(t,t+dt.timedelta(hours=1))

    def test_rejects_naive_and_long_range(self):
        with self.assertRaises(ClockUncertain): ClockWindow.candidate(dt.datetime(2026,1,1),utc('2026-01-02T00:00:00'))
        t=utc('2026-01-01T00:00:00')
        with self.assertRaises(ClockUncertain): ClockWindow.candidate(t,t+dt.timedelta(days=3))

    def test_quote_valid_stale_future_and_wrong_offset(self):
        now=utc('2026-11-15T00:50:12')
        for age in [0,19,-4]:
            self.assertEqual(candidate_quote_age(now.timestamp()+7200-age,now),age)
        for age in [21,-6,7200]:
            with self.subTest(age=age),self.assertRaises(ClockUncertain):
                candidate_quote_age(now.timestamp()+7200-age,now)

    def test_range_cannot_silently_cross_day_boundary(self):
        now=utc('2026-11-15T00:51:59'); w=ny_day_window(now)
        for t in (w.start-dt.timedelta(seconds=1),w.end+dt.timedelta(seconds=1)):
            with self.assertRaises(ClockUncertain):w.from_mt5_seconds((t+w.offset).timestamp())

if __name__ == '__main__': unittest.main()
