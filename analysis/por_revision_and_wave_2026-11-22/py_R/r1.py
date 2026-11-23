from lib import *
from data import *

REV_LO, REV_HI = ts('2026-11-13T19:41:00Z'), ts('2026-11-13T19:42:00Z')


def build_pairs(c):
    old = c.old[(POR, '00060')]
    cur = c.cen[(POR, '00060')]
    lev = c.cur.get((POR, '00065'), {})
    pairs = []
    for t in sorted(old):
        if t in cur:
            o = old[t][0]
            cv, lm = cur[t]
            lv = lev[t][0] if t in lev else None
            p = dict(t=t, old=o, cur=cv, lm=lm, level=lv,
                     h=(h100(lv) if lv is not None else None),
                     changed=(o != cv), ratio=(cv / o if o != 0 else None))
            p['rev13'] = bool(p['changed'] and lm is not None and REV_LO <= lm < REV_HI)
            pairs.append(p)
    return pairs


def run(c, M, rep):
    pairs = build_pairs(c)
    c.pairs = pairs
    rep.append('R1: %d pairs (old archive PoR flow x census PoR flow, both non-blank); old==0 pairs: %d' %
               (len(pairs), sum(1 for p in pairs if p['old'] == 0)))
    changed = [p for p in pairs if p['changed']]
    # 2. rewrite groups
    g = collections.defaultdict(list)
    for p in changed:
        g[iso_minute(p['lm'])].append(p)
    rows = []
    for k in sorted(g):
        ps = g[k]
        rs = [p['ratio'] for p in ps if p['ratio'] is not None]
        rows.append(dict(lm_minute=k, n_pairs=len(ps), first_time_utc=iso(min(p['t'] for p in ps)),
                         last_time_utc=iso(max(p['t'] for p in ps)), mean_ratio=mean(rs),
                         min_ratio=min(rs), max_ratio=max(rs)))
    n = write_table('R1_rewrite_groups', ['lm_minute', 'n_pairs', 'first_time_utc', 'last_time_utc', 'mean_ratio', 'min_ratio', 'max_ratio'], rows)
    rep.append('R1_rewrite_groups rows %d' % n)

    # 3. REV13 metrics
    rev = [p for p in pairs if p['rev13']]
    c.rev = rev
    M.add('R1', 'n_pairs_all', len(pairs))
    M.add('R1', 'n_changed_all', len(changed))
    M.add('R1', 'n_rev13', len(rev))
    if rev:
        f, l = min(p['t'] for p in rev), max(p['t'] for p in rev)
        M.add('R1', 'rev13_first_time_utc', iso(f))
        M.add('R1', 'rev13_last_time_utc', iso(l))
        M.add('R1', 'n_unchanged_inside_rev13_span', sum(1 for p in pairs if (not p['changed']) and f <= p['t'] <= l))
    cen_por = c.cen[(POR, '00060')]
    st = sorted(t for t, (v, lm) in cen_por.items() if lm is not None and REV_LO <= lm < REV_HI)
    M.add('R1', 'n_current_stamped_1941', len(st))
    if st:
        M.add('R1', 'earliest_time_stamped_1941', iso(st[0]))
        M.add('R1', 'latest_time_stamped_1941', iso(st[-1]))
    rep.append('R1: current census PoR flow readings with lm in 19:41 minute: %d' % len(st))

    # 4. by day
    d0 = ts('2026-08-01T00:00:00Z')
    byday = collections.defaultdict(list)
    for p in pairs:
        if p['t'] >= d0:
            byday[day_of(p['t'])].append(p)
    rows = []
    for d in sorted(byday):
        ps = byday[d]
        rv = [p for p in ps if p['rev13']]
        rows.append(dict(day_utc=d, n_pairs=len(ps), n_changed=sum(1 for p in ps if p['changed']), n_rev13=len(rv),
                         mean_old=mean([p['old'] for p in ps]), mean_current=mean([p['cur'] for p in ps]),
                         mean_ratio_rev13=mean([p['ratio'] for p in rv]) if rv else None,
                         mean_diff_rev13_cfs=mean([p['cur'] - p['old'] for p in rv]) if rv else None))
    n = write_table('R1_by_day', ['day_utc', 'n_pairs', 'n_changed', 'n_rev13', 'mean_old', 'mean_current', 'mean_ratio_rev13', 'mean_diff_rev13_cfs'], rows)
    rep.append('R1_by_day rows %d' % n)

    # 5. by level
    revl = [p for p in rev if p['h'] is not None]
    M.add('R1', 'n_rev13_with_level', len(revl))
    byl = collections.defaultdict(list)
    for p in revl:
        byl[p['h']].append(p)
    rows = []
    for h in sorted(byl):
        ps = byl[h]
        rows.append(dict(level_ft=h / 100.0, n=len(ps), mean_old=mean([p['old'] for p in ps]),
                         mean_current=mean([p['cur'] for p in ps]), mean_ratio=mean([p['ratio'] for p in ps]),
                         mean_diff_cfs=mean([p['cur'] - p['old'] for p in ps]),
                         n_distinct_old=len(set(p['old'] for p in ps)), n_distinct_current=len(set(p['cur'] for p in ps))))
    n = write_table('R1_by_level', ['level_ft', 'n', 'mean_old', 'mean_current', 'mean_ratio', 'mean_diff_cfs', 'n_distinct_old', 'n_distinct_current'], rows)
    rep.append('R1_by_level rows %d' % n)
    byb = collections.defaultdict(list)
    for p in revl:
        byb[p['h'] // 25].append(p)
    rows = []
    for b in sorted(byb):
        ps = byb[b]
        rs = [p['ratio'] for p in ps]
        ds = [p['cur'] - p['old'] for p in ps]
        rows.append(dict(band_lo=b * 25 / 100.0, n=len(ps), mean_ratio=mean(rs), sd_ratio=sd(rs), mean_diff_cfs=mean(ds), sd_diff_cfs=sd(ds)))
    n = write_table('R1_by_level_band', ['band_lo', 'n', 'mean_ratio', 'sd_ratio', 'mean_diff_cfs', 'sd_diff_cfs'], rows)
    rep.append('R1_by_level_band rows %d' % n)

    # 6. which description fits best
    Lraw = {h: median([p['old'] for p in ps]) for h, ps in byl.items()}
    hs = sorted(Lraw)
    Mx = []
    run_max = None
    for h in hs:
        run_max = Lraw[h] if run_max is None else max(run_max, Lraw[h])
        Mx.append(run_max)

    def shift_level(y):
        if y < Mx[0] or y > Mx[-1]:
            return None
        i = bisect.bisect_left(Mx, y)  # first i with Mx[i] >= y (Mx non-decreasing)
        if Mx[i] == y or i == 0:
            return hs[i] / 100.0
        h0, h1 = hs[i - 1] / 100.0, hs[i] / 100.0
        return h0 + (y - Mx[i - 1]) / (Mx[i] - Mx[i - 1]) * (h1 - h0)

    rr, qq, ss = [], [], []
    undef = 0
    for p in revl:
        rr.append(p['ratio'])
        qq.append(p['cur'] - p['old'])
        hstar = shift_level(p['cur'])
        if hstar is None:
            undef += 1
        else:
            ss.append(hstar - p['h'] / 100.0)
    for nm, v in (('r', rr), ('q', qq), ('s', ss)):
        m, s_ = mean(v), sd(v)
        M.add('R1', 'mean', m, nm)
        M.add('R1', 'sd', s_, nm)
        M.add('R1', 'cv', (s_ / abs(m)) if (s_ is not None and m) else None, nm)
        M.add('R1', 'n', len(v), nm)
    M.add('R1', 'n_shift_undefined', undef)

    # 7. over time
    rows = []
    bands = [(100, 110), (110, 120), (120, 130)]
    for lo, hi in bands:
        sub = [p for p in revl if lo <= p['h'] < hi]
        bd = collections.defaultdict(list)
        for p in sub:
            bd[day_of(p['t'])].append(p)
        days = sorted(bd)
        for d in days:
            rows.append(dict(band_lo=lo / 100.0, day_utc=d, n=len(bd[d]), mean_ratio=mean([p['ratio'] for p in bd[d]])))
        key = '%.2f' % (lo / 100.0)
        M.add('R1', 'n_days_' + key, len(days))
        if len(days) >= 5:
            x = [(day_start(d) - day_start(days[0])) / DAY for d in days]
            y = [mean([p['ratio'] for p in bd[d]]) for d in days]
            M.add('R1', 'slope_ratio_per_day_' + key, ols_slope(x, y))
    n = write_table('R1_ratio_day_band', ['band_lo', 'day_utc', 'n', 'mean_ratio'], rows)
    rep.append('R1_ratio_day_band rows %d' % n)

    # 8. the two old copies
    rows = []
    for k in sorted(set(c.old) & set(c.octp)):
        a, b = c.old[k], c.octp[k]
        sh = [t for t in a if t in b]
        diffs = [abs(a[t][0] - b[t][0]) for t in sh]
        rows.append(dict(gauge=k[0], parameter=k[1], n_shared=len(sh), n_equal=sum(1 for d in diffs if d == 0),
                         n_different=sum(1 for d in diffs if d != 0), max_abs_diff=max(diffs) if diffs else None))
    n = write_table('R1_old_copies', ['gauge', 'parameter', 'n_shared', 'n_equal', 'n_different', 'max_abs_diff'], rows)
    rep.append('R1_old_copies rows %d' % n)

    # 9. the job log's old readings
    rows = []
    for seq in c.seqs:
        if c.labels[seq]['cur_label'] != 'old':
            continue
        r = c.run_by_seq[seq]
        t = ts(r['in_por_qT_utc'])
        cq = cur_at(c, POR, '00060', t)
        lq = fnum(r['in_por_q'])
        rows.append(dict(seq=seq, in_por_qT_utc=iso(t), in_por_h=fnum(r['in_por_h']), logged_q=lq, current_q=cq,
                         ratio=(cq / lq) if (cq is not None and lq) else None))
    n = write_table('R1_log_pairs', ['seq', 'in_por_qT_utc', 'in_por_h', 'logged_q', 'current_q', 'ratio'], rows)
    rs = [r['ratio'] for r in rows if r['ratio'] is not None]
    M.add('R1', 'n', len(rs))
    M.add('R1', 'mean_ratio', mean(rs))
    M.add('R1', 'min_ratio', min(rs) if rs else None)
    M.add('R1', 'max_ratio', max(rs) if rs else None)
    rep.append('R1_log_pairs rows %d (with a ratio: %d)' % (n, len(rs)))
