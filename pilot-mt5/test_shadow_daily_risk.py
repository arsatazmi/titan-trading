"""Offline tests of the research ledger. Does not validate broker data."""
import datetime as dt
import unittest
from types import SimpleNamespace as O
from shadow_daily_risk import snapshot, ShadowUncertain
from hfm_clock_research import UTC, ClockUncertain

NOW=dt.datetime(2026,11,15,1,0,tzinfo=UTC)
def raw(s): return dt.datetime.fromisoformat(s).replace(tzinfo=UTC).timestamp()+7200

def deal(ticket, t, profit=0, commission=0, swap=0, fee=0, typ=0):
    return O(ticket=ticket,time=raw(t),profit=profit,commission=commission,swap=swap,fee=fee,type=typ)

class Fake:
    ACCOUNT_TRADE_MODE_DEMO=0; DEAL_TYPE_BUY=0; DEAL_TYPE_SELL=1
    def __init__(self):
        self.account=O(login=123,server='HFM-Demo',balance=9990,credit=0,equity=9980,trade_mode=0)
        self.deals=[deal(1,'2026-11-14T12:00:00',profit=-10)]
    def account_info(self):return self.account
    def history_deals_get(self,start,end):
        return [d for d in self.deals if start.timestamp() <= d.time <= end.timestamp()]

class Tests(unittest.TestCase):
    def setUp(self):self.mt=Fake()
    def test_estimate_baseline_and_risk(self):
        out=snapshot(self.mt,NOW)
        self.assertEqual(out['deal_count'],1)
        self.assertEqual(out['net'],-10)
        self.assertEqual(out['baseline'],10000)
        self.assertFalse(out['loss_limit_reached'])
        self.mt.account.equity=9899
        self.assertTrue(snapshot(self.mt,NOW)['loss_limit_reached'])
    def test_fields_included(self):
        self.mt.deals=[deal(1,'2026-11-14T12:00:00',profit=5,commission=-2,swap=-3,fee=-1)]
        self.assertEqual(snapshot(self.mt,NOW)['net'],-1)
    def test_nontrade_adjustment_blocked(self):
        self.mt.deals.append(deal(2,'2026-11-14T12:00:00',typ=2))
        with self.assertRaises(ShadowUncertain):snapshot(self.mt,NOW)
    def test_credit_and_real_blocked(self):
        self.mt.account.credit=1
        with self.assertRaises(ShadowUncertain):snapshot(self.mt,NOW)
        self.mt.account.credit=0;self.mt.account.trade_mode=2
        with self.assertRaises(ShadowUncertain):snapshot(self.mt,NOW)
    def test_duplicate_deal_blocked(self):
        self.mt.deals.append(self.mt.deals[0])
        with self.assertRaises(ShadowUncertain):snapshot(self.mt,NOW)
    def test_inconsistent_queries_blocked(self):
        fn=self.mt.history_deals_get;calls=[]
        def uneven(*args):
            calls.append(1); return fn(*args) if len(calls)==1 else []
        self.mt.history_deals_get=uneven
        with self.assertRaises(ShadowUncertain):snapshot(self.mt,NOW)
    def test_nonfinite_data_blocked(self):
        self.mt.deals[0].commission=float('nan')
        with self.assertRaises(ShadowUncertain):snapshot(self.mt,NOW)
    def test_balance_change_blocked(self):
        fn=self.mt.account_info; calls=[]
        def changing():
            calls.append(1)
            if len(calls)==2:self.mt.account.balance=9980
            return fn()
        self.mt.account_info=changing
        with self.assertRaises(ShadowUncertain):snapshot(self.mt,NOW)
    def test_ny_day_boundaries(self):
        # NY midnight is 05:00 UTC on 14 Nov; ignore one second earlier.
        self.mt.deals=[deal(1,'2026-11-14T04:59:59',profit=-99),deal(2,'2026-11-14T05:00:00',profit=-1)]
        self.assertEqual(snapshot(self.mt,NOW)['net'],-1)
    def test_transition_date_blocked(self):
        with self.assertRaises(ClockUncertain):snapshot(self.mt,dt.datetime(2026,10,25,12,tzinfo=UTC))

if __name__=='__main__':unittest.main()
