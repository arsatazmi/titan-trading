"""Experimental DEMO-only HFM time conversion for the website bridge.

Model uses HFM's documented winter/summer offsets and a candidate IANA clock;
verified on this user's HFM demo for the November 2026 sample, not all seasons.
Quote, NY-day history and M5 windows fail closed near candidate DST changes or
if data/clock are inconsistent. Not suitable for a real account.
"""
import datetime as dt
from types import SimpleNamespace
import bot
from hfm_clock_research import UTC, ClockWindow, ClockUncertain, candidate_quote_age
from shadow_daily_risk import snapshot, ShadowUncertain


class Cell:
    def __init__(self, value): self.value = value
    def item(self): return self.value


def normalized_tick(mt5, symbol, now):
    tick = mt5.symbol_info_tick(symbol)
    if tick is None: raise bot.Blocked('quote simbol tidak tersedia')
    bid, ask = bot.number(tick.bid), bot.number(tick.ask)
    if bid <= 0 or ask < bid: raise bot.Blocked('harga simbol tidak valid')
    try:
        candidate_quote_age(tick.time, now)
        w = ClockWindow.candidate(now - dt.timedelta(minutes=5), now + dt.timedelta(seconds=5))
        tick_time = w.from_mt5_seconds(tick.time)
    except (ClockUncertain, ValueError, OverflowError, OSError) as e:
        raise bot.Blocked('jam atau kesegaran quote HFM tidak dapat dipastikan: '+str(e))
    return SimpleNamespace(bid=tick.bid, ask=tick.ask, time=tick_time.timestamp())


class DemoClockMT5:
    """Normalize API boundaries and re-check the demo identity before sends."""
    def __init__(self, mt5, account_key, clock=None):
        self._mt5=mt5
        self._account_key=account_key
        self._clock=clock or (lambda: dt.datetime.now(UTC))

    def __getattr__(self, name): return getattr(self._mt5, name)

    def check_demo_account(self):
        account=self._mt5.account_info()
        bot.demo_only(self._mt5,account)
        if bot.identity(account)!=self._account_key:
            raise bot.Blocked('akun MT5 berubah; order diblokir')

    def symbol_info_tick(self, symbol):
        return normalized_tick(self._mt5,symbol,self._clock())

    def history_deals_get(self, *args, **kwargs):
        if not args and set(kwargs)=={'position'}:
            return self._mt5.history_deals_get(**kwargs)
        if len(args)!=2 or kwargs: raise bot.Blocked('bentuk riwayat MT5 tidak didukung')
        try:
            w=ClockWindow.candidate(args[0],args[1])
            rows=self._mt5.history_deals_get(w.to_mt5_query(w.start),w.to_mt5_query(w.end))
            if rows is not None:
                for row in rows: w.from_mt5_seconds(row.time)
            return rows
        except (ClockUncertain,ValueError,OverflowError,OSError) as e:
            raise bot.Blocked('waktu riwayat tidak dapat dipastikan: '+str(e))

    def copy_rates_range(self, symbol, timeframe, start, end):
        try:
            w=ClockWindow.candidate(start,end)
            rows=self._mt5.copy_rates_range(symbol,timeframe,w.to_mt5_query(w.start),w.to_mt5_query(w.end))
            if rows is None:return None
            output=[]
            for row in rows:
                ts=int(w.from_mt5_seconds(row['time'].item()).timestamp())
                output.append({'time':Cell(ts),'high':Cell(row['high'].item()),
                               'low':Cell(row['low'].item()),'close':Cell(row['close'].item())})
            return output
        except (ClockUncertain,ValueError,OverflowError,OSError) as e:
            raise bot.Blocked('waktu candle tidak dapat dipastikan: '+str(e))

    def order_check(self,request):
        self.check_demo_account()
        return self._mt5.order_check(request)

    def order_send(self,request):
        self.check_demo_account()
        return self._mt5.order_send(request)


def run_demo_cycle(mt5,symbol,state,now,clock=None,*,disable_btc_daily_loss=False):
    """For bridge lease + local opt-in only; never accepts non-demo accounts."""
    account=mt5.account_info()
    bot.demo_only(mt5,account)
    key=bot.identity(account)
    # Explicit local opt-in affects BTC demo only. XAU always retains the daily gate.
    if not (disable_btc_daily_loss is True and symbol == '#BTCUSD'):
        try:
            snapshot(mt5,now)
        except (ClockUncertain,ShadowUncertain,ValueError,OverflowError,OSError) as e:
            raise bot.Blocked('batas harian belum dapat diperiksa: '+str(e))
    normalized_tick(mt5,symbol,now)
    proxy=DemoClockMT5(mt5,key,clock=clock)
    proxy.check_demo_account()
    return bot.run_cycle(proxy,symbol,state,now,disable_btc_daily_loss=disable_btc_daily_loss)
