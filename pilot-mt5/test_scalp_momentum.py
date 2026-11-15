"""No-broker tests for experimental tick signal. No order integration."""
import unittest
from datetime import datetime,timedelta,timezone
from scalp_momentum import TickMomentum

class TickMomentumTests(unittest.TestCase):
    def setUp(self):
        self.base=datetime(2026,11,15,0,0,tzinfo=timezone.utc);self.s=TickMomentum()
    def feed(self,step=.10,spread=.10):
        for i in range(11):self.s.add(self.base+timedelta(seconds=i),100+i*step,100+i*step+spread)
    def test_buy_signal_based_on_ticks_not_candles(self):
        self.feed();s=self.s.signal(self.base+timedelta(seconds=10),.01);self.assertEqual(s['status'],'long_signal')
    def test_flat_and_down_do_not_trigger(self):
        for move in (0,-.1):
            with self.subTest(move=move):
                self.s=TickMomentum();self.feed(move)
                self.assertEqual(self.s.signal(self.base+timedelta(seconds=10),.01)['status'],'waiting')
    def test_spread_blocks_small_movement(self):
        self.feed(.02,.15);self.assertEqual(self.s.signal(self.base+timedelta(seconds=10),.01)['status'],'waiting')
    def test_stale_or_future_quotes_block(self):
        self.feed();self.assertEqual(self.s.signal(self.base+timedelta(seconds=13),.01)['status'],'no_data')
        self.assertEqual(self.s.signal(self.base+timedelta(seconds=9),.01)['status'],'no_data')
    def test_gap_blocks(self):
        for i in (0,1,2,7,8,9,10):self.s.add(self.base+timedelta(seconds=i),100+i,100+i+.1)
        self.assertEqual(self.s.signal(self.base+timedelta(seconds=10),.01)['status'],'no_data')
    def test_duplicate_and_reverse_order(self):
        self.feed();self.assertFalse(self.s.add(self.base+timedelta(seconds=10),200,201))
        self.assertFalse(self.s.add(self.base,100,101));self.assertEqual(self.s.signal(self.base,.01)['status'],'waiting')
    def test_invalid_quote_clears(self):
        self.feed();self.assertFalse(self.s.add(self.base+timedelta(seconds=11),float('nan'),101))
        self.assertEqual(self.s.signal(self.base+timedelta(seconds=11),.01)['status'],'waiting')
    def test_insufficient_quote_history(self):
        self.s.add(self.base,100,101);self.assertEqual(self.s.signal(self.base,.01)['status'],'waiting')
    def test_invalid_tick_size(self):
        self.feed();self.assertEqual(self.s.signal(self.base+timedelta(seconds=10),0)['status'],'no_data')
    def test_no_naive_datetimes(self):
        self.assertFalse(self.s.add(datetime(2026,1,1),100,101))
        self.assertEqual(self.s.signal(datetime(2026,1,1),.01)['status'],'no_data')

if __name__=='__main__':unittest.main()
