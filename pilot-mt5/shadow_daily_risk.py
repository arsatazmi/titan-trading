"""Candidate NY-day P&L reconciliation for experimental DEMO use.

No broker orders, website access, credentials, or account numbers are emitted.
This estimate cannot validate broker history completeness or guarantee a limit.
"""
import datetime as dt
import math
from hfm_clock_research import UTC, ClockWindow, ClockUncertain, ny_day_window


class ShadowUncertain(ValueError):
    pass


def finite(x):
    try: x = float(x)
    except (TypeError, ValueError): raise ShadowUncertain('angka keuangan tidak terbaca')
    if not math.isfinite(x): raise ShadowUncertain('angka keuangan tidak valid')
    return x


def read_identity(a):
    if a is None: raise ShadowUncertain('akun tidak terbaca')
    return (a.login, a.server, finite(a.balance), finite(a.credit))


def snapshot(mt5, now):
    """Research snapshot; agreement of two queries != proof of completeness."""
    if now.tzinfo is None or now.utcoffset() is None:
        raise ShadowUncertain('waktu UTC tidak valid')
    now = now.astimezone(UTC)
    a0 = mt5.account_info()
    if a0 is None or a0.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO:
        raise ShadowUncertain('bukan akun demo')
    id0 = read_identity(a0)
    if abs(id0[3]) > 0.0000001:
        raise ShadowUncertain('akun memiliki credit; baseline belum dapat direkonsiliasi')
    window = ny_day_window(now)
    wide = ClockWindow.candidate(window.start-dt.timedelta(minutes=2), now+dt.timedelta(minutes=2))
    exact = mt5.history_deals_get(window.to_mt5_query(window.start), window.to_mt5_query(now))
    extra = mt5.history_deals_get(wide.to_mt5_query(wide.start), wide.to_mt5_query(wide.end))
    if exact is None or extra is None:
        raise ShadowUncertain('riwayat tidak tersedia')

    def key(d):
        try:
            value = (int(d.ticket), int(d.time))
        except (AttributeError, TypeError, ValueError, OverflowError):
            raise ShadowUncertain('identitas atau waktu deal tidak valid')
        if value[0] <= 0: raise ShadowUncertain('identitas deal tidak valid')
        return value

    start_raw = window.to_mt5_query(window.start).timestamp()
    end_raw = window.to_mt5_query(now).timestamp()
    # Match broker's inclusive endpoints. Report candidate P&L as of query time;
    # overlapping repeated reads do not prove all server transactions were sent.
    a = {key(d): d for d in exact if start_raw <= finite(d.time) <= end_raw}
    b = {key(d): d for d in extra if start_raw <= finite(d.time) <= end_raw}
    if len(a) != len(exact):
        raise ShadowUncertain('deal ganda atau riwayat di luar rentang')
    if len(b) != sum(1 for d in extra if start_raw <= finite(d.time) <= end_raw):
        raise ShadowUncertain('deal ganda pada riwayat luas')
    if a.keys() != b.keys():
        raise ShadowUncertain('dua query riwayat tidak konsisten')
    net = 0.0
    for k, d in a.items():
        if d.type not in (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL):
            raise ShadowUncertain('ada penyesuaian saldo atau deal non-trading pada hari ini')
        other = b[k]
        if other.type != d.type:
            raise ShadowUncertain('jenis deal berubah di antara query')
        values=[]
        for field in ('profit','commission','swap','fee'):
            try:
                first, second = finite(getattr(d,field)), finite(getattr(other,field))
            except AttributeError:
                raise ShadowUncertain('detail keuntungan atau biaya tidak lengkap')
            if first != second:
                raise ShadowUncertain('detail deal berubah di antara query')
            values.append(first)
        net += sum(values)
    a1 = mt5.account_info()
    if a1 is None or a1.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO or read_identity(a1) != id0:
        raise ShadowUncertain('akun atau saldo berubah saat membaca riwayat')
    balance, equity = finite(a1.balance), finite(a1.equity)
    baseline = balance - net
    if baseline <= 0: raise ShadowUncertain('saldo awal hari tidak positif')
    # Estimate only. Commissions, spreads, slippage and asynchronous updates
    # mean no daily loss limit can be guaranteed.
    return {'deal_count': len(a), 'net': net, 'baseline': baseline,
            'equity': equity, 'loss_limit_reached': equity <= baseline * 0.99}


def main():
    import MetaTrader5 as mt5
    if not mt5.initialize():
        print('MT5 tidak tersambung; periksa terminal demo.')
        raise SystemExit(1)
    try:
        print('READ-ONLY | cek perkiraan riwayat NY | tidak mengirim order', flush=True)
        try:
            out = snapshot(mt5, dt.datetime.now(UTC))
        except (ClockUncertain, ShadowUncertain, ValueError, OverflowError, OSError) as e:
            print('BELUM BISA DIREKONSILIASI:', e, flush=True)
            raise SystemExit(1)
        print('Dua rentang query cocok:', out['deal_count'], 'deal', flush=True)
        print('Jenis deal dan detail profit/komisi/swap/fee terbaca.', flush=True)
        print('Perkiraan batas rugi harian:', 'TERCAPAI' if out['loss_limit_reached'] else 'belum tercapai', flush=True)
        print('Ini hanya estimasi lokal; bukan validasi kelengkapan riwayat atau izin auto-trade.', flush=True)
        print('Nilai saldo dan nomor akun tidak ditampilkan atau dikirim.', flush=True)
    finally:
        mt5.shutdown()

if __name__ == '__main__': main()
