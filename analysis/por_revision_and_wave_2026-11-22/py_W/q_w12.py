"""Questions W1 and W2 (and series preparation shared with W3)."""
from ppw import *

POR, EF, LF = '01638500', '01644148', '01646500'
UP = ['01618000', '01613000', '01610000', '01636500', '01619500', '01614500', '01616500', '01637500']
CUT = '2026-11-22T10:00:00Z'

PERIODS = {'P1': ('2026-09-01', '2026-09-14'), 'P2': ('2026-09-15', '2026-10-11'), 'P3': ('2026-10-12', '2026-10-21'),
           'P4': ('2026-10-22', '2026-10-31'), 'P5': ('2026-11-01', '2026-11-09'), 'P6': ('2026-11-10', '2026-11-13'),
           'P7': ('2026-11-14', '2026-11-22'), 'P5toP7': ('2026-11-01', '2026-11-22')}
PER = {k: (dn_of(a), dn_of(b)) for k, (a, b) in PERIODS.items()}

def load_all(ctx):
    model = load_table('readings_current_model', [(POR, '00065'), (POR, '00010'), (EF, '00065'), (LF, '00065')], '2026-06-12T00:00:00Z', CUT)
    census = load_table('readings_current_census', [(POR, '00060'), (LF, '00060')], '2024-11-22T00:00:00Z', CUT)
    up = load_table('readings_current_upstream', [(g, p) for g in UP for p in ('00060', '00065')], '2026-09-01T00:00:00Z', CUT)
    ctx['lf_flow_all'] = census[(LF, '00060')]
    raw = {}; raw.update(model); raw.update(census); raw.update(up)
    ctx['raw'] = raw
    SER = {}
    for k, rd in raw.items():
        SER[k] = Series(k, rd, START, END)
    ctx['SER'] = SER
    SER4 = {}
    for k in [(POR, '00065'), (LF, '00065'), (LF, '00060')]:
        SER4[k] = Series(k, raw[k], START4, END)
    ctx['SER4'] = SER4
    prep = []
    for k, s in sorted(SER.items()): prep.append(('Sep1-Nov22 window', k[0], k[1], s.step // 60, s.n_readings, s.N, s.n_present, s.n_filled, s.n_missing))
    for k, s in sorted(SER4.items()): prep.append(('Jun12-Nov22 window', k[0], k[1], s.step // 60, s.n_readings, s.N, s.n_present, s.n_filled, s.n_missing))
    with open(OUT + 'prep_counts.csv', 'w', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(['window', 'gauge', 'parameter', 'step_min', 'n_readings', 'n_grid', 'n_present', 'n_filled', 'n_missing'])
        for r in prep: w.writerow(r)
    for r in prep: log('prep ' + ' '.join(map(str, r)))

def event_day(ctx, gauge, dn):
    SER = ctx['SER']
    if gauge == EF: return SER[(EF, '00065')].event_level_abs(dn)
    return SER[(gauge, '00060')].event_flow(dn)

def build_days(ctx):
    SER = ctx['SER']
    info = {}
    for k, s in SER.items():
        isflow = k[1] == '00060'
        d = {}
        for dn in s.days():
            x = s.day_info(dn, want_b=(k[1] != '00010'))
            x['event'] = event_day(ctx, k[0], dn)
            d[dn] = x
        info[k] = d
    ctx['days'] = info

def nonevent_days(ctx, k, a, b):
    d = ctx['days'][k]
    return [dn for dn in range(a, b + 1) if dn in d and not d[dn]['event'] and d[dn]['A_a'] is not None]

def period_rows(ctx, keys, pname):
    rows = []
    for k in sorted(keys):
        d = ctx['days'][k]
        isflow = k[1] == '00060'
        for p in ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']:
            a, b = PER[p]
            ne = nonevent_days(ctx, k, a, b)
            aa = [d[x]['A_a'] for x in ne]
            rel = [d[x]['A_a_rel'] for x in ne if d[x].get('A_a_rel') is not None] if isflow else []
            ab = [d[x]['A_b'] for x in ne if d[x]['A_b'] is not None]
            cu = [d[x]['crest'] for x in ne if d[x]['crest'] is not None]
            cl = [d[x]['crest_local'] for x in ne if d[x]['crest'] is not None]
            tu = [d[x]['trough'] for x in ne if d[x]['trough'] is not None]
            tl = [d[x]['trough_local'] for x in ne if d[x]['trough'] is not None]
            rows.append([k[0], k[1], p, b - a + 1, len(ne), median(aa), median(rel) if isflow else None, median(ab),
                         circ_mean(cu), circ_mean(cl), circ_mean(tu), circ_mean(tl)])
    return rows

def daily_rows(ctx, keys):
    rows = []
    for k in sorted(keys):
        s = ctx['SER'][k]; d = ctx['days'][k]; isflow = k[1] == '00060'
        for dn in s.days():
            x = d[dn]
            rows.append([k[0], k[1], day_str(dn), s.step // 60, x['n_present'], x['day_mean'], x['A_a'],
                         x.get('A_a_rel') if isflow else None, x['A_b'], x['phi_b'], x['crest'], x.get('crest_local'),
                         x['trough'], x.get('trough_local'), 1 if x['event'] else 0, weekday(dn)])
    return rows

DCOLS = ['gauge', 'parameter', 'day_utc', 'step_min', 'n_present', 'day_mean', 'A_a', 'A_a_rel', 'A_b', 'phi_b_utc_h',
         'crest_utc_h', 'crest_local_h', 'trough_utc_h', 'trough_local_h', 'event_day', 'weekday_utc']
PCOLS = ['gauge', 'parameter', 'period', 'n_days', 'n_non_event', 'median_A_a', 'median_A_a_rel', 'median_A_b',
         'crest_utc_h_circmean', 'crest_local_h_circmean', 'trough_utc_h_circmean', 'trough_local_h_circmean']

W1_KEYS = [(POR, '00065'), (POR, '00060'), (EF, '00065'), (LF, '00065'), (LF, '00060')]
W2_KEYS = [(g, p) for g in UP for p in ('00060', '00065')]

# ---- masked detrended arrays for lagged correlation
def masked_d(ctx, k, dayA, dayB, common_step, gauge_for_flag, interp5=False):
    """detrended values on the common grid (start-aligned), restricted to non-event days inside [dayA, dayB].
    Returns (list, index offset of first element) trimmed to the window days."""
    s = ctx['SER'][k]
    d = s.d
    if interp5:
        assert s.step == 900 and common_step == 300
        d5 = [None] * (len(d) * 3 - 2)
        for i, v in enumerate(d):
            d5[3 * i] = v
            if i + 1 < len(d) and v is not None and d[i + 1] is not None:
                d5[3 * i + 1] = v + (d[i + 1] - v) / 3.0
                d5[3 * i + 2] = v + (d[i + 1] - v) * 2 / 3.0
        d = d5; step = 300
    else:
        step = s.step
    ev = {dn: event_day(ctx, gauge_for_flag, dn) for dn in range(dayA, dayB + 1)}
    f = common_step // step
    assert f * step == common_step
    lo = int(round((dayA * 86400 - START) / common_step)); hi = int(round(((dayB + 1) * 86400 - START) / common_step)) - 1
    out = []
    for i in range(lo, hi + 1):
        j = i * f
        t = START + i * common_step
        dn = int(t // 86400)
        v = d[j] if j < len(d) else None
        out.append(None if (v is None or ev[dn]) else v)
    return out

def lag_scan(ctx, kx, gx, ky, gy, dayA, dayB, lag_lo_s, lag_hi_s, lag_step_s, force5=False, interp_x=False, interp_y=False):
    sx = ctx['SER'][kx]; sy = ctx['SER'][ky]
    if force5: cs = 300
    else: cs = 300 if (sx.step == 300 and sy.step == 300) else 900
    X = masked_d(ctx, kx, dayA, dayB, cs, gx, interp5=interp_x)
    Y = masked_d(ctx, ky, dayA, dayB, cs, gy, interp5=interp_y)
    assert lag_step_s % cs == 0
    lags = list(range(lag_lo_s // cs, lag_hi_s // cs + 1, lag_step_s // cs))
    res = lagcorr(X, Y, lags)
    return res, lags, cs

def best_lag(res, lags, cs, absmode=False):
    best = None
    for L in lags:
        r = res[L][0]
        if r is None: continue
        key = rnd9(abs(r) if absmode else r)
        if best is None or key > best[0] or (key == best[0] and (abs(L), L < 0) < (abs(best[1]), best[1] < 0)):
            best = (key, L, r)
    return best

def run(ctx):
    load_all(ctx)
    build_days(ctx)
    SER = ctx['SER']; days = ctx['days']
    # ---------------- W1
    n = write_table('W1_daily', DCOLS, sorted(daily_rows(ctx, W1_KEYS), key=lambda r: (r[0], r[1], r[2])))
    log('W1_daily rows %d' % n)
    n = write_table('W1_periods', PCOLS, period_rows(ctx, W1_KEYS, 'W1'))
    log('W1_periods rows %d' % n)
    # weekday
    rows = []
    for k in sorted(W1_KEYS):
        for wname in ('P2', 'P5toP7'):
            a, b = PER[wname]
            ne = nonevent_days(ctx, k, a, b)
            for wd in range(7):
                v = [days[k][dn]['A_a'] for dn in ne if weekday(dn) == wd]
                rows.append([k[0], k[1], wname, wd, len(v), median(v)])
    n = write_table('W1_weekday', ['gauge', 'parameter', 'window', 'weekday_utc', 'n_days', 'median_A_a'], rows)
    log('W1_weekday rows %d' % n)
    # metrics
    vals = sorted(set(v for t, v in ctx['lf_flow_all'] if parse_iso('2026-11-10T00:00:00Z') <= t <= END))
    diffs = [b - a for a, b in zip(vals, vals[1:])]
    step = median(diffs)
    M('W1', '', 'lf_flow_step_cfs', step)
    ne = nonevent_days(ctx, (LF, '00060'), dn_of('2026-11-10'), dn_of('2026-11-22'))
    medA = median([days[(LF, '00060')][dn]['A_a'] for dn in ne])
    M('W1', '', 'lf_median_A_a_in_steps', medA / step if medA is not None else None)
    M('W1', '', 'lf_flow_n_distinct_values_10to22Nov', len(vals))
    M('W1', '', 'lf_median_A_a_cfs_10to22Nov', medA)
    M('W1', '', 'lf_n_non_event_days_10to22Nov', len(ne))
    # ---------------- W2
    n = write_table('W2_daily', DCOLS, sorted(daily_rows(ctx, W2_KEYS), key=lambda r: (r[0], r[1], r[2])))
    log('W2_daily rows %d' % n)
    n = write_table('W2_periods', PCOLS, period_rows(ctx, W2_KEYS, 'W2'))
    log('W2_periods rows %d' % n)
    # clock test
    clock_keys = [(POR, '00065'), (EF, '00065'), (LF, '00065'), (LF, '00060'), (POR, '00060')] + [(g, '00065') for g in UP]
    bef = (dn_of('2026-10-22'), dn_of('2026-10-31')); aft = (dn_of('2026-11-02'), dn_of('2026-11-11'))
    rows = []
    for k in sorted(clock_keys):
        d = days[k]
        nb = nonevent_days(ctx, k, *bef); na = nonevent_days(ctx, k, *aft)
        out = [k[0], k[1], len(nb), len(na)]
        for field, crest in (('crest', True), ('trough', False)):
            cb = [d[x]['crest' if crest else 'trough'] for x in nb if d[x]['crest'] is not None]
            ca = [d[x]['crest' if crest else 'trough'] for x in na if d[x]['crest'] is not None]
            mb = circ_mean(cb); ma_ = circ_mean(ca)
            shift = wrap12(ma_ - mb) if (mb is not None and ma_ is not None) else None
            lo = hi = None
            if shift is not None and cb and ca:
                D1, D2 = len(cb), len(ca)
                def f(d1, d2, cb=cb, ca=ca):
                    r2 = [ca[i] for i in d1]; r1 = [cb[i] for i in d2]
                    return wrap12(circ_mean(r2) - circ_mean(r1))
                vals_ = boot_vec(D2, D1, f)
                lo, hi, sk = interval(vals_, 'W2_clock %s %s %s' % (k[0], k[1], field))
            if shift is None or len(nb) < 4 or len(na) < 4 or lo is None: lab = 'undetermined'
            elif lo >= 0.5 and hi <= 1.5: lab = 'follows the clock'
            elif lo >= -0.5 and hi <= 0.5: lab = 'does not'
            else: lab = 'undetermined'
            out += [mb, ma_, shift, lo, hi, lab]
        rows.append(out)
    n = write_table('W2_clock', ['gauge', 'parameter', 'n_before', 'n_after', 'crest_before', 'crest_after', 'shift_crest', 'lo', 'hi', 'label_crest',
                                 'trough_before', 'trough_after', 'shift_trough', 'lo_t', 'hi_t', 'label_trough'], rows)
    log('W2_clock rows %d' % n)
    # weekend
    rows = []
    for k in sorted(W1_KEYS + W2_KEYS):
        for wname in ('P2', 'P5toP7'):
            a, b = PER[wname]
            ne = nonevent_days(ctx, k, a, b)
            wk = [days[k][dn]['A_a'] for dn in ne if weekday(dn) < 5]
            we = [days[k][dn]['A_a'] for dn in ne if weekday(dn) >= 5]
            mw, me = median(wk), median(we)
            rows.append([k[0], k[1], wname, mw, me, len(wk), len(we), (me / mw) if (mw not in (None, 0) and me is not None) else None])
    n = write_table('W2_weekend', ['gauge', 'parameter', 'window', 'median_A_a_weekdays', 'median_A_a_weekend', 'n_weekdays', 'n_weekend', 'ratio'], rows)
    log('W2_weekend rows %d' % n)
    # instrument test
    a, b = PER['P5toP7']
    res, lags, cs = lag_scan(ctx, (POR, '00065'), POR, (POR, '00010'), POR, a, b, -12 * 3600, 12 * 3600, 900)
    r0 = res[0]
    M('W2', '', 'r_lag0', r0[0]); M('W2', '', 'n_points_lag0', r0[1])
    bst = best_lag(res, lags, cs, absmode=True)
    M('W2', '', 'lag_of_max_abs_r_h', bst[1] * cs / 3600.0 if bst else None)
    M('W2', '', 'max_abs_r', abs(bst[2]) if bst else None)
    M('W2', '', 'instrument_grid_step_min', cs // 60)
    M('W2', '', 'instrument_max_abs_r_signed', bst[2] if bst else None)
    for p in ('P5', 'P6', 'P7'):
        ne = nonevent_days(ctx, (POR, '00010'), *PER[p])
        M('W2', p, 'median_A_a_temp_c', median([days[(POR, '00010')][dn]['A_a'] for dn in ne]))
        M('W2', p, 'n_non_event_temp', len(ne))
    # passage upstream
    rows = []; rmax = []
    for g in sorted(UP):
        res, lags, cs = lag_scan(ctx, (g, '00065'), g, (POR, '00065'), POR, a, b, 0, 72 * 3600, 900)
        bst = best_lag(res, lags, cs)
        if bst:
            lh = bst[1] * cs / 3600.0
            rows.append([g, lh, bst[2], lh % 24, res[bst[1]][1]])
        else:
            rows.append([g, None, None, None, None])
        for L in local_maxima(res, lags):
            if res[L][0] >= 0.3: rmax.append([g, L * cs / 3600.0, res[L][0]])
    n = write_table('W2_xcorr_upstream', ['gauge', 'lag_h_of_max_r', 'max_r', 'lag_h_mod_24', 'n_points'], rows)
    log('W2_xcorr_upstream rows %d' % n)
    n = write_table('W2_xcorr_upstream_maxima', ['gauge', 'lag_h', 'r'], sorted(rmax, key=lambda r: (r[0], r[1])))
    log('W2_xcorr_upstream_maxima rows %d' % n)
