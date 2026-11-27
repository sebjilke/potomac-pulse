# First look: how long does a rise take from Edwards Ferry to Little Falls, by flow? (hourly record 2011 to 2026)
# Edwards Ferry is 25.8 river miles above the Little Falls gauge, Great Falls 9.3 (canal mileposts 30.8, 14.3, 5.0).
# Method: for each listed rise, the lag (0 to 40 h) at which the hourly CHANGES of Edwards Ferry stage and of Little Falls flow line up best.
import csv, datetime, math, statistics
base = '/Users/sebjilke/Desktop/PotomacPulse/analysis/rising-limb-travel-backtest/'
P = lambda s: datetime.datetime.strptime(s, '%Y-%m-%d %H:%M')
ef, lf = {}, {}
for r in csv.DictReader(open(base + 'hourly_backtest_data_v39.csv')):
    t = P(r['timestamp'])
    if r['ef_stage'] != '': ef[t] = float(r['ef_stage'])
    if r['lf_discharge'] != '': lf[t] = float(r['lf_discharge'])
H = datetime.timedelta(hours=1)
def diffs(d, t0, t1):
    out = {}
    t = t0
    while t <= t1:
        if t in d and (t - H) in d: out[t] = d[t] - d[t - H]
        t += H
    return out
def corr(a, b):
    n = len(a)
    if n < 12: return None
    ma, mb = sum(a) / n, sum(b) / n
    sa = math.sqrt(sum((x - ma) ** 2 for x in a)); sb = math.sqrt(sum((x - mb) ** 2 for x in b))
    return None if sa == 0 or sb == 0 else sum((x - ma) * (y - mb) for x, y in zip(a, b)) / (sa * sb)
def app_hours(flow): return 6.5 * (4139 * max(flow, 1000) ** -0.5963) / 25.8
res = []
for e in csv.DictReader(open(base + 'rising_limb_events_python_v39.csv')):
    if e['kept'] != '1': continue
    a = P(e['rl_start']) - 12 * H; b = P(e['event_tp']) + 12 * H
    dl = diffs(lf, a, b)
    best = None
    for lag in range(0, 41):
        de = diffs(ef, a - lag * H, b - lag * H)
        xs, ys = [], []
        for t, v in dl.items():
            u = de.get(t - lag * H)
            if u is not None: xs.append(u); ys.append(v)
        c = corr(xs, ys)
        if c is not None and (best is None or c > best[1]): best = (lag, c, len(xs))
    if best is None or best[1] < 0.5: continue
    limb = [lf[t] for t in lf if P(e['rl_start']) <= t <= P(e['rl_end'])]
    if not limb: continue
    mid = statistics.median(limb)
    res.append((mid, best[0], best[1], e['event_class'], e['event_t0'], float(e['event_peak_lf'])))
res.sort()
print('rises used:', len(res), '(correlation of at least 0.5)')
print('mid flow on the rise | EF to LF lag h | corr | implied GF to LF h (x 9.3/25.8) | app formula at that flow h | class | start | peak')
for mid, lag, c, cl, t0, pk in res:
    print(f'{mid:8.0f} | {lag:3d} | {c:4.2f} | {lag * 9.3 / 25.8:4.1f} | {app_hours(mid):4.1f} | {cl:7s} | {t0} | {pk:7.0f}')
for lo, hi in ((0, 5000), (5000, 10000), (10000, 20000), (20000, 10**9)):
    g = [x for x in res if lo <= x[0] < hi]
    if g:
        lags = [x[1] for x in g]
        print(f'mid flow {lo} to {hi}: n={len(g)} median EF to LF lag {statistics.median(lags):.1f} h (range {min(lags)} to {max(lags)}); implied GF to LF {statistics.median(lags) * 9.3 / 25.8:.1f} h; app formula at the median flow {app_hours(statistics.median([x[0] for x in g])):.1f} h')
