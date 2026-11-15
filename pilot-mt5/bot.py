#!/usr/bin/env python3
"""Experimental MT5 DEMO bot. Disabled by default. Never supports real accounts.

Uses a modified trader-entry opening-range idea, not the upstream skill's
US-stock sizing, news, or broker implementation. Requires independent broker
verification and demo testing. No return/profit is guaranteed.
"""
import argparse
import datetime as dt
from decimal import Decimal, ROUND_FLOOR
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import sys
import time

from monitor import analyze, UTC, NY

MAGIC = 73657151
MAX_POSITIONS = 20
PER_ORDER = 0.005
TOTAL_RISK = 0.01
DAILY_LOSS = 0.01
STALE_SECONDS = 20

class Blocked(Exception):
    pass


def number(value):
    v = float(value)
    if not math.isfinite(v):
        raise Blocked('angka tidak valid')
    return v


def floor_step(value, step):
    if step <= 0:
        raise Blocked('ukuran langkah simbol tidak valid')
    v, s = Decimal(str(value)), Decimal(str(step))
    return float((v / s).to_integral_value(rounding=ROUND_FLOOR) * s)


def volume_for_risk(limit, loss_per_lot, info):
    """Floor volume; never round up to the broker minimum."""
    limit, loss_per_lot = number(limit), number(loss_per_lot)
    lo, hi, step = number(info.volume_min), number(info.volume_max), number(info.volume_step)
    if limit <= 0 or loss_per_lot <= 0 or lo <= 0 or hi < lo or step <= 0:
        raise Blocked('parameter risiko/volume tidak valid')
    volume = floor_step(min(limit / loss_per_lot, hi), step)
    if volume < lo:
        raise Blocked('lot minimum melebihi anggaran risiko')
    return volume


def identity(account):
    return hashlib.sha256((str(account.server) + ':' + str(account.login)).encode()).hexdigest()


def demo_only(mt5, account):
    if account is None or account.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO:
        raise Blocked('terminal bukan akun demo; eksekusi diblokir')
    if getattr(account, 'margin_mode', None) != getattr(mt5, 'ACCOUNT_MARGIN_MODE_RETAIL_HEDGING', 2):
        raise Blocked('akun bukan mode hedging; beberapa posisi tidak aman dipisahkan')
    terminal = mt5.terminal_info()
    if not terminal or not terminal.connected:
        raise Blocked('terminal tidak terhubung ke broker')
    if not account.trade_allowed or not account.trade_expert or not terminal.trade_allowed:
        raise Blocked('trading otomatis tidak diizinkan oleh terminal/akun')
    name = ''.join(c for c in (str(account.company) + str(account.server)).lower() if c.isalnum())
    if not any(x in name for x in ('hfmarkets', 'hfmarket', 'hfm', 'hotforex')):
        raise Blocked('broker HFM tidak dikenali; hentikan dan cek server')


def fresh_tick(mt5, symbol, now):
    tick = mt5.symbol_info_tick(symbol)
    if not tick or not all(math.isfinite(float(v)) for v in (tick.bid, tick.ask, tick.time)):
        raise Blocked('quote tidak tersedia')
    age = now.timestamp() - tick.time
    if age < -5 or age > STALE_SECONDS or tick.bid <= 0 or tick.ask < tick.bid:
        raise Blocked('quote stale atau tidak valid')
    return tick


def daily_baseline(mt5, account, now):
    local = now.astimezone(NY)
    start = dt.datetime.combine(local.date(), dt.time.min, tzinfo=NY).astimezone(UTC)
    deals = mt5.history_deals_get(start, now)
    if deals is None:
        raise Blocked('riwayat harian tidak tersedia')
    total = 0.0
    for deal in deals:
        # Non-trade cash adjustments make the reconstructed baseline ambiguous.
        if deal.type not in (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL):
            raise Blocked('ada penyesuaian saldo hari ini; batas harian tidak dapat dipastikan')
        total += sum(number(getattr(deal, key, 0)) for key in ('profit', 'commission', 'swap', 'fee'))
    base = number(account.balance) - total
    if base <= 0:
        raise Blocked('saldo awal hari tidak valid')
    return base, deals


def exposure_risk(mt5, positions, now):
    """Conservative risk to stops from entry OR current quote across account."""
    result = 0.0
    for pos in positions:
        if number(pos.sl) <= 0:
            raise Blocked('ada posisi tanpa stop loss; order baru diblokir')
        tick = fresh_tick(mt5, pos.symbol, now)
        if pos.type == mt5.POSITION_TYPE_BUY:
            side, cur = mt5.ORDER_TYPE_BUY, tick.bid
        elif pos.type == mt5.POSITION_TYPE_SELL:
            side, cur = mt5.ORDER_TYPE_SELL, tick.ask
        else:
            raise Blocked('jenis posisi tidak dikenal')
        risks = []
        for price in (pos.price_open, cur):
            value = mt5.order_calc_profit(side, pos.symbol, pos.volume, price, pos.sl)
            if value is None:
                raise Blocked('risiko posisi tidak dapat dihitung')
            risks.append(max(0.0, -number(value)))
        result += max(risks)
    return result


def filling(mt5, info):
    # MQL5 SYMBOL_FILLING_FOK = 1, SYMBOL_FILLING_IOC = 2.
    flags = int(info.filling_mode)
    if flags & 2:
        return mt5.ORDER_FILLING_IOC
    if flags & 1:
        return mt5.ORDER_FILLING_FOK
    raise Blocked('mode pengisian FOK/IOC tidak tersedia; butuh pengecekan broker')


def send_checked(mt5, request, account_key, state, marker):
    # Recheck immediately before every order including exits.
    current = mt5.account_info()
    demo_only(mt5, current)
    if identity(current) != account_key:
        raise Blocked('akun berubah; perintah diblokir')
    check = mt5.order_check(request)
    if check is None or check.retcode != 0:
        raise Blocked('pemeriksaan order ditolak; tidak dikirim')
    # Record intent BEFORE sending. An interrupted call permanently halts this
    # account until reviewed: it is unsafe to guess whether the broker filled it.
    state.execute('INSERT INTO intents(account, marker, state) VALUES (?, ?, ?)', (account_key, marker, 'uncertain'))
    state.commit()
    try:
        result = mt5.order_send(request)
    except Exception:
        raise Blocked('hasil order tidak pasti; bot dikunci sampai ditinjau')
    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        raise Blocked('order gagal/parsial/tidak pasti; bot dikunci sampai ditinjau')
    state.execute('UPDATE intents SET state=? WHERE account=? AND marker=?', ('done', account_key, marker))
    state.commit()
    return result


def close_profitable(mt5, account_key, state, positions, symbol, now):
    # Only manage positions belonging to this bot. There is no guarantee that
    # profit survives the exit fill, extra commissions, or slippage.
    for pos in positions:
        if pos.symbol != symbol or pos.magic != MAGIC or pos.type != mt5.POSITION_TYPE_BUY:
            continue
        deals = mt5.history_deals_get(position=pos.ticket)
        if deals is None or not deals:
            continue
        costs = sum(number(getattr(d, 'commission', 0)) + number(getattr(d, 'fee', 0)) for d in deals)
        estimated_exit = max(0.0, -costs)
        estimate = number(pos.profit) + number(pos.swap) + costs - estimated_exit
        if estimate <= 0:
            continue
        tick = fresh_tick(mt5, symbol, now)
        info = mt5.symbol_info(symbol)
        if not info:
            raise Blocked('informasi simbol tidak tersedia')
        marker = 'close:' + str(pos.ticket)
        if state.execute('SELECT 1 FROM intents WHERE account=? AND marker=?', (account_key, marker)).fetchone():
            continue
        request = {'action': mt5.TRADE_ACTION_DEAL, 'symbol': symbol, 'volume': float(pos.volume),
                   'type': mt5.ORDER_TYPE_SELL, 'position': int(pos.ticket), 'price': float(tick.bid),
                   'deviation': 10, 'magic': MAGIC, 'comment': 'demo-close',
                   'type_time': mt5.ORDER_TIME_GTC, 'type_filling': filling(mt5, info)}
        send_checked(mt5, request, account_key, state, marker)
        print('Permintaan penutupan posisi demo selesai; hasil aktual bisa berbeda.', flush=True)


def run_cycle(mt5, symbol, state, now):
    account = mt5.account_info()
    demo_only(mt5, account)
    account_key = identity(account)
    if state.execute('SELECT 1 FROM intents WHERE account=? AND state=? LIMIT 1', (account_key, 'uncertain')).fetchone():
        raise Blocked('ada order yang hasilnya tidak pasti; periksa riwayat broker dan hentikan bot')
    info = mt5.symbol_info(symbol)
    if not info:
        raise Blocked('simbol tidak ditemukan di MT5')
    if not info.visible and not mt5.symbol_select(symbol, True):
        raise Blocked('gagal mengaktifkan simbol')
    positions = mt5.positions_get()
    if positions is None:
        raise Blocked('daftar posisi tidak tersedia')
    close_profitable(mt5, account_key, state, positions, symbol, now)
    # Refresh account and positions after a close before considering entry.
    account = mt5.account_info()
    demo_only(mt5, account)
    if identity(account) != account_key:
        raise Blocked('akun berubah')
    positions = mt5.positions_get()
    orders = mt5.orders_get()
    if positions is None or orders is None:
        raise Blocked('posisi atau pending order tidak dapat dibaca')
    if orders:
        raise Blocked('ada pending order di akun; order baru diblokir')
    if len(positions) >= MAX_POSITIONS:
        raise Blocked('batas maksimal 20 posisi tercapai')
    baseline, _ = daily_baseline(mt5, account, now)
    equity = number(account.equity)
    if equity <= baseline * (1 - DAILY_LOSS):
        raise Blocked('batas rugi harian 1% tercapai; order baru dihentikan')
    tick = fresh_tick(mt5, symbol, now)
    start = dt.datetime.combine(now.astimezone(NY).date(), dt.time(9,30), tzinfo=NY).astimezone(UTC)
    if now < start:
        return 'Menunggu sesi New York'
    bars = mt5.copy_rates_range(symbol, mt5.TIMEFRAME_M5, start, now)
    if bars is None:
        raise Blocked('candle tidak tersedia')
    rows = [{k: row[k].item() for k in ('time','high','low','close')} for row in bars]
    signal = analyze(rows, now)
    if signal.get('status') != 'breakout_observed' or signal['last_close'] <= signal['range_high']:
        return 'Menunggu candle close di atas opening range'
    bar = dt.datetime.fromisoformat(signal['last_bar_utc'])
    if not 0 <= (now - (bar + dt.timedelta(minutes=5))).total_seconds() <= 60:
        return 'Sinyal terlalu lama; menunggu candle berikutnya'
    # Preserve legacy XAU intent keys; namespace BTC to avoid cross-symbol collisions.
    marker = ('entry:' if symbol == 'XAUUSD' else 'entry:' + symbol + ':') + bar.isoformat()
    if state.execute('SELECT 1 FROM intents WHERE account=? AND marker=?', (account_key, marker)).fetchone():
        return 'Candle ini sudah diproses'
    if int(info.trade_mode) not in (mt5.SYMBOL_TRADE_MODE_FULL, mt5.SYMBOL_TRADE_MODE_LONGONLY):
        raise Blocked('simbol tidak diizinkan untuk buy')
    step = number(info.trade_tick_size)
    stop = floor_step((number(signal['range_high']) + number(signal['range_low'])) / 2, step)
    price = number(tick.ask)
    if stop <= 0 or stop >= price:
        raise Blocked('stop loss tidak valid')
    # Keep spread small relative to planned stop; reject rather than silently widen risk.
    if tick.ask - tick.bid > 0.10 * (price - stop):
        raise Blocked('spread terlalu lebar untuk risiko')
    minimum = number(info.trade_stops_level) * number(info.point)
    if tick.bid - stop < minimum:
        raise Blocked('stop loss terlalu dekat menurut ketentuan broker')
    target = floor_step(price + 2 * (price - stop), step)
    if target - tick.bid < minimum:
        raise Blocked('take profit terlalu dekat menurut ketentuan broker')
    per_lot = mt5.order_calc_profit(mt5.ORDER_TYPE_BUY, symbol, 1.0, price, stop)
    if per_lot is None or number(per_lot) >= 0:
        raise Blocked('risiko lot tidak dapat dihitung')
    open_risk = exposure_risk(mt5, positions, now)
    total_budget = min(number(account.balance) * TOTAL_RISK, max(0.0, equity - baseline * (1 - DAILY_LOSS)))
    remaining = total_budget - open_risk
    limit = min(number(account.balance) * PER_ORDER, remaining)
    volume = volume_for_risk(limit, -number(per_lot), info)
    margin = mt5.order_calc_margin(mt5.ORDER_TYPE_BUY, symbol, volume, price)
    if margin is None or number(margin) > number(account.margin_free) * 0.95:
        raise Blocked('margin bebas tidak cukup')
    request = {'action': mt5.TRADE_ACTION_DEAL, 'symbol': symbol, 'volume': volume,
               'type': mt5.ORDER_TYPE_BUY, 'price': price, 'sl': stop, 'tp': target,
               'deviation': 10, 'magic': MAGIC, 'comment': 'demo-orb',
               'type_time': mt5.ORDER_TIME_GTC, 'type_filling': filling(mt5, info)}
    send_checked(mt5, request, account_key, state, marker)
    return 'Order BUY demo diterima; risiko dan hasil aktual dapat berbeda'


def main():
    p = argparse.ArgumentParser(description='Eksperimen bot HFM MT5 akun DEMO saja')
    p.add_argument('--symbol', default='XAUUSD')
    p.add_argument('--terminal', default=None)
    p.add_argument('--enable-demo-trading', action='store_true', help='Izinkan order DEMO setelah pengujian')
    args = p.parse_args()
    if not args.enable_demo_trading:
        p.exit(2, 'Order dinonaktifkan. Baca README dan uji sebelum mengaktifkan.\n')
    try:
        import MetaTrader5 as mt5
    except ImportError:
        p.exit(1, 'Instal dependensi sesuai README.\n')
    # Never permit two processes on the same machine. A crash may leave a lock;
    # reconciliation is required before manual removal.
    base = Path(__file__).resolve().parent
    lock = base / 'bot.lock'
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        p.exit(1, 'Bot terkunci/sudah berjalan. Periksa broker sebelum menghapus bot.lock.\n')
    os.close(fd)
    state = None
    try:
        state = sqlite3.connect(base / 'bot-state.sqlite3')
        state.execute('CREATE TABLE IF NOT EXISTS intents (account TEXT NOT NULL, marker TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY (account, marker))')
        state.commit()
        ok = mt5.initialize(path=args.terminal) if args.terminal else mt5.initialize()
        if not ok:
            p.exit(1, 'Gagal konek MT5: %s\n' % (mt5.last_error(),))
        print('PERINGATAN: OTOMATIS DEMO AKTIF. Jangan gunakan akun real. Ctrl+C untuk berhenti.', flush=True)
        while True:
            try:
                print(dt.datetime.now(UTC).isoformat(), run_cycle(mt5, args.symbol, state, dt.datetime.now(UTC)), flush=True)
            except Blocked as e:
                print('DIBLOKIR:', e, flush=True)
            time.sleep(10)
    except KeyboardInterrupt:
        print('\nBot dihentikan. Posisi yang sudah terbuka tidak otomatis ditutup.')
    finally:
        mt5.shutdown()
        if state:
            state.close()
        lock.unlink(missing_ok=True)

if __name__ == '__main__':
    main()
