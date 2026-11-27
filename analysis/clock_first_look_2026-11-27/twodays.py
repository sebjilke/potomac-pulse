# First look: the app's error over the last two days, scored against Little Falls a short travel time later.
# Values of the hourly runs typed from one read-only query of the app's log. Not verified by a second party.
import json, datetime
obs = json.load(open('obs2.json'))['data']
P = lambda s: datetime.datetime.strptime(s[:16], '%Y-%m-%dT%H:%M').replace(tzinfo=datetime.timezone.utc)
pts = sorted((P(x['validTime']), x['secondary'] * 1000.0) for x in obs if x.get('secondary') is not None and x['secondary'] > 0)
def lf_at(t):
    for (a, va), (b, vb) in zip(pts, pts[1:]):
        if a <= t <= b: return va + (vb - va) * ((t - a).total_seconds() / max(1.0, (b - a).total_seconds()))
    return None
T = """25T18:01 1560 1604.8 1605 13.01
25T19:01 1560 1570.0 1570 13.01
25T20:01 1600 1549.0 1549 13.21
25T21:01 1600 1472.5 1473 13.31
25T22:01 1560 1452.9 1453 13.01
25T23:01 1600 1532.5 1533 12.81
26T00:01 1560 1481.0 1481 13.01
26T01:01 1560 1567.0 1567 11.94
26T02:00 1560 1547.0 1547 11.71
26T03:00 1560 1535.0 1535 11.86
26T04:00 1480 1516.0 1516 11.86
26T05:01 1480 1491.0 1491 11.79
26T06:00 1480 1519.9 1520 12.02
26T07:01 1480 1527.9 1528 12.10
26T08:01 1480 1550.9 1551 12.10
26T09:01 1520 1511.0 1511 12.08
26T10:00 1520 1485.8 1486 12.06
26T11:01 1450 1554.0 1554 12.02
26T12:01 1560 1614.0 1614 12.39
26T13:01 1730 1683.0 1683 12.07
26T14:01 1730 1747.0 1747 12.30
26T15:01 1770 1874.9 1875 12.77
26T16:01 1810 2016.9 2017 12.53
26T17:01 2070 2226.7 2227 12.92
26T18:01 2160 2517.9 2518 13.30
26T19:01 2400 2875.5 2875 13.39
26T20:01 2750 3538.6 3300 13.35
26T21:00 3400 4449.6 4080 12.49
26T22:01 3860 7096.3 4632 12.86
26T23:01 4230 8412.9 5076 11.48
27T00:01 4170 9843.9 5004 10.79
27T01:01 4110 11683.4 4932 10.49
27T02:01 4230 10304.8 5076 10.32
27T03:01 4550 11016.1 5460 9.62
27T04:01 4810 13148.1 5772 9.34
27T05:01 5080 14009.1 6096 9.98
27T06:01 5360 14037.1 6432 10.36
27T07:01 5570 13534.1 6684 10.99
27T08:01 6000 12614.1 7200 11.71
27T09:01 6230 11845.1 7476 12.13
27T10:01 6610 11844.9 7932 12.27
27T11:01 7080 11735.6 8496 12.36
27T12:01 7490 11697.3 8988 12.53
27T13:01 7910 11337.3 9492 12.91
27T14:01 8420 11459.8 10104 13.76
27T15:01 8770 11198.2 10524 13.99"""
rows = []
for line in T.splitlines():
    t, lf, unc, shown, trv = line.split()
    rows.append(dict(t=P('2026-11-' + t), lf=float(lf), unc=float(unc), shown=float(shown), trv=float(trv)))
def long_clock(L): return 6.0 if L < 2500 else 3.0     # first-look figures: about 6 h at low water, about 3 h on the rise
def phase(r):
    if r['t'] < P('2026-11-26T12:00'): return '1 before the rise (Wed 1 pm to Thu 6 am)'
    if r['t'] < P('2026-11-26T20:00'): return '2 first hours of the rise (Thu 7 am to 2 pm)'
    return '3 rise, cap holding (Thu 3 pm on)'
for label, f in (("app's own clock (9 to 14 h)", lambda r: r['trv']), ('new clock, long end (6 h low water, 3 h on the rise)', lambda r: long_clock(r['lf'])), ('new clock, short end (40% of that)', lambda r: 0.4 * long_clock(r['lf']))):
    print('==', label)
    agg = {}
    for r in rows:
        tr = lf_at(r['t'] + datetime.timedelta(hours=f(r)))
        if tr is None: continue
        e = (r['shown'] - tr) / tr * 100; en = (r['unc'] - tr) / tr * 100
        for k in (phase(r), '0 all runs with a truth'):
            a = agg.setdefault(k, dict(n=0, s=0.0, lo=0, hi=0, sn=0.0, mn=999, mx=-999))
            a['n'] += 1; a['s'] += abs(e); a['lo'] += e <= -15; a['hi'] += e >= 15; a['sn'] += abs(en); a['mn'] = min(a['mn'], e); a['mx'] = max(a['mx'], e)
    for k in sorted(agg):
        a = agg[k]
        print(f"  {k:46s} runs {a['n']:2d} | app: average miss {a['s'] / a['n']:5.1f}%  range {a['mn']:6.1f} to {a['mx']:5.1f}  badly low {a['lo']:2d}  badly high {a['hi']:2d} | without the cap: {a['sn'] / a['n']:6.1f}%")
print('latest observed', pts[-1][0].strftime('%d %H:%M UTC'), pts[-1][1])
