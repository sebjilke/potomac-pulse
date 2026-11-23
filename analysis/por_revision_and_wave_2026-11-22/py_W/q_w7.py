"""Question W7."""
from ppw import *

def run(ctx):
    p1 = S + '../rising-limb-travel-backtest/hourly_backtest_data_v39.csv'
    p2 = S + '../replay_lag_2026-11-17/shadow_F.csv'
    por = []; lf = []; first = last = None; n = 0
    with open(p1, newline='') as f:
        r = csv.DictReader(f)
        for row in r:
            t = parse_iso(row['timestamp']); n += 1
            if first is None: first = t
            last = t
            if row['por_now'] != '': por.append((t, float(row['por_now'])))
            if row['lf_discharge'] != '': lf.append((t, float(row['lf_discharge'])))
    log('W7 hourly file rows %d from %s to %s' % (n, iso(first), iso(last)))
    sp = Series('por_now', por, first, last, maxgap=7200); sl = Series('lf_discharge', lf, first, last, maxgap=7200)
    for s in (sp, sl): log('W7 series %s: %s' % (s.label, s.counts_str()))
    info = {}
    for nm, s in (('por', sp), ('lf', sl)):
        d = {}
        for dn in s.days():
            x = s.day_info(dn, want_b=False, want_crest=False)
            x['event'] = s.event_flow(dn)
            d[dn] = x
        info[nm] = d
    def nonev(nm, dn): return not info[nm][dn]['event']
    def wave(nm, dn):
        x = info[nm][dn]
        return (not x['event']) and x['A_a_rel'] is not None and x['A_a_rel'] >= 0.03
    ym = collections.OrderedDict()
    for dn in sp.days():
        dt = datetime.date.fromordinal(dn + 719163)
        ym.setdefault((dt.year, dt.month), []).append(dn)
    rows = []
    for (y, m), dl in sorted(ym.items()):
        o = [y, m, len(dl)]
        for nm in ('por', 'lf'):
            ne = [d for d in dl if nonev(nm, d)]
            o += [len(ne), sum(1 for d in dl if wave(nm, d))]
        o += [median([info['por'][d]['A_a_rel'] for d in dl if nonev('por', d) and info['por'][d]['A_a_rel'] is not None]),
              median([info['lf'][d]['A_a_rel'] for d in dl if nonev('lf', d) and info['lf'][d]['A_a_rel'] is not None])]
        rows.append(o)
    log('W7_year_month rows %d' % write_table('W7_year_month', ['year', 'month', 'n_days', 'n_non_event_por', 'n_wave_por', 'n_non_event_lf', 'n_wave_lf',
                                                              'median_A_a_rel_por', 'median_A_a_rel_lf'], rows))
    cls = [(0, 2000), (2000, 3000), (3000, 6000), (6000, float('inf'))]
    rows = []
    for lo, hi in cls:
        dl = [d for d in sl.days() if info['lf'][d]['day_mean'] is not None and lo <= info['lf'][d]['day_mean'] < hi]
        nep = sum(1 for d in dl if nonev('por', d)); nwp = sum(1 for d in dl if wave('por', d))
        rows.append([lo, len(dl), nep, nwp, (nwp / nep) if nep else None, sum(1 for d in dl if nonev('lf', d)), sum(1 for d in dl if wave('lf', d))])
    log('W7_flow_class rows %d' % write_table('W7_flow_class', ['class_lo', 'n_days', 'n_non_event_por', 'n_wave_por', 'share_wave_por', 'n_non_event_lf', 'n_wave_lf'], rows))
    # (b)
    bounds = [0.0, 0.01, 0.03, 0.06]
    acc = {b: dict(raw=[], corr=[], days=set()) for b in bounds}
    nread = nsel = 0
    with open(p2, newline='') as f:
        r = csv.DictReader(f)
        for row in r:
            nread += 1
            if row['status'] != 'predicted' or row['truthDependentHard'] != '0' or row['truthInProdRange'] != '1': continue
            if row['errPctRaw'] == '' or row['errPctCorr'] == '' or row['predTs'] < '2011-12-04T05:00:00.000Z': continue
            if row['truthFlow'] == '' or float(row['truthFlow']) >= 3000: continue
            dn = day_of_date(row['predTs'][:10])
            x = info['por'].get(dn)
            if x is None or x['event'] or x['A_a_rel'] is None: continue
            a = x['A_a_rel']
            b = 0.0 if a < 0.01 else (0.01 if a < 0.03 else (0.03 if a < 0.06 else 0.06))
            acc[b]['raw'].append(abs(float(row['errPctRaw']))); acc[b]['corr'].append(abs(float(row['errPctCorr']))); acc[b]['days'].add(dn); nsel += 1
    log('W7 shadow_F rows read %d, rows kept %d' % (nread, nsel))
    rows = [[b, len(acc[b]['raw']), len(acc[b]['days']), mean(acc[b]['raw']), mean(acc[b]['corr']), median(acc[b]['corr'])] for b in bounds]
    log('W7_error_by_wave rows %d' % write_table('W7_error_by_wave', ['class_lo', 'n_rows', 'n_days', 'mean_abs_errPctRaw', 'mean_abs_errPctCorr', 'median_abs_errPctCorr'], rows))
