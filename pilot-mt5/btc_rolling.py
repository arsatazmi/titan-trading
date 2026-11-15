"""BTC demo rolling breakout, adapted from the opening-range concept, not upstream stock entry."""
import datetime as dt
import math
UTC=dt.timezone.utc
STEP=300
LOOKBACK=12

def required_window(now):
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError('timezone diperlukan')
    end=int(now.timestamp()//STEP)*STEP
    last=end-STEP
    return dt.datetime.fromtimestamp(last-LOOKBACK*STEP,UTC),dt.datetime.fromtimestamp(last,UTC)

def evaluate(bars,now):
    start,last=required_window(now)
    slots=range(int(start.timestamp()),int(last.timestamp())+1,STEP)
    rows={}
    for b in bars:
        try:
            t=float(b['time'])
            if not math.isfinite(t) or t != int(t):raise ValueError()
            t=int(t)
            if t not in slots:continue
            if t in rows:return {'status':'no_data','reason':'candle duplikat'}
            h,l,c=(float(b[k]) for k in ('high','low','close'))
            if not all(math.isfinite(x) and x>0 for x in (h,l,c)) or not l<=c<=h:raise ValueError()
            rows[t]=(h,l,c)
        except (KeyError,TypeError,ValueError,OverflowError):
            return {'status':'no_data','reason':'candle tidak valid'}
    if any(t not in rows for t in slots):return {'status':'no_data','reason':'candle M5 tidak lengkap'}
    previous=[rows[t] for t in list(slots)[:-1]]
    high=max(x[0] for x in previous); low=min(x[1] for x in previous); close=rows[int(last.timestamp())][2]
    if high<=low:return {'status':'no_data','reason':'rentang tidak valid'}
    return {'status':'breakout_observed' if close>high else 'waiting','range_high':high,'range_low':low,'last_close':close,'last_bar_utc':last.isoformat()}
