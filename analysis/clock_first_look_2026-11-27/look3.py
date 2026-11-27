# Last night re-scored on a short clock: truth = Little Falls flow N hours after each run. First look.
import json, datetime, math
exec(open('look.py').read().split("rules = [")[0])
more = """27T06:01 5360 14037.1 6432
27T07:01 5570 13534.1 6684
27T08:01 6000 12614.1 7200
27T09:01 6230 11845.1 7476
27T10:01 6610 11844.9 7932
27T11:01 7080 11735.6 8496"""
for line in more.splitlines():
    t, lfv, unc, shown = line.split()
    rows.append(dict(t=P('2026-11-' + t), lf=float(lfv), unc=float(unc), shown=float(shown), due=None, trv=None))
    lfhist[P('2026-11-' + t)] = float(lfv)
for N in (3.0,):
    print(f'truth = Little Falls {N} h after the run')
    print('run (Eastern)  LF now  app shows  model alone  LF+trend   truth | error %:  app   model  LFnow  LF+trend')
    S = {k: [] for k in ('app', 'model', 'lfnow', 'trend')}
    for r in rows:
        tr = lf_at(r['t'] + datetime.timedelta(hours=N))
        if tr is None: continue
        L3 = lf_k(r['t'], 3)
        trend = None if L3 is None else r['lf'] + max(0.0, r['lf'] - L3) / 3.0 * N
        vals = {'app': r['shown'], 'model': r['unc'], 'lfnow': r['lf'], 'trend': trend}
        e = {k: (None if v is None else (v - tr) / tr * 100) for k, v in vals.items()}
        for k in S:
            if e[k] is not None: S[k].append(e[k])
        loc = (r['t'] - datetime.timedelta(hours=5)).strftime('%a %I%p')
        print(f"{loc:10s} {r['lf']:7.0f} {r['shown']:9.0f} {r['unc']:11.0f} {'' if trend is None else format(trend, '9.0f'):>9s} {tr:8.0f} |        {e['app']:6.1f} {e['model']:7.1f} {e['lfnow']:6.1f} {'' if e['trend'] is None else format(e['trend'], '6.1f'):>6s}")
    for k in S:
        a = S[k]; print(f"  {k:6s} n={len(a)} mean abs error {sum(abs(x) for x in a) / len(a):5.1f}%  too low {sum(x <= -15 for x in a)}  too high {sum(x >= 15 for x in a)}")
