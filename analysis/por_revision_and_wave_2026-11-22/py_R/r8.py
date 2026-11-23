from lib import *
from data import *
import r4, r5

FIELDS = [('in_lf_q', LF, '00060', 'in_lf_qT_utc'), ('in_lf_h', LF, '00065', 'in_lf_hT_utc'), ('in_mono_q', MONO, '00060', 'in_mono_qT_utc'),
          ('in_goose_q', GOOSE, '00060', 'in_goose_qT_utc'), ('in_sen_q', SEN, '00060', 'in_sen_qT_utc'),
          ('in_br_q', BR, '00060', 'in_br_qT_utc'), ('in_ef_h', EF, '00065', 'in_ef_hT_utc'), ('in_por_h', POR, '00065', 'in_por_hT_utc'),
          ('in_por_q', POR, '00060', 'in_por_qT_utc')]


def group_of(r):
    return 'new_service' if r['src'] == 'new' else 'old_service'


def run(c, M, rep):
    # ------------------------------------------------ (a) inputs
    acc = collections.defaultdict(lambda: dict(n=0, eq=0, mx=0.0))
    skipped = collections.Counter()
    for seq in c.seqs:
        r = c.run_by_seq[seq]
        g = group_of(r)
        for f, gauge, par, tf in FIELDS:
            if f == 'in_por_q' and c.labels[seq]['cur_label'] != 'new':
                continue
            lv = r[f]
            t = ts(r[tf])
            cv = cur_at(c, gauge, par, t) if t is not None else None
            if lv == '' or cv is None:
                skipped[(f, g)] += 1
                continue
            a = acc[(f, g)]
            a['n'] += 1
            d = abs(float(lv) - cv)
            if d == 0:
                a['eq'] += 1
            a['mx'] = max(a['mx'], d)
    rows = []
    for (f, g) in sorted(acc):
        a = acc[(f, g)]
        rows.append(dict(field=f, src_group=g, n=a['n'], n_equal=a['eq'], n_different=a['n'] - a['eq'], max_abs_diff=a['mx']))
    n = write_table('R8_inputs', ['field', 'src_group', 'n', 'n_equal', 'n_different', 'max_abs_diff'], rows)
    rep.append('R8_inputs rows %d; runs/fields skipped for a blank logged or missing current value: %s' % (n, dict(skipped)))

    # ------------------------------------------------ (a) error before/after switch
    R = r5.build_run_table(c, M, rep)
    new = [d for d in R if d['phase'] == 'NEW']
    for d in R:
        d['_grp'] = group_of(c.run_by_seq[d['seq']])
    def terms(d, X):
        eo, en, es = d['e_raw_old' + X], d['e_raw_new'], d['e_raw_s0']
        return None if (eo is None or en is None or es is None) else eo
    def compare(label, group, qfn):
        b = [(d['_day'], qfn(d)) for d in new if d['_grp'] == 'old_service' and qfn(d) is not None]
        a = [(d['_day'], qfn(d)) for d in new if d['_grp'] == 'new_service' and qfn(d) is not None]
        mb = mean([v for _, v in b]) if b else None
        ma = mean([v for _, v in a]) if a else None
        lo, hi, sk = boot_diff_ci(b, a)
        M.add('R8', label + '_n_before', len(b), group)
        M.add('R8', label + '_n_after', len(a), group)
        M.add('R8', label + '_mean_before', mb, group)
        M.add('R8', label + '_mean_after', ma, group)
        M.add('R8', label + '_diff', (ma - mb) if (ma is not None and mb is not None) else None, group)
        M.add('R8', label + '_diff_lo', lo, group)
        M.add('R8', label + '_diff_hi', hi, group)
    compare('e_raw_s0', '', lambda d: d['e_raw_s0'])
    for X in 'BAC':
        compare('term1', X, lambda d, X=X: terms(d, X))
    compare('e_raw_new', '', lambda d: d['e_raw_new'])

    # ------------------------------------------------ (b) falling river
    P = r4.prep_series(c)
    bd = collections.defaultdict(list)
    for d in R:
        bd[(d['_day'], d['phase'])].append(d)
    rows = []
    for (day, ph) in sorted(bd):
        ds = bd[(day, ph)]
        row = dict(day_utc=day, phase=ph, n_runs=len(ds))
        for X in 'ABC':
            v = [terms(d, X) for d in ds if terms(d, X) is not None]
            row['mean_term1_' + X] = mean(v) if v else None
        v = [d['e_raw_s0'] for d in ds if d['e_raw_s0'] is not None]
        row['mean_e_raw_s0'] = mean(v) if v else None
        lf0, lf1 = P['lf'].day_mean(day), P['lf'].day_mean(prev_day(day))
        row['lf_day_mean'] = lf0
        row['por_level_day_mean'] = P['por_h'].day_mean(day)
        row['lf_change_24h_pct'] = ((lf0 - lf1) / lf1 * 100) if (lf0 is not None and lf1) else None
        rows.append(row)
    n = write_table('R8_daily', ['day_utc', 'phase', 'n_runs', 'mean_term1_A', 'mean_term1_B', 'mean_term1_C', 'mean_e_raw_s0', 'lf_day_mean',
                                'por_level_day_mean', 'lf_change_24h_pct'], rows)
    rep.append('R8_daily rows %d' % n)
    for ph in ('OLD', 'NEW'):
        for X in 'BAC':
            sub = [r for r in rows if r['phase'] == ph and r['n_runs'] >= 3 and r['mean_term1_' + X] is not None and r['lf_change_24h_pct'] is not None]
            x = [r['lf_change_24h_pct'] for r in sub]
            y = [r['mean_term1_' + X] for r in sub]
            g = '%s_%s' % (ph, X)
            M.add('R8', 'slope_term1_on_lf_change_24h_pct', ols_slope(x, y), g)
            M.add('R8', 'pearson_term1_on_lf_change_24h_pct', pearson(x, y), g)
            M.add('R8', 'n_days', len(sub), g)
