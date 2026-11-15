"""READ-ONLY experimental tick signal monitor for HFM MT5 demo.

NO orders, NO credentials sent to website. Not connected to active bridge.
The HFM clock model is empirical, not validated for every season or API. This
is research output only; not proof of profitable execution or feed completeness.
"""
import argparse
import datetime as dt
import math
import time
from hfm_clock_research import UTC, ClockWindow, ClockUncertain
from scalp_momentum import TickMomentum

class ShadowError(ValueError):pass

def _value(row, name):
    v=row[name]
    return v.item() if hasattr(v,'item') else v

def assess_window(mt5,symbol,now):
    if symbol != '#BTCUSD': raise ShadowError('monitor ini khusus #BTCUSD demo')
    a=mt5.account_info();t=mt5.terminal_info()
    if not a or a.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO:raise ShadowError('akun bukan demo')
    if not t or not t.connected:raise ShadowError('terminal tidak terhubung')
    brand=''.join(c for c in (str(a.company)+str(a.server)).lower() if c.isalnum())
    if not any(k in brand for k in ('hfmarkets','hfmarket','hfm','hotforex')):raise ShadowError('broker bukan HFM')
    info=mt5.symbol_info(symbol)
    if not info:raise ShadowError('simbol tidak tersedia')
    if not info.visible and not mt5.symbol_select(symbol,True):raise ShadowError('simbol tidak bisa dipilih')
    if now.tzinfo is None or now.utcoffset() is None:raise ShadowError('jam tidak valid')
    now=now.astimezone(UTC)
    w=ClockWindow.candidate(now-dt.timedelta(seconds=12),now+dt.timedelta(seconds=1))
    data=mt5.copy_ticks_range(symbol,w.to_mt5_query(w.start),w.to_mt5_query(w.end),mt5.COPY_TICKS_INFO)
    if data is None:raise ShadowError('gagal membaca tick')
    if len(data)>10000:raise ShadowError('tick terlalu banyak; kelengkapan tidak dapat dipastikan')
    stream=TickMomentum();seen=0;last=None
    for row in data:
        try:
            ms=float(_value(row,'time_msc'))
            if not math.isfinite(ms) or ms<=0:raise ValueError()
            when=w.from_mt5_seconds(ms/1000)
            if when>now:raise ShadowError('tick masa depan')
            if last is not None and when < last:raise ShadowError('urutan tick tidak valid')
            bid,ask=float(_value(row,'bid')),float(_value(row,'ask'))
            if not all(math.isfinite(x) and x>0 for x in (bid,ask)) or ask<bid:raise ShadowError('harga tick tidak valid')
            if stream.add(when,bid,ask):seen+=1
            last=when
        except (KeyError,TypeError,ValueError,OverflowError,OSError) as e:
            raise ShadowError('timestamp atau data tick tidak valid') from e
    result=stream.signal(now,info.trade_tick_size)
    return {'status':result['status'],'reason':result.get('reason','momentum teramati'), 'unique_ticks':seen}

def main():
    p=argparse.ArgumentParser(description='Pantau tick BTC HFM demo tanpa mengirim order')
    p.add_argument('--interval',type=float,default=1.0)
    args=p.parse_args()
    if args.interval<1 or not math.isfinite(args.interval):p.error('interval minimal 1 detik')
    import MetaTrader5 as mt5
    if not mt5.initialize():p.exit(1,'MT5 tidak tersedia; buka terminal demo.\n')
    print('READ-ONLY | momentum tick BTC DEMO | tidak ada order | Ctrl+C berhenti',flush=True)
    try:
        while True:
            try:
                x=assess_window(mt5,'#BTCUSD',dt.datetime.now(UTC))
                print('Sinyal:',x['status'],'|',x['reason'],'| tick:',x['unique_ticks'],flush=True)
            except (ShadowError,ClockUncertain) as e:print('TIDAK ADA SINYAL:',str(e),flush=True)
            time.sleep(args.interval)
    except KeyboardInterrupt:print('\nMonitor berhenti.',flush=True)
    finally:mt5.shutdown()

if __name__=='__main__':main()
