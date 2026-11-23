from lib import *
from data import *
import r3

BAND = {'Excellent': 0.02, 'Good': 0.05, 'Fair': 0.08, 'Poor': 0.15}


def band_of(rating):
    return BAND.get(rating, 0.15)


def prep_series(c):
    """series prepared over the R4 window, cached on ctx (also used by R8)."""
    if hasattr(c, 'prep'):
        return c.prep
    P = {}
    def mk(name, readings):
        P[name] = Prepared(readings, W0_R4, CUTOFF, name)
    mk('por_old', c.old[(POR, '00060')])
    mk('por_cur', c.cen[(POR, '00060')])
    mk('lf', c.cen[(LF, '00060')])
    mk('por_h', c.cur[(POR, '00065')])
    for nm, g in (('shep', SHEP), ('mill', MILL), ('ant', ANT), ('cat', CAT), ('mono', MONO), ('goose', GOOSE), ('br', BR), ('sen', SEN)):
        mk(nm, c.cur[(g, '00060')])
    c.prep = P
    return P


def gauge_band_on(c, gauge, dstr):
    """band (fraction) of the latest visit with a discharge on or before UTC day dstr."""
    end = day_start(dstr) + DAY
    best = None
    for v in c.visits_all.get(gauge, []):
        if v['has_flow'] and v['t'] < end:
            best = v  # visits sorted by time
    return band_of(best['measurement_rated']) if best else 0.15


def run(c, M, rep):
    if not hasattr(c, 'visits_all'):
        c.visits_all, _, _ = r3.build_visits(c)
    visits = c.visits_all
    P = prep_series(c)
    for k, p in P.items():
        rep.append('R4 series %s: step %ds, grid %d, present %d, filled %d, missing %d, filled with outside neighbour %d, step tie %s' %
                   (k, p.step, p.n, p.present, p.filled, p.missing, p.filled_with_outside_neighbour, p.tie))
        M.add('R4', 'step_s', p.step, 'series_' + k)
        M.add('R4', 'n_present', p.present, 'series_' + k)
        M.add('R4', 'n_filled', p.filled, 'series_' + k)
        M.add('R4', 'n_missing', p.missing, 'series_' + k)
    revdays = set(day_of(p['t']) for p in c.rev)

    # ------------------------------------------------------------ (0)
    fold = read_csv(os.path.join(FOLD, 'f_old_values.csv'))
    ftimes = [ts(r['time_utc']) for r in fold]
    fby = {ts(r['time_utc']): r for r in fold}
    ftimes_sorted = sorted(ftimes)
    rows = []
    for r in c.mvp:
        if r['visit_time_utc'] < '2026-06-12T00:00:00Z':
            continue
        bp = band_of(r['measurement_rated']) * 100
        rr = dict(r)
        rr['band_pct'] = bp
        rr['current_inside_band'] = (1 if abs(r['pct_current_vs_measured']) <= bp else 0) if r['pct_current_vs_measured'] is not None else None
        rr['old_inside_band'] = (1 if abs(r['pct_old_vs_measured']) <= bp else 0) if r['pct_old_vs_measured'] is not None else None
        t = ts(r['visit_time_utc'])
        f = nearest_within(ftimes_sorted, t, 900)
        for X in 'ABC':
            v = None
            if f is not None:
                s = fby[f]['f_old_rule_%s_cfs' % X]
                v = float(s) if s != '' else None
            rr['f_old_' + X] = v
            rr['pct_f_old_%s_vs_measured' % X] = ((v - r['measured_cfs']) / r['measured_cfs'] * 100) if v is not None else None
        rows.append(rr)
    cols = ['visit_time_utc', 'level_ft', 'measured_cfs', 'measurement_rated', 'control_condition', 'current_cfs', 'old_cfs',
            'pct_current_vs_measured', 'pct_old_vs_measured', 'band_pct', 'current_inside_band', 'old_inside_band',
            'f_old_A', 'f_old_B', 'f_old_C', 'pct_f_old_A_vs_measured', 'pct_f_old_B_vs_measured', 'pct_f_old_C_vs_measured']
    n = write_table('R4_0_por', cols, rows)
    rep.append('R4_0_por rows %d' % n)

    rows = []
    for g in UPSTREAM:
        cd = c.cur[(g, '00060')]
        ct = c.cur_times[(g, '00060')]
        for v in visits.get(g, []):
            if v['t'] < ts('2026-09-01T00:00:00Z') or not v['has_flow']:
                continue
            a = nearest_within(ct, v['t'], 900)
            cc = cd[a][0] if a is not None else None
            m = v['flow_cfs']
            pct = ((cc - m) / m * 100) if (cc is not None and m) else None
            bp = band_of(v['measurement_rated']) * 100
            rows.append(dict(gauge=g, visit_time_utc=v['visit_time_utc'], level_ft=v['level_ft'], measured_cfs=m,
                             measurement_rated=v['measurement_rated'], current_cfs=cc, pct=pct, band_pct=bp,
                             inside_band=(1 if abs(pct) <= bp else 0) if pct is not None else None))
    rows.sort(key=lambda r: (r['gauge'], r['visit_time_utc']))
    n = write_table('R4_0_upstream', ['gauge', 'visit_time_utc', 'level_ft', 'measured_cfs', 'measurement_rated', 'current_cfs', 'pct', 'band_pct', 'inside_band'], rows)
    rep.append('R4_0_upstream rows %d (without a current reading within 15 min: %d)' % (n, sum(1 for r in rows if r['current_cfs'] is None)))

    # ------------------------------------------------------------ (a)
    days = days_between('2026-09-03', '2026-11-09')

    def U(d):
        vs = [P[k].day_mean(d) for k in ('shep', 'mill', 'ant', 'cat')]
        return None if any(v is None for v in vs) else sum(vs)

    rows = []
    D = {}
    for d in days:
        steady = not (P['por_cur'].event_day(d) or P['shep'].event_day(d) or P['mill'].event_day(d))
        po, pc = P['por_old'].day_mean(d), P['por_cur'].day_mean(d)
        us = [U(prev_day(d, g)) for g in (0, 1, 2)]
        D[d] = dict(steady=steady, revised=d in revdays, po=po, pc=pc, u=us)
        rows.append(dict(day_utc=d, steady=1 if steady else 0, revised=1 if d in revdays else 0, por_old=po, por_current=pc,
                         u_lag0=us[0], u_lag1=us[1], u_lag2=us[2]))
    n = write_table('R4_a_days', ['day_utc', 'steady', 'revised', 'por_old', 'por_current', 'u_lag0', 'u_lag1', 'u_lag2'], rows)
    rep.append('R4_a_days rows %d; steady %d; steady revised %d; steady unrevised %d' % (
        n, sum(1 for d in D.values() if d['steady']), sum(1 for d in D.values() if d['steady'] and d['revised']),
        sum(1 for d in D.values() if d['steady'] and not d['revised'])))
    b_u = max(gauge_band_on(c, g, '2026-11-22') for g in (SHEP, MILL, ANT, CAT))
    M.add('R4', 'b_u_a', b_u)
    rows = []
    for g in (0, 1, 2):
        def ratios(sel, kind):
            out = []
            for d in days:
                x = D[d]
                if not sel(x):
                    continue
                u = x['u'][g]
                num = x['po'] if kind == 'old' else x['pc']
                if u is None or num is None:
                    continue
                out.append((d, num / u))
            return out
        rev = [d for d in days if D[d]['steady'] and D[d]['revised']]
        ro = ratios(lambda x: x['steady'] and x['revised'], 'old')
        rn = ratios(lambda x: x['steady'] and x['revised'], 'new')
        # days where both defined
        dboth = sorted(set(d for d, _ in ro) & set(d for d, _ in rn))
        mo = median([v for d, v in ro if d in dboth]) if dboth else None
        mn = median([v for d, v in rn if d in dboth]) if dboth else None
        unrev = ratios(lambda x: x['steady'] and not x['revised'], 'new')
        b_por = max([band_of_d for band_of_d in [gauge_band_on(c, POR, d) for d in rev]]) if rev else None
        centres = [('fixed', 1.03)]
        if len(unrev) >= 10:
            centres.append(('empirical', median([v for _, v in unrev])))
        M.add('R4', 'n_steady_unrevised_days_ratio_new', len(unrev), 'lag%d' % g)
        for ck, cc in centres:
            for bk in ('ratings', 'fixed_0113'):
                b = math.sqrt(b_por ** 2 + b_u ** 2) if (bk == 'ratings' and b_por is not None) else (0.113 if bk == 'fixed_0113' else None)
                if mo is None or b is None:
                    oi = ni = None
                    verdict = 'undetermined'
                else:
                    lo, hi = cc / (1 + b), cc * (1 + b)
                    oi = 1 if lo <= mo <= hi else 0
                    ni = 1 if lo <= mn <= hi else 0
                    verdict = 'B supported' if (ni == 1 and oi == 0) else ('A supported' if (oi == 1 and ni == 0) else 'undetermined')
                rows.append(dict(lag=g, centre_kind=ck, band_kind=bk, median_ratio_old=mo, median_ratio_new=mn, n_days=len(dboth),
                                 b_por=b_por, b_u=b_u, b=b, old_inside_band=oi, new_inside_band=ni, verdict=verdict, c=cc))
    rows.sort(key=lambda r: (r['lag'], r['centre_kind'], r['band_kind']))
    n = write_table('R4_a_verdicts', ['lag', 'centre_kind', 'band_kind', 'median_ratio_old', 'median_ratio_new', 'n_days', 'b_por', 'b_u', 'b',
                                      'old_inside_band', 'new_inside_band', 'verdict', 'c'], rows)
    rep.append('R4_a_verdicts rows %d' % n)

    # ------------------------------------------------------------ (b)
    dlist = days_between('2026-09-01', day_of(CUTOFF))
    trib_names = ('mono', 'goose', 'br', 'sen')

    def trib(d):
        vs = [P[k].day_mean(d) for k in trib_names]
        return None if any(v is None for v in vs) else sum(vs)

    rows = []
    wflag_dates = set()
    for D_ in dlist:
        w = w_cfs(c, D_)
        if w is None:
            continue
        lf = P['lf'].day_mean(D_)
        if lf is None or P['lf'].event_day(D_):
            continue
        for g in (1, 2, 3):
            dg = prev_day(D_, g)
            pc = P['por_cur'].day_mean(dg)
            tr = trib(dg)
            if pc is None or tr is None or P['por_cur'].event_day(dg):
                continue
            po = P['por_old'].day_mean(dg)
            rows.append(dict(day_utc=D_, lag=g, revised=1 if dg in revdays else 0, lf=lf, por_old=po, por_current=pc, trib=tr, w_cfs=w,
                             resid_old=(lf - (po + tr - w)) if po is not None else None, resid_new=lf - (pc + tr - w)))
            if w_flagged(c, D_):
                wflag_dates.add(D_)
    rows.sort(key=lambda r: (r['day_utc'], r['lag']))
    n = write_table('R4_b_days', ['day_utc', 'lag', 'revised', 'lf', 'por_old', 'por_current', 'trib', 'w_cfs', 'resid_old', 'resid_new'], rows)
    rep.append('R4_b_days rows %d' % n)
    M.add('R4', 'n_flagged_w_values_used_b', len(wflag_dates))
    vrows = []
    for g in (1, 2, 3):
        sub = [r for r in rows if r['lag'] == g]
        for sset, rv in (('revised', 1), ('unrevised', 0)):
            ss = [r for r in sub if r['revised'] == rv and r['resid_old'] is not None]
            if ss:
                mlf = median([r['lf'] for r in ss])
                mo_ = median([r['resid_old'] for r in ss])
                mn_ = median([r['resid_new'] for r in ss])
                meo = mean([r['resid_old'] for r in ss])
                men = mean([r['resid_new'] for r in ss])
                bpor = max(gauge_band_on(c, POR, r['day_utc']) for r in ss)
                blf = max(gauge_band_on(c, LF, r['day_utc']) for r in ss)
                bpor_dg = max(gauge_band_on(c, POR, prev_day(r['day_utc'], g)) for r in ss)
                if bpor_dg != bpor:
                    rep.append('R4(b) NOTE lag %d set %s: PoR band at day D = %s but at day D-g = %s' % (g, sset, bpor, bpor_dg))
                bR = math.sqrt(bpor ** 2 + blf ** 2)
                key = 'lag%d_%s' % (g, sset)
                M.add('R4', 'median_resid_old_pct_of_median_lf', mo_ / mlf * 100, key)
                M.add('R4', 'median_resid_new_pct_of_median_lf', mn_ / mlf * 100, key)
                M.add('R4', 'mean_resid_old_pct_of_median_lf', meo / mlf * 100, key)
                M.add('R4', 'mean_resid_new_pct_of_median_lf', men / mlf * 100, key)
            for bk in ('fixed_0113', 'ratings'):
                if not ss:
                    vrows.append(dict(lag=g, set=sset, band_kind=bk, n_days=0))
                    continue
                b = bR if bk == 'ratings' else 0.113
                band = b * mlf
                verdict = None
                if sset == 'revised':
                    if abs(mn_) <= band and abs(mo_) > band:
                        verdict = 'B supported'
                    elif abs(mo_) <= band and abs(mn_) > band:
                        verdict = 'A supported'
                    else:
                        verdict = 'undetermined'
                vrows.append(dict(lag=g, set=sset, band_kind=bk, n_days=len(ss), median_lf=mlf, median_resid_old=mo_, median_resid_new=mn_,
                                  mean_resid_old=meo, mean_resid_new=men, b=b, band_cfs=band, verdict=verdict))
        aft = [r['resid_new'] for r in sub if r['day_utc'] > '2026-11-09' and r['resid_new'] is not None]
        M.add('R4', 'median_resid_new_after_nov9', median(aft) if aft else None, 'lag%d' % g)
        M.add('R4', 'n_after_nov9', len(aft), 'lag%d' % g)
    vrows.sort(key=lambda r: (r['lag'], r['set'], r['band_kind']))
    n = write_table('R4_b_verdicts', ['lag', 'set', 'band_kind', 'n_days', 'median_lf', 'median_resid_old', 'median_resid_new', 'mean_resid_old',
                                      'mean_resid_new', 'b', 'band_cfs', 'verdict'], vrows)
    rep.append('R4_b_verdicts rows %d' % n)

    # ------------------------------------------------------------ (c)
    t1 = t1_values(c)
    lft = c.cur_times[(LF, '00060')]
    rows = []
    dropped_t1 = dropped_w = 0
    wflag_c = set()
    for seq in c.seqs:
        r = c.run_by_seq[seq]
        due = ts(r['due_utc'])
        if seq == 212:
            own = t1_s0_interp(c, due)
            M.add('R4', 't1_s0_logged_seq212', own)
            M.add('R4', 't1_s0_replayed_seq212', t1[(212, 'S0')])
            T = own
        else:
            T = t1[(seq, 'S0')]
        if T is None:
            dropped_t1 += 1
            continue
        dd = day_of(due)
        W = w_cfs(c, dd)
        if W is None:
            dropped_w += 1
            continue
        if w_flagged(c, dd):
            wflag_c.add(dd)
        raw = float(r['raw_cfs'])
        rows.append(dict(seq=seq, at_utc=iso(ts(r['at_utc']), ms=True), phase=c.phase[seq], gate_miss=c.gate_miss[seq], raw_cfs=raw, t1=T, w_cfs=W,
                         e_raw=(raw - T) / T * 100, e_adj=(raw - (T + W)) / (T + W) * 100, _due=dd, _day=day_of(ts(r['at_utc']))))
    n = write_table('R4_c_runs', ['seq', 'at_utc', 'phase', 'gate_miss', 'raw_cfs', 't1', 'w_cfs', 'e_raw', 'e_adj'], rows)
    rep.append('R4_c_runs rows %d; dropped for blank T1: %d; dropped for missing W: %d' % (n, dropped_t1, dropped_w))
    M.add('R4', 'n_runs_dropped_blank_t1', dropped_t1)
    M.add('R4', 'n_runs_dropped_missing_w', dropped_w)
    M.add('R4', 'n_flagged_w_values_used_c', len(wflag_c))
    for ph in PHASE_ORDER:
        sub = [r for r in rows if r['phase'] == ph]
        M.add('R4', 'n', len(sub), ph)
        for nm, fn in (('mean_e_raw', lambda r: r['e_raw']), ('mean_e_adj', lambda r: r['e_adj']),
                       ('mean_abs_e_raw', lambda r: abs(r['e_raw'])), ('mean_abs_e_adj', lambda r: abs(r['e_adj']))):
            vals = [(r['_day'], fn(r)) for r in sub]
            lo, hi, _ = boot_mean_ci(vals)
            M.add('R4', nm, mean([v for _, v in vals]) if vals else None, ph)
            M.add('R4', nm + '_lo', lo, ph)
            M.add('R4', nm + '_hi', hi, ph)
    new = [r for r in rows if r['phase'] == 'NEW']
    byd = collections.defaultdict(list)
    for r in new:
        byd[r['_due']].append(r['raw_cfs'] - r['t1'])
    dd_ = sorted(byd)
    mm = [mean(byd[d]) for d in dd_]
    ww = [w_cfs(c, d) for d in dd_]
    M.add('R4', 'n_days', len(dd_), 'day_to_day_NEW')
    M.add('R4', 'pearson_m_on_w', pearson(ww, mm), 'day_to_day_NEW')
    M.add('R4', 'slope_m_on_w', ols_slope(ww, mm), 'day_to_day_NEW')
    M.add('R4', 'sd_w_cfs', sd(ww), 'day_to_day_NEW')
    M.add('R4', 'sd_m_cfs', sd(mm), 'day_to_day_NEW')
