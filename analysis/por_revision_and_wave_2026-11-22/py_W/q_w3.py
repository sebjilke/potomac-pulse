"""Question W3."""
from ppw import *
from q_w12 import *

PAIRS = [('PoR-EF', (POR, '00065'), POR, (EF, '00065'), EF), ('EF-LF', (EF, '00065'), EF, (LF, '00065'), LF),
         ('PoR-LF', (POR, '00065'), POR, (LF, '00065'), LF)]
WINS = {'nov_all': ('2026-11-01', '2026-11-22'), 'nov_pre': ('2026-11-01', '2026-11-13'), 'nov_post': ('2026-11-14', '2026-11-22')}

def onsets(s):
    N = s.N; h24 = int(24 * 3600 // s.step); w72 = int(72 * 3600 // s.step)
    out = []; last = None
    for i in range(N):
        a = s.ma[i]
        b = s.ma[i + h24] if i + h24 < N else None
        if a is not None and b is not None and b - a >= 0.10:
            if last is None or i - last > w72:
                out.append(i)
            last = i
    return out

def run(ctx):
    days = ctx['days']
    # ---- (2) legs
    xr = []; xm = []; lagmod = {}
    for pname, kx, gx, ky, gy in PAIRS:
        for wn, (a, b) in WINS.items():
            interp_x = ctx['SER'][kx].step == 900; interp_y = ctx['SER'][ky].step == 900
            res, lags, cs = lag_scan(ctx, kx, gx, ky, gy, dn_of(a), dn_of(b), 0, 72 * 3600, 300, force5=True, interp_x=interp_x, interp_y=interp_y)
            bst = best_lag(res, lags, cs)
            lh = bst[1] * cs / 3600.0
            xr.append([pname, wn, lh, bst[2], lh % 24, res[bst[1]][1]])
            lagmod[(pname, wn)] = lh % 24
            for L in local_maxima(res, lags):
                if res[L][0] >= 0.3: xm.append([pname, wn, L * cs / 3600.0, res[L][0]])
    n = write_table('W3_xcorr', ['pair', 'window', 'lag_h_of_max_r', 'max_r', 'lag_h_mod_24', 'n_points'], sorted(xr, key=lambda r: (r[0], r[1])))
    log('W3_xcorr rows %d' % n)
    n = write_table('W3_xcorr_maxima', ['pair', 'window', 'lag_h', 'r'], sorted(xm, key=lambda r: (r[0], r[1], r[2])))
    log('W3_xcorr_maxima rows %d' % n)
    legs = wrap12((lagmod[('PoR-EF', 'nov_all')] + lagmod[('EF-LF', 'nov_all')]) % 24 - lagmod[('PoR-LF', 'nov_all')])
    M('W3', '', 'legs_add_up_h', legs)
    # ---- (3) crests
    a, b = dn_of('2026-11-01'), dn_of('2026-11-22')
    rows = []; circ = {}
    for pname, kx, gx, ky, gy in PAIRS:
        diffs = []
        for dn in range(a, b + 1):
            u = days[kx][dn]; d = days[ky][dn]
            if u['event'] or d['event'] or u['crest'] is None or d['crest'] is None: continue
            diffs.append((d['crest'] - u['crest']) % 24)
        rows.append([pname, len(diffs), circ_mean(diffs), circ_sd(diffs)])
        circ[pname] = circ_mean(diffs)
    n = write_table('W3_crests', ['pair', 'n_days', 'circmean_h', 'circ_sd_h'], sorted(rows))
    log('W3_crests rows %d' % n)
    # ---- (1) size
    a, b = dn_of('2026-09-15'), dn_of('2026-11-22')
    rows = []
    for pname, kx, gx, ky, gy in PAIRS:
        for k in range(5):
            xs = []; ys = []
            for dn in range(a, b + 1):
                if dn + k > b: continue
                u = days[kx][dn]; d = days[ky][dn + k]
                if u['event'] or d['event'] or u['A_a'] is None or d['A_a'] is None: continue
                xs.append(u['A_a']); ys.append(d['A_a'])
            rows.append([pname, k, pearson(xs, ys), len(xs)])
    n = write_table('W3_size_lag', ['pair', 'k_days', 'r', 'n_days'], sorted(rows, key=lambda r: (r[0], r[1])))
    log('W3_size_lag rows %d' % n)
    weak = {}; wrows = []
    for gname, kx in (('PoR', (POR, '00065')), ('EF', (EF, '00065')), ('LF', (LF, '00065'))):
        valid = {dn: days[kx][dn]['A_a'] for dn in range(a, b + 1) if not days[kx][dn]['event'] and days[kx][dn]['A_a'] is not None}
        wk = []
        for dn, v in valid.items():
            nb = [valid[x] for x in (dn - 3, dn - 2, dn - 1, dn + 1, dn + 2, dn + 3) if x in valid]
            if len(nb) < 4: continue
            m = median(nb)
            if v < 0.6 * m:
                wk.append(dn); wrows.append([kx[0], day_str(dn), v, m])
        weak[gname] = sorted(wk)
    n = write_table('W3_weak_days', ['gauge', 'day_utc', 'A_a', 'neighbour_median'], sorted(wrows, key=lambda r: (r[0], r[1])))
    log('W3_weak_days rows %d' % n)
    mrows = []
    for dp in weak['PoR']:
        for k in range(5):
            if dp + k in weak['LF']: mrows.append([day_str(dp), day_str(dp + k), k])
    n = write_table('W3_weak_matches', ['por_day', 'lf_day', 'k_days'], mrows)
    log('W3_weak_matches rows %d' % n)
    por_with = set(r[0] for r in mrows)
    ks = set(r[2] for r in mrows)
    decisive = 1 if (len(por_with) >= 2 and len(ks) == 1) else 0
    M('W3', '', 'size_method_decisive', decisive)
    kdays = list(ks)[0] if decisive else None
    if decisive: M('W3', '', 'size_method_k_days', kdays)
    M('W3', '', 'n_por_weak_days', len(weak['PoR'])); M('W3', '', 'n_lf_weak_days', len(weak['LF'])); M('W3', '', 'n_por_weak_days_with_match', len(por_with))
    # ---- (4) onsets
    S4 = ctx['SER4']; sp = S4[(POR, '00065')]; sl = S4[(LF, '00065')]; sf = S4[(LF, '00060')]
    assert sp.step == sl.step == sf.step == 300
    op = onsets(sp); ol = onsets(sl)
    rows = []; lags = []; lags3 = []
    for i in op:
        t = sp.t(i)
        match = None
        for j in ol:
            tl = sl.t(j)
            if 0 <= tl - t <= 96 * 3600: match = j; break
        if match is None:
            rows.append([iso(t), None, None, sp.ma[i], None, None])
        else:
            tl = sl.t(match)
            fl = sf.ma[int(round((tl - sf.t0) / sf.step))]
            lh = (tl - t) / 3600.0
            rows.append([iso(t), iso(tl), lh, sp.ma[i], sl.ma[match], fl])
            lags.append(lh)
            if fl is not None and fl < 3000: lags3.append(lh)
    n = write_table('W3_onsets', ['por_onset_utc', 'lf_onset_utc', 'lag_h', 'por_ma_level_ft', 'lf_ma_level_ft', 'lf_ma_flow_cfs'], rows)
    log('W3_onsets rows %d' % n)
    M('W3', '', 'n_por_onsets', len(op)); M('W3', '', 'n_matched', len(lags)); M('W3', '', 'median_lag_h', median(lags))
    M('W3', '', 'n_matched_below_3000', len(lags3)); M('W3', '', 'median_lag_h_below_3000', median(lags3))
    M('W3', '', 'n_lf_onsets', len(ol))
    # ---- decision
    pl = lagmod[('PoR-LF', 'nov_all')]
    cm = circ['PoR-LF']
    agree = cm is not None and abs(wrap12(pl - cm)) <= 2.0
    hwd = pl if agree else 'disagree'
    h = hwd if not isinstance(hwd, str) else pl
    n1 = None
    if decisive: n1 = kdays if h < 12 else kdays - 1
    n4 = None
    if len(lags3) >= 3: n4 = round_half_away((median(lags3) - h) / 24.0)
    ex = [x for x in (n1, n4) if x is not None]
    if len(ex) == 2: resolved = n1 == n4
    else: resolved = len(ex) == 1
    status = 'resolved' if resolved else 'unresolved'
    wd = ex[0] if resolved else None
    tot = 24 * wd + h if resolved else None
    M('W3', '', 'hours_within_day', hwd); M('W3', '', 'h', h); M('W3', '', 'n1', n1); M('W3', '', 'n4', n4)
    M('W3', '', 'whole_days_status', status); M('W3', '', 'whole_days', wd); M('W3', '', 'total_delay_h', tot)
    ctx['w3'] = dict(total_delay_h=tot, status=status)
    # ---- model times
    rows = []
    for p in ('NEW', 'OLD', 'TRANS'):
        rs = [r for r in ctx['runs'] if ctx['phase'][r['seq_i']] == p]
        def mm(f):
            v = [f(r) for r in rs if f(r) is not None]
            return mean(v)
        fl = lambda c: (lambda r: float(r[c]) if r[c] != '' else None)
        tot_ = lambda r: (float(r['trv_t']) + float(r['trv_gf2lf'])) if (r['trv_t'] != '' and r['trv_gf2lf'] != '') else None
        rows.append([p, len(rs), mm(fl('trv_t')), mm(fl('trv_gf2lf')), mm(tot_), mm(fl('hist_ago'))])
    n = write_table('W3_model_times', ['phase', 'n', 'mean_trv_t', 'mean_trv_gf2lf', 'mean_total', 'mean_hist_ago'], rows)
    log('W3_model_times rows %d' % n)
    # ---- damping
    rows = []
    for p in ('P4', 'P5', 'P6', 'P7'):
        a, b = PER[p]
        dd = []
        for dn in range(a, b + 1):
            fl_ = days[(LF, '00060')][dn]; fp = days[(POR, '00060')][dn]
            lp = days[(POR, '00065')][dn]; ll = days[(LF, '00065')][dn]
            if fl_['event'] or fp['event']: continue
            if fl_.get('A_a_rel') is None or fp.get('A_a_rel') is None or lp['A_a'] is None or ll['A_a'] is None: continue
            dd.append(dn)
        ef = [days[(EF, '00065')][dn]['A_a'] for dn in dd if not days[(EF, '00065')][dn]['event'] and days[(EF, '00065')][dn]['A_a'] is not None]
        ml = median([days[(LF, '00060')][dn]['A_a_rel'] for dn in dd]); mp = median([days[(POR, '00060')][dn]['A_a_rel'] for dn in dd])
        rows.append([p, len(dd), ml, mp, (ml / mp) if (ml is not None and mp) else None,
                     median([days[(POR, '00065')][dn]['A_a'] for dn in dd]), median(ef), median([days[(LF, '00065')][dn]['A_a'] for dn in dd])])
    n = write_table('W3_damping', ['period', 'n_days', 'median_A_a_rel_lf_flow', 'median_A_a_rel_por_flow', 'ratio_lf_over_por',
                                   'median_A_a_por_level', 'median_A_a_ef_level', 'median_A_a_lf_level'], rows)
    log('W3_damping rows %d' % n)
