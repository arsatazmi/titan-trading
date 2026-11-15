import datetime as dt
import unittest
from types import SimpleNamespace as O
from scalp_shadow import assess_window,ShadowError
from hfm_clock_research import UTC,ClockUncertain

class API:
    ACCOUNT_TRADE_MODE_DEMO=0;COPY_TICKS_INFO=1
    def __init__(self,now):
        self.now=now;self.acc=O(trade_mode=0,company='HF Markets',server='HFMarkets-Demo');self.tick_args=None
    def account_info(self):return self.acc
    def terminal_info(self):return O(connected=True)
    def symbol_info(self,s):return O(visible=True,trade_tick_size=.01)
    def copy_ticks_range(self,s,start,end,flags):
        self.tick_args=(s,start,end,flags)
        return [{'time_msc':int((self.now-dt.timedelta(seconds=10-i)+dt.timedelta(hours=2)).timestamp()*1000), 'bid':100+i*.1,'ask':100.1+i*.1} for i in range(11)]
class Tests(unittest.TestCase):
    def setUp(self):self.now=dt.datetime(2026,11,15,0,10,tzinfo=UTC);self.api=API(self.now)
    def test_signal_and_server_query_wall_clock(self):
        r=assess_window(self.api,'#BTCUSD',self.now)
        self.assertEqual(r['status'],'long_signal');self.assertEqual(r['unique_ticks'],11)
        self.assertEqual(self.api.tick_args[1],self.now+dt.timedelta(hours=2,seconds=-12))
    def test_real_and_other_symbol_blocked(self):
        self.api.acc.trade_mode=2
        with self.assertRaises(ShadowError):assess_window(self.api,'#BTCUSD',self.now)
        with self.assertRaises(ShadowError):assess_window(self.api,'XAUUSD',self.now)
    def test_broker_check(self):
        self.api.acc.company='Other';self.api.acc.server='Example'
        with self.assertRaises(ShadowError):assess_window(self.api,'#BTCUSD',self.now)
    def test_no_ticks(self):
        self.api.copy_ticks_range=lambda *a:None
        with self.assertRaises(ShadowError):assess_window(self.api,'#BTCUSD',self.now)
    def test_dst_uncertainty(self):
        now=dt.datetime(2026,10,25,1,0,tzinfo=UTC)
        with self.assertRaises(ClockUncertain):assess_window(self.api,'#BTCUSD',now)
    def test_out_of_order_blocks(self):
        old=self.api.copy_ticks_range
        self.api.copy_ticks_range=lambda *args:list(reversed(old(*args)))
        with self.assertRaises(ShadowError):assess_window(self.api,'#BTCUSD',self.now)
    def test_future_tick_blocks(self):
        self.api.copy_ticks_range=lambda *a:[{'time_msc':int((self.now+dt.timedelta(hours=2, milliseconds=500)).timestamp()*1000),'bid':100,'ask':101}]
        with self.assertRaises(ShadowError):assess_window(self.api,'#BTCUSD',self.now)

if __name__=='__main__':unittest.main()
