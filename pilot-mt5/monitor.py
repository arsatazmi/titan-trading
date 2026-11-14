#!/usr/bin/env python3
"""MT5 demo monitor. Read-only, no trading. ORB concept from day-trader-skill."""
import argparse
import datetime as dt
import json
import math
import time
from zoneinfo import ZoneInfo

UTC = dt.timezone.utc
NY = ZoneInfo('America/New_York')
INTERVAL = 300


def analyze(bars, now):
    """Analyze completed M5 bars from 09:30 NY; fail closed on gaps."""
    now = now.astimezone(UTC)
    local = now.astimezone(NY)
    start = dt.datetime.combine(local.date(), dt.time(9, 30), tzinfo=NY).astimezone(UTC)
    seconds = (now - start).total_seconds()
    if seconds < 900:
        return {'status': 'waiting', 'reason': 'Opening range 09:30–09:45 New York belum selesai'}
    if seconds >= 6 * 3600:
        return {'status': 'closed', 'reason': 'Jendela pengamatan contoh berakhir (15:30 New York)'}
    last_start = start + dt.timedelta(seconds=(int(seconds // INTERVAL) - 1) * INTERVAL)
    by_time = {}
    for b in bars:
        t = int(b['time'])
        if t in by_time:
            return {'status': 'no_data', 'reason': 'Candle duplikat'}
        by_time[t] = b
    needed = list(range(int(start.timestamp()), int(last_start.timestamp()) + 1, INTERVAL))
    if any(ts not in by_time for ts in needed):
        return {'status': 'no_data', 'reason': 'Candle M5 sesi tidak lengkap; tidak ada sinyal'}
    for t in needed:
        b = by_time[t]
        vals = [float(b[x]) for x in ('high', 'low', 'close')]
        if not all(math.isfinite(v) and v > 0 for v in vals) or vals[1] > vals[2] or vals[2] > vals[0]:
            return {'status': 'no_data', 'reason': 'Data candle tidak valid'}
    opening = [by_time[t] for t in needed[:3]]
    high = max(float(x['high']) for x in opening)
    low = min(float(x['low']) for x in opening)
    if high <= low:
        return {'status': 'no_data', 'reason': 'Range tidak valid'}
    result = {'status': 'waiting', 'session_start_utc': start.isoformat(), 'range_high': high, 'range_low': low,
              'last_close': float(by_time[needed[-1]]['close']), 'last_bar_utc': dt.datetime.fromtimestamp(needed[-1], UTC).isoformat()}
    # Upstream trader-entry is long only: first completed close above the range high.
    for t in needed[3:]:
        close = float(by_time[t]['close'])
        if close > high:
            result.update({'status': 'breakout_observed', 'first_break_close': close,
                           'first_break_bar_utc': dt.datetime.fromtimestamp(t, UTC).isoformat()})
            break
    return result


def main():
    p = argparse.ArgumentParser(description='Read-only HFM MT5 demo monitor; tidak mengirim order')
    p.add_argument('--symbol', default='XAUUSD', help='Nama simbol persis di Market Watch HFM')
    p.add_argument('--terminal', default=None, help='Opsional: path terminal64.exe')
    p.add_argument('--interval', type=int, default=15, help='Interval polling detik (min 5)')
    args = p.parse_args()
    if args.interval < 5:
        p.error('--interval minimal 5 detik')
    try:
        import MetaTrader5 as mt5
    except ImportError:
        p.exit(1, 'MetaTrader5 belum terpasang. Ikuti README.\n')
    connected = mt5.initialize(path=args.terminal) if args.terminal else mt5.initialize()
    if not connected:
        p.exit(1, 'Gagal tersambung ke terminal MT5: %s\n' % (mt5.last_error(),))
    try:
        print('READ-ONLY | akun DEMO saja | tidak ada order | Ctrl+C untuk berhenti', flush=True)
        while True:
            account = mt5.account_info()
            if account is None:
                print(json.dumps({'status': 'disconnected', 'reason': 'Akun terminal tidak terhubung'}), flush=True)
                time.sleep(args.interval)
                continue
            if account.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO:
                p.exit(1, 'DIBLOKIR: terminal bukan akun demo. Versi ini tidak mendukung akun real.\n')
            terminal = mt5.terminal_info()
            if not terminal or not terminal.connected:
                print(json.dumps({'status': 'disconnected', 'reason': 'Terminal tidak terhubung ke broker'}), flush=True)
                time.sleep(args.interval)
                continue
            info = mt5.symbol_info(args.symbol)
            if info is None:
                p.exit(1, 'Simbol tidak ditemukan. Periksa nama persis di Market Watch.\n')
            if not info.visible and not mt5.symbol_select(args.symbol, True):
                p.exit(1, 'Simbol tidak bisa diaktifkan di Market Watch.\n')
            now = dt.datetime.now(UTC)
            tick = mt5.symbol_info_tick(args.symbol)
            if tick is None or tick.time > now.timestamp() + 5 or now.timestamp() - tick.time > 120 or tick.bid <= 0 or tick.ask < tick.bid:
                print(json.dumps({'status': 'no_data', 'reason': 'Quote tidak tersedia atau stale (>120 detik)'}), flush=True)
                time.sleep(args.interval)
                continue
            local = now.astimezone(NY)
            start = dt.datetime.combine(local.date(), dt.time(9, 30), tzinfo=NY).astimezone(UTC)
            if now < start:
                result = analyze([], now)
            else:
                rates = mt5.copy_rates_range(args.symbol, mt5.TIMEFRAME_M5, start, now)
                if rates is None:
                    result = {'status': 'no_data', 'reason': 'MT5 gagal membaca candle'}
                else:
                    bars = [{k: row[k].item() for k in ('time', 'high', 'low', 'close')} for row in rates]
                    result = analyze(bars, now)
            result.update({'symbol': args.symbol, 'broker': 'MT5 connected demo', 'bid': tick.bid, 'ask': tick.ask,
                           'quote_utc': dt.datetime.fromtimestamp(tick.time, UTC).isoformat(),
                           'news_status': 'tidak tersedia — belum ada sumber kalender ekonomi',
                           'mode': 'read_only_demo', 'execution': 'disabled'})
            print(json.dumps(result, ensure_ascii=False), flush=True)
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print('\nMonitor dihentikan.')
    finally:
        mt5.shutdown()

if __name__ == '__main__':
    main()
