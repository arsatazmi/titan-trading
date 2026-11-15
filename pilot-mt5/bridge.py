#!/usr/bin/env python3
"""Experimental HFM MT5 demo bridge. Orders are disabled without local opt-in."""
import argparse
import datetime as dt
import json
import math
import os
from pathlib import Path
import secrets
import sqlite3
import time
import urllib.error
import urllib.request

import bot
import hfm_demo_clock

BASE = Path(__file__).resolve().parent
CONFIG = BASE / 'bridge-device.json'
URL = 'https://titan-trading-puce.vercel.app/api/pilot/heartbeat'


def setup():
    if CONFIG.exists():
        raise RuntimeError('Perangkat sudah dibuat. Gunakan --show-device; jangan hapus state sembarangan.')
    data = {'deviceId': secrets.token_hex(16), 'secret': secrets.token_hex(32)}
    fd = os.open(CONFIG, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump(data, f)
    show(data)


def show(data):
    print('ID perangkat:', data['deviceId'])
    print('Kunci perangkat:', data['secret'])
    print('Masukkan hanya ke panel admin Titan Trading. Jangan kirim ke chat. Ini bukan password broker.')


def number(x):
    try:
        x = float(x)
        return x if math.isfinite(x) else None
    except (ValueError, TypeError):
        return None


def snapshot(mt5, enabled, state):
    """No broker credentials, server names or account numbers leave the laptop."""
    st = {'connected': False, 'demo': False, 'ready': False, 'enabled': enabled, 'state': state, 'protocol': 3}
    account = mt5.account_info()
    terminal = mt5.terminal_info()
    if not account or not terminal or not terminal.connected:
        return st, None
    st['connected'] = True
    if account.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO:
        return st, None
    st.update(demo=True, balance=number(account.balance), equity=number(account.equity))
    positions = mt5.positions_get()
    st['positions'] = len(positions) if positions is not None else None
    try:
        bot.demo_only(mt5, account)
        st['ready'] = positions is not None
    except bot.Blocked:
        pass
    for key, symbol in (('quoteOkXau','XAUUSD'),('quoteOkBtc','#BTCUSD')):
        try:
            hfm_demo_clock.normalized_tick(mt5, symbol, dt.datetime.now(bot.UTC))
            st[key] = True
        except (bot.Blocked, TypeError, ValueError):
            st[key] = False
    return st, account


def heartbeat(credentials, status, url=URL, boot=False):
    data = json.dumps({**credentials, 'status': status, 'boot': boot}).encode('utf-8')
    request = urllib.request.Request(url, data=data, headers={'Content-Type':'application/json'}, method='POST')
    with urllib.request.urlopen(request, timeout=8) as response:
        data = json.loads(response.read(65536))
    if data.get('ok') is not True or not isinstance(data.get('leaseMs'), (float,int)):
        raise ValueError('Respons server tidak valid')
    return data


def bind_account(state, account):
    account_key = bot.identity(account)
    current = state.execute("SELECT value FROM bridge_meta WHERE key='account'").fetchone()
    if current and current[0] != account_key:
        raise bot.Blocked('akun MT5 berubah; bot berhenti. Periksa akun dan state secara manual')
    if not current:
        state.execute("INSERT INTO bridge_meta(key,value) VALUES('account',?)", (account_key,))
        state.commit()


def main():
    parser=argparse.ArgumentParser(description='Penghubung TITAN HFM MT5 DEMO saja')
    parser.add_argument('--setup', action='store_true')
    parser.add_argument('--show-device', action='store_true')
    parser.add_argument('--symbol', default='XAUUSD', help='Dipertahankan untuk kompatibilitas; simbol order dipilih di website')
    parser.add_argument('--terminal', default=None)
    parser.add_argument('--enable-demo-trading', action='store_true', help='Izinkan order DEMO yang diminta website; default mati')
    args=parser.parse_args()
    if args.setup:
        setup(); return
    if not CONFIG.exists(): parser.exit(1, 'Jalankan dulu bridge.py --setup.\n')
    credentials=json.loads(CONFIG.read_text(encoding='utf-8'))
    if args.show_device: show(credentials); return
    try: import MetaTrader5 as mt5
    except ImportError: parser.exit(1,'Pasang dependensi sesuai README.\n')
    lock=BASE / 'bot.lock'
    try: fd=os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError: parser.exit(1,'Bot terkunci/sudah berjalan. Periksa order dan proses sebelum menghapus lock.\n')
    os.close(fd)
    state_db=None
    try:
        state_db=sqlite3.connect(BASE / 'bot-state.sqlite3')
        state_db.execute('CREATE TABLE IF NOT EXISTS intents (account TEXT NOT NULL, marker TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY (account, marker))')
        state_db.execute('CREATE TABLE IF NOT EXISTS bridge_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
        state_db.commit()
        initialized=mt5.initialize(path=args.terminal) if args.terminal else mt5.initialize()
        if not initialized: parser.exit(1, 'Gagal membuka MT5: %s\n' % (mt5.last_error(),))
        print('Penghubung demo aktif. Izin order lokal:', 'AKTIF' if args.enable_demo_trading else 'MATI (read-only)', flush=True)
        last_state='stopped'
        boot=True
        while True:
            try:
                status, account=snapshot(mt5,args.enable_demo_trading,last_state)
                started=time.monotonic()
                was_boot=boot
                result=heartbeat(credentials,status,boot=was_boot)
                boot=False
                # Conservative: any request delay reduces the server lease.
                remaining=float(result['leaseMs'])/1000 - (time.monotonic()-started)
                run=(not was_boot and result.get('run') is True and remaining > 2 and args.enable_demo_trading and status['ready'] and account is not None)
                if run:
                    symbol=result.get('symbol')
                    if symbol not in ('XAUUSD','#BTCUSD'):
                        raise bot.Blocked('perintah simbol dari website tidak valid')
                    positions=mt5.positions_get()
                    if positions is None:
                        raise bot.Blocked('posisi tidak dapat diperiksa')
                    if any(p.magic == bot.MAGIC and p.symbol != symbol for p in positions):
                        raise bot.Blocked('ada posisi bot pada simbol lain; periksa dan tutup sebelum mengganti')
                    bind_account(state_db,account)
                    print(hfm_demo_clock.run_demo_cycle(mt5,symbol,state_db,dt.datetime.now(bot.UTC)),flush=True)
                    last_state='running'
                else: last_state='stopped'
            except bot.Blocked as e:
                last_state='blocked'; print('DIBLOKIR:',e,flush=True)
            except (urllib.error.URLError,TimeoutError,ValueError,OSError,sqlite3.Error) as e:
                last_state='stopped'; print('Koneksi gagal / berhenti:',type(e).__name__,flush=True)
            time.sleep(10)
    except KeyboardInterrupt:
        print('\nPenghubung berhenti. Posisi yang sudah terbuka tidak otomatis ditutup.')
    finally:
        mt5.shutdown()
        if state_db: state_db.close()
        lock.unlink(missing_ok=True)

if __name__ == '__main__':
    main()
