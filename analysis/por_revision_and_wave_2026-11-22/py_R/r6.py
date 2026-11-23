from lib import *
from data import *


def run(c, M, rep):
    ch = read_csv(os.path.join(TIDY, 'checks.csv'))
    ch.sort(key=lambda r: ts(r['created_at_utc']))
    byfinal = {}
    for r in c.allruns:
        byfinal.setdefault(r['final_ts_utc'], []).append(r)
    rows = []
    for r in ch:
        ms = byfinal.get(r['predTs_utc'], [])
        if len(ms) > 1:
            rep.append('R6: check %s matches %d run rows by predTs_utc' % (r['seq'], len(ms)))
        run_seq = int(ms[0]['seq']) if ms else None
        ph = c.phase.get(run_seq) if run_seq is not None else None
        if ms and ph is None:
            rep.append('R6: check %s matches run seq %s which is not a used run (no phase)' % (r['seq'], run_seq))
        row = dict(seq_check=int(r['seq']), predTs_utc=r['predTs_utc'], run_seq=run_seq, phase=ph)
        for k in ['bin', 'st', 'rawCFS', 'corrApplied', 'corrCFS', 'actualCFS', 'errRawCFS', 'errPctRaw', 'errPctCorr', 'binBefore_n',
                  'binBefore_ema', 'binAfter_count', 'binAfter_emaMeanError', 'ceilBound', 'soft', 'hard']:
            v = r[k]
            row[k] = v
        row['_created'] = r['created_at_utc']
        rows.append(row)
        if not ms:
            M.add('R6', 'check_without_run_seq_check', int(r['seq']))
            M.add('R6', 'check_without_run_predTs_utc', r['predTs_utc'])
            rep.append('R6: check seq %s (predTs_utc %s) has no run in the log' % (r['seq'], r['predTs_utc']))
    cols = ['seq_check', 'predTs_utc', 'run_seq', 'phase', 'bin', 'st', 'rawCFS', 'corrApplied', 'corrCFS', 'actualCFS', 'errRawCFS', 'errPctRaw',
            'errPctCorr', 'binBefore_n', 'binBefore_ema', 'binAfter_count', 'binAfter_emaMeanError', 'ceilBound', 'soft', 'hard']
    n = write_table('R6_checks', cols, rows)
    rep.append('R6_checks rows %d' % n)
    c.checks_rows = rows
    # bins
    keys = sorted(set(r['bin'] + '_' + r['st'] for r in rows))
    out = []
    for k in keys:
        cs = [r for r in rows if r['bin'] + '_' + r['st'] == k]  # already by created_at
        new = [r for r in cs if r['phase'] == 'NEW']
        last3 = new[-3:]
        m3 = mean([float(r['errRawCFS']) for r in last3]) if last3 else None
        after = float(cs[-1]['binAfter_emaMeanError'])
        row = dict(bin_key=k, n_checks=len(cs), n_checks_OLD=sum(1 for r in cs if r['phase'] == 'OLD'),
                   n_checks_TRANS=sum(1 for r in cs if r['phase'] == 'TRANS'), n_checks_NEW=len(new),
                   ema_before_first_check=float(cs[0]['binBefore_ema']), ema_after_last_check=after,
                   mean_errRawCFS_last3_NEW=m3, gap_open_cfs=(m3 - after) if m3 is not None else None)
        if new:
            days = (CUTOFF - ts(new[0]['_created'])) / DAY
            cpd = len(new) / days
            row['checks_per_day_NEW'] = cpd
            row['days_to_close_90pct'] = 7 / cpd
        out.append(row)
    n = write_table('R6_bins', ['bin_key', 'n_checks', 'n_checks_OLD', 'n_checks_TRANS', 'n_checks_NEW', 'ema_before_first_check', 'ema_after_last_check',
                                 'mean_errRawCFS_last3_NEW', 'gap_open_cfs', 'checks_per_day_NEW', 'days_to_close_90pct'], out)
    rep.append('R6_bins rows %d' % n)
