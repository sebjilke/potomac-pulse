"""Questions W4, W5, W6."""
from ppw import *
from q_w12 import *
from rundata import read_csv

def f_(x):
    return float(x) if x != '' else None

def lf_interp_factory(ctx):
    lf = ctx['lf_flow_all']
    ts = [t for t, v in lf]
    def interp(t):
        k = bisect.bisect_left(ts, t)
        if k < len(ts) and ts[k] == t: return lf[k][1]
        if k == 0 or k >= len(ts): return None
        t1, v1 = lf[k - 1]; t2, v2 = lf[k]
        return v1 + (v2 - v1) * (t - t1) / (t2 - t1)
    return interp

def setup(ctx):
    interp = lf_interp_factory(ctx)
    # check own interpolation against truth.csv (S0, all rows except 212)
    mx = 0.0; nchk = 0
    for (seq, sc), r in ctx['truth'].items():
        if r['t1_lf_cfs_interpolated'] == '' or sc != 'S0' or seq == 212: continue
        v = interp(parse_iso(r['due_utc']))
        if v is not None:
            mx = max(mx, abs(v - float(r['t1_lf_cfs_interpolated']))); nchk += 1
    log('own LF interpolation vs truth.csv T1 (S0 rows, excl 212): n=%d max abs diff=%.6g cfs' % (nchk, mx))
    t212_truth = ctx['truth'][(212, 'S0')]
    run212 = ctx['runs_by_seq'][212]
    mine = interp(run212['due_t'])
    log('seq 212: truth.csv S0 due_utc=%s T1=%s ; runs.due_utc=%s own T1=%s' % (t212_truth['due_utc'], t212_truth['t1_lf_cfs_interpolated'], run212['due_utc'], mine))
    ctx['interp'] = interp
    M('W4', '', 'seq212_t1_truth_csv_replayed_due', f_(t212_truth['t1_lf_cfs_interpolated']))
    M('W4', '', 'seq212_t1_own_at_runs_due_utc', mine)
    W4 = []; dropped = []
    for r in ctx['runs']:
        sq = r['seq_i']
        t1 = f_(ctx['truth'][(sq, 'S0')]['t1_lf_cfs_interpolated'])
        if sq == 212: t1 = mine
        if t1 is None: dropped.append(sq); continue
        raw = float(r['raw_cfs']); fin = float(r['final_cfs'])
        W4.append(dict(seq=sq, at_utc=r['at_utc'], due_utc=r['due_utc'], phase=ctx['phase'][sq], gate_miss=ctx['gate_miss'][sq],
                       hour_run=local_hour_int(r['at_t']), hour_due=local_hour_int(r['due_t']), raw=raw, fin=fin,
                       corr_c=f_(r['corr_c']), corr_st=r['corr_st'], ceil_bound=r['ceil_bound'], ceil_lim=f_(r['ceil_lim']),
                       pre=f_(r['pre_cfs']), dr=f_(r['delta_ratio']), t1=t1, e_raw=(raw - t1) / t1 * 100, e_final=(fin - t1) / t1 * 100,
                       day=r['day']))
    ctx['W4'] = W4
    log('W4 runs with T1: %d; dropped (blank T1): %d : %s' % (len(W4), len(dropped), dropped))
    M('W4', '', 'n_runs_with_t1', len(W4)); M('W4', '', 'n_runs_dropped_blank_t1', len(dropped))

def blocks_of(rows, getter):
    """rows: list of dict with 'day'; getter(row)->item or None. returns (U sorted days, list of lists)"""
    U = sorted(set(r['day'] for r in rows))
    idx = {d: i for i, d in enumerate(U)}
    B = [[] for _ in U]
    for r in rows:
        x = getter(r)
        if x is not None: B[idx[r['day']]].append(x)
    return U, B

def cat(B, d):
    return [x for i in d for x in B[i]]

def mae_(es):
    return sum(abs(e) for e in es) / len(es) if es else None

def mean_(es):
    return sum(es) / len(es) if es else None

def interval_boot_single(B, stat, tag):
    """stat(rows)->value; one group"""
    D = len(B)
    vals = boot_vec(D, None, lambda d1, d2: stat(cat(B, d1)))
    return interval(vals, tag)

def cycle_block(ctx, rows, qkey, tag):
    """rows: list of W4 dicts (one phase). returns dict with n, mean, cycle, lo, hi, crest, share, sd"""
    items = [(r['hour_due'], r[qkey]) for r in rows]
    n = len(items)
    m = mean_([v for h, v in items])
    cyc = cycle_of(items)
    U, B = blocks_of(rows, lambda r: (r['hour_due'], r[qkey]))
    lo = hi = None
    if cyc is not None: lo, hi, sk = interval_boot_single(B, cycle_of, tag)
    hm = hourly_means(items)
    valid = {h for h, (k, mm) in hm.items() if k >= 3}
    inv = [(h, v) for h, v in items if h in valid]
    share = sdr = None
    if inv:
        mv = mean_([v for h, v in inv])
        sst = sum((v - mv) ** 2 for h, v in inv); ssw = sum((v - hm[h][1]) ** 2 for h, v in inv)
        share = 1 - ssw / sst if sst > 0 else None
        sdr = sd([v - hm[h][1] for h, v in inv])
    return dict(n=n, mean=m, cycle=cyc, lo=lo, hi=hi, crest=crest_hour_of(items) if cyc is not None else None, share=share, sd=sdr)

def run(ctx):
    setup(ctx)
    W4 = ctx['W4']
    cols = ['seq', 'at_utc', 'due_utc', 'phase', 'gate_miss', 'hour_run', 'hour_due', 'raw_cfs', 'final_cfs', 'corr_c', 'corr_st', 'ceil_bound', 't1', 'e_raw', 'e_final']
    rows = [[r['seq'], r['at_utc'], r['due_utc'], r['phase'], r['gate_miss'], r['hour_run'], r['hour_due'], r['raw'], r['fin'], r['corr_c'], r['corr_st'],
             int(r['ceil_bound']), r['t1'], r['e_raw'], r['e_final']] for r in W4]
    log('W4_runs rows %d' % write_table('W4_runs', cols, rows))
    phases = ('NEW', 'OLD', 'TRANS')
    ph = {p: [r for r in W4 if r['phase'] == p] for p in phases}
    # error by hour
    rows = []
    for p in phases:
        hm_raw = hourly_means([(r['hour_due'], r['e_raw']) for r in ph[p]]); hm_fin = hourly_means([(r['hour_due'], r['e_final']) for r in ph[p]])
        for h in sorted(hm_raw): rows.append([p, h, hm_raw[h][0], hm_raw[h][1], hm_fin[h][1]])
    log('W4_error_by_hour rows %d' % write_table('W4_error_by_hour', ['phase', 'hour_due', 'n', 'mean_e_raw', 'mean_e_final'], sorted(rows, key=lambda r: (r[0], r[1]))))
    # cycle
    rows = []; ctx['cyc'] = {}
    for p in sorted(phases):
        for q in ('e_raw', 'e_final'):
            c = cycle_block(ctx, ph[p], q, 'W4_cycle %s %s' % (p, q))
            ctx['cyc'][(p, q)] = c
            rows.append([p, q, c['n'], c['mean'], c['cycle'], c['lo'], c['hi'], c['crest'], c['share'], c['sd']])
    log('W4_cycle rows %d' % write_table('W4_cycle', ['phase', 'quantity', 'n', 'mean', 'cycle_size', 'lo', 'hi', 'crest_hour', 'share_of_variance_by_hour', 'sd_remainder'], sorted(rows, key=lambda r: (r[0], r[1]))))
    for q in ('e_raw', 'e_final'):
        Un, Bn = blocks_of(ph['NEW'], lambda r: (r['hour_due'], r[q])); Uo, Bo = blocks_of(ph['OLD'], lambda r: (r['hour_due'], r[q]))
        cn = cycle_of(cat(Bn, range(len(Bn)))); co = cycle_of(cat(Bo, range(len(Bo))))
        diff = cn - co if (cn is not None and co is not None) else None
        def f(d1, d2):
            a = cycle_of(cat(Bn, d1)); b = cycle_of(cat(Bo, d2))
            return None if (a is None or b is None) else a - b
        lo, hi, sk = interval(boot_vec(len(Bn), len(Bo), f), 'W4 cycle diff NEW-OLD ' + q)
        M('W4', q, 'cycle_size_diff_new_minus_old', diff); M('W4', q, 'cycle_size_diff_lo', lo); M('W4', q, 'cycle_size_diff_hi', hi)
    # components
    comp_rows = []; cc_rows = []
    qs = [('pre_cfs', 'pre', 'hour_run'), ('delta_ratio', 'dr', 'hour_run'), ('raw_cfs', 'raw', 'hour_run'), ('corr_c', 'corr_c', 'hour_run'),
          ('final_cfs', 'fin', 'hour_run'), ('ceil_lim', 'ceil_lim', 'hour_run'), ('t1', 't1', 'hour_due')]
    for p in ('OLD', 'NEW'):
        for qn, key, hk in qs:
            items = [(r[hk], r[key]) for r in ph[p] if r[key] is not None]
            hm = hourly_means(items)
            for h in sorted(hm): comp_rows.append([p, qn, h, hm[h][0], hm[h][1]])
            cyc = cycle_of(items); mm = mean_([v for h, v in items])
            cc_rows.append([p, qn, mm, cyc, (cyc / mm * 100) if (cyc is not None and mm) else None, crest_hour_of(items) if cyc is not None else None])
    log('W4_components rows %d' % write_table('W4_components', ['phase', 'quantity', 'hour', 'n', 'mean'], sorted(comp_rows, key=lambda r: (r[0], r[1], r[2]))))
    log('W4_component_cycles rows %d' % write_table('W4_component_cycles', ['phase', 'quantity', 'mean', 'cycle_size', 'cycle_size_pct_of_mean', 'crest_hour'], sorted(cc_rows, key=lambda r: (r[0], r[1]))))
    run_w5(ctx)
    run_w6(ctx)

# ======================================================================= W5
UNIVERSES = []

def run_w5(ctx):
    W4 = ctx['W4']; runs = ctx['runs']; phase = ctx['phase']; truth = ctx['truth']; replay = ctx['replay']; cells = ctx['cells']
    W5 = []
    ph = {p: [r for r in W4 if r['phase'] == p] for p in ('NEW', 'OLD')}
    NEW = ph['NEW']; OLD = ph['OLD']

    # ---------- generic comparison engine
    def compare(cand, variant, old_rule, qty, A, B, D1, D2=None, cref=None, label=True):
        """A, B, cref: callables (d1, d2) -> value or None. D1, D2 block counts of the two groups."""
        id1 = list(range(D1)); id2 = list(range(D2)) if D2 else None
        va = A(id1, id2); vb = B(id1, id2)
        diff = (va - vb) if (va is not None and vb is not None) else None
        cr = cref(id1, id2) if cref else None
        p = (diff / cr) if (diff is not None and cr) else None
        def f(d1, d2):
            a = A(d1, d2); b = B(d1, d2)
            if a is None or b is None: return None
            dd = a - b; pp = None
            if cref:
                c = cref(d1, d2)
                if c: pp = dd / c
            return (dd, pp)
        res = boot_vec(D1, D2, f)
        lo, hi, sk = interval([r[0] if r else None for r in res], 'W5 %s %s %s %s diff' % (cand, variant, old_rule, qty))
        lop = hip = None
        if qty == 'cycle' and cref:
            lop, hip, sk2 = interval([r[1] if r else None for r in res], 'W5 %s %s %s %s share_p' % (cand, variant, old_rule, qty))
        if not label: lab = ''
        elif qty == 'MAE': lab = label_from(lo, hi, 'mae')
        else: lab = label_from(lop, hip, 'cycle')
        W5.append([cand, variant, old_rule, qty, va, vb, diff, lo, hi, p if qty == 'cycle' else None, lop, hip, lab])
        return va, vb

    def sets_universe(*rowlists):
        U = sorted(set(r['day'] for rl in rowlists for r in rl))
        return U

    def blk(rows, U, getter):
        idx = {d: i for i, d in enumerate(U)}
        B = [[] for _ in U]
        for r in rows:
            x = getter(r)
            if x is not None and r['day'] in idx: B[idx[r['day']]].append(x)
        return B

    # estimate sets keyed by seq: dict with day, hour, e
    def mkset(getE, getT, getDue):
        out = {}
        for r in runs:
            sq = r['seq_i']
            E = getE(sq); T = getT(sq); due = getDue(sq)
            if E is None or T is None or due is None: continue
            out[sq] = dict(seq=sq, day=r['day'], hour=local_hour_int(due), e=(E - T) / T * 100)
        return out
    def scen_set(sc):
        return mkset(lambda q: f_(replay[(q, sc)]['raw_cfs']), lambda q: f_(truth[(q, sc)]['t1_lf_cfs_interpolated']),
                     lambda q: parse_iso(replay[(q, sc)]['due_utc']))
    scen = {sc: scen_set(sc) for sc in ('S-new', 'S-old-A', 'S-old-B', 'S-old-C')}
    for sc in scen:
        log('scenario %s: raw estimates with T1: %d of 275' % (sc, len(scen[sc])))
    def cell_set(rule, fn, rp, df):
        sc = 'S-new' if df == 'new' else 'S-old-' + rule
        return mkset(lambda q: f_(cells[(q, rule)][(fn, rp, df)]['raw_cfs']), lambda q: f_(truth[(q, sc)]['t1_lf_cfs_interpolated']),
                     lambda q: parse_iso(cells[(q, rule)][(fn, rp, df)]['due_utc']))
    # check cell due vs scenario truth due
    nbad = 0
    for q in range(1, 306):
        if (q, 'B') not in cells: continue
        for key, r in cells[(q, 'B')].items():
            sc = 'S-new' if key[2] == 'new' else 'S-old-B'
            if r['due_utc'] != truth[(q, sc)]['due_utc']: nbad += 1
    log('2x2x2 cells (rule B) whose due_utc differs from truth.csv due_utc of the T1 scenario: %d' % nbad)
    nemp = sum(1 for (q, rule), d in cells.items() for k, r in d.items() if r['raw_cfs'] == '')
    log('2x2x2 rows with blank raw_cfs: %d' % nemp)

    s0raw = {r['seq']: dict(seq=r['seq'], day=r['day'], hour=r['hour_due'], e=r['e_raw']) for r in W4}
    s0fin = {r['seq']: dict(seq=r['seq'], day=r['day'], hour=r['hour_due'], e=r['e_final']) for r in W4}

    def phase_rows(sset, p):
        return [v for sq, v in sset.items() if phase[sq] == p]
    def ev(B, stat):   # closure over block list
        return stat
    def stat_for(qty):
        if qty == 'MAE': return lambda items: mae_([e for h, e in items])
        return lambda items: cycle_of(items)

    def closure(B, qty, group=1):
        st = stat_for(qty)
        if group == 1: return lambda d1, d2: st(cat(B, d1))
        return lambda d1, d2: st(cat(B, d2))

    # c_ref for NEW phase: S0 e_raw
    def cref_closure(U, group=1):
        rows = phase_rows(s0raw, 'NEW'); B = blk(rows, U, lambda r: (r['hour'], r['e']))
        return closure(B, 'cycle', group)

    def two_sets(cand, variant, old_rule, sa, sb, p='NEW', qtys=('MAE', 'cycle'), label=True):
        ra = phase_rows(sa, p); rb = phase_rows(sb, p)
        U = sets_universe(ra, rb)
        UNIVERSES.append((cand, variant, old_rule, tuple(U)))
        Ba = blk(ra, U, lambda r: (r['hour'], r['e'])); Bb = blk(rb, U, lambda r: (r['hour'], r['e']))
        res = {}
        for qty in qtys:
            cref = cref_closure(U, 1) if p == 'NEW' else cref_closure(sets_universe(phase_rows(s0raw, 'NEW')), 2)
            if p == 'NEW':
                res[qty] = compare(cand, variant, old_rule, qty, closure(Ba, qty), closure(Bb, qty), len(U), None, cref, label)
            else:
                Un = sets_universe(phase_rows(s0raw, 'NEW'))
                res[qty] = compare(cand, variant, old_rule, qty, closure(Ba, qty), closure(Bb, qty), len(U), len(Un), cref, label)
        return res

    # ---------- H1
    h1 = {}
    for rule in ('A', 'B', 'C'):
        for variant, ca, cb in (('new_numbers', ('new', 'new', 'new'), ('new', 'old', 'new')), ('old_numbers', ('old', 'new', 'old'), ('old', 'old', 'old'))):
            sa = cell_set(rule, *ca); sb = cell_set(rule, *cb)
            r = two_sets('H1', variant, rule, sa, sb)
            if variant == 'new_numbers': h1[rule] = r['MAE']
            # mean delay (all NEW-phase runs of the cell; trv_t_of_pick_h + gf2lf_h)
            def delay_rows(c):
                out = []
                for q in range(1, 306):
                    if (q, rule) not in cells or phase.get(q) != 'NEW': continue
                    rr = cells[(q, rule)][c]
                    a_, b_ = f_(rr['trv_t_of_pick_h']), f_(rr['gf2lf_h'])
                    if a_ is None or b_ is None: continue
                    out.append(dict(day=ctx['runs_by_seq'][q]['day'], v=a_ + b_))
                return out
            da = delay_rows(ca); db = delay_rows(cb)
            U = sets_universe(da, db)
            Ba = blk(da, U, lambda r: r['v']); Bb = blk(db, U, lambda r: r['v'])
            va, vb = compare('H1', variant, rule, 'mean_delay_h', lambda d1, d2: mean_(cat(Ba, d1)), lambda d1, d2: mean_(cat(Bb, d1)), len(U), None, None, False)
            if variant == 'new_numbers': h1[rule] = (r['MAE'], (va, vb))
    tot = ctx['w3']['total_delay_h']
    for rule in ('A', 'B', 'C'):
        (mae_a, mae_b), (da_, db_) = h1[rule]
        verdict = 'undetermined'
        if tot is not None and mae_a is not None and mae_b is not None and da_ is not None and db_ is not None:
            xa = abs(tot - da_); xb = abs(tot - db_)
            if abs(xa - xb) >= 2.0:
                closer_a = xa < xb
                smaller_a = mae_a < mae_b
                if closer_a == smaller_a: verdict = 'supported'
                else: verdict = 'not supported'
        M('W5', rule, 'h1_verdict', verdict)
    # ---------- H7
    for rule in ('B', 'A', 'C'):
        two_sets('H7', '', rule, cell_set(rule, 'new', 'new', 'new'), cell_set(rule, 'new', 'new', 'old'))
    # ---------- H3 (variants NEW and OLD)
    for p in ('NEW', 'OLD'):
        sa = {}; sb = {}
        for r in W4:
            if r['phase'] != p: continue
            raw_nf = r['raw'] / r['dr'] if r['dr'] is not None else r['raw']
            sa[r['seq']] = dict(seq=r['seq'], day=r['day'], hour=r['hour_due'], e=r['e_raw'])
            sb[r['seq']] = dict(seq=r['seq'], day=r['day'], hour=r['hour_due'], e=(raw_nf - r['t1']) / r['t1'] * 100)
        # phase_rows filters by phase label, so pass p
        two_sets('H3', p, '', sa, sb, p=p)
    # ---------- H4
    mism = sum(1 for r in runs if abs(float(r['final_cfs']) - min(float(r['raw_cfs']) - float(r['corr_c']), float(r['ceil_lim']) if r['ceil_lim'] != '' else 1e18)) > 1.0)
    M('W5', '', 'h4_formula_mismatches', mism)
    # mean_correction
    N_ = NEW
    U = sorted(set(r['day'] for r in N_))
    UNIVERSES.append(('H4', 'mean_correction', '', tuple(U)))
    Ba = blk(N_, U, lambda r: (r['hour_due'], r['e_final']))
    Bb = blk(N_, U, lambda r: (r['hour_due'], r['raw'], r['corr_c'], r['ceil_lim'], r['t1']))
    def stat_b(items, qty):
        if not items: return None
        m = sum(x[2] for x in items) / len(items)
        es = []
        for h, raw, c, cl, t1 in items:
            est = raw - m
            if cl is not None: est = min(est, cl)
            es.append((h, (est - t1) / t1 * 100))
        return mae_([e for h, e in es]) if qty == 'MAE' else cycle_of(es)
    cref = cref_closure(U, 1)
    for qty in ('MAE', 'cycle'):
        compare('H4', 'mean_correction', '', qty, closure(Ba, qty), (lambda d1, d2, qty=qty: stat_b(cat(Bb, d1), qty)), len(U), None, cref)
    compare('H4', 'final_vs_raw', '', 'cycle', closure(Ba, 'cycle'), closure(blk(N_, U, lambda r: (r['hour_due'], r['e_raw'])), 'cycle'), len(U), None, cref)
    # ---------- H6
    sa = {r['seq']: dict(seq=r['seq'], day=r['day'], hour=r['hour_due'], e=r['e_final']) for r in W4}
    sb = {r['seq']: dict(seq=r['seq'], day=r['day'], hour=r['hour_due'], e=(r['raw'] - r['corr_c'] - r['t1']) / r['t1'] * 100) for r in W4}
    two_sets('H6', '', '', sa, sb)
    for p in ('NEW', 'OLD', 'TRANS'):
        rs = [r for r in runs if phase[r['seq_i']] == p]
        M('W5', p, 'h6_share_ceil_bound_1', sum(1 for r in rs if r['ceil_bound'] == '1') / len(rs))
        M('W5', p, 'h6_n_runs_ceil_bound_1', sum(1 for r in rs if r['ceil_bound'] == '1'))
    # ---------- H8
    def flips(rows_by_day):
        return {d: sum(1 for a, b in zip(v, v[1:]) if a != b) for d, v in rows_by_day.items()}
    def day_flips(getst, p):
        byday = collections.defaultdict(list)
        for r in runs:
            if phase[r['seq_i']] != p: continue
            st = getst(r['seq_i'])
            byday[r['day']].append((r['at_t'], st))
        out = {}
        for d, v in byday.items():
            if len(v) < 3: continue
            v.sort()
            sts = [s for t, s in v]
            out[d] = sum(1 for a, b in zip(sts, sts[1:]) if a != b)
        return out
    for p in ('NEW', 'OLD'):
        fS0 = day_flips(lambda q: ctx['runs_by_seq'][q]['corr_st'], p)
        M('W5', p, 'h8_s0_logged_flips_per_day', mean_(list(fS0.values()))); M('W5', p, 'h8_s0_logged_n_days', len(fS0))
        fn = day_flips(lambda q: replay[(q, 'S-new')]['corr_st'], p)
        for rule in ('B', 'A', 'C'):
            fo = day_flips(lambda q: replay[(q, 'S-old-' + rule)]['corr_st'], p)
            U = sorted(set(fn) | set(fo))
            Ba = [[fn[d]] if d in fn else [] for d in U]; Bb = [[fo[d]] if d in fo else [] for d in U]
            UNIVERSES.append(('H8', p, rule, tuple(U)))
            compare('H8', p, rule, 'flips_per_day', lambda d1, d2: mean_(cat(Ba, d1)), lambda d1, d2: mean_(cat(Bb, d1)), len(U), None, None, False)
    # ---------- H2 and H9
    days = ctx['days']
    P7 = PER['P7']; P56 = (PER['P5'][0], PER['P6'][1])
    for variant, k in (('por_level', (POR, '00065')), ('por_flow', (POR, '00060')), ('lf_level', (LF, '00065')), ('lf_flow', (LF, '00060'))):
        da = nonevent_days(ctx, k, *P7); db = [x for x in nonevent_days(ctx, k, *P56)]
        va_ = [days[k][x]['A_a'] for x in da]; vb_ = [days[k][x]['A_a'] for x in db]
        compare('H2', variant, '', 'median_A_a', lambda d1, d2, v=va_: median([v[i] for i in d1]), lambda d1, d2, v=vb_: median([v[i] for i in d2]), len(va_), len(vb_), None, False)
        ma_, mb_ = median(va_), median(vb_)
        M('W5', variant, 'h2_ratio_a_over_b', (ma_ / mb_) if (ma_ is not None and mb_) else None)
        M('W5', variant, 'h2_n_days_P7', len(va_)); M('W5', variant, 'h2_n_days_P5P6', len(vb_))
    dd = [dn for dn in range(*[P7[0], P7[1] + 1]) if (not days[(EF, '00065')][dn]['event']) and (not days[(LF, '00065')][dn]['event'])
          and days[(EF, '00065')][dn]['A_a'] is not None and days[(LF, '00065')][dn]['A_a'] is not None]
    ve = [days[(EF, '00065')][dn]['A_a'] for dn in dd]; vl = [days[(LF, '00065')][dn]['A_a'] for dn in dd]
    compare('H9', '', '', 'median_A_a', lambda d1, d2: median([ve[i] for i in d1]), lambda d1, d2: median([vl[i] for i in d1]), len(dd), None, None, False)
    M('W5', '', 'h9_ratio_a_over_b', median(ve) / median(vl) if (dd and median(vl)) else None); M('W5', '', 'h9_n_days', len(dd))
    # ---------- H5
    Un = sorted(set(r['day'] for r in NEW)); Uo = sorted(set(r['day'] for r in OLD))
    srcs = [('S0_logged', s0raw)] + [(sc, scen[sc]) for sc in ('S-new', 'S-old-A', 'S-old-B', 'S-old-C')]
    for name, sset in srcs:
        rn = phase_rows(sset, 'NEW'); ro = phase_rows(sset, 'OLD')
        UN = sets_universe(rn); UO = sets_universe(ro)
        UNIVERSES.append(('H5', name, '', tuple(UN), tuple(UO)))
        Bn = blk(rn, UN, lambda r: (r['hour'], r['e'])); Bo = blk(ro, UO, lambda r: (r['hour'], r['e']))
        cref = cref_closure(UN, 1)
        compare('H5', name, '', 'cycle', lambda d1, d2: cycle_of(cat(Bn, d1)), lambda d1, d2: cycle_of(cat(Bo, d2)), len(UN), len(UO), cref)
    n = write_table('W5_candidates', ['candidate', 'variant', 'old_rule', 'quantity', 'value_a', 'value_b', 'diff', 'lo', 'hi', 'share_p', 'lo_p', 'hi_p', 'label'],
                    sorted(W5, key=lambda r: (r[0], r[1], r[2], r[3])))
    log('W5_candidates rows %d' % n)
    # universe consistency check for single-group NEW candidates
    base = None
    diffu = 0
    for u in UNIVERSES:
        if u[0] in ('H1', 'H7', 'H3', 'H4', 'H6') and not (u[0] == 'H3' and u[1] == 'OLD'):
            if base is None: base = u[3]
            elif u[3] != base: diffu += 1
    log('W5 block universes of NEW-phase candidates that differ from the first one: %d' % diffu)

# ======================================================================= W6
def run_w6(ctx):
    checks = read_csv(S + 'data/tidy/checks.csv')
    allruns = read_csv(S + 'data/tidy/runs.csv')
    byfin = collections.defaultdict(list)
    for r in allruns: byfin[r['final_ts_utc']].append(r)
    rows = []; nomatch = []
    checks.sort(key=lambda c: c['created_at_utc'])
    out = []
    for c in checks:
        m = byfin.get(c['predTs_utc'], [])
        if len(m) > 1: log('check %s matches %d run rows' % (c['seq'], len(m)))
        run_seq = int(m[0]['seq']) if m else None
        used = m[0]['used'] if m else None
        if run_seq is None: nomatch.append(c['seq'])
        elif used != '1': log('check %s matched run seq %s that is not a used run' % (c['seq'], run_seq))
        phase = ctx['phase'].get(run_seq) if run_seq in ctx['phase'] else None
        out.append(dict(seq=int(c['seq']), run=run_seq, phase=phase, bin=c['bin'], st=c['st'],
                        hp=local_hour_int(parse_iso(c['predTs_utc'])), hd=local_hour_int(parse_iso(c['dueAt_utc'])), hc=local_hour_int(parse_iso(c['valAt_utc'])),
                        dm=f_(c['delayMin']), er=f_(c['errPctRaw']), ec=f_(c['errPctCorr'])))
    log('W6 checks with no run in the log: %s' % nomatch)
    rows = [[o['seq'], o['run'], o['phase'], o['bin'], o['st'], o['hp'], o['hd'], o['hc'], o['dm'], o['er'], o['ec']] for o in out]
    log('W6_checks rows %d' % write_table('W6_checks', ['seq_check', 'run_seq', 'phase', 'bin', 'st', 'hour_pred', 'hour_due', 'hour_check', 'delayMin', 'errPctRaw', 'errPctCorr'], rows))
    g = collections.defaultdict(list)
    for o in out: g[o['bin'] + '_' + o['st']].append(o)
    rows = [[k, len(v), '|'.join(str(x) for x in sorted(o['hp'] for o in v)), '|'.join(str(x) for x in sorted(o['hd'] for o in v))] for k, v in sorted(g.items())]
    log('W6_by_bin rows %d' % write_table('W6_by_bin', ['bin_key', 'n', 'hours_pred', 'hours_due'], rows))
    M('W6', 'NEW', 'mean_e_raw_all_runs', ctx['cyc'][('NEW', 'e_raw')]['mean'])
    W4 = ctx['W4']
    hm = hourly_means([(r['hour_due'], r['e_raw']) for r in W4 if r['phase'] == 'NEW'])
    vals = []; skipped = 0
    for o in out:
        if o['phase'] != 'NEW': continue
        n_, m_ = hm.get(o['hd'], (0, None))
        if n_ >= 3: vals.append(m_)
        else: skipped += 1
    M('W6', 'NEW', 'mean_e_raw_at_check_hours', mean_(vals))
    M('W6', 'NEW', 'n_checks_in_mean', len(vals)); M('W6', 'NEW', 'n_checks_skipped_non_valid_hour', skipped)
    M('W6', 'NEW', 'n_distinct_hours_due', len(set(o['hd'] for o in out if o['phase'] == 'NEW')))
    M('W6', '', 'n_checks_without_run', len(nomatch))
