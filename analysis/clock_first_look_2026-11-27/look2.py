# Same first look, but with the truth taken a FIXED number of hours after each run (instead of the app's own 9 to 14 h).
import json, datetime, math, sys
exec(open('look.py').read().split("rules = [")[0])   # reuse the series, the rows and the rule function
rules = ['cap120', 'cap150', 'LF6', 'none']
def shown_fixed(r, rule, trv):
    L, u = r['lf'], r['unc']
    if rule == 'cap120': lim = 1.2 * L
    elif rule == 'none': lim = float('inf')
    elif rule == 'cap150': lim = 1.5 * L
    else:
        Lk = lf_k(r['t'], 6)
        lim = 1.2 * L if Lk is None else min(2.0 * L, 1.2 * max(L, L + (L - Lk) * (trv + 0.1) / 6))
    return math.floor(min(u, lim) + 0.5)
for trv in (4.5, 6.5, None):
    A = {x: [] for x in rules}; C = {x: [] for x in rules}
    for r in rows:
        t_use = r['trv'] if trv is None else trv
        tr = lf_at(r['t'] + datetime.timedelta(hours=t_use))
        if tr is None: continue
        capped = r['unc'] > 1.2 * r['lf']
        for x in rules:
            e = (shown_fixed(r, x, t_use) - tr) / tr * 100
            A[x].append(e)
            if capped: C[x].append(e)
    lab = 'app (9 to 13 h)' if trv is None else f'{trv} h'
    for name, D in (('all', A), ('capped', C)):
        n = len(D['cap120'])
        print(f"travel {lab:16s} {name:6s} n={n:2d} | mean abs error % and too low/too high:", '  '.join(f"{x} {sum(abs(e) for e in D[x]) / n:5.1f} ({sum(e <= -15 for e in D[x])}/{sum(e >= 15 for e in D[x])})" for x in rules))
    if trv is not None:
        print('    cap120 errors by run:', ' '.join(f"{e:.0f}" for e in A['cap120']))
