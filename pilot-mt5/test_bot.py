import datetime as dt
import sqlite3
import unittest
from types import SimpleNamespace as O
from bot import (UTC, Blocked, demo_only, volume_for_risk, run_cycle, close_profitable, identity, MAGIC)

class Cell:
    def __init__(self, value): self.value=value
    def item(self): return self.value

class FakeMT5:
    ACCOUNT_TRADE_MODE_DEMO=0
    ACCOUNT_MARGIN_MODE_RETAIL_HEDGING=2
    SYMBOL_TRADE_MODE_FULL=4
    SYMBOL_TRADE_MODE_LONGONLY=1
    DEAL_TYPE_BUY=0
    DEAL_TYPE_SELL=1
    POSITION_TYPE_BUY=0
    POSITION_TYPE_SELL=1
    ORDER_TYPE_BUY=0
    ORDER_TYPE_SELL=1
    ORDER_FILLING_FOK=0
    ORDER_FILLING_IOC=1
    ORDER_TIME_GTC=0
    TRADE_ACTION_DEAL=1
    TRADE_RETCODE_DONE=10009
    TIMEFRAME_M5=5
    def __init__(self, now):
        self.now=now
        self.sent=[]
        self.account=O(trade_mode=0, server='HFMarketsGlobal-Demo', company='HF Markets',login=123,
                       trade_allowed=True, trade_expert=True, margin_mode=2, balance=10000, equity=10000, margin_free=10000)
        self.info=O(visible=True,trade_mode=4,trade_tick_size=.01,point=.01,trade_stops_level=0,
                    volume_min=.01,volume_max=10,volume_step=.01,filling_mode=2)
        self.tick=O(bid=2004.0,ask=2004.2,time=now.timestamp())
        self.positions=[];self.pending=[];self.history=[];self.send_ret=10009
    def account_info(self): return self.account
    def terminal_info(self): return O(connected=True,trade_allowed=True)
    def symbol_info(self,s): return self.info
    def symbol_select(self,s,v): return True
    def symbol_info_tick(self,s): return self.tick
    def positions_get(self): return tuple(self.positions)
    def orders_get(self): return tuple(self.pending)
    def history_deals_get(self,*args,**kwargs):
        if 'position' in kwargs: return (O(commission=-.1,fee=0),)
        return self.history
    def order_calc_profit(self,side,sym,vol,price,stop): return (stop-price)*100*vol if side == 0 else (price-stop)*100*vol
    def order_calc_margin(self,*args): return 100
    def order_check(self,req): return O(retcode=0)
    def order_send(self,req): self.sent.append(req); return O(retcode=self.send_ret)
    def copy_rates_range(self,sym,tf,start,end):
        values=[(2000,1990,1995),(2002,1991,1999),(2001,1992,1998),(2005,1995,2003)]
        return [{k:Cell(v) for k,v in {'time':int((start+dt.timedelta(minutes=5*i)).timestamp()),'high':high,'low':low,'close':close}.items()} for i,(high,low,close) in enumerate(values)]

class Tests(unittest.TestCase):
    def setUp(self):
        self.now=dt.datetime(2026,11,16,14,50,5,tzinfo=UTC)
        self.m=FakeMT5(self.now)
        self.s=sqlite3.connect(':memory:')
        self.s.execute('CREATE TABLE intents(account TEXT, marker TEXT, state TEXT, PRIMARY KEY(account,marker))')
    def tearDown(self): self.s.close()
    def cycle(self): return run_cycle(self.m,'XAUUSD',self.s,self.now)
    def test_real_account_blocked_before_order(self):
        self.m.account.trade_mode=2
        with self.assertRaises(Blocked): self.cycle()
        self.assertEqual(self.m.sent,[])
    def test_netting_account_blocked(self):
        self.m.account.margin_mode=0
        with self.assertRaises(Blocked): self.cycle()
        self.assertEqual(self.m.sent,[])
    def test_volume_never_rounds_above_risk(self):
        self.assertEqual(volume_for_risk(50,920,self.m.info),.05)
        with self.assertRaises(Blocked): volume_for_risk(1,920,self.m.info)
    def test_send_demo_once_for_bar(self):
        self.assertIn('diterima',self.cycle());self.assertEqual(len(self.m.sent),1)
        self.assertEqual(self.m.sent[0]['volume'],.06)
        self.assertLess(self.m.sent[0]['sl'], self.m.sent[0]['price'])
        self.assertGreater(self.m.sent[0]['tp'], self.m.sent[0]['price'])
        self.assertIn('sudah diproses',self.cycle());self.assertEqual(len(self.m.sent),1)
    def test_closes_owned_profitable_position(self):
        p=O(ticket=42,symbol='XAUUSD',magic=MAGIC,type=0,profit=3.0,swap=0,volume=.01)
        close_profitable(self.m,identity(self.m.account),self.s,[p],'XAUUSD',self.now)
        self.assertEqual(len(self.m.sent),1)
        self.assertEqual(self.m.sent[0]['type'],self.m.ORDER_TYPE_SELL)
        self.assertEqual(self.m.sent[0]['position'],42)
    def test_does_not_close_other_users_positions_or_small_profit(self):
        p=O(ticket=42,symbol='XAUUSD',magic=0,type=0,profit=3,swap=0,volume=.01)
        q=O(ticket=43,symbol='XAUUSD',magic=MAGIC,type=0,profit=.1,swap=0,volume=.01)
        close_profitable(self.m,identity(self.m.account),self.s,[p,q],'XAUUSD',self.now)
        self.assertEqual(self.m.sent,[])
    def test_stale_data_blocks(self):
        self.m.tick.time -= 30
        with self.assertRaises(Blocked):self.cycle()
        self.assertEqual(self.m.sent,[])
    def test_daily_loss_blocks(self):
        self.m.account.equity=9899
        with self.assertRaises(Blocked):self.cycle()
        self.assertEqual(self.m.sent,[])
    def test_unknown_order_result_locks(self):
        self.m.send_ret=10010
        with self.assertRaises(Blocked):self.cycle()
        with self.assertRaises(Blocked):self.cycle()
        self.assertEqual(len(self.m.sent),1)
    def test_pending_orders_prevent_new_entries(self):
        self.m.pending=[O(ticket=7)]
        with self.assertRaises(Blocked): self.cycle()
        self.assertEqual(self.m.sent,[])
    def test_risk_with_no_stop_blocks(self):
        self.m.positions=[O(sl=0, symbol='XAUUSD', magic=0, type=0)]
        with self.assertRaises(Blocked):self.cycle()
        self.assertEqual(self.m.sent,[])

if __name__=='__main__': unittest.main()
