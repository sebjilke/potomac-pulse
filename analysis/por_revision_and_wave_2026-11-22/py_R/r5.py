from lib import *
from data import *

SCN = [('s0', 'S0'), ('oldA', 'S-old-A'), ('oldB', 'S-old-B'), ('oldC', 'S-old-C'), ('new', 'S-new')]


def build_run_table(c, M, rep):
    """per-run table, cached on ctx."""
    if hasattr(c, 'r5rows'):
        return c.r5rows
    t1 = t1_values(c)
    rows = []
    for seq in c.seqs:
        r = c.run_by_seq[seq]
        lab = c.labels[seq]
        d = dict(seq=seq, at_utc=r['at_utc'], phase=c.phase[seq], gate_miss=c.gate_miss[seq], ver=r['ver'], src=r['src'],
                 label_flow_state_rise_rate=lab['label_flow_state_rise_rate'], label_time_shift=lab['label_time_shift'],
                 label_delta_correction=lab['label_delta_correction'], _day=day_of(ts(r['at_utc'])))
        for suf, scn in SCN:
            if scn == 'S0':
                raw = float(r['raw_cfs'])
                due = r['due_utc']
                T = t1[(seq, 'S0')]
                if seq == 212:
                    T = t1_s0_interp(c, ts(due))
            else:
                rp = c.replay[(seq, scn)]
                raw = float(rp['raw_cfs'])
                due = rp['due_utc']
                T = t1[(seq, scn)]
            d['raw_cfs_' + suf] = raw
            d['due_utc_' + suf] = due
            d['t1_' + suf] = T
            d['e_raw_' + suf] = ((raw - T) / T * 100) if T is not None else None
        for suf in ('oldA', 'oldB', 'oldC', 'new'):
            T0 = d['t1_s0']
            d['e_raw_%s_commondue' % suf] = ((d['raw_cfs_' + suf] - T0) / T0 * 100) if T0 is not None else None
        rows.append(d)
    c.r5rows = rows
    return rows


def run(c, M, rep):
    rows = build_run_table(c, M, rep)
    cols = ['seq', 'at_utc', 'phase', 'gate_miss', 'ver', 'src', 'label_flow_state_rise_rate', 'label_time_shift', 'label_delta_correction']
    for suf, _ in SCN:
        cols += ['raw_cfs_' + suf, 'due_utc_' + suf, 't1_' + suf, 'e_raw_' + suf]
    cols += ['e_raw_oldA_commondue', 'e_raw_oldB_commondue', 'e_raw_oldC_commondue', 'e_raw_new_commondue']
    n = write_table('R5_runs', cols, rows)
    rep.append('R5_runs rows %d' % n)
    # phases
    for ph in PHASE_ORDER:
        ss = [r['seq'] for r in rows if r['phase'] == ph]
        M.add('R5', 'n_runs', len(ss), 'phase_' + ph)
        M.add('R5', 'first_seq', min(ss), 'phase_' + ph)
        M.add('R5', 'last_seq', max(ss), 'phase_' + ph)

    # ------------------------------------------------ three-term split
    out = []
    byday_rows = []
    for X in 'ABC':
        for basis in ('own', 'common'):
            def terms(d):
                eo = d['e_raw_old%s' % X] if basis == 'own' else d['e_raw_old%s_commondue' % X]
                en = d['e_raw_new'] if basis == 'own' else d['e_raw_new_commondue']
                es = d['e_raw_s0']
                if eo is None or en is None or es is None:
                    return None
                return (eo, en - eo, es - en, es, en)
            valid = [(d, terms(d)) for d in rows]
            nd = sum(1 for d, t in valid if t is None)
            M.add('R5', 'n_runs_dropped_missing_t1', nd, 'rule%s_%s' % (X, basis))
            for sset in ('all', 'without_212_217'):
                for ph in ('ALL', 'NEW', 'OLD', 'TRANS'):
                    sub = [(d, t) for d, t in valid if t is not None and (ph == 'ALL' or d['phase'] == ph)
                           and (sset == 'all' or d['seq'] not in (212, 217))]
                    row = dict(old_rule=X, due_basis=basis, set=sset, phase=ph, n=len(sub))
                    if sub:
                        for k, nm in ((0, 'term1'), (1, 'term2'), (2, 'term3')):
                            vals = [(d['_day'], t[k]) for d, t in sub]
                            lo, hi, _ = boot_mean_ci(vals)
                            row['mean_' + nm] = mean([v for _, v in vals])
                            row['lo_' + nm] = lo
                            row['hi_' + nm] = hi
                        row['mean_e_s0'] = mean([t[3] for d, t in sub])
                        row['mean_abs_e_s0'] = mean([abs(t[3]) for d, t in sub])
                        row['mean_abs_e_old'] = mean([abs(t[0]) for d, t in sub])
                        row['mean_abs_e_new'] = mean([abs(t[4]) for d, t in sub])
                    out.append(row)
            if basis == 'own':
                bd = collections.defaultdict(list)
                for d, t in valid:
                    if t is not None:
                        bd[d['_day']].append(t)
                for day in sorted(bd):
                    ts_ = bd[day]
                    byday_rows.append(dict(old_rule=X, day_utc=day, n=len(ts_), mean_term1=mean([t[0] for t in ts_]),
                                           mean_term2=mean([t[1] for t in ts_]), mean_term3=mean([t[2] for t in ts_])))
    out.sort(key=lambda r: (r['old_rule'], r['due_basis'], r['set'], r['phase']))
    cols = ['old_rule', 'due_basis', 'set', 'phase', 'n', 'mean_term1', 'lo_term1', 'hi_term1', 'mean_term2', 'lo_term2', 'hi_term2',
            'mean_term3', 'lo_term3', 'hi_term3', 'mean_e_s0', 'mean_abs_e_s0', 'mean_abs_e_old', 'mean_abs_e_new']
    n = write_table('R5_split', cols, out)
    rep.append('R5_split rows %d' % n)
    n = write_table('R5_split_by_day', ['old_rule', 'day_utc', 'n', 'mean_term1', 'mean_term2', 'mean_term3'], byday_rows)
    rep.append('R5_split_by_day rows %d' % n)

    # ------------------------------------------------ extrapolation share
    ex = []
    EXT = ('extrapolated_low', 'extrapolated_high')
    for scn in ('S-old-A', 'S-old-B', 'S-old-C'):
        for ph in PHASE_ORDER:
            rs = [c.replay[(s, scn)] for s in c.seqs if c.phase[s] == ph]
            n_ = len(rs)
            if n_ == 0:
                ex.append(dict(scenario=scn, phase=ph, n_runs=0))
                continue
            anyx = sum(1 for r in rs if any(r[k] in EXT for k in ('cur_extrap_flag', 'back6_extrap_flag', 'hist_extrap_flag')))
            hx = sum(1 for r in rs if r['hist_extrap_flag'] in EXT)
            ok = sum(1 for r in rs if any(r[k] == 'observed_oct_knot' for k in ('cur_extrap_flag', 'back6_extrap_flag', 'hist_extrap_flag')))
            ex.append(dict(scenario=scn, phase=ph, n_runs=n_, share_any_extrapolated=anyx / n_, share_hist_extrapolated=hx / n_,
                           share_any_oct_knot=ok / n_))
    ex.sort(key=lambda r: (r['scenario'], r['phase']))
    n = write_table('R5_extrapolation', ['scenario', 'phase', 'n_runs', 'share_any_extrapolated', 'share_hist_extrapolated', 'share_any_oct_knot'], ex)
    rep.append('R5_extrapolation rows %d' % n)

    # ------------------------------------------------ chain
    ch = []
    srcs = [('S0_logged', 0, None)] + [(s, 1, s) for s in ('S-old-A', 'S-old-B', 'S-old-C', 'S-new')]
    for name, approx, scn in srcs:
        for ph in PHASE_ORDER:
            if scn is None:
                rs = [c.run_by_seq[s] for s in c.seqs if c.phase[s] == ph]
                m = dict(trv='trv_t', gf='trv_gf2lf', ha='hist_ago', lim=None)
            else:
                rs = [c.replay[(s, scn)] for s in c.seqs if c.phase[s] == ph]
                m = dict(trv='trv_t_h', gf='trv_gf2lf_h', ha='hist_ago_h', lim='iteration_limit')
            n_ = len(rs)

            def mn(col):
                v = [float(r[col]) for r in rs if r[col] != '']
                return mean(v) if v else None
            dr = [float(r['delta_ratio']) for r in rs if r['delta_ratio'] != '']
            row = dict(source=name, phase=ph, n=n_, approx_final=approx, mean_trv_t=mn(m['trv']), mean_trv_gf2lf=mn(m['gf']),
                       mean_hist_ago=mn(m['ha']), mean_hist_cfs=mn('hist_cfs'), mean_pre_cfs=mn('pre_cfs'),
                       mean_delta_ratio=mean(dr) if dr else None, n_delta_ratio=len(dr), mean_raw_cfs=mn('raw_cfs'),
                       mean_corr_c=mn('corr_c'), mean_final_cfs=mn('final_cfs'),
                       share_ceil_bound=sum(1 for r in rs if r['ceil_bound'] == '1') / n_,
                       share_rising=sum(1 for r in rs if r['corr_st'] == 'rising') / n_,
                       share_steady=sum(1 for r in rs if r['corr_st'] == 'steady') / n_,
                       share_falling=sum(1 for r in rs if r['corr_st'] == 'falling') / n_,
                       share_iteration_limit=(sum(1 for r in rs if r['trv_stop'] == 'max_iter') if scn is None
                                              else sum(1 for r in rs if r['iteration_limit'] == '1')) / n_)
            ch.append(row)
    ch.sort(key=lambda r: (r['source'], r['phase']))
    cols = ['source', 'phase', 'n', 'approx_final', 'mean_trv_t', 'mean_trv_gf2lf', 'mean_hist_ago', 'mean_hist_cfs', 'mean_pre_cfs',
            'mean_delta_ratio', 'n_delta_ratio', 'mean_raw_cfs', 'mean_corr_c', 'mean_final_cfs', 'share_ceil_bound', 'share_rising',
            'share_steady', 'share_falling', 'share_iteration_limit']
    n = write_table('R5_chain', cols, ch)
    rep.append('R5_chain rows %d' % n)
