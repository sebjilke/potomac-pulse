from lib import *
from data import *

RANGES = [(0, 3000), (3000, 6000), (6000, 12000), (12000, 25000), (25000, 50000), (50000, None)]


def run(c, M, rep):
    rev = c.rev
    rows = []
    for lo, hi in RANGES:
        ps = [p for p in rev if p['old'] >= lo and (hi is None or p['old'] < hi)]
        lv = [p['level'] for p in ps if p['level'] is not None]
        rows.append(dict(range_lo=lo, n=len(ps), mean_ratio=mean([p['ratio'] for p in ps]) if ps else None,
                         min_ratio=min(p['ratio'] for p in ps) if ps else None, max_ratio=max(p['ratio'] for p in ps) if ps else None,
                         mean_diff_cfs=mean([p['cur'] - p['old'] for p in ps]) if ps else None,
                         min_level_ft=min(lv) if lv else None, max_level_ft=max(lv) if lv else None))
    n = write_table('R7_ranges', ['range_lo', 'n', 'mean_ratio', 'min_ratio', 'max_ratio', 'mean_diff_cfs', 'min_level_ft', 'max_level_ft'], rows)
    rep.append('R7_ranges rows %d' % n)
    ch = read_csv(os.path.join(TIDY, 'checks.csv'))
    last = {}
    for r in ch:
        k = r['bin'] + '_' + r['st']
        t = ts(r['created_at_utc'])
        if k not in last or t > last[k][0]:
            last[k] = (t, r['created_at_utc'])
    rows = []
    for b in read_csv(os.path.join(TIDY, 'bins.csv')):
        if b['source'] != 'gf_correction_bin' or b['bin_key'].startswith('stage_'):
            continue
        n_ = int(b['n'])
        s, ss = float(b['sum']), float(b['sum_sq'])
        sdv = math.sqrt((ss - s * s / n_) / (n_ - 1)) if n_ >= 2 else None
        k = b['bin_key']
        rows.append(dict(bin_key=k, n=n_, ema=float(b['ema']), mean=float(b['mean']), sd=sdv,
                         last_check_in_window_utc=last[k][1] if k in last else None))
    rows.sort(key=lambda r: r['bin_key'])
    n = write_table('R7_bins', ['bin_key', 'n', 'ema', 'mean', 'sd', 'last_check_in_window_utc'], rows)
    rep.append('R7_bins rows %d (spec expects 18 flow bins; rows of source gf_correction_bin without the stage_ prefix: %d)' % (n, n))
