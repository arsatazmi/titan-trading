"""Offline mock checks for rolling BTC breakout. No actual trading."""
import datetime as dt
import sqlite3
import unittest
from types import SimpleNamespace as O
from bot import MAGIC
from test_bot import FakeMT5, Cell
from bot import UTC, Blocked, run_cycle

class FakeRollingMT5(FakeMT5):
    def copy_rates_range(self,sym,tf,start,end):
        if sym != '#BTCUSD': return super().copy_rates_range(sym,tf,start,end)
        values=[(2000,1990,1995)]*12+[(2005,1995,2003)]
        return [{k:Cell(v) for k,v in {'time':int((start+dt.timedelta(minutes=5*i)).timestamp()),'high':h,'low':l,'close':c}.items()} for i,(h,l,c) in enumerate(values)]

class BTCPilotTests(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime(2026,11,16,14,50,5,tzinfo=UTC)
        self.mt = FakeRollingMT5(self.now)
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
    def test_single_owned_position_prevents_new_entry(self):
        self.mt.positions=[O(ticket=42,symbol='#BTCUSD',magic=MAGIC,type=0,sl=1980,profit=-1,swap=0,volume=.01)]
        self.assertIn('Menunggu posisi',run_cycle(self.mt,'#BTCUSD',self.db,self.now))
        self.assertFalse(self.mt.sent)
    def test_late_signal_does_not_send(self):
        self.now += dt.timedelta(seconds=90)
        self.mt.tick.time=self.now.timestamp()
        self.assertIn('terlalu lama',run_cycle(self.mt,'#BTCUSD',self.db,self.now))
        self.assertFalse(self.mt.sent)
    def test_missing_bars_prevents_order(self):
        self.mt.copy_rates_range=lambda *a: []
        with self.assertRaises(Blocked):run_cycle(self.mt,'#BTCUSD',self.db,self.now)
        self.assertFalse(self.mt.sent)
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
    def test_opt_in_btc_ignores_daily_loss_but_retains_stop_and_sizing(self):
        self.mt.account.equity=9899
        self.assertIn('diterima',run_cycle(self.mt,'#BTCUSD',self.db,self.now,disable_btc_daily_loss=True))
        self.assertEqual(len(self.mt.sent),1)
        order=self.mt.sent[0]
        self.assertGreater(order['sl'],0)
        self.assertLess(order['sl'],order['price'])
        self.assertLessEqual(-self.mt.order_calc_profit(self.mt.ORDER_TYPE_BUY,'#BTCUSD',order['volume'],order['price'],order['sl']),self.mt.account.balance*.005)
    def test_opt_in_does_not_read_daily_history(self):
        self.mt.history_deals_get=lambda *args,**kwargs:self.fail('daily history was read')
        self.assertIn('diterima',run_cycle(self.mt,'#BTCUSD',self.db,self.now,disable_btc_daily_loss=True))
    def test_override_requires_actual_boolean_true(self):
        self.mt.account.equity=9899
        with self.assertRaises(Blocked):run_cycle(self.mt,'#BTCUSD',self.db,self.now,disable_btc_daily_loss='true')
    def test_opt_in_does_not_allow_real(self):
        self.mt.account.trade_mode=2
        with self.assertRaises(Blocked):run_cycle(self.mt,'#BTCUSD',self.db,self.now,disable_btc_daily_loss=True)
        self.assertFalse(self.mt.sent)
    def test_opt_in_does_not_disable_gold_daily_limit(self):
        self.mt.account.equity=9899
        with self.assertRaises(Blocked):run_cycle(self.mt,'XAUUSD',self.db,self.now,disable_btc_daily_loss=True)
        self.assertFalse(self.mt.sent)
    def test_opt_in_still_checks_fresh_tick_and_nonpositive_equity(self):
        self.mt.tick.time -= 30
        with self.assertRaises(Blocked):run_cycle(self.mt,'#BTCUSD',self.db,self.now,disable_btc_daily_loss=True)
        self.mt.tick.time=self.now.timestamp();self.mt.account.equity=0
        with self.assertRaises(Blocked):run_cycle(self.mt,'#BTCUSD',self.db,self.now,disable_btc_daily_loss=True)
        self.assertFalse(self.mt.sent)
    def test_sunday_outside_ny_session_can_send(self):
        self.now=dt.datetime(2026,11,15,1,0,5,tzinfo=UTC)
        self.mt.tick.time=self.now.timestamp()
        self.assertIn('diterima',run_cycle(self.mt,'#BTCUSD',self.db,self.now))
        self.assertEqual(len(self.mt.sent),1)

if __name__=='__main__': unittest.main()
