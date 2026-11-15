"""Experimental, read-only tick momentum SIGNAL, no orders.

Not integrated into the active bridge. A positive signal is not evidence of a
profitable trade. Input timestamps must already be verified, timezone-aware UTC.
Execution, target tracking, costs and account safety need separate validation.
"""
import math
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

UTC = timezone.utc

@dataclass(frozen=True)
class Tick:
    at: datetime
    bid: float
    ask: float

class TickMomentum:
    """Prototype: inspect up to 12 seconds, require >=8s of contiguous fresh ticks.

    LONG only, >=6 quotes, no inter-tick gap >3s, movement >3*current
    spread and >=3 price ticks. Invalid/stale data returns no signal. Prices
    are not order instructions. Broker timestamps and quantity must be checked
    independently before any trading integration.
    """
    def __init__(self):
        self.ticks=deque()

    @staticmethod
    def _valid_at(at):
        return isinstance(at,datetime) and at.tzinfo is not None and at.utcoffset() is not None

    def add(self, at, bid, ask):
        if not self._valid_at(at):
            self.ticks.clear();return False
        try: bid=float(bid);ask=float(ask)
        except (TypeError,ValueError,OverflowError):self.ticks.clear();return False
        if not all(math.isfinite(x) and x>0 for x in (bid,ask)) or ask<bid:
            self.ticks.clear();return False
        at=at.astimezone(UTC)
        if self.ticks and at < self.ticks[-1].at:
            self.ticks.clear();return False
        if self.ticks and at == self.ticks[-1].at:
            # A duplicate broker timestamp is not an independent new quote.
            return False
        self.ticks.append(Tick(at,bid,ask))
        while self.ticks and at-self.ticks[0].at>timedelta(seconds=12):self.ticks.popleft()
        return True

    def signal(self, now, tick_size):
        if not self._valid_at(now):return {'status':'no_data','reason':'waktu tidak valid'}
        try: tick_size=float(tick_size)
        except (ValueError,TypeError,OverflowError):return {'status':'no_data','reason':'tick size tidak valid'}
        if not math.isfinite(tick_size) or tick_size<=0:return {'status':'no_data','reason':'tick size tidak valid'}
        now=now.astimezone(UTC)
        if not self.ticks:return {'status':'waiting','reason':'menunggu quote'}
        latest=self.ticks[-1]
        if not timedelta(0)<=now-latest.at<=timedelta(seconds=2):return {'status':'no_data','reason':'quote stale atau masa depan'}
        rows=[q for q in self.ticks if timedelta(0)<=now-q.at<=timedelta(seconds=12)]
        if len(rows)<6 or rows[-1].at-rows[0].at<timedelta(seconds=8):return {'status':'waiting','reason':'quote belum cukup'}
        if any(b.at-a.at>timedelta(seconds=3) for a,b in zip(rows,rows[1:])):
            return {'status':'no_data','reason':'jeda quote terlalu panjang'}
        first,last=rows[0],rows[-1]
        spread=last.ask-last.bid
        move=last.bid-first.bid
        if move<=max(3*spread,3*tick_size):return {'status':'waiting','reason':'momentum belum cukup'}
        return {'status':'long_signal','bid':last.bid,'ask':last.ask,'spread':spread,
                'move':move,'start_utc':first.at.isoformat(),'last_utc':last.at.isoformat()}
