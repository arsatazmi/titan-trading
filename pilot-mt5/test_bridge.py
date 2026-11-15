import unittest
from types import SimpleNamespace as NS
import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import patch
import json
import sys
import bridge
import bot

class FakeMT5:
    ACCOUNT_TRADE_MODE_DEMO=0
    ACCOUNT_MARGIN_MODE_RETAIL_HEDGING=2
    def __init__(self,mode=0):
        self.account=NS(trade_mode=mode,margin_mode=2,trade_allowed=True,trade_expert=True,company='HF Markets',server='HFM-Demo',login=123,balance=1000,equity=999)
    def account_info(self): return self.account
    def terminal_info(self): return NS(connected=True,trade_allowed=True)
    def positions_get(self): return []
    def symbol_info_tick(self, symbol): return NS(bid=100,ask=101,time=__import__('time').time())

class BridgeTests(unittest.TestCase):
    def test_demo_snapshot_does_not_send_identity(self):
        st,a=bridge.snapshot(FakeMT5(),False,'stopped')
        self.assertTrue(st['demo']); self.assertTrue(st['ready']); self.assertFalse(st['enabled']);self.assertNotIn('login',st);self.assertNotIn('server',st)
    def test_future_btc_quote_is_not_ready(self):
        fake=FakeMT5()
        fake.symbol_info_tick=lambda symbol:NS(bid=100,ask=101,time=__import__('time').time()+7200)
        st,_=bridge.snapshot(fake,True,'stopped')
        self.assertFalse(st['quoteOkBtc'])

    def test_live_account_blocked_and_balance_not_sent(self):
        st,a=bridge.snapshot(FakeMT5(mode=2),True,'stopped')
        self.assertFalse(st['demo']);self.assertFalse(st['ready']);self.assertIsNone(a);self.assertNotIn('balance',st)
    def test_account_change_blocked(self):
        state=sqlite3.connect(':memory:');state.execute('CREATE TABLE bridge_meta (key TEXT PRIMARY KEY,value TEXT)')
        a=FakeMT5().account; bridge.bind_account(state,a);bridge.bind_account(state,a)
        a.login=456
        with self.assertRaises(bot.Blocked):bridge.bind_account(state,a)
    def test_switching_while_other_bot_position_open_is_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            d=Path(tmp); config=d/'device.json';config.write_text(json.dumps({'deviceId':'a'*32,'secret':'b'*64}))
            fake=FakeMT5();fake.initialize=lambda **kw: True;fake.shutdown=lambda:None
            fake.positions_get=lambda: [NS(magic=bot.MAGIC,symbol='XAUUSD')]
            def hb(credentials,status,url=bridge.URL,boot=False):
                return {'ok':True,'run':not boot,'leaseMs':30000,'symbol':'#BTCUSD'}
            with patch.object(bridge,'BASE',d),patch.object(bridge,'CONFIG',config),patch.dict(sys.modules,{'MetaTrader5':fake}),patch.object(sys,'argv',['bridge.py','--enable-demo-trading']),patch.object(bridge,'heartbeat',side_effect=hb),patch.object(bridge.time,'sleep',side_effect=[None,KeyboardInterrupt()]),patch.object(bot,'run_cycle') as cycle:
                bridge.main()
                cycle.assert_not_called()

    def test_invalid_remote_symbol_is_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            d=Path(tmp); config=d/'device.json';config.write_text(json.dumps({'deviceId':'a'*32,'secret':'b'*64}))
            fake=FakeMT5();fake.initialize=lambda **kw: True;fake.shutdown=lambda:None
            def hb(credentials,status,url=bridge.URL,boot=False):
                return {'ok':True,'run':not boot,'leaseMs':30000,'symbol':'UNSUPPORTED'}
            with patch.object(bridge,'BASE',d),patch.object(bridge,'CONFIG',config),patch.dict(sys.modules,{'MetaTrader5':fake}),patch.object(sys,'argv',['bridge.py','--enable-demo-trading']),patch.object(bridge,'heartbeat',side_effect=hb),patch.object(bridge.time,'sleep',side_effect=[None,KeyboardInterrupt()]),patch.object(bot,'run_cycle') as cycle:
                bridge.main()
                cycle.assert_not_called()

    def test_nonfinite_values(self):
        self.assertIsNone(bridge.number(float('nan')));self.assertIsNone(bridge.number(float('inf')))
    def test_loop_orders_need_local_optin_and_lease(self):
        for enabled in (False, True):
            with self.subTest(enabled=enabled), tempfile.TemporaryDirectory() as tmp:
                d=Path(tmp); config=d/'device.json';config.write_text(json.dumps({'deviceId':'a'*32,'secret':'b'*64}))
                fake=FakeMT5();fake.initialize=lambda **kw: True;fake.shutdown=lambda:None
                calls=[]
                def hb(credentials,status,url=bridge.URL,boot=False):
                    calls.append(boot)
                    return {'ok':True,'run':not boot,'leaseMs':30000,'symbol':'#BTCUSD'}
                args=['bridge.py']+(['--enable-demo-trading'] if enabled else [])
                with patch.object(bridge,'BASE',d),patch.object(bridge,'CONFIG',config),patch.dict(sys.modules,{'MetaTrader5':fake}),patch.object(sys,'argv',args),patch.object(bridge,'heartbeat',side_effect=hb),patch.object(bridge.time,'sleep',side_effect=[None,KeyboardInterrupt()]),patch.object(bot,'run_cycle',return_value='mock') as cycle:
                    bridge.main()
                    self.assertEqual(calls,[True,False]);self.assertEqual(cycle.call_count, 1 if enabled else 0)
                    if enabled: self.assertEqual(cycle.call_args.args[1], '#BTCUSD')
                    self.assertFalse((d/'bot.lock').exists())


if __name__=='__main__':unittest.main()
