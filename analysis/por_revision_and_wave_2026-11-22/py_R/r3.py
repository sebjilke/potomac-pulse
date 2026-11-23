from lib import *
from data import *


def iso_lm(s):
    t = ts(s)
    if t is None:
        return ''
    t2 = s.strip()
    if t2.endswith('+00:00'):
        t2 = t2[:-6] + 'Z'
    return t2


def build_visits(c, rep=None):
    """All gauges. Returns dict gauge -> list of visit dicts; drops full duplicates (all columns except feature_id, source_file)."""
    seen = set()
    rows = []
    dropped = collections.Counter()
    for r in c.field:
        key = tuple(v for k, v in r.items() if k not in ('feature_id', 'source_file'))
        if key in seen:
            dropped[r['gauge']] += 1
            continue
        seen.add(key)
        rows.append(r)
    byv = collections.OrderedDict()
    for r in rows:
        byv.setdefault((r['gauge'], r['field_visit_id']), []).append(r)
    out = collections.defaultdict(list)
    nmulti = collections.Counter()
    for (g, vid), rs in byv.items():
        dis = [r for r in rs if r['parameter_code'] == '00060' and r['reading_type'] == 'Discharge']
        lev = [r for r in rs if r['parameter_code'] == '00065' and r['reading_type'] == 'MeanGageHeight']

        def pick(lst):
            return max(lst, key=lambda r: (ts(r['last_modified']), r['feature_id'])) if lst else None
        if len(dis) > 1 or len(lev) > 1:
            nmulti[g] += 1
        d, l = pick(dis), pick(lev)
        if d is not None and d['visit_time_utc']:
            vt = d['visit_time_utc']
        else:
            vt = min(r['visit_time_utc'] for r in rs if r['visit_time_utc'])
        out[g].append(dict(gauge=g, visit_time_utc=vt, t=ts(vt), field_visit_id=vid,
                           level_ft=float(l['value']) if l and l['value'] != '' else None,
                           flow_cfs=float(d['value']) if d and d['value'] != '' else None,
                           has_flow=(d is not None and d['value'] != ''),
                           control_condition=d['control_condition'] if d else '',
                           measurement_rated=d['measurement_rated'] if d else '',
                           observing_procedure=d['observing_procedure'] if d else '',
                           last_modified=iso_lm(d['last_modified']) if d else '',
                           n_rows=len(rs), n_reference_rows=sum(1 for r in rs if r['reading_type'] == 'ReferencePrimary')))
    for g in out:
        out[g].sort(key=lambda v: (v['t'], v['field_visit_id']))
    if rep is not None:
        rep.append('R3: duplicate field-measurement rows dropped (all gauges): %d; by gauge %s' % (sum(dropped.values()), dict(dropped)))
        rep.append('R3: rows kept %d; visits with more than one Discharge or MeanGageHeight row, by gauge: %s' % (len(rows), dict(nmulti)))
    return out, dropped, nmulti


COLS_V = ['gauge', 'visit_time_utc', 'field_visit_id', 'level_ft', 'flow_cfs', 'control_condition', 'measurement_rated',
          'observing_procedure', 'last_modified', 'n_rows', 'n_reference_rows']


def run(c, M, rep):
    visits, dropped, nmulti = build_visits(c, rep)
    c.visits = visits
    M.add('R3', 'n_duplicate_rows_dropped_PoR_LF', dropped[POR] + dropped[LF])
    M.add('R3', 'n_visits_multi_row_PoR_LF', nmulti[POR] + nmulti[LF])
    rows = []
    for g in (POR, LF):
        rows.extend(visits[g])
    n = write_table('R3_visits', COLS_V, rows)
    rep.append('R3_visits rows %d' % n)
    for g in (POR, LF):
        vs = visits[g]
        for y in range(2021, 2027):
            yy = [v for v in vs if v['visit_time_utc'][:4] == str(y)]
            M.add('R3', 'visits_%s_%d' % (g, y), len(yy))
            M.add('R3', 'visits_with_flow_%s_%d' % (g, y), sum(1 for v in yy if v['has_flow']))
        t0 = ts('2021-01-01T00:00:00Z')
        tt = [v['t'] for v in vs if v['t'] >= t0]
        gaps = [(b - a) / DAY for a, b in zip(tt, tt[1:])]
        M.add('R3', 'median_days_between_visits', median(gaps), g)
        M.add('R3', 'n_intervals_median_days_between_visits', len(gaps), g)

    # 2. measured against published
    por_cur = c.cen[(POR, '00060')]
    por_old = c.old[(POR, '00060')]
    ct, ot = sorted(por_cur), sorted(por_old)
    rows = []
    for v in visits[POR]:
        if v['t'] < ts('2025-01-01T00:00:00Z') or not v['has_flow']:
            continue
        a = nearest_within(ct, v['t'], 900)
        b = nearest_within(ot, v['t'], 900)
        cc = por_cur[a][0] if a is not None else None
        oo = por_old[b][0] if b is not None else None
        m = v['flow_cfs']
        rows.append(dict(visit_time_utc=v['visit_time_utc'], level_ft=v['level_ft'], measured_cfs=m,
                         measurement_rated=v['measurement_rated'], control_condition=v['control_condition'],
                         current_cfs=cc, old_cfs=oo,
                         pct_current_vs_measured=((cc - m) / m * 100) if (cc is not None and m) else None,
                         pct_old_vs_measured=((oo - m) / m * 100) if (oo is not None and m) else None))
    rows.sort(key=lambda r: r['visit_time_utc'])
    c.mvp = rows
    n = write_table('R3_measured_vs_published', ['visit_time_utc', 'level_ft', 'measured_cfs', 'measurement_rated', 'control_condition',
                                                   'current_cfs', 'old_cfs', 'pct_current_vs_measured', 'pct_old_vs_measured'], rows)
    rep.append('R3_measured_vs_published rows %d' % n)

    # 3. census of rewrites
    rows = []
    for g in (POR, LF):
        d = c.cen[(g, '00060')]
        grp = collections.defaultdict(list)
        nlm = 0
        for t, (v, lm) in d.items():
            if lm is None:
                nlm += 1
                continue
            grp[iso_minute(lm)].append(t)
        vt = [v['t'] for v in visits[g] if v['has_flow']]
        tot = len(d)
        inbulk = 0
        nb = nb7 = 0
        longest = None
        for k in sorted(grp):
            ts_ = grp[k]
            if len(ts_) < 96:
                continue
            nb += 1
            inbulk += len(ts_)
            lmm = ts(k)
            span = (max(ts_) - min(ts_)) / DAY
            j = bisect.bisect_right(sorted(vt), lmm)
            vts = sorted(vt)
            dsl = (lmm - vts[j - 1]) / DAY if j > 0 else None
            if dsl is not None and dsl <= 7:
                nb7 += 1
            longest = span if longest is None else max(longest, span)
            rows.append(dict(gauge=g, lm_minute=k, n_readings=len(ts_), first_time_utc=iso(min(ts_)), last_time_utc=iso(max(ts_)),
                             span_days=span, days_since_last_visit=dsl))
        M.add('R3', 'n_bulk', nb, g)
        M.add('R3', 'share_of_readings_in_bulk', inbulk / tot, g)
        M.add('R3', 'n_bulk_within_7_days_after_a_visit', nb7, g)
        M.add('R3', 'longest_span_days', longest, g)
        M.add('R3', 'n_readings_census', tot, g)
        M.add('R3', 'n_readings_without_lm', nlm, g)
    rows.sort(key=lambda r: (r['gauge'], r['lm_minute']))
    n = write_table('R3_bulk_rewrites', ['gauge', 'lm_minute', 'n_readings', 'first_time_utc', 'last_time_utc', 'span_days', 'days_since_last_visit'], rows)
    rep.append('R3_bulk_rewrites rows %d' % n)
