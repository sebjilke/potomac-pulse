#!/usr/bin/env python3
"""Old curve f_old(level) for Point of Rocks flow (PLAN 4.3, audit N1/N6).

Rules are in CURVE_DEFINITION.md (written before the test set was computed). Reads only frozen tables in
../../data/tidy. Writes pairs_fit.csv, pairs_test.csv, lookup_by_day.csv, f_old_values.csv, f_old_summary.json
(machine-readable numbers for F_OLD_REPORT.md, which this script also writes). No clock, no randomness.
Run: python3 -I build_f_old.py
"""
import csv, json, os, sys, collections, math
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
TIDY = os.path.join(HERE, '..', '..', 'data', 'tidy')
POR = '01638500'
WIN_START = '2026-11-07T00:00:00Z'      # CURVE_DEFINITION rule 2
HIST_START = '2026-11-10T00:00:00Z'
HIST_END = '2026-11-13T17:55:00Z'


def iso_to_ms(s):
    return int(datetime.strptime(s, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc).timestamp() * 1000)


def ms_to_iso(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def round10(x):
    return int(math.floor(x / 10.0 + 0.5) * 10)


def lvl_key(v):
    return int(round(float(v) * 100))      # level in 0.01 ft units


def read_series(fname, gauge, param):
    d = {}
    with open(os.path.join(TIDY, fname), newline='') as f:
        for r in csv.DictReader(f):
            if r['gauge'] == gauge and r['parameter'] == param and r['value'] != '':
                d[r['time_utc']] = float(r['value'])
    return d


def main():
    runs = list(csv.DictReader(open(os.path.join(TIDY, 'runs.csv'), newline='')))
    cur_q = read_series('readings_current_model.csv', POR, '00060')
    cur_h = read_series('readings_current_model.csv', POR, '00065')
    arch_q = read_series('readings_old_archive.csv', POR, '00060')
    S = {}   # summary numbers

    # ---------------- step 1: level test ----------------
    lt = {'n': 0, 'equal': 0, 'missing_today': 0, 'unequal': []}
    for r in runs:
        if r['out'] != 'predicted' or not r['in_por_hT_utc'] or r['in_por_h'] == '':
            continue
        lt['n'] += 1
        t = r['in_por_hT_utc']
        if t not in cur_h:
            lt['missing_today'] += 1
        elif abs(cur_h[t] - float(r['in_por_h'])) < 1e-9:
            lt['equal'] += 1
        else:
            lt['unequal'].append({'run_at': r['at'], 'hT': t, 'logged': r['in_por_h'], 'today': cur_h[t]})
    S['level_test'] = lt
    # same test on the old-reading runs only (the ones the curve relies on)
    # (defined after we know which runs are old, below)

    # ---------------- which runs have an old current flow ----------------
    # Old runs = the maximal contiguous prefix (in time) of predicted runs whose logged current flow differs from
    # the current record at the same timestamp. The prefix ends at the first run whose logged flow equals the
    # current record (the first run that fetched revised values). A later run whose logged value differs from
    # today's record (value rewritten by USGS after the run) is NOT an old run; it is listed separately.
    old_runs = []
    new_runs = []
    rewritten_after = []
    in_prefix = True
    for r in runs:
        if r['out'] != 'predicted' or not r['in_por_qT_utc']:
            continue
        t = r['in_por_qT_utc']
        q = float(r['in_por_q'])
        same = (t in cur_q and abs(cur_q[t] - q) < 1e-9)
        if in_prefix and not same:
            old_runs.append(r)
            continue
        in_prefix = False
        new_runs.append(r)
        if not same:
            rewritten_after.append({'run_at': r['at'], 'qT': t, 'logged': q, 'today': cur_q.get(t)})
    S['runs_logged_flow_differs_from_today_after_revision'] = rewritten_after
    S['n_runs_predicted'] = len(old_runs) + len(new_runs)
    S['n_old_reading_runs'] = len(old_runs)
    S['old_runs_first_at'] = old_runs[0]['at']
    S['old_runs_last_at'] = old_runs[-1]['at']
    S['first_new_reading_run_at'] = new_runs[0]['at']
    S['old_runs_after_first_new'] = 0
    ltold = {'n': 0, 'equal': 0}
    for r in old_runs:
        if r['in_por_hT_utc']:
            ltold['n'] += 1
            if r['in_por_hT_utc'] in cur_h and abs(cur_h[r['in_por_hT_utc']] - float(r['in_por_h'])) < 1e-9:
                ltold['equal'] += 1
    S['level_test_old_runs'] = ltold

    # ---------------- step 2: pairs ----------------
    pairs = []   # dict(time, level, flow, source, run_at)
    for r in old_runs:
        t = r['in_por_qT_utc']
        if t not in cur_h:
            continue
        pairs.append({'time_utc': t, 'level': cur_h[t], 'old_flow': float(r['in_por_q']), 'source': 'log_in_por',
                      'run_at': r['at']})
    for t, q in arch_q.items():
        if t in cur_h:
            pairs.append({'time_utc': t, 'level': cur_h[t], 'old_flow': q, 'source': 'archive', 'run_at': ''})
    pairs.sort(key=lambda p: (p['time_utc'], p['source']))
    last_old_pair_time = max(p['time_utc'] for p in pairs if p['source'] == 'log_in_por')
    for p in pairs:
        p['in_window'] = 1 if (WIN_START <= p['time_utc'] <= last_old_pair_time) else 0
        p['day'] = p['time_utc'][:10]
        p['lk'] = lvl_key(p['level'])
        p['cur_flow'] = cur_q.get(p['time_utc'], float('nan'))
    S['pairs'] = {'log': sum(1 for p in pairs if p['source'] == 'log_in_por'),
                  'archive': sum(1 for p in pairs if p['source'] == 'archive'),
                  'in_window': sum(p['in_window'] for p in pairs),
                  'last_old_pair_time': last_old_pair_time}
    fit_times = {p['time_utc'] for p in pairs}   # timestamps of ALL fit pairs (rule 7)
    # NB rule 7 says "any fit pair of rule 1": all of (a) and (b), not only the in-window ones.

    with open(os.path.join(HERE, 'pairs_fit.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['time_utc', 'day_utc', 'level_ft_today', 'old_flow_cfs', 'current_flow_cfs', 'source', 'run_at', 'in_curve_window'])
        for p in pairs:
            w.writerow([p['time_utc'], p['day'], '%.2f' % p['level'], '%d' % p['old_flow'],
                        '' if math.isnan(p['cur_flow']) else '%d' % p['cur_flow'], p['source'], p['run_at'], p['in_window']])

    # ---------------- per-day lookup + ambiguity ----------------
    by_day_level = collections.defaultdict(list)
    for p in pairs:
        by_day_level[(p['day'], p['lk'])].append(p)
    rows = []
    within_conflict = 0
    for (day, lk), ps in sorted(by_day_level.items()):
        ps.sort(key=lambda p: p['time_utc'])
        flows = sorted({int(p['old_flow']) for p in ps})
        srcs = sorted({p['source'] for p in ps})
        rows.append({'day_utc': day, 'level_ft': '%.2f' % (lk / 100.0), 'n_pairs': len(ps), 'n_distinct_flows': len(flows),
                     'flows': '|'.join(map(str, flows)), 'flow_min': flows[0], 'flow_max': flows[-1],
                     'flow_latest': int(ps[-1]['old_flow']), 'sources': '|'.join(srcs)})
        if len(flows) > 1:
            within_conflict += 1
    with open(os.path.join(HERE, 'lookup_by_day.csv'), 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    S['per_day'] = {'day_level_cells': len(rows), 'cells_with_more_than_one_flow_within_day': within_conflict}
    # within-day conflict, restricted to the curve window
    wc_win = [r for r in rows if r['n_distinct_flows'] > 1 and r['day_utc'] >= WIN_START[:10] and r['day_utc'] <= last_old_pair_time[:10]]
    S['per_day']['conflict_cells_in_window'] = len(wc_win)
    S['per_day']['conflict_examples'] = wc_win[:12]
    # across days: for each level, set of per-day latest flows
    lvl_days = collections.defaultdict(dict)
    for r in rows:
        lvl_days[r['level_ft']][r['day_utc']] = r
    across_all = 0
    across_win = 0
    levels_win = 0
    across_examples = []
    for lv, dd in lvl_days.items():
        flows_all = {r['flow_latest'] for r in dd.values()}
        if len(dd) > 1 and len(flows_all) > 1:
            across_all += 1
        dwin = {d: r for d, r in dd.items() if WIN_START[:10] <= d <= last_old_pair_time[:10]}
        if len(dwin) > 1:
            levels_win += 1
            fl = {r['flow_latest'] for r in dwin.values()}
            if len(fl) > 1:
                across_win += 1
                if len(across_examples) < 15:
                    across_examples.append({'level_ft': lv, 'by_day': {d: r['flow_latest'] for d, r in sorted(dwin.items())}})
    S['across_days'] = {'levels_seen_on_more_than_one_day_all': sum(1 for dd in lvl_days.values() if len(dd) > 1),
                        'levels_with_different_flow_across_days_all': across_all,
                        'levels_seen_on_more_than_one_day_in_window': levels_win,
                        'levels_with_different_flow_across_days_in_window': across_win,
                        'examples_in_window': across_examples}
    # ---------------- curve (CURVE_DEFINITION rules 3-5) ----------------
    latest = {}   # lk -> pair (latest by timestamp) in window
    for p in pairs:
        if p['in_window']:
            if p['lk'] not in latest or p['time_utc'] > latest[p['lk']]['time_utc']:
                latest[p['lk']] = p
    knots = sorted((lk, int(p['old_flow'])) for lk, p in latest.items())
    klev = [k[0] for k in knots]
    kflow = [k[1] for k in knots]
    S['curve'] = {'n_knots': len(knots), 'level_min_ft': klev[0] / 100, 'level_max_ft': klev[-1] / 100,
                  'knots': [{'level_ft': lk / 100, 'flow': fl} for lk, fl in knots]}
    nonmono = [(klev[i], kflow[i], kflow[i + 1]) for i in range(len(knots) - 1) if kflow[i + 1] < kflow[i]]
    S['curve']['non_monotone_adjacent_knots'] = len(nonmono)

    def ratio_at(ends):
        ws = [p for p in pairs if p['in_window'] and p['lk'] in ends and not math.isnan(p['cur_flow'])]
        return (sum(p['cur_flow'] for p in ws) / sum(p['old_flow'] for p in ws)), len(ws)
    r_low, n_low = ratio_at({klev[0], klev[1]})
    r_high, n_high = ratio_at({klev[-1], klev[-2]})
    S['curve']['ratio_low_end'] = {'ratio_current_over_old': r_low, 'n_pairs': n_low, 'levels_ft': [klev[0] / 100, klev[1] / 100]}
    S['curve']['ratio_high_end'] = {'ratio_current_over_old': r_high, 'n_pairs': n_high, 'levels_ft': [klev[-1] / 100, klev[-2] / 100]}

    def interp(lk, i0, i1):
        l0, l1 = klev[i0], klev[i1]
        f0, f1 = kflow[i0], kflow[i1]
        return f0 + (f1 - f0) * (lk - l0) / (l1 - l0)

    def f_old(lk, cur_flow, rule):
        """returns (flow, flag). flag: observed / interpolated / extrapolated_low / extrapolated_high"""
        if lk in latest:
            return int(latest[lk]['old_flow']), 'observed'
        if klev[0] < lk < klev[-1]:
            j = max(i for i in range(len(klev)) if klev[i] < lk)
            return round10(interp(lk, j, j + 1)), 'interpolated'
        if lk < klev[0]:
            if rule == 'A':
                return round10(interp(lk, 0, 1)), 'extrapolated_low'
            return round10(cur_flow / r_low), 'extrapolated_low'
        if rule == 'A':
            return round10(interp(lk, len(klev) - 2, len(klev) - 1)), 'extrapolated_high'
        return round10(cur_flow / r_high), 'extrapolated_high'

    # ---------------- rule C (added 2026-11-23, see CURVE_DEFINITION.md dated entry) ----------------
    # Same knots as rules A/B plus two knots from the old archive of 9 to 12 Oct (1.01 ft and 1.02 ft); below 1.01 ft linear
    # through those two knots, rounded to 10 cfs; at and above the window knot range rule C equals rule A.
    oct_knots = {}
    for lk in (101, 102):
        ps = [p for p in pairs if p['source'] == 'archive' and p['lk'] == lk and '2026-10-09' <= p['day'] <= '2026-10-12']
        fl = sorted({int(p['old_flow']) for p in ps})
        oct_knots[lk] = {'pairs': len(ps), 'flows': fl, 'days': sorted({p['day'] for p in ps})}
    if oct_knots[101]['flows'] != [1200] or oct_knots[102]['flows'] != [1220]:
        sys.exit('STOP: October archive knots are not 1.01 ft = 1200 and 1.02 ft = 1220: %s' % json.dumps(oct_knots))
    S['rule_C_october_knots'] = {'1.01': oct_knots[101], '1.02': oct_knots[102]}

    def f_old_C(lk, cur_flow):
        """returns (flow, flag_C): observed (window knot) / observed_oct_knot (1.01, 1.02 ft) / interpolated / extrapolated_low (below 1.01 ft) / extrapolated_high"""
        if lk in latest:
            return int(latest[lk]['old_flow']), 'observed'
        if lk in (101, 102):
            return (1200 if lk == 101 else 1220), 'observed_oct_knot'
        if lk < 101:
            return round10(1200 + (1220 - 1200) * (lk - 101) / 1.0), 'extrapolated_low'
        return f_old(lk, cur_flow, 'A')

    # ---------------- f_old_values.csv ----------------
    cutoff_ms = None
    out_rows = []
    for t in sorted(cur_q):
        if t < HIST_START or t not in cur_h:
            continue
        lk = lvl_key(cur_h[t])
        a, flag = f_old(lk, cur_q[t], 'A')
        b, _ = f_old(lk, cur_q[t], 'B')
        c_val, c_flag = f_old_C(lvl_key(cur_h[t]), cur_q[t])
        out_rows.append([t, '%.2f' % cur_h[t], a, b, flag, 1 if t in fit_times else 0, '%d' % cur_q[t],
                         ('%d' % arch_q[t]) if t in arch_q else '', c_val, c_flag])
    with open(os.path.join(HERE, 'f_old_values.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['time_utc', 'level_ft_today', 'f_old_rule_A_cfs', 'f_old_rule_B_cfs', 'flag', 'is_fit_pair', 'current_record_cfs', 'old_archive_cfs', 'f_old_rule_C_cfs', 'flag_rule_C'])
        w.writerows(out_rows)
    S['f_old_values'] = {'rows': len(out_rows), 'first': out_rows[0][0], 'last': out_rows[-1][0],
                         'by_flag': dict(collections.Counter(r[4] for r in out_rows)),
                         'by_flag_to_cutoff_of_old_period': dict(collections.Counter(r[4] for r in out_rows if r[0] <= HIST_END)),
                         'by_flag_after_old_period': dict(collections.Counter(r[4] for r in out_rows if r[0] > HIST_END))}
    def band(r):
        lv = float(r[1])
        return 'inside_knots_1.03_to_1.24' if 1.03 <= lv <= 1.24 + 1e-9 else ('1.01_to_1.02' if lv >= 1.01 - 1e-9 else 'below_1.01') if lv < 1.03 else 'above_knots'
    S['rule_C_bands'] = {'all': dict(collections.Counter(band(r) for r in out_rows)),
                         'to_13Nov_17_55': dict(collections.Counter(band(r) for r in out_rows if r[0] <= HIST_END)),
                         'after_13Nov_17_55': dict(collections.Counter(band(r) for r in out_rows if r[0] > HIST_END)),
                         'flag_rule_C_all': dict(collections.Counter(r[9] for r in out_rows)),
                         'rule_values_by_level_below_1.03': {r[1]: [r[2], r[3], r[8]] for r in sorted(out_rows, key=lambda r: r[1]) if float(r[1]) < 1.03}}
    # distinct flows by level in the extrapolated zone (needed by whom): levels
    ext_levels = collections.Counter(r[1] for r in out_rows if r[4].startswith('extrapolated'))
    S['extrapolated_levels_counts'] = dict(sorted(ext_levels.items()))
    S['lowest_level_after_old_period_ft'] = min(float(r[1]) for r in out_rows if r[0] > HIST_END)
    S['lowest_level_in_f_old_values_ft'] = min(float(r[1]) for r in out_rows)

    # ---------------- step 4: test set ----------------
    test = collections.OrderedDict()   # hist_ts -> info
    conflicts = 0
    for r in runs:
        if r['out'] != 'predicted' or not r['hist_ts_utc']:
            continue
        ts = r['hist_ts_utc']
        if not (HIST_START <= ts <= HIST_END):
            continue
        if ts in fit_times:
            continue
        lg = float(r['hist_cfs'])
        if ts in test:
            test[ts]['n_runs'] += 1
            if test[ts]['logged'] != lg:
                conflicts += 1
        else:
            test[ts] = {'logged': lg, 'first_run_at': r['at'], 'n_runs': 1}
    n_excluded_in_fit = len({r['hist_ts_utc'] for r in runs if r['out'] == 'predicted' and r['hist_ts_utc'] and HIST_START <= r['hist_ts_utc'] <= HIST_END and r['hist_ts_utc'] in fit_times})
    trows = []
    for ts, info in test.items():
        if ts not in cur_h:
            trows.append([ts, info['first_run_at'], info['n_runs'], '%d' % info['logged'], '', 'no_level_today', '', '', '', '', '', ''])
            continue
        lk = lvl_key(cur_h[ts])
        a, flag = f_old(lk, cur_q.get(ts, float('nan')), 'A')
        b, _ = f_old(lk, cur_q.get(ts, float('nan')), 'B')
        trows.append([ts, info['first_run_at'], info['n_runs'], '%d' % info['logged'], '%.2f' % cur_h[ts], flag, a, b,
                      a - int(info['logged']), b - int(info['logged']), 1 if a == info['logged'] else 0, 1 if b == info['logged'] else 0])
    with open(os.path.join(HERE, 'pairs_test.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['hist_ts_utc', 'first_run_at', 'n_runs_using_it', 'logged_hist_cfs', 'level_ft_today', 'flag', 'f_old_rule_A_cfs', 'f_old_rule_B_cfs',
                    'diff_A_cfs', 'diff_B_cfs', 'exact_A', 'exact_B'])
        w.writerows(trows)

    def tstats(col_diff, col_exact):
        rr = [r for r in trows if r[col_exact] != '']
        n = len(rr)
        ex = sum(r[col_exact] for r in rr)
        diffs = [abs(r[col_diff]) for r in rr]
        bins = collections.OrderedDict([('exact', 0), ('10', 0), ('20', 0), ('30-40', 0), ('50+', 0)])
        for d in diffs:
            if d == 0: bins['exact'] += 1
            elif d == 10: bins['10'] += 1
            elif d == 20: bins['20'] += 1
            elif d <= 40: bins['30-40'] += 1
            else: bins['50+'] += 1
        return {'n': n, 'exact': ex, 'exact_share': ex / n if n else None, 'abs_diff_bins': bins,
                'max_abs_diff': max(diffs) if diffs else None, 'within_20': sum(1 for d in diffs if d <= 20)}
    S['test_set'] = {'n_unique_timestamps': len(test), 'timestamps_excluded_because_in_fit': n_excluded_in_fit,
                     'conflicting_logged_values_same_timestamp': conflicts,
                     'no_level_today': sum(1 for r in trows if r[5] == 'no_level_today'),
                     'rule_A': tstats(8, 10), 'rule_B': tstats(9, 11),
                     'flags': dict(collections.Counter(r[5] for r in trows))}
    S['test_set']['needed_extrapolation_rule_A'] = [r[0] for r in trows if r[5].startswith('extrapolated')]
    S['test_set']['needed_extrapolation_rule_B'] = S['test_set']['needed_extrapolation_rule_A']
    # misses, listed
    S['test_set']['misses_A'] = [{'ts': r[0], 'level': r[4], 'logged': r[3], 'A': r[6], 'diff': r[8], 'flag': r[5]} for r in trows if r[10] == 0][:60]
    S['test_set']['misses_B'] = [{'ts': r[0], 'level': r[4], 'logged': r[3], 'B': r[7], 'diff': r[9], 'flag': r[5]} for r in trows if r[11] == 0][:60]

    # ---------------- in-sample check of the old current readings (not a test) ----------------
    insample = {'n': 0, 'exact_A': 0, 'exact_B': 0, 'misses': []}
    for r in old_runs:
        t = r['in_por_qT_utc']
        if t not in cur_h:
            continue
        lk = lvl_key(cur_h[t])
        a, flag = f_old(lk, cur_q[t], 'A')
        b, _ = f_old(lk, cur_q[t], 'B')
        lg = float(r['in_por_q'])
        insample['n'] += 1
        insample['exact_A'] += int(a == lg)
        insample['exact_B'] += int(b == lg)
        if a != lg or b != lg:
            insample['misses'].append({'run_at': r['at'], 'qT': t, 'logged': lg, 'A': a, 'B': b, 'flag': flag})
    S['insample_old_current_readings'] = insample

    # ---------------- ranges ----------------
    S['fit_level_range_all_pairs'] = {'log_pairs_min_max_ft': [min(p['level'] for p in pairs if p['source'] == 'log_in_por'),
                                                              max(p['level'] for p in pairs if p['source'] == 'log_in_por')],
                                      'archive_pairs_min_max_ft': [min(p['level'] for p in pairs if p['source'] == 'archive'),
                                                                   max(p['level'] for p in pairs if p['source'] == 'archive')],
                                      'window_pairs_min_max_ft': [min(p['level'] for p in pairs if p['in_window']),
                                                                  max(p['level'] for p in pairs if p['in_window'])]}
    # ---------------- diagnostic only (never enters the curve): what the archive says at levels below the knot range ----------------
    diag = []
    for lk in range(klev[0] - 12, klev[0]):
        ps = [p for p in pairs if p['source'] == 'archive' and p['lk'] == lk]
        if not ps:
            diag.append({'level_ft': lk / 100, 'archive_pairs': 0})
            continue
        fl = collections.Counter(int(p['old_flow']) for p in ps)
        la = max(ps, key=lambda p: p['time_utc'])
        diag.append({'level_ft': lk / 100, 'archive_pairs': len(ps), 'distinct_flows': len(fl),
                     'most_common_flow': fl.most_common(1)[0][0], 'flow_min': min(fl), 'flow_max': max(fl),
                     'latest_pair_time': la['time_utc'], 'latest_pair_flow': int(la['old_flow']),
                     'rule_A_value': f_old(lk, float('nan'), 'A')[0]})
    S['diagnostic_archive_below_knot_range'] = diag
    with open(os.path.join(HERE, 'f_old_summary.json'), 'w') as f:
        json.dump(S, f, indent=1, sort_keys=True, default=str)
    write_report(S)


def write_report(S):
    L = []
    A = L.append
    lt = S['level_test']
    A('# F_OLD_REPORT: the old curve (PLAN 4.3, audit N1 and N6)')
    A('')
    A('Generated by `build_f_old.py` from the frozen tables only; all numbers below are copied from `f_old_summary.json`.')
    A('The curve is defined in `CURVE_DEFINITION.md`, which was written before the test set was computed.')
    A('')
    A('## 1. Level test (first step)')
    A('')
    A('Logged `in.por.h` at `in.por.hT` against today\'s Point of Rocks level at the same timestamp, 0.01 ft, all predicted runs with a logged level.')
    A('')
    A('| set | runs | equal | share |')
    A('|---|---|---|---|')
    A('| all predicted runs | %d | %d | %.4f |' % (lt['n'], lt['equal'], lt['equal'] / lt['n']))
    A('| runs whose flow reading is old (the ones the curve relies on) | %d | %d | %.4f |' % (S['level_test_old_runs']['n'], S['level_test_old_runs']['equal'], S['level_test_old_runs']['equal'] / S['level_test_old_runs']['n']))
    A('')
    for u in lt['unequal']:
        A('Unequal: run %s, reading %s, logged %s ft, today %s ft.' % (u['run_at'], u['hT'], u['logged'], u['today']))
    A('')
    A('## 2. Pairs and per-day lookups')
    A('')
    p = S['pairs']
    A('- Runs with an old current flow (logged `in.por.q` differs from the current record at `in.por.qT`): %d, first %s, last %s. First run whose reading equals the current record: %s. Old-reading runs after that run: %d.' % (S['n_old_reading_runs'], S['old_runs_first_at'], S['old_runs_last_at'], S['first_new_reading_run_at'], S['old_runs_after_first_new']))
    if S['runs_logged_flow_differs_from_today_after_revision']:
        A('- Runs after the revision whose logged flow differs from today\'s record (value rewritten by USGS after the run, or level rewritten): %s' % json.dumps(S['runs_logged_flow_differs_from_today_after_revision']))
    A('- Pairs (a) from the log: %d. Pairs (b) archive flow with today\'s level: %d. Pairs inside the curve window (7 Nov 00:00 to %s): %d.' % (p['log'], p['archive'], p['last_old_pair_time'], p['in_window']))
    fr = S['fit_level_range_all_pairs']
    A('- Level range: log pairs %.2f to %.2f ft; archive pairs (all months) %.2f to %.2f ft; window pairs %.2f to %.2f ft.' % (fr['log_pairs_min_max_ft'][0], fr['log_pairs_min_max_ft'][1], fr['archive_pairs_min_max_ft'][0], fr['archive_pairs_min_max_ft'][1], fr['window_pairs_min_max_ft'][0], fr['window_pairs_min_max_ft'][1]))
    pd = S['per_day']
    A('- Lookup cells (day x level): %d. Cells where the same level maps to more than one flow WITHIN a day: %d (in the curve window: %d).' % (pd['day_level_cells'], pd['cells_with_more_than_one_flow_within_day'], pd['conflict_cells_in_window']))
    ad = S['across_days']
    A('- ACROSS days (flow of the latest pair of each day): levels seen on more than one day %d, of which with different flows on different days %d (all dates). Inside the curve window: levels seen on more than one day %d, of which with different flows %d.' % (ad['levels_seen_on_more_than_one_day_all'], ad['levels_with_different_flow_across_days_all'], ad['levels_seen_on_more_than_one_day_in_window'], ad['levels_with_different_flow_across_days_in_window']))
    A('')
    if pd['conflict_examples']:
        A('Within-day conflicts in the window (first 12):')
        A('')
        A('| day | level ft | flows | n pairs | sources |')
        A('|---|---|---|---|---|')
        for r in pd['conflict_examples']:
            A('| %s | %s | %s | %s | %s |' % (r['day_utc'], r['level_ft'], r['flows'], r['n_pairs'], r['sources']))
        A('')
    if ad['examples_in_window']:
        A('Across-day differences in the window (first 15):')
        A('')
        for e in ad['examples_in_window']:
            A('- %s ft: %s' % (e['level_ft'], ', '.join('%s: %s' % (d, f) for d, f in e['by_day'].items())))
        A('')
    A('Full per-day lookup: `lookup_by_day.csv`; all pairs: `pairs_fit.csv`.')
    A('')
    A('## 3. The curve in force on the last old days')
    A('')
    c = S['curve']
    A('Rule (CURVE_DEFINITION.md): knots = latest pair per level in the window; linear in level between knots, rounded to 10 cfs; outside the knot range rule A (linear through the two end knots) and rule B (constant ratio to the current record).')
    A('')
    A('- Knots: %d, level %.2f to %.2f ft. Adjacent knots where flow decreases with level: %d.' % (c['n_knots'], c['level_min_ft'], c['level_max_ft'], c['non_monotone_adjacent_knots']))
    A('- Rule B ratio (current / old) at the two lowest knot levels (%s ft): %.4f over %d pairs; at the two highest (%s ft): %.4f over %d pairs.' % (c['ratio_low_end']['levels_ft'], c['ratio_low_end']['ratio_current_over_old'], c['ratio_low_end']['n_pairs'], c['ratio_high_end']['levels_ft'], c['ratio_high_end']['ratio_current_over_old'], c['ratio_high_end']['n_pairs']))
    A('')
    A('| level ft | old flow cfs |')
    A('|---|---|')
    for k in c['knots']:
        A('| %.2f | %d |' % (k['level_ft'], k['flow']))
    A('')
    A('## 4. Test set (separate from the fit set)')
    A('')
    ts = S['test_set']
    A('Logged time-shifted readings (`hist.cfs` at `hist.ts`) stamped 10 Nov 00:00 to 13 Nov 17:55 whose timestamp is not the timestamp of any fit pair: %d unique timestamps (%d further timestamps excluded because they are fit-pair timestamps). Conflicting logged values for one timestamp: %d. Timestamps without a level today: %d.' % (ts['n_unique_timestamps'], ts['timestamps_excluded_because_in_fit'], ts['conflicting_logged_values_same_timestamp'], ts['no_level_today']))
    A('')
    A('| rule | n | exact | share exact | within 20 cfs | absolute difference: exact / 10 / 20 / 30-40 / 50+ | max abs diff |')
    A('|---|---|---|---|---|---|---|')
    for nm, k in (('A', 'rule_A'), ('B', 'rule_B')):
        t = ts[k]
        b = t['abs_diff_bins']
        A('| %s | %d | %d | %.4f | %d | %d / %d / %d / %d / %d | %s |' % (nm, t['n'], t['exact'], t['exact_share'], t['within_20'], b['exact'], b['10'], b['20'], b['30-40'], b['50+'], t['max_abs_diff']))
    A('')
    A('Flags of the test readings: %s.' % json.dumps(ts['flags']))
    A('')
    A('Limits of this test (facts about its design): the test readings use today\'s level, as the fit pairs do, so a later revision of the level could not show here (step 1 found the level equal to the logged one on %d of %d runs); a test reading whose level is a knot level (flag `observed`) tests that the same level kept the same flow over the days, not the interpolation between knots; %d of %d test readings are of that kind.' % (S['level_test']['equal'], S['level_test']['n'], ts['flags'].get('observed', 0), ts['n_unique_timestamps']))
    A('')
    A('Misses under rule A (first 60; sign = f_old minus logged):')
    A('')
    A('| timestamp | level ft | logged | rule A | diff | flag |')
    A('|---|---|---|---|---|---|')
    for m in ts['misses_A']:
        A('| %s | %s | %s | %s | %s | %s |' % (m['ts'], m['level'], m['logged'], m['A'], m['diff'], m['flag']))
    A('')
    A('Misses under rule B where they differ in size from rule A are in `pairs_test.csv` (columns `diff_B_cfs`, `exact_B`).')
    A('')
    ins = S['insample_old_current_readings']
    A('In-sample (NOT a test): the %d old current readings that are themselves fit pairs reproduce exactly under rule A in %d runs and rule B in %d runs; this is circular by construction (the curve was fitted on them). Differences arise only where one level has more than one old flow.' % (ins['n'], ins['exact_A'], ins['exact_B']))
    A('')
    A('## 5. Levels outside the fitted range (extrapolation)')
    A('')
    fv = S['f_old_values']
    A('`f_old_values.csv`: %d five-minute timestamps from %s to %s (every Point of Rocks timestamp of the current record with a level).' % (fv['rows'], fv['first'], fv['last']))
    A('')
    A('| period | flag counts |')
    A('|---|---|')
    A('| 10 Nov 00:00 to 13 Nov 17:55 (rebuilding what the job stored) | %s |' % json.dumps(fv['by_flag_to_cutoff_of_old_period']))
    A('| after 13 Nov 17:55 (counterfactual) | %s |' % json.dumps(fv['by_flag_after_old_period']))
    A('| all | %s |' % json.dumps(fv['by_flag']))
    A('')
    A('Extrapolated readings by level (ft: number of timestamps): %s.' % json.dumps(S['extrapolated_levels_counts']))
    A('')
    A('Lowest level after 13 Nov 17:55: %.2f ft. Test readings that needed extrapolation: %d.' % (S['lowest_level_after_old_period_ft'], len(ts['needed_extrapolation_rule_A'])))
    A('')
    A('Diagnostic only (does not enter the curve): what the old archive (any month, 12 Jun to 9 Nov) holds at the levels just below the knot range, beside the rule A value:')
    A('')
    A('| level ft | archive pairs | distinct flows | most common | min | max | latest pair | its flow | rule A |')
    A('|---|---|---|---|---|---|---|---|---|')
    for d in S['diagnostic_archive_below_knot_range']:
        if d['archive_pairs'] == 0:
            A('| %.2f | 0 | | | | | | | |' % d['level_ft'])
        else:
            A('| %.2f | %d | %d | %d | %d | %d | %s | %d | %d |' % (d['level_ft'], d['archive_pairs'], d['distinct_flows'], d['most_common_flow'], d['flow_min'], d['flow_max'], d['latest_pair_time'], d['latest_pair_flow'], d['rule_A_value']))
    A('')
    rc = S['rule_C_bands']
    A('### Rule C (added 2026-11-23; see the dated entry in CURVE_DEFINITION.md)')
    A('')
    ok = S['rule_C_october_knots']
    A('Rule C = the window knots plus two knots from the old archive of 9 to 12 Oct: 1.01 ft = 1200 cfs (%d archive pairs, flows %s, days %s) and 1.02 ft = 1220 cfs (%d pairs, flows %s, days %s). Below 1.01 ft: linear through those two knots, rounded to 10 cfs. At and above the window knot range: equal to rule A. Rules A and B are unchanged.' % (ok['1.01']['pairs'], ok['1.01']['flows'], ','.join(ok['1.01']['days']), ok['1.02']['pairs'], ok['1.02']['flows'], ','.join(ok['1.02']['days'])))
    A('')
    A('Readings per level band (five-minute stamps in `f_old_values.csv`, 10 Nov 00:00 to the cutoff):')
    A('')
    A('| band | all | 10 Nov to 13 Nov 17:55 | after 13 Nov 17:55 |')
    A('|---|---|---|---|')
    for bn, lbl in (('inside_knots_1.03_to_1.24', 'inside the knots (1.03 to 1.24 ft)'), ('1.01_to_1.02', '1.01 to 1.02 ft'), ('below_1.01', 'below 1.01 ft'), ('above_knots', 'above the knots')):
        A('| %s | %d | %d | %d |' % (lbl, rc['all'].get(bn, 0), rc['to_13Nov_17_55'].get(bn, 0), rc['after_13Nov_17_55'].get(bn, 0)))
    A('')
    A('Values at the levels below the knot range (level ft: rule A, rule B, rule C): %s.' % json.dumps(rc['rule_values_by_level_below_1.03']))
    A('')
    A('Below 1.01 ft no rule (A, B or C) is demonstrated to bound the old curve: the only old values below 1.03 ft are the two October levels, and the three rules are three assumptions about the curve further down.')
    A('')
    A('### Edits to this script after its first outputs (audit finding 5)')
    A('')
    A('See CURVE_DEFINITION.md, dated entries: (1) the old-run classification became the contiguous prefix up to the first run whose logged flow equals the current record (the first version also took seq 212, a rewritten value after the revision, as an old pair; I saw that output first: window to 18 Nov, 3 of 77 test misses at 1.14 ft); (2) an unused statistic was removed; (3) the diagnostic table and the limits paragraph were added. Rules A and B were not changed. The test of 77 readings is a constancy test only (same level, same flow over the days); it does not test interpolation or extrapolation.')
    A('')
    A('Rules A, B and C are carried in `f_old_values.csv` (`f_old_rule_A_cfs`, `f_old_rule_B_cfs`, `f_old_rule_C_cfs`); inside the knot range they are identical.')
    A('')
    open(os.path.join(HERE, 'F_OLD_REPORT.md'), 'w').write('\n'.join(L) + '\n')


if __name__ == '__main__':
    main()
