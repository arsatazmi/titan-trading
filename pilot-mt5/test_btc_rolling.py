"""Offline only: BTC M5 rolling-range and fail-closed tests."""
import datetime as dt
import unittest
from btc_rolling import evaluate, required_window, UTC

class RollingTests(unittest.TestCase):
    def setUp(self):
        self.now=dt.datetime(2026,11,15,0,2,0,tzinfo=UTC)
        self.start,self.last=required_window(self.now)
        self.bars=[{'time':(self.start+dt.timedelta(minutes=5*i)).timestamp(), 'high':110, 'low':90, 'close':100} for i in range(12)]
        self.bars.append({'time':self.last.timestamp(),'high':114,'low':105,'close':112})
    def test_crosses_midnight_and_weekend(self):
        self.assertEqual(self.start,dt.datetime(2026,11,14,22,55,tzinfo=UTC))
        self.assertEqual(evaluate(self.bars,self.now)['status'],'breakout_observed')
    def test_only_previous_12_high_used(self):
        s=evaluate(self.bars,self.now);self.assertEqual(s['range_high'],110);self.assertEqual(s['range_low'],90)
    def test_equal_or_lower_close_is_not_breakout(self):
        self.bars[-1]['close']=110
        self.assertEqual(evaluate(self.bars,self.now)['status'],'waiting')
    def test_incomplete_candle_ignored(self):
        self.bars.append({'time':self.last.timestamp()+300,'high':1000,'low':1,'close':999})
        self.assertEqual(evaluate(self.bars,self.now)['status'],'breakout_observed')
    def test_gap_duplicate_nan_and_invalid_candle_fail_closed(self):
        self.assertEqual(evaluate(self.bars[1:],self.now)['status'],'no_data')
        self.assertEqual(evaluate(self.bars+[self.bars[0]],self.now)['status'],'no_data')
        self.bars[1]['high']=float('nan');self.assertEqual(evaluate(self.bars,self.now)['status'],'no_data')
        self.bars[1]['high']=1;self.assertEqual(evaluate(self.bars,self.now)['status'],'no_data')
    def test_exact_boundary_and_naive(self):
        start,last=required_window(dt.datetime(2026,11,16,12,0,tzinfo=UTC))
        self.assertEqual(last,dt.datetime(2026,11,16,11,55,tzinfo=UTC))
        with self.assertRaises(ValueError):required_window(dt.datetime(2026,11,16))

if __name__=='__main__':unittest.main()
