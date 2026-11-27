# First look at the rise of 2026-11-26/27 from the app's own hourly log (values typed from one read-only query).
# Truth = Little Falls flow at the hour the app itself scores the estimate against (its "due" time), from the public observed series.
import json, datetime, math
obs = json.load(open('obs.json'))['data']
P = lambda s: datetime.datetime.strptime(s[:16], '%Y-%m-%dT%H:%M').replace(tzinfo=datetime.timezone.utc)
pts = sorted((P(x['validTime']), x['secondary'] * 1000.0) for x in obs if x.get('secondary') is not None and x['secondary'] > 0)
print('observed series from', pts[0][0], 'to', pts[-1][0], 'n', len(pts))
def lf_at(t):
    for (a, va), (b, vb) in zip(pts, pts[1:]):
        if a <= t <= b:
            return va + (vb - va) * ((t - a).total_seconds() / max(1.0, (b - a).total_seconds()))
    return None
# tick (UTC), LF reading the cap used, estimate before the cap, shown, due (UTC), travel GF to LF in hours
T = """26T12:01 1560 1614.0 1614 27T00:24 12.39
26T13:01 1730 1683.0 1683 27T01:05 12.07
26T14:01 1730 1747.0 1747 27T02:18 12.30
26T15:01 1770 1874.9 1875 27T03:46 12.77
26T16:01 1810 2016.9 2017 27T04:33 12.53
26T17:01 2070 2226.7 2227 27T05:56 12.92
26T18:01 2160 2517.9 2518 27T07:18 13.30
26T19:01 2400 2875.5 2875 27T08:24 13.39
26T20:01 2750 3538.6 3300 27T09:21 13.35
26T21:00 3400 4449.6 4080 27T09:30 12.49
26T22:01 3860 7096.3 4632 27T10:52 12.86
26T23:01 4230 8412.9 5076 27T10:29 11.48
27T00:01 4170 9843.9 5004 27T10:48 10.79
27T01:01 4110 11683.4 4932 27T11:30 10.49
27T02:01 4230 10304.8 5076 27T12:20 10.32
27T03:01 4550 11016.1 5460 27T12:38 9.62
27T04:01 4810 13148.1 5772 27T13:21 9.34
27T05:01 5080 14009.1 6096 27T14:59 9.98"""
rows = []
for line in T.splitlines():
    t, lf, unc, shown, due, trv = line.split()
    rows.append(dict(t=P('2026-11-' + t), lf=float(lf), unc=float(unc), shown=float(shown), due=P('2026-11-' + due), trv=float(trv)))
earlier = {P('2026-11-26T06:00'): 1480, P('2026-11-26T07:01'): 1480, P('2026-11-26T08:01'): 1480, P('2026-11-26T09:01'): 1520, P('2026-11-26T10:00'): 1520, P('2026-11-26T11:01'): 1450}
lfhist = dict(earlier); lfhist.update({r['t']: r['lf'] for r in rows})
def lf_k(t, k):
    best = None
    for tt, v in lfhist.items():
        d = abs((t - tt).total_seconds() / 3600.0 - k)
        if d < 0.1: best = v
    return best
def shown_under(r, rule):
    L, u = r['lf'], r['unc']
    if rule == 'cap120': lim = 1.2 * L
    elif rule == 'none': lim = float('inf')
    elif rule in ('cap135', 'cap150', 'cap200'): lim = float(rule[3:]) / 100 * L
    else:
        k = int(rule[2:]); Lk = lf_k(r['t'], k)
        lim = 1.2 * L if Lk is None else min(2.0 * L, 1.2 * max(L, L + (L - Lk) * (r['trv'] + 0.1) / k))
    return math.floor(min(u, lim) + 0.5)
rules = ['cap120', 'cap135', 'cap150', 'cap200', 'LF3', 'LF6', 'none']
print('tick(UTC)   LF     before  shown  truth@due | error %:', ' '.join(f'{x:>7s}' for x in rules))
acc = {x: [] for x in rules}; acc_c = {x: [] for x in rules}
for r in rows:
    tr = lf_at(r['due'])
    if tr is None: print(r['t'].strftime('%dT%H:%M'), 'no truth yet'); continue
    errs = {x: (shown_under(r, x) - tr) / tr * 100 for x in rules}
    capped = r['unc'] > 1.2 * r['lf']
    for x in rules:
        acc[x].append(errs[x])
        if capped: acc_c[x].append(errs[x])
    print(r['t'].strftime('%dT%H:%M'), f"{r['lf']:6.0f} {r['unc']:8.0f} {r['shown']:6.0f} {tr:8.0f} {'C' if capped else ' '}        ", ' '.join(f'{errs[x]:7.1f}' for x in rules))
for name, A in (('all 18 hours', acc), ('capped hours', acc_c)):
    n = len(A['cap120'])
    print(name, 'n', n, '| mean abs error:', ' '.join(f"{x} {sum(abs(e) for e in A[x]) / n:5.1f}" for x in rules))
    print(' ' * len(name), '      | badly low / badly high:', ' '.join(f"{x} {sum(e <= -15 for e in A[x])}/{sum(e >= 15 for e in A[x])}" for x in rules))
