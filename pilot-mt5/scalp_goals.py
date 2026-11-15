"""Prototype allocation and target math, without broker orders or I/O.

The virtual allocation is NOT a segregated broker subaccount. The caller must
supply audited, complete cumulative net P&L attributable to this bot, including
all deals and fees. This module is not yet integrated into the active bridge.
"""
from decimal import Decimal, InvalidOperation

class GoalError(ValueError): pass

def _money(value):
    try: x=Decimal(str(value))
    except (InvalidOperation,ValueError,TypeError):raise GoalError('nilai angka tidak valid')
    if not x.is_finite():raise GoalError('nilai angka tidak valid')
    return x

def assess(capital, target_profit, verified_bot_net, equity, *, history_complete):
    """Goal reached when allocation + net *closed* bot P&L >= allocation + target profit.

    Never infer broker history completeness: caller explicitly supplies it.
    This function alone does not persist a stop latch, close positions, access a
    broker, or establish that the supplied net P&L is attributable/complete.
    """
    capital,target_profit,equity=map(_money,(capital,target_profit,equity))
    if capital<=0 or target_profit<=0 or equity<=0:raise GoalError('modal, target, atau equity tidak valid')
    if capital>equity:raise GoalError('modal alokasi melebihi equity tersedia')
    if history_complete is not True:raise GoalError('riwayat bot belum tervalidasi')
    net=_money(verified_bot_net)
    virtual=capital+net
    return {'goal_reached':virtual>=capital+target_profit,'target_total':capital+target_profit,'virtual_capital':virtual,'realized_net':net}

def entry_risk_budget(capital, equity, realized_net, risk_fraction=Decimal('0.0025')):
    """Conservative estimate: 0.25% of the lesser of virtual and actual equity.

    No guarantee: commission, gap, slippage, contract sizing, existing exposure,
    pending orders and broker rejections need independent handling. No daily cap.
    """
    capital,equity,net,risk=map(_money,(capital,equity,realized_net,risk_fraction))
    virtual=capital+net
    if capital<=0 or equity<=0 or virtual<=0 or not Decimal(0)<risk<=Decimal('0.01'):
        raise GoalError('anggaran risiko tidak valid')
    return min(virtual,equity)*risk
