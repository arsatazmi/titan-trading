"""Offline mock checks for NY ORB on #BTCUSD. No actual trading."""
import datetime as dt
import sqlite3
import unittest
from test_bot import FakeMT5
from bot import UTC, Blocked, run_cycle

class BTCPilotTests(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime(2026,11,16,14,50,5,tzinfo=UTC)
        self.mt = FakeMT5(self.now)
        self.db = sqlite3.connect(':memory:')
        self.db.execute('CREATE TABLE intents(account TEXT,marker TEXT,state TEXT,PRIMARY KEY(account,marker))')
    def tearDown(self): self.db.close()
    def test_demo_btc_buy_is_marked_and_not_duplicated(self):
        self.assertIn('diterima',run_cycle(self.mt,'#BTCUSD',self.db,self.now))
        self.assertEqual(self.mt.sent[0]['symbol'],'#BTCUSD')
        self.assertLess(self.mt.sent[0]['sl'],self.mt.sent[0]['price'])
        self.assertGreater(self.mt.sent[0]['tp'],self.mt.sent[0]['price'])
        run_cycle(self.mt,'#BTCUSD',self.db,self.now)
        self.assertEqual(len(self.mt.sent),1)
    def test_btc_rejects_real_account(self):
        self.mt.account.trade_mode=2
        with self.assertRaises(Blocked):run_cycle(self.mt,'#BTCUSD',self.db,self.now)
        self.assertFalse(self.mt.sent)
    def test_observed_hfm_timestamp_blocks_without_fix(self):
        self.mt.tick.time+=7200
        with self.assertRaises(Blocked):run_cycle(self.mt,'#BTCUSD',self.db,self.now)
        self.assertFalse(self.mt.sent)
    def test_daily_loss_protection_still_applies(self):
        self.mt.account.equity=9899
        with self.assertRaises(Blocked):run_cycle(self.mt,'#BTCUSD',self.db,self.now)
        self.assertFalse(self.mt.sent)
    def test_before_ny_session_does_not_send(self):
        self.now=dt.datetime(2026,11,16,13,0,0,tzinfo=UTC)
        self.mt.tick.time=self.now.timestamp()
        self.assertIn('Menunggu sesi',run_cycle(self.mt,'#BTCUSD',self.db,self.now))
        self.assertFalse(self.mt.sent)

if __name__=='__main__': unittest.main()
