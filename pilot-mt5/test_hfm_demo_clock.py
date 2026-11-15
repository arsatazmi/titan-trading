"""Offline HFM demo bridge time adapter tests. No real broker requests."""
import datetime as dt
import sqlite3
import unittest
from types import SimpleNamespace as O
from unittest.mock import patch
from test_btc import FakeRollingMT5
from bot import UTC, Blocked, identity
from hfm_demo_clock import run_demo_cycle, DemoClockMT5, normalized_tick

class Tests(unittest.TestCase):
    def setUp(self):
        self.now=dt.datetime(2026,11,16,14,50,5,tzinfo=UTC)
        self.mt=FakeRollingMT5(self.now)
        self.mt.account.credit=0
        self.mt.tick.time+=7200
        self.db=sqlite3.connect(':memory:')
        self.db.execute('CREATE TABLE intents(account TEXT,marker TEXT,state TEXT,PRIMARY KEY(account,marker))')
        self.addCleanup(self.db.close)
    def cycle(self):return run_demo_cycle(self.mt,'#BTCUSD',self.db,self.now,clock=lambda:self.now)
    def test_btc_buy_once_through_mock_broker(self):
        self.assertIn('diterima',self.cycle());self.assertEqual(len(self.mt.sent),1)
        self.assertEqual(self.mt.sent[0]['symbol'],'#BTCUSD')
        self.assertIn('sudah diproses',self.cycle());self.assertEqual(len(self.mt.sent),1)
    def test_real_account_blocked(self):
        self.mt.account.trade_mode=2
        with self.assertRaises(Blocked):self.cycle()
        self.assertEqual(self.mt.sent,[])
    def test_mismatch_or_stale_clock_blocked(self):
        self.mt.tick.time-=7200
        with self.assertRaises(Blocked):self.cycle()
        self.assertEqual(self.mt.sent,[])
    def test_invalid_quotes_blocked(self):
        self.mt.tick.bid=-1
        with self.assertRaises(Blocked):self.cycle()
        self.assertEqual(self.mt.sent,[])
    def test_ambiguous_dst_blocks(self):
        self.now=dt.datetime(2026,10,25,14,50,tzinfo=UTC)
        with self.assertRaises(Blocked):self.cycle()
        self.assertEqual(self.mt.sent,[])
    def test_loss_limit_blocks(self):
        self.mt.account.equity=9899
        with self.assertRaises(Blocked):self.cycle()
        self.assertEqual(self.mt.sent,[])
    def test_account_change_before_send_blocked(self):
        key=identity(self.mt.account)
        proxy=DemoClockMT5(self.mt,key,clock=lambda:self.now)
        self.mt.account.login=456
        with self.assertRaises(Blocked):proxy.order_send({})
        self.assertEqual(self.mt.sent,[])
    def test_real_account_at_check_or_send_blocked(self):
        key=identity(self.mt.account);proxy=DemoClockMT5(self.mt,key,clock=lambda:self.now)
        self.mt.account.trade_mode=2
        with self.assertRaises(Blocked):proxy.order_check({})
        with self.assertRaises(Blocked):proxy.order_send({})
        self.assertEqual(self.mt.sent,[])
    def test_inconsistent_daily_history_blocks(self):
        calls=[]
        def history(*args,**kwargs):
            calls.append(1)
            return None if len(calls)==2 else []
        self.mt.history_deals_get=history
        with self.assertRaises(Blocked):self.cycle()
        self.assertEqual(self.mt.sent,[])
    def test_history_query_normalized(self):
        calls=[]; self.mt.history_deals_get=lambda *args,**kwargs:calls.append(args) or []
        proxy=DemoClockMT5(self.mt,identity(self.mt.account),clock=lambda:self.now)
        start=self.now-dt.timedelta(hours=1)
        proxy.history_deals_get(start,self.now)
        self.assertEqual(calls[0],(start+dt.timedelta(hours=2),self.now+dt.timedelta(hours=2)))
    def test_old_utc_tick_not_fresh_for_this_hfm_model(self):
        self.mt.tick.time=self.now.timestamp()
        with self.assertRaises(Blocked):normalized_tick(self.mt,'#BTCUSD',self.now)

if __name__=='__main__':unittest.main()
